import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import { URL } from "node:url";
import { Inject, Injectable, OnModuleDestroy } from "@nestjs/common";
import { WebSocket, WebSocketServer } from "ws";
import { PrismaService } from "../prisma/prisma.service";
import { readLiveFeature } from "../admin/admin-match-stats.service";

const SESSION_TTL_MS = 90_000;
const TICKET_TTL_MS = 30_000;
const MAX_CHUNK_BYTES = 256_000;
const RECENT_REPLAY_WINDOW_MS = 20_000;
const RECENT_REPLAY_HARD_LIMIT = 48;

type AudioChunk = {
  type: "chunk";
  sequence: number;
  mimeType: string;
  data: string;
  createdAt: number;
};

type AudioStream = {
  matchId: string;
  active: boolean;
  sequence: number;
  mimeType: string;
  startedAt: string;
  updatedAt: number;
  recentChunks: AudioChunk[];
  recorder: WebSocket | null;
  listeners: Set<WebSocket>;
};

type RecorderTicket = {
  matchId: string;
  expiresAt: number;
};

type HttpRecorderSession = {
  matchId: string;
  expiresAt: number;
};

export type LiveAudioStatus = {
  active: boolean;
  sequence: number;
  startedAt: string | null;
  mimeType: string | null;
};

export type LiveAudioChunk = AudioChunk;

export type LiveAudioTicket = {
  ticket: string;
  expiresAt: string;
  wsPath: string;
};

export type LiveAudioHttpSession = {
  sessionId: string;
  status: LiveAudioStatus;
};

export type LiveAudioPoll = LiveAudioStatus & {
  chunks: LiveAudioChunk[];
};

type SocketMessage =
  | { type: "start"; mimeType?: string }
  | { type: "chunk"; mimeType?: string; data?: string }
  | { type: "stop" };

@Injectable()
export class LiveAudioCommentaryService implements OnModuleDestroy {
  private readonly streams = new Map<string, AudioStream>();
  private readonly tickets = new Map<string, RecorderTicket>();
  private readonly httpSessions = new Map<string, HttpRecorderSession>();
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly sweep = setInterval(() => this.prune(), 30_000);
  private server: Server | null = null;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  attach(server: Server) {
    if (this.server === server) return;
    this.server = server;
    server.on("upgrade", (req, socket, head) => {
      const host = req.headers.host || "localhost";
      const url = new URL(req.url || "/", `http://${host}`);
      if (!url.pathname.startsWith("/api/v1/live-audio/")) return;

      this.wss.handleUpgrade(req, socket, head, (ws) => {
        void this.handleConnection(ws, url).catch(() => {
          ws.close(1011, "Unable to open live audio stream");
        });
      });
    });
  }

  onModuleDestroy() {
    clearInterval(this.sweep);
    for (const stream of this.streams.values()) {
      stream.recorder?.close(1001, "Server shutting down");
      for (const listener of stream.listeners) listener.close(1001, "Server shutting down");
    }
    this.wss.close();
    this.streams.clear();
    this.tickets.clear();
    this.httpSessions.clear();
  }

  createRecorderTicket(matchId: string): LiveAudioTicket {
    const ticket = randomUUID();
    const expiresAt = Date.now() + TICKET_TTL_MS;
    this.tickets.set(ticket, { matchId, expiresAt });
    return {
      ticket,
      expiresAt: new Date(expiresAt).toISOString(),
      wsPath: `/api/v1/live-audio/record/${encodeURIComponent(matchId)}?ticket=${encodeURIComponent(ticket)}`,
    };
  }

  status(matchId: string): LiveAudioStatus {
    this.prune(matchId);
    return this.statusFor(this.streams.get(matchId));
  }

  startHttpRecorder(matchId: string, ticket: string, mimeType: string | undefined): LiveAudioHttpSession {
    if (!this.claimTicket(matchId, ticket)) {
      throw new Error("Live audio ticket expired");
    }
    const stream = this.ensureStream(matchId);
    stream.recorder?.close(1000, "Live audio moved to HTTP recorder");
    stream.recorder = null;
    this.startStream(stream, mimeType);
    const sessionId = randomUUID();
    this.httpSessions.set(sessionId, { matchId, expiresAt: Date.now() + SESSION_TTL_MS });
    return { sessionId, status: this.statusFor(stream) };
  }

  pushHttpChunk(sessionId: string, mimeType: string | undefined, data: string | undefined) {
    const session = this.httpSessions.get(sessionId);
    if (!session || session.expiresAt < Date.now()) {
      this.httpSessions.delete(sessionId);
      throw new Error("Live audio session expired");
    }
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    this.appendChunk(session.matchId, mimeType, data, () => {
      throw new Error("Live audio is not active");
    });
    return this.status(session.matchId);
  }

  stopHttpRecorder(sessionId: string) {
    const session = this.httpSessions.get(sessionId);
    if (!session) return { stopped: true };
    this.httpSessions.delete(sessionId);
    this.stopStream(session.matchId);
    return { stopped: true };
  }

  async poll(matchId: string, afterSequence = 0): Promise<LiveAudioPoll> {
    await this.assertPublicAudioEnabled(matchId);
    const stream = this.streams.get(matchId);
    if (!stream) return { ...this.statusFor(stream), chunks: [] };
    this.trimRecentChunks(stream);
    return {
      ...this.statusFor(stream),
      chunks: stream.recentChunks
        .filter((chunk) => chunk.sequence > afterSequence)
        .slice(-RECENT_REPLAY_HARD_LIMIT),
    };
  }

  endPublicStream(matchId: string, reason = "Public live disabled") {
    const stream = this.streams.get(matchId);
    if (!stream) return;
    stream.active = false;
    stream.updatedAt = Date.now();
    this.broadcastStatus(stream);
    const recorder = stream.recorder;
    stream.recorder = null;
    recorder?.close(1008, reason);
    for (const listener of stream.listeners) listener.close(1008, reason);
    this.streams.delete(matchId);
  }

  private async handleConnection(ws: WebSocket, url: URL) {
    const [, , , channel, action, encodedMatchId] = url.pathname.split("/");
    const matchId = decodeURIComponent(encodedMatchId || "");
    if (channel !== "live-audio" || !matchId) {
      ws.close(1008, "Match is required");
      return;
    }

    if (action === "record") {
      this.acceptRecorder(ws, matchId, url.searchParams.get("ticket") || "");
      return;
    }
    if (action === "listen") {
      await this.acceptListener(ws, matchId);
      return;
    }
    ws.close(1008, "Unknown live audio stream");
  }

  private acceptRecorder(ws: WebSocket, matchId: string, ticket: string) {
    if (!this.claimTicket(matchId, ticket)) {
      ws.close(1008, "Live audio ticket expired");
      return;
    }

    const stream = this.ensureStream(matchId);
    stream.recorder?.close(1000, "Live audio moved to a new recorder");
    stream.recorder = ws;
    stream.updatedAt = Date.now();
    ws.send(JSON.stringify({ type: "status", ...this.statusFor(stream) }));

    ws.on("message", (raw) => this.handleRecorderMessage(matchId, raw.toString()));
    ws.on("close", () => {
      const current = this.streams.get(matchId);
      if (current?.recorder === ws) {
        current.recorder = null;
        current.active = false;
        current.updatedAt = Date.now();
        this.broadcastStatus(current);
      }
    });
  }

  private async acceptListener(ws: WebSocket, matchId: string) {
    const access = await this.publicAudioAccess(matchId);
    if (!access.ok) {
      ws.close(1008, access.reason);
      return;
    }

    const stream = this.ensureStream(matchId);
    stream.listeners.add(ws);
    stream.updatedAt = Date.now();
    ws.send(JSON.stringify({ type: "status", ...this.statusFor(stream) }));
    if (stream.active) {
      this.trimRecentChunks(stream);
      for (const chunk of stream.recentChunks) {
        if (ws.readyState !== WebSocket.OPEN) break;
        ws.send(JSON.stringify(chunk));
      }
    }
    ws.on("close", () => {
      stream.listeners.delete(ws);
      stream.updatedAt = Date.now();
    });
  }

  private handleRecorderMessage(matchId: string, raw: string) {
    const stream = this.streams.get(matchId);
    if (!stream?.recorder) return;

    let message: SocketMessage;
    try {
      message = JSON.parse(raw) as SocketMessage;
    } catch {
      stream.recorder.close(1003, "Live audio message must be JSON");
      return;
    }

    if (message.type === "start") {
      this.startStream(stream, message.mimeType);
      return;
    }
    if (message.type === "stop") {
      this.stopStream(matchId);
      return;
    }
    if (message.type !== "chunk") return;

    this.appendChunk(matchId, message.mimeType, message.data, (reason) => {
      stream.recorder?.close(1009, reason);
    });
  }

  private appendChunk(
    matchId: string,
    mimeType: string | undefined,
    dataValue: string | undefined,
    onInvalid: (reason: string) => void
  ) {
    const stream = this.streams.get(matchId);
    if (!stream) return;
    const data = typeof dataValue === "string" ? dataValue : "";
    if (!data || !stream.active) return;
    const bytes = Math.ceil((data.length * 3) / 4);
    if (bytes > MAX_CHUNK_BYTES) {
      onInvalid("Live audio chunk is too large");
      return;
    }

    stream.sequence += 1;
    stream.mimeType = mimeType || stream.mimeType;
    stream.updatedAt = Date.now();
    const chunk: AudioChunk = {
      type: "chunk",
      sequence: stream.sequence,
      mimeType: stream.mimeType,
      data,
      createdAt: stream.updatedAt,
    };
    stream.recentChunks.push(chunk);
    this.trimRecentChunks(stream);
    this.broadcast(stream, chunk);
  }

  private claimTicket(matchId: string, ticket: string) {
    const claim = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    return Boolean(claim && claim.matchId === matchId && claim.expiresAt >= Date.now());
  }

  private async publicAudioAccess(matchId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      select: { id: true, stats: true },
    });
    if (!match) return { ok: false, reason: "Match not found" };
    const liveFeature = readLiveFeature(match.stats);
    if (!liveFeature.enabled) {
      return { ok: false, reason: "Public live is not enabled for this match" };
    }
    if (!liveFeature.audioEnabled) {
      return { ok: false, reason: "Live audio commentary is not enabled for this match" };
    }
    return { ok: true };
  }

  private async assertPublicAudioEnabled(matchId: string) {
    const access = await this.publicAudioAccess(matchId);
    if (!access.ok) throw new Error(access.reason);
  }

  private trimRecentChunks(stream: AudioStream) {
    const cutoff = Date.now() - RECENT_REPLAY_WINDOW_MS;
    stream.recentChunks = stream.recentChunks
      .filter((chunk) => chunk.createdAt >= cutoff)
      .slice(-RECENT_REPLAY_HARD_LIMIT);
  }

  private startStream(stream: AudioStream, mimeType: string | undefined) {
    const now = Date.now();
    stream.active = true;
    stream.sequence = 0;
    stream.mimeType = mimeType || "audio/webm";
    stream.startedAt = new Date(now).toISOString();
    stream.updatedAt = now;
    stream.recentChunks = [];
    this.broadcastStatus(stream);
  }

  private stopStream(matchId: string) {
    const stream = this.streams.get(matchId);
    if (!stream) return;
    stream.active = false;
    stream.updatedAt = Date.now();
    this.broadcastStatus(stream);
    const recorder = stream.recorder;
    stream.recorder = null;
    recorder?.close(1000, "Live audio stopped");
    if (stream.listeners.size === 0) this.streams.delete(matchId);
  }

  private ensureStream(matchId: string): AudioStream {
    const existing = this.streams.get(matchId);
    if (existing) return existing;
    const now = Date.now();
    const stream: AudioStream = {
      matchId,
      active: false,
      sequence: 0,
      mimeType: "audio/webm",
      startedAt: new Date(now).toISOString(),
      updatedAt: now,
      recentChunks: [],
      recorder: null,
      listeners: new Set(),
    };
    this.streams.set(matchId, stream);
    return stream;
  }

  private statusFor(stream: AudioStream | undefined): LiveAudioStatus {
    if (!stream) return { active: false, sequence: 0, startedAt: null, mimeType: null };
    return {
      active: stream.active,
      sequence: stream.sequence,
      startedAt: stream.active ? stream.startedAt : null,
      mimeType: stream.active ? stream.mimeType : null,
    };
  }

  private broadcastStatus(stream: AudioStream) {
    this.broadcast(stream, { type: "status", ...this.statusFor(stream) });
  }

  private broadcast(stream: AudioStream, payload: unknown) {
    const message = JSON.stringify(payload);
    for (const listener of stream.listeners) {
      if (listener.readyState === WebSocket.OPEN) listener.send(message);
    }
  }

  private prune(matchId?: string) {
    const now = Date.now();
    for (const [ticket, claim] of this.tickets.entries()) {
      if (claim.expiresAt < now) this.tickets.delete(ticket);
    }
    for (const [sessionId, session] of this.httpSessions.entries()) {
      if (session.expiresAt < now) {
        this.httpSessions.delete(sessionId);
        this.stopStream(session.matchId);
      }
    }

    const entries = matchId
      ? [...this.streams.entries()].filter(([id]) => id === matchId)
      : [...this.streams.entries()];
    for (const [id, stream] of entries) {
      if (stream.active && now - stream.updatedAt <= SESSION_TTL_MS) continue;
      if (stream.recorder || stream.listeners.size > 0) continue;
      this.streams.delete(id);
    }
  }
}

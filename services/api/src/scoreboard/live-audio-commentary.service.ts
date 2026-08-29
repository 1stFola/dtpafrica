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

type AudioStream = {
  matchId: string;
  active: boolean;
  sequence: number;
  mimeType: string;
  startedAt: string;
  updatedAt: number;
  recorder: WebSocket | null;
  listeners: Set<WebSocket>;
};

type RecorderTicket = {
  matchId: string;
  expiresAt: number;
};

export type LiveAudioStatus = {
  active: boolean;
  sequence: number;
  startedAt: string | null;
  mimeType: string | null;
};

export type LiveAudioTicket = {
  ticket: string;
  expiresAt: string;
  wsPath: string;
};

type SocketMessage =
  | { type: "start"; mimeType?: string }
  | { type: "chunk"; mimeType?: string; data?: string }
  | { type: "stop" };

@Injectable()
export class LiveAudioCommentaryService implements OnModuleDestroy {
  private readonly streams = new Map<string, AudioStream>();
  private readonly tickets = new Map<string, RecorderTicket>();
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
    const claim = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!claim || claim.matchId !== matchId || claim.expiresAt < Date.now()) {
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
    const match = await this.prisma.sbMatch.findUnique({
      where: { id: matchId },
      select: { id: true, stats: true },
    });
    if (!match) {
      ws.close(1008, "Match not found");
      return;
    }
    if (!readLiveFeature(match.stats).enabled) {
      ws.close(1008, "Public live is not enabled for this match");
      return;
    }

    const stream = this.ensureStream(matchId);
    stream.listeners.add(ws);
    stream.updatedAt = Date.now();
    ws.send(JSON.stringify({ type: "status", ...this.statusFor(stream) }));
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

    const data = typeof message.data === "string" ? message.data : "";
    if (!data || !stream.active) return;
    const bytes = Math.ceil((data.length * 3) / 4);
    if (bytes > MAX_CHUNK_BYTES) {
      stream.recorder.close(1009, "Live audio chunk is too large");
      return;
    }

    stream.sequence += 1;
    stream.mimeType = message.mimeType || stream.mimeType;
    stream.updatedAt = Date.now();
    this.broadcast(stream, {
      type: "chunk",
      sequence: stream.sequence,
      mimeType: stream.mimeType,
      data,
      createdAt: stream.updatedAt,
    });
  }

  private startStream(stream: AudioStream, mimeType: string | undefined) {
    const now = Date.now();
    stream.active = true;
    stream.sequence = 0;
    stream.mimeType = mimeType || "audio/webm";
    stream.startedAt = new Date(now).toISOString();
    stream.updatedAt = now;
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

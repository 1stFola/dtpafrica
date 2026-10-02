import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { LiveAudioCommentaryService } from "./live-audio-commentary.service";

describe("live audio transports", () => {
  let service: LiveAudioCommentaryService;
  let match: any;
  const data = Buffer.from("independent audio segment").toString("base64");
  const mime = "audio/webm;codecs=opus";
  beforeEach(() => {
    vi.useFakeTimers();
    match = { isPublished: true, stats: { liveFeature: { enabled: true, audioEnabled: true } }, statisticsSheet: { clock: { firstHalfStartedAt: "2026-10-02T12:00:00Z", phase: "running" }, idleLockedAt: null } };
    service = new LiveAudioCommentaryService({ sbMatch: { findUnique: vi.fn(async () => match) } } as any);
  });
  afterEach(() => { service.onModuleDestroy(); vi.useRealTimers(); });
  const start = () => service.startHttpRecorder("match", service.createRecorderTicket("match").ticket, mime);
  it("accepts one-use tickets only once", async () => {
    const ticket = service.createRecorderTicket("match").ticket;
    await service.startHttpRecorder("match", ticket, mime);
    await expect(service.startHttpRecorder("match", ticket, mime)).rejects.toThrow("ticket expired");
  });
  it("rechecks recorder authorization when a ticket is consumed", async () => {
    const authorize = vi.fn().mockRejectedValue(new Error("Recorder changed"));
    const ticket = service.createRecorderTicket("match", authorize).ticket;
    await expect(service.startHttpRecorder("match", ticket, mime)).rejects.toThrow("Recorder changed");
    expect(service.status("match").active).toBe(false);
  });
  it("does not broadcast before kickoff, after full time, or when unpublished", async () => {
    match.statisticsSheet.clock.firstHalfStartedAt = null;
    await expect(start()).rejects.toThrow("not active");
    match.statisticsSheet.clock.firstHalfStartedAt = "2026-10-02T12:00:00Z";
    match.statisticsSheet.clock.phase = "finished";
    await expect(start()).rejects.toThrow("not active");
    match.statisticsSheet.clock.phase = "running";
    match.isPublished = false;
    await expect(start()).rejects.toThrow("not published");
  });
  it("invalidates the previous HTTP recorder when replaced", async () => {
    const first = await start();
    const second = await start();
    expect(() => service.pushHttpChunk(first.sessionId, mime, data)).toThrow("session expired");
    service.stopHttpRecorder(first.sessionId);
    expect(service.status("match").active).toBe(true);
    service.pushHttpChunk(second.sessionId, mime, data, "match");
    expect((await service.poll("match")).chunks).toHaveLength(1);
  });
  it("binds HTTP chunk and stop requests to their fixture", async () => {
    const session = await start();
    expect(() => service.pushHttpChunk(session.sessionId, mime, data, "other")).toThrow("another match");
    expect(() => service.stopHttpRecorder(session.sessionId, "other")).toThrow("another match");
    expect(service.status("match").active).toBe(true);
  });
  it("keeps sequences increasing across broadcast restarts", async () => {
    const first = await start();
    const sequence = service.pushHttpChunk(first.sessionId, mime, data).sequence;
    service.stopHttpRecorder(first.sessionId);
    const second = await start();
    service.pushHttpChunk(second.sessionId, mime, data);
    const polled = await service.poll("match", sequence);
    expect(polled.chunks).toHaveLength(1);
    expect(polled.sequence).toBeGreaterThan(sequence);
    expect(second.status.startedAt).not.toBe(first.status.startedAt);
  });
  it("starts late listeners near the live edge with two complete segments", async () => {
    const session = await start();
    for (let n = 0; n < 8; n += 1) service.pushHttpChunk(session.sessionId, mime, data);
    expect((await service.poll("match")).chunks.map((chunk) => chunk.sequence)).toEqual([7, 8]);
    expect((await service.poll("match", 3)).chunks).toHaveLength(5);
  });
  it("rejects malformed, oversized and changed-format chunks", async () => {
    const session = await start();
    expect(() => service.pushHttpChunk(session.sessionId, mime, "!invalid!")).toThrow("base64");
    expect(() => service.pushHttpChunk(session.sessionId, "audio/mp4", data)).toThrow("format changed");
    expect(() => service.pushHttpChunk(session.sessionId, mime, Buffer.alloc(256_001).toString("base64"))).toThrow("too large");
    expect(service.status("match").sequence).toBe(0);
  });
  it("ends expired sessions and never replays stopped audio", async () => {
    const session = await start();
    service.pushHttpChunk(session.sessionId, mime, data);
    vi.advanceTimersByTime(90_001);
    const poll = await service.poll("match");
    expect(poll.active).toBe(false);
    expect(poll.chunks).toEqual([]);
  });
  it("invalidates sessions when public commentary is disabled", async () => {
    const session = await start();
    service.endPublicStream("match");
    expect(() => service.pushHttpChunk(session.sessionId, mime, data)).toThrow("session expired");
    match.stats.liveFeature.audioEnabled = false;
    await expect(service.poll("match")).rejects.toThrow("not enabled");
  });
  it("does not let an old WebSocket stop its replacement", async () => {
    const socket = () => Object.assign(new EventEmitter(), { readyState: 1, bufferedAmount: 0, send: vi.fn(), close: vi.fn() });
    const first = socket();
    const second = socket();
    await (service as any).acceptRecorder(first, "match", service.createRecorderTicket("match").ticket);
    await (service as any).acceptRecorder(second, "match", service.createRecorderTicket("match").ticket);
    first.emit("message", Buffer.from(JSON.stringify({ type: "stop" })));
    second.emit("message", Buffer.from(JSON.stringify({ type: "start", mimeType: mime })));
    await vi.waitFor(() => expect(service.status("match").active).toBe(true));
    first.emit("close");
    expect(service.status("match").active).toBe(true);
  });
});

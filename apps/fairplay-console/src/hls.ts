/*
 * Live preview: MediaMTX's fMP4 HLS, proxied by the Edge at /edge/v1/live/<source>/<file>,
 * played with Media Source Extensions. No third-party player: the job is small (one video
 * rendition, append new parts, stay near the live edge) and every library is one more thing
 * to vet. The preview is muted and video-only; the replay player is the one that matters.
 *
 * "Behind live" is measured, not assumed: the playlist's EXT-X-PROGRAM-DATE-TIME says when
 * each part began, so the delay is the Edge clock now minus the wall time of the frame on
 * screen.
 */

export type Variant = { uri: string; codecs: string | null };

export type MediaSegment = { sequence: number; uri: string; durationS: number; programDateMs: number | null };

export type MediaPlaylist = { initUri: string | null; targetDurationS: number; segments: MediaSegment[]; ended: boolean };

function attr(line: string, name: string): string | null {
  const m = new RegExp(`${name}=("([^"]*)"|[^,]*)`).exec(line);
  return m ? (m[2] ?? m[1]) : null;
}

export function parseMultivariant(text: string): Variant[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const out: Variant[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("#EXT-X-STREAM-INF:")) {
      const uri = lines.slice(i + 1).find((l) => l && !l.startsWith("#"));
      if (uri) out.push({ uri, codecs: attr(lines[i], "CODECS") });
    }
  }
  return out;
}

export function parseMedia(text: string): MediaPlaylist {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let sequence = 0;
  let target = 1;
  let initUri: string | null = null;
  let pendingDuration: number | null = null;
  let pendingDate: number | null = null;
  let lastDate: number | null = null;
  const segments: MediaSegment[] = [];
  for (const line of lines) {
    if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) sequence = Number(line.split(":")[1]);
    else if (line.startsWith("#EXT-X-TARGETDURATION:")) target = Number(line.split(":")[1]);
    else if (line.startsWith("#EXT-X-MAP:")) initUri = attr(line, "URI");
    else if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) pendingDate = Date.parse(line.slice("#EXT-X-PROGRAM-DATE-TIME:".length));
    else if (line.startsWith("#EXTINF:")) pendingDuration = Number(line.slice(8).split(",")[0]);
    else if (line && !line.startsWith("#") && pendingDuration !== null) {
      // A date applies to its segment; later ones follow on from it.
      const previous: MediaSegment | undefined = segments[segments.length - 1];
      const date: number | null = pendingDate ?? (lastDate !== null && previous ? lastDate + previous.durationS * 1000 : null);
      segments.push({ sequence: sequence + segments.length, uri: line, durationS: pendingDuration, programDateMs: date });
      lastDate = date;
      pendingDuration = null;
      pendingDate = null;
    }
  }
  return { initUri, targetDurationS: target, segments, ended: lines.includes("#EXT-X-ENDLIST") };
}

/** The video codec from a CODECS attribute, as MediaSource wants it. */
export function videoMime(codecs: string | null): string {
  const video = (codecs ?? "").split(",").map((c) => c.trim()).find((c) => /^(avc1|avc3|hvc1|hev1)\./.test(c));
  return `video/mp4; codecs="${video ?? "avc1.640028"}"`;
}

export type LiveState = { status: "connecting" | "playing" | "unavailable" | "unsupported"; behindMs: number | null; message?: string };

export class LivePlayer {
  private stopped = false;
  private timer: number | undefined;
  private appended = new Set<number>();
  private base = "";
  private source: MediaSource | null = null;
  private buffer: SourceBuffer | null = null;
  private queue: ArrayBuffer[] = [];
  private segmentDates = new Map<number, { startS: number; dateMs: number }>();
  private appendedSeconds = 0;

  constructor(private video: HTMLVideoElement, private onState: (s: LiveState) => void, private edgeNow: () => number) {}

  async start(sourceName: string): Promise<void> {
    this.stop();
    this.stopped = false;
    this.base = `/edge/v1/live/${encodeURIComponent(sourceName)}/`;
    if (typeof MediaSource === "undefined") {
      this.onState({ status: "unsupported", behindMs: null, message: "this browser cannot play the live preview" });
      return;
    }
    this.onState({ status: "connecting", behindMs: null });
    try {
      const index = await this.text("index.m3u8");
      const variant = parseMultivariant(index)[0];
      if (!variant) throw new Error("no video rendition");
      const mime = videoMime(variant.codecs);
      if (!MediaSource.isTypeSupported(mime)) throw new Error(`codec not supported here: ${mime}`);
      this.source = new MediaSource();
      this.video.src = URL.createObjectURL(this.source);
      await new Promise<void>((resolve) => this.source!.addEventListener("sourceopen", () => resolve(), { once: true }));
      this.buffer = this.source.addSourceBuffer(mime);
      this.buffer.mode = "sequence";
      this.buffer.addEventListener("updateend", () => this.drain());
      await this.poll(variant.uri, true);
    } catch (err) {
      if (!this.stopped) this.onState({ status: "unavailable", behindMs: null, message: (err as Error).message });
    }
  }

  stop(): void {
    this.stopped = true;
    window.clearTimeout(this.timer);
    this.appended.clear();
    this.segmentDates.clear();
    this.queue = [];
    this.appendedSeconds = 0;
    if (this.video.src.startsWith("blob:")) URL.revokeObjectURL(this.video.src);
    this.video.removeAttribute("src");
    this.video.load();
    this.source = null;
    this.buffer = null;
  }

  private async text(file: string): Promise<string> {
    const r = await fetch(this.base + file, { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error(r.status === 404 ? "source not publishing" : `live preview HTTP ${r.status}`);
    return r.text();
  }

  private async bytes(file: string): Promise<ArrayBuffer> {
    const r = await fetch(this.base + file, { credentials: "same-origin", cache: "no-store" });
    if (!r.ok) throw new Error(`live part HTTP ${r.status}`);
    return r.arrayBuffer();
  }

  private async poll(playlistUri: string, first: boolean): Promise<void> {
    if (this.stopped) return;
    let wait = 1000;
    try {
      const playlist = parseMedia(await this.text(playlistUri));
      wait = Math.max(500, (playlist.targetDurationS * 1000) / 2);
      if (first && playlist.initUri) this.enqueue(await this.bytes(playlist.initUri));
      // Start near the live edge: the last two segments, not the whole window.
      const fresh = playlist.segments.filter((s) => !this.appended.has(s.sequence));
      const take = first ? fresh.slice(-2) : fresh;
      for (const seg of take) {
        if (this.stopped) return;
        this.appended.add(seg.sequence);
        if (seg.programDateMs !== null) this.segmentDates.set(seg.sequence, { startS: this.appendedSeconds, dateMs: seg.programDateMs });
        this.appendedSeconds += seg.durationS;
        this.enqueue(await this.bytes(seg.uri));
      }
      this.keepLive();
    } catch (err) {
      this.onState({ status: "unavailable", behindMs: null, message: (err as Error).message });
      wait = 2000;
    }
    this.timer = window.setTimeout(() => void this.poll(playlistUri, false), wait);
  }

  private enqueue(data: ArrayBuffer): void {
    this.queue.push(data);
    this.drain();
  }

  private drain(): void {
    const buffer = this.buffer;
    if (!buffer || buffer.updating || !this.queue.length) return;
    try {
      buffer.appendBuffer(this.queue.shift()!);
    } catch (err) {
      // QuotaExceeded: drop what is far behind and try again.
      if (buffer.buffered.length && this.video.currentTime > 30) buffer.remove(0, this.video.currentTime - 20);
      this.onState({ status: "unavailable", behindMs: null, message: (err as Error).message });
    }
  }

  private keepLive(): void {
    const b = this.video.buffered;
    if (!b.length) return;
    const end = b.end(b.length - 1);
    if (end - this.video.currentTime > 4) this.video.currentTime = Math.max(b.start(0), end - 1.5);
    if (this.video.paused) void this.video.play().catch(() => undefined);
    // Which segment is on screen, and when was it filmed?
    let dated: { startS: number; dateMs: number } | null = null;
    for (const d of this.segmentDates.values()) if (d.startS <= this.video.currentTime) dated = d;
    const behind = dated ? this.edgeNow() - (dated.dateMs + (this.video.currentTime - dated.startS) * 1000) : null;
    // Before the player settles on the live edge the arithmetic can come out below zero;
    // a delay is never negative, so that reading is "not measured yet", not a number.
    this.onState({ status: "playing", behindMs: behind !== null && behind >= 0 ? Math.round(behind) : null });
  }
}

import { describe, expect, it } from "vitest";
import { parseMedia, parseMultivariant, videoMime } from "./hls";

const MULTIVARIANT = `#EXTM3U
#EXT-X-VERSION:9
#EXT-X-INDEPENDENT-SEGMENTS

#EXT-X-MEDIA:TYPE="AUDIO",GROUP-ID="audio",NAME="audio2",AUTOSELECT=YES,DEFAULT=YES,URI="audio2_stream.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2600000,AVERAGE-BANDWIDTH=2400000,CODECS="avc1.640020,mp4a.40.2",RESOLUTION=1280x720,FRAME-RATE=25.000,AUDIO="audio"
video1_stream.m3u8
`;

const MEDIA = `#EXTM3U
#EXT-X-VERSION:9
#EXT-X-TARGETDURATION:2
#EXT-X-MEDIA-SEQUENCE:41
#EXT-X-MAP:URI="video1_init.mp4"
#EXT-X-PROGRAM-DATE-TIME:2026-10-27T14:00:00.000Z
#EXTINF:2.00000,
video1_seg41.mp4
#EXTINF:2.00000,
video1_seg42.mp4
#EXT-X-PROGRAM-DATE-TIME:2026-10-27T14:00:04.040Z
#EXTINF:1.96000,
video1_seg43.mp4
`;

describe("live preview playlists", () => {
  it("finds the video rendition and its codecs", () => {
    expect(parseMultivariant(MULTIVARIANT)).toEqual([{ uri: "video1_stream.m3u8", codecs: "avc1.640020,mp4a.40.2" }]);
    expect(videoMime("avc1.640020,mp4a.40.2")).toBe('video/mp4; codecs="avc1.640020"');
    expect(videoMime(null)).toBe('video/mp4; codecs="avc1.640028"');
  });

  it("numbers segments and carries their wall-clock dates", () => {
    const p = parseMedia(MEDIA);
    expect(p.initUri).toBe("video1_init.mp4");
    expect(p.targetDurationS).toBe(2);
    expect(p.segments.map((s) => s.sequence)).toEqual([41, 42, 43]);
    expect(p.segments[0].programDateMs).toBe(Date.parse("2026-10-27T14:00:00.000Z"));
    expect(p.segments[1].programDateMs).toBe(Date.parse("2026-10-27T14:00:02.000Z")); // carried forward
    expect(p.segments[2].programDateMs).toBe(Date.parse("2026-10-27T14:00:04.040Z")); // its own tag wins
    expect(p.ended).toBe(false);
  });
});

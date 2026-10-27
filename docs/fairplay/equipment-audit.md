# FairPlay — equipment audit

Phase 0 deliverable. **Every row below is UNVERIFIED.** Nothing in this repository describes
the matchday kit: a search of `docs/` for switcher, OBS, ATEM, vMix, drone, DJI, SDI, HDMI,
NDI, SRT, RTMP and RTSP returns nothing. The PID says DTP owns ground camera(s), a drone,
walkie-talkies and a live production setup; that is the whole of what is known. No
matchday hardware sheet came with the PID bundle (it holds the PID, the prompt pack, and
the prompt pack again as Markdown).

The matrix is the questionnaire for the matchday crew. Phase 1 does not start until the
**Gate** rows are answered with evidence (a photo of the back panel, a model number, a
screenshot of the encoder's output settings), not from memory.

---

## The question that decides the product

**Can each camera be recorded on its own, before the switcher cuts between them?**

- **Yes, for ground and drone** → two-angle mode (FP-02, FP-12 are reachable).
- **Only the switched programme feed** → single-angle mode. FairPlay still ships: one
  continuous recording, incident marking, review, evidence. It must not be described as
  offering a second angle, and every incident is marked `angles_available: 1`. Two angles
  becomes a hardware purchase (an ISO-capable switcher or a capture device per camera),
  decided after the pilot, not assumed.
- **The programme feed only, and it shows replays and graphics** → single-angle mode, plus a
  standing warning: programme footage contains cuts, replays and overlays, so "no footage of
  the incident" can mean "the director was on the other camera". The finding
  `footage_unavailable` exists for this.

## Matrix

| # | Item | What we need to know | Status | Gate? |
|---|---|---|---|---|
| E1 | Ground camera(s) | Make/model; count; output (HDMI / SDI / IP stream); resolution and frame rate actually used on matchday; whether it records internally | UNVERIFIED | Gate |
| E2 | Ground camera stream | If IP: protocol (RTSP / SRT / RTMP / NDI), codec (H.264 / H.265), GOP / keyframe interval, bitrate | UNVERIFIED | Gate |
| E3 | Drone | Make/model; how video leaves it (controller HDMI out, controller RTMP push, app only); latency; flight time per battery; who flies it and under what permission | UNVERIFIED | Gate |
| E4 | Production switcher | Make/model; whether it has ISO recording, aux outputs or per-input network streams; whether it records ISO to its own disk only (not usable live) | UNVERIFIED | Gate |
| E5 | OBS / encoder | OBS version or hardware encoder; the YouTube output settings; whether a second simultaneous output is possible without dropping frames on the YouTube one | UNVERIFIED | Gate |
| E6 | Programme feed | How the switched feed reaches the encoder; whether a copy can be taken (second stream output, HDMI loop-out, aux) | UNVERIFIED | Gate |
| E7 | Edge computer | Is there a machine **other than** the one running OBS? OS, CPU, RAM, GPU, free SSD, USB/Thunderbolt ports | UNVERIFIED | Gate |
| E8 | Edge storage | SSD model and free space; sustained write speed (measured, not the box figure); whether it is internal or USB | UNVERIFIED | Gate |
| E9 | Capture devices | Any HDMI/SDI capture cards or dongles, model, and whether they deliver raw frames (needs encoding) or a compressed stream | UNVERIFIED | — |
| E10 | Venue LAN | Router/switch on site; wired or Wi-Fi between cameras, encoder and Edge; who else joins that network (spectators? club staff?) | UNVERIFIED | Gate |
| E11 | Internet uplink | How YouTube is fed (MiFi, 4G router, venue line); typical upload speed; whether it is shared with the Edge machine | UNVERIFIED | — |
| E12 | Power | Mains / generator; UPS make and runtime; what is on it | UNVERIFIED | — |
| E13 | Time source | Do the cameras or encoder embed wall-clock time (RTSP sender reports, SEI timecode)? Is NTP reachable on site? | UNVERIFIED | — |
| E14 | Operator devices | Which laptops/tablets will a replay operator and assessor use; are they DTP-owned (a local certificate can be installed) | UNVERIFIED | Gate |
| E15 | Audio | Which feeds carry audio; whether ambient audio of players or officials is captured (a privacy question, not a technical one) | UNVERIFIED | — |
| E16 | **Source recording mode** (the summary of E1–E6) | Per camera, one of: *ISO, live* (a separate stream FairPlay can record during the match) · *ISO, on-device only* (recorded inside the switcher or camera, usable after the match only) · *programme only* | UNVERIFIED | Gate — decides single- or multi-angle mode |

## Ingest topologies, by what the answers turn out to be

| Topology | Applies if | Path into MediaMTX | Edge CPU cost | Notes |
|---|---|---|---|---|
| T1 — IP cameras | E2 is RTSP/SRT/RTMP with H.264 | MediaMTX pulls or receives the stream, records it as received | Low: stream copy | The cheapest and most faithful. Original = the camera's own encode. |
| T2 — Second encoder output | E5/E6 allow a second output from OBS or the hardware encoder | Encoder pushes SRT/RTMP to MediaMTX on the Edge machine | Low on Edge; **load lands on the production machine** | Must be load-tested: a dropped YouTube frame is a regression we caused. |
| T3 — Capture card on Edge | Cameras are HDMI/SDI only | Capture card → FFmpeg encode → MediaMTX | **High**: one live H.264 encode per camera | This is an encode, not a transcode of a stream, but it is still continuous CPU/GPU work. Needs hardware encode (Quick Sync / NVENC) or a capable CPU; measure before promising two angles. |
| T4 — Programme only | Nothing above is available | Same as T2 with one feed | Low | Single-angle mode. |

The drone is optional in every topology. The ground camera is mandatory: if it is not
recording, the session shows `recording at risk` and incidents are still logged, with the
gap recorded.

## One machine or two

The PID asks whether one computer can safely run the broadcast and the replay. The
recommendation is **two**, until measured otherwise: FairPlay seeking, clip export and
hashing all read the disk and use CPU, and the acceptance test "kill the Edge UI or an
export job; the livestream stays up" (PID §14) is only meaningful if they do not share a
process tree or a disk with OBS. If only one machine exists, Phase 1's bench test must run
a 90-minute synthetic stream to YouTube *unlisted* while exporting clips and report dropped
frames from OBS's own stats.

## How to answer this

A filled copy of the matrix with, per Gate row: the model number, a photo, and for E2/E5 a
screenshot of the output settings. For E8, the output of a 5-minute sustained write test
(Phase 1 supplies the command). Nothing needs to be bought before these answers exist.

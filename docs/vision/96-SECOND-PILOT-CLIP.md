# 96 — A second pilot clip: Divine Praise FC v Kiraa FA

12 October 2026. The first pilot clip (doc 74) shows its pitch markings too faintly for a
person to mark landmarks on it. Fola supplied a 1XCup 2026 match with clearer markings
and its media agreement. This prepares a clip from it for the pilot tasks: labelling
shots, marking the pitch, and gold labels.

## The rights

The *1XCup Tournaments 2026 Media Rights & Content License Agreement*:
- **Dates and duration:** effective 1 May 2026, with no end date for 1XCup 2026 media.
- **Rights granted to DTP:** recording, distribution, marketing, and computer-vision
  training, evaluation and commercialisation.
- **Participants:** it warrants that every participant is an adult and that waivers
  were collected.
- **Signatures:** signed by Akanni Kabir (Tournament Organizer, 10 June 2026) and
  Afolabi Sanni (DTP).
- **One defect:** DTP's signature date reads "June 0, 2026". It is recorded as written
  in the evidence notes, not corrected.

**Recorded locally** (partner `1XCup 2026 Organizer`, the PDF as `contract` evidence):
- a rights scope with analysis and training on, publication and scout sharing off for
  the pilot;
- Akanni Kabir as signatory;
- the source, with acquisition authorised.

## The clip

| Item | Value |
|---|---|
| Full match | 6,030.6 s (1 h 40 min), 1920 × 1080, 30 fps, 2.04 GB; SHA-256 `f4b8fc4b…f331` |
| Clip | 144.582 s, cut losslessly (stream copy) from 2,125.533 s (35:25.533) of the full match; SHA-256 `f136c4f5…f146` |
| Why there | Wide camera, clear centre circle, halfway line and penalty areas, plus a goalmouth chance |
| Match clock | On-screen scoreboard reads 27:20 at 38 s into the clip, so the clip covers about minutes 26:40 to 29:05 |
| Fixture | ScoreBoard `c450c75a-1003-5c75-8b79-46dcda5f4628`, 1XCup 2026 Group B, 6 Oct 2026 |
| Source / asset | `d269d1c8-2b6f-440d-9a6b-dead07755c58` / `cd9ea2ae-9744-452a-8fdc-2ebec99f139e` |
| Stages | probe, fingerprint, transcode and camera motion succeeded on the local CPU worker |
| Proxy | 1280 × 720, 25 fps, 144.6 s |
| Shots | 12 proposed by camera motion |

The stream copy has to start on a keyframe. The video has one every 5 s, so the clip
starts 2.5 s before the 35:28 asked for.

**The pilot reviewers** `1stfola@gmail.com` and `fola@dtp.africa` now have 1XCup 2026 as
well as Jagaban Cup 2026, so the fixture is theirs to review. **No gold set exists for
this clip yet:** creating one needs a person, and the manual walks Fola through it.

## A fix: competition ids that are not UUIDs

The 1XCup competition's ScoreBoard id is `00000000-0000-4000-81xc-000000000000`. It is
text in a UUID's shape, but not a UUID.

**The problem:** `CreateSourceDto.sbCompetitionId` required a UUID, so footage could not
be linked to this competition. Doc 74 found and fixed the same fault for match ids.

**The fix:**
- the field now takes a bounded string;
- the service confirms the competition exists before storing anything, and refuses an
  unknown one with a 404 rather than a database error.

**Tests:** text ids are accepted; empty, oversized and non-string ids are refused; a
text id is stored after the check; an unknown competition is refused before any row or
audit record is written.

## The match squad

Gold labels can name players only from the match squad, which no 1XCup match sheet had
filled. At Fola's request, the squad was filled from the two teams' registered players:
23 for Divine Praise FC and 25 for Kiraa FA. It went through the ScoreBoard CSV upload
(`POST /admin/scoreboard/matches/:id/squads/upload`), which matched every player to an
existing team-squad row and created no new ones.

**What this data does not know:**
- **Who started.** The squad model records only starters and substitutes, and the
  lineup for this match is unknown. So every player is recorded as `bench`, which is
  not a claim that anyone came off the bench.
- **Shirt numbers.** Neither team has any registered.

If the real match sheet turns up, the starters should be entered from it. This is the
local database only; nothing changed on the live ScoreBoard.

## Still open

- **No detection, tracking or ball run yet on this clip.** They follow once the shots
  are labelled and the pitch is marked.

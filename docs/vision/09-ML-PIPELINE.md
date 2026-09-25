# 09 — ML pipeline, adapters and the dataset factory

## The adapter contract

Every model sits behind an interface. The product depends on the interface; research models come
and go.

```ts
interface DetectorAdapter {
  readonly modelVersionId: string;
  detect(frames: FrameBatch, opts: DetectOptions): Promise<DetectionBatch>;
}

interface TrackerAdapter {
  readonly modelVersionId: string;
  track(detections: DetectionStream, opts: TrackOptions): Promise<TrackSet>;
}

interface CalibrationAdapter {
  readonly modelVersionId: string;
  calibrate(frames: FrameBatch, segment: CameraSegment): Promise<CalibrationResult>;
}

interface EventModelAdapter {
  readonly modelVersionId: string;
  readonly taxonomyVersion: string;
  propose(gameState: GameStateWindow): Promise<EventCandidate[]>;
}

interface VideoLanguageModelAdapter {
  readonly modelVersionId: string;
  readonly promptVersion: string;
  observe(clip: ClipRef, context: StructuredContext): Promise<ScoutingObservation>;
}
```

Every adapter output is wrapped in the prediction envelope from
[07-API-CONTRACTS.md](./07-API-CONTRACTS.md#the-prediction-envelope). One shape, one review UI,
one supersede mechanism.

---

## The dataset factory

The most under-rated part of the program. Nigeria-domain performance will depend more on data
coverage and correction loops than on which detector is fashionable.

### Sampling strategies

Random sampling produces a corpus of easy frames. Deliberately oversample the hard cases:

`random`, `motion_heavy`, `zoomed_out`, `low_light`, `night_floodlight`, `blur`, `compression`,
`crowded_box`, `set_piece`, `hard_negative_ball`, `kit_similarity`, `obstruction`, `camera_cut`,
`replay_boundary`.

Each sampled window records the strategy that produced it, so representation can be audited and
the sampler can be corrected when a slice is starving.

### Annotation split

Per [02-DECISIONS.md, D9](./02-DECISIONS.md#d9--cvat):

| Work | Tool |
|---|---|
| Dense boxes and tracks | CVAT, on its own host, behind an import/export adapter |
| Identity, events, merge/split, approve/reject | DTP-native review workstation |

The DTP schema is canonical in both directions. CVAT is an editor DTP imports from and exports to,
never the source of truth. Phase 2 ships the native workstation first and is **not blocked** on
CVAT being stood up.

### Quality workflow

```
AUTO / PRE-LABEL --> ANNOTATOR --> REVIEWER --> GOLD BENCHMARK
       |                |              |
       +---- feedback --+--------------+
                        |
             ACTIVE LEARNING QUEUE --> NEXT DATASET VERSION
```

- Pre-labels save time, and reviewers **always see which labels came from a model**. An unmarked
  pre-label is an anchoring bias machine.
- Inter-annotator disagreement is measured on the gold subset and tracked over time. It is a
  signal about the label definitions, not about the annotators.
- Machine outputs stay immutable; corrections are separate reviewed annotations.
- Label definitions are versioned. Changing what counts as a "pass" is a schema change with a
  migration, not a quiet edit to a handbook.
- Rejection reasons are structured: `wrong_box`, `wrong_identity`, `camera_cut`, `ball_invisible`,
  `event_ambiguous`, `roster_error`, `rights_issue`. These drive the next sampling batch.

### Split policy

**Never random-split adjacent frames.** Frames from the same match leak appearance into
validation and make metrics look strong while the model has learned nothing generalisable.

Splits group by, in order: `duplicateCluster` → `sbMatchId` → source → competition/date/camera.
Whatever grouping is configured, the leakage checker proves no group spans two splits before a
dataset can be frozen.

The **Nigeria gold benchmark** is held out permanently and never trained on. It receives
two-person review and is locked and versioned. Tuning against it by editing it is the one
unforgivable act in this system — the checker treats the gold subset as immutable after freeze.

### Corpus firewall

`VisionVideoAsset.corpus` is an enum: `dtp_owned` | `research_only` | `experimental`.

`VisionDatasetMember` insertion hard-fails unless `corpus = dtp_owned` **and** `canTrain` resolves
allowed **and** an R2 checksum exists **and** acquisition is `acquired`. SoccerNet and similar
research corpora are ingested as `research_only`, are usable for architecture and benchmark
learning, and are structurally incapable of entering a training set. Covered by a test.

---

## Detection — Phase 3

**Baseline:** RF-DETR. Apache-2.0 core with Apache-designated weights; Plus/XL components carry
separate terms. Exact code, weight, and dependency licences are recorded in
[the OSS register](../licenses/OSS_REGISTER.md) **before** any training run.

Classes: `player`, `goalkeeper`, `referee`, `ball`. `assistant_referee` is deferred — see
[02-DECISIONS.md, R9](./02-DECISIONS.md#what-was-removed-or-deferred).

### The ball is the hard problem

The ball is a handful of pixels, frequently occluded, and the first thing platform compression
destroys. Two responses:

1. A **high-resolution tiled detection path** for the ball, separate from the whole-frame player
   pass, with temporal candidate aggregation across neighbouring frames.
2. **`ball_unknown` is a first-class output.** When the ball is not confidently detected, the
   system emits unknown. It never interpolates a plausible coordinate and presents it as an
   observation. Downstream possession and event logic must handle unknown explicitly, and a
   possession segment spanning a long unknown gap is itself low-confidence.

Training uses only DTP dataset versions. Every run records git commit, dataset version, config,
environment, weights checksum, and metrics in the model registry.

---

## Tracking and identity — Phase 4

Benchmark ByteTrack and BoT-SORT on DTP footage and choose empirically. Handheld grassroots
footage with pans and zooms behaves nothing like the broadcast footage these were tuned on.

Identity is built from evidence in this order:

1. **Team assignment** from kit appearance clustering, computed per match rather than globally,
   because kit colours repeat across competitions. Goalkeepers are handled separately — their kit
   is deliberately different and will cluster on its own.
2. **Jersey candidates** from the best crops **across a tracklet**, not single-frame OCR. A number
   visible for six frames out of two hundred is still a usable signal when aggregated.
3. **Roster constraint.** The squad is known from `SbTeamSquad` and `SbMatchSquadPlayer`. A number
   on a team maps to at most one player *in a given time window*.
4. **Time-awareness.** Substitutions and kit changes mean identity has `validFromMs` and
   `validToMs`. A number is not a permanent key.
5. **Human confirmation** before any public attribution.

**Face recognition is not the identity mechanism.** These are mostly minors. Identity is roster,
team, jersey, and track evidence.

**Unknown is preserved.** A low-confidence identity is recorded as unknown with its candidates
attached, never as a best guess. Wrong attribution of a goal to a fifteen-year-old is a
reputational harm that no accuracy metric compensates for.

---

## Calibration and game state — Phase 5

Normalized pitch: 105 × 68 by default, with actual dimensions stored when known — grassroots
pitches are frequently non-standard, and assuming 105 × 68 on a short pitch silently corrupts
every distance derived from it.

Per camera segment: detect pitch lines and keypoints, estimate homography, score reprojection
error. Camera cuts reset calibration rather than propagating a stale homography across the cut.

A calibration editor lets a human drag keypoints when the model fails — often enough on wide
handheld footage that the editor is a requirement, not a convenience.

**The suppression rule:** when calibration quality falls below threshold, every coordinate-derived
metric — distance, speed, zone entries, heatmap density — is **suppressed and labelled**, not
emitted with a caveat. Single-camera physical metrics look scientific and can be badly wrong. A
suppressed metric is honest; a wrong metric with a footnote is not.

---

## Possession and events — Phase 6

Ball trajectory smoothing with an explicit lost state. Possessor inference from distance,
temporal continuity, and football constraints, keeping uncertainty rather than resolving it early.

### Taxonomy

Versioned (`taxonomyVersion` on every candidate) and mapped to the existing ScoreBoard event
vocabulary in `SbMatchEvent.type` wherever a ScoreBoard type already exists. Start with events
that are both high value and actually observable:

`pass`, `carry`, `shot`, `cross`, `header`, `tackle`, `interception`, `recovery`, `clearance`,
`throw_in`, `corner`, `free_kick`, `save`, `goal_candidate`.

Expand only when review quality on the existing set supports it. A taxonomy that outruns review
capacity produces confident nonsense.

### Replay and non-play segmentation

`VisionCameraSegment` exists from Phase 1 precisely for this. A replayed goal must not become a
second goal. Events proposed inside `replay`, `intro`, or `halftime` segments are flagged and do
not promote. There is a required test scenario covering it.

### Evidence links

Every candidate stores `VisionEvidenceLink` rows to the tracks, detections, ball frames, and
calibration it was derived from. That is what makes the provenance drawer possible, and what makes
staleness propagation possible when an upstream object is corrected.

---

## Metrics — Phase 7

Every metric has a `VisionCalculationVersion` recording formula, units, prerequisites, confidence
requirements, and a code reference. A metric without a calculation version cannot be displayed.

Ship only metrics whose prerequisites are genuinely reliable:

| Ship early | Hold back |
|---|---|
| Heatmaps, zone occupancy | Top speed, sprint count |
| Progressive passes and carries | Total distance |
| Final-third and box entries | Acceleration profiles |
| Recoveries, defensive actions | Anything requiring metric-accurate coordinates |
| Shot involvements, 1v1 candidates | |

The right-hand column waits for wearable ground truth (Phase 9) or for calibration quality that
genuinely supports it. Publishing false precision would damage exactly the credibility DTP is
building.

**Staleness propagation:** rejecting or correcting an upstream event stamps every dependent metric
and highlight `staleAt` and queues recomputation. A corrected event must never leave a stale
number on a player's public profile.

---

## VLM — Phase 8

Managed API first. Self-hosting is a cost decision to make with real usage numbers.

Hard constraints:

- **Clips, not matches.** Short approved evidence windows plus structured context (player,
  position, event type, pitch coordinates), never a 90-minute upload.
- **Strict JSON output**, schema-validated. Fields: observation, demonstrated attribute,
  uncertainty, timestamp citations, evidence IDs. A response failing validation is discarded, not
  repaired.
- **No numeric authority.** A VLM may describe technique, decision-making, and context. It may
  never create or overwrite a touch count, a speed, a goal, an event label, or an identity.
  Enforced structurally: `VisionScoutingObservation` has no write path to any numeric or identity
  table.
- **Prompt injection is a real threat.** Scoreboard overlays, sponsor graphics, and match audio are
  attacker-controllable input. Treat all VLM output as untrusted data: validate the schema,
  reject unsupported claims, and never let a model response drive a side effect.
- **`promptVersion` and `modelVersionId` are stored** on every observation so it can be regenerated
  and compared.
- **A hallucination evaluation set exists** with known pass and fail cases, and runs before any
  prompt or model change ships.

Semantic search over approved clips only, rights-filtered per row at query time. Results are clip
IDs, timestamps, and evidence references — never a generated prose answer presented as fact.

---

## Model registry and reproducibility

Every `VisionModelVersion` records: git commit, dataset version, config object key, environment
and image tag, weights checksum, benchmark run, licence note, and model card.

Stages: `candidate` → `benchmarked` → `staging` → `production` → `archived`. Promotion rules are
in [10-EVALUATION-AND-GATES.md](./10-EVALUATION-AND-GATES.md).

**Reproducibility test:** a model must be rebuildable from git commit + dataset manifest + config +
image tag alone. If it cannot, it is not promotable. This is checked, not assumed.

MLflow and DVC are the intended tools for experiment tracking and artifact lineage, hosted
alongside the worker infrastructure — never on the EC2 control plane.

---

## Active learning

The correction loop is the product. Reviewer corrections rank the next annotation batch by:

- low model confidence;
- disagreement between stages (detector says ball, tracker disagrees);
- disagreement between reviewers;
- a new domain slice (new competition, new venue, unusual kit, first night match);
- business value (a match involving a player under active scouting interest).

`VisionActiveLearningItem` holds the queue. The measure of success is **correction time per hour
of footage trending down** while benchmark quality holds — not label count going up.

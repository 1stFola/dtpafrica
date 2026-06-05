# Competition & Tournament Template Engine

ScoreBoard competitions can be created from deterministic templates in `@dtp/engines`, persisted via Prisma, and administered under `/admin/scoreboard`.

## Formats

| Format | Status | Fixture generation |
|--------|--------|-------------------|
| `STANDARD_LEAGUE` | Complete | Round-robin, optional home/away |
| `KNOCKOUT_CUP` | Complete | Bracket from team list |
| `HYBRID_CHAMPIONS_LEAGUE` | Complete | Per-group round robin |
| `SINGLE_FRIENDLY_MATCH` | Complete | Single fixture |
| `JAGABAN_CUP_STANDARD` | Complete | 2×4 groups, 3 matchdays each |
| `COMBINATION_TOURNAMENT` | **Skeleton** | Stages documented; no auto fixtures |
| `CHALLENGE_LADDER` | **Skeleton** | Ladder rules documented; no auto fixtures |

### Jagaban Cup (`JAGABAN_CUP_STANDARD`)

- Config: `JagabanCupConfig` (`editionLabel`, `teamsPerGroup`, `groupLabels`, …)
- Progression: A1 vs B1 → Grand Final; A2 vs B2 → Third place; 3rd/4th eliminated
- Clone: `cloneJagabanConfigForEdition("Jagaban Cup 2027")` for new cycles
- Admin may rename the competition freely (`name` field independent of template)

## Schema

- `sb_competitions.format_type`, `format_config` (JSON)
- `sb_competition_stages` — stage definitions per competition
- `sb_teams.group_key` — `A` / `B` for group formats
- `sb_matches.stage_id`, `stage_key`, `matchday`, `meta` (ET, penalties, narrative)

Migration: `services/api/prisma/migrations/20260528120000_competition_templates/`

## API routes

**Public**

- `GET /api/v1/scoreboard/standings/:competitionId` — league or grouped rows when `formatType` is group-based
- `GET /api/v1/scoreboard/competitions/:competitionId/standings/groups`

**Admin** (`x-admin-api-key`)

- `GET /api/v1/admin/scoreboard/templates`
- `GET /api/v1/admin/scoreboard/templates/:format/preview`
- `POST /api/v1/admin/scoreboard/competitions/from-template`
- `GET /api/v1/admin/scoreboard/competitions/:id/standings/groups`

## Engine usage

```ts
import { generateFixtures, getCompetitionTemplate } from "@dtp/engines";

const fixtures = generateFixtures(competitionId, "JAGABAN_CUP_STANDARD", teams);
```

## Seed: Jagaban Cup 2026

```bash
pnpm db:push
pnpm db:seed
```

Browse: `/scoreboard/competition/jagaban-cup-2026`

### Group assignments (from fixtures)

**Group A:** SGFC Athletics, 36 Lions FC, FC Bethel, Klassisc FC  
**Group B:** Ikorodu City FC, Smart City FC, Mavlon FC, Broad City FC

### Computed standings (after group stage)

**Group A:** 1. FC Bethel (9 pts) · 2. 36 Lions FC (4) · 3. Klassisc FC (4, GD 0) · 4. SGFC (0)  
**Group B:** 1. Broad City FC (6) · 2. Ikorodu City FC (6, H2H loss) · 3. Mavlon FC (3) · 4. Smart City FC (3)

## Verify

1. `pnpm --filter @dtp/engines build && pnpm typecheck`
2. Admin → ScoreBoard → Entities → **Create competition** (preview progression before save)
3. `GET /api/v1/scoreboard/standings/<jagaban-competition-id>` — grouped tables with form column
4. `GET /api/v1/admin/scoreboard/competitions/:id/standings/groups` — same rows with `rank`

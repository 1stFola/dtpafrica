# ScoreBoard → Scouting player profile pipeline

Connects live tournament operations to permanent `Player` records and competition standings.

## Data model

| Model / field | Purpose |
|---------------|---------|
| `Player.normalizedName` | Stable directory lookup (`playerLookupKey` from `@dtp/engines`) |
| `Player.careerGoals`, `careerAssists`, `careerAppearances`, `careerMinutes`, `careerCleanSheets` | Cross-competition career totals |
| `SbPlayerCompetitionStats` | Per-competition goals, assists, appearances, minutes, clean sheets |
| `SbMatchEvent.metadata` | Canonical timeline extras (`source`, `squadId`, notes) |
| `SbCompetition.standingsSnapshot` | Cached output of `computeGroupStandings` after each finished match |

Migration: `services/api/prisma/migrations/20260528140000_scoreboard_player_pipeline/`

## Lifecycle services (`ScoreboardLifecycleService`)

- **`applyMatchEventToPlayerStats`** — on each posted event: goals → scorer + competition table; `assistPlayerId` → assist totals.
- **`onMatchFinished`** — idempotent via `stats.lifecycle.finishedProcessedAt`: XI appearances/minutes, GK clean sheets when opponent score is 0, then **`refreshCompetitionStandings`**.
- **`refreshCompetitionStandings`** — runs `CompetitionEngineService.groupStandings` and persists JSON snapshot on the competition.

## Roster lock gate

`assertMatchReadyForLiveEvents` (`roster-guard.ts`) blocks `POST /scoreboard/matches/:id/events` and live status transitions unless:

1. `stats.spotter.lineupsLocked === true` (spotter tablet or admin patch), and  
2. Both teams have matchday rosters with **11 starters** and **≥1 substitute** in `stats.matchdayRosters`.

Admin roster: `/admin/scoreboard/matches/:matchId/roster`  
Spotter: `/spotter-tablet` → lock lineups after rosters are saved.

## Player directory

`PlayerDirectoryService.resolveOrCreatePlayer` — used when saving matchday rosters and importing squad CSV. Creates draft `Player` rows (`registrationStatus: draft`, `isPublic: false`) when no normalized match exists.

## API routes (new / extended)

| Method | Path | Notes |
|--------|------|--------|
| GET | `/admin/scoreboard/competitions/:id/squad/export?format=json\|csv` | Calibration Engine V3 squad directory |
| POST | `/admin/scoreboard/teams/:teamId/squad/import` | CSV with `displayName`, `position`, `shirtNumber` |
| GET | `/admin/scoreboard/matches/:matchId/events` | Timeline SSOT list |
| POST | `/admin/scoreboard/matches/:matchId/events` | Same pipeline as spotter `POST /scoreboard/matches/:id/events` |
| DELETE | `/admin/scoreboard/matches/:matchId/events/:eventId` | Admin timeline edit |

Existing template flow already sets `matchday` + `stageId` on generated fixtures (`CompetitionEngineService.createFromTemplate`).

## Verification

```bash
pnpm --filter @dtp/engines build
pnpm --filter @dtp/api db:push   # or migrate deploy
pnpm typecheck
```

Manual:

1. Create competition from Jagaban template with fixtures.  
2. Import squad CSV for two teams; save matchday rosters (11+1 each).  
3. Lock lineups on spotter tablet; post a goal with `playerId`.  
4. Set match `finished` — check `SbCompetition.standingsSnapshot` and player career fields.  
5. Export squad JSON from Admin → ScoreBoard → Entities → Seeders.

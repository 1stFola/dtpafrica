# ScoreBoard — Phase 1 implemented

Operational and public football data: competitions, live matches, standings, highlights, supervisor tools, public browse, and integrated player/team links.

## Database (`sb_*` tables)

Separate from SIP `matches` (metrics ingestion). Models: `SbCompetition`, `SbTeam`, `SbTeamSquad`, `SbMatch`, `SbMatchEvent`, `SbHighlight`.

Narrow legacy-aligned additions:

- `SbCompetition.type` for tournament/league handling.
- `SbMatch.stats` JSON for public stat bars without introducing a full stats table yet.
- `SbMatchEvent.assistPlayerId` / `assistLabel` for assisted goals and secondary-player events.
- `SbHighlight.eventId` for tying clips back to timeline incidents.

Seed player can appear on a team squad (links DTP `players.id`).

## API (`/api/v1/scoreboard`)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/competitions` | Published competitions |
| GET | `/competitions/:slug` | Competition + teams |
| GET | `/teams/:id` | Public team profile, roster, recent matches |
| GET | `/search?q=` | Unified ScoreBoard search |
| GET | `/matches` | `?status=live` \| `scheduled` \| `finished`, `?competitionId=` |
| GET | `/matches/:id` | Match center (timeline) |
| GET | `/standings/:competitionId` | Points table (computed) |
| GET | `/highlights` | Published videos |
| GET | `/live-streams` | Published YouTube broadcasts for the Live Games page (`SbLiveStream`; admin CRUD under `/admin/scoreboard/live-streams`, permission `scoreboard.live.write`) |
| GET | `/supervisor/live` | Live matches for monitor |
| POST | `/matches/:id/events` | Add event (operator; auth later) |
| PATCH | `/matches/:id` | Update score / status / minute |

## Web (`/scoreboard`)

- **Overview** — live match cards + competitions
- **Live ribbon** — scrolling public scoreboard ribbon across ScoreBoard pages
- **Live** — admin-published YouTube broadcasts (embedded, muted autoplay) above the auto-refresh live list. A stream is its own record, not a match field, because a match only reads as live once a recorder kicks off or the roster guard is satisfied; a stream linked to a fixture publishes itself 5 minutes before kickoff and unpublishes at full time (`LiveStreamScheduleService`, a 30-second sweep), and the admin publishes any other stream by hand (`/admin/scoreboard/live-streams`). A manual unpublish during the game, or a republish after it, is left alone. Once a fixture's stream is down, the match centre shows a **Watch Recorded Video** button linking to it (`recorded-video.ts`; a link added to a finished match counts even if it never went up).
- **Browse** — unified search over competitions, teams, matches, and linked players
- **Jagaban Cup** — standings / teams / matchdays tabs
- **Team profile** — `/scoreboard/team/:id` roster, form, recent matches
- **Match center** — `/scoreboard/match/:id` timeline, assist links, stat bars, rosters, event-linked highlights
- **Highlights** — YouTube links with match/event linkage
- **Supervisor** — pick live match, record typed event, secondary player/assist, set HT/FT, trigger SIP ingest

## Seed

Competition **Jagaban Cup 2026** (`jagaban-cup-2026`):

- 4 teams, seeded roster rows, 2 finished + 1 **live** + 1 scheduled match
- Match stats JSON for public stat bars
- Events including seed player goals and assist labels
- 1 highlight clip linked to a live timeline event

## Run

```bash
pnpm db:push
pnpm db:seed
pnpm dev:api
pnpm dev
```

Open http://localhost:5173/scoreboard

## Admin ScoreBoard ops (`/admin/scoreboard`)

Migrated from legacy Trickle pages (removed from repo; see [03-PRODUCT-SCOREBOARD.md](./03-PRODUCT-SCOREBOARD.md)):

| Legacy page | New route |
|-------------|-----------|
| `admin-entities.html` | `/admin/scoreboard/entities` |
| `admin-roster.html` | `/admin/scoreboard/roster` |
| `admin-content.html` (highlights) | `/admin/scoreboard/highlights` |
| `admin-supervisor.html` (partial) | `/admin/scoreboard/match-center` + `/scoreboard/supervisor` |
| `spotter-tablet.html` | `/spotter-tablet` |

API prefix: `/api/v1/admin/scoreboard/*` (requires `x-admin-api-key`). Matchday rosters and spotter lineup lock are stored in `SbMatch.stats` JSON until dedicated tables exist.

## Legacy Gap Map

Implemented in this greenfield architecture:

- Public presentation: live ribbon, live cards, match center timeline/stats/rosters/highlights, competition standings/teams/matchdays, team roster/profile, unified browse.
- Data/schema: competitions, teams, squad rows, matches, events, event assists, match stats JSON, highlights, event-linked highlights.
- Ops/admin: authenticated supervisor/operator routes, event tagging, score/status updates, SIP ingest.
- Jagaban Cup: seeded competition type, matchday clustering through `roundLabel`, standings, roster and highlight samples.

Deferred deliberately:

- Offline-first spotter tablet and sync queue: useful, but larger than this additive pass and needs a real offline conflict model.
- Full lineup lock/substitution engine: current rosters support public lineups; match-specific starters should wait for operator workflow requirements.
- Standings QA/pending approval workflow: standings are computed from finished matches now; QA states need admin publishing rules.
- Entity management and roster submission: **skeleton shipped** under `/admin/scoreboard` (list/filter, CSV seed, roster save); full CRUD forms and approval workflows still deferred.
- Export/API partner console and PDF output: no existing scaffold; defer until partner feed requirements are known.
- WebSocket/SSE live push: polling remains adequate for the current greenfield demo.

See [03-PRODUCT-SCOREBOARD.md](./03-PRODUCT-SCOREBOARD.md).

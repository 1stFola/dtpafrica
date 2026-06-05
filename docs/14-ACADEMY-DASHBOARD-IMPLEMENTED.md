# Academy Dashboard — Phase 1 + light Phase 2 implemented

The Academy Dashboard is a read-only command centre for academy operators. It
reuses the existing DirectToPro player graph, ScoreBoard, SIP, MVCE, and public
profile media instead of creating parallel academy-only workflows.

## Chosen scope

- **Dashboard overview:** KPI cards, high-potential watchlist, and activity feed.
- **Squad:** filterable academy-linked player table with ratings, dominant foot,
  public status, development index, SIP fit, ScoreBoard exposure, and MVCE
  snippets.
- **Fixtures:** ScoreBoard match history inferred from teams that contain
  academy-linked players.
- **Development:** computed read-only development index from DTP ratings, SIP
  tactical fit, ScoreBoard exposure, and latest MVCE adjusted score.
- **Playing philosophy:** default read-only `4-3-3 / tiki_taka` academy lens plus
  existing SIP philosophy/tactical fit rows where available.
- **Market valuation:** latest MVCE valuations and aggregate value range.
- **Media library:** existing profile media, videos, photos, and ScoreBoard
  highlights.

## API (`/api/v1/academy`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/academy/dashboard` | First available academy dashboard (demo helper) |
| GET | `/academy/:slug/dashboard` | Full aggregate payload |
| GET | `/academy/:slug/squad` | Squad slice |
| GET | `/academy/:slug/fixtures` | ScoreBoard fixtures slice |
| GET | `/academy/:slug/development` | Development slice |
| GET | `/academy/:slug/philosophy` | Philosophy slice |
| GET | `/academy/:slug/valuation` | MVCE slice |
| GET | `/academy/:slug/media` | Media slice |

All endpoints are read-only.

## Web

- `/academy` keeps the public partner academy listing.
- `/academy/:slug/dashboard` opens the new dark academy workspace.
- Dashboard navigation: Dashboard, Squad, Fixtures, Development, Playing
  Philosophy, Market Valuation, Media Library, Settings.
- Player intelligence links reuse `/player/:slug`.
- Valuation drill-down links reuse `/valuation/player/:playerId`.
- Fixture drill-down links reuse `/scoreboard/match/:id`.

## Data model

Added one narrow relation:

- `Player.academyId -> Academy.players`

This is the minimum relationship needed to answer "which players belong to this
academy?" without duplicating squads, assessments, or media libraries.

Seed data links **ALLI O. SANNI** to `DTP Lagos Development Hub`; his existing
ScoreBoard squad row, SIP-ready metrics, MVCE valuation, and profile media
demonstrate the dashboard.

## Gap map

- **Already reusable:** public player profiles, media JSON/video URL, ScoreBoard
  teams/matches/events/highlights, SIP tactical scores/philosophy fit rows, MVCE
  valuation runs, admin academy CRUD.
- **Implemented now:** academy-player relation, read-only aggregate API, seeded
  academy link, dashboard UI, squad filters, fixture summaries, computed
  development index, philosophy/valuation/media surfaces.
- **Deferred:** full academy auth, academy-specific roles, training attendance
  imports, custom assessment CRUD, media upload/storage, AI tagging, CRM/social
  features, scout-view analytics. These need product/security/storage decisions.

## Auth note

The dashboard currently runs as a protected-ish demo/public workspace. Production
academy access should add academy-scoped users and roles instead of reusing the
browser-held admin API key.

## Run

```bash
pnpm --filter @dtp/api prisma:generate
pnpm --filter @dtp/api db:push
pnpm db:seed
pnpm dev:api
pnpm dev
```

Open http://localhost:5173/academy/dtp-lagos-hub/dashboard

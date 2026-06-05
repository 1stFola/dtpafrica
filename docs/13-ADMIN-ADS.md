# Admin ad placements

Sponsor slots are configured in the admin CMS and stored in Prisma `StaticContent`
under key `ads.config` (JSON). The public site loads settings at runtime from
`GET /api/v1/home/ads` and merges them with bundled fallback creatives in
`apps/web/src/config/adConfig.ts`.

## What admins control

Per slot (14 placements):

| Slot key | Where it appears |
|----------|------------------|
| `scoreboardLeaderboardDesktop` | ScoreBoard header (desktop) |
| `scoreboardLeaderboardMobile` | ScoreBoard header (mobile) |
| `scoreboardTop` | ScoreBoard — below subnav, all `/scoreboard/*` |
| `scoreboardLeft` | ScoreBoard — left rail (desktop ≥1200px) |
| `scoreboardRight` | ScoreBoard — right rail (desktop ≥1200px) |
| `matchCenterInline` | Match center page |
| `featuredPlayersInline` | Featured players grid (every 8 cards) |
| `scoutingTop` | Scouting — below subnav, all `/scouting/*` |
| `scoutingLeft` | Scouting — left rail (desktop ≥1200px) |
| `scoutingRight` | Scouting — right rail (desktop ≥1200px) |
| `scoutingDirectoryInline` | Tactical search table (every 8 rows) |
| `valuationTop` | Valuation — below subnav, all `/valuation/*` |
| `valuationLeft` | Valuation — left rail (desktop ≥1200px) |
| `valuationRight` | Valuation — right rail (desktop ≥1200px) |

### Module top / left / right rails

ScoreBoard, Scouting, and Valuation use `ModuleAdRails` in their layout components:

- **Top** — centered leaderboard (728×90) between module subnav and page content (`scoreboardTop`, `scoutingTop`, `valuationTop`).
- **Left / right** — half-page portrait (300×600 upload; displayed ~240×480), sticky beside page content.
- **ScoreBoard desktop** — only one top banner: `scoreboardTop` below subnav. Header `scoreboardLeaderboardDesktop` is deprecated (not rendered). Mobile uses `scoreboardLeaderboardMobile` in the header below 760px; `scoreboardTop` is hidden on mobile.
- **Responsive** — side rails use a **container query** on `.module-ad-shell` (hidden when the shell is narrower than 900px), not the global 1200px viewport rule — so rails still show on typical desktop widths inside `app-main`.

## Creative size requirements (IAB)

Frames are defined in `apps/web/src/styles/global.css` (`.ad-banner--*`).

| Format | Recommended px | Max width | IAB name | Used by slots |
|--------|----------------|-----------|----------|----------------|
| `leaderboard` | **728×90** | 728px | Leaderboard | Module tops, scoreboard header desktop |
| `square` | **300×600** (upload) | 300px | Half Page / Module Portrait | Module left/right rails |
| `mobile-banner` | **320×50** | 320px | Mobile Banner | Scoreboard header mobile |
| `inline` | **728×90** | 728px | Leaderboard (inline) | Match center, featured players, scouting search |

Per-slot reference:

| Slot key | Format | Upload size |
|----------|--------|-------------|
| `scoreboardLeaderboardDesktop` | leaderboard | 728×90 |
| `scoreboardLeaderboardMobile` | mobile-banner | 320×50 |
| `scoreboardTop` | leaderboard | 728×90 |
| `scoreboardLeft` | square | 300×600 |
| `scoreboardRight` | square | 300×600 |
| `matchCenterInline` | inline | 728×90 |
| `featuredPlayersInline` | inline | 728×90 |
| `scoutingTop` | leaderboard | 728×90 |
| `scoutingLeft` | square | 300×600 |
| `scoutingRight` | square | 300×600 |
| `scoutingDirectoryInline` | inline | 728×90 |
| `valuationTop` | leaderboard | 728×90 |
| `valuationLeft` | square | 300×600 |
| `valuationRight` | square | 300×600 |

In local dev, each banner shows a small “Recommended creative” hint under the frame.

## Demo mock creatives (seed / defaults)

Seeded `ads.config` and API defaults use **placehold.co** PNGs (HTTPS, hotlink-friendly, `Access-Control-Allow-Origin: *`). Safe for local demo only — not real advertising.

| Slot | Image URL |
|------|-----------|
| Scoreboard desktop | `https://placehold.co/728x90/1e40af/ffffff/png?text=728x90+Leaderboard` |
| Scoreboard mobile | `https://placehold.co/320x50/b45309/ffffff/png?text=320x50+Mobile+Banner` |
| Match center | `https://placehold.co/728x90/6d28d9/ffffff/png?text=728x90+Match+Center` |
| Featured players | `https://placehold.co/728x90/047857/ffffff/png?text=728x90+Featured+Players` |
| Scouting inline | `https://placehold.co/728x90/9a3412/ffffff/png?text=728x90+Scouting` |
| ScoreBoard top / left / right | cyan / teal placehold.co (see `ads-mock-creatives.ts`) |
| Scouting top / left / right | purple placehold.co |
| Valuation top / left / right | gold placehold.co |

Re-apply demo data: `pnpm db:seed` (upserts `ads.config` with all 14 slots).

For each slot:

- **Enabled** — when off, the slot is not rendered (no empty placeholder frame).
- **Format** — `leaderboard`, `square`, `mobile-banner`, or `inline`.
- **Destination URL** — click-through for the sponsor link.
- **Fallback image URL** — optional; empty uses bundled SVG placeholders.
- **Label** — optional text above the creative (default: “Advertisement”).
- **Placement notes** — admin-only documentation.

## API

- `GET /api/v1/home/ads` — public effective config (no auth).
- `GET /api/v1/admin/ads` — same shape + `updatedAt` (requires `x-admin-api-key`).
- `PATCH /api/v1/admin/ads` — body `{ "slots": { "<slotKey>": { ... } } }` (requires admin key).

## Admin UI

- **Page:** http://localhost:5173/admin/ads
- **Nav:** Admin → Ads
- **Auth:** same as other admin routes (`ADMIN_API_KEY` at `/admin/login`)

## Verification checklist

### 1. Prerequisites

1. API running: `pnpm dev:api` (from repo root).
2. Web running: `pnpm dev`.
3. `ADMIN_API_KEY` set in `services/api/.env` (see `.env.example`).
4. Database up (`pnpm db:up`) and migrated/seeded if needed.

### 2. API smoke test

```bash
# Public (no key)
curl -s http://localhost:3000/api/v1/home/ads | head -c 400

# Admin (replace with your key)
curl -s -H "x-admin-api-key: dtp-dev-admin-1" http://localhost:3000/api/v1/admin/ads

# Disable a slot (example: ScoreBoard left rail)
curl -s -X PATCH http://localhost:3000/api/v1/admin/ads \
  -H "Content-Type: application/json" \
  -H "x-admin-api-key: dtp-dev-admin-1" \
  -d "{\"slots\":{\"scoreboardLeft\":{\"enabled\":false}}}"
```

Expect `scoreboardLeft.enabled` to be `false` in the PATCH response and in a
follow-up `GET /home/ads`.

### 3. Admin UI

1. Open http://localhost:5173/admin/login and enter your admin key.
2. Go to **Ads** (or http://localhost:5173/admin/ads).
3. Uncheck **Enabled** on a slot (e.g. “ScoreBoard left rail”) → **Save ad placements**.
4. Hard-refresh the matching public page and confirm the placement is hidden.
5. Re-enable the slot, set a custom **Destination URL**, save, click the ad — confirm navigation.

### 4. Placement spot checks

| URL | What to check |
|-----|----------------|
| `/` or `/about`, `/blog`, `/contact` | No app-shell sidebar ad (full-width main) |
| `/scoreboard` (≥1200px) | Top teal banner + left/right rails + header leaderboards |
| `/scoreboard/browse`, `/scoreboard/live`, `/scoreboard/competition/jagaban-cup-2026` | Same module rails on all child routes |
| `/scoreboard/match/<id>` | Rails + inline slot below match header |
| `/scouting` (≥1200px) | Purple top + left/right rails on hub, Strong XI, philosophy, compare |
| `/scouting/search` | Rails + inline row every 8 results |
| `/valuation` (≥1200px) | Gold top + left/right on overview, generate, compare |
| `/valuation/player/<id>` | Module rails on player dashboard |
| `/featured-players` | Inline ad in grid when enough players |

### 5. Typecheck

```bash
pnpm --filter @dtp/api typecheck
pnpm --filter @dtp/web typecheck
```

## Run

See [12-ADMIN-CMS-IMPLEMENTED.md](./12-ADMIN-CMS-IMPLEMENTED.md) for admin auth and local URLs.

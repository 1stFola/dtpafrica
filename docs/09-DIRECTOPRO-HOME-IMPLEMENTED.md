# DirectToPro Home — Phase 1 implemented

Public marketing pages and Home API (content + player profiles).

## Public routes

| Route | Page |
|-------|------|
| `/` | Landing + featured preview |
| `/featured-players` | Featured player grid |
| `/player/:slugOrId` | Public profile + rich ratings, media tabs, tactical snapshot |
| `/register` | Registration (guardian fields if under 18) |
| `/academy` | Partner academies |
| `/blog`, `/blog/:slug` | News posts |
| `/about` | Mission / vision (CMS static content) |
| `/contact` | Contact form + email / WhatsApp |
| `/comparison` | Redirects to `/scouting/compare` |

## API (`/api/v1/home`)

| Method | Path |
|--------|------|
| GET | `/home/featured-players` |
| GET | `/home/players/:slugOrId` |
| POST | `/home/register` |
| POST | `/home/contact` |
| GET | `/home/blog` |
| GET | `/home/blog/:slug` |
| GET | `/home/academies` |
| GET | `/home/content?keys=about.mission,...` |

## Database

New tables: `blog_posts`, `academies`, `static_content`, `contact_messages`.

Player fields: `slug`, `is_featured`, `is_public`, `registration_status`, guardian fields, `city`, `state`, `rating_attributes`, `benchmark_metadata`, `media_items`, `scouting_summary`.

## Player profile legacy mapping

- Current public profiles stay URL-based and public; legacy session-based player access is intentionally not reintroduced.
- The profile header now includes rating pills, star tier, share link, verified notice, and generated scouting summary fallback.
- Attribute tabs render the 18 legacy calibration attributes when present, or derive a graceful fallback from overall/offensive/defensive/tactical scores for older profiles.
- Calibration saves `rating_attributes` and nearest-pro `benchmark_metadata`; profiles show benchmark comparison when those fields exist and a clear empty state when they do not.
- Videos, photos, and media are URL-backed through `media_items` with empty states until upload/storage workflows are added.

## Seed

- Featured public player: **ALLI O. SANNI** → `/player/alli-o-sanni` with sample attributes, benchmark metadata, scouting summary, and highlight media.
- 2 blog posts, 2 academies, static about/contact copy

After seed, run SIP recalculate for tactical scores on the profile:

```http
POST /api/v1/sip/players/00000000-0000-4000-8000-000000000001/recalculate
```

## Run

```bash
pnpm db:push
pnpm db:seed
pnpm dev:api
pnpm dev
```

## Not in this phase

- `/admin/*` CMS
- Server auth for club portal / player login; future access control should be partner-gated profiles rather than legacy public-player sessions.
- Media upload to S3/R2 (URLs only)

See [02-PRODUCT-DIRECTOPRO-HOME.md](./02-PRODUCT-DIRECTOPRO-HOME.md) for full target scope.

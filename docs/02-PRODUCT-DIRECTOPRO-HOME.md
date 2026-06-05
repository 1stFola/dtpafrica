# Product: DirectToPro Home (www — public & CMS)

Former codebase: `Home/` (Trickle export). This document defines **what to rebuild**, not what to keep.

## Purpose

The **public face of DTP Africa**: trust, storytelling, talent discovery, registration, and lightweight content management—without exposing internal ops tools (those live in ScoreBoard / SIP / MVCE or a unified **Admin** area).

## Audiences

| Audience | Goals |
|----------|--------|
| Players & parents | Register, understand pathway, view consent/legal |
| Scouts & clubs | Browse featured players, open shareable profiles, contact DTP |
| Academies | Discover partnership, view academy listings |
| DTP staff | Manage content, players, banners, blog (CMS) |

## Public routes (target)

| Route | Feature |
|-------|---------|
| `/` | Landing: hero, mission, CTAs (“Register talent”, “Featured players”) |
| `/featured-players` | Grid of verified player cards |
| `/player/:slugOrId` | Public profile: card, attributes, video, scouting summary |
| `/register` | Registration flow (age-gated; guardian fields for minors) |
| `/academy` | Academy listings |
| `/blog`, `/blog/:slug` | News / announcements |
| `/about` | Vision, mission, team, compliance |
| `/contact` | WhatsApp, email form, social |
| `/comparison` | Entry to SIP comparison (or redirect to `/scouting/compare`) |
| `/club-portal`, `/club-dashboard` | Club-facing views (authenticated) |
| `/player-auth` | Player login (credentials server-validated) |

## Admin / CMS (target)

Consolidate legacy `door.html` + `inside.html` + `admin.html` into **one authenticated admin app** under e.g. `/admin/*`:

| Area | Legacy reference | Rebuild capability |
|------|------------------|-------------------|
| Players | `inside-app.js`, CSV import | CRUD, publish/featured, ratings display fields |
| Homepage | `HomepageTab.js` | Announcements, event sales, wins wall, featured video |
| Blog | blog tabs | Draft/publish |
| Academies | `AcademiesTab.js` | Academy CRUD |
| Static content | `StaticContentTab.js` | Key/value site copy |
| Users & credentials | `UsersTab.js`, player credentials | **Server auth only**; hashed passwords |
| Inbox | `contact_message` collection | Contact submissions |
| Settings | `SettingsTab.js` | Site config |

## Data owned by this module

| Domain object | Notes |
|---------------|--------|
| `Player` (marketing fields) | Name, DOB, position, media URLs, featured flag, public slug |
| `PlayerProfile` (display) | Ratings snapshot for card (sourced from SIP, not edited blindly in CMS) |
| `BlogPost` | |
| `HomepageAnnouncement`, `EventSale`, `WinsWallLogo`, `FeaturedVideo` | |
| `Academy` | |
| `StaticContent` | |
| `ContactMessage` | |
| `MediaAsset` | Replace Trickle JSON asset blobs with real storage (S3/R2 + CDN URLs) |

## Legacy collections (Trickle `seed.json` — migrate, don’t copy runtime)

`player`, `static_content`, `blog_post`, `homepage_announcement`, `event_sale`, `wins_wall_logo`, `featured_video`, `academy`, `academy_video`, `contact_message`, `admin_user`, `player_access_credentials`

Use `Home/data/seed.json` only as **sample import** during migration.

## Custom logic worth re-implementing (not copy-pasting)

| Legacy file | Rebuild as |
|-------------|------------|
| `utils/csvParser.js` | `packages/domain` import pipeline + API |
| `utils/scoutingSummaryGenerator.js` | SIP service or template engine |
| `components/PlayerCard.js` | `packages/ui` PlayerCard |
| `utils/dateUtils.js` | shared util |

## Explicitly out of scope for Home module

- Live match supervision → **ScoreBoard**
- Calibration / raw→calibrated ratings → **SIP**
- Market value bands → **MVCE**
- Trickle CDN, `trickle-shim`, `localStorage` document store

## Non-functional requirements

- WCAG-aware public pages; fast LCP (no runtime Babel).
- FIFA/youth consent: downloadable PDFs, privacy policy, guardian flows.
- Public player URLs shareable (`/player/ali-sanni-xyz`).
- SEO meta per page (replace duplicated Trickle HTML heads with a layout).

## Success criteria

- Marketing site works with **API + CDN assets** only.
- CMS changes appear on public site within seconds (cache invalidation).
- No secrets in frontend; admin uses real login.

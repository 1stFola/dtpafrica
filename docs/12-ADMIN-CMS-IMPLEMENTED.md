# Admin CMS — Current implementation

Unified `/admin` CMS for publishing current-platform content. This is not a
line-by-line port of the legacy Trickle `inside.html` portal; legacy concepts
are mapped only where they fit the NestJS + Prisma + React architecture.

## Auth (interim)

- Server: `ADMIN_API_KEY` in `services/api/.env`
- Client sends header `x-admin-api-key` on all `/api/v1/admin/*` requests
- Admin UI stores key in `sessionStorage` after login at `/admin/login`

**Production:** replace with real sessions/JWT and role-based access — do not rely on a long-lived key in the browser.

Default dev key (see `.env.example`):

```
ADMIN_API_KEY=dtp-dev-admin-change-me
```

## API (`/api/v1/admin`)

- `GET /admin/session` verifies the admin key.
- `GET /admin/stats` returns player, blog, inbox, and academy counts.
- `GET /admin/inbox` lists contact messages with `status` and `q` filters.
- `GET /admin/inbox/:id` reads a message.
- `PATCH /admin/inbox/:id/read` marks a message read or unread.
- `PATCH /admin/inbox/:id/archive` archives or restores a message.
- `DELETE /admin/inbox/:id` permanently deletes a message.
- `GET /admin/players` lists players with `q` and `status` filters.
- `PATCH /admin/players/:id` updates publish/featured/status/profile fields.
- `GET /admin/academies`, `POST /admin/academies`, `PUT /admin/academies/:id`,
  and `DELETE /admin/academies/:id` manage partner academies.
- `GET /admin/blog`, `POST /admin/blog`, `PUT /admin/blog/:id`,
  `PATCH /admin/blog/:id/publish`, and `DELETE /admin/blog/:id` manage posts.
- `GET /admin/content` and `PUT /admin/content/:key` manage reusable copy.

## Web (`/admin`)

- `/admin/login`: API key sign-in.
- `/admin`: dashboard stats and quick links.
- `/admin/inbox`: list, filter, view, mark read/unread, archive/restore, delete
  contact messages.
- `/admin/players`: search/filter, approve/reject, featured/public toggles,
  rating visibility, profile/calibration links, and CSV export.
- `/admin/calibration`: create or update player calibration from structured
  metrics.
- `/admin/homepage`: managed homepage hero, announcements, event sales card,
  featured video link, and wins wall logos.
- `/admin/academies`: create, edit, publish/unpublish, and delete partner
  academies.
- `/admin/blog`, `/admin/blog/new`, `/admin/blog/:id`: create, edit, publish,
  draft, and delete posts.
- `/admin/content`: edit arbitrary static content keys.

## Public impact

- **Featured** + **Public** → `/featured-players` and `/player/:slug`
- **Blog published** → `/blog` and `/blog/:slug`
- **Academy published** → `/academy`
- **Static content** → homepage hero and reusable marketing copy from `/home/content`
- **Homepage managed sections** → announcement, event sales, featured video, and
  wins wall render on `/` when their `*.enabled` keys are set to `true`
- **Registration approved** → player can be marked public when ready

## Legacy-to-current gap map

- Already covered: API-key gated admin shell, dashboard counts, player
  publish/featured controls, blog CRUD, calibration tooling, academies public
  listing, static content editing, contact form ingestion.
- Implemented in this pass: inbox/contact message operations, admin academy
  CRUD, managed homepage announcement/event/video/wins-wall sections, player CSV
  export and expanded rating visibility.
- Deferred intentionally: production users, roles, password/account management,
  audit logs, media upload/storage, sponsor-specific workflows, bulk player CSV
  imports, academy training-video libraries, and player access credentials.
  These need security, storage, permissions, and product decisions rather than a
  shallow port from browser-local legacy CRUD.

## Run

1. Set `ADMIN_API_KEY` in `services/api/.env` (restart API).
2. Open http://localhost:5173/admin/login
3. Enter the same key.

See [02-PRODUCT-DIRECTOPRO-HOME.md](./02-PRODUCT-DIRECTOPRO-HOME.md) for full CMS target.

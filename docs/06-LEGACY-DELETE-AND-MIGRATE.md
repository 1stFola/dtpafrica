# Legacy teardown — what to delete, what to keep, when to do it

**Do not delete until you have:**

1. Read this doc and the product docs in `docs/`.
2. Copied anything you want into `docs/` or `docs/specs/` (optional archive).
3. Confirmed you are ready for a **greenfield scaffold** (next coding phase).

---

## Summary

| Action | Path |
|--------|------|
| **DELETE entire folder** | `Home/` |
| **DELETE entire folder** | `ScoreBoard project/` |
| **DELETE entire folder** | `platform/` |
| **KEEP** | `docs/` (new documentation) |
| **KEEP** | `docs/specs/SCOUTING_INTELLIGENCE_PLATFORM.md` (official SIP spec) |
| **KEEP & move** | `DTP_Market_Value_Confidence_Engine_Documentation.pdf` → `docs/specs/` |
| **CREATE next** | `apps/`, `packages/`, `services/` (empty scaffold — not done yet) |

Everything under `Home/`, `ScoreBoard project/`, and `platform/` is either **Trickle AI export** or **interim patches on that export** (`trickle-shim`, Trickle-compat API, API-key security). None of it should remain as the foundation for www.dtp.africa.

---

## Why each legacy root goes

### `Home/` — Trickle DirectToPro export

- 17+ HTML pages loading **React + Babel from `resource.trickle.so`** and **Tailwind CDN**.
- Data via **`api/trickle-shim.js`** → `localStorage` + `data/seed.json` or patched REST.
- **`Home/trickle/`** — Trickle metadata only (notes, asset JSON); not used at runtime.
- Admin auth via **client `localStorage`** and legacy door flow — not production-safe.
- **Patches to remove:** `api/trickle-shim.js`, `api/dtp-config.js`, all HTML script tag wiring for those files.

### `ScoreBoard project/` — Trickle ScoreBoard export

- 18 HTML pages, same CDN/Babel pattern.
- **`data/mockData.js`** + **`window.DB`** + client **`window.Auth`**.
- **`ScoreBoard project/trickle/`** — notes/assets only.
- No connection to real `scoreboard-api` implementation.

### `platform/` — interim Java monorepo (not Trickle, but built on Trickle data model)

- **`directopro-api`**: `/api/v1/trickle/*` document store mimicking Trickle — **wrong abstraction** for greenfield.
- **`scoreboard-api`**: stub (`/api/v1/info` only).
- **`platform-common`**: minimal; will be recreated in new repo layout.
- **Patches to remove:** `TrickleCompatController`, `TrickleEntityRepository`, `SeedLoader`, `AllowedCollections`, `ApiKeyAuthFilter`, `SecurityConfig` (Trickle-shaped), duplicated `seed.json`, `schema.sql` for `dtp_entities`.

---

## Optional archive before delete (recommended)

If you want historical reference without keeping Trickle code:

```text
docs/archive/
  legacy-seed-directopro.json     ← copy from Home/data/seed.json
  legacy-notes-home/              ← copy Home/trickle/notes/*.md
  legacy-notes-scoreboard/        ← copy ScoreBoard project/trickle/notes/*.md
  specs/
    DTP_Market_Value_Confidence_Engine_Documentation.pdf
```

**Engines to reimplement from logic (not copy files):**

| Source | Target in new repo |
|--------|-------------------|
| `Home/calibration-engine.js` + `calibration-data.js` | `packages/engines/calibration` |
| `Home/utils/ratingEngine.js` | `packages/engines/match-rating` |
| `Home/utils/matchDataCsvParser.js` | `packages/domain/import` |
| `Home/utils/scoutingSummaryGenerator.js` | `packages/engines/scout-summary` |
| MVCE PDF | `packages/engines/mvce` |

---

## Delete commands (PowerShell)

Run from repo root **only when ready**:

```powershell
cd "c:\Users\bioni\OneDrive\Desktop\DTP\dtp.africa"

# 1) Preserve PDF (if not already under docs/specs)
New-Item -ItemType Directory -Force -Path "docs\specs"
Move-Item -Force "DTP_Market_Value_Confidence_Engine_Documentation.pdf" "docs\specs\" -ErrorAction SilentlyContinue

# 2) Remove legacy code trees
Remove-Item -Recurse -Force "Home"
Remove-Item -Recurse -Force "ScoreBoard project"
Remove-Item -Recurse -Force "platform"
```

**After deletion, repo should contain roughly:**

```text
dtp.africa/
  docs/
  docs/specs/DTP_Market_Value_Confidence_Engine_Documentation.pdf
  (optional docs/archive/...)
```

---

## Authoritative specs (keep under `docs/specs/`)

- `SCOUTING_INTELLIGENCE_PLATFORM.md` — full SIP product (tactical engines, DB, APIs, UI)
- `DTP_Market_Value_Confidence_Engine_Documentation.pdf` — MVCE

Legacy `Home/trickle/notes/` and `calibration-engine.js` are **superseded** by the SIP spec for greenfield build; archive only if you want historical calibration notes.

---

## Greenfield scaffold (next coding phase — after delete)

When you confirm deletion, the next implementation step is:

1. Initialize monorepo (`pnpm` workspaces or Maven + npm hybrid).
2. `apps/web` — Vite + React + TypeScript router: `/`, `/scoreboard/*`, `/scouting/*`, `/valuation/*`, `/admin/*`.
3. `packages/ui`, `packages/domain`, `packages/engines`.
4. `services/api` — single API with modules `directopro`, `scoreboard`, `sip`, `mvce` (PostgreSQL).
5. Auth (OIDC or email/password + JWT + RBAC).
6. Migrate sample data from archived `legacy-seed-directopro.json` via import script.

**Reply with:** “approved delete” (or run the commands yourself), then we scaffold code without Trickle.

---

## Checklist

- [x] Read `docs/01-PLATFORM-VISION.md`
- [ ] Archive seed + notes if desired (optional — legacy folders removed)
- [x] MVCE PDF in `docs/specs/`
- [x] Deleted `Home/`, `ScoreBoard project/`, `platform/` (approved)
- [x] Greenfield scaffold: `apps/web`, `packages/*`, `services/api`, `infra/`

## After delete — run locally

```bash
pnpm install
pnpm dev
```

Open http://localhost:5173

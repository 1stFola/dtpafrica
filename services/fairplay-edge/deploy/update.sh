#!/usr/bin/env bash
# DTP FairPlay Edge — controlled update (Phase 6.1; docs/fairplay/edge-install.md).
#
#   git fetch && git checkout <release tag>          # and build or ship its console
#   sudo deploy/update.sh [--force]
#
# Run from services/fairplay-edge. It:
#   1. puts the stack in maintenance, so the watchdog leaves it alone;
#   2. refuses to go on if MediaMTX's pinned image changes while a session is open, because
#      restarting MediaMTX costs about 3 s of every camera (5.2 D3); --force overrides;
#   3. backs up the Edge's database (SQLite's online backup) to data/backups/;
#   4. builds dtp-fairplay-edge:<version>-<commit> and restarts the Edge on it (and MediaMTX
#      only if its image changed). MediaMTX keeps recording while the Edge restarts;
#   5. waits for the Edge to be healthy; if it is not within UPDATE_HEALTH_SECONDS (120),
#      puts the old image and the backed-up database back, and says so;
#   6. ends maintenance.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
FORCE=0
[ "${1:-}" = "--force" ] && FORCE=1
WAIT="${UPDATE_HEALTH_SECONDS:-120}"

say() { printf '\n== %s\n' "$*"; }
die() { printf 'update: %s\n' "$*" >&2; bash deploy/maintenance off >/dev/null; exit 1; }
get_env() { sed -n "s/^$2=//p" "$1" | tr -d '\r' | tail -n 1; }
set_env() {
  local tmp; tmp="$(mktemp)"
  if grep -qE "^$2=" "$1"; then awk -v k="$2" -v v="$3" '$0 ~ "^" k "=" { print k "=" v; next } { print }' "$1" > "$tmp"
  else { cat "$1"; printf '%s=%s\n' "$2" "$3"; } > "$tmp"; fi
  cat "$tmp" > "$1" && rm -f "$tmp"
}
healthy_within() {
  local health=""
  for _ in $(seq 1 $(( $1 / 2 ))); do
    health="$(docker compose ps --format '{{.Health}}' edge 2>/dev/null || true)"
    [ "$health" = "healthy" ] && return 0
    sleep 2
  done
  return 1
}

[ -f .env ] || die "no .env here: install first (deploy/install.sh)"
OLD_TAG="$(get_env .env FAIRPLAY_EDGE_TAG)"
VERSION="$(tr -d '\r' < pyproject.toml | sed -n 's/^version *= *"\(.*\)"/\1/p' | head -n 1)"
NEW_TAG="${VERSION}-$(git rev-parse --short HEAD 2>/dev/null || echo local)"
[ "$OLD_TAG" = "$NEW_TAG" ] && { echo "already on dtp-fairplay-edge:$NEW_TAG"; exit 0; }

bash deploy/maintenance on "update $OLD_TAG -> $NEW_TAG" >/dev/null
say "Updating dtp-fairplay-edge:$OLD_TAG to :$NEW_TAG"

# ── 2. MediaMTX ──────────────────────────────────────────────────────────────
running_mtx="$(docker inspect --format '{{.Config.Image}}' "$(docker compose ps -q mediamtx)" 2>/dev/null || true)"
pinned_mtx="$(docker compose config --images | grep '^bluenviron/mediamtx' || true)"
MTX_CHANGES=0
[ -n "$running_mtx" ] && [ "$running_mtx" != "$pinned_mtx" ] && MTX_CHANGES=1
if [ "$MTX_CHANGES" = 1 ]; then
  open="$(docker compose exec -T edge fairplay-edge api GET /edge/v1/sessions 2>/dev/null | grep -cE '"ended_utc": ?null' || true)"
  if [ "${open:-0}" != 0 ] && [ "$FORCE" = 0 ]; then
    die "MediaMTX's image changes ($running_mtx -> $pinned_mtx) and a session is open: update after the match, or --force"
  fi
  echo "MediaMTX changes: $running_mtx -> $pinned_mtx (restarted after the Edge)"
fi

# ── 3. the database ──────────────────────────────────────────────────────────
say "Backing up the Edge database"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP="/var/lib/fairplay/data/backups/edge-$STAMP-$OLD_TAG.sqlite3"
docker compose exec -T edge python - "$BACKUP" <<'PY' || die "the backup failed: nothing was changed"
import os, sqlite3, sys
os.makedirs(os.path.dirname(sys.argv[1]), exist_ok=True)
src = sqlite3.connect("/var/lib/fairplay/data/edge.sqlite3")
dst = sqlite3.connect(sys.argv[1])
src.backup(dst)
dst.close()
print("backed up to", sys.argv[1])
PY

# ── 4. the new image ─────────────────────────────────────────────────────────
say "Building and starting :$NEW_TAG"
set_env .env FAIRPLAY_EDGE_TAG "$NEW_TAG"
docker compose build init || { set_env .env FAIRPLAY_EDGE_TAG "$OLD_TAG"; die "the build failed: still on :$OLD_TAG"; }
docker compose up -d --no-deps init >/dev/null 2>&1 || true
docker compose up -d --no-deps edge
[ "$MTX_CHANGES" = 1 ] && docker compose up -d --no-deps mediamtx

# ── 5. healthy, or back ──────────────────────────────────────────────────────
if healthy_within "$WAIT"; then
  bash deploy/maintenance off >/dev/null
  say "Updated to dtp-fairplay-edge:$NEW_TAG (database backup: $BACKUP)"
  exit 0
fi

say "The Edge is not healthy on :$NEW_TAG: rolling back to :$OLD_TAG"
docker compose logs --tail 40 edge || true
set_env .env FAIRPLAY_EDGE_TAG "$OLD_TAG"
docker compose stop edge
docker compose run --rm --no-deps -T --entrypoint python edge - "$BACKUP" <<'PY'
import os, shutil, sys
db = "/var/lib/fairplay/data/edge.sqlite3"
for suffix in ("-wal", "-shm"):
    if os.path.exists(db + suffix):
        os.remove(db + suffix)
shutil.copyfile(sys.argv[1], db)
print("restored", sys.argv[1])
PY
docker compose up -d --no-deps edge
if healthy_within "$WAIT"; then
  bash deploy/maintenance off >/dev/null
  echo "rolled back: running dtp-fairplay-edge:$OLD_TAG with the database as it was before the update"
  exit 3
fi
# Left in maintenance on purpose: the watchdog must not keep restarting a broken Edge.
printf 'update: the rollback is not healthy either; the stack is left in maintenance (docs/fairplay/edge-install.md)\n' >&2
exit 1

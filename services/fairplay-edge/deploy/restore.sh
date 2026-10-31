#!/usr/bin/env bash
# DTP FairPlay Edge — restore a backup (Phase 6.2; docs/fairplay/edge-backup.md).
#
#   deploy/install.sh ...                                            # on a clean machine, first
#   sudo deploy/restore.sh <backup.tar.gz> [--config <config.tar.gz>] [--replace]
#
# Run from services/fairplay-edge, never during a match. It:
#   1. checks the backup against the .sha256 beside it, if there is one;
#   2. puts the stack in maintenance and stops it (a restore while recording would lose footage);
#   3. with --config, puts back this host's .env, publish.env, sources.toml and auth/, keeping
#      the image tag this machine built;
#   4. restores: the Edge checks every file first and refuses, changing nothing, if anything is
#      wrong or if it already holds a record and --replace was not given. --replace moves that
#      record to data/backups/before-restore-<stamp>/;
#   5. starts the stack, waits for it to be healthy, and ends maintenance.
# Exit: 0 restored, 2 refused and running as before, 1 restored but not sound or not healthy,
# which leaves the stack in maintenance for a person.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
say() { printf '\n== %s\n' "$*"; }
die() { printf 'restore: %s\n' "$*" >&2; exit "${2:-1}"; }
get_env() { sed -n "s/^$2=//p" "$1" | tr -d '\r' | tail -n 1; }

BACKUP="" CONFIG="" REPLACE=()
while [ $# -gt 0 ]; do
  case "$1" in
    --config) [ $# -ge 2 ] || die "--config needs a file" 2; CONFIG="$2"; shift 2 ;;
    --replace) REPLACE=(--replace); shift ;;
    -*) die "unknown option: $1" 2 ;;
    *) BACKUP="$1"; shift ;;
  esac
done
[ -n "$BACKUP" ] || die "usage: deploy/restore.sh <backup.tar.gz> [--config <config.tar.gz>] [--replace]" 2
[ -f "$BACKUP" ] || die "no such file: $BACKUP" 2
[ -z "$CONFIG" ] || [ -f "$CONFIG" ] || die "no such file: $CONFIG" 2
[ -f .env ] || die "no .env here: install first (deploy/install.sh)" 2

matches_sums() {  # file, its .sha256
  ( cd "$(dirname "$1")" && awk -v n="$(basename "$1")" '$2 == n || $2 == "*" n' "$(basename "$2")" | sha256sum -c --quiet - ) \
    || die "$(basename "$1") does not match its .sha256: nothing was changed" 2
}
SUMS="${BACKUP%.tar.gz}.sha256"
if [ -f "$SUMS" ]; then
  matches_sums "$BACKUP" "$SUMS"
  echo "the backup matches its .sha256"
else
  echo "no .sha256 beside the backup: the Edge still checks every file's own hash"
fi
if [ -n "$CONFIG" ]; then
  [ -f "${CONFIG%-config.tar.gz}.sha256" ] || die "no .sha256 beside $CONFIG: its settings would go unchecked" 2
  matches_sums "$CONFIG" "${CONFIG%-config.tar.gz}.sha256"
fi

bash deploy/maintenance on "restore of $(basename "$BACKUP")" >/dev/null
say "Stopping the stack"
docker compose stop edge mediamtx

if [ -n "$CONFIG" ]; then
  say "Putting back this host's configuration"
  TAG="$(get_env .env FAIRPLAY_EDGE_TAG)"
  umask 077
  tar -xzf - --no-same-owner < "$CONFIG"
  tmp="$(mktemp)"
  awk -v v="$TAG" '/^FAIRPLAY_EDGE_TAG=/ { print "FAIRPLAY_EDGE_TAG=" v; next } { print }' .env > "$tmp"
  cat "$tmp" > .env && rm -f "$tmp"
fi

say "Restoring"
code=0
docker compose run --rm --no-deps -T edge restore "${REPLACE[@]+"${REPLACE[@]}"}" < "$BACKUP" || code=$?
if [ "$code" = 2 ]; then
  docker compose up -d >/dev/null
  bash deploy/maintenance off >/dev/null
  die "refused, and nothing in the record was changed: the stack is running as it was" 2
fi

say "Starting the stack"
docker compose up -d
health=""
for _ in $(seq 1 $(( ${RESTORE_HEALTH_SECONDS:-120} / 2 ))); do
  health="$(docker compose ps --format '{{.Health}}' edge 2>/dev/null || true)"
  [ "$health" = "healthy" ] && break
  sleep 2
done
[ "$health" = "healthy" ] || die "the Edge is not healthy after the restore: left in maintenance (docs/fairplay/edge-backup.md)"
[ "$code" = 0 ] || die "restored, but the record is not sound (see above): left in maintenance (docs/fairplay/edge-backup.md)"
bash deploy/maintenance off >/dev/null
say "Restored. No clip leaves this Edge until it has asked the cloud what was withdrawn since the backup (docs/fairplay/edge-backup.md)"

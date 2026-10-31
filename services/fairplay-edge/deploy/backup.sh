#!/usr/bin/env bash
# DTP FairPlay Edge — back up the Edge's record (Phase 6.2; docs/fairplay/edge-backup.md).
#
#   sudo deploy/backup.sh /mnt/fairplay-backups
#
# Run from services/fairplay-edge, with the Edge running; a match may be on. Point it at
# another disk, encrypted: a backup holds clips, the database and the Edge's private keys.
# It writes, each 0600:
#   fairplay-edge-<stamp>.tar.gz          the record: database, manifests, clips, TLS, bundle
#   fairplay-edge-<stamp>-config.tar.gz   this host's .env, publish.env, sources.toml, auth/
#   fairplay-edge-<stamp>.sha256          both files' hashes
# Recordings are not in a backup. Nothing is deleted: which backups to keep is edge-backup.md's
# rule, because an older backup still holds any clip withdrawn since.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
die() { printf 'backup: %s\n' "$*" >&2; exit 1; }

OUT="${1:-}"
[ -n "$OUT" ] || die "usage: deploy/backup.sh <folder on another disk>"
[ -d "$OUT" ] || die "no such folder: $OUT"
[ -f .env ] || die "no .env here: install first (deploy/install.sh)"
[ -n "$(docker compose ps -q --status running edge 2>/dev/null || true)" ] || die "the Edge is not running"

umask 077
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RECORD="$OUT/fairplay-edge-$STAMP.tar.gz"
CONFIG="$OUT/fairplay-edge-$STAMP-config.tar.gz"
trap 'rm -f "$RECORD.part" "$CONFIG.part"' EXIT

docker compose exec -T edge fairplay-edge backup > "$RECORD.part" || die "the backup failed: nothing was kept"
gzip -t "$RECORD.part" || die "the backup is not readable: nothing was kept"

names=(.env)
for name in publish.env config/sources.toml auth; do
  [ -e "$name" ] && names+=("$name")
done
tar -czf - "${names[@]}" > "$CONFIG.part"

mv "$RECORD.part" "$RECORD"
mv "$CONFIG.part" "$CONFIG"
( cd "$OUT" && sha256sum "$(basename "$RECORD")" "$(basename "$CONFIG")" > "fairplay-edge-$STAMP.sha256" )
printf 'backed up to %s (%s) and %s\n' "$RECORD" "$(du -h "$RECORD" | cut -f1)" "$CONFIG"

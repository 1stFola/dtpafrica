#!/usr/bin/env bash
# DTP FairPlay Edge — what this installed Edge is made of (Phase 6.5; docs/fairplay/licences.md).
#
#   deploy/licences.sh <folder>
#
# Run from services/fairplay-edge, with the stack running. It changes nothing. It writes to
# <folder>/fairplay-licences-<stamp>/:
#   inventory.json    Python and Debian packages, FFmpeg's build, MediaMTX's modules, the console's
#   sbom.cdx.json     the same as CycloneDX
#   notices.txt       every licence text the Edge image holds
#   mediamtx-LICENSE  the licence inside MediaMTX's image
#   check.txt         how the image compares with the reviewed list; the script exits 2 if it differs
# Nothing in it reads .env, publish.env or auth/.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
die() { printf 'licences: %s\n' "$*" >&2; exit "${2:-1}"; }

[ $# -eq 1 ] || die "usage: deploy/licences.sh <folder>" 2
[ -d "$1" ] || die "no such folder: $1" 2
[ -f .env ] || die "no .env here: install first (deploy/install.sh)" 2
[ -n "$(docker compose ps -q --status running edge 2>/dev/null || true)" ] || die "the Edge is not running"

HERE="$1/fairplay-licences-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$HERE"
docker compose exec -T edge fairplay-edge licences > "$HERE/inventory.json"
docker compose exec -T edge fairplay-edge licences --sbom > "$HERE/sbom.cdx.json"
docker compose exec -T edge fairplay-edge licences --notices > "$HERE/notices.txt"
docker compose cp mediamtx:/LICENSE "$HERE/mediamtx-LICENSE" >/dev/null 2>&1 || die "could not read MediaMTX's licence: the rest is in $HERE"

code=0
docker compose exec -T edge fairplay-edge licences --check > "$HERE/check.txt" 2>&1 || code=$?
[ "$code" = 0 ] && echo "as reviewed" > "$HERE/check.txt"
printf 'Written: %s\n' "$HERE"
[ "$code" = 0 ] || die "this image differs from the licence review: see $HERE/check.txt" 2

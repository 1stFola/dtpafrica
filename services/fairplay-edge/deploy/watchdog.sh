#!/usr/bin/env bash
# DTP FairPlay Edge — the host watchdog (Phase 6.1; docs/fairplay/edge-install.md).
# One pass; fairplay-edge-watchdog.timer runs it every minute.
#
# Docker restarts a container that crashes (`restart: unless-stopped`), but not one that was
# killed (`docker kill`, the kernel's OOM killer) or stopped by hand (5.2 D4). This pass
# starts MediaMTX and the Edge again if either is not running, and restarts an Edge that has
# been unhealthy for three passes in a row. It does nothing while the stack is in maintenance
# (`deploy/maintenance on`), so a deliberate stop stays stopped.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
UNHEALTHY_PASSES=3
COUNT="$DIR/.watchdog-unhealthy"

if [ -e "$DIR/.maintenance" ]; then
  echo "watchdog: in maintenance ($(cat "$DIR/.maintenance")); left alone"
  exit 0
fi

down=""
for svc in mediamtx edge; do
  state="$(docker compose ps -a --format '{{.State}}' "$svc" 2>/dev/null || true)"
  [ "$state" = "running" ] || down="$down $svc(${state:-absent})"
done
if [ -n "$down" ]; then
  echo "watchdog: not running:$down; starting them"
  docker compose up -d mediamtx edge
  echo 0 > "$COUNT"
  exit 0
fi

health="$(docker compose ps --format '{{.Health}}' edge 2>/dev/null || true)"
if [ "$health" = "unhealthy" ]; then
  n=$(( $(cat "$COUNT" 2>/dev/null || echo 0) + 1 ))
  echo "$n" > "$COUNT"
  echo "watchdog: the Edge is unhealthy ($n of $UNHEALTHY_PASSES)"
  if [ "$n" -ge "$UNHEALTHY_PASSES" ]; then
    echo "watchdog: restarting the Edge (MediaMTX, and so recording, is not touched)"
    docker compose restart edge
    echo 0 > "$COUNT"
  fi
else
  echo 0 > "$COUNT"
fi

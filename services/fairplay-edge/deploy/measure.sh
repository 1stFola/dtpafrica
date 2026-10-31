#!/usr/bin/env bash
# DTP FairPlay Edge — measure the matchday kit (Phase 6.4; docs/fairplay/hardware-validation.md).
#
#   sudo deploy/measure.sh <folder> [--load-minutes 10] [--since-minutes 90] [--disk-seconds 300]
#
# Run from services/fairplay-edge, with the stack running. It changes no setting. It writes to
# <folder>/fairplay-measure-<stamp>/:
#   machine.txt       OS, CPU, memory, disks and disk encryption, Docker, time sync, boot units
#   load.tsv, load-peak.txt   each container's CPU and memory every 10 s for --load-minutes
#   edge.json         what the cameras delivered, replay and clip times, alerts
#   disk.json         only with --disk-seconds: a sustained write test (refused while a session is
#                     open), which writes one temporary file beside the recordings and removes it
# Nothing in it reads .env, publish.env or auth/. Attach the folder to the results sheet.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"
die() { printf 'measure: %s\n' "$*" >&2; exit "${2:-1}"; }

OUT="" LOAD=10 SINCE="" DISK=""
while [ $# -gt 0 ]; do
  case "$1" in
    --load-minutes) [ $# -ge 2 ] || die "--load-minutes needs a number" 2; LOAD="$2"; shift 2 ;;
    --since-minutes) [ $# -ge 2 ] || die "--since-minutes needs a number" 2; SINCE="$2"; shift 2 ;;
    --disk-seconds) [ $# -ge 2 ] || die "--disk-seconds needs a number" 2; DISK="$2"; shift 2 ;;
    -*) die "unknown option: $1" 2 ;;
    *) OUT="$1"; shift ;;
  esac
done
[ -n "$OUT" ] || die "usage: deploy/measure.sh <folder> [--load-minutes 10] [--since-minutes 90] [--disk-seconds 300]" 2
[ -d "$OUT" ] || die "no such folder: $OUT" 2
for number in "$LOAD" "${SINCE:-0}" "${DISK:-0}"; do
  case "$number" in ''|*[!0-9]*) die "not a whole number: $number" 2 ;; esac
done
[ -f .env ] || die "no .env here: install first (deploy/install.sh)" 2
[ -n "$(docker compose ps -q --status running edge 2>/dev/null || true)" ] || die "the Edge is not running"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
HERE="$OUT/fairplay-measure-$STAMP"
mkdir -p "$HERE"

section() { printf '\n=== %s\n' "$1"; shift; "$@" 2>&1 || printf '(not available here)\n'; }
{
  printf 'Measured %s, release %s\n' "$STAMP" "$(sed -n 's/^FAIRPLAY_EDGE_TAG=//p' .env | tr -d '\r' | tail -n 1)"
  section "OS" sh -c 'cat /etc/os-release; uname -a'
  section "CPU" lscpu
  section "Memory" free -h
  section "Disks: is the data disk an SSD (ROTA 0), and encrypted (a crypt row)?" lsblk -o NAME,TYPE,SIZE,ROTA,MODEL,FSTYPE,MOUNTPOINT
  section "Free space" df -h
  section "Docker" sh -c 'docker version --format "{{.Server.Version}}"; docker compose version; docker info --format "storage {{.Driver}}, root {{.DockerRootDir}}"'
  section "Time sync" timedatectl status
  section "Boot units" systemctl is-enabled fairplay-edge.service fairplay-edge-watchdog.timer docker.service
  section "Network" ip -brief address
} > "$HERE/machine.txt"

if [ "$LOAD" -gt 0 ]; then
  printf 'Sampling load for %s minutes...\n' "$LOAD"
  printf 'utc\tcontainer\tcpu_percent\tmem_used\tmem_percent\n' > "$HERE/load.tsv"
  end=$(( $(date +%s) + LOAD * 60 ))
  while [ "$(date +%s)" -lt "$end" ]; do
    at="$(date -u +%H:%M:%S)"
    docker stats --no-stream --format '{{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}' $(docker compose ps -q) \
      | awk -F'\t' -v at="$at" 'BEGIN { OFS="\t" } { sub(/%/, "", $2); sub(/%/, "", $4); split($3, m, " / "); print at, $1, $2, m[1], $4 }' >> "$HERE/load.tsv"
    sleep 10
  done
  awk -F'\t' 'NR > 1 { n[$2]++; s[$2] += $3; if ($3 > c[$2]) c[$2] = $3; if ($5 > m[$2]) { m[$2] = $5; u[$2] = $4 } }
    END { printf "container\tmean_cpu\tpeak_cpu\tpeak_mem\tsamples\n"; for (k in n) printf "%s\t%.1f%%\t%.1f%%\t%s\t%d\n", k, s[k] / n[k], c[k], u[k], n[k] }' \
    "$HERE/load.tsv" > "$HERE/load-peak.txt"
fi

args=()
[ -n "$SINCE" ] && args=(--since-minutes "$SINCE")
docker compose exec -T edge fairplay-edge measure "${args[@]+"${args[@]}"}" > "$HERE/edge.json" || die "the Edge's report failed: see $HERE"

if [ -n "$DISK" ]; then
  printf 'Writing to the disk for %s seconds...\n' "$DISK"
  code=0
  docker compose exec -T edge fairplay-edge measure-disk --seconds "$DISK" > "$HERE/disk.json" || code=$?
  [ "$code" = 0 ] || { rm -f "$HERE/disk.json"; die "the disk test did not run; the rest is in $HERE" "$code"; }
fi
printf 'Measured: %s\n' "$HERE"

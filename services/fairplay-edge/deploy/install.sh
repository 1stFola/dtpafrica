#!/usr/bin/env bash
# DTP FairPlay Edge — installer (Phase 6.1; docs/fairplay/edge-install.md).
#
#   sudo deploy/install.sh --label "Edge laptop 1" \
#        --lan-ip 192.168.10.2 --host 192.168.10.2 --host edge.venue.lan \
#        --ingest-ip 192.168.20.2 --cameras 192.168.20.0/24
#
# Run from services/fairplay-edge in a release checkout, with the console built
# (apps/fairplay-console/dist). It:
#   1. checks Docker, Compose v2, systemd and free disk;
#   2. writes .env and publish.env from the examples, generating every secret here (never
#      printed; the files are 0600), unless they exist already;
#   3. copies config/sources.example.toml to config/sources.toml if there is none;
#   4. builds dtp-fairplay-edge:<version>-<commit> and pins FAIRPLAY_EDGE_TAG to it;
#   5. with --lan-ip: issues the Edge's TLS certificate for every --host, and serves the
#      console on that address (venue-ca.pem is the CA reviewer devices must trust);
#   6. installs and enables the systemd units: Docker and the stack at boot, the watchdog
#      every minute;
#   7. starts the stack and waits until the Edge is healthy.
#
# Safe to run again: nothing that exists is overwritten. --no-systemd skips step 6 and starts
# the stack with `docker compose` (tests, or a host without systemd). --render-only stops after
# step 3 and writes the units to deploy/rendered/ (tests). Set COMPOSE_PROJECT_NAME to run a
# second, separate stack.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$DIR"

LABEL="" LAN_IP="" INGEST_IP="" CAMERAS="" HOSTS=() SYSTEMD=1 RENDER_ONLY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --label) LABEL="$2"; shift 2 ;;
    --lan-ip) LAN_IP="$2"; shift 2 ;;
    --host) HOSTS+=("$2"); shift 2 ;;
    --ingest-ip) INGEST_IP="$2"; shift 2 ;;
    --cameras) CAMERAS="$2"; shift 2 ;;
    --no-systemd) SYSTEMD=0; shift ;;
    --render-only) RENDER_ONLY=1; SYSTEMD=0; shift ;;
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
die() { printf 'install: %s\n' "$*" >&2; exit 1; }

secret() {
  # 43 or more URL-safe characters (256 bits): Python's secrets, else openssl. Checked, so a
  # broken interpreter can never leave a secret empty.
  local s=""
  command -v python3 >/dev/null 2>&1 && s="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))' 2>/dev/null || true)"
  [ "${#s}" -ge 40 ] || s="$(openssl rand -base64 33 2>/dev/null | tr '+/' '-_' | tr -d '=\n' || true)"
  [ "${#s}" -ge 40 ] || die "cannot generate a secret: install python3 or openssl"
  printf '%s\n' "$s"
}

set_env() {  # set_env FILE KEY VALUE: replace the KEY= line, or add it
  local file="$1" key="$2" value="$3"
  if grep -qE "^#? ?${key}=" "$file"; then
    local tmp; tmp="$(mktemp)"
    awk -v k="$key" -v v="$value" 'BEGIN{done=0} { if (!done && ($0 ~ "^#? ?" k "=")) { print k "=" v; done=1 } else print }' "$file" > "$tmp"
    cat "$tmp" > "$file" && rm -f "$tmp"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

get_env() { sed -n "s/^$2=//p" "$1" | tr -d '\r' | tail -n 1; }

# The examples may have CRLF line ends (a Windows checkout); the files written here never do.
copy_lf() { tr -d '\r' < "$1" > "$2"; }

# ── 1. preflight ─────────────────────────────────────────────────────────────
if [ "$RENDER_ONLY" = 0 ]; then
  say "Checking the host"
  command -v docker >/dev/null || die "Docker is not installed (docs/fairplay/edge-install.md, Requirements)"
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is not installed"
  docker info >/dev/null 2>&1 || die "cannot reach Docker (is it running, and may this user use it?)"
  if [ "$SYSTEMD" = 1 ]; then
    command -v systemctl >/dev/null || die "systemd not found: use --no-systemd, and start the stack at boot another way"
    [ "$(id -u)" = 0 ] || die "installing the systemd units needs root: run with sudo"
  fi
  root="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || echo /var/lib/docker)"
  free_gb="$(df -Pk "$root" 2>/dev/null | awk 'NR==2 {print int($4/1048576)}' || true)"
  echo "Docker data on $root: ${free_gb:-?} GB free"
  if [ -n "${free_gb:-}" ] && [ "$free_gb" -lt 50 ]; then
    echo "WARNING: under 50 GB free. Recording uses about 1.1 GB per camera-hour at 2.5 Mbit/s."
  fi
  [ -f "${FAIRPLAY_CONSOLE_PATH:-../../apps/fairplay-console/dist}/index.html" ] \
    || die "the console is not built: run 'pnpm --filter @dtp/fairplay-console build' (or ship apps/fairplay-console/dist)"
fi

# ── 2. secrets and settings ──────────────────────────────────────────────────
say "Settings"
umask 077
if [ ! -f .env ]; then
  copy_lf .env.example .env
  set_env .env FAIRPLAY_MEDIAMTX_PASSWORD "$(secret)"
  set_env .env FAIRPLAY_EDGE_API_TOKEN "$(secret)"
  echo "wrote .env with new secrets"
else
  echo ".env exists: kept"
fi
chmod 600 .env
[ -n "$LABEL" ] && set_env .env FAIRPLAY_DEVICE_LABEL "$LABEL"
[ -n "$CAMERAS" ] && set_env .env FAIRPLAY_PUBLISH_ALLOWED_CIDRS "$CAMERAS"
[ -n "$INGEST_IP" ] && set_env .env FAIRPLAY_INGEST_BIND "$INGEST_IP"
grep -qE '^[A-Z0-9_]+=CHANGE_ME' .env && die ".env still holds a CHANGE_ME: fill it, or delete .env to have it generated"

# ── 3. sources and their publish passwords ───────────────────────────────────
[ -f config/sources.toml ] || { copy_lf config/sources.example.toml config/sources.toml; echo "wrote config/sources.toml from the example: check the sources"; }
[ -f publish.env ] || copy_lf publish.env.example publish.env
chmod 600 publish.env
for name in $(tr -d '\r' < config/sources.toml | sed -n 's/^name *= *"\([A-Za-z0-9_-]*\)".*/\1/p'); do
  key="FAIRPLAY_PUBLISH_PASSWORD_$(printf '%s' "$name" | tr 'a-z-' 'A-Z_')"
  value="$(get_env publish.env "$key")"
  if [ -z "$value" ] || [ "$value" = "CHANGE_ME" ]; then
    set_env publish.env "$key" "$(secret)"
    echo "generated the publish password for source '$name' (in publish.env)"
  fi
done

VERSION="$(tr -d '\r' < pyproject.toml | sed -n 's/^version *= *"\(.*\)"/\1/p' | head -n 1)"
REV="$(git rev-parse --short HEAD 2>/dev/null || echo local)"
TAG="${VERSION}-${REV}"
set_env .env FAIRPLAY_EDGE_TAG "$TAG"
echo "image tag: dtp-fairplay-edge:$TAG"

render_units() {  # render_units TARGET_DIR
  mkdir -p "$1"
  for unit in fairplay-edge.service fairplay-edge-watchdog.service fairplay-edge-watchdog.timer; do
    sed "s#@DIR@#$DIR#g" "deploy/systemd/$unit" > "$1/$unit"
  done
}

if [ "$RENDER_ONLY" = 1 ]; then
  render_units deploy/rendered
  echo "rendered the systemd units to deploy/rendered/"
  exit 0
fi

# ── 4. the image ─────────────────────────────────────────────────────────────
say "Building dtp-fairplay-edge:$TAG"
# `init` carries the build; `edge` and the synthetic feeds run the same image.
docker compose build init

# ── 5. TLS, when the console is served on the LAN ────────────────────────────
if [ -n "$LAN_IP" ]; then
  say "TLS for ${HOSTS[*]:-$LAN_IP}"
  if [ -z "$(get_env .env FAIRPLAY_EDGE_TLS_CERT)" ]; then
    host_args=(); for h in "${HOSTS[@]:-$LAN_IP}"; do host_args+=(--host "$h"); done
    docker compose run --rm --no-deps -T edge tls-init "${host_args[@]}" >/dev/null
    set_env .env FAIRPLAY_EDGE_TLS_CERT /var/lib/fairplay/data/tls/server.pem
    set_env .env FAIRPLAY_EDGE_TLS_KEY /var/lib/fairplay/data/tls/server-key.pem
  fi
  set_env .env FAIRPLAY_EDGE_HOST_BIND "$LAN_IP"
  docker compose run --rm --no-deps -T --entrypoint cat edge /var/lib/fairplay/data/tls/ca.pem > venue-ca.pem
  echo "venue-ca.pem: install it on each reviewer device as a trusted CA"
fi

# ── 6 and 7. start, at boot and now ──────────────────────────────────────────
if [ "$SYSTEMD" = 1 ]; then
  say "Installing the systemd units"
  render_units /etc/systemd/system
  systemctl daemon-reload
  systemctl enable --now docker.service
  systemctl enable fairplay-edge.service fairplay-edge-watchdog.timer
  systemctl restart fairplay-edge.service
  systemctl start fairplay-edge-watchdog.timer
else
  say "Starting the stack"
  docker compose up -d --remove-orphans
fi

say "Waiting for the Edge to be healthy"
for _ in $(seq 1 60); do
  health="$(docker compose ps --format '{{.Health}}' edge 2>/dev/null || true)"
  [ "$health" = "healthy" ] && break
  sleep 2
done
[ "$health" = "healthy" ] || { docker compose ps; die "the Edge is not healthy after 2 minutes: docker compose logs edge"; }

say "Installed"
echo "image:     dtp-fairplay-edge:$TAG"
echo "console:   https://${HOSTS[0]:-${LAN_IP:-127.0.0.1}}:8443 (or http://127.0.0.1:8443 on this machine without TLS)"
echo "cameras:   rtsp://pub-<source>:<password from publish.env>@${INGEST_IP:-127.0.0.1}:8554/<source>"
echo "next:      install a bundle or pair with the cloud (fairplay-edge pair), then rehearse (docs/fairplay/runbook.md)"

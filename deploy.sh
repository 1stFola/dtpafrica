#!/usr/bin/env bash
# =============================================================================
# deploy.sh — One-click deployment for DirectToPro Africa on Ubuntu EC2
#
# Usage:
#   chmod +x deploy.sh
#   ./deploy.sh
#
# What this script does (in order):
#   1.  Validates it is running on Ubuntu and as a non-root sudo user
#   2.  Installs system dependencies (curl, git, ca-certificates, ufw, fail2ban)
#   3.  Installs Node.js 20 LTS via NodeSource
#   4.  Installs pnpm 9.15.0 globally
#   5.  Installs Docker CE + Docker Compose v2 plugin from the official Docker repo
#   6.  Retrieves secrets from AWS Secrets Manager (or falls back to prompts)
#   7.  Clones / updates the repository
#   8.  Writes services/api/.env with all required environment variables
#   9.  Starts PostgreSQL via Docker Compose and waits until it is healthy
#   10. Generates the Prisma client
#   11. Pushes the Prisma schema to Postgres (creates all tables)
#   12. Builds and starts the full stack (api + web) via docker-compose.staging.yml
#   13. Runs a health-check smoke test against /api/v1/health
#   14. Prints a summary with access URLs
#
# Environment variables you can set before running to skip prompts:
#   REPO_URL          git clone URL  (default: auto-detected from git remote)
#   REPO_BRANCH       branch to deploy (default: main)
#   APP_DIR           where to clone the repo (default: /opt/dtp-app)
#   POSTGRES_USER     (default: dtp)
#   POSTGRES_PASSWORD (required — will prompt if not set)
#   POSTGRES_DB       (default: dtp_africa)
#   ADMIN_API_KEY     (required — will prompt if not set)
#   AWS_SECRET_DB     AWS Secrets Manager secret name for DB creds
#   AWS_SECRET_APP    AWS Secrets Manager secret name for app creds
#   AWS_REGION        AWS region (default: us-east-1)
# =============================================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

log()     { echo -e "${CYAN}${BOLD}[DTP]${RESET} $*"; }
success() { echo -e "${GREEN}${BOLD}[OK]${RESET}  $*"; }
warn()    { echo -e "${YELLOW}${BOLD}[WARN]${RESET} $*"; }
error()   { echo -e "${RED}${BOLD}[ERR]${RESET}  $*" >&2; exit 1; }

# ── Banner ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║   DirectToPro Africa — EC2 Deploy Script     ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${RESET}"
echo ""

# ── 0. Validate environment ───────────────────────────────────────────────────
log "Checking environment..."

if [[ "$EUID" -eq 0 ]]; then
  error "Do not run this script as root. Run as ubuntu (or another sudo user)."
fi

if ! command -v sudo &>/dev/null; then
  error "sudo is required but not found."
fi

# Detect Ubuntu
if ! grep -qi ubuntu /etc/os-release 2>/dev/null; then
  warn "This script is designed for Ubuntu. Proceeding anyway — some steps may differ."
fi

success "Environment OK"

# ── 1. Configuration / secrets ────────────────────────────────────────────────
log "Resolving configuration..."

APP_DIR="${APP_DIR:-/opt/dtp-app}"
REPO_BRANCH="${REPO_BRANCH:-main}"
AWS_REGION="${AWS_REGION:-us-east-1}"

# Try AWS Secrets Manager first, then fall back to env vars, then prompt
fetch_aws_secret() {
  local secret_name="$1"
  if command -v aws &>/dev/null; then
    aws secretsmanager get-secret-value \
      --secret-id "$secret_name" \
      --region "$AWS_REGION" \
      --query SecretString \
      --output text 2>/dev/null || true
  fi
}

if [[ -n "${AWS_SECRET_DB:-}" ]]; then
  log "Fetching DB credentials from AWS Secrets Manager: $AWS_SECRET_DB"
  DB_SECRET_JSON=$(fetch_aws_secret "$AWS_SECRET_DB")
  if [[ -n "$DB_SECRET_JSON" ]]; then
    POSTGRES_USER=$(echo "$DB_SECRET_JSON"     | python3 -c "import sys,json; print(json.load(sys.stdin)['POSTGRES_USER'])")
    POSTGRES_PASSWORD=$(echo "$DB_SECRET_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['POSTGRES_PASSWORD'])")
    POSTGRES_DB=$(echo "$DB_SECRET_JSON"       | python3 -c "import sys,json; print(json.load(sys.stdin)['POSTGRES_DB'])")
    success "DB credentials fetched from Secrets Manager"
  else
    warn "Could not reach Secrets Manager — falling back to env vars / prompts"
  fi
fi

if [[ -n "${AWS_SECRET_APP:-}" ]]; then
  log "Fetching app secrets from AWS Secrets Manager: $AWS_SECRET_APP"
  APP_SECRET_JSON=$(fetch_aws_secret "$AWS_SECRET_APP")
  if [[ -n "$APP_SECRET_JSON" ]]; then
    ADMIN_API_KEY=$(echo "$APP_SECRET_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['ADMIN_API_KEY'])")
    success "App secrets fetched from Secrets Manager"
  fi
fi

# Apply defaults
POSTGRES_USER="${POSTGRES_USER:-dtp}"
POSTGRES_DB="${POSTGRES_DB:-dtp_africa}"

# Prompt for anything still missing — no defaults, values must be supplied explicitly
if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  echo -n "Enter POSTGRES_PASSWORD: "
  read -rs POSTGRES_PASSWORD; echo
  if [[ -z "$POSTGRES_PASSWORD" ]]; then
    error "POSTGRES_PASSWORD is required. Set it as an env var or enter it at the prompt."
  fi
fi

if [[ -z "${ADMIN_API_KEY:-}" ]]; then
  echo -n "Enter ADMIN_API_KEY: "
  read -rs ADMIN_API_KEY; echo
  if [[ -z "$ADMIN_API_KEY" ]]; then
    error "ADMIN_API_KEY is required. Set it as an env var or enter it at the prompt."
  fi
fi

# Repo URL — auto-detect from git remote if inside a repo, otherwise prompt
if [[ -z "${REPO_URL:-}" ]]; then
  if git -C "$(dirname "$0")" remote get-url origin &>/dev/null; then
    REPO_URL=$(git -C "$(dirname "$0")" remote get-url origin)
    log "Auto-detected repo URL: $REPO_URL"
  else
    echo -n "Enter git repository URL (SSH or HTTPS): "
    read -r REPO_URL
  fi
fi

success "Configuration resolved"

# ── 2. System packages ────────────────────────────────────────────────────────
log "Installing system packages..."

sudo apt-get update -qq
sudo apt-get install -y -qq \
  curl wget git ca-certificates gnupg lsb-release \
  ufw fail2ban python3 python3-pip unzip

success "System packages installed"

# ── 3. Node.js 20 LTS ────────────────────────────────────────────────────────
if node --version 2>/dev/null | grep -q "^v20"; then
  success "Node.js 20 already installed: $(node --version)"
else
  log "Installing Node.js 20 LTS via NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
  success "Node.js installed: $(node --version)"
fi

# ── 4. pnpm 9.15.0 ───────────────────────────────────────────────────────────
if pnpm --version 2>/dev/null | grep -q "^9\.15"; then
  success "pnpm 9.15.0 already installed"
else
  log "Installing pnpm 9.15.0..."
  sudo npm install -g pnpm@9.15.0
  success "pnpm installed: $(pnpm --version)"
fi

# ── 5. Docker CE + Compose v2 ────────────────────────────────────────────────
if docker --version &>/dev/null; then
  success "Docker already installed: $(docker --version)"
else
  log "Installing Docker CE..."

  # Remove old packages
  for pkg in docker docker-engine docker.io containerd runc; do
    sudo apt-get remove -y "$pkg" 2>/dev/null || true
  done

  # Add Docker GPG key and repo
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu \
    $(lsb_release -cs) stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  sudo apt-get update -qq
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
    docker-buildx-plugin docker-compose-plugin

  # Allow ubuntu user to use docker without sudo
  sudo usermod -aG docker "$USER"
  success "Docker installed: $(docker --version)"
  warn "You were added to the docker group. If docker commands fail, run: newgrp docker"
fi

# Ensure Docker daemon is running
if ! sudo systemctl is-active --quiet docker; then
  log "Starting Docker daemon..."
  sudo systemctl enable docker
  sudo systemctl start docker
  sleep 5
fi
success "Docker daemon running"

# Use 'sudo docker' if the current shell session doesn't have the docker group yet
DOCKER_CMD="docker"
if ! docker ps &>/dev/null 2>&1; then
  warn "Current session lacks docker group — using sudo docker"
  DOCKER_CMD="sudo docker"
fi

# ── 6. Clone / update repository ─────────────────────────────────────────────
log "Setting up repository at $APP_DIR..."

sudo mkdir -p "$APP_DIR"
sudo chown "$USER:$USER" "$APP_DIR"

if [[ -d "$APP_DIR/.git" ]]; then
  log "Repository exists — pulling latest $REPO_BRANCH..."
  git -C "$APP_DIR" fetch origin
  git -C "$APP_DIR" checkout "$REPO_BRANCH"
  git -C "$APP_DIR" reset --hard "origin/$REPO_BRANCH"
else
  log "Cloning repository..."
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
fi

success "Repository ready at $APP_DIR"

# ── 7. Write services/api/.env ────────────────────────────────────────────────
log "Writing API environment file..."

cat > "$APP_DIR/services/api/.env" <<EOF
# Generated by deploy.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ") — do not edit manually
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@localhost:5432/${POSTGRES_DB}
PORT=3000
ADMIN_API_KEY=${ADMIN_API_KEY}
EOF

chmod 600 "$APP_DIR/services/api/.env"
success "API .env written"

# ── 8. Write infra/.env.staging (for docker-compose.staging.yml) ─────────────
log "Writing staging compose env file..."

cat > "$APP_DIR/infra/.env.staging" <<EOF
# Generated by deploy.sh on $(date -u +"%Y-%m-%dT%H:%M:%SZ") — do not edit manually
POSTGRES_USER=${POSTGRES_USER}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
POSTGRES_DB=${POSTGRES_DB}
ADMIN_API_KEY=${ADMIN_API_KEY}
WEB_PORT=80
API_PORT=3000
EOF

chmod 600 "$APP_DIR/infra/.env.staging"
success "Staging .env written"

# ── 9. Start PostgreSQL and wait until healthy ────────────────────────────────
log "Starting PostgreSQL container..."

cd "$APP_DIR"

$DOCKER_CMD compose -f infra/docker-compose.yml up -d

log "Waiting for PostgreSQL to be ready (up to 60s)..."
RETRIES=12
INTERVAL=5
for ((i=1; i<=RETRIES; i++)); do
  if $DOCKER_CMD exec dtp-postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" &>/dev/null; then
    success "PostgreSQL is accepting connections"
    break
  fi
  if [[ $i -eq $RETRIES ]]; then
    error "PostgreSQL did not become ready after $((RETRIES * INTERVAL))s. Check: docker logs dtp-postgres"
  fi
  log "  Attempt $i/$RETRIES — waiting ${INTERVAL}s..."
  sleep $INTERVAL
done

# ── 10. Install dependencies ──────────────────────────────────────────────────
log "Installing Node.js dependencies..."

cd "$APP_DIR"
pnpm install --frozen-lockfile

success "Dependencies installed"

# ── 11. Generate Prisma client ────────────────────────────────────────────────
log "Generating Prisma client..."

pnpm --filter @dtp/api prisma:generate

success "Prisma client generated"

# ── 12. Push schema to database ───────────────────────────────────────────────
log "Pushing Prisma schema to PostgreSQL (creating tables)..."

pnpm --filter @dtp/api db:push

success "Database schema synced"

# ── 13. Build and start full stack via Docker Compose ────────────────────────
log "Building and starting full application stack..."
log "  This builds the API and web Docker images — may take 3–5 minutes on first run"

cd "$APP_DIR"

# Stop any existing staging stack first (clean redeploy)
$DOCKER_CMD compose \
  --env-file infra/.env.staging \
  -f infra/docker-compose.staging.yml \
  down --remove-orphans 2>/dev/null || true

# Build and start
$DOCKER_CMD compose \
  --env-file infra/.env.staging \
  -f infra/docker-compose.staging.yml \
  up -d --build

success "Containers started"

# ── 14. Wait for API container to be healthy ──────────────────────────────────
log "Waiting for API health check (up to 120s)..."

RETRIES=24
INTERVAL=5
for ((i=1; i<=RETRIES; i++)); do
  HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
    http://localhost:3000/api/v1/health 2>/dev/null || echo "000")

  if [[ "$HTTP_STATUS" == "200" ]]; then
    success "API health check passed (HTTP 200)"
    break
  fi

  if [[ $i -eq $RETRIES ]]; then
    warn "API health check did not return 200 after $((RETRIES * INTERVAL))s (got HTTP $HTTP_STATUS)"
    warn "Check logs: docker compose -f infra/docker-compose.staging.yml logs api"
  fi

  log "  Attempt $i/$RETRIES — API returned HTTP $HTTP_STATUS, waiting ${INTERVAL}s..."
  sleep $INTERVAL
done

# ── 15. UFW firewall ──────────────────────────────────────────────────────────
log "Configuring UFW firewall..."

sudo ufw allow 22/tcp   comment "SSH"   2>/dev/null || true
sudo ufw allow 80/tcp   comment "HTTP"  2>/dev/null || true
sudo ufw allow 443/tcp  comment "HTTPS" 2>/dev/null || true
sudo ufw --force enable 2>/dev/null || true

success "Firewall configured (22, 80, 443 open)"

# ── 16. Print summary ─────────────────────────────────────────────────────────
PUBLIC_IP=$(curl -sf http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null \
  || curl -sf https://api.ipify.org 2>/dev/null \
  || echo "<your-server-ip>")

echo ""
echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${GREEN}${BOLD}║         Deployment Complete!                 ║${RESET}"
echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Web app:${RESET}        http://${PUBLIC_IP}"
echo -e "  ${BOLD}API base URL:${RESET}   http://${PUBLIC_IP}/api/v1"
echo -e "  ${BOLD}Health check:${RESET}   http://${PUBLIC_IP}/api/v1/health"
echo ""
echo -e "  ${BOLD}Useful commands:${RESET}"
echo -e "    View all logs:   docker compose -f ${APP_DIR}/infra/docker-compose.staging.yml logs -f"
echo -e "    API logs only:   docker compose -f ${APP_DIR}/infra/docker-compose.staging.yml logs -f api"
echo -e "    Stop stack:      docker compose -f ${APP_DIR}/infra/docker-compose.staging.yml down"
echo -e "    Redeploy:        cd ${APP_DIR} && git pull && ./deploy.sh"
echo ""

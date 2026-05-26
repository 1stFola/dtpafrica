# Staging Deployment

Single-host staging runs three containers:

- Postgres 16 with a named Docker volume
- Nest API on the internal Docker network, also bound to localhost for debugging
- Static web build served by nginx, proxying `/api/*` to the API container

## Prerequisites

- Docker Engine with Compose v2
- DNS pointed at the host, if exposing beyond an IP address
- Firewall open for the chosen web port, usually `80` or `8080`

## Configure

Create a staging env file from the template:

```sh
cp infra/.env.staging.example infra/.env.staging
```

Edit at least:

```sh
POSTGRES_PASSWORD=replace-with-a-long-secret
ADMIN_API_KEY=replace-with-a-long-admin-key
STAGING_HOST=staging-host-or-ip
STAGING_DOMAIN=staging.dtp.africa
WEB_PORT=8080
API_PORT=3000
```

The interim admin key protects `/admin`, ScoreBoard operator/supervisor writes, and MVCE valuation generation.
The checked-in `infra/.env.staging.example` is safe to use for validation only; `infra/.env.staging` remains ignored and must contain deployment-specific secrets before any real staging exposure.

## Deploy

From the repository root:

```sh
docker compose --env-file infra/.env.staging -f infra/docker-compose.staging.yml up -d --build
```

The API container runs `pnpm --filter @dtp/api db:push` before starting, so a new Postgres volume gets the current Prisma schema automatically.

Optional seed after first boot:

```sh
docker compose --env-file infra/.env.staging -f infra/docker-compose.staging.yml exec api pnpm --filter @dtp/api prisma:seed
```

## Verify

```sh
curl http://localhost:${WEB_PORT:-8080}/
curl http://localhost:${WEB_PORT:-8080}/api/v1/health
```

Admin verification:

```sh
curl -H "x-admin-api-key: $ADMIN_API_KEY" \
  http://localhost:${WEB_PORT:-8080}/api/v1/admin/session
```

## Operate

View logs:

```sh
docker compose --env-file infra/.env.staging -f infra/docker-compose.staging.yml logs -f api web
```

Update after pulling new code:

```sh
docker compose --env-file infra/.env.staging -f infra/docker-compose.staging.yml up -d --build
```

Back up Postgres before destructive changes:

```sh
docker compose --env-file infra/.env.staging -f infra/docker-compose.staging.yml exec postgres \
  pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > dtp_staging_backup.sql
```

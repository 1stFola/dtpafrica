FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# apps/ is copied for the workspace manifest only: pnpm needs every project's
# package.json present to resolve the lockfile, even when the install is filtered
# down to the API. Its dependencies are not installed.
COPY apps ./apps
COPY packages ./packages
COPY services ./services

# Only the API's own dependency closure.
#
# A bare `pnpm install` here installs every workspace project, so this image was
# downloading and linking apps/web's React, Vite and Vitest trees — none of which
# it ever uses — on top of its own. The deploy rebuilds with --no-cache, so that
# waste was paid in full on every single deploy.
#
# `@dtp/api...` is pnpm's "this package and everything it depends on", which keeps
# @dtp/engines and @dtp/vision-contracts (both built below) and drops the rest.
RUN pnpm install --frozen-lockfile --filter @dtp/api...
# @dtp/vision-contracts must be built here.
#
# The API's compiled output requires it by package name, so Node resolves it
# through node_modules to the package's own dist/ — which is gitignored. Without
# this the image builds cleanly and then the container dies on boot with
# MODULE_NOT_FOUND, nginx answers 502, and the site serves only static files.
#
# The package also builds itself from a `prepare` hook, so `pnpm install` produces
# its dist everywhere. This step stays because --ignore-scripts would skip that.
RUN pnpm --filter @dtp/engines build \
  && pnpm --filter @dtp/vision-contracts build \
  && pnpm --filter @dtp/api prisma:generate \
  && pnpm --filter @dtp/api build

FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
# Install pnpm at build time so the container never downloads it at startup
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY --from=builder /app /app

EXPOSE 3000
CMD ["sh", "-c", "pnpm --filter @dtp/api db:repair:squad-duplicates && pnpm --filter @dtp/api db:push && pnpm --filter @dtp/api start"]

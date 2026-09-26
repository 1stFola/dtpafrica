FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services

RUN pnpm install --frozen-lockfile
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

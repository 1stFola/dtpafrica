FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services

RUN pnpm install --frozen-lockfile
RUN pnpm --filter @dtp/engines build \
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
CMD ["sh", "-c", "pnpm --filter @dtp/api db:push && pnpm --filter @dtp/api start"]

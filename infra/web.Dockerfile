FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps ./apps
COPY packages ./packages
COPY services ./services

RUN pnpm install --frozen-lockfile
# Build engines first — @dtp/web imports from @dtp/engines and needs its type declarations
RUN pnpm --filter @dtp/engines build
RUN pnpm --filter @dtp/web build

FROM nginx:1.27-alpine

# A template: the image's entrypoint runs envsubst over /etc/nginx/templates/*.template at
# start and writes conf.d/default.conf, filling in the origin check's two settings. Both
# are defined here so the names always exist: unset, envsubst would leave the placeholder
# in and nginx would refuse to start. Empty turns the check off (infra/nginx.staging.conf).
ENV ORIGIN_VERIFY_SECRET="" \
    ORIGIN_VERIFY_ENFORCE=""
COPY infra/nginx.staging.conf /etc/nginx/templates/default.conf.template
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80

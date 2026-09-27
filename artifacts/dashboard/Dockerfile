# Web image: the built SPA served by Caddy, which also terminates TLS and proxies /api.
#   docker build -f artifacts/dashboard/Dockerfile -t amp-web .

FROM node:22-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@workspace/dashboard..." \
 && BASE_PATH=/ pnpm --filter @workspace/dashboard run build

FROM caddy:2-alpine
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/artifacts/dashboard/dist/public /srv
EXPOSE 80 443

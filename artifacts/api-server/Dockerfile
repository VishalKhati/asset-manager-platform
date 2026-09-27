# API / engine / CLI image. Build from the repository root:
#   docker build -f artifacts/api-server/Dockerfile -t amp-api .
# The esbuild bundle is self-contained (no node_modules at runtime) and carries the SQL migrations.

FROM node:26-bookworm-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile --filter "@workspace/api-server..." \
 && pnpm --filter @workspace/api-server run typecheck \
 && pnpm --filter @workspace/api-server run build

FROM node:26-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /repo/artifacts/api-server/dist ./dist
USER node
EXPOSE 8080 9464
# Same image runs three roles: api (default), engine (dist/engine.mjs) and migrations (dist/cli.mjs migrate).
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/index.mjs"]

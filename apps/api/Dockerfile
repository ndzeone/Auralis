# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
ENV COREPACK_HOME=/opt/corepack
WORKDIR /app
RUN apt-get update \
    && apt-get install --no-install-recommends -y openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
RUN --mount=type=secret,id=proxy_ca \
    export NODE_USE_ENV_PROXY=1; if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    corepack prepare pnpm@10.30.3 --activate

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api ./apps/api
# This optional mount extends Node trust in managed cloud environments.
# Normal local/CI Docker builds use the system trust store.
RUN --mount=type=secret,id=proxy_ca \
    export NODE_USE_ENV_PROXY=1; if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    pnpm install --frozen-lockfile --filter @auralis/api...
RUN --mount=type=secret,id=proxy_ca \
    export NODE_USE_ENV_PROXY=1; if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    pnpm --filter @auralis/api db:generate
RUN pnpm --filter @auralis/api build

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["sh", "-c", "pnpm --filter @auralis/api db:migrate && exec pnpm --filter @auralis/api start"]

#!/usr/bin/env bash
set -euo pipefail
cd /workspace/Auralis
corepack pnpm install --frozen-lockfile
# Node 24's downloader must use the inherited HTTPS proxy in managed environments.
NODE_USE_ENV_PROXY=1 node apps/launcher/node_modules/electron/install.js
corepack pnpm db:generate
corepack pnpm assets
corepack pnpm build

# syntax=docker/dockerfile:1

# Debian rather than Alpine: PDFs are printed by Playwright's own Chromium,
# which isn't built for musl (decided in E5-5, #46).
FROM node:24.19.0-trixie-slim@sha256:ab3eebe934147fee049b5eb83c570f68c849a13c930bdfa482de99fcdfa3b3de AS base
WORKDIR /app
# Swap the image's bundled Yarn 1 for the version pinned in package.json (packageManager).
RUN corepack disable
RUN --mount=type=secret,id=proxy_ca \
  if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
  npm install --global --force @yarnpkg/cli-dist@4.18.1
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Where Playwright keeps Chromium: in the image, not in a user's home or a volume.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Development image: dependencies are baked in, source is bind-mounted by compose.yml.
FROM base AS dev
RUN chown node:node /app
USER node
COPY --chown=node:node package.json yarn.lock .yarnrc.yml ./
RUN --mount=type=secret,id=proxy_ca \
  if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
  if [ -n "$HTTPS_PROXY" ]; then export YARN_HTTPS_PROXY="$HTTPS_PROXY"; fi; \
  if [ -n "$HTTP_PROXY" ]; then export YARN_HTTP_PROXY="$HTTP_PROXY"; fi; \
  yarn install --immutable && mkdir .next
# Chromium for PDFs, matching the installed playwright-core, with the system
# libraries and fonts it needs (installing those takes root). Only the
# headless shell: printing needs nothing more.
USER root
RUN --mount=type=secret,id=proxy_ca \
  if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
  node node_modules/playwright-core/cli.js install --with-deps --only-shell chromium \
  && rm -rf /var/lib/apt/lists/*
USER node
EXPOSE 3000
# The seed is idempotent: built-in themes, an empty profile and default settings.
CMD ["sh", "-c", "yarn prisma generate && yarn prisma migrate deploy && yarn prisma db seed && yarn dev"]

# ── Production (E12-1) ───────────────────────────────────────────────────────
# Dependencies, then the build, then a runtime with only what running needs:
# the standalone server, Chromium for PDFs, and Prisma's CLI for migrations.
# Builds without any secrets: the environment is read when the server starts.

FROM base AS deps
COPY package.json yarn.lock .yarnrc.yml ./
RUN --mount=type=secret,id=proxy_ca \
  if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
  if [ -n "$HTTPS_PROXY" ]; then export YARN_HTTPS_PROXY="$HTTPS_PROXY"; fi; \
  if [ -n "$HTTP_PROXY" ]; then export YARN_HTTP_PROXY="$HTTP_PROXY"; fi; \
  yarn install --immutable

FROM deps AS build
ENV NEXT_TELEMETRY_DISABLED=1
COPY . .
# Build the app and isolated migration tools in one layer. This also bounds
# temporary space on Docker hosts using the vfs storage driver.
# The tools lockfile pins the CLI and the same dependency override as yarn.lock.
RUN --mount=type=secret,id=proxy_ca \
  if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
  yarn prisma generate && yarn build \
  && mkdir /tools && cp deployment/tools/package.json deployment/tools/package-lock.json /tools/ \
  && cd /tools && npm ci --omit=dev --no-audit --no-fund \
  && cp -r /app/prisma7.config.ts /app/prisma /tools/ \
  && cd /app \
  && node_modules/.bin/esbuild prisma/seed.ts --bundle --platform=node --format=esm --target=node24 \
    --external:pg-native --outfile=/tools/seed.mjs \
    --banner:js='import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' \
  && node_modules/.bin/esbuild scripts/hash-password.ts --bundle --platform=node --format=esm --target=node24 \
    --outfile=/tools/hash-password.mjs --banner:js='#!/usr/bin/env node' \
  && chmod 755 /tools/hash-password.mjs

FROM base AS production
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    DOSSIER_DATA_DIR=/data
# Chromium for PDFs with its system libraries and fonts, matching the app's
# playwright-core, as in the dev image. Its CLI is only mounted for this.
RUN --mount=type=bind,from=deps,source=/app/node_modules/playwright-core,target=/tmp/playwright-core \
  --mount=type=secret,id=proxy_ca \
  if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
  node /tmp/playwright-core/cli.js install --with-deps --only-shell chromium \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /tools ./tools
# On the PATH, so `docker run --rm -it ghcr.io/aientech/dossier hash-password` works.
RUN ln -s /app/tools/hash-password.mjs /usr/local/bin/hash-password
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Backups and export zips (mount a volume here); the server's own cache.
RUN mkdir -p /data .next/cache && chown node:node /data .next/cache \
  && chmod -R a+rX /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
COPY --chmod=755 docker/start.sh ./start.sh
# Migrations, the seed, then the server (E12-3).
CMD ["./start.sh"]

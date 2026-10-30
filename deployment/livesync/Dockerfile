# syntax=docker/dockerfile:1
FROM denoland/deno:2.9.7@sha256:fa335acdf6b72106eda2cb6a8cb5f4187e7630e357467489db4b2e7352d5e432 AS bridge
USER root
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ARG BRIDGE_COMMIT=fc0e028d33b3a12ddee1322951375e05107edc55
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export GIT_SSL_CAINFO=/run/secrets/proxy_ca; fi; \
    git init && git remote add origin https://github.com/vrtmrz/livesync-bridge.git && \
    git fetch --depth=1 origin "$BRIDGE_COMMIT" && git checkout --detach FETCH_HEAD
COPY deployment/livesync/path.ts deployment/livesync/posix.ts deployment/livesync/cli.ts ./dossier-compat/
RUN deno eval 'const p="deno.jsonc"; const c=JSON.parse(await Deno.readTextFile(p)); c.imports["@std/path"]="./dossier-compat/path.ts"; c.imports["@std/path/posix"]="./dossier-compat/posix.ts"; c.imports["@std/cli"]="./dossier-compat/cli.ts"; await Deno.writeTextFile(p,JSON.stringify(c,null,2));'
COPY deployment/livesync/deno.lock ./deno.lock
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export DENO_CERT=/run/secrets/proxy_ca; fi; \
    deno install --frozen && deno cache --frozen main.ts test/integration/PeerCouchDB.integration.ts test/integration/PeerStorage.e2e.ts
RUN mkdir -p /deno-dir/location_data /app/dat /app/data && chown -R deno:deno /app /deno-dir
USER deno
ENV LSB_CONFIG=/app/dat/config.json LSB_HEALTH_FILE=/tmp/lsb-health.json
HEALTHCHECK --interval=30s --start-period=60s CMD deno eval 'const h=JSON.parse(await Deno.readTextFile("/tmp/lsb-health.json")); if (Date.now()-h.ts>45000 || h.restartWorthy) Deno.exit(1)'
CMD ["deno", "task", "run"]

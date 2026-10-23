#!/usr/bin/env bash
set -euo pipefail
# All data, peers and databases are disposable; no user vault is mounted.
suffix="$(date +%s)-$$"
network="dossier-livesync-test-$suffix"
couch="dossier-couchdb-test-$suffix"
image="${LIVESYNC_TEST_IMAGE:-dossier-livesync:fc0e028d33b3}"
cleanup() { docker rm -f "$couch" >/dev/null 2>&1 || true; docker network rm "$network" >/dev/null 2>&1 || true; }
trap cleanup EXIT
build_options=()
run_options=()
if [ -n "${CODEX_PROXY_CERT:-}" ]; then
  build_options+=(--secret "id=proxy_ca,src=$CODEX_PROXY_CERT")
  run_options+=(--mount "type=bind,src=$CODEX_PROXY_CERT,dst=/run/proxy-ca.pem,readonly" -e DENO_CERT=/run/proxy-ca.pem)
fi
docker build "${build_options[@]}" -f deployment/livesync/Dockerfile -t "$image" .
docker network create "$network" >/dev/null
docker run -d --name "$couch" --network "$network" -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=synthetic-test-password couchdb:3.5.0@sha256:1c0a30a54535377bc9ae23f42efb1ca4e92abe796f78ec98b768ac1d5874cc1b >/dev/null
for attempt in {1..60}; do
  if docker exec "$couch" curl -fsS -u admin:synthetic-test-password http://127.0.0.1:5984/_up >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 60 ]; then docker logs --tail 30 "$couch"; exit 1; fi
  sleep 1
done
for database in _users _replicator _global_changes; do docker exec "$couch" curl -fsS -u admin:synthetic-test-password -X PUT "http://127.0.0.1:5984/$database" >/dev/null; done
docker run --rm --network "$network" "${run_options[@]}" \
  -e "NO_PROXY=$couch,${NO_PROXY:-}" -e "no_proxy=$couch,${NO_PROXY:-}" \
  -e "COUCHDB_URL=http://$couch:5984" -e COUCHDB_USERNAME=admin -e COUCHDB_PASSWORD=synthetic-test-password \
  --entrypoint deno "$image" task test:integration

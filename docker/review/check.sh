#!/bin/bash
set -euo pipefail
mkdir -p /review/reports
run() {
  local name="$1"; shift
  "$@" 2>&1 | tee "/review/reports/$name.log"
}
node --version
yarn --version
find fixtures -type f -print0 | sort -z | xargs -0 sha256sum > /review/reports/fixtures-before.sha256
run isolation yarn tsx docker/review/isolation.mts
run databases yarn tsx scripts/prepare-test-databases.mts
run lint yarn lint
run typecheck yarn typecheck
run tests yarn test --coverage --maxWorkers=2
run build yarn build
run upstream-browser yarn test:e2e --reporter=list --output=/review/reports/upstream-results
run markdown-browser yarn test:e2e:markdown --reporter=list --output=/review/reports/markdown-results
run restart yarn tsx docker/review/restart.mts
sha256sum --check /review/reports/fixtures-before.sha256 > /review/reports/fixtures-after.log

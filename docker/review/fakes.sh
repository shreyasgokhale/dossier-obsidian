#!/bin/bash
set -euo pipefail
node e2e/fake-ai.mts & ai=$!
node e2e/fake-jobs.mts & jobs=$!
node e2e/fake-google.mts & google=$!
trap 'kill "$ai" "$jobs" "$google" 2>/dev/null || true; wait || true' EXIT
trap 'exit 0' TERM INT
wait -n

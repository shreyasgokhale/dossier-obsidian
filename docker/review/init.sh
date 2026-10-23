#!/bin/bash
set -euo pipefail
mkdir -p /pg/18/docker /review/demo/{notes,resume,data} /review/reports
chown 70:70 /pg /pg/18 /pg/18/docker
chmod 700 /pg/18/docker
if [ ! -f /review/demo/.initialized ]; then
  cp -R /app/fixtures/notes/. /review/demo/notes/
  cp -R /app/fixtures/resume/. /review/demo/resume/
  touch /review/demo/.initialized
fi
chown -R 1000:1000 /review

#!/bin/sh
# Seed the cabinet's writable catalogue once; never overwrite moderated data.
set -eu
if [ ! -f "$CATALOG_FILE" ]; then
  cp /app/catalog-seed.json "$CATALOG_FILE"
fi
exec node artifacts/api-server/src/news-engine/server/news-server.js

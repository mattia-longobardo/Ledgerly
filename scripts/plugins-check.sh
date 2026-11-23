#!/bin/sh
# scripts/plugins-check.sh — the running plugins against the catalog of the official plugins
# (decision H28): the sha256 of `/app/server.mjs` in each plugin's container must be the `digest` of
# its entry in packages/domain/src/platform/plugins/catalog.json. The core has no Docker socket, so
# this check is the deploy's (`scripts/release.sh`, after the start) and the night's
# (`scripts/full-suite.sh`). It reads only: `docker exec <container> sha256sum`.
#
# Usage: sh scripts/plugins-check.sh
# Prints one line per plugin; exit 1 when a container is missing or runs another bundle.
set -eu
cd "$(dirname "$0")/.."

catalog=packages/domain/src/platform/plugins/catalog.json
# One line per entry: `<container> <digest>`; the container has the image's name (docker-compose.yml).
entries=$(node -e '
  const { plugins } = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  for (const entry of plugins) console.log(`${entry.image} ${entry.digest}`);
' "$catalog")

failed=0
while read -r container digest; do
  [ -n "$container" ] || continue
  found=$(docker exec "$container" sha256sum /app/server.mjs 2> /dev/null | cut -d' ' -f1 || true)
  if [ -z "$found" ]; then
    echo "$container: not running" >&2
    failed=1
  elif [ "sha256:$found" != "$digest" ]; then
    echo "$container: runs sha256:$found, the catalog says $digest" >&2
    failed=1
  else
    echo "$container: $digest"
  fi
done << END
$entries
END
exit "$failed"

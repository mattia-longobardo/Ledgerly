#!/bin/sh
# scripts/release-dump.sh — the folder of one release in `../Ledgerly-dumps/`, with its dump.
#
# Usage: sh scripts/release-dump.sh <release-id> [--no-dump]        e.g. `n1`, `r5f`
#
# Makes `<release-id>-<sha7>/` (sha7 of HEAD) beside this checkout, outside every repository:
#   ledgerly.dump         `pg_dump -Fc` of the `ledgerly` database
#   ledgerly.dump.sha256  its checksum
#   MANIFEST.txt          release, SHA, previous tag, date, last migration, the `pre-*` images
# and prints the folder on the last line, so a caller can put the numbers snapshot beside the dump.
# `--no-dump` makes the folder and the manifest only: a release with no migration and no data change
# still needs the folder for its snapshots.
#
# The dump is taken and verified (`pg_restore --list`) inside the running `ledgerly` container, which
# already has the client of the server's version and the connection in its environment: no secret is
# read here, none is on a command line. Folder 700, files 600, owner the caller (1000:1000).
# The dump holds encrypted credentials and personal data: it never leaves the server.
set -eu
cd "$(dirname "$0")/.."

release=${1:?usage: release-dump.sh <release-id> [--no-dump]}
mode=${2:-}
case "$release" in *[!a-z0-9-]* | "") echo "release id: lowercase letters, digits and hyphens only" >&2; exit 1 ;; esac

root=${LEDGERLY_DUMPS_DIR:-"$(dirname "$PWD")/Ledgerly-dumps"}
sha=$(git rev-parse HEAD)
folder="$root/$release-$(git rev-parse --short=7 HEAD)"

umask 077
mkdir -p "$root" "$folder"
chmod 700 "$root" "$folder"

entries=none
if [ "$mode" != "--no-dump" ]; then
  # shellcheck disable=SC2016 — the variable is the container's, not this shell's.
  docker exec ledgerly sh -c 'exec pg_dump -Fc --no-owner --no-privileges "$DATABASE_URL"' > "$folder/ledgerly.dump"
  entries=$(docker exec -i ledgerly pg_restore --list < "$folder/ledgerly.dump" | grep -c '^[0-9]')
  [ "$entries" -gt 0 ] || { echo "the dump lists no object: not a usable dump" >&2; exit 1; }
  (cd "$folder" && sha256sum ledgerly.dump > ledgerly.dump.sha256)
fi

{
  echo "release: $release"
  echo "sha: $sha"
  echo "previous_tag: $(git tag --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1)"
  echo "date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "last_migration: $(ls drizzle/*.sql | sort | tail -n 1 | xargs basename | cut -d_ -f1)"
  echo "dump_entries: $entries"
  echo "images:"
  docker images --format '{{.Repository}}:{{.Tag}}' | grep -E "^ledgerly[a-z-]*:pre-$release\$" | sed 's/^/  /' || true
} > "$folder/MANIFEST.txt"

chmod 600 "$folder"/*
echo "$folder"

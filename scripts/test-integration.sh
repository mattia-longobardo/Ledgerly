#!/bin/sh
# scripts/test-integration.sh — the integration project, on the homelab (`npm run test:integration`).
#
# The tests need a real Postgres and a real S3. There is no local development stack any more, so
# they run in throwaway Node containers on the homelab's internal network, in 4 shards (vitest
# `--shard`, by file) that run together, each against:
#   - its own database of the homelab's Postgres, `ledgerly_<n>_test` — never `ledgerly`, and not
#     `ledgerly_test` either, which the preview and `npm run perf` use: the global setup drops and
#     recreates the schemas of its database, and `test/truncate.ts` refuses any database whose name
#     does not end in `_test`;
#   - Silo, in the application's own bucket and under its own prefix `tests/<n>/` only: the
#     application's key may not create buckets, and some tests delete a whole folder of the prefix.
# The credentials are the application's own, read from `.env.homelab`; they are handed to the
# containers through their environment, never on a command line.
#
# The databases are made once (/home/mattia/docker/AGENTS.md, Postgres). One run at a time uses
# them: a second run waits for the first (lock below). LEDGERLY_TEST_SHARDS=<1-4> runs fewer shards.
# LEDGERLY_INTEGRATION_DATABASE=ledgerly_test_2 runs one shard on that database instead, under the
# prefix `tests/ledgerly_test_2/` and with its own lock: the database of the client stream
# (docs/design/rewrite-plan/08-agents.md §8.6), so that its runs never wait for or reset the others.
set -eu
cd "$(dirname "$0")/.."

SHARDS="${LEDGERLY_TEST_SHARDS:-4}"
case "$SHARDS" in
  1 | 2 | 3 | 4) ;;
  *) echo "LEDGERLY_TEST_SHARDS must be 1-4" >&2; exit 1 ;;
esac
database="${LEDGERLY_INTEGRATION_DATABASE:-}"
case "$database" in
  "") ;;
  ledgerly_test_2) SHARDS=1 ;;
  *) echo "LEDGERLY_INTEGRATION_DATABASE must be ledgerly_test_2 or unset" >&2; exit 1 ;;
esac

# LEDGERLY_ENV_FILE names the environment file of a checkout with no `.env.homelab` of its own.
env_file="${LEDGERLY_ENV_FILE:-.env.homelab}"
value() { sed -n "s/^$1=//p" "$env_file" | head -n 1 | sed -E "s/^'(.*)'\$/\\1/; s/^\"(.*)\"\$/\\1/"; }

database_url=$(value DATABASE_URL)
TEST_S3_ENDPOINT=$(value S3_ENDPOINT)
TEST_S3_REGION=$(value S3_REGION)
TEST_S3_ACCESS_KEY_ID=$(value S3_ACCESS_KEY_ID)
TEST_S3_SECRET_ACCESS_KEY=$(value S3_SECRET_ACCESS_KEY)
TEST_S3_BUCKET=$(value S3_BUCKET)
export TEST_S3_ENDPOINT TEST_S3_REGION TEST_S3_ACCESS_KEY_ID TEST_S3_SECRET_ACCESS_KEY TEST_S3_BUCKET

# Two runs on the same databases would reset each other's schemas: the second one waits.
exec 9>"/run/lock/ledgerly-integration${database:+-$database}.lock"
if ! flock -n 9; then
  echo "another integration run uses the test databases: waiting for it" >&2
  flock -w 1800 9
fi

# The output of each shard, printed when all of them are done: under `test-results/`, which the
# repository ignores.
logs=test-results/integration${database:+-$database}
rm -rf "$logs"
mkdir -p "$logs"

# shard <n> <vitest arguments…>
shard() {
  i=$1
  shift
  TEST_DATABASE_URL="${database_url%/*}/${database:-ledgerly_${i}_test}" TEST_S3_KEY_PREFIX="tests/${database:-$i}/" \
    docker run --rm --network db_internal \
    --user "$(id -u):$(id -g)" -e HOME=/tmp \
    -v "$PWD":/app -w /app \
    -e TEST_DATABASE_URL -e TEST_S3_KEY_PREFIX -e TEST_S3_ENDPOINT -e TEST_S3_REGION \
    -e TEST_S3_ACCESS_KEY_ID -e TEST_S3_SECRET_ACCESS_KEY -e TEST_S3_BUCKET \
    node:26-bookworm-slim npx vitest run --project integration \
    --shard="$i/$SHARDS" --passWithNoTests "$@"
}

pids=
n=1
while [ "$n" -le "$SHARDS" ]; do
  shard "$n" "$@" >"$logs/$n.log" 2>&1 &
  pids="$pids $!"
  n=$((n + 1))
done

# The line "Tests …" of a shard's summary, without colours.
tests() { sed 's/\x1b\[[0-9;]*m//g' "$logs/$1.log" | sed -n 's/^ *Tests  *//p' | tail -n 1; }

status=0
summary=
n=1
for pid in $pids; do
  if wait "$pid"; then result=ok; else result=FAILED; status=1; fi
  echo "===== integration shard $n/$SHARDS: $result"
  cat "$logs/$n.log"
  summary="$summary
  shard $n: $result, tests $(tests "$n" | grep . || echo none)"
  n=$((n + 1))
done
echo "===== integration: $([ "$status" -eq 0 ] && echo ok || echo FAILED)$summary"
exit "$status"

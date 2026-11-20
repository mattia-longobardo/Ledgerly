#!/bin/sh
# scripts/perf-on-test.sh — `npm run perf`: runs scripts/perf-probe.ts against `ledgerly_test`, never
# `ledgerly`, in several processes, and holds the best of them to the baseline
# (scripts/perf-compare.ts says why several). `npm run perf -- --write` records a new baseline.
#
# `npm run perf -- --queries` is the part of G9 that runs at every release (docs/testing.md): one
# process, and only the number of queries of each view and route is held to the baseline. The count
# is exact, so one sample says it; the times need the five processes and a quiet host.
set -eu
cd "$(dirname "$0")/.."
# How many processes one measure is the best of.
PROCESSES=5
queries_only=
case " $* " in *" --queries "*) PROCESSES=1; queries_only=1 ;; esac
# LEDGERLY_ENV_FILE names the environment file of a checkout with no `.env.homelab`; the full suite
# (scripts/full-suite.sh) measures on LEDGERLY_TEST_DATABASE, one of `ledgerly_<1-4>_test`, under
# the lock of the integration tests. The client stream measures on `ledgerly_test_2`, its own
# database (08-agents.md §8.6): LEDGERLY_TEST_DATABASE=ledgerly_test_2 npm run perf.
env_file="${LEDGERLY_ENV_FILE:-.env.homelab}"
value() { sed -n "s/^$1=//p" "$env_file" | head -n 1 | sed -E "s/^'(.*)'\$/\\1/; s/^\"(.*)\"\$/\\1/"; }
database_url=$(value DATABASE_URL)
DATABASE_URL="${database_url%/*}/${LEDGERLY_TEST_DATABASE:-ledgerly_test}"
case "$DATABASE_URL" in
  */ledgerly_test | */ledgerly_[1-4]_test | */ledgerly_test_2) ;;
  *) echo "refusing: not ledgerly_test, ledgerly_<1-4>_test or ledgerly_test_2" >&2; exit 1 ;;
esac
export DATABASE_URL

# The samples, one file per process: under `test-results/`, which the repository ignores.
samples=test-results/perf
rm -rf "$samples"
mkdir -p "$samples"

# The reference the noisy views are held to (perf-compare.ts, `ALTERNATED`): the highest release
# tag, or LEDGERLY_PERF_REFERENCE=<tag>, checked out with its own dependencies under `test-results/`.
# Its samples alternate with the code's, on the same database and the same minute of the host.
reference=
if [ -z "$queries_only" ]; then
  tag="${LEDGERLY_PERF_REFERENCE:-$(git tag --list 'v*' --sort=-v:refname | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | head -n 1)}"
  reference="test-results/perf-reference/$tag"
  if [ ! -f "$reference/node_modules/.package-lock.json" ]; then
    git worktree remove --force "$reference" 2>/dev/null || rm -rf "$reference"
    git worktree add --detach "$reference" "$tag" >&2
    (cd "$reference" && npm ci --ignore-scripts --no-audit --no-fund >&2)
  fi
fi

# `docker run --env-file` keeps the quotes around a quoted value, which Compose drops: the file is
# passed on stdin with one pair of quotes removed (as in `scripts/on-homelab.sh`). `-e DATABASE_URL`
# comes after it and wins: the test database, never the one in the file.
# script [-C <checkout>] <file> …: a script of this checkout, or of another one (the reference).
script() {
  checkout="$PWD"
  if [ "$1" = "-C" ]; then
    checkout="$PWD/$2"
    shift 2
  fi
  sed -E "s/^([A-Za-z_][A-Za-z0-9_]*)='(.*)'\$/\\1=\\2/; s/^([A-Za-z_][A-Za-z0-9_]*)=\"(.*)\"\$/\\1=\\2/" "$env_file" |
    docker run --rm -i --network db_internal \
    --user "$(id -u):$(id -g)" -e HOME=/tmp \
    --env-file /dev/stdin -e DATABASE_URL \
    -v "$checkout":/app -w /app \
    node:26-bookworm-slim node --expose-gc --conditions=react-server --import tsx "$@"
}
probe() { script scripts/perf-probe.ts "$@"; }
# Each sample on a vacuumed database (perf-vacuum.ts says why).
vacuum() { script scripts/perf-vacuum.ts; }

# The integration tests run on their own databases (scripts/test-integration.sh): the schema of
# `ledgerly_test` is brought to the checkout's migrations here, as the preview's seed does.
script scripts/migrate.ts

# One round: PROCESSES more samples, numbered after the ones that are there, each followed by one
# of the reference (`ref-<n>.json`): A B A B, never a series of one and then a series of the other.
round() {
  last=$(($1 + PROCESSES))
  process=$(($1 + 1))
  while [ "$process" -le "$last" ]; do
    # The two query plans are the same in every process: the first round's last one prints them.
    if [ "$process" -eq "$PROCESSES" ]; then plans=--plans; else plans=; fi
    vacuum
    probe --out "$samples/$process.json" $plans
    if [ -n "$reference" ]; then
      vacuum
      # The reference sees its own checkout only: it writes there, and the sample is moved here.
      script -C "$reference" scripts/perf-probe.ts --out sample.json
      mv "$reference/sample.json" "$samples/ref-$process.json"
    fi
    process=$((process + 1))
  done
}
compare() { node --import tsx scripts/perf-compare.ts "$@" "$samples"/*.json; }

round 0
if compare "$@"; then exit 0; fi
# A number of queries does not depend on the host: a second round would say the same.
[ -z "$queries_only" ] || exit 1
# The host is shared: a busy minute slows every process of a round alike. A second round, once, tells
# a busy minute from a slower step — the measure is still the best median, now of twice the samples.
echo "
G9: una seconda serie di $PROCESSES processi, per distinguere il carico dell'host da un peggioramento" >&2
round "$PROCESSES"
compare "$@"

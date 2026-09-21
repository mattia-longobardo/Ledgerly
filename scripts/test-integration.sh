#!/bin/sh
# scripts/test-integration.sh — the integration project, on the homelab (`npm run test:integration`).
#
# The tests need a real Postgres and a real S3. There is no local development stack any more, so
# they run in a throwaway Node container on the homelab's internal network, against:
#   - the separate `ledgerly_test` database of the homelab's Postgres — never `ledgerly`: the
#     global setup drops and recreates its schemas, and `test/truncate.ts` refuses any database
#     whose name does not end in `_test`;
#   - Silo, in the application's own bucket and under the `tests/` prefix only: the application's
#     key may not create buckets, and the one storage test writes, reads and deletes a single
#     object there.
# The credentials are the application's own, read from `.env.homelab`; they are handed to the
# container through its environment, never on a command line.
set -eu
cd "$(dirname "$0")/.."

value() { sed -n "s/^$1=//p" .env.homelab | head -n 1; }

database_url=$(value DATABASE_URL)
TEST_DATABASE_URL="${database_url%/*}/ledgerly_test"
TEST_S3_ENDPOINT=$(value S3_ENDPOINT)
TEST_S3_REGION=$(value S3_REGION)
TEST_S3_ACCESS_KEY_ID=$(value S3_ACCESS_KEY_ID)
TEST_S3_SECRET_ACCESS_KEY=$(value S3_SECRET_ACCESS_KEY)
TEST_S3_BUCKET=$(value S3_BUCKET)
export TEST_DATABASE_URL TEST_S3_ENDPOINT TEST_S3_REGION TEST_S3_ACCESS_KEY_ID TEST_S3_SECRET_ACCESS_KEY TEST_S3_BUCKET

case "$TEST_DATABASE_URL" in
  */ledgerly_test) ;;
  *) echo "refusing to run: the test database is not ledgerly_test" >&2; exit 1 ;;
esac

exec docker run --rm --network db_internal \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$PWD":/app -w /app \
  -e TEST_DATABASE_URL -e TEST_S3_ENDPOINT -e TEST_S3_REGION \
  -e TEST_S3_ACCESS_KEY_ID -e TEST_S3_SECRET_ACCESS_KEY -e TEST_S3_BUCKET \
  node:22-bookworm-slim npx vitest run --project integration "$@"

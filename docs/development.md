# Development

## Setup

You need Node.js `^22.13.0 || >=24` and Docker, on the homelab host.

```bash
npm install
cp .env.example .env.homelab   # then replace every value, see operations.md
```

There is no local development server. You build and deploy each change to
`https://dash.longobardo.me`, then check it there (see [operations.md](operations.md#deploy)).
For a dry run against the test database, see `scripts/preview-on-test.sh` and §10 of
[`design/funds-ux.md`](design/funds-ux.md).

## Code layout

| Path              | Contents                                               |
| ----------------- | ------------------------------------------------------ |
| `src/app`         | Routes (pages, Server Actions, API handlers).          |
| `src/modules/<x>` | One domain module per section (accounts, budgets, …).  |
| `src/platform`    | Shared services: database, auth, jobs, storage, MCP.   |
| `src/ui`          | Design system.                                         |
| `messages/`       | Interface text, in `en.json` and `it.json`.            |
| `drizzle/`        | Database migrations.                                   |
| `apps/worker`     | The worker: scheduler and queue of the jobs (R1).      |
| `tests/`          | End-to-end tests and test fixtures.                    |

## Rules for the code

- **Money** is `bigint` cents. **Unknown** is `null`. **Dates** go through `src/platform/dates.ts`.
- A module does not read another module's tables. It calls that module's service functions.
- Every query on user data is scoped with `userScoped(ctx)` (`src/platform/db/scope.ts`).
- No network calls (mail, S3, HTTP, AI) inside a database transaction.
- Every list query has a deterministic `ORDER BY`.
- Every text in the interface is in `messages/en.json` **and** `messages/it.json`.
- The AI fallback uses OpenAI only, and a person confirms every value it gives.

## Tests

Run before each commit:

```bash
npm run format && npm run lint && npm run typecheck && npm run format:check && npm test
```

| Command                    | What it does                                                                    |
| -------------------------- | ------------------------------------------------------------------------------- |
| `npm test`                 | Unit tests. Needs only Node.                                                    |
| `npm run test:integration` | Integration tests in 4 containers, against `ledgerly_<1-4>_test` and S3.        |
| `npm run e2e`              | End-to-end tests against the deployed site, with temporary test users.          |
| `npm run test:select`      | Prints the tests that a diff starts, as commands ([testing.md](testing.md)).    |
| `npm run perf`             | Times the heaviest views against a large test user. `-- --queries`: counts only.|
| `npm run docs:shots`       | Takes the screenshots in `docs/screenshots/` again. Run by hand.                |

Which of these a change needs is in [testing.md](testing.md): the map from the changed files to the
tests, the `@smoke` set and the local preview for the E2E tests.

### Integration tests

They run in 4 shards side by side (vitest `--shard`, by file), each in a temporary container on
the `db_internal` network, with its own database `ledgerly_<n>_test` and its own S3 prefix
`tests/<n>/`. Each shard drops and creates the schemas of its database on each run, so they must
never point at `ledgerly`. One run at a time uses the four databases: a second run waits for the
first (`/run/lock/ledgerly-integration.lock`). `LEDGERLY_TEST_SHARDS=<1-4>` runs fewer shards.
`ledgerly_test` stays for the local preview and `npm run perf`.

Before each test, `resetDatabase()` (`test/db.ts`) empties the tables that have rows and restarts
the sequences: each test starts from an empty schema, whatever the file before it left.

Create the test databases once, as the Postgres superuser:

```sql
CREATE DATABASE ledgerly_test OWNER ledgerly;
CREATE DATABASE ledgerly_1_test OWNER ledgerly;
CREATE DATABASE ledgerly_2_test OWNER ledgerly;
CREATE DATABASE ledgerly_3_test OWNER ledgerly;
CREATE DATABASE ledgerly_4_test OWNER ledgerly;
-- PUBLIC gets CONNECT by default: other roles of the shared Postgres must not connect.
REVOKE ALL ON DATABASE ledgerly_test, ledgerly_1_test, ledgerly_2_test, ledgerly_3_test,
  ledgerly_4_test FROM PUBLIC;
```

The databases of the parallel streams (`ledgerly_test_2`, `ledgerly_test_3`) are created the same
way: `CREATE DATABASE ... OWNER ledgerly;` and then `REVOKE ALL ON DATABASE ... FROM PUBLIC;`.

### End-to-end tests

Before the run, `scripts/seed-e2e.ts` creates test users on `@example.test` with invented data.
After the run, it deletes them and all their data. The tests never touch other users.

- The specs are in one folder per flow, `tests/e2e/<flow>/` (docs/testing.md, "The E2E flows").
- `tests/e2e/<flow>/a11y.spec.ts` checks every screen of the flow at 1440 and 400 px: no
  horizontal scroll, no text overflow, targets of at least 24 × 24 px, no accessibility errors
  (WCAG 2.1 AA; the rules about colour in both themes). When you add a screen, add it to the list
  of its flow in the same commit.
- `tests/e2e/<flow>/keyboard.spec.ts` uses the flow with the keyboard only.
- Flows that need a real mailbox or an Authentik login are not tested end to end.

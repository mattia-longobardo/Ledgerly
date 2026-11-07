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
| `cron/`           | The cron sidecar image.                                |
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
| `npm run test:integration` | Integration tests in a container, against the `ledgerly_test` database and S3.  |
| `npm run e2e`              | End-to-end tests against the deployed site, with temporary test users.          |
| `npm run perf`             | Times the heaviest views against a large test user. Run by hand.                |
| `npm run docs:shots`       | Takes the screenshots in `docs/screenshots/` again. Run by hand.                |

### Integration tests

They run in a temporary container on the `db_internal` network. They drop and create the schemas
of `ledgerly_test` on each run, so they must never point at `ledgerly`. In S3 they write only under
`tests/`.

Create the test database once, as the Postgres superuser:

```sql
CREATE DATABASE ledgerly_test OWNER ledgerly;
```

### End-to-end tests

Before the run, `scripts/seed-e2e.ts` creates test users on `@example.test` with invented data.
After the run, it deletes them and all their data. The tests never touch other users.

- `tests/e2e/a11y.spec.ts` checks every screen at 1440 and 400 px, in both themes: no horizontal
  scroll, no text overflow, targets of at least 24 × 24 px, no accessibility errors (WCAG 2.1 AA).
  When you add a screen, add it to this list in the same commit.
- `tests/e2e/keyboard.spec.ts` uses the whole app with the keyboard only.
- Flows that need a real mailbox or an Authentik login are not tested end to end.

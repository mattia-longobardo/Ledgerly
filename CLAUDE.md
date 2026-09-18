# Repository conventions

- The design and every binding decision: `docs/specs/2026-09-13-dev-0.1-design.md`. Phase plans: `docs/plans/`.
- `Fondo Cometa/`, `Payroll/` and `UI Recreation and branding decisions/` are the owner's local reference
  material: read-only, never committed, deleted at the end of development.
- Layout: `src/app` routes, `src/modules/<name>` domain modules, `src/platform` shared services, `src/ui` design system.
- Money is `bigint` cents, unknown is `null`, dates go through `src/platform/dates.ts`, services take `(ctx, input)`.
- Before committing: `npm run format && npm run lint && npm run typecheck && npm run format:check && npm test`.
- Modules never use `getDb().query` (the relational API) or import another module's `schema`/tables;
  cross-module access goes through the owning module's service functions. The one exemption
  (`src/architecture.test.ts`): a module's own `schema.ts` may import another module's `schema.ts`
  for a foreign-key reference.
- Every user-owned query is scoped with `userScoped(ctx)` (`src/platform/db/scope.ts`):
  `.owns(table)` for `WHERE`, `.stamp(values)` for inserts. No network I/O (mail, S3, HTTP, LLM)
  inside a database transaction — do it outside and apply the result in a short transaction. Every
  list query has a deterministic `ORDER BY`.
- Users-module Server Actions live in `src/modules/users/actions.ts`.
- The LLM fallback (later phases) is OpenAI only (spec D18): no other provider's SDK or configuration.
- There is no local dev server: changes are deployed to `https://dash.longobardo.me`
  (`docker compose build && docker compose up -d`) and checked there.
- One environment file, untracked: `.env.homelab`, which `docker-compose.yml` passes as `env_file`
  (shape in `.env.example`). No value may contain a `$`: Compose would interpolate and truncate it.
- Integration tests (`npm run test:integration`) run in a container on `db_internal` against the
  `ledgerly_test` database, never `ledgerly`. E2E (`npm run e2e`) drives the deployed site as
  `@example.test` users only, created before and deleted after the run; never touch real users' data.
- Every user-facing string is a next-intl message in `messages/en.json` **and** `messages/it.json`.
- Each phase appends its nav items in `src/app/(app)/navigation.ts`, its icons in `src/ui/shell/icons.ts`,
  its jobs in `src/platform/jobs/registry.ts`, its tables in `src/platform/db/tables.ts`.

# Repository conventions

- The design and every binding decision: `docs/specs/2026-09-13-dev-0.1-design.md`. Phase plans: `docs/plans/`.
- `Fondo Cometa/`, `Payroll/` and `UI Recreation and branding decisions/` are the owner's local reference
  material: read-only, never committed, deleted at the end of development.
- Layout: `src/app` routes, `src/modules/<name>` domain modules, `src/platform` shared services, `src/ui` design system.
- Money is `bigint` cents, unknown is `null`, dates go through `src/platform/dates.ts`, services take `(ctx, input)`.
- Before committing: `npm run lint && npm run typecheck && npm test`.
- Modules never use `getDb().query` (the relational API) or import another module's `schema`/tables;
  cross-module access goes through the owning module's service functions.
- Users-module Server Actions live in `src/modules/users/actions.ts`.
- The LLM fallback (later phases) is OpenAI only (spec D18): no other provider's SDK or configuration.
- Dev services (`npm run dev:services`, `compose.dev.yml`): Postgres `55432`, MinIO `59000`/`59001`,
  Mailpit SMTP `51025` / UI `58025`, mock OIDC `58090`.
- Every user-facing string is a next-intl message in `messages/en.json` **and** `messages/it.json`.
- Each phase appends its nav items in `src/app/(app)/navigation.ts`, its icons in `src/ui/shell/icons.ts`,
  its jobs in `src/platform/jobs/registry.ts`, its tables in `src/platform/db/tables.ts`.

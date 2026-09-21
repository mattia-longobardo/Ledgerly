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
- The LLM fallback is OpenAI only (spec D18): no other provider's SDK or configuration. It is a
  fallback and never the reader — a value it infers is marked `inferred` and a person must confirm
  or correct it before the document can be verified.
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

## What a screen has to be (F9)

`tests/e2e/a11y.spec.ts` measures **every** screen — pages, tabs, detail pages, overlays, the two
signed-out pages — at 1440 and 400 px, **in both themes**, against five rules; `npm run e2e` runs it.
A new screen joins that list in the same commit that adds it, and the seeded `layout` user gets the
data that makes it worth measuring, because a check run against an empty state measures an empty
state.

- Nothing reaches past the window, and the page never scrolls sideways. A table inside
  `overflow-x-auto` is **not** an exception: the container clips the picture, not the position.
  Where a table does not fit a phone, write it twice — `overflow-x-auto max-md:hidden` for the
  table, a `md:hidden` list below — with **the same controls in both**; nothing a wide screen
  offers may be missing from the narrow one.
- Below the breakpoint a `@4xl:grid-cols-…` grid is a single `auto` track, whose automatic minimum
  is the widest cell's `min-content` — the whole table, when a table is in it. Grid cells that can
  hold a table carry `min-w-0`.
- No text spills out of its container: deliberate truncation is `overflow: hidden` with `truncate`,
  and anything else is a fault.
- Every target is at least **24 × 24 px**, the height included — the words are 17 px tall, so an
  interactive `<a>` or `<button>` in a row needs `inline-flex min-h-6 items-center`. The one
  exception, written into the check and not left to judgement, is a link sitting inside a run of
  text (WCAG 2.2 §2.5.8).
- No axe violation on WCAG 2.1 A/AA, in **either** theme. Colour tokens are changed in pairs:
  `--faint` was fixed in the light theme in F7 and stayed broken in the dark one until F9.
- A destructive action asks first, and says afterwards **which** of the things it could do it did.
- Keyboard: `tests/e2e/keyboard.spec.ts`. Dialogs trap focus and give it back to whatever opened
  them, the focus is always drawn, menus walk with the arrows, Escape closes.

## The other commands

`npm run perf` times the widest views against a deliberately heavy user in `ledgerly_test` and
prints their query plans; `npm run docs:shots` takes the README's screenshots again, of the seeded
test user and never of real data. Both are run by hand, not by the gate.

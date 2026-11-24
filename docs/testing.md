# Which tests to run

A release tests the parts that it changed, not the whole application. This page says which tests a
changed file starts, and when each of them runs. The rules come from the workspace skill
`test-policy` (§1, §4, §6) and from the gates of the rewrite plan
([`design/rewrite-plan/03-releases.md`](design/rewrite-plan/03-releases.md) §3.1).

## The short version

```bash
npm run test:select                          # the release diff: highest tag vX.Y.Z → HEAD
npm run test:select -- origin/main...HEAD    # the work diff, before a push
npm run test:select -- --files <file> …      # a list of files
```

The command reads the diff with the map below and prints the commands to run, in order. It prints
`FULL SUITE`, with the reason, when a changed file is critical or is in no row of the map.

## What runs, and when

| When | What | Where |
|---|---|---|---|
| Every commit of a piece of work | `npm run format:check && npm run lint && npm run typecheck && npm test`, and the tests of the files of the commit | Local |
| One time, on the final SHA, before the deploy | The selection of the release diff: integration tests of the modules, `npm run perf -- --queries`, `npm run perf` only if the selection says so, the E2E flows and their screens, `@smoke` | Local; E2E on the local preview |
| After the deploy | `@smoke` (run by `scripts/release.sh`), then the `@site` tests of the selected specs | The deployed site |
| Each night and at the end of a phase (gate G10) | The full suite: `sh scripts/full-suite.sh` | Its own preview and `ledgerly_<1-4>_test` |

- **Always complete:** the static checks and `npm test` (about 90 s together). The unit tests are
  not selected: all of them run in 24 s.
- **Only the final SHA.** Do not run the selection on the intermediate commits, and do not run it
  again on a SHA where it is already green.
- **E2E one time.** The selected specs run on the local preview before the deploy. The site gets
  `@smoke` and the `@site` tests only.
- **The full suite** runs before a deploy only for a reason in the diff: a critical file, a file
  outside the map, or an impact that is not clear. Write the reason in the comment of the deploy.

## The map: changed files → module → command → used by

Each row gives the files, the module, the command that starts the tests of that module alone, and
"Used by": the modules and the E2E flows that import or show this code. The selection is the
module of each changed file, plus its "Used by". A file can be in more than one row (a `schema.ts`
is in the row of its module and in the row `data`): all its rows count.

- A module in "Used by" adds its integration tests. A flow in "Used by" (`e2e:<flow>`) adds the
  journeys of that flow: its specs, without its screens.
- The flows in the column "Command" are the module's own flows: their whole folder runs, the
  journeys and the flow's screens in `a11y`, `keyboard` and `mobile`.

| Changed files | Module | Command | Used by |
|---|---|---|---|
| `apps/web/src/modules/accounts/**`, `packages/domain/src/modules/accounts/**`, `apps/web/src/app/(app)/accounts/**`, `apps/web/src/app/(app)/page.tsx`, `apps/web/src/app/(app)/overview-screen.tsx`, `packages/domain/src/platform/iban*` | `accounts` | `sh scripts/test-integration.sh 'apps/web/src/modules/accounts' 'packages/domain/src/modules/accounts' 'apps/web/src/app/(app)/accounts'`<br>flow `accounts` | `e2e:addons`, `transactions`, `budgets`, `funds`, `interests`, `investments`, `pockets`, `subscriptions`, `api`, `jobs`, `export`, `connections`, `e2e:connections`, `e2e:transactions`, `e2e:investments`, `e2e:funds`, `e2e:budgets`, `e2e:subscriptions`, `e2e:api`, `e2e:categories`, `e2e:interests`, `users`, `admin`, `categories`, `e2e:pockets`, `fx`, `payroll` |
| `apps/web/src/modules/transactions/**`, `packages/domain/src/modules/transactions/**`, `apps/web/src/app/(app)/expenses/**`, `test/fixtures/categories/**` | `transactions` | `sh scripts/test-integration.sh 'apps/web/src/modules/transactions' 'packages/domain/src/modules/transactions' 'apps/web/src/app/(app)/expenses'`<br>flow `transactions`<br>flow `categories` | `categories`, `subscriptions`, `connections`, `budgets`, `interests`, `jobs`, `accounts`, `funds`, `investments`, `pockets`, `api`, `export`, `e2e:connections`, `e2e:interests`, `e2e:accounts`, `e2e:subscriptions`, `admin`, `e2e:funds`, `e2e:api` |
| `apps/web/src/app/(app)/settings/finance/**`, `apps/web/src/app/(app)/settings/finance/rules/**` | `categories` | `sh scripts/test-integration.sh 'apps/web/src/app/(app)/settings/finance'`<br>flow `categories` | `api`, `connections`, `e2e:connections`, `e2e:transactions` |
| `apps/web/src/modules/budgets/**`, `packages/domain/src/modules/budgets/**`, `apps/web/src/app/(app)/budgets/**` | `budgets` | `sh scripts/test-integration.sh 'apps/web/src/modules/budgets' 'packages/domain/src/modules/budgets'`<br>flow `budgets` | `jobs`, `categories`, `export`, `api`, `accounts`, `e2e:categories`, `e2e:pockets`, `e2e:accounts`, `e2e:transactions` |
| `apps/web/src/modules/pockets/**`, `packages/domain/src/modules/pockets/**`, `apps/web/src/app/(app)/pockets/**` | `pockets` | `sh scripts/test-integration.sh 'apps/web/src/modules/pockets' 'packages/domain/src/modules/pockets'`<br>flow `pockets` | `export`, `jobs`, `accounts`, `api`, `categories`, `e2e:accounts`, `e2e:shell`, `e2e:categories` |
| `apps/web/src/modules/subscriptions/**`, `packages/domain/src/modules/subscriptions/**`, `apps/web/src/app/(app)/subscriptions/**` | `subscriptions` | `sh scripts/test-integration.sh 'apps/web/src/modules/subscriptions' 'packages/domain/src/modules/subscriptions'`<br>flow `subscriptions` | `export`, `jobs`, `accounts`, `api`, `categories`, `investments`, `e2e:accounts`, `e2e:shell`, `e2e:categories` |
| `apps/web/src/modules/interests/**`, `packages/domain/src/modules/interests/**`, `apps/web/src/app/(app)/interests/**` | `interests` | `sh scripts/test-integration.sh 'apps/web/src/modules/interests' 'packages/domain/src/modules/interests'`<br>flow `interests` | `api`, `connections`, `pockets`, `funds`, `export`, `jobs`, `accounts`, `categories`, `e2e:accounts`, `e2e:connections`, `e2e:categories` |
| `apps/web/src/modules/funds/**`, `packages/domain/src/modules/funds/**`, `apps/web/src/app/(app)/funds/**` | `funds` | `sh scripts/test-integration.sh 'apps/web/src/modules/funds' 'packages/domain/src/modules/funds'`<br>flow `funds` | `investments`, `payroll`, `export`, `jobs`, `accounts`, `api`, `e2e:accounts`, `e2e:shell`, `e2e:investments` |
| `apps/web/src/modules/investments/**`, `packages/domain/src/modules/investments/**`, `apps/web/src/app/(app)/investments/**`, `packages/domain/src/platform/integrations/investments/**`, `packages/domain/src/platform/integrations/ccxt/**`, `packages/domain/src/platform/integrations/etoro/**`, `test/fixtures/investments/**` | `investments` | `sh scripts/test-integration.sh 'apps/web/src/modules/investments' 'packages/domain/src/modules/investments'`<br>flow `investments` | `funds`, `connections`, `api`, `accounts`, `export`, `jobs`, `e2e:funds`, `e2e:connections`, `e2e:accounts`, `e2e:api` |
| `packages/domain/src/modules/portfolio/**` | `portfolio` | — | `api`, `investments`, `e2e:investments`, `e2e:accounts` |
| `packages/domain/src/modules/instruments/**` | `instruments` | `sh scripts/test-integration.sh 'packages/domain/src/modules/instruments'` | `investments`, `connections`, `api`, `jobs`, `e2e:investments` |
| `apps/web/src/modules/payroll/**`, `packages/domain/src/modules/payroll/**`, `apps/web/src/app/(app)/payroll/**`, `test/fixtures/payroll/**` | `payroll` | `sh scripts/test-integration.sh 'apps/web/src/modules/payroll' 'packages/domain/src/modules/payroll'`<br>flow `payroll` | `funds`, `timeoff`, `export`, `imports`, `jobs`, `e2e:funds`, `api` |
| `apps/web/src/modules/imports/**`, `packages/domain/src/modules/imports/**`, `apps/web/src/app/document-kinds.ts` | `imports` | `sh scripts/test-integration.sh 'apps/web/src/modules/imports' 'packages/domain/src/modules/imports'` | `payroll`, `funds`, `api`, `export`, `jobs`, `e2e:payroll`, `e2e:api` |
| `apps/web/src/modules/timeoff/**`, `packages/domain/src/modules/timeoff/**`, `apps/web/src/app/(app)/timeoff/**`, `apps/web/src/platform/holidays/**`, `packages/domain/src/platform/holidays/**`, `test/fixtures/holidays.ts` | `timeoff` | `sh scripts/test-integration.sh 'apps/web/src/modules/timeoff' 'packages/domain/src/modules/timeoff' 'apps/web/src/platform/holidays' 'packages/domain/src/platform/holidays'`<br>flow `timeoff` | `connections`, `export`, `jobs`, `e2e:connections`, `api`, `payroll` |
| `apps/web/src/modules/users/**`, `packages/domain/src/modules/users/**`, `apps/web/src/app/(auth)/**`, `apps/web/src/app/(app)/settings/profile/**`, `apps/web/src/app/(app)/settings/security/**`, `apps/web/src/app/(app)/settings/users/**` | `users` | `sh scripts/test-integration.sh 'apps/web/src/modules/users' 'packages/domain/src/modules/users' 'apps/web/src/app/(app)/settings/profile' 'apps/web/src/app/(app)/settings/security' 'apps/web/src/app/(app)/settings/users'`<br>flow `auth`<br>flow `admin` | every integration test, `e2e:timeoff`, `e2e:addons` |
| `apps/web/src/platform/integrations/*`, `packages/domain/src/platform/integrations/*`, `packages/domain/src/platform/plugins/**`, `packages/plugin-contract/**`, `packages/plugin-host/**`, `packages/domain/src/platform/plugin-config*`, `plugins/**`, `apps/egress/**`, `scripts/plugins-catalog.ts`, `scripts/plugins-check.sh`, `tools/plugin-catalog.test.ts`, `apps/web/src/app/(app)/banks/**`, `apps/web/src/app/(app)/settings/plugins/**`, `apps/web/src/app/plugin-wiring.ts`, `apps/web/src/app/api/v1/plugins/**`, `test/fixtures/plugins/**`, `test/fixtures/wallet/**`, `test/fixtures/trek/**`, `test/fixtures/providers.ts` | `connections` | `sh scripts/test-integration.sh 'apps/web/src/platform/integrations' 'packages/domain/src/platform/integrations' 'packages/plugin-host/src' 'packages/domain/src/platform/plugins' 'apps/web/src/app/(app)/banks' 'apps/web/src/app/(app)/settings/plugins'`<br>flow `connections` | `api`, `e2e:api`, `accounts`, `transactions`, `jobs`, `investments`, `interests`, `timeoff`, `categories`, `admin`, `e2e:accounts`, `e2e:transactions`, `e2e:investments`, `e2e:admin`, `e2e:timeoff`, `e2e:categories`, `e2e:interests`, `users` |
| `apps/api/**`, `apps/web/src/platform/api/**`, `apps/web/src/platform/mcp/**`, `apps/web/src/app/api/v1/[[...route]]/**`, `apps/web/src/app/api/mcp/**`, `apps/web/src/app/.well-known/**`, `tools/baselines.itest.ts`, `baselines/numbers/**`, `baselines/contract/**` | `api` | `sh scripts/test-integration.sh 'apps/web/src/platform/api' 'apps/web/src/platform/mcp' 'tools/baselines.itest.ts'`<br>flow `api` | `investments`, `jobs`, `accounts`, `transactions`, `budgets`, `pockets`, `subscriptions`, `timeoff`, `interests`, `payroll`, `imports`, `funds`, `admin`, `categories`, `connections`, `users`, `export`, `e2e:accounts`, `e2e:admin`, `e2e:auth`, `e2e:categories`, `e2e:connections`, `npm run perf`, `e2e:transactions`, `e2e:investments` |
| `apps/web/src/platform/jobs/**`, `packages/domain/src/platform/jobs/**`, `packages/domain/src/platform/limits/**`, `apps/web/src/app/worker.ts`, `apps/worker/**`, `test/fixtures/embeddings/**`, `tools/convert-embeddings.test.ts`, `apps/web/src/app/api/health/**`, `apps/web/src/app/api/metrics/**` | `jobs` | `sh scripts/test-integration.sh 'apps/web/src/platform/jobs' 'packages/domain/src/platform/jobs' 'apps/worker/src'` | every integration test, `e2e:connections`, `e2e:admin`, `e2e:accounts`, `e2e:categories`, `e2e:transactions`, `e2e:investments` |
| `packages/domain/src/platform/settings/**`, `apps/web/src/app/(app)/settings/server/**`, `apps/web/src/platform/backup/**`, `apps/web/src/platform/reports/**` | `admin` | `sh scripts/test-integration.sh 'packages/domain/src/platform/settings' 'apps/web/src/platform/backup' 'apps/web/src/platform/reports' 'apps/web/src/app/(app)/settings/server'`<br>flow `admin` | `payroll`, `jobs`, `api`, `export`, `accounts`, `users`, `e2e:payroll`, `e2e:auth`, `e2e:api`, `e2e:accounts` |
| `apps/web/src/platform/export/**`, `apps/web/src/app/(app)/settings/data/**` | `export` | `sh scripts/test-integration.sh 'apps/web/src/platform/export' 'apps/web/src/app/(app)/settings/data'`<br>flow `api` | `subscriptions`, `jobs`, `admin`, `e2e:admin`, `e2e:subscriptions` |
| `packages/domain/src/platform/storage*` | `storage` | `sh scripts/test-integration.sh 'packages/domain/src/platform/storage.itest.ts' 'packages/domain/src/platform/storage-ensure-bucket.itest.ts'` | `imports`, `payroll`, `api`, `timeoff`, `users`, `admin`, `funds`, `export` |
| `drizzle/**`, `packages/domain/src/**/schema.ts`, `packages/domain/src/**/schema/*.ts`, `packages/domain/src/platform/db/**` | `data` | `sh scripts/test-integration.sh 'packages/domain/src/platform/db'` | every integration test, `npm run perf` |
| `apps/web/src/platform/fx/**`, `packages/domain/src/platform/fx/**` | `fx` | `sh scripts/test-integration.sh 'apps/web/src/platform/fx' 'packages/domain/src/platform/fx'` | every integration test, `npm run perf`, `e2e:accounts`, `e2e:investments`, `e2e:funds`, `e2e:admin`, `e2e:auth`, `e2e:addons` |
| `apps/web/src/**/queries.ts`, `packages/domain/src/**/queries.ts`, `packages/domain/src/**/*-queries.ts` | `queries` | — | `npm run perf`, `e2e:connections`, `e2e:transactions`, `payroll` |
| `packages/domain/src/modules/accounts/service/**`, `packages/domain/src/modules/accounts/queries/**`, `packages/domain/src/modules/accounts/rules/**`, `packages/domain/src/modules/transactions/service/**`, `packages/domain/src/modules/transactions/queries/**`, `packages/domain/src/modules/transactions/rules/**`, `packages/domain/src/platform/integrations/service/**`, `packages/domain/src/platform/integrations/rules.ts` | `shared-domain` | — | every integration test, `e2e:accounts`, `e2e:transactions`, `e2e:categories`, `e2e:connections`, `e2e:funds`, `e2e:interests`, `e2e:investments`, `e2e:pockets`, `e2e:timeoff`, `e2e:api` |
| `apps/web/src/ui/**`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/(app)/layout.tsx`, `apps/web/src/app/(app)/app-shell.tsx`, `apps/web/src/app/(app)/settings/layout.tsx`, `apps/web/src/app/(app)/settings/page.tsx`, `apps/web/src/app/globals.css`, `packages/design-tokens/**`, `packages/ui/**`, `packages/api-client/**`, `apps/static/**`, `apps/web/src/platform/route.ts`, `apps/web/src/platform/router.tsx`, `apps/web/src/platform/writes.ts`, `apps/web/src/platform/api-read.ts`, `apps/web/src/platform/say.ts`, `apps/web/src/platform/category-options.ts`, `scripts/tokens.ts`, `apps/web/src/app/error.tsx`, `apps/web/src/app/global-error.tsx`, `apps/web/src/app/not-found.tsx`, `apps/web/src/app/boundaries.test.tsx`, `apps/web/src/platform/theme*` | `interface` | — | `e2e:screens`, `e2e:transactions`, `e2e:shell` |
| `apps/web/src/app/(legal)/**`, `apps/web/src/app/manifest.webmanifest/**`, `apps/web/src/app/*.png`, `apps/web/src/app/icon.svg`, `apps/web/src/app/favicon.ico`, `scripts/icons.mjs`, `apps/web/src/app/(app)/navigation*`, `apps/web/src/app/(app)/palette-commands*` | `shell` | flow `shell` | `e2e:addons` |
| `apps/web/src/app/(app)/settings/addons/**`, `apps/web/src/app/(app)/settings/notifications/**`, `apps/web/src/app/(app)/addon-layout.tsx`, `apps/web/src/app/(app)/addons-context.tsx`, `apps/web/src/app/(app)/todo-card*`, `apps/web/src/app/(app)/settings/profile/hide-amounts*`, `packages/ui/src/hidden-amounts*`, `apps/web/src/app/(start)/**`, `apps/web/src/app/(app)/settings/profile/country-form*`, `apps/web/src/platform/country*` | `addons` | flow `addons` | `e2e:screens`, `e2e:interests` |
| `scripts/perf-*`, `baselines/performance.json` | `perf` | — | `npm run perf` |
| `scripts/seed-e2e.ts`, `scripts/seed-e2e/common.ts`, `tests/e2e/_shared/env.ts` | `e2e-data` | — | `e2e:*` |
| `scripts/seed-e2e/layout.ts` | `seed-layout` | flow `screens` | `e2e:*` |
| `scripts/seed-e2e/investments.ts` | `seed-investments` | flow `investments`<br>flow `connections` | — |
| `scripts/seed-e2e/transactions.ts` | `seed-transactions` | flow `transactions`<br>flow `categories` | — |
| `tests/e2e/_shared/a11y.ts`, `tests/e2e/_shared/keyboard.ts` | `screen-checks` | flow `screens` | — |
| `scripts/release.sh`, `scripts/release-dump.sh`, `scripts/numbers-*`, `scripts/snapshot-format.ts`, `scripts/on-homelab.sh`, `scripts/preview-on-test.sh`, `scripts/full-suite.sh`, `scripts/create-*`, `scripts/plugin-probe.ts`, `scripts/modularity.ts`, `scripts/duplication.ts`, `scripts/assertions-diff.ts`, `scripts/source-graph.ts`, `scripts/unused-exports.ts`, `scripts/cleanliness.ts`, `scripts/packages.ts`, `baselines/exports.json`, `scripts/cleanliness-rules.json`, `baselines/cleanliness.json`, `scripts/test-map.ts`, `scripts/test-select.ts`, `tools/architecture.test.ts`, `tools/cleanliness.test.ts`, `tools/tooling.test.ts`, `tools/release-script.test.ts`, `tools/web-env.test.ts`, `tools/test-map.test.ts`, `tools/contract.test.ts`, `tools/messages.test.ts`, `tools/glossary.test.ts`, `tools/server-actions.test.ts`, `scripts/server-actions.ts`, `baselines/server-actions.json`, `scripts/message-keys.ts`, `scripts/openapi.ts`, `baselines/modularity.json`, `baselines/duplication.json`, `baselines/assertions-exceptions.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.gitignore` | `tooling` | — | — |
| `docs/**`, `*.md`, `LICENSE`, `.env.example`, `tests/shots/**`, `playwright.shots.config.ts` | `docs` | — | — |
| `tests/e2e/_shared/funds.ts` | `funds-place` | flow `funds` | — |
| `tests/e2e/accounts/**`, `scripts/seed-e2e/accounts.ts` | `spec-accounts` | flow `accounts` | — |
| `tests/e2e/transactions/**` | `spec-transactions` | flow `transactions` | — |
| `tests/e2e/categories/**`, `scripts/seed-e2e/categories.ts` | `spec-categories` | flow `categories` | — |
| `tests/e2e/budgets/**`, `scripts/seed-e2e/budgets.ts` | `spec-budgets` | flow `budgets` | — |
| `tests/e2e/pockets/**`, `scripts/seed-e2e/pockets.ts` | `spec-pockets` | flow `pockets` | — |
| `tests/e2e/subscriptions/**`, `scripts/seed-e2e/subscriptions.ts` | `spec-subscriptions` | flow `subscriptions` | — |
| `tests/e2e/interests/**`, `scripts/seed-e2e/interests.ts` | `spec-interests` | flow `interests` | — |
| `tests/e2e/funds/**`, `scripts/seed-e2e/funds.ts` | `spec-funds` | flow `funds` | — |
| `tests/e2e/investments/**` | `spec-investments` | flow `investments` | — |
| `tests/e2e/payroll/**`, `scripts/seed-e2e/payroll.ts` | `spec-payroll` | flow `payroll` | — |
| `tests/e2e/timeoff/**`, `scripts/seed-e2e/timeoff.ts` | `spec-timeoff` | flow `timeoff` | — |
| `tests/e2e/connections/**`, `scripts/seed-e2e/connections.ts` | `spec-connections` | flow `connections` | — |
| `tests/e2e/auth/**` | `spec-auth` | flow `auth` | — |
| `tests/e2e/admin/**` | `spec-admin` | flow `admin` | — |
| `tests/e2e/api/**` | `spec-api` | flow `api` | — |
| `tests/e2e/shell/**` | `spec-shell` | flow `shell` | — |
| `tests/e2e/addons/**` | `spec-addons` | flow `addons` | — |

### The E2E flows

One flow is one folder, `tests/e2e/<flow>/`: the specs of its journeys, and its pieces of the
checks every flow has — `a11y.spec.ts` (its screens), `keyboard.spec.ts`, `mobile.spec.ts`. What
the folders share is in `tests/e2e/_shared/`: the users and the helpers, and the engines of the
three checks (`a11y.ts`, `keyboard.ts`). The selection is a filter by folder: no `-g`.
`-c playwright.preview.config.ts` runs against the local preview; without it the same command
runs against the deployed site.

| Flow | The whole flow: its folder | Its journeys alone (a module that uses it changed) |
|---|---|---|
| `accounts` | `npx playwright test -c playwright.preview.config.ts tests/e2e/accounts/` | `npx playwright test -c playwright.preview.config.ts accounts/accounts.spec.ts accounts/currency.spec.ts accounts/account-switch.spec.ts` |
| `transactions` | `npx playwright test -c playwright.preview.config.ts tests/e2e/transactions/` | `npx playwright test -c playwright.preview.config.ts transactions/expenses.spec.ts transactions/manual-movement.spec.ts transactions/manual-send.spec.ts transactions/wide.spec.ts` |
| `categories` | `npx playwright test -c playwright.preview.config.ts tests/e2e/categories/` | `npx playwright test -c playwright.preview.config.ts categories/categories.spec.ts categories/review.spec.ts categories/source-categories.spec.ts categories/rules.spec.ts` |
| `budgets` | `npx playwright test -c playwright.preview.config.ts tests/e2e/budgets/` | `npx playwright test -c playwright.preview.config.ts budgets/budgets.spec.ts` |
| `pockets` | `npx playwright test -c playwright.preview.config.ts tests/e2e/pockets/` | `npx playwright test -c playwright.preview.config.ts pockets/pockets.spec.ts` |
| `subscriptions` | `npx playwright test -c playwright.preview.config.ts tests/e2e/subscriptions/` | `npx playwright test -c playwright.preview.config.ts subscriptions/subscriptions.spec.ts` |
| `interests` | `npx playwright test -c playwright.preview.config.ts tests/e2e/interests/` | `npx playwright test -c playwright.preview.config.ts interests/interests.spec.ts` |
| `funds` | `npx playwright test -c playwright.preview.config.ts tests/e2e/funds/` | `npx playwright test -c playwright.preview.config.ts funds/funds.spec.ts funds/funds-detail.spec.ts funds/funds-home.spec.ts funds/funds-new.spec.ts funds/funds-payslip.spec.ts funds/funds-settings.spec.ts funds/funds-tabs.spec.ts` |
| `investments` | `npx playwright test -c playwright.preview.config.ts tests/e2e/investments/` | `npx playwright test -c playwright.preview.config.ts investments/investments.spec.ts investments/investments-home.spec.ts investments/investments-service.spec.ts investments/investments-groups.spec.ts investments/portfolio.spec.ts investments/plans.spec.ts` |
| `payroll` | `npx playwright test -c playwright.preview.config.ts tests/e2e/payroll/` | `npx playwright test -c playwright.preview.config.ts payroll/payroll.spec.ts payroll/manual.spec.ts` |
| `timeoff` | `npx playwright test -c playwright.preview.config.ts tests/e2e/timeoff/` | `npx playwright test -c playwright.preview.config.ts timeoff/timeoff.spec.ts timeoff/holidays.spec.ts` |
| `connections` | `npx playwright test -c playwright.preview.config.ts tests/e2e/connections/` | `npx playwright test -c playwright.preview.config.ts connections/connections.spec.ts connections/plugins.spec.ts connections/schedule.spec.ts` |
| `auth` | `npx playwright test -c playwright.preview.config.ts tests/e2e/auth/` | `npx playwright test -c playwright.preview.config.ts auth/auth.spec.ts auth/two-factor.spec.ts auth/preferences.spec.ts` |
| `admin` | `npx playwright test -c playwright.preview.config.ts tests/e2e/admin/` | `npx playwright test -c playwright.preview.config.ts admin/admin.spec.ts` |
| `api` | `npx playwright test -c playwright.preview.config.ts tests/e2e/api/` | `npx playwright test -c playwright.preview.config.ts api/security.spec.ts api/mcp.spec.ts` |
| `shell` | `npx playwright test -c playwright.preview.config.ts tests/e2e/shell/` | `npx playwright test -c playwright.preview.config.ts shell/install.spec.ts shell/legal.spec.ts` |
| `addons` | `npx playwright test -c playwright.preview.config.ts tests/e2e/addons/` | `npx playwright test -c playwright.preview.config.ts addons/addons.spec.ts addons/hide-amounts.spec.ts addons/welcome.spec.ts` |
| `screens` | `npx playwright test -c playwright.preview.config.ts a11y.spec.ts keyboard.spec.ts mobile.spec.ts` | — |

### Critical or shared code

A changed file of this list starts the full suite.

| Files | Why |
|---|---|
| `package.json`, `packages/*/package.json`, `package-lock.json`, `Dockerfile`, `.dockerignore`, `scripts/convert-embeddings.ts`, `models/**`, `entrypoint.sh`, `docker-compose.yml`, `apps/web/next.config.ts`, `apps/web/package.json`, `apps/api/package.json`, `apps/web/tsconfig.json`, `apps/web/postcss.config.mjs`, `tsconfig.json`, `drizzle.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `playwright.preview.config.ts`, `scripts/copy-pdfjs.mjs`, `scripts/migrate.ts`, `scripts/test-integration.sh`, `apps/web/src/global.d.ts`, `Makefile`, `.github/workflows/ci.yml`, `.github/dependabot.yml` | build, runtime and test configuration |
| `apps/web/src/proxy*`, `apps/web/src/instrumentation*`, `packages/domain/src/platform/env*`, `packages/domain/src/platform/context.ts`, `apps/web/src/platform/auth/**`, `packages/domain/src/platform/auth/**`, `apps/web/src/app/api/auth/**`, `apps/web/src/app/api/web/**`, `apps/web/src/app/api/v1/originals/**`, `apps/web/src/app/api/invite/**`, `apps/web/src/app/api/export.zip/**`, `packages/domain/src/platform/db/client.ts`, `packages/domain/src/platform/db/index.ts` | every request passes here |
| `packages/domain/src/shared/**`, `packages/format/**`, `packages/api-contract/**`, `packages/domain/src/platform/format*`, `packages/domain/src/platform/ranges.ts`, `apps/web/src/platform/i18n/**`, `packages/domain/src/platform/crypto*`, `packages/domain/src/platform/keyring.ts`, `packages/domain/src/platform/version.ts`, `apps/web/src/platform/next-version.ts`, `packages/domain/src/platform/mail.ts`, `packages/domain/src/platform/alerts/**`, `apps/web/src/platform/notifications/**`, `packages/domain/src/platform/notifications/**` | used by almost every module |
| `tests/e2e/_shared/helpers.ts`, `tests/e2e/_shared/global-setup.ts`, `tests/e2e/_shared/global-teardown.ts`, `tests/e2e/_shared/homelab.ts`, `tests/e2e/_shared/origin.ts`, `tests/e2e/_shared/totp.ts`, `test/*` | every test stands on it |

### Files that the selection reads from the diff

- `messages/*.json`: the selection reads which namespaces changed. A namespace belongs to the
  module that shows it (`funds` → `funds`, `settings.categories` → `categories`; the list is
  `MESSAGES` in `scripts/test-map.ts`). A namespace that is not in the list starts the full suite.
- `package.json` and `package-lock.json`: critical, except in the commit that closes a release,
  where the version number is the only change.
- `tests/e2e/<flow>/**`: a changed spec runs the folder of its flow. A release adds its screens
  to the `a11y.spec.ts` of its flow, not to another flow's.
- `tests/e2e/_shared/a11y.ts` and `keyboard.ts` (row `screen-checks`), and the common interface
  (row `interface`): every flow's `a11y`, `keyboard` and `mobile` run.
- The seed is one file per flow, `scripts/seed-e2e/<flow>.ts`: a changed one runs the folder of
  its flow (and of the flows it seeds users for). `layout.ts` seeds the user every screen is
  measured on: every flow runs. `scripts/seed-e2e.ts`, `scripts/seed-e2e/common.ts` and
  `tests/e2e/_shared/env.ts` (row `e2e-data`) run the journeys of every flow.
- A journey that changes its user's data has a user of its own, a copy made by the same seed
  function (`reviewJourney`, `manualJourney`, …): the screen check keeps the original, and no two
  specs change the same user.

## The E2E tests, one time, on the local preview

The preview is the image of the final SHA against `ledgerly_test`, on `127.0.0.1:3999`; the client
stream's runs against `ledgerly_test_2` with `LEDGERLY_TEST_DATABASE`, `LEDGERLY_PREVIEW_PORT` and
`LEDGERLY_PREVIEW_NAME`. `up` puts either on `ledgerly_plugins`, where the bank plugin is. Every
plugin of the catalog is configured on the preview: one the instance does not run yet (a plugin of
the checkout before its deploy) gets its container's address and a secret of the run, and the seed
registers the manifest of its source, so its pages exist. Prepare the browser first (`AGENTS.md`, "Deploy": `PLAYWRIGHT_BROWSERS_PATH`).

```bash
sh scripts/preview-on-test.sh build                      # ledgerly:preview, with its commit on it
sh scripts/preview-on-test.sh up ledgerly:preview        # on ledgerly_plugins; waits for the app, worker, plugins
sh scripts/preview-on-test.sh seed
export E2E_BASE_URL=http://localhost:3999
# … the E2E commands that `npm run test:select` printed …
sh scripts/preview-on-test.sh remove
sh scripts/preview-on-test.sh down                       # the image stays: the release starts it
```

A checkout with no `.env.homelab` names the file with `LEDGERLY_ENV_FILE`. A test that fails
midway can leave data on its user: run `seed` again before the next try.

- **Four workers.** `playwright.preview.config.ts` runs 4 workers, and the tests of a file side
  by side (`fullyParallel`): the whole suite takes about 7 minutes. A file whose tests are one
  story on one user says so with `test.describe.configure({ mode: "serial" })`; every other test
  has to pass in any order. The site keeps one worker (`playwright.config.ts`).
- **Every test passes here.** The preview is its own origin (`BETTER_AUTH_URL` is its address, in
  the container and in the seed), so a password sign-in, OAuth and the return of a plugin work.
  The seed adds one invented exchange rate when the table has none, never on the site. Each spec
  file that signs in with a password is a client of its own (`previewClient`,
  `tests/e2e/_shared/helpers.ts`): the limit of 5 sign-ins a minute counts for a file, not for the run.
  There is no red test to expect.
- **No date written by hand.** A spec takes today and the year from `TODAY`, `THIS_YEAR` and
  `LAST_YEAR` (`tests/e2e/_shared/helpers.ts`), in the time zone of the test users.
- **The image is built one time.** `preview-on-test.sh build` writes the commit on the image when
  the tree is clean. `scripts/release.sh` starts that image for the same commit and builds
  nothing; with no such image it builds the application as before. Remove `ledgerly:preview`
  after the release (`git-policy` §10).

### `@smoke` and `@site`

- **`@smoke`**: 16 tests of the main flows — the redirect of an anonymous visitor, the password
  sign-in, the manifest, `/api/v1` with no token, the command palette, and one screen of each area
  at the desktop width. They run for every release: on the preview before the deploy
  (`npx playwright test -c playwright.preview.config.ts -g @smoke`, under one minute) and
  on the site after it (`E2E_ORIGIN=127.0.0.1 npx playwright test -g @smoke`; `scripts/release.sh`
  does this as its last step, and a red test there is a failed deploy). `E2E_ORIGIN` sends them to
  Traefik's origin through a proxy of the run (`tests/e2e/_shared/origin.ts`), with the site's name
  and cookies, because Cloudflare's rate limit stops a run of them; the `@site` tests go there too.
- **`@site`**: the 11 tests about what differs between the preview and the site — a password
  sign-in through the proxy, OAuth, the real exchange rates, the return from a plugin. They run
  on the preview with every other test. After the deploy, run them on the site too, only for the
  specs that the selection names, with the commands it prints:
  `E2E_ORIGIN=127.0.0.1 npx playwright test <specs> -g @site`, at the site's origin as `@smoke`
  (through Cloudflare they hit its rate limit, `429`). The site allows 5 password sign-ins a minute to one
  client, and these tests spend 6: the selection prints two commands with `sleep 60` between them
  when one would pass the limit.

A new test gets `@smoke` only when it replaces one of the list: the set stays under one minute.

### What `a11y` measures (`tests/e2e/_shared/a11y.ts`)

Every screen at 1440 and 400 px. Funds is also measured at 768 and 375 px, on one screen of each
kind: the home, a fund's page, the form. The rules about colour (`color-contrast`,
`link-in-text-block`) run in both themes; the other rules of WCAG 2.1 A/AA run in the light theme,
because a theme changes colours only.

## The full suite (gate G10)

```bash
sh scripts/full-suite.sh      # about 12 minutes; exit 1 when a gate is red
```

It runs every gate, complete, on the commit of its checkout: G1 (format, lint, typecheck), G2 (`npm test`
and `assertions-diff` on the refactor commits since the highest tag), G4 (the share of duplicated lines of `scripts/duplication.ts` is not above the one of
`baselines/duplication.json`; the rules of
modularity are in `npm test`), G3 and G5 (the integration tests in 4 shards, `baselines.itest.ts`
included), G6 (every E2E spec, 4 workers) and G9 (`npm run perf`). The numbers snapshot of G5 reads
production: it is not here. The summary, with the result, the time and the load of each gate, and the
end of the output of a red gate, is printed and written to `test-results/full-suite/summary.md`.

- **Never production, never `ledgerly_test`.** The integration tests run on `ledgerly_<1-4>_test`
  with their lock. The preview and `npm run perf` then run on `ledgerly_1_test` under the same lock:
  an integration run of a release waits for them, and the suite waits for one that is running. The
  next integration run resets the database.
- **Beside a release.** The preview is `ledgerly-full-suite` on `127.0.0.1:3995`, image
  `ledgerly:full-suite`, S3 prefix `tests/full-suite/`: the release's `ledgerly-preview`, port 3999
  and image `ledgerly:preview` stay untouched. The script removes its preview, its users and its
  image at the end, also when it fails.
- **Its own checkout.** The seed writes `tests/e2e/.state/` in the checkout: run the suite in a
  checkout of its own, with `node_modules` (`npm ci`, or `cp -al` of a checkout with the same
  lockfile), `LEDGERLY_ENV_FILE` for the environment file and `PLAYWRIGHT_BROWSERS_PATH` for the
  browser (default `test-results/pw`).
- **A red night blocks the next deploy** until it is corrected or explained (plan, G10).

## Performance (gate G9)

- `npm run perf -- --queries`: the number of queries of each view and route, in one process
  (about 15 s). It runs at every release.
- `npm run perf`: the times, one series of 5 processes, on the final SHA. It runs only when the
  selection says so: the diff touches a `queries.ts`, a `schema.ts`, `drizzle/`,
  `src/platform/api`, `src/platform/db` or `src/platform/fx`. Run it with the host quiet.

Both bring `ledgerly_test` to the checkout's migrations first: the integration tests run on their
own databases (`ledgerly_<1-4>_test`), and `npm run perf` can run beside them. The client stream
measures on its own database: `LEDGERLY_TEST_DATABASE=ledgerly_test_2 npm run perf`. The second
server stream of R5 measures on `ledgerly_test_3`.

## Keep the map true

The map is `scripts/test-map.ts`; the tables above are printed from it
(`npm run test:select -- --doc`). `src/test-map.test.ts` runs with `npm test` and fails when:

- a file of the repository is in no row and not in the critical list;
- an integration test is not started by the command of a module;
- a spec is not in the folder of a flow, or the folder holds a spec the map does not name;
- a file imports a module, and the tests of that file are not in the "Used by" of the module;
- the tables of this page are not the ones the script prints.

When a change adds a module, a spec or an import between modules, update
`scripts/test-map.ts` and this page in the same commit.

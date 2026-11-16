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
|---|---|---|
| Every commit of a piece of work | `npm run format:check && npm run lint && npm run typecheck && npm test`, and the tests of the files of the commit | Local |
| One time, on the final SHA, before the deploy | The selection of the release diff: integration tests of the modules, `npm run perf -- --queries`, `npm run perf` only if the selection says so, the E2E flows and their screens, `@smoke` | Local; E2E on the local preview |
| After the deploy | `@smoke` (run by `scripts/release.sh`), then the `@site` tests of the selected specs | The deployed site |
| Each night and at the end of a phase (gate G10) | The full suite | Local preview and test database |

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
  specs of that flow.
- The flows in the column "Command" are the module's own flows: their specs run, and their
  screens run in the cross-cutting specs `a11y`, `keyboard` and `mobile`.

| Changed files | Module | Command | Used by |
|---|---|---|---|
| `src/modules/accounts/**`, `src/app/(app)/accounts/**`, `src/app/(app)/page.tsx` | `accounts` | `sh scripts/test-integration.sh 'src/modules/accounts'`<br>flow `accounts` | `transactions`, `budgets`, `funds`, `interests`, `investments`, `pockets`, `subscriptions`, `api`, `jobs`, `export`, `e2e:transactions`, `e2e:investments`, `e2e:funds`, `e2e:budgets`, `e2e:subscriptions`, `e2e:api`, `e2e:categories` |
| `src/modules/transactions/**`, `src/app/(app)/expenses/**`, `tests/fixtures/categories/**` | `transactions` | `sh scripts/test-integration.sh 'src/modules/transactions' 'src/app/(app)/expenses'`<br>flow `transactions`<br>flow `categories` | `categories`, `subscriptions`, `connections`, `budgets`, `interests`, `jobs`, `accounts`, `funds`, `investments`, `pockets`, `api`, `export`, `e2e:connections`, `e2e:interests`, `e2e:accounts`, `e2e:subscriptions` |
| `src/app/(app)/settings/categories/**` | `categories` | `sh scripts/test-integration.sh 'src/app/(app)/settings/categories'`<br>flow `categories` | — |
| `src/modules/budgets/**`, `src/app/(app)/budgets/**` | `budgets` | `sh scripts/test-integration.sh 'src/modules/budgets'`<br>flow `budgets` | `jobs`, `categories`, `export`, `api`, `e2e:categories`, `e2e:pockets`, `e2e:accounts` |
| `src/modules/pockets/**`, `src/app/(app)/pockets/**` | `pockets` | `sh scripts/test-integration.sh 'src/modules/pockets'`<br>flow `pockets` | `export`, `jobs`, `e2e:accounts`, `e2e:shell` |
| `src/modules/subscriptions/**`, `src/app/(app)/subscriptions/**` | `subscriptions` | `sh scripts/test-integration.sh 'src/modules/subscriptions'`<br>flow `subscriptions` | `export`, `jobs`, `e2e:accounts`, `e2e:shell` |
| `src/modules/interests/**`, `src/app/(app)/interests/**` | `interests` | `sh scripts/test-integration.sh 'src/modules/interests'`<br>flow `interests` | `pockets`, `funds`, `export`, `jobs`, `e2e:accounts` |
| `src/modules/funds/**`, `src/app/(app)/funds/**`, `tests/fixtures/cometa/**` | `funds` | `sh scripts/test-integration.sh 'src/modules/funds'`<br>flow `funds` | `investments`, `payroll`, `export`, `jobs`, `e2e:shell` |
| `src/modules/investments/**`, `src/app/(app)/investments/**`, `src/platform/integrations/investments/**`, `src/platform/integrations/ccxt/**`, `src/platform/integrations/etoro/**`, `test/fixtures/investments/**` | `investments` | `sh scripts/test-integration.sh 'src/modules/investments'`<br>flow `investments` | `funds`, `connections`, `api`, `accounts`, `export`, `e2e:funds`, `e2e:connections`, `e2e:accounts` |
| `src/modules/payroll/**`, `src/app/(app)/payroll/**`, `tests/fixtures/payroll/**` | `payroll` | `sh scripts/test-integration.sh 'src/modules/payroll'`<br>flow `payroll` | `funds`, `timeoff`, `export`, `imports`, `jobs`, `e2e:funds` |
| `src/modules/imports/**` | `imports` | `sh scripts/test-integration.sh 'src/modules/imports'` | `payroll`, `funds`, `api`, `export`, `jobs`, `e2e:payroll` |
| `src/modules/timeoff/**`, `src/app/(app)/timeoff/**`, `src/platform/holidays/**` | `timeoff` | `sh scripts/test-integration.sh 'src/modules/timeoff' 'src/platform/holidays'`<br>flow `timeoff` | `connections`, `export`, `jobs`, `e2e:connections` |
| `src/modules/users/**`, `src/app/(auth)/**`, `src/app/(app)/settings/profile/**`, `src/app/(app)/settings/security/**`, `src/app/(app)/settings/users/**` | `users` | `sh scripts/test-integration.sh 'src/modules/users'`<br>flow `auth`<br>flow `admin` | every integration test, `e2e:timeoff` |
| `src/platform/integrations/*`, `src/platform/integrations/wallet/**`, `src/platform/integrations/trek/**`, `src/platform/plugins/**`, `src/platform/plugin-config*`, `plugins/**`, `src/app/(app)/banks/**`, `src/app/(app)/settings/integrations/**`, `src/app/plugin-wiring.ts`, `src/app/api/v1/plugins/**`, `tests/fixtures/plugins/**`, `tests/fixtures/wallet/**` | `connections` | `sh scripts/test-integration.sh 'src/platform/integrations' 'src/platform/plugins' 'src/app/(app)/banks'`<br>flow `connections` | `accounts`, `transactions`, `jobs`, `investments`, `interests`, `timeoff`, `categories`, `admin`, `e2e:accounts`, `e2e:transactions`, `e2e:investments`, `e2e:admin`, `e2e:timeoff`, `e2e:categories` |
| `src/platform/api/**`, `src/platform/mcp/**`, `src/app/api/v1/[[...route]]/**`, `src/app/api/mcp/**`, `src/app/.well-known/**`, `src/baselines.itest.ts`, `baselines/numbers/**`, `baselines/contract/**` | `api` | `sh scripts/test-integration.sh 'src/platform/api' 'src/platform/mcp' 'src/baselines.itest.ts'`<br>flow `api` | `investments`, `accounts`, `transactions`, `imports`, `npm run perf` |
| `src/platform/jobs/**`, `src/app/api/jobs/**`, `src/app/api/health/**`, `src/app/api/metrics/**`, `cron/**` | `jobs` | `sh scripts/test-integration.sh 'src/platform/jobs'` | every integration test, `e2e:connections`, `e2e:admin` |
| `src/platform/settings/**`, `src/app/(app)/settings/server/**`, `src/platform/backup/**`, `src/platform/reports/**` | `admin` | `sh scripts/test-integration.sh 'src/platform/settings' 'src/platform/backup' 'src/platform/reports'`<br>flow `admin` | `payroll`, `jobs`, `api`, `export`, `accounts`, `users`, `e2e:payroll`, `e2e:auth` |
| `src/platform/export/**`, `src/app/(app)/settings/data/**` | `export` | `sh scripts/test-integration.sh 'src/platform/export'`<br>flow `api` | `subscriptions`, `jobs`, `e2e:admin`, `e2e:subscriptions` |
| `src/platform/storage*` | `storage` | `sh scripts/test-integration.sh 'src/platform/storage.itest.ts' 'src/platform/storage-ensure-bucket.itest.ts'` | `imports`, `payroll`, `api`, `timeoff`, `users`, `admin`, `funds`, `export` |
| `drizzle/**`, `src/**/schema.ts`, `src/platform/db/**` | `data` | `sh scripts/test-integration.sh 'src/platform/db'` | every integration test, `npm run perf` |
| `src/platform/fx/**` | `fx` | `sh scripts/test-integration.sh 'src/platform/fx'` | every integration test, `npm run perf`, `e2e:accounts`, `e2e:investments`, `e2e:funds`, `e2e:admin`, `e2e:auth` |
| `src/**/queries.ts`, `src/**/*-queries.ts` | `queries` | — | `npm run perf` |
| `src/modules/accounts/service.ts`, `src/modules/accounts/queries.ts`, `src/modules/accounts/rules.ts`, `src/modules/transactions/service.ts`, `src/modules/transactions/queries.ts`, `src/modules/transactions/rules.ts`, `src/platform/integrations/service.ts`, `src/platform/integrations/rules.ts` | `shared-domain` | — | every integration test, `e2e:accounts`, `e2e:transactions`, `e2e:categories`, `e2e:connections`, `e2e:funds`, `e2e:interests`, `e2e:investments`, `e2e:pockets`, `e2e:timeoff`, `e2e:api` |
| `src/ui/**`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/settings/layout.tsx`, `src/app/(app)/settings/page.tsx`, `src/app/(app)/settings/settings-tabs.tsx`, `src/app/globals.css`, `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/not-found.tsx`, `src/app/boundaries.test.tsx`, `src/platform/theme*` | `interface` | — | `e2e:screens`, `e2e:transactions`, `e2e:shell` |
| `src/app/(legal)/**`, `src/app/manifest.webmanifest/**`, `src/app/*.png`, `src/app/icon.svg`, `src/app/favicon.ico`, `scripts/icons.mjs`, `src/app/(app)/navigation*`, `src/app/(app)/palette-actions.ts` | `shell` | flow `shell` | — |
| `scripts/perf-*`, `baselines/performance.json` | `perf` | — | `npm run perf` |
| `scripts/seed-e2e.ts`, `tests/e2e/env.ts` | `e2e-data` | — | `e2e:*` |
| `scripts/release.sh`, `scripts/release-dump.sh`, `scripts/numbers-*`, `scripts/snapshot-format.ts`, `scripts/on-homelab.sh`, `scripts/preview-on-test.sh`, `scripts/create-*`, `scripts/plugin-probe.ts`, `scripts/fund-documents*`, `scripts/investments-cutoff.ts`, `scripts/modularity.ts`, `scripts/duplication.ts`, `scripts/assertions-diff.ts`, `scripts/source-graph.ts`, `scripts/test-map.ts`, `scripts/test-select.ts`, `src/architecture.test.ts`, `src/tooling.test.ts`, `src/release-script.test.ts`, `src/test-map.test.ts`, `baselines/modularity.json`, `baselines/duplication.json`, `baselines/assertions-exceptions.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.gitignore` | `tooling` | — | — |
| `docs/**`, `*.md`, `LICENSE`, `.env.example`, `tests/shots/**`, `playwright.shots.config.ts` | `docs` | — | — |
| `tests/e2e/accounts.spec.ts`, `tests/e2e/currency.spec.ts` | `spec-accounts` | — | `e2e:accounts` |
| `tests/e2e/expenses.spec.ts`, `tests/e2e/manual-movement.spec.ts`, `tests/e2e/wide.spec.ts` | `spec-transactions` | — | `e2e:transactions` |
| `tests/e2e/categories.spec.ts`, `tests/e2e/review.spec.ts` | `spec-categories` | — | `e2e:categories` |
| `tests/e2e/budgets.spec.ts` | `spec-budgets` | — | `e2e:budgets` |
| `tests/e2e/pockets.spec.ts` | `spec-pockets` | — | `e2e:pockets` |
| `tests/e2e/subscriptions.spec.ts` | `spec-subscriptions` | — | `e2e:subscriptions` |
| `tests/e2e/interests.spec.ts` | `spec-interests` | — | `e2e:interests` |
| `tests/e2e/funds.spec.ts`, `tests/e2e/funds-detail.spec.ts`, `tests/e2e/funds-home.spec.ts`, `tests/e2e/funds-new.spec.ts`, `tests/e2e/funds-payslip.spec.ts`, `tests/e2e/funds-settings.spec.ts`, `tests/e2e/funds-tabs.spec.ts` | `spec-funds` | — | `e2e:funds` |
| `tests/e2e/investments.spec.ts`, `tests/e2e/investments-home.spec.ts`, `tests/e2e/investments-service.spec.ts` | `spec-investments` | — | `e2e:investments` |
| `tests/e2e/payroll.spec.ts` | `spec-payroll` | — | `e2e:payroll` |
| `tests/e2e/timeoff.spec.ts`, `tests/e2e/holidays.spec.ts` | `spec-timeoff` | — | `e2e:timeoff` |
| `tests/e2e/connections.spec.ts`, `tests/e2e/plugins.spec.ts`, `tests/e2e/schedule.spec.ts` | `spec-connections` | — | `e2e:connections` |
| `tests/e2e/auth.spec.ts`, `tests/e2e/two-factor.spec.ts`, `tests/e2e/preferences.spec.ts` | `spec-auth` | — | `e2e:auth` |
| `tests/e2e/admin.spec.ts` | `spec-admin` | — | `e2e:admin` |
| `tests/e2e/security.spec.ts`, `tests/e2e/mcp.spec.ts` | `spec-api` | — | `e2e:api` |
| `tests/e2e/install.spec.ts`, `tests/e2e/legal.spec.ts` | `spec-shell` | — | `e2e:shell` |
| `tests/e2e/a11y.spec.ts`, `tests/e2e/keyboard.spec.ts`, `tests/e2e/mobile.spec.ts` | `spec-screens` | — | — |

### The E2E flows

One flow is a group of specs with one command. The third column is the command for the screens of
the flow in the cross-cutting specs. `-c playwright.preview.config.ts` runs against the local
preview; without it the same command runs against the deployed site.

| Flow | Command | Its screens in the cross-cutting specs |
|---|---|---|
| `accounts` | `npx playwright test -c playwright.preview.config.ts accounts currency` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/accounts\|new account dialog\|as layout / at\|sortable table'` |
| `transactions` | `npx playwright test -c playwright.preview.config.ts expenses manual-movement wide` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/expenses \(a manual\|as layout /expenses\|transaction dialog\|expenses on a phone\|row menu'` |
| `categories` | `npx playwright test -c playwright.preview.config.ts categories review` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/settings/categories\|/expenses/review\|/expenses \(automatic\|as review'` |
| `budgets` | `npx playwright test -c playwright.preview.config.ts budgets` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/budgets\|budgets on a phone'` |
| `pockets` | `npx playwright test -c playwright.preview.config.ts pockets` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/pockets\|pockets on a phone'` |
| `subscriptions` | `npx playwright test -c playwright.preview.config.ts subscriptions` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/subscriptions\|subscriptions on a phone'` |
| `interests` | `npx playwright test -c playwright.preview.config.ts interests` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/interests\|interests on a phone'` |
| `funds` | `npx playwright test -c playwright.preview.config.ts funds funds-detail funds-home funds-new funds-payslip funds-settings funds-tabs` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/funds\|fee dialog\|record contribution dialog\|source dialog\|value dialog of a fund\|[Ff]unds? \|a fund'` |
| `investments` | `npx playwright test -c playwright.preview.config.ts investments investments-home investments-service` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/investments\|connect (Binance\|eToro) dialog\|add manual account dialog\|replace key dialog\|disconnect dialog\|as layout the update value dialog at\|period picker of Investments\|service\|Positions'` |
| `payroll` | `npx playwright test -c playwright.preview.config.ts payroll` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/payroll\|rename payslip dialog'` |
| `timeoff` | `npx playwright test -c playwright.preview.config.ts timeoff holidays` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/timeoff\|leave panel\|[Tt]ime off'` |
| `connections` | `npx playwright test -c playwright.preview.config.ts connections plugins schedule` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/settings/integrations\|/banks\|from a connection\|bank credentials dialog\|sync schedule dialog\|replace key dialog\|disconnect dialog'` |
| `auth` | `npx playwright test -c playwright.preview.config.ts auth two-factor preferences` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/sign-in\|/forgot-password\|/settings/profile\|/settings/security'` |
| `admin` | `npx playwright test -c playwright.preview.config.ts admin` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/settings/(users\|server)\|/settings/data'` |
| `api` | `npx playwright test -c playwright.preview.config.ts security mcp` | — |
| `shell` | `npx playwright test -c playwright.preview.config.ts install legal` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile -g '/privacy\|/terms\|command palette\|mobile (More sheet\|navigation bar)\|phones get bottom tabs\|sidebar, the page\|a dialog takes the focus'` |
| `screens` | `npx playwright test -c playwright.preview.config.ts a11y keyboard mobile` | — |

### Critical or shared code

A changed file of this list starts the full suite.

| Files | Why |
|---|---|
| `package.json`, `package-lock.json`, `Dockerfile`, `.dockerignore`, `entrypoint.sh`, `docker-compose.yml`, `next.config.ts`, `postcss.config.mjs`, `tsconfig.json`, `drizzle.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `playwright.preview.config.ts`, `scripts/copy-pdfjs.mjs`, `scripts/migrate.ts`, `scripts/test-integration.sh`, `src/global.d.ts` | build, runtime and test configuration |
| `src/proxy*`, `src/instrumentation*`, `src/platform/env*`, `src/platform/context.ts`, `src/platform/auth/**`, `src/app/api/auth/**`, `src/platform/db/client.ts` | every request passes here |
| `src/platform/money*`, `src/platform/dates*`, `src/platform/format*`, `src/platform/ranges.ts`, `src/platform/i18n/**`, `src/platform/crypto*`, `src/platform/keyring.ts`, `src/platform/version.ts`, `src/platform/mail.ts`, `src/platform/alerts/**`, `src/platform/notifications/**` | used by almost every module |
| `tests/e2e/helpers.ts`, `tests/e2e/global-setup.ts`, `tests/e2e/global-teardown.ts`, `tests/e2e/homelab.ts`, `tests/e2e/totp.ts`, `test/*` | every test stands on it |

### Files that the selection reads from the diff

- `messages/*.json`: the selection reads which namespaces changed. A namespace belongs to the
  module that shows it (`funds` → `funds`, `settings.categories` → `categories`; the list is
  `MESSAGES` in `scripts/test-map.ts`). A namespace that is not in the list starts the full suite.
- `package.json` and `package-lock.json`: critical, except in the commit that closes a release,
  where the version number is the only change.
- `tests/e2e/a11y.spec.ts`, `keyboard.spec.ts`, `mobile.spec.ts`: a release adds its screens to
  these files. They run through the screens of the changed modules. They run whole when no module
  changed with them, and when the common interface changed (row `interface`).
- `scripts/seed-e2e.ts` and `tests/e2e/env.ts` (row `e2e-data`): each release adds the users of
  its flow there. The specs of every flow run; the screens of the changed modules only.

## The E2E tests, one time, on the local preview

The preview is the image of the final SHA against `ledgerly_test`, on `127.0.0.1:3999`. Prepare
the browser first (`AGENTS.md`, "Deploy": `PLAYWRIGHT_BROWSERS_PATH`).

```bash
docker build -t ledgerly:preview .
sh scripts/preview-on-test.sh up ledgerly:preview        # then wait for /api/health
docker network connect ledgerly_plugins ledgerly-preview # the plugin's manifest
sh scripts/preview-on-test.sh seed
export E2E_BASE_URL=http://localhost:3999
# … the E2E commands that `npm run test:select` printed …
sh scripts/preview-on-test.sh remove
sh scripts/preview-on-test.sh down && docker image rm ledgerly:preview
```

A checkout with no `.env.homelab` names the file with `LEDGERLY_ENV_FILE`. A test that fails
midway can leave data on its user: run `seed` again before the next try.

### `@smoke` and `@site`

- **`@smoke`**: 16 tests of the main flows — the redirect of an anonymous visitor, the password
  sign-in, the manifest, `/api/v1` with no token, the command palette, and one screen of each area
  at the desktop width. They run for every release: on the preview before the deploy
  (`npx playwright test -c playwright.preview.config.ts -g @smoke`, 15 tests, under one minute) and
  on the site after it (`npx playwright test -g @smoke`; `scripts/release.sh` does this as its
  last step, and a red test there is a failed deploy).
- **`@site`**: the 11 tests that the preview cannot run — a password sign-in (the origin of the
  preview is not trusted), OAuth, the exchange rates, the return from a plugin.
  `playwright.preview.config.ts` leaves them out. After the deploy, run them only for the specs
  that the selection names: `npx playwright test <specs> -g @site`.

A new test gets `@smoke` only when it replaces one of the list: the set stays under one minute.

## Performance (gate G9)

- `npm run perf -- --queries`: the number of queries of each view and route, in one process
  (about 15 s). It runs at every release.
- `npm run perf`: the times, one series of 5 processes, on the final SHA. It runs only when the
  selection says so: the diff touches a `queries.ts`, a `schema.ts`, `drizzle/`,
  `src/platform/api`, `src/platform/db` or `src/platform/fx`. Run it with the host quiet.

Both read the schema that the last integration run left in `ledgerly_test`: run them after the
integration tests.

## Keep the map true

The map is `scripts/test-map.ts`; the tables above are printed from it
(`npm run test:select -- --doc`). `src/test-map.test.ts` runs with `npm test` and fails when:

- a file of the repository is in no row and not in the critical list;
- an integration test or a spec is not started by the command of a module or of a flow;
- a file imports a module, and the tests of that file are not in the "Used by" of the module;
- a screen of `a11y`, `keyboard` or `mobile` belongs to no flow;
- the tables of this page are not the ones the script prints.

When a change adds a module, a spec, a screen or an import between modules, update
`scripts/test-map.ts` and this page in the same commit.

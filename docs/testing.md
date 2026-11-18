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
| `src/modules/accounts/**`, `src/app/(app)/accounts/**`, `src/app/(app)/page.tsx`, `src/platform/iban*` | `accounts` | `sh scripts/test-integration.sh 'src/modules/accounts' 'src/app/(app)/accounts'`<br>flow `accounts` | `transactions`, `budgets`, `funds`, `interests`, `investments`, `pockets`, `subscriptions`, `api`, `jobs`, `export`, `connections`, `e2e:connections`, `e2e:transactions`, `e2e:investments`, `e2e:funds`, `e2e:budgets`, `e2e:subscriptions`, `e2e:api`, `e2e:categories` |
| `src/modules/transactions/**`, `src/app/(app)/expenses/**`, `test/fixtures/categories/**` | `transactions` | `sh scripts/test-integration.sh 'src/modules/transactions' 'src/app/(app)/expenses'`<br>flow `transactions`<br>flow `categories` | `categories`, `subscriptions`, `connections`, `budgets`, `interests`, `jobs`, `accounts`, `funds`, `investments`, `pockets`, `api`, `export`, `e2e:connections`, `e2e:interests`, `e2e:accounts`, `e2e:subscriptions` |
| `src/app/(app)/settings/categories/**`, `src/app/(app)/settings/rules/**` | `categories` | `sh scripts/test-integration.sh 'src/app/(app)/settings/categories'`<br>flow `categories` | `e2e:connections`, `e2e:transactions` |
| `src/modules/budgets/**`, `src/app/(app)/budgets/**` | `budgets` | `sh scripts/test-integration.sh 'src/modules/budgets'`<br>flow `budgets` | `jobs`, `categories`, `export`, `api`, `accounts`, `e2e:categories`, `e2e:pockets`, `e2e:accounts`, `e2e:transactions` |
| `src/modules/pockets/**`, `src/app/(app)/pockets/**` | `pockets` | `sh scripts/test-integration.sh 'src/modules/pockets'`<br>flow `pockets` | `export`, `jobs`, `accounts`, `categories`, `e2e:accounts`, `e2e:shell`, `e2e:categories` |
| `src/modules/subscriptions/**`, `src/app/(app)/subscriptions/**` | `subscriptions` | `sh scripts/test-integration.sh 'src/modules/subscriptions'`<br>flow `subscriptions` | `export`, `jobs`, `accounts`, `categories`, `e2e:accounts`, `e2e:shell`, `e2e:categories` |
| `src/modules/interests/**`, `src/app/(app)/interests/**` | `interests` | `sh scripts/test-integration.sh 'src/modules/interests'`<br>flow `interests` | `connections`, `pockets`, `funds`, `export`, `jobs`, `accounts`, `categories`, `e2e:accounts`, `e2e:connections`, `e2e:categories` |
| `src/modules/funds/**`, `src/app/(app)/funds/**` | `funds` | `sh scripts/test-integration.sh 'src/modules/funds'`<br>flow `funds` | `investments`, `payroll`, `export`, `jobs`, `accounts`, `e2e:accounts`, `e2e:shell` |
| `src/modules/investments/**`, `src/app/(app)/investments/**`, `src/platform/integrations/investments/**`, `src/platform/integrations/ccxt/**`, `src/platform/integrations/etoro/**`, `test/fixtures/investments/**` | `investments` | `sh scripts/test-integration.sh 'src/modules/investments'`<br>flow `investments` | `funds`, `connections`, `api`, `accounts`, `export`, `e2e:funds`, `e2e:connections`, `e2e:accounts` |
| `src/modules/payroll/**`, `src/app/(app)/payroll/**`, `test/fixtures/payroll/**` | `payroll` | `sh scripts/test-integration.sh 'src/modules/payroll'`<br>flow `payroll` | `funds`, `timeoff`, `export`, `imports`, `jobs`, `e2e:funds` |
| `src/modules/imports/**` | `imports` | `sh scripts/test-integration.sh 'src/modules/imports'` | `payroll`, `funds`, `api`, `export`, `jobs`, `e2e:payroll` |
| `src/modules/timeoff/**`, `src/app/(app)/timeoff/**`, `src/platform/holidays/**` | `timeoff` | `sh scripts/test-integration.sh 'src/modules/timeoff' 'src/platform/holidays'`<br>flow `timeoff` | `connections`, `export`, `jobs`, `e2e:connections` |
| `src/modules/users/**`, `src/app/(auth)/**`, `src/app/(app)/settings/profile/**`, `src/app/(app)/settings/security/**`, `src/app/(app)/settings/users/**` | `users` | `sh scripts/test-integration.sh 'src/modules/users'`<br>flow `auth`<br>flow `admin` | every integration test, `e2e:timeoff` |
| `src/platform/integrations/*`, `src/platform/integrations/wallet/**`, `src/platform/integrations/trek/**`, `src/platform/plugins/**`, `src/platform/plugin-config*`, `plugins/**`, `src/app/(app)/banks/**`, `src/app/(app)/settings/integrations/**`, `src/app/plugin-wiring.ts`, `src/app/api/v1/plugins/**`, `test/fixtures/plugins/**`, `test/fixtures/wallet/**` | `connections` | `sh scripts/test-integration.sh 'src/platform/integrations' 'src/platform/plugins' 'src/app/(app)/banks' 'src/app/(app)/settings/integrations'`<br>flow `connections` | `accounts`, `transactions`, `jobs`, `investments`, `interests`, `timeoff`, `categories`, `admin`, `e2e:accounts`, `e2e:transactions`, `e2e:investments`, `e2e:admin`, `e2e:timeoff`, `e2e:categories` |
| `src/platform/api/**`, `src/platform/mcp/**`, `src/app/api/v1/[[...route]]/**`, `src/app/api/mcp/**`, `src/app/.well-known/**`, `src/baselines.itest.ts`, `baselines/numbers/**`, `baselines/contract/**` | `api` | `sh scripts/test-integration.sh 'src/platform/api' 'src/platform/mcp' 'src/baselines.itest.ts'`<br>flow `api` | `investments`, `accounts`, `transactions`, `imports`, `npm run perf` |
| `src/platform/jobs/**`, `src/app/api/jobs/**`, `src/app/api/health/**`, `src/app/api/metrics/**`, `cron/**` | `jobs` | `sh scripts/test-integration.sh 'src/platform/jobs'` | every integration test, `e2e:connections`, `e2e:admin`, `e2e:accounts` |
| `src/platform/settings/**`, `src/app/(app)/settings/server/**`, `src/platform/backup/**`, `src/platform/reports/**` | `admin` | `sh scripts/test-integration.sh 'src/platform/settings' 'src/platform/backup' 'src/platform/reports'`<br>flow `admin` | `payroll`, `jobs`, `api`, `export`, `accounts`, `users`, `e2e:payroll`, `e2e:auth` |
| `src/platform/export/**`, `src/app/(app)/settings/data/**` | `export` | `sh scripts/test-integration.sh 'src/platform/export'`<br>flow `api` | `subscriptions`, `jobs`, `e2e:admin`, `e2e:subscriptions` |
| `src/platform/storage*` | `storage` | `sh scripts/test-integration.sh 'src/platform/storage.itest.ts' 'src/platform/storage-ensure-bucket.itest.ts'` | `imports`, `payroll`, `api`, `timeoff`, `users`, `admin`, `funds`, `export` |
| `drizzle/**`, `src/**/schema.ts`, `src/platform/db/**` | `data` | `sh scripts/test-integration.sh 'src/platform/db'` | every integration test, `npm run perf` |
| `src/platform/fx/**` | `fx` | `sh scripts/test-integration.sh 'src/platform/fx'` | every integration test, `npm run perf`, `e2e:accounts`, `e2e:investments`, `e2e:funds`, `e2e:admin`, `e2e:auth` |
| `src/**/queries.ts`, `src/**/*-queries.ts` | `queries` | — | `npm run perf`, `e2e:connections`, `e2e:transactions` |
| `src/modules/accounts/service.ts`, `src/modules/accounts/queries.ts`, `src/modules/accounts/rules.ts`, `src/modules/transactions/service.ts`, `src/modules/transactions/queries.ts`, `src/modules/transactions/rules.ts`, `src/platform/integrations/service.ts`, `src/platform/integrations/rules.ts` | `shared-domain` | — | every integration test, `e2e:accounts`, `e2e:transactions`, `e2e:categories`, `e2e:connections`, `e2e:funds`, `e2e:interests`, `e2e:investments`, `e2e:pockets`, `e2e:timeoff`, `e2e:api` |
| `src/ui/**`, `src/app/layout.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/settings/layout.tsx`, `src/app/(app)/settings/page.tsx`, `src/app/(app)/settings/settings-tabs.tsx`, `src/app/globals.css`, `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/not-found.tsx`, `src/app/boundaries.test.tsx`, `src/platform/theme*` | `interface` | — | `e2e:screens`, `e2e:transactions`, `e2e:shell` |
| `src/app/(legal)/**`, `src/app/manifest.webmanifest/**`, `src/app/*.png`, `src/app/icon.svg`, `src/app/favicon.ico`, `scripts/icons.mjs`, `src/app/(app)/navigation*`, `src/app/(app)/palette-actions.ts`, `src/app/(app)/palette-commands*` | `shell` | flow `shell` | — |
| `scripts/perf-*`, `baselines/performance.json` | `perf` | — | `npm run perf` |
| `scripts/seed-e2e.ts`, `scripts/seed-e2e/common.ts`, `tests/e2e/_shared/env.ts` | `e2e-data` | — | `e2e:*` |
| `scripts/seed-e2e/layout.ts` | `seed-layout` | flow `screens` | `e2e:*` |
| `scripts/seed-e2e/investments.ts` | `seed-investments` | flow `investments`<br>flow `connections` | — |
| `scripts/seed-e2e/transactions.ts` | `seed-transactions` | flow `transactions`<br>flow `categories` | — |
| `tests/e2e/_shared/a11y.ts`, `tests/e2e/_shared/keyboard.ts` | `screen-checks` | flow `screens` | — |
| `scripts/release.sh`, `scripts/release-dump.sh`, `scripts/numbers-*`, `scripts/snapshot-format.ts`, `scripts/on-homelab.sh`, `scripts/preview-on-test.sh`, `scripts/full-suite.sh`, `scripts/create-*`, `scripts/plugin-probe.ts`, `scripts/modularity.ts`, `scripts/duplication.ts`, `scripts/assertions-diff.ts`, `scripts/source-graph.ts`, `scripts/test-map.ts`, `scripts/test-select.ts`, `src/architecture.test.ts`, `src/tooling.test.ts`, `src/release-script.test.ts`, `src/test-map.test.ts`, `baselines/modularity.json`, `baselines/duplication.json`, `baselines/assertions-exceptions.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.gitignore` | `tooling` | — | — |
| `docs/**`, `*.md`, `LICENSE`, `.env.example`, `tests/shots/**`, `playwright.shots.config.ts` | `docs` | — | — |
| `tests/e2e/accounts/**`, `scripts/seed-e2e/accounts.ts` | `spec-accounts` | flow `accounts` | — |
| `tests/e2e/transactions/**` | `spec-transactions` | flow `transactions` | — |
| `tests/e2e/categories/**`, `scripts/seed-e2e/categories.ts` | `spec-categories` | flow `categories` | — |
| `tests/e2e/budgets/**`, `scripts/seed-e2e/budgets.ts` | `spec-budgets` | flow `budgets` | — |
| `tests/e2e/pockets/**`, `scripts/seed-e2e/pockets.ts` | `spec-pockets` | flow `pockets` | — |
| `tests/e2e/subscriptions/**`, `scripts/seed-e2e/subscriptions.ts` | `spec-subscriptions` | flow `subscriptions` | — |
| `tests/e2e/interests/**`, `scripts/seed-e2e/interests.ts` | `spec-interests` | flow `interests` | — |
| `tests/e2e/funds/**`, `scripts/seed-e2e/funds.ts` | `spec-funds` | flow `funds` | — |
| `tests/e2e/investments/**` | `spec-investments` | flow `investments` | — |
| `tests/e2e/payroll/**` | `spec-payroll` | flow `payroll` | — |
| `tests/e2e/timeoff/**`, `scripts/seed-e2e/timeoff.ts` | `spec-timeoff` | flow `timeoff` | — |
| `tests/e2e/connections/**`, `scripts/seed-e2e/connections.ts` | `spec-connections` | flow `connections` | — |
| `tests/e2e/auth/**` | `spec-auth` | flow `auth` | — |
| `tests/e2e/admin/**` | `spec-admin` | flow `admin` | — |
| `tests/e2e/api/**` | `spec-api` | flow `api` | — |
| `tests/e2e/shell/**` | `spec-shell` | flow `shell` | — |

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
| `investments` | `npx playwright test -c playwright.preview.config.ts tests/e2e/investments/` | `npx playwright test -c playwright.preview.config.ts investments/investments.spec.ts investments/investments-home.spec.ts investments/investments-service.spec.ts` |
| `payroll` | `npx playwright test -c playwright.preview.config.ts tests/e2e/payroll/` | `npx playwright test -c playwright.preview.config.ts payroll/payroll.spec.ts` |
| `timeoff` | `npx playwright test -c playwright.preview.config.ts tests/e2e/timeoff/` | `npx playwright test -c playwright.preview.config.ts timeoff/timeoff.spec.ts timeoff/holidays.spec.ts` |
| `connections` | `npx playwright test -c playwright.preview.config.ts tests/e2e/connections/` | `npx playwright test -c playwright.preview.config.ts connections/connections.spec.ts connections/plugins.spec.ts connections/schedule.spec.ts` |
| `auth` | `npx playwright test -c playwright.preview.config.ts tests/e2e/auth/` | `npx playwright test -c playwright.preview.config.ts auth/auth.spec.ts auth/two-factor.spec.ts auth/preferences.spec.ts` |
| `admin` | `npx playwright test -c playwright.preview.config.ts tests/e2e/admin/` | `npx playwright test -c playwright.preview.config.ts admin/admin.spec.ts` |
| `api` | `npx playwright test -c playwright.preview.config.ts tests/e2e/api/` | `npx playwright test -c playwright.preview.config.ts api/security.spec.ts api/mcp.spec.ts` |
| `shell` | `npx playwright test -c playwright.preview.config.ts tests/e2e/shell/` | `npx playwright test -c playwright.preview.config.ts shell/install.spec.ts shell/legal.spec.ts` |
| `screens` | `npx playwright test -c playwright.preview.config.ts a11y.spec.ts keyboard.spec.ts mobile.spec.ts` | — |

### Critical or shared code

A changed file of this list starts the full suite.

| Files | Why |
|---|---|
| `package.json`, `package-lock.json`, `Dockerfile`, `.dockerignore`, `entrypoint.sh`, `docker-compose.yml`, `next.config.ts`, `postcss.config.mjs`, `tsconfig.json`, `drizzle.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `playwright.preview.config.ts`, `scripts/copy-pdfjs.mjs`, `scripts/migrate.ts`, `scripts/test-integration.sh`, `src/global.d.ts` | build, runtime and test configuration |
| `src/proxy*`, `src/instrumentation*`, `src/platform/env*`, `src/platform/context.ts`, `src/platform/auth/**`, `src/app/api/auth/**`, `src/platform/db/client.ts` | every request passes here |
| `src/platform/money*`, `src/platform/dates*`, `src/platform/format*`, `src/platform/ranges.ts`, `src/platform/i18n/**`, `src/platform/crypto*`, `src/platform/keyring.ts`, `src/platform/version.ts`, `src/platform/mail.ts`, `src/platform/alerts/**`, `src/platform/notifications/**` | used by almost every module |
| `tests/e2e/_shared/helpers.ts`, `tests/e2e/_shared/global-setup.ts`, `tests/e2e/_shared/global-teardown.ts`, `tests/e2e/_shared/homelab.ts`, `tests/e2e/_shared/totp.ts`, `test/*` | every test stands on it |

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

The preview is the image of the final SHA against `ledgerly_test`, on `127.0.0.1:3999`. Prepare
the browser first (`AGENTS.md`, "Deploy": `PLAYWRIGHT_BROWSERS_PATH`).

```bash
sh scripts/preview-on-test.sh build                      # ledgerly:preview, with its commit on it
sh scripts/preview-on-test.sh up ledgerly:preview        # then wait for /api/health
docker network connect ledgerly_plugins ledgerly-preview # the plugin's manifest
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
  on the site after it (`npx playwright test -g @smoke`; `scripts/release.sh` does this as its
  last step, and a red test there is a failed deploy).
- **`@site`**: the 11 tests about what differs between the preview and the site — a password
  sign-in through the proxy, OAuth, the real exchange rates, the return from a plugin. They run
  on the preview with every other test. After the deploy, run them on the site too, only for the
  specs that the selection names, with the commands it prints:
  `npx playwright test <specs> -g @site`. The site allows 5 password sign-ins a minute to one
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
- **Beside a release.** The preview is `ledgerly-full-suite` on `127.0.0.1:3998`, image
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
own databases (`ledgerly_<1-4>_test`), and `npm run perf` can run beside them.

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

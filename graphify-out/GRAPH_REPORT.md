# Graph Report - personal-dashboard  (2026-09-05)

## Corpus Check
- 632 files · ~599,878 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3979 nodes · 11599 edges · 170 communities (162 shown, 8 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 103 edges (avg confidence: 0.68)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a45ac459`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- format.ts
- [slug]/page.tsx
- cn
- auth/principal.ts
- sweep.ts
- trek.ts
- accounts/api/routes.ts
- Finance & Company Platform — Design and Phased Plan
- AccountsTable.tsx
- parse.ts
- wallet-refresh.ts
- compilerOptions
- PageGrid.tsx
- preview/page.tsx
- succeed
- rules.ts
- ingest.ts
- AccountGroup
- wallet.ts
- time.ts
- dependencies
- devDependencies
- 11. Phased implementation plan
- Phase 2 — The integration framework
- load-interests.ts
- IntegrationConnection
- actions/payroll.ts
- confidence.ts
- actions/integrations.ts
- repo/leave.ts
- llm.ts
- Phase 1 — Accounts and Teable retirement
- resolve.ts
- cometa.ts
- vacation-fund.ts
- validate-teable-migration.ts
- http.ts
- staleness.ts
- accounts/application/ports.ts
- trek.test.ts
- expenses/api/routes.ts
- 5. Data model
- trek-sync.test.ts
- create-interest-rule.ts
- toCents
- Finance Dashboard — Brand System
- teamsystem.ts
- trek-sync-job.test.ts
- time-off/page.tsx
- payroll/api/routes.ts
- render-brand-icons.py
- schema/index.ts
- teable-import.ts
- wallet-adapter.ts
- payroll/infrastructure/memory-repositories.ts
- AGENTS.md
- machine.ts
- integrations/api/routes.ts
- Mod. Cedolino TS Layout
- middleware.ts
- CLAUDE.md
- scripts
- August 2026 OCR Fixture (Paperless-ngx text)
- list-transactions.ts
- End-to-end tests
- Transaction
- wallet-provider-adapter.ts
- PayrollImport
- run-sync.ts
- dashboard-app service
- create-import.ts
- 7. Domain designs (what each section computes)
- August 2026 PDF-Text Fixture (clean layout)
- payroll-ingest.ts
- SyncRun
- require-principal.ts
- interests/api/routes.ts
- Real Payslip Fixture: Agosto 2026
- OverviewClient.tsx
- Code 8992 - TRATTAMENTO INT. DL 3/20
- IMPONIBILE IRPEF
- Real Payslip Fixture: Maggio 2026 (doc 102, welfare)
- Real Payslip Fixture: 13a Mensilita 2025 (doc 13)
- Code 300 - ASSENZA X FERIE A.C.(hh)
- Compose healthchecks and autoheal labels
- interests/api/routes.itest.ts
- package.json
- permissionsForRoles
- next.config.ts
- (app)/page.tsx
- app.ts
- entrypoint.sh
- accounts/[id]/page.tsx
- Checkpoint: Phase 0 + Phase 1 complete (2026-09-03)
- Code 9837 - IMPONIBILE 5% L.199/25
- requirePrincipalOrRedirect
- SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md
- contracts.ts
- { GET, POST }
- ADDIZIONALE COMUNALE
- payroll/application/ports.ts
- TransactionCategory
- File Structure
- SyncKind
- PayrollRecord
- ProviderLinksRepository
- integrations/types.ts
- load-transactions.ts
- expenses/application/ports.ts
- Teable migration
- InterestRule
- interests/infrastructure/memory-repositories.ts
- expenses/infrastructure/memory-repositories.ts
- Phase 1 deployment runbook — accounts and Teable retirement
- text.ts
- Finance Dashboard API
- Phase 2 deployment runbook — integration framework and encrypted credentials
- Architecture overview — Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4
- Finance Dashboard
- DbClient
- document-store-resolver.ts
- actions/leave.ts
- TransactionLabel
- trek-provider-adapter.ts
- The integration framework
- Checkpoint: Phase 2 complete (2026-09-04)
- Progress
- vacation/page.tsx
- load-company.ts
- payroll-rls.itest.ts
- interests/application/ports.ts
- PayrollComponent
- fromCents
- Phase 3 deployment runbook — Expenses and Interests
- context.ts
- company/page.tsx
- 10. Migration strategy
- Rulings — execution (P3-C1 … P3-C38)
- gotify.ts
- llm-config.ts
- expenses-rls.itest.ts
- withUserContext
- legacy.ts
- drizzle-interest-entries-repository.ts
- Checkpoint: Phase 3 complete (2026-09-05)
- infrastructure/purge-expired-originals.ts
- accounts/ui/run.ts
- app/layout.tsx
- _lib/leave.test.ts
- Phase 4: Payroll upload pipeline and Company
- 3. Target architecture
- clamd-scanner.ts
- Phase 4 deployment runbook — Payroll upload pipeline and Company
- run-interest-accrual.ts
- payroll/infrastructure/repositories.itest.ts
- get-interest-rule-detail.ts
- bootstrap.ts

## God Nodes (most connected - your core abstractions)
1. `cn()` - 98 edges
2. `withUserContext()` - 75 edges
3. `assertPermission()` - 74 edges
4. `testDb()` - 70 edges
5. `DbClient` - 67 edges
6. `Principal` - 64 edges
7. `toCents()` - 61 edges
8. `fromCents()` - 52 edges
9. `users` - 47 edges
10. `requirePrincipalOrRedirect()` - 46 edges

## Surprising Connections (you probably didn't know these)
- `Code 8054 - CONTRIBUTO DIPENDENTE (negative)` --semantically_similar_to--> `Code 7101 - FONDO C/DIPE (employee pension-fund share)`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d13.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt
- `alerts()` --indirect_call--> `httpRequest()`  [INFERRED]
  dashboard-app/src/lib/jobs/wallet-accounts-sync.test.ts → dashboard-app/src/lib/clients/http.ts
- `Code 4 - GIORNI NON LAVORATI` --semantically_similar_to--> `Code 19 - ORE NON LAVORATE`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d14.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt
- `Code 7101 - FONDO C/DIPE (employee pension-fund share)` --semantically_similar_to--> `Code 7053 - QUOTA ISCR.FONDO DIPEND.`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt → dashboard-app/src/lib/payroll/__fixtures__/real/d12.txt
- `Code 8992 - TRATTAMENTO INT. DL 3/20` --semantically_similar_to--> `Code 9424 - ULTERIORE DETRAZIONE MESE`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d10.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **IRPEF Settlement Chain (gross to net)** — dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_imponibile_irpef, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_irpef_lorda, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_totale_detrazioni, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9424_ulteriore_detrazione_mese, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_totale_trattenute_irpef, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_irpef_erario, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_addizionale_regionale, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_addizionale_comunale, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_netto_busta [EXTRACTED 1.00]
- **Leave-Hours Accounting Pattern (offsetting pair + residual grid)** — dashboard_app_src_lib_payroll___fixtures___real_ago2026_300_assenza_x_ferie_ac, dashboard_app_src_lib_payroll___fixtures___real_ago2026_301_ferie_ac, dashboard_app_src_lib_payroll___fixtures___real_d15_308_assenza_x_perm_ac, dashboard_app_src_lib_payroll___fixtures___real_d15_309_permessi_ac, dashboard_app_src_lib_payroll___fixtures___august_2026_pdf_leave_residuals_grid, dashboard_app_src_lib_payroll___fixtures___august_2026_ocr_flattened_residuals_defect [EXTRACTED 1.00]
- **TFR / Complementary Pension Contribution Block** — dashboard_app_src_lib_payroll___fixtures___real_ago2026_7101_fondo_c_dipe, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9109_fondo_c_azienda, dashboard_app_src_lib_payroll___fixtures___real_ago2026_8003_contribuzione_tfr, dashboard_app_src_lib_payroll___fixtures___real_ago2026_7897_esonero_ctr_tfr_prev_c, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9110_comunicazione_dipendente, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_tfr_mese [EXTRACTED 1.00]

## Communities (170 total, 8 thin omitted)

### Community 0 - "format.ts"
Cohesion: 0.10
Nodes (32): byYear(), FundTable(), MonthlyGainPanel(), Pct(), tone(), AccountRowProps, DeltaBadge(), DeltaBadgeProps (+24 more)

### Community 1 - "[slug]/page.tsx"
Cohesion: 0.10
Nodes (28): dynamic, FundsPage(), metadata, cellTone(), dynamic, FundDetailPage(), FundView, loadFund() (+20 more)

### Community 2 - "cn"
Cohesion: 0.05
Nodes (58): AccountDetailActions(), AccountDetailActionsProps, BalanceHistoryRow, BalanceHistoryTable(), BalanceHistoryTableProps, BalancesPageResponse, dynamic, IntegrationsPage() (+50 more)

### Community 3 - "auth/principal.ts"
Cohesion: 0.13
Nodes (27): romeDate(), createManualAccount(), CreateManualAccountInput, createManualAccountSchema, deleteAccount(), DeleteAccountResult, UseCaseDeps, DeletionBlockedError (+19 more)

### Community 4 - "sweep.ts"
Cohesion: 0.22
Nodes (14): dynamic, GET(), HEARTBEAT_MAX_AGE_MS, heartbeatAgeMs(), heartbeatPath(), isHeartbeatStale(), readHeartbeat(), touchHeartbeat() (+6 more)

### Community 5 - "trek.ts"
Cohesion: 0.08
Nodes (44): UpstreamService, ApplyDesiredStateInput, asRecord(), callTool(), CLIENT_INFO, describe(), ensureSession(), entryListSchema (+36 more)

### Community 6 - "accounts/api/routes.ts"
Cohesion: 0.06
Nodes (56): accountDto(), balancePointDto(), commonErrorResponses, createAccountRoute, createGroupRoute, decodeCursor(), deleteAccountRoute, deleteGroupRoute (+48 more)

### Community 7 - "Finance & Company Platform — Design and Phased Plan"
Cohesion: 0.12
Nodes (16): 0. How to read this document, 12. Intentional breaking changes, 13. Questions worth answering (none block Phase 0–1), 1.1 What exists, 1.2 What to keep, change, retire, 1. Repository assessment, 2. Assumptions (stated instead of asked), 4. Navigation and page map (+8 more)

### Community 8 - "AccountsTable.tsx"
Cohesion: 0.12
Nodes (25): ArchivedAccountRow, Sparkline(), SparklineProps, SparkTone, TONE_CLASS, MoneyValue(), StaleBadge(), StaleBadgeProps (+17 more)

### Community 9 - "parse.ts"
Cohesion: 0.12
Nodes (22): median(), PayslipHistoryEntry, LlmOptions, allLowFields(), detectThirteenth(), DetectThirteenthInput, emptyRules(), errorMessage() (+14 more)

### Community 10 - "wallet-refresh.ts"
Cohesion: 0.16
Nodes (15): getBalances(), SourceKind, JOB_NAME, LOCK_KEY, refresh(), RunWalletRefreshInput, BALANCES, NOON (+7 more)

### Community 11 - "compilerOptions"
Cohesion: 0.07
Nodes (29): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+21 more)

### Community 12 - "PageGrid.tsx"
Cohesion: 0.09
Nodes (15): LG_SPAN, LG_START, MD_SPAN, PageGrid(), Panel(), PanelProps, Span, Skeleton() (+7 more)

### Community 13 - "preview/page.tsx"
Cohesion: 0.05
Nodes (45): FRACTION_OPTIONS, KIND_OPTIONS, HREF, OPTIONS, ViewKey, ViewState, FRESH, FUND (+37 more)

### Community 14 - "succeed"
Cohesion: 0.13
Nodes (39): createAccountAction(), createGroupAction(), deleteAccountAction(), deleteGroupAction(), flag(), mapError(), recordBalanceAction(), renameGroupAction() (+31 more)

### Community 15 - "rules.ts"
Cohesion: 0.11
Nodes (29): Anchor, AUX_ANCHORS, AUX_FIELDS, COMPOSITE_FIELDS, FIELD_ANCHORS, GRID_HEADER_SYNONYMS, GridId, GRIDS (+21 more)

### Community 16 - "ingest.ts"
Cohesion: 0.08
Nodes (35): llmOptionsFromConfig(), markUploaded(), applyParseConclusion(), applyScanConclusion(), beginParse(), beginScan(), confidenceMap(), IngestOutcome (+27 more)

### Community 17 - "AccountGroup"
Cohesion: 0.14
Nodes (6): isUniqueViolation(), GroupsRepository, AccountGroup, DrizzleGroupsRepository, toGroup(), MemoryGroupsRepository

### Community 18 - "wallet.ts"
Cohesion: 0.07
Nodes (50): requestJson(), SleepFn, withRetry(), REVOLUT_COMPONENT_KEYS, WALLET_ACCOUNTS, WALLET_EXPECTED_CURRENCY, WalletAccountConfig, accountSchema (+42 more)

### Community 19 - "time.ts"
Cohesion: 0.13
Nodes (33): absoluteReturn(), currentValue(), effectiveSetting(), FundSettingRow, initialCapitalCents(), MonthlyReturnInput, ReturnRow, returnTable() (+25 more)

### Community 20 - "dependencies"
Cohesion: 0.07
Nodes (29): @base-ui-components/react, clsx, dependencies, @base-ui-components/react, clsx, drizzle-orm, hono, @hono/zod-openapi (+21 more)

### Community 21 - "devDependencies"
Cohesion: 0.07
Nodes (29): devDependencies, drizzle-kit, @fontsource/ibm-plex-mono, @fontsource/ibm-plex-sans, msw, @playwright/test, tailwindcss, @tailwindcss/postcss (+21 more)

### Community 22 - "11. Phased implementation plan"
Cohesion: 0.18
Nodes (11): 11. Phased implementation plan, Phase 0 — Foundations (no visible product change), Phase 1 — Accounts and Teable retirement (first vertical slice), Phase 2 — Integration framework and Settings › Integrations, Phase 3 — Expenses and Interests, Phase 4 — Payroll upload pipeline and Company, Phase 5 — Funds expansion, Phase 6 — Budgets (+3 more)

### Community 23 - "Phase 2 — The integration framework"
Cohesion: 0.07
Nodes (27): File Structure, Global Constraints, Phase 2 — Deferred minors first, Phase 2: Integration framework, encrypted credentials and the Settings split, Phase 2 — The integration framework, Rulings, Self-review against the Phase 2 scope, Task 10: The sync engine (+19 more)

### Community 24 - "load-interests.ts"
Cohesion: 0.10
Nodes (31): dynamic, InterestsPage(), metadata, dynamic, InterestRulePage(), metadata, monthStart(), accountNamesFor() (+23 more)

### Community 25 - "IntegrationConnection"
Cohesion: 0.09
Nodes (15): ConnectIntegrationInput, ImportResult, ConnectionPatch, ConnectionsRepository, ConnectionStatePatch, NewConnection, DrizzleConnectionsRepository, toConnection() (+7 more)

### Community 26 - "actions/payroll.ts"
Cohesion: 0.08
Nodes (48): applyPayslipAction(), nextInQueue(), rejectPayslipAction(), revalidate(), toActionError(), uploadPayslipAction(), VerifyActionInput, verifyPayslipAction() (+40 more)

### Community 27 - "confidence.ts"
Cohesion: 0.11
Nodes (30): FieldExtraction, PayslipField, AuxField, GRID_DEPENDENT_FIELDS, BALANCE_TOLERANCE, checkNetAgainstMedian(), checkNettoBalance(), checkResidualContinuity() (+22 more)

### Community 28 - "actions/integrations.ts"
Cohesion: 0.09
Nodes (35): connectIntegrationAction(), credentialsFrom(), disconnectIntegrationAction(), mapError(), revalidateIntegrations(), syncIntegrationAction(), testIntegrationAction(), connectIntegration() (+27 more)

### Community 29 - "repo/leave.ts"
Cohesion: 0.10
Nodes (34): Editing, LeaveDayDetail, LeaveFraction, LeaveKind, DesiredDay, TogglePlanStep, TrekEntry, differs() (+26 more)

### Community 30 - "llm.ts"
Cohesion: 0.14
Nodes (17): buildTool(), chatCompletionsUrl(), coerceMonth(), coerceNumber(), DEFAULT_BASE_URL, DEFAULT_MAX_CHARS, DEFAULT_TIMEOUT_MS, emptyResult() (+9 more)

### Community 31 - "Phase 1 — Accounts and Teable retirement"
Cohesion: 0.07
Nodes (27): File structure (what will exist after Phase 1), Global Constraints, Phase 0 — Foundations, Phase 0 + Phase 1: Foundations and Accounts Implementation Plan, Phase 1 — Accounts and Teable retirement, Self-review against the spec, Task 10: Capability resolver and capability-driven navigation, Task 11: Accounts schema with RLS (+19 more)

### Community 32 - "resolve.ts"
Cohesion: 0.10
Nodes (25): AppLayout(), HomePage(), activeChild(), AppShell(), AppShellProps, IconProps, ICONS, isActive() (+17 more)

### Community 33 - "cometa.ts"
Cohesion: 0.24
Nodes (14): CometaCredit, cometaCreditedDeposits(), cometaSchedule(), creditedByMonth(), creditMonthFor(), JOINING_FEE, MonthlyAccrual, quarterIndex() (+6 more)

### Community 34 - "vacation-fund.ts"
Cohesion: 0.25
Nodes (14): VacationFundPage(), MoneyInput, sumCents(), AccrualRateRow, balanceSeries(), effectiveRate(), entryMonth(), ExpectedAccrual (+6 more)

### Community 35 - "validate-teable-migration.ts"
Cohesion: 0.09
Nodes (30): APP_MANAGED_KEYS, argv, BlankMonthRow, centsByMonth(), db, differenceLabel(), HAND_TRACKED_KEYS, LEGACY_KEYS (+22 more)

### Community 36 - "http.ts"
Cohesion: 0.12
Nodes (16): backoffDelay(), HttpError, httpRequest(), HttpRequestInit, isRetryable(), isRetryableStatus(), parseRetryAfter(), readBody() (+8 more)

### Community 37 - "staleness.ts"
Cohesion: 0.29
Nodes (9): asDate(), classify(), isStale(), snapshotGrace, StalenessInfo, StalenessSource, NOW, DISPLAY_STALENESS_MS (+1 more)

### Community 38 - "accounts/application/ports.ts"
Cohesion: 0.06
Nodes (24): AccountDetail, NetWorthAccountSeries, newAccount(), NOW, AccountPatch, AccountsRepository, Clock, NewAccount (+16 more)

### Community 39 - "trek.test.ts"
Cohesion: 0.15
Nodes (16): applyDesiredState(), planToggles(), resetTrekAuthCache(), callsTo(), CONFIG, entriesPayload(), fetchMock, LIVE_STATS (+8 more)

### Community 40 - "expenses/api/routes.ts"
Cohesion: 0.08
Nodes (32): categoriesRoute, categoryDto(), commonErrorResponses, getRoute, IdParamSchema, IfMatchHeaderSchema, labelDto(), labelsRoute (+24 more)

### Community 41 - "5. Data model"
Cohesion: 0.18
Nodes (11): 5.10 Indexes (access-pattern driven), 5.1 Identity and access, 5.2 Integrations, 5.3 Accounts, 5.4 Transactions (Expenses), 5.5 Funds, 5.6 Budgets, 5.7 Interests (+3 more)

### Community 42 - "trek-sync.test.ts"
Cohesion: 0.08
Nodes (18): LeaveDaySaved, auth, cache, DAY, repo, store, sync, trek (+10 more)

### Community 43 - "create-interest-rule.ts"
Cohesion: 0.17
Nodes (13): CreateInterestRuleInput, createInterestRuleSchema, InvalidInputError, NotFoundError, VersionMismatchError, Compounding, DayCount, PostingMode (+5 more)

### Community 44 - "toCents"
Cohesion: 0.13
Nodes (20): monthlyReturn, centsFromDecimal(), roundEur(), toCents(), toHours(), combinedGain, fundGain(), FundSeries (+12 more)

### Community 45 - "Finance Dashboard — Brand System"
Cohesion: 0.25
Nodes (8): 1. Strategy, 2. The mark, 3. Assets, 4. Colour, 5. Typography, 6. Voice, 7. Applications, Finance Dashboard — Brand System

### Community 46 - "teamsystem.ts"
Cohesion: 0.23
Nodes (15): parseItalianNumber(), bodyRow(), EMPTY, extractTeamSystem(), findGrid(), isNumericOnly(), numbersOf(), plausibleHours() (+7 more)

### Community 47 - "trek-sync-job.test.ts"
Cohesion: 0.17
Nodes (10): BASE_ENV, CONFIGURED, fetchMock, loadGotify(), resetEnvCache(), JOB_NAME, RunRow, store (+2 more)

### Community 48 - "time-off/page.tsx"
Cohesion: 0.12
Nodes (30): LeaveCalendarProps, LeaveCalendarView, LeaveMonthView, loadLeaveCalendar(), monthsOf(), dynamic, metadata, TimeOffPage() (+22 more)

### Community 49 - "payroll/api/routes.ts"
Cohesion: 0.05
Nodes (68): applyRoute, commonErrorResponses, componentDto(), earningsRoute, getImportRoute, getRecordRoute, IdParamSchema, IfMatchHeaderSchema (+60 more)

### Community 50 - "render-brand-icons.py"
Cohesion: 0.33
Nodes (3): Rasterise the Finance Dashboard mark to PNG. No rasteriser is installed on this…, radius=0 renders a full-bleed square (maskable); otherwise a rounded square., render()

### Community 51 - "schema/index.ts"
Cohesion: 0.19
Nodes (11): accounts, auditEvents, organizations, roles, userIdentities, userRoles, users, calls (+3 more)

### Community 52 - "teable-import.ts"
Cohesion: 0.10
Nodes (23): argv, db, dryRun, ExportFile, fromIndex, pool, unknown, balanceSnapshots (+15 more)

### Community 53 - "wallet-adapter.ts"
Cohesion: 0.12
Nodes (17): WalletAccount, AccountsSource, ProviderAccount, balanceRow(), nextStatus(), patch(), sameName(), syncProviderAccounts() (+9 more)

### Community 54 - "payroll/infrastructure/memory-repositories.ts"
Cohesion: 0.06
Nodes (31): extraction(), principal, seed(), extraction, NOW, principal, base, NOW (+23 more)

### Community 56 - "machine.ts"
Cohesion: 0.13
Nodes (20): dynamic, POST(), dynamic, POST(), dynamic, POST(), Bucket, buckets (+12 more)

### Community 57 - "integrations/api/routes.ts"
Cohesion: 0.07
Nodes (41): CappedRead, commonErrorResponses, conflict, connectionDto(), connectRoute, disconnectRoute, listRoute, notFound (+33 more)

### Community 58 - "Mod. Cedolino TS Layout"
Cohesion: 0.22
Nodes (10): Code 1150 - RATA ADD.REG. A.P., Real Payslip Fixture: Marzo 2026 (doc 96), ADDIZIONALE REGIONALE, Fixture Anonymisation Convention, Employer Header Block (Ditta / ACME Consulting srl), TeamSystem August 2026 Fixture (synthetic-anonymised), IBAN / Bank Accredito Trailer Line, Q/INPS - INAIL Statistical Block (+2 more)

### Community 59 - "middleware.ts"
Cohesion: 0.23
Nodes (11): config, contentSecurityPolicy(), frameAncestorsFor(), hasSessionCookie(), isPublic(), middleware(), PUBLIC_PATHS, PUBLIC_PREFIXES (+3 more)

### Community 61 - "scripts"
Cohesion: 0.10
Nodes (20): scripts, build, db:generate, db:migrate, dev, e2e, lint, migrate:credentials (+12 more)

### Community 62 - "August 2026 OCR Fixture (Paperless-ngx text)"
Cohesion: 0.29
Nodes (7): OCR Digit/Letter Confusion, August 2026 OCR Fixture (Paperless-ngx text), Flattened Residuals Grid OCR Defect, Leave Residuals Grid (FERIE / PERMESSI / ROL / FLESS. / B. ORE), Garbage OCR Fixture (skewed scan), All-Low-Confidence Degradation (Failure Handling), OCR Letter-Spacing Artifact (S -> 'S ')

### Community 63 - "list-transactions.ts"
Cohesion: 0.40
Nodes (3): listTransactions(), ListTransactionsResult, TransactionListItem

### Community 64 - "End-to-end tests"
Cohesion: 0.50
Nodes (3): End-to-end tests, Planned flows (not yet written), `smoke.spec.ts` (implemented)

### Community 65 - "Transaction"
Cohesion: 0.11
Nodes (10): transactionLabels, ListTransactionsOptions, ListTransactionsPage, NewTransaction, TransactionsRepository, Transaction, DrizzleTransactionsRepository, toTransaction() (+2 more)

### Community 66 - "wallet-provider-adapter.ts"
Cohesion: 0.08
Nodes (29): WalletCategory, WalletRecord, ProviderCategory, ProviderTransaction, TransactionsSource, syncProviderTransactions(), SyncProviderTransactionsDeps, SyncProviderTransactionsResult (+21 more)

### Community 67 - "PayrollImport"
Cohesion: 0.07
Nodes (20): RaceyImportsRepository, ListImportsOptions, NewPayrollImport, PayrollImport, PayrollImportPatch, PayrollImportsRepository, PayrollImportStatus, TextSourceColumn (+12 more)

### Community 68 - "run-sync.ts"
Cohesion: 0.17
Nodes (13): drainSyncQueue(), execute(), prepare(), Prepared, recordFailure(), resolve(), Resolved, resumeQueuedSync() (+5 more)

### Community 69 - "dashboard-app service"
Cohesion: 0.38
Nodes (7): dashboard-app service, dashboard-cron supercronic sidecar service, External networks proxy_public and db_internal, projects compose stack, read_only rootfs, cap_drop ALL, tmpfs and limits, Read-only secret file mounts (wallet-token, trek-token), Traefik router with X-Forwarded-Proto https middleware

### Community 70 - "create-import.ts"
Cohesion: 0.18
Nodes (16): appSettings, DEFAULT_RETENTION_YEARS, reserveImport(), ReserveImportInput, retentionUntil(), UploadCandidate, validateUpload(), StorageProvider (+8 more)

### Community 71 - "7. Domain designs (what each section computes)"
Cohesion: 0.20
Nodes (10): 7.1 Home, 7.2 Finance Overview, 7.3 Accounts, 7.4 Funds, 7.5 Budgets, 7.6 Interests (reuse / change / deprecate from `interest.py`), 7.7 Expenses, 7.8 Company (+2 more)

### Community 72 - "August 2026 PDF-Text Fixture (clean layout)"
Cohesion: 0.28
Nodes (9): Code 001 - RETRIBUZIONE ORDINARIA, August 2026 PDF-Text Fixture (clean layout), TOTALE RITENUTE, Code 2 - LAVORO ORDIN.(mens.), Code 1101 - IRPEF A CREDITO -MOD.730-, Code 9208 - CREDITO COMPENSATO, Real Payslip Fixture: Luglio 2026 (doc 104, 730 refund), ARROTONDAMENTO (+1 more)

### Community 73 - "payroll-ingest.ts"
Cohesion: 0.10
Nodes (42): dynamic, POST(), TIERS, alertJobFailure(), errorMessage(), activeRules(), runInterestAccrualJob(), closeOwner() (+34 more)

### Community 74 - "SyncRun"
Cohesion: 0.13
Nodes (8): NewSyncRun, SyncRunsRepository, DrizzleSyncRunsRepository, toRun(), MemorySyncRunsRepository, SyncRun, SyncRunStatus, SyncTrigger

### Community 75 - "require-principal.ts"
Cohesion: 0.08
Nodes (40): runtime, bodySchema, dynamic, POST(), app, DELETE, dynamic, GET (+32 more)

### Community 76 - "interests/api/routes.ts"
Cohesion: 0.09
Nodes (27): accrualDto(), commonErrorResponses, createRoute_, entryDto(), getRoute, IdParamSchema, IfMatchHeaderSchema, listRoute (+19 more)

### Community 77 - "Real Payslip Fixture: Agosto 2026"
Cohesion: 0.25
Nodes (11): Code 19 - ORE NON LAVORATE, Code 2161 - DONATORI SANGUE, Code 7101 - FONDO C/DIPE (employee pension-fund share), Code 7897 - ESONERO CTR - TFR PREV.C., Code 8003 - CONTRIBUZIONE TFR, Code 9109 - FONDO C/AZIENDA (employer pension-fund share), Code 9110 - COMUNICAZIONE DIPENDENTE, Real Payslip Fixture: Agosto 2026 (+3 more)

### Community 78 - "OverviewClient.tsx"
Cohesion: 0.16
Nodes (15): FinanceTabs(), DEFAULT_STATE, OverviewAccount, OverviewClient(), OverviewClientProps, OverviewSource, PRESET, RANGE_KEYS (+7 more)

### Community 79 - "Code 8992 - TRATTAMENTO INT. DL 3/20"
Cohesion: 0.29
Nodes (8): Code 1405 - FESTIVITA' NON GOD. (gg), Code 8992 - TRATTAMENTO INT. DL 3/20, Code 9824 - SOMMA ART.1 C.4 L.207/24, Real Payslip Fixture: Dicembre 2025 (doc 10), Code 1406 - FESTIVITA' ABOLITE (gg), Real Payslip Fixture: Novembre 2025 (doc 12), Code 4 - GIORNI NON LAVORATI, Real Payslip Fixture: Ottobre 2025 (doc 14, partial month)

### Community 80 - "IMPONIBILE IRPEF"
Cohesion: 0.29
Nodes (7): IMPON. CONTR. SOC. (social-contribution taxable base), IMPONIBILE IRPEF, IRPEF ERARIO, IRPEF LORDA, TOTALE CONTRIBUTI SOCIALI, TOTALE DETRAZIONI, TOTALE TRATTENUTE IRPEF

### Community 81 - "Real Payslip Fixture: Maggio 2026 (doc 102, welfare)"
Cohesion: 0.33
Nodes (6): TOTALE COMPETENZE, Codice CCNL C011, Code 9582 - RIMBORSI - WELFARE AZ., Code 9586 - RET. NATURA - WELFARE AZ., Real Payslip Fixture: Maggio 2026 (doc 102, welfare), TOTALE LORDO

### Community 82 - "Real Payslip Fixture: 13a Mensilita 2025 (doc 13)"
Cohesion: 0.33
Nodes (7): Code 900 - TREDICESIMA MENSILITA, December 2026 Tredicesima Fixture (standalone document), Code 8054 - CONTRIBUTO DIPENDENTE (negative), Code 8056 - CONTRIBUZIONE C/AZIENDA (negative), Code 901 - 13^ MENSILITA'(hh), Real Payslip Fixture: 13a Mensilita 2025 (doc 13), MESE RETRIBUITO Pay-Period Line

### Community 83 - "Code 300 - ASSENZA X FERIE A.C.(hh)"
Cohesion: 0.24
Nodes (10): Code 300 - ASSENZA X FERIE A.C.(hh), Code 301 - FERIE A.C.(hh), Code 9424 - ULTERIORE DETRAZIONE MESE, Real Payslip Fixture: Aprile 2026 (doc 101), Real Payslip Fixture: Gennaio 2026 (doc 11), Code 308 - ASSENZA X PERM. A.C.(hh), Code 309 - PERMESSI A.C.(hh), Real Payslip Fixture: Febbraio 2026 (doc 15) (+2 more)

### Community 85 - "interests/api/routes.itest.ts"
Cohesion: 0.09
Nodes (15): AccountBalanceRow, accountBalances, AccountGroupRow, accountGroups, AccountRow, ProviderLinkRow, providerLinks, InterestAccrualRow (+7 more)

### Community 86 - "package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 87 - "permissionsForRoles"
Cohesion: 0.06
Nodes (39): buildOpenApiDocument(), seed(), appFor(), caps(), seed(), seed(), appFor(), seedUser() (+31 more)

### Community 89 - "(app)/page.tsx"
Cohesion: 0.08
Nodes (32): LeaveByMonth(), LeaveByMonthProps, varianceSentence(), dynamic, FundsCard(), LeaveCard(), metadata, TotalBalanceCards() (+24 more)

### Community 90 - "app.ts"
Cohesion: 0.18
Nodes (9): idempotencyKeys, rateLimitWindows, ApiError, ErrorBody, ErrorCode, toErrorBody(), idempotency(), rateLimit() (+1 more)

### Community 92 - "accounts/[id]/page.tsx"
Cohesion: 0.18
Nodes (21): AccountDetailPage(), dynamic, encodeCursor(), generateMetadata(), AccountsPage(), dynamic, metadata, getAccountDetail() (+13 more)

### Community 93 - "Checkpoint: Phase 0 + Phase 1 complete (2026-09-03)"
Cohesion: 0.25
Nodes (7): Before Phase 2, Checkpoint: Phase 0 + Phase 1 complete (2026-09-03), Decisions already taken (summary; full text in the ledger), Deployment status (2026-09-03, later the same day), Documents, How to continue, State

### Community 94 - "Code 9837 - IMPONIBILE 5% L.199/25"
Cohesion: 0.50
Nodes (4): Code 9837 - IMPONIBILE 5% L.199/25, Code 9838 - IMPOSTA SOST. 5% L.199/25, Real Payslip Fixture: Giugno 2026 (doc 103), PAGA BASE / PREMIO PR. / SUPERM.ASS Row

### Community 95 - "requirePrincipalOrRedirect"
Cohesion: 0.04
Nodes (55): dynamic, EarningsPage(), metadata, dynamic, EarningsRecordPage(), generateMetadata(), dynamic, metadata (+47 more)

### Community 96 - "SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md"
Cohesion: 0.50
Nodes (3): Pre-flight scan (2026-09-02), Progress, SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md

### Community 97 - "contracts.ts"
Cohesion: 0.08
Nodes (43): main(), readTrimmed(), dynamic, ACCOUNT_KEYS, JobResult, JobStatus, db, instance() (+35 more)

### Community 107 - "payroll/application/ports.ts"
Cohesion: 0.09
Nodes (30): PayslipExtraction, applyImport(), fundHalves(), Clock, MalwareScanner, MappingTarget, NewPayrollComponent, PayrollComponentKind (+22 more)

### Community 109 - "TransactionCategory"
Cohesion: 0.17
Nodes (8): TransactionDetail, CategoriesRepository, NewCategory, TransactionCategory, DrizzleCategoriesRepository, toCategory(), MemoryCategoriesRepository, monotonicId()

### Community 110 - "File Structure"
Cohesion: 0.07
Nodes (28): File Structure, Global Constraints, Phase 3: Expenses and Interests, Rulings, Self-review against the Phase 3 scope, Task 10: Expenses REST API, Task 11: Expenses pages — list and detail, replacing the setup state, Task 12: Recurring-pattern persistence wired into the transactions sync (+20 more)

### Community 111 - "SyncKind"
Cohesion: 0.19
Nodes (8): SyncJob, SyncJobsRepository, RunSyncInput, DrizzleSyncJobsRepository, toJob(), MemorySyncJobsRepository, SyncKind, SyncSchedule

### Community 112 - "PayrollRecord"
Cohesion: 0.09
Nodes (11): ListRecordsOptions, NewPayrollRecord, PayrollRecord, PayrollRecordKind, PayrollRecordsRepository, DrizzlePayrollRecordsRepository, toRecord(), MemoryPayrollRecordsRepository (+3 more)

### Community 114 - "integrations/types.ts"
Cohesion: 0.07
Nodes (30): IntegrationDeps, makeDeps(), principal, provider(), FileCredentials, importFileCredentials(), makeDeps(), principal (+22 more)

### Community 115 - "load-transactions.ts"
Cohesion: 0.11
Nodes (24): dynamic, ExpensesPage(), metadata, getTransaction(), listCategories(), listLabels(), UseCaseDeps, expenseDeps() (+16 more)

### Community 116 - "expenses/application/ports.ts"
Cohesion: 0.12
Nodes (13): detectRecurringPatterns(), Clock, RecurringPatternRecord, RecurringPatternsRepository, Cadence, CADENCE_DAY_BANDS, cadenceFor(), DetectedPattern (+5 more)

### Community 117 - "Teable migration"
Cohesion: 0.15
Nodes (7): Files in this directory, `npm run migrate:teable`, `npm run migrate:teable:validate`, Order of operations, Paperless → payroll document store, Running against the deployed container, Teable migration

### Community 118 - "InterestRule"
Cohesion: 0.14
Nodes (9): InterestRule, InterestRulePatch, InterestRulesRepository, NewInterestRule, DrizzleInterestRulesRepository, toRule(), definedEntries(), MemoryInterestRulesRepository (+1 more)

### Community 119 - "interests/infrastructure/memory-repositories.ts"
Cohesion: 0.09
Nodes (8): InterestAccrual, InterestAccrualsRepository, NewInterestAccrual, DrizzleInterestAccrualsRepository, toAccrual(), MemoryInterestAccrualsRepository, monotonicId(), normalizeScale()

### Community 120 - "expenses/infrastructure/memory-repositories.ts"
Cohesion: 0.15
Nodes (10): loadTransactionDetail, requirePrincipalOrRedirect, InvalidInputError, NotFoundError, VersionMismatchError, TransactionPatch, updateTransaction(), UpdateTransactionInput (+2 more)

### Community 121 - "Phase 1 deployment runbook — accounts and Teable retirement"
Cohesion: 0.18
Nodes (11): Cleanup after a successful deploy, Phase 1 deployment runbook — accounts and Teable retirement, Pre-checks, Rollback, Step 1 — build the new image, Step 2 — apply migrations 0004–0006 only, Step 3 — import the legacy history, Step 4 — validate (+3 more)

### Community 122 - "text.ts"
Cohesion: 0.24
Nodes (11): detectPeriodMonth(), fixture(), GARBAGE_TEXT, OCR_TEXT, PDF_TEXT, extractPdfText(), fixNumericOcr(), normalizeText() (+3 more)

### Community 123 - "Finance Dashboard API"
Cohesion: 0.13
Nodes (15): Authentication, Breaking changes in Phase 2, Endpoints (Phase 1 + Phase 2), Error envelope, Expenses, Finance Dashboard API, `Idempotency-Key`, Integrations (+7 more)

### Community 124 - "Phase 2 deployment runbook — integration framework and encrypted credentials"
Cohesion: 0.18
Nodes (10): 1. Pre-checks, 2. Generate the encryption key, 3. Deploy the new image with the token files still mounted, 4. Import the file-mounted credentials, 5. Verify in the UI, 6. Remove the token files, 7. Verify the tick, 8. Rollback (+2 more)

### Community 125 - "Architecture overview — Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4"
Cohesion: 0.20
Nodes (10): API conventions, Architecture overview — Phase 0 + Phase 1 + Phase 2 + Phase 3 + Phase 4, Capability-driven navigation and Home, Integration framework, Job tiers, Known deviations, Module layout, RLS context and the `system` role (+2 more)

### Community 126 - "Finance Dashboard"
Cohesion: 0.29
Nodes (7): Developing, Documentation, Finance Dashboard, Running it, Stack, Status: Phase 0 + Phase 1 complete, Testing

### Community 127 - "DbClient"
Cohesion: 0.13
Nodes (7): DbClient, AccountBalanceLookup, AccountOwnershipCheck, drizzleAccountBalanceLookup(), drizzleAccountOwnershipCheck(), interestDeps(), recordAudit()

### Community 128 - "document-store-resolver.ts"
Cohesion: 0.06
Nodes (40): first(), metadata, safeCallbackUrl(), SearchParams, SignInPage(), SignInButton(), DocumentStore, documentStoreConfigured() (+32 more)

### Community 129 - "actions/leave.ts"
Cohesion: 0.27
Nodes (17): daySchema, describe(), LEAVE_PATHS, noopSync(), removeLeaveDay(), removeSchema, revalidateLeave(), setLeaveDay() (+9 more)

### Community 130 - "TransactionLabel"
Cohesion: 0.24
Nodes (6): LabelsRepository, NewLabel, TransactionLabel, DrizzleLabelsRepository, toLabel(), MemoryLabelsRepository

### Community 132 - "trek-provider-adapter.ts"
Cohesion: 0.10
Nodes (14): fakeProvider(), credentialSchema, leaveSync, onDisconnect(), TREK_PROVIDER, trekProvider, AuditInput, SyncApplyContext (+6 more)

### Community 133 - "The integration framework"
Cohesion: 0.18
Nodes (11): 1. What an integration is, 2. Credential storage, 3. Key rotation, 4. Connection lifecycle, 5. Sync runs, 6. Inbound webhooks, 7. Adding a provider, `payroll_silo` (+3 more)

### Community 134 - "Checkpoint: Phase 2 complete (2026-09-04)"
Cohesion: 0.25
Nodes (7): Checkpoint: Phase 2 complete (2026-09-04), Decisions already taken (summary; full text in the ledger and in `task-20-brief.md`'s "Rulings" section), Deployment status, Documents, How to continue, State, What a reader should know before Phase 3

### Community 135 - "Progress"
Cohesion: 0.33
Nodes (5): Deferred-minor cleanup wave (batch before Task 19), Pre-flight rulings (2026-09-04), Pre-flight scan, Progress, SDD ledger — plan: docs/superpowers/plans/2026-09-04-phase-2-integrations.md

### Community 136 - "vacation/page.tsx"
Cohesion: 0.08
Nodes (42): depositSchema, recordManualDeposit(), revalidateFund(), saveFundSettings(), settingsSchema, slugOf(), parseMoney(), toNumericString() (+34 more)

### Community 137 - "load-company.ts"
Cohesion: 0.15
Nodes (20): earningsSummary(), getRecord(), listRecords(), Accumulator, bucketsOf(), CONTRIBUTION_KINDS, EarningsBucket, EarningsSummary (+12 more)

### Community 138 - "payroll-rls.itest.ts"
Cohesion: 0.13
Nodes (12): main(), normalise(), twoUsers(), PayrollComponentRow, payrollComponents, PayrollImportRow, payrollImports, PayrollMappingRuleRow (+4 more)

### Community 141 - "interests/application/ports.ts"
Cohesion: 0.27
Nodes (6): Clock, UseCaseDeps, recordPostedEntry(), shouldPost(), accrual, rule

### Community 142 - "PayrollComponent"
Cohesion: 0.18
Nodes (7): AppliedImport, RecordDetail, PayrollComponent, PayrollComponentsRepository, DrizzlePayrollComponentsRepository, toComponent(), MemoryPayrollComponentsRepository

### Community 143 - "fromCents"
Cohesion: 0.14
Nodes (23): fromCents(), annualTotals, averageNet(), AverageOptions, averageTaxes(), inYear(), isThirteenthCandidate(), isVerified() (+15 more)

### Community 144 - "Phase 3 deployment runbook — Expenses and Interests"
Cohesion: 0.13
Nodes (12): Before you start: read the container's current configuration, Retiring the standalone `wallet-manager` interest container, Rollback, Steps, What a crash leaves behind, and why this procedure avoids relying on it, 1. Pre-checks, 2. Deploy, 3. Verify (+4 more)

### Community 145 - "context.ts"
Cohesion: 0.13
Nodes (16): bytea, IntegrationConnectionRow, integrationConnections, IntegrationProviderRow, integrationProviders, SyncJobRow, syncJobs, SyncRunRow (+8 more)

### Community 146 - "company/page.tsx"
Cohesion: 0.19
Nodes (12): dynamic, metadata, StatEmphasis, StatGrid(), StatGridProps, StatTile(), StatTileProps, WIDE (+4 more)

### Community 147 - "10. Migration strategy"
Cohesion: 0.40
Nodes (5): 10.1 Teable → PostgreSQL, 10.2 Paperless → payroll silo, 10.3 Single user → users table, 10.4 Deployment, 10. Migration strategy

### Community 150 - "Rulings — execution (P3-C1 … P3-C38)"
Cohesion: 0.06
Nodes (32): Consequences of P3-C37 and P3-C29 that later work must not contradict, Deferred by design, Expenses rulings, Fix wave batch A — DONE (48709aa, 1e32ff9, f00c132), Fix wave batch B — DONE (da41da2, 61c9c1c, 0a0905b, f3f3832, ce743b4; migration 0014_interest_posting_fixes.sql), Fix wave batch C — DONE (aef890a, ab25461, 9497f59, 60cda52, 09b5739; no migration), Fix-wave re-review dispatched, Fix wave — three sequential batches, all approved on first re-review (+24 more)

### Community 151 - "gotify.ts"
Cohesion: 0.13
Nodes (19): alertPayslipPending(), alertSuccessAfterRetry(), appUrl(), GotifyMessage, JobFailureAlert, notify(), PayslipPendingAlert, RetrySuccessAlert (+11 more)

### Community 152 - "llm-config.ts"
Cohesion: 0.14
Nodes (17): asString(), BaseUrlCheck, checkBaseUrl(), ConfigSource, isPrivateHost(), Layers, llmConfigStatus, LlmResolvedConfig (+9 more)

### Community 153 - "expenses-rls.itest.ts"
Cohesion: 0.18
Nodes (9): seedTwoUsers(), RecurringPatternRow, recurringPatterns, transactionCategories, TransactionCategoryRow, transactionLabelLinks, TransactionLabelRow, TransactionRow (+1 more)

### Community 154 - "withUserContext"
Cohesion: 0.14
Nodes (21): createRule(), newRule(), seedPostableUser(), seedUser(), asGroupUser(), asLinkUser(), asUser(), seedUsers() (+13 more)

### Community 155 - "legacy.ts"
Cohesion: 0.14
Nodes (10): BalanceSnapshot, FundDeposit, JobRun, jobRuns, LeaveDay, leaveDays, payslips, vacationAccrualRate (+2 more)

### Community 156 - "drizzle-interest-entries-repository.ts"
Cohesion: 0.28
Nodes (6): InterestEntriesRepository, InterestEntry, NewInterestEntry, DrizzleInterestEntriesRepository, toEntry(), MemoryInterestEntriesRepository

### Community 157 - "Checkpoint: Phase 3 complete (2026-09-05)"
Cohesion: 0.15
Nodes (12): Behaviours the plan text and the original checkpoint predate, Checkpoint: Phase 3 complete, whole-branch fix wave closed (2026-09-05), Deployment status, Documents, How to continue, Key design decisions from the fix wave, Not run: the manual walkthrough with a real Wallet token, One parked minor (+4 more)

### Community 158 - "infrastructure/purge-expired-originals.ts"
Cohesion: 0.27
Nodes (7): PURGE_BATCH, purgeOne(), PurgeResult, NOW, PAST, purgeExpiredOriginals(), unreachableStore()

### Community 159 - "accounts/ui/run.ts"
Cohesion: 0.27
Nodes (6): deletionDecision, base, accountDeps(), setAccountDepsFactoryForTests(), setPrincipalForTests(), onDisconnect()

### Community 160 - "app/layout.tsx"
Cohesion: 0.27
Nodes (6): metadata, viewport, THEME_STORAGE_KEY, ThemeScript(), plexMono, plexSans

### Community 161 - "_lib/leave.test.ts"
Cohesion: 0.22
Nodes (6): payroll, payslips, principal, repo, trekState, vacation

### Community 162 - "Phase 4: Payroll upload pipeline and Company"
Cohesion: 0.06
Nodes (30): File Structure, Global Constraints, Phase 4: Payroll upload pipeline and Company, Rulings, Self-review against the Phase 4 scope, Task 10: Ingesting an import — scan, extract text, parse, Task 11: Reviewing and applying an import, Task 12: Reading imports, records and the earnings summary (+22 more)

### Community 163 - "3. Target architecture"
Cohesion: 0.40
Nodes (5): 3.1 Shape, 3.2 API surface, 3.3 Capabilities and dynamic composition, 3.4 Background work, 3. Target architecture

### Community 164 - "clamd-scanner.ts"
Cohesion: 0.28
Nodes (6): ScanResult, ClamdConfig, ClamdConnect, createClamdScanner(), parseClamdReply(), bytes

### Community 165 - "Phase 4 deployment runbook — Payroll upload pipeline and Company"
Cohesion: 0.22
Nodes (8): 1. Pre-checks, 2. Wave 1 — deploy the migration image, 3. Wave 2 — deploy the removal image, 4. Verify, 5. Scanning, 6. Retention, 7. Rollback, Phase 4 deployment runbook — Payroll upload pipeline and Company

### Community 166 - "run-interest-accrual.ts"
Cohesion: 0.36
Nodes (5): isNegativeAmount(), previousDay(), runInterestAccrual(), RunInterestAccrualResult, rule

### Community 167 - "payroll/infrastructure/repositories.itest.ts"
Cohesion: 0.29
Nodes (3): funds, RETENTION, seedUsers()

### Community 168 - "get-interest-rule-detail.ts"
Cohesion: 0.52
Nodes (6): dayAfter(), getInterestRuleDetail(), InterestRuleDetail, startOfDay(), ProjectionPoint, ReconciliationSummary

### Community 169 - "bootstrap.ts"
Cohesion: 0.50
Nodes (3): bootstrapOwner(), db, pool

## Knowledge Gaps
- **1062 isolated node(s):** `entrypoint.sh script`, `securityHeaders`, `nextConfig`, `name`, `version` (+1057 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `withUserContext()` connect `withUserContext` to `accounts/api/routes.ts`, `payroll-rls.itest.ts`, `succeed`, `ingest.ts`, `context.ts`, `load-interests.ts`, `expenses-rls.itest.ts`, `actions/payroll.ts`, `infrastructure/purge-expired-originals.ts`, `accounts/ui/run.ts`, `validate-teable-migration.ts`, `payroll/infrastructure/repositories.itest.ts`, `expenses/api/routes.ts`, `payroll/api/routes.ts`, `schema/index.ts`, `payroll/infrastructure/memory-repositories.ts`, `payroll-ingest.ts`, `interests/api/routes.ts`, `interests/api/routes.itest.ts`, `permissionsForRoles`, `app.ts`, `contracts.ts`, `integrations/types.ts`, `load-transactions.ts`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **Why does `assertPermission()` connect `auth/principal.ts` to `accounts/api/routes.ts`, `load-company.ts`, `interests/application/ports.ts`, `succeed`, `ingest.ts`, `actions/payroll.ts`, `actions/integrations.ts`, `expenses/api/routes.ts`, `get-interest-rule-detail.ts`, `create-interest-rule.ts`, `payroll/api/routes.ts`, `integrations/api/routes.ts`, `list-transactions.ts`, `run-sync.ts`, `create-import.ts`, `interests/api/routes.ts`, `accounts/[id]/page.tsx`, `requirePrincipalOrRedirect`, `payroll/application/ports.ts`, `TransactionCategory`, `load-transactions.ts`, `expenses/application/ports.ts`, `expenses/infrastructure/memory-repositories.ts`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `Principal` connect `payroll/api/routes.ts` to `auth/principal.ts`, `accounts/api/routes.ts`, `load-company.ts`, `interests/application/ports.ts`, `ingest.ts`, `load-interests.ts`, `actions/payroll.ts`, `actions/integrations.ts`, `accounts/ui/run.ts`, `resolve.ts`, `validate-teable-migration.ts`, `get-interest-rule-detail.ts`, `create-interest-rule.ts`, `schema/index.ts`, `payroll/infrastructure/memory-repositories.ts`, `integrations/api/routes.ts`, `list-transactions.ts`, `run-sync.ts`, `create-import.ts`, `payroll-ingest.ts`, `require-principal.ts`, `permissionsForRoles`, `app.ts`, `accounts/[id]/page.tsx`, `requirePrincipalOrRedirect`, `contracts.ts`, `payroll/application/ports.ts`, `TransactionCategory`, `integrations/types.ts`, `load-transactions.ts`, `expenses/application/ports.ts`, `expenses/infrastructure/memory-repositories.ts`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `entrypoint.sh script`, `securityHeaders`, `nextConfig` to the rest of the system?**
  _1062 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `format.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09682539682539683 - nodes in this community are weakly interconnected._
- **Should `[slug]/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.1 - nodes in this community are weakly interconnected._
- **Should `cn` be split into smaller, more focused modules?**
  _Cohesion score 0.05126050420168067 - nodes in this community are weakly interconnected._
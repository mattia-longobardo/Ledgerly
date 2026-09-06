# Graph Report - personal-dashboard  (2026-09-06)

## Corpus Check
- 781 files · ~747,942 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 4933 nodes · 14588 edges · 210 communities (201 shown, 9 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 140 edges (avg confidence: 0.64)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `0fb2fded`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- accounts/[id]/page.tsx
- cn
- earnings.ts
- budgets/api/routes.ts
- require-user.ts
- trek.ts
- accounts/api/routes.ts
- Finance & Company Platform — Design and Phased Plan
- testPrincipal
- parse.ts
- funds/api/routes.ts
- compilerOptions
- PageGrid.tsx
- TransactionsTable.tsx
- actions/accounts.ts
- rules.ts
- ingest.ts
- AccountGroup
- wallet.ts
- monthKeyOf
- dependencies
- devDependencies
- 11. Phased implementation plan
- Phase 2 — The integration framework
- load-interests.ts
- IntegrationConnection
- actions/payroll.ts
- confidence.ts
- actions/integrations.ts
- trek-diff.ts
- llm.ts
- Phase 1 — Accounts and Teable retirement
- testDb
- funds/application/ports.ts
- auth/principal.ts
- contracts.ts
- http.ts
- networth.ts
- list-accounts.ts
- trek.test.ts
- payroll-contribution-sink.ts
- 5. Data model
- drizzle-scopes-usages-repository.ts
- update-interest-rule.ts
- toCents
- Finance Dashboard — Brand System
- teamsystem.ts
- OverviewClient.tsx
- _lib/leave.ts
- payroll/api/routes.ts
- render-brand-icons.py
- schema/index.ts
- teable-import.ts
- format.ts
- load-payroll.test.ts
- AGENTS.md
- machine.ts
- integrations/api/routes.ts
- Mod. Cedolino TS Layout
- middleware.ts
- CLAUDE.md
- scripts
- August 2026 OCR Fixture (Paperless-ngx text)
- apply-import.ts
- End-to-end tests
- Transaction
- transaction.ts
- PayrollImport
- interest-accrual.itest.ts
- dashboard-app service
- [[...route]]/route.ts
- 7. Domain designs (what each section computes)
- August 2026 PDF-Text Fixture (clean layout)
- budgets/infrastructure/memory-repositories.ts
- SyncRun
- env
- interests/api/routes.ts
- Real Payslip Fixture: Agosto 2026
- Checkpoint: Phase 4 complete, whole-branch fix wave closed (2026-09-05)
- Code 8992 - TRATTAMENTO INT. DL 3/20
- IMPONIBILE IRPEF
- Real Payslip Fixture: Maggio 2026 (doc 102, welfare)
- Real Payslip Fixture: 13a Mensilita 2025 (doc 13)
- Code 300 - ASSENZA X FERIE A.C.(hh)
- Compose healthchecks and autoheal labels
- funds/[id]/page.tsx
- package.json
- migrate-funds.ts
- next.config.ts
- romeDate
- withSystemContext
- entrypoint.sh
- succeed
- Checkpoint: Phase 0 + Phase 1 complete (2026-09-03)
- Code 9837 - IMPONIBILE 5% L.199/25
- require-principal.ts
- SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md
- interest-accrual.ts
- { GET, POST }
- ADDIZIONALE COMUNALE
- db/index.ts
- TransactionCategory
- File Structure
- SyncKind
- payroll/application/ports.ts
- load-funds.ts
- integrations/types.ts
- expenses/api/routes.ts
- expenses/application/ports.ts
- Teable migration
- InterestAccrual
- schema/integrations.ts
- expenses/infrastructure/memory-repositories.ts
- Phase 1 deployment runbook — accounts and Teable retirement
- text.ts
- Finance Dashboard API
- Phase 2 deployment runbook — integration framework and encrypted credentials
- Architecture overview — Phases 0–6
- Finance Dashboard
- env.ts
- create-import.ts
- actions/leave.ts
- transactions.ts
- Execution rulings (full-phase run)
- The integration framework
- Checkpoint: Phase 2 complete (2026-09-04)
- Progress
- actions/budgets.ts
- load-company.ts
- apply-import.itest.ts
- File structure
- File structure
- get-interest-rule-detail.ts
- Phase 3 deployment runbook — Expenses and Interests
- list-integrations.ts
- File structure
- load-transactions.ts
- Rulings — execution (P3-C1 … P3-C38)
- gotify.ts
- llm-config.ts
- drizzle-allocations-repository.ts
- DbClient
- validate-funds-migration.ts
- File structure
- Checkpoint: Phase 3 complete (2026-09-05)
- Allocation
- wallet-provider-adapter.ts
- app/layout.tsx
- actions/funds.ts
- Phase 4: Payroll upload pipeline and Company
- 3. Target architecture
- withUserContext
- Phase 4 deployment runbook — Payroll upload pipeline and Company
- silo-provider-adapter.ts
- InterestRule
- (app)/page.tsx
- romeDate
- SDD ledger — plan: docs/superpowers/plans/2026-09-05-phase-4-payroll-and-company.md
- RulesTable.tsx
- Phases 5–9: shared conventions for Codex
- paperless-reconciliation.md
- calc/payroll.ts
- Fund
- validate-vacation-budget-migration.ts
- Phase 5 deployment runbook — Funds
- PayrollRecord
- review-import.test.ts
- _lib/leave.test.ts
- AuditInput
- 8. Security design
- budgets/application/ports.ts
- TimeSeriesChart.tsx
- expenses.ts
- run-interest-accrual.ts
- budgets/[id]/page.tsx
- FundContribution
- interests/application/ports.ts
- budgets/infrastructure/repositories.itest.ts
- payroll-rls.itest.ts
- vacation.ts
- reconcile-fund.ts
- repo/leave.ts
- connection.ts
- validate-teable-migration.ts
- jobs/registry.ts
- portfolio.ts
- drizzle-events-repository.ts
- crypto.ts
- trek-sync.test.ts
- scopes.ts
- InterestEntry
- Phase 6 checkpoint — Budgets
- actions/leave.test.ts
- webhook-signature.ts
- trek-provider-adapter.ts
- PayrollMonthsSource

## God Nodes (most connected - your core abstractions)
1. `assertPermission()` - 118 edges
2. `DbClient` - 101 edges
3. `withUserContext()` - 96 edges
4. `cn()` - 95 edges
5. `Principal` - 89 edges
6. `testDb()` - 87 edges
7. `testPrincipal()` - 68 edges
8. `withSystemContext()` - 66 edges
9. `users` - 60 edges
10. `requirePrincipalOrRedirect()` - 53 edges

## Surprising Connections (you probably didn't know these)
- `Code 8054 - CONTRIBUTO DIPENDENTE (negative)` --semantically_similar_to--> `Code 7101 - FONDO C/DIPE (employee pension-fund share)`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d13.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt
- `Code 4 - GIORNI NON LAVORATI` --semantically_similar_to--> `Code 19 - ORE NON LAVORATE`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d14.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt
- `Code 7101 - FONDO C/DIPE (employee pension-fund share)` --semantically_similar_to--> `Code 7053 - QUOTA ISCR.FONDO DIPEND.`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt → dashboard-app/src/lib/payroll/__fixtures__/real/d12.txt
- `Code 8992 - TRATTAMENTO INT. DL 3/20` --semantically_similar_to--> `Code 9424 - ULTERIORE DETRAZIONE MESE`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d10.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt
- `Code 9824 - SOMMA ART.1 C.4 L.207/24` --semantically_similar_to--> `Code 9837 - IMPONIBILE 5% L.199/25`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d10.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **IRPEF Settlement Chain (gross to net)** — dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_imponibile_irpef, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_irpef_lorda, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_totale_detrazioni, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9424_ulteriore_detrazione_mese, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_totale_trattenute_irpef, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_irpef_erario, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_addizionale_regionale, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_addizionale_comunale, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_netto_busta [EXTRACTED 1.00]
- **Leave-Hours Accounting Pattern (offsetting pair + residual grid)** — dashboard_app_src_lib_payroll___fixtures___real_ago2026_300_assenza_x_ferie_ac, dashboard_app_src_lib_payroll___fixtures___real_ago2026_301_ferie_ac, dashboard_app_src_lib_payroll___fixtures___real_d15_308_assenza_x_perm_ac, dashboard_app_src_lib_payroll___fixtures___real_d15_309_permessi_ac, dashboard_app_src_lib_payroll___fixtures___august_2026_pdf_leave_residuals_grid, dashboard_app_src_lib_payroll___fixtures___august_2026_ocr_flattened_residuals_defect [EXTRACTED 1.00]
- **TFR / Complementary Pension Contribution Block** — dashboard_app_src_lib_payroll___fixtures___real_ago2026_7101_fondo_c_dipe, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9109_fondo_c_azienda, dashboard_app_src_lib_payroll___fixtures___real_ago2026_8003_contribuzione_tfr, dashboard_app_src_lib_payroll___fixtures___real_ago2026_7897_esonero_ctr_tfr_prev_c, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9110_comunicazione_dipendente, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_tfr_mese [EXTRACTED 1.00]

## Communities (210 total, 9 thin omitted)

### Community 0 - "accounts/[id]/page.tsx"
Cohesion: 0.10
Nodes (31): BalanceHistoryRow, BalanceHistoryTable(), BalanceHistoryTableProps, BalancesPageResponse, AccountDetailPage(), dynamic, encodeCursor(), ArchivedAccountRow (+23 more)

### Community 1 - "cn"
Cohesion: 0.04
Nodes (68): AccountDetailActions(), AccountDetailActionsProps, dynamic, IntegrationPage(), FRESH, FUND, Gallery(), MONTHS (+60 more)

### Community 2 - "earnings.ts"
Cohesion: 0.17
Nodes (10): earningsSummary(), Accumulator, bucketsOf(), CONTRIBUTION_KINDS, EarningsBucketPartial, EarningsSummary, empty(), summariseEarnings() (+2 more)

### Community 3 - "budgets/api/routes.ts"
Cohesion: 0.05
Nodes (55): addAllocationRoute, addManualUsageRoute, allocationDto(), allocationViewDto(), budgetDto(), commonErrorResponses, createBudgetRoute, deleteManualUsageRoute (+47 more)

### Community 4 - "require-user.ts"
Cohesion: 0.12
Nodes (24): dynamic, GET(), bodySchema, dynamic, POST(), dynamic, POST(), AuthedUser (+16 more)

### Community 5 - "trek.ts"
Cohesion: 0.09
Nodes (41): UpstreamService, applyDesiredState(), ApplyDesiredStateInput, asRecord(), callTool(), CLIENT_INFO, describe(), ensureSession() (+33 more)

### Community 6 - "accounts/api/routes.ts"
Cohesion: 0.05
Nodes (57): accountDto(), balancePointDto(), commonErrorResponses, createAccountRoute, createGroupRoute, decodeCursor(), deleteAccountRoute, deleteGroupRoute (+49 more)

### Community 7 - "Finance & Company Platform — Design and Phased Plan"
Cohesion: 0.12
Nodes (16): 0. How to read this document, 10.1 Teable → PostgreSQL, 10.2 Paperless → payroll silo, 10.3 Single user → users table, 10.4 Deployment, 10. Migration strategy, 12. Intentional breaking changes, 13. Questions worth answering (none block Phase 0–1) (+8 more)

### Community 8 - "testPrincipal"
Cohesion: 0.10
Nodes (24): buildOpenApiDocument(), newAccount(), fundHarness(), seedFund(), setFundDepsFactoryForTests(), setPrincipalForTests(), PermissionDeniedError, ApiApp (+16 more)

### Community 9 - "parse.ts"
Cohesion: 0.11
Nodes (23): PAYSLIP_FIELDS, median(), PayslipHistoryEntry, LlmOptions, allLowFields(), detectThirteenth(), DetectThirteenthInput, emptyRules() (+15 more)

### Community 10 - "funds/api/routes.ts"
Cohesion: 0.05
Nodes (57): acknowledgeIssueRoute, addContributionRoute, commonErrorResponses, contributionDto(), createRoute_, detailDto(), fundDto(), getRoute (+49 more)

### Community 11 - "compilerOptions"
Cohesion: 0.07
Nodes (29): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+21 more)

### Community 12 - "PageGrid.tsx"
Cohesion: 0.07
Nodes (13): LG_SPAN, LG_START, MD_SPAN, PanelProps, Span, Skeleton(), SkeletonBlockProps, SkeletonChart() (+5 more)

### Community 13 - "TransactionsTable.tsx"
Cohesion: 0.31
Nodes (7): TransactionRow, TransactionEditFormProps, toRow(), TransactionsApiItem, TransactionsApiPage, TransactionsTable(), TransactionsTableProps

### Community 14 - "actions/accounts.ts"
Cohesion: 0.11
Nodes (26): PARTS, TZ, createManualAccount(), CreateManualAccountInput, createManualAccountSchema, deleteAccount(), DeleteAccountResult, DeletionBlockedError (+18 more)

### Community 15 - "rules.ts"
Cohesion: 0.11
Nodes (29): Anchor, AUX_ANCHORS, AUX_FIELDS, COMPOSITE_FIELDS, FIELD_ANCHORS, GRID_HEADER_SYNONYMS, GridId, GRIDS (+21 more)

### Community 16 - "ingest.ts"
Cohesion: 0.11
Nodes (27): ingestOne(), systemPrincipalFor(), llmOptionsFromConfig(), markUploaded(), applyParseConclusion(), applyScanConclusion(), beginParse(), beginScan() (+19 more)

### Community 17 - "AccountGroup"
Cohesion: 0.15
Nodes (5): GroupsRepository, AccountGroup, DrizzleGroupsRepository, toGroup(), MemoryGroupsRepository

### Community 18 - "wallet.ts"
Cohesion: 0.08
Nodes (43): requestJson(), SleepFn, withRetry(), accountSchema, accountsSchema, assertFieldSeenSomewhere(), assertPageNotTruncated(), baseUrl() (+35 more)

### Community 19 - "monthKeyOf"
Cohesion: 0.20
Nodes (19): TotalBalanceCards(), alignSeries(), carryForward(), CustomRange, Delta, deltaOverRange(), pointsOf(), RangePreset (+11 more)

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
Cohesion: 0.15
Nodes (20): dynamic, InterestRulePage(), metadata, monthStart(), listInterestRules(), accountNamesFor(), AccountNamesLookup, loadInterestRuleDetail() (+12 more)

### Community 25 - "IntegrationConnection"
Cohesion: 0.08
Nodes (17): ConnectIntegrationInput, ConnectionPatch, ConnectionsRepository, ConnectionStatePatch, NewConnection, WebhookDeliveriesRepository, WebhookDelivery, DrizzleConnectionsRepository (+9 more)

### Community 26 - "actions/payroll.ts"
Cohesion: 0.11
Nodes (40): applyPayslipAction(), nextInQueue(), rejectPayslipAction(), revalidate(), toActionError(), uploadPayslipAction(), VerifyActionInput, verifyPayslipAction() (+32 more)

### Community 27 - "confidence.ts"
Cohesion: 0.11
Nodes (30): FieldExtraction, PayslipField, AuxField, GRID_DEPENDENT_FIELDS, BALANCE_TOLERANCE, checkNetAgainstMedian(), checkNettoBalance(), checkResidualContinuity() (+22 more)

### Community 28 - "actions/integrations.ts"
Cohesion: 0.10
Nodes (33): connectIntegrationAction(), credentialsFrom(), disconnectIntegrationAction(), mapError(), revalidateIntegrations(), syncIntegrationAction(), testIntegrationAction(), connectIntegration() (+25 more)

### Community 29 - "trek-diff.ts"
Cohesion: 0.19
Nodes (16): Editing, LeaveDayDetail, LeaveFraction, LeaveKind, DesiredDay, TogglePlanStep, TrekEntry, differs() (+8 more)

### Community 30 - "llm.ts"
Cohesion: 0.15
Nodes (16): buildTool(), chatCompletionsUrl(), coerceMonth(), coerceNumber(), DEFAULT_MAX_CHARS, DEFAULT_TIMEOUT_MS, emptyResult(), errorName() (+8 more)

### Community 31 - "Phase 1 — Accounts and Teable retirement"
Cohesion: 0.07
Nodes (27): File structure (what will exist after Phase 1), Global Constraints, Phase 0 — Foundations, Phase 0 + Phase 1: Foundations and Accounts Implementation Plan, Phase 1 — Accounts and Teable retirement, Self-review against the spec, Task 10: Capability resolver and capability-driven navigation, Task 11: Accounts schema with RLS (+19 more)

### Community 32 - "testDb"
Cohesion: 0.09
Nodes (30): ProfileView, seed(), asGroupUser(), asLinkUser(), asUser(), seedUsers(), seed(), appFor() (+22 more)

### Community 33 - "funds/application/ports.ts"
Cohesion: 0.06
Nodes (26): FundRow, VersionMismatchError, AccountLinkSource, Clock, ContributionSource, FundPatch, FundPlan, FundSchedule (+18 more)

### Community 34 - "auth/principal.ts"
Cohesion: 0.11
Nodes (41): registerBudgetRoutes(), addAllocation(), AddAllocationInput, schema, base, addManualUsage(), AddManualUsageInput, schema (+33 more)

### Community 35 - "contracts.ts"
Cohesion: 0.09
Nodes (27): REVOLUT_COMPONENT_KEYS, WALLET_ACCOUNTS, WALLET_EXPECTED_CURRENCY, WalletAccountConfig, getBalances(), WalletBalances, ACCOUNT_KEYS, AccountKey (+19 more)

### Community 36 - "http.ts"
Cohesion: 0.12
Nodes (16): backoffDelay(), HttpError, httpRequest(), HttpRequestInit, isRetryable(), isRetryableStatus(), parseRetryAfter(), readBody() (+8 more)

### Community 37 - "networth.ts"
Cohesion: 0.22
Nodes (12): contributingKeys(), missingKeys(), netWorth, NetWorthContributor, NetWorthOptions, observe(), Observed, oldestCapture() (+4 more)

### Community 38 - "list-accounts.ts"
Cohesion: 0.09
Nodes (23): MonthPoint, UseCaseDeps, AccountDetail, getAccountDetail(), AccountListItem, DEFAULT_TREND_MONTHS, isStale(), listAccounts() (+15 more)

### Community 39 - "trek.test.ts"
Cohesion: 0.17
Nodes (14): resetTrekAuthCache(), callsTo(), CONFIG, entriesPayload(), fetchMock, LIVE_STATS, Rpc, rpcOf() (+6 more)

### Community 40 - "payroll-contribution-sink.ts"
Cohesion: 0.10
Nodes (39): addContribution(), AddContributionInput, schema, createFund(), CreateFundInput, schema, InvalidInputError, NotFoundError (+31 more)

### Community 41 - "5. Data model"
Cohesion: 0.18
Nodes (11): 5.10 Indexes (access-pattern driven), 5.1 Identity and access, 5.2 Integrations, 5.3 Accounts, 5.4 Transactions (Expenses), 5.5 Funds, 5.6 Budgets, 5.7 Interests (+3 more)

### Community 42 - "drizzle-scopes-usages-repository.ts"
Cohesion: 0.14
Nodes (7): Usage, UsagesRepository, normalizeScale(), DrizzleUsagesRepository, toUsage(), MemoryUsagesRepository, monotonicId()

### Community 43 - "update-interest-rule.ts"
Cohesion: 0.22
Nodes (7): InvalidInputError, NotFoundError, VersionMismatchError, DATE_RE, isValidDateOnly(), RATE_RE, updateInterestRulePatchSchema

### Community 44 - "toCents"
Cohesion: 0.17
Nodes (19): legacySeriesFromSnapshots(), centsFromDecimal(), fromCents(), roundEur(), toCents(), DailyAccrualInput, DailyAccrualResult, dailyInterest() (+11 more)

### Community 45 - "Finance Dashboard — Brand System"
Cohesion: 0.25
Nodes (8): 1. Strategy, 2. The mark, 3. Assets, 4. Colour, 5. Typography, 6. Voice, 7. Applications, Finance Dashboard — Brand System

### Community 46 - "teamsystem.ts"
Cohesion: 0.23
Nodes (15): parseItalianNumber(), bodyRow(), EMPTY, extractTeamSystem(), findGrid(), isNumericOnly(), numbersOf(), plausibleHours() (+7 more)

### Community 47 - "OverviewClient.tsx"
Cohesion: 0.06
Nodes (41): FinanceTabs(), HREF, OPTIONS, ViewKey, DEFAULT_STATE, OverviewAccount, OverviewClient(), OverviewClientProps (+33 more)

### Community 48 - "_lib/leave.ts"
Cohesion: 0.16
Nodes (19): LeaveCalendarProps, LeaveCalendarView, LeaveMonthView, loadLeaveCalendar(), monthsOf(), MonthGridDay, flaggedMonths(), LeaveMonthVariance (+11 more)

### Community 49 - "payroll/api/routes.ts"
Cohesion: 0.05
Nodes (54): applyRoute, commonErrorResponses, componentDto(), earningsRoute, getImportRoute, getRecordRoute, IdParamSchema, IfMatchHeaderSchema (+46 more)

### Community 50 - "render-brand-icons.py"
Cohesion: 0.33
Nodes (3): Rasterise the Finance Dashboard mark to PNG. No rasteriser is installed on this…, radius=0 renders a full-bleed square (maskable); otherwise a rounded square., render()

### Community 51 - "schema/index.ts"
Cohesion: 0.12
Nodes (19): accounts, auditEvents, organizations, roles, userIdentities, userRoles, users, idempotencyKeys (+11 more)

### Community 52 - "teable-import.ts"
Cohesion: 0.17
Nodes (13): centsToString(), DEFAULT_BY_KEY, DEFAULTS, DERIVED_KEYS, EXPORTED_NUMBER_COLUMNS, pivotExportedRecords(), PlannedAccount, PlannedBalance (+5 more)

### Community 53 - "format.ts"
Cohesion: 0.08
Nodes (42): LeaveByMonth(), FRACTION_OPTIONS, KIND_OPTIONS, LeaveCalendar(), varianceSentence(), dynamic, metadata, TimeOffPage() (+34 more)

### Community 54 - "load-payroll.test.ts"
Cohesion: 0.08
Nodes (21): extraction(), principal, seed(), MemoryFundContributionSink, FundContributionSink, UseCaseDeps, PURGE_BATCH, purgeOne() (+13 more)

### Community 56 - "machine.ts"
Cohesion: 0.15
Nodes (18): dynamic, POST(), dynamic, POST(), Bucket, buckets, constantTimeEqual(), CRON_SECRET_HEADER (+10 more)

### Community 57 - "integrations/api/routes.ts"
Cohesion: 0.08
Nodes (37): CappedRead, commonErrorResponses, conflict, connectionDto(), connectRoute, disconnectRoute, listRoute, notFound (+29 more)

### Community 58 - "Mod. Cedolino TS Layout"
Cohesion: 0.22
Nodes (10): Code 1150 - RATA ADD.REG. A.P., Real Payslip Fixture: Marzo 2026 (doc 96), ADDIZIONALE REGIONALE, Fixture Anonymisation Convention, Employer Header Block (Ditta / ACME Consulting srl), TeamSystem August 2026 Fixture (synthetic-anonymised), IBAN / Bank Accredito Trailer Line, Q/INPS - INAIL Statistical Block (+2 more)

### Community 59 - "middleware.ts"
Cohesion: 0.23
Nodes (11): config, contentSecurityPolicy(), frameAncestorsFor(), hasSessionCookie(), isPublic(), middleware(), PUBLIC_PATHS, PUBLIC_PREFIXES (+3 more)

### Community 61 - "scripts"
Cohesion: 0.08
Nodes (24): scripts, build, db:generate, db:migrate, dev, e2e, lint, migrate:credentials (+16 more)

### Community 62 - "August 2026 OCR Fixture (Paperless-ngx text)"
Cohesion: 0.29
Nodes (7): OCR Digit/Letter Confusion, August 2026 OCR Fixture (Paperless-ngx text), Flattened Residuals Grid OCR Defect, Leave Residuals Grid (FERIE / PERMESSI / ROL / FLESS. / B. ORE), Garbage OCR Fixture (skewed scan), All-Low-Confidence Degradation (Failure Handling), OCR Letter-Spacing Artifact (S -> 'S ')

### Community 63 - "apply-import.ts"
Cohesion: 0.12
Nodes (23): PayslipExtraction, applyImport(), extraction, NOW, principal, amountOf(), componentsFromExtraction(), grossOf() (+15 more)

### Community 64 - "End-to-end tests"
Cohesion: 0.50
Nodes (3): End-to-end tests, Planned flows (not yet written), `smoke.spec.ts` (implemented)

### Community 65 - "Transaction"
Cohesion: 0.09
Nodes (14): transactionLabelLinks, TransactionRow, ListTransactionsOptions, ListTransactionsPage, NewTransaction, TransactionsRepository, UpdateTransactionInput, Transaction (+6 more)

### Community 66 - "transaction.ts"
Cohesion: 0.09
Nodes (25): WalletCategory, WalletRecord, ProviderCategory, ProviderTransaction, TransactionsSource, syncProviderTransactions(), SyncProviderTransactionsDeps, SyncProviderTransactionsResult (+17 more)

### Community 67 - "PayrollImport"
Cohesion: 0.10
Nodes (7): AppliedImport, RaceyImportsRepository, PayrollImport, PayrollImportsRepository, DrizzlePayrollImportsRepository, toImport(), MemoryPayrollImportsRepository

### Community 68 - "interest-accrual.itest.ts"
Cohesion: 0.08
Nodes (18): AccountBalanceRow, accountBalances, AccountGroupRow, accountGroups, AccountRow, ProviderLinkRow, providerLinks, InterestAccrualRow (+10 more)

### Community 69 - "dashboard-app service"
Cohesion: 0.38
Nodes (7): dashboard-app service, dashboard-cron supercronic sidecar service, External networks proxy_public and db_internal, projects compose stack, read_only rootfs, cap_drop ALL, tmpfs and limits, Read-only secret file mounts (wallet-token, trek-token), Traefik router with X-Forwarded-Proto https middleware

### Community 70 - "[[...route]]/route.ts"
Cohesion: 0.14
Nodes (14): app, DELETE, dynamic, GET, PATCH, POST, PUT, first() (+6 more)

### Community 71 - "7. Domain designs (what each section computes)"
Cohesion: 0.20
Nodes (10): 7.1 Home, 7.2 Finance Overview, 7.3 Accounts, 7.4 Funds, 7.5 Budgets, 7.6 Interests (reuse / change / deprecate from `interest.py`), 7.7 Expenses, 7.8 Company (+2 more)

### Community 72 - "August 2026 PDF-Text Fixture (clean layout)"
Cohesion: 0.28
Nodes (9): Code 001 - RETRIBUZIONE ORDINARIA, August 2026 PDF-Text Fixture (clean layout), TOTALE RITENUTE, Code 2 - LAVORO ORDIN.(mens.), Code 1101 - IRPEF A CREDITO -MOD.730-, Code 9208 - CREDITO COMPENSATO, Real Payslip Fixture: Luglio 2026 (doc 104, 730 refund), ARROTONDAMENTO (+1 more)

### Community 73 - "budgets/infrastructure/memory-repositories.ts"
Cohesion: 0.21
Nodes (7): VersionMismatchError, Scope, ScopesRepository, ScopeLike, DrizzleScopesRepository, toScope(), MemoryScopesRepository

### Community 74 - "SyncRun"
Cohesion: 0.13
Nodes (10): NewSyncRun, SyncRunsRepository, Prepared, RunSyncInput, DrizzleSyncRunsRepository, toRun(), MemorySyncRunsRepository, SyncRun (+2 more)

### Community 75 - "env"
Cohesion: 0.17
Nodes (23): runtime, asNumber(), asString(), authentikProvider(), buildConfig(), discoverOidc(), fetchDiscovery(), { handlers, auth, signIn, signOut } (+15 more)

### Community 76 - "interests/api/routes.ts"
Cohesion: 0.10
Nodes (26): accrualDto(), commonErrorResponses, createRoute_, entryDto(), getRoute, IdParamSchema, IfMatchHeaderSchema, listRoute (+18 more)

### Community 77 - "Real Payslip Fixture: Agosto 2026"
Cohesion: 0.25
Nodes (11): Code 19 - ORE NON LAVORATE, Code 2161 - DONATORI SANGUE, Code 7101 - FONDO C/DIPE (employee pension-fund share), Code 7897 - ESONERO CTR - TFR PREV.C., Code 8003 - CONTRIBUZIONE TFR, Code 9109 - FONDO C/AZIENDA (employer pension-fund share), Code 9110 - COMUNICAZIONE DIPENDENTE, Real Payslip Fixture: Agosto 2026 (+3 more)

### Community 78 - "Checkpoint: Phase 4 complete, whole-branch fix wave closed (2026-09-05)"
Cohesion: 0.11
Nodes (17): Checkpoint: Phase 4 complete, whole-branch fix wave closed (2026-09-05), Deferred and parked findings — none of these were fixed, Deployment status, Documents, Graphify — NOT re-run for this correction, Graphify (Step 3 — the one task in this phase permitted to run it, as of Task 24), Grep checks (Step 2), How to continue (+9 more)

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

### Community 85 - "funds/[id]/page.tsx"
Cohesion: 0.10
Nodes (32): asDate(), dynamic, FundDetailPage(), issueDetail(), issueLabel(), asDate(), dynamic, FundsPage() (+24 more)

### Community 86 - "package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 87 - "migrate-funds.ts"
Cohesion: 0.06
Nodes (38): backfillSnapshotAccountProvenance(), CanonicalSnapshot, canonicalSnapshots(), Counts, eligibleSnapshotKeys(), main(), migrate(), MigrationInputError (+30 more)

### Community 89 - "romeDate"
Cohesion: 0.21
Nodes (15): BudgetsCard(), romeDate(), BudgetDetail, getBudgetDetail(), lastDayOfMonth(), BudgetSummary, listBudgets(), asOfFor() (+7 more)

### Community 90 - "withSystemContext"
Cohesion: 0.09
Nodes (32): absCents(), cents(), Counts, dateOf(), findExistingMigratedBudget(), formatCents(), invokedPathLooksLikeThisScript, lastDayOfMonth() (+24 more)

### Community 92 - "succeed"
Cohesion: 0.35
Nodes (18): createAccountAction(), createGroupAction(), deleteAccountAction(), deleteGroupAction(), flag(), mapError(), recordBalanceAction(), renameGroupAction() (+10 more)

### Community 93 - "Checkpoint: Phase 0 + Phase 1 complete (2026-09-03)"
Cohesion: 0.25
Nodes (7): Before Phase 2, Checkpoint: Phase 0 + Phase 1 complete (2026-09-03), Decisions already taken (summary; full text in the ledger), Deployment status (2026-09-03, later the same day), Documents, How to continue, State

### Community 94 - "Code 9837 - IMPONIBILE 5% L.199/25"
Cohesion: 0.50
Nodes (4): Code 9837 - IMPONIBILE 5% L.199/25, Code 9838 - IMPOSTA SOST. 5% L.199/25, Real Payslip Fixture: Giugno 2026 (doc 103), PAGA BASE / PREMIO PR. / SUPERM.ASS Row

### Community 95 - "require-principal.ts"
Cohesion: 0.05
Nodes (59): AccountsPage(), dynamic, metadata, BudgetsPage(), dynamic, metadata, periodLabel(), dynamic (+51 more)

### Community 96 - "SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md"
Cohesion: 0.50
Nodes (3): Pre-flight scan (2026-09-02), Progress, SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md

### Community 97 - "interest-accrual.ts"
Cohesion: 0.16
Nodes (15): accrueRule(), AccrueRuleResult, activeRules(), JOB_NAME, LOCK_KEY, PostFailedError, RunInterestAccrualJobInput, tryPost() (+7 more)

### Community 107 - "db/index.ts"
Cohesion: 0.09
Nodes (56): dynamic, alertJobFailure(), errorMessage(), JobResult, db, runInterestAccrualJob(), closeOwner(), JOB_NAME (+48 more)

### Community 109 - "TransactionCategory"
Cohesion: 0.19
Nodes (7): isUniqueViolation(), CategoriesRepository, NewCategory, TransactionCategory, DrizzleCategoriesRepository, toCategory(), MemoryCategoriesRepository

### Community 110 - "File Structure"
Cohesion: 0.07
Nodes (28): File Structure, Global Constraints, Phase 3: Expenses and Interests, Rulings, Self-review against the Phase 3 scope, Task 10: Expenses REST API, Task 11: Expenses pages — list and detail, replacing the setup state, Task 12: Recurring-pattern persistence wired into the transactions sync (+20 more)

### Community 111 - "SyncKind"
Cohesion: 0.19
Nodes (7): SyncJob, SyncJobsRepository, DrizzleSyncJobsRepository, toJob(), MemorySyncJobsRepository, SyncKind, SyncSchedule

### Community 112 - "payroll/application/ports.ts"
Cohesion: 0.06
Nodes (40): Confidence, payrollMappingRules, Clock, FundContributionWrite, ListImportsOptions, MappingTarget, NewPayrollComponent, NewPayrollImport (+32 more)

### Community 113 - "load-funds.ts"
Cohesion: 0.17
Nodes (20): FundsCard(), FundDetail, getFundDetail(), listFunds(), optionsSchema, FundSummary, summarizeFund(), absoluteReturn() (+12 more)

### Community 114 - "integrations/types.ts"
Cohesion: 0.07
Nodes (33): IntegrationDeps, drainSyncQueue(), enqueueSync(), SyncDisabledError, handleWebhook(), makeDeps(), principal, provider() (+25 more)

### Community 115 - "expenses/api/routes.ts"
Cohesion: 0.08
Nodes (31): categoriesRoute, categoryDto(), commonErrorResponses, getRoute, IdParamSchema, IfMatchHeaderSchema, labelDto(), labelsRoute (+23 more)

### Community 116 - "expenses/application/ports.ts"
Cohesion: 0.12
Nodes (13): detectRecurringPatterns(), Clock, RecurringPatternRecord, RecurringPatternsRepository, Cadence, CADENCE_DAY_BANDS, cadenceFor(), DetectedPattern (+5 more)

### Community 117 - "Teable migration"
Cohesion: 0.29
Nodes (7): Files in this directory, `npm run migrate:teable`, `npm run migrate:teable:validate`, Order of operations, Paperless → payroll document store, Running against the deployed container, Teable migration

### Community 118 - "InterestAccrual"
Cohesion: 0.09
Nodes (9): InterestAccrual, InterestAccrualsRepository, NewInterestAccrual, DrizzleInterestAccrualsRepository, toAccrual(), MemoryInterestAccrualsRepository, monotonicId(), normalizeScale() (+1 more)

### Community 119 - "schema/integrations.ts"
Cohesion: 0.16
Nodes (11): bytea, IntegrationConnectionRow, integrationConnections, IntegrationProviderRow, integrationProviders, SyncJobRow, syncJobs, SyncRunRow (+3 more)

### Community 120 - "expenses/infrastructure/memory-repositories.ts"
Cohesion: 0.13
Nodes (9): loadTransactionDetail, requirePrincipalOrRedirect, InvalidInputError, NotFoundError, VersionMismatchError, getTransaction(), TransactionDetail, TransactionPatch (+1 more)

### Community 121 - "Phase 1 deployment runbook — accounts and Teable retirement"
Cohesion: 0.18
Nodes (11): Cleanup after a successful deploy, Phase 1 deployment runbook — accounts and Teable retirement, Pre-checks, Rollback, Step 1 — build the new image, Step 2 — apply migrations 0004–0006 only, Step 3 — import the legacy history, Step 4 — validate (+3 more)

### Community 122 - "text.ts"
Cohesion: 0.24
Nodes (11): detectPeriodMonth(), fixture(), GARBAGE_TEXT, OCR_TEXT, PDF_TEXT, extractPdfText(), fixNumericOcr(), normalizeText() (+3 more)

### Community 123 - "Finance Dashboard API"
Cohesion: 0.12
Nodes (17): Authentication, Breaking changes in Phase 2, Budgets, Endpoints (Phase 1 + Phase 2), Error envelope, Expenses, Finance Dashboard API, Funds (+9 more)

### Community 124 - "Phase 2 deployment runbook — integration framework and encrypted credentials"
Cohesion: 0.18
Nodes (10): 1. Pre-checks, 2. Generate the encryption key, 3. Deploy the new image with the token files still mounted, 4. Import the file-mounted credentials, 5. Verify in the UI, 6. Remove the token files, 7. Verify the tick, 8. Rollback (+2 more)

### Community 125 - "Architecture overview — Phases 0–6"
Cohesion: 0.11
Nodes (12): API conventions, Architecture overview — Phases 0–6, Budgets, Capability-driven navigation and Home, Funds and payroll posting, Integration framework, Job tiers, Known deviations (+4 more)

### Community 126 - "Finance Dashboard"
Cohesion: 0.29
Nodes (7): Developing, Documentation, Finance Dashboard, Running it, Stack, Status: Phase 0 + Phase 1 complete, Testing

### Community 127 - "env.ts"
Cohesion: 0.15
Nodes (11): BASE_ENV, CONFIGURED, fetchMock, loadGotify(), resetEnvCache(), schema, documentStoreConfigured(), savedEnv (+3 more)

### Community 128 - "create-import.ts"
Cohesion: 0.12
Nodes (20): reserveImport(), ReserveImportInput, retentionUntil(), base, NOW, principal, UploadCandidate, validateUpload() (+12 more)

### Community 129 - "actions/leave.ts"
Cohesion: 0.17
Nodes (23): daySchema, describe(), LEAVE_PATHS, LeaveDaySaved, noopSync(), removeLeaveDay(), removeSchema, revalidateLeave() (+15 more)

### Community 130 - "transactions.ts"
Cohesion: 0.13
Nodes (12): RecurringPatternRow, recurringPatterns, transactionCategories, TransactionCategoryRow, TransactionLabelRow, transactionLabels, LabelsRepository, NewLabel (+4 more)

### Community 132 - "Execution rulings (full-phase run)"
Cohesion: 0.08
Nodes (24): Deviation, Deviation — Task 2, Deviation — Task 3, Deviation — Task 4, Deviation — Task 6, Deviation — Task 7, Deviation — Task 8, Execution record — 2026-09-06 (+16 more)

### Community 133 - "The integration framework"
Cohesion: 0.18
Nodes (11): 1. What an integration is, 2. Credential storage, 3. Key rotation, 4. Connection lifecycle, 5. Sync runs, 6. Inbound webhooks, 7. Adding a provider, `payroll_silo` (+3 more)

### Community 134 - "Checkpoint: Phase 2 complete (2026-09-04)"
Cohesion: 0.25
Nodes (7): Checkpoint: Phase 2 complete (2026-09-04), Decisions already taken (summary; full text in the ledger and in `task-20-brief.md`'s "Rulings" section), Deployment status, Documents, How to continue, State, What a reader should know before Phase 3

### Community 135 - "Progress"
Cohesion: 0.33
Nodes (5): Deferred-minor cleanup wave (batch before Task 19), Pre-flight rulings (2026-09-04), Pre-flight scan, Progress, SDD ledger — plan: docs/superpowers/plans/2026-09-04-phase-2-integrations.md

### Community 136 - "actions/budgets.ts"
Cohesion: 0.30
Nodes (22): addAllocationAction(), addManualUsageAction(), createBudgetAction(), deleteManualUsageAction(), endAllocationAction(), labelsFrom(), mapError(), money() (+14 more)

### Community 137 - "load-company.ts"
Cohesion: 0.10
Nodes (26): CompanyPage(), dynamic, metadata, StatEmphasis, StatGrid(), StatGridProps, StatTile(), StatTileProps (+18 more)

### Community 138 - "apply-import.itest.ts"
Cohesion: 0.10
Nodes (17): fixture(), FundContributionRow, fundContributions, fundContributionSchedules, fundContributionTypes, FundPlanRow, fundPlans, funds (+9 more)

### Community 141 - "File structure"
Cohesion: 0.12
Nodes (15): File structure, Phase 9: Management, webhooks, hardening, Rulings, Scope cut, Self-review against the spec, Task 1: Fix `withJobLock` (the platform defect from the Phase 4 checkpoint), Task 2: Outbound webhooks, Task 3: Management — categories, labels, payroll mapping rules (+7 more)

### Community 142 - "File structure"
Cohesion: 0.13
Nodes (14): File structure, Phase 6: Budgets, Rulings, Scope cut, Self-review against the spec, Task 1: Migration 0017 — budget tables and RLS, Task 2: Domain — figures and scopes, Task 3: Ports, repositories, sources (+6 more)

### Community 143 - "get-interest-rule-detail.ts"
Cohesion: 0.33
Nodes (7): createInterestRule(), dayAfter(), getInterestRuleDetail(), InterestRuleDetail, startOfDay(), ProjectionPoint, ReconciliationSummary

### Community 144 - "Phase 3 deployment runbook — Expenses and Interests"
Cohesion: 0.14
Nodes (12): Before you start: read the container's current configuration, Retiring the standalone `wallet-manager` interest container, Rollback, Steps, What a crash leaves behind, and why this procedure avoids relying on it, 1. Pre-checks, 2. Deploy, 3. Verify (+4 more)

### Community 145 - "list-integrations.ts"
Cohesion: 0.33
Nodes (8): IntegrationsPage(), IntegrationSummary, listIntegrations(), ConnectFormProps, loadIntegration(), loadIntegrations(), CredentialField, IntegrationCapability

### Community 146 - "File structure"
Cohesion: 0.14
Nodes (13): File structure, Phase 7: Time Off workspace, Rulings, Scope cut, Self-review against the spec, Task 1: Migration 0018 — time-off tables and RLS, Task 2: Domain — units, event status, variance, Task 3: Ports, repositories, Trek store (+5 more)

### Community 147 - "load-transactions.ts"
Cohesion: 0.17
Nodes (16): listCategories(), listLabels(), listRecurringPatterns(), listTransactions(), ListTransactionsResult, TransactionListItem, UseCaseDeps, expenseDeps() (+8 more)

### Community 150 - "Rulings — execution (P3-C1 … P3-C38)"
Cohesion: 0.06
Nodes (32): Consequences of P3-C37 and P3-C29 that later work must not contradict, Deferred by design, Expenses rulings, Fix wave batch A — DONE (48709aa, 1e32ff9, f00c132), Fix wave batch B — DONE (da41da2, 61c9c1c, 0a0905b, f3f3832, ce743b4; migration 0014_interest_posting_fixes.sql), Fix wave batch C — DONE (aef890a, ab25461, 9497f59, 60cda52, 09b5739; no migration), Fix-wave re-review dispatched, Fix wave — three sequential batches, all approved on first re-review (+24 more)

### Community 151 - "gotify.ts"
Cohesion: 0.13
Nodes (16): alertPayslipPending(), alertSuccessAfterRetry(), appUrl(), GotifyMessage, JobFailureAlert, notify(), PayslipPendingAlert, RetrySuccessAlert (+8 more)

### Community 152 - "llm-config.ts"
Cohesion: 0.11
Nodes (25): clearLlmApiKey(), completeFirstRun(), hoursSchema, llmSchema, setHoursPerDay(), setLlmSettings(), HoursPerDayForm(), KEY_STATUS (+17 more)

### Community 153 - "drizzle-allocations-repository.ts"
Cohesion: 0.11
Nodes (15): BudgetAllocationRow, BudgetAmountVersionRow, budgetAmountVersions, BudgetRow, budgets, BudgetScopeRow, budgetScopes, BudgetUsageRow (+7 more)

### Community 154 - "DbClient"
Cohesion: 0.08
Nodes (25): main(), readTrimmed(), bootstrapOwner(), DbClient, db, pool, payrollRecords, drizzleAccountLinkSource() (+17 more)

### Community 155 - "validate-funds-migration.ts"
Cohesion: 0.16
Nodes (23): AccountHistoryRow, CanonicalSnapshot, canonicalSnapshots(), cents(), eligibleSnapshotKeys(), expectSinglePart(), failSource(), independentPeriod() (+15 more)

### Community 156 - "File structure"
Cohesion: 0.14
Nodes (13): File structure, Phase 8: Security and Administration, Rulings, Scope cut (deferred, explicitly), Self-review against the spec, Task 1: Migration 0019 — security tables and RLS, Task 2: Session registry and sign-in wiring, Task 3: TOTP, recovery codes, step-up (+5 more)

### Community 157 - "Checkpoint: Phase 3 complete (2026-09-05)"
Cohesion: 0.15
Nodes (12): Behaviours the plan text and the original checkpoint predate, Checkpoint: Phase 3 complete, whole-branch fix wave closed (2026-09-05), Deployment status, Documents, How to continue, Key design decisions from the fix wave, Not run: the manual walkthrough with a real Wallet token, One parked minor (+4 more)

### Community 158 - "Allocation"
Cohesion: 0.17
Nodes (5): Allocation, AllocationsRepository, DrizzleAllocationsRepository, toAllocation(), MemoryAllocationsRepository

### Community 159 - "wallet-provider-adapter.ts"
Cohesion: 0.05
Nodes (41): WalletAccount, NOW, AccountPatch, AccountsSource, Clock, NewAccount, NewBalance, ProviderAccount (+33 more)

### Community 160 - "app/layout.tsx"
Cohesion: 0.27
Nodes (6): metadata, viewport, THEME_STORAGE_KEY, ThemeScript(), plexMono, plexSans

### Community 161 - "actions/funds.ts"
Cohesion: 0.19
Nodes (24): acknowledgeIssueAction(), addContributionAction(), createFundAction(), mapError(), month(), optionalMonth(), parsedMoney(), reconcileFundAction() (+16 more)

### Community 162 - "Phase 4: Payroll upload pipeline and Company"
Cohesion: 0.06
Nodes (30): File Structure, Global Constraints, Phase 4: Payroll upload pipeline and Company, Rulings, Self-review against the Phase 4 scope, Task 10: Ingesting an import — scan, extract text, parse, Task 11: Reviewing and applying an import, Task 12: Reading imports, records and the earnings summary (+22 more)

### Community 163 - "3. Target architecture"
Cohesion: 0.40
Nodes (5): 3.1 Shape, 3.2 API surface, 3.3 Capabilities and dynamic composition, 3.4 Background work, 3. Target architecture

### Community 164 - "withUserContext"
Cohesion: 0.10
Nodes (36): appSettings, overlappingRequests(), withPayroll(), aVerifiedImport(), DEFAULT_RETENTION_YEARS, markUploadFailed(), payrollDeps(), resolveDocumentStore() (+28 more)

### Community 165 - "Phase 4 deployment runbook — Payroll upload pipeline and Company"
Cohesion: 0.22
Nodes (8): 1. Pre-checks, 2. Wave 1 — deploy the migration image, 3. Wave 2 — deploy the removal image, 4. Verify, 5. Scanning, 6. Retention, 7. Rollback, Phase 4 deployment runbook — Payroll upload pipeline and Company

### Community 166 - "silo-provider-adapter.ts"
Cohesion: 0.11
Nodes (23): createS3DocumentStore(), S3StoreConfig, bytes, config, storeWith(), amzDate(), canonicalPath(), canonicalQuery() (+15 more)

### Community 167 - "InterestRule"
Cohesion: 0.15
Nodes (8): InterestRule, InterestRulePatch, InterestRulesRepository, NewInterestRule, DrizzleInterestRulesRepository, toRule(), definedEntries(), MemoryInterestRulesRepository

### Community 168 - "(app)/page.tsx"
Cohesion: 0.06
Nodes (52): dynamic, EarningsPage(), metadata, dynamic, EarningsRecordPage(), generateMetadata(), dynamic, metadata (+44 more)

### Community 169 - "romeDate"
Cohesion: 0.29
Nodes (9): asDate(), classify(), isStale(), snapshotGrace, StalenessInfo, StalenessSource, NOW, DISPLAY_STALENESS_MS (+1 more)

### Community 170 - "SDD ledger — plan: docs/superpowers/plans/2026-09-05-phase-4-payroll-and-company.md"
Cohesion: 0.25
Nodes (7): Corrections this planning pass made to the superseded draft, Deferred by design, Rulings — execution (PH4-C1 … PH4-C13), Rulings — execution, whole-branch review (PH4-C15 … PH4-C22), Rulings — planning (R4-1 … R4-18), SDD ledger — plan: docs/superpowers/plans/2026-09-05-phase-4-payroll-and-company.md, Task-by-task summary

### Community 171 - "RulesTable.tsx"
Cohesion: 0.47
Nodes (5): RuleRow, asPercent(), POSTING_LABEL, RulesTable(), RulesTableProps

### Community 172 - "Phases 5–9: shared conventions for Codex"
Cohesion: 0.40
Nodes (4): How to execute a plan with Codex, Phases 5–9: shared conventions for Codex, Repository facts (verified 2026-09-06 on `main` at `6294194`), Task template used by every plan

### Community 174 - "calc/payroll.ts"
Cohesion: 0.17
Nodes (19): sumCents(), annualTotals, averageNet(), AverageOptions, averageTaxes(), inYear(), isThirteenthCandidate(), isVerified() (+11 more)

### Community 175 - "Fund"
Cohesion: 0.09
Nodes (13): Fund, FundsRepository, DrizzleFundsRepository, toFund(), memoryPayrollContributionSink(), definedEntries(), MemoryFundsRepository, createPayrollContributionSink() (+5 more)

### Community 176 - "validate-vacation-budget-migration.ts"
Cohesion: 0.15
Nodes (29): absCents(), buildExpectedRateAllocations(), cents(), checkAdjustmentAllocations(), checkRateAllocations(), checkWithdrawalUsages(), dateOf(), findMigratedBudget() (+21 more)

### Community 177 - "Phase 5 deployment runbook — Funds"
Cohesion: 0.14
Nodes (11): Cutover, Phase 5 deployment runbook — Funds, Rehearsal and value checks, Rollback, Verified starting point, Behavior, Decisions and remaining scope, Deployment (+3 more)

### Community 178 - "PayrollRecord"
Cohesion: 0.10
Nodes (11): ListRecordsOptions, NewPayrollRecord, PayrollRecord, PayrollRecordKind, PayrollRecordsRepository, DrizzlePayrollRecordsRepository, toRecord(), definedEntries() (+3 more)

### Community 179 - "review-import.test.ts"
Cohesion: 0.08
Nodes (18): DocumentStore, MalwareScanner, ScanResult, rejectImport(), extraction, NOW, principal, ClamdConfig (+10 more)

### Community 180 - "_lib/leave.test.ts"
Cohesion: 0.22
Nodes (6): payroll, payslips, principal, repo, trekState, vacation

### Community 181 - "AuditInput"
Cohesion: 0.15
Nodes (6): accountDeps(), setAccountDepsFactoryForTests(), setPrincipalForTests(), onDisconnect(), onDisconnect(), AuditInput

### Community 182 - "8. Security design"
Cohesion: 0.40
Nodes (5): 8.1 Authentication and MFA, 8.2 Authorization, 8.3 Web security, 8.4 Data protection, 8. Security design

### Community 183 - "budgets/application/ports.ts"
Cohesion: 0.13
Nodes (10): Budget, BudgetPatch, BudgetsRepository, Clock, NewBudget, OwnershipCheck, DrizzleBudgetsRepository, toBudget() (+2 more)

### Community 184 - "TimeSeriesChart.tsx"
Cohesion: 0.24
Nodes (13): ChartTokens, compactValue(), HoverState, monthKey(), monthTick(), monthTicks(), monthToSeconds(), readTokens() (+5 more)

### Community 185 - "expenses.ts"
Cohesion: 0.23
Nodes (12): mapError(), updateTransactionAction(), createInterestRuleAction(), mapError(), ActionFailure, ActionResult, ActionSuccess, errorMessage() (+4 more)

### Community 186 - "run-interest-accrual.ts"
Cohesion: 0.36
Nodes (5): isNegativeAmount(), previousDay(), runInterestAccrual(), RunInterestAccrualResult, rule

### Community 187 - "budgets/[id]/page.tsx"
Cohesion: 0.11
Nodes (21): BudgetDetailPage(), dynamic, eventLabel(), AllocationView, AllocationForm(), AllocationFormProps, AllocationsTable(), EndAllocationAction() (+13 more)

### Community 188 - "FundContribution"
Cohesion: 0.10
Nodes (6): ContributionsRepository, FundContribution, DrizzleContributionsRepository, toContribution(), MemoryContributionsRepository, uniqueViolation()

### Community 189 - "interests/application/ports.ts"
Cohesion: 0.13
Nodes (15): CreateInterestRuleInput, createInterestRuleSchema, AccountBalanceLookup, AccountOwnershipCheck, Clock, Compounding, DayCount, PostingMode (+7 more)

### Community 190 - "budgets/infrastructure/repositories.itest.ts"
Cohesion: 0.14
Nodes (14): dayStartInstant(), SourceBalanceSource, SourceLabels, budgetDeps(), drizzleSourceLabels(), drizzleOwnershipCheck(), BACKENDS, drizzleRepositories() (+6 more)

### Community 191 - "payroll-rls.itest.ts"
Cohesion: 0.12
Nodes (11): main(), normalise(), twoUsers(), payslips, PayrollComponentRow, payrollComponents, PayrollImportRow, payrollImports (+3 more)

### Community 192 - "vacation.ts"
Cohesion: 0.20
Nodes (16): LeaveByMonthProps, DEFAULT_HOURS_PER_DAY, extractedField(), extractionOf(), FerieView, hoursPerDay(), loadFerie(), LeaveVarianceInput (+8 more)

### Community 193 - "reconcile-fund.ts"
Cohesion: 0.20
Nodes (14): qualified(), reconcileFund(), anomalyMonth(), cents(), coversPayrollMonth(), decimalFraction(), DetectedIssue, detectIssues() (+6 more)

### Community 194 - "repo/leave.ts"
Cohesion: 0.21
Nodes (16): leaveDays, syncPass(), clearPending(), dayAt(), daysInRange(), daysInYear(), deleteDates(), fractionString() (+8 more)

### Community 195 - "connection.ts"
Cohesion: 0.22
Nodes (11): describeDisconnectPolicy(), DISCONNECT_POLICIES, isUsable(), base, ConnectForm(), DisconnectForm(), DANGER, FIELD (+3 more)

### Community 196 - "validate-teable-migration.ts"
Cohesion: 0.13
Nodes (14): APP_MANAGED_KEYS, argv, BlankMonthRow, centsByMonth(), db, differenceLabel(), HAND_TRACKED_KEYS, LEGACY_KEYS (+6 more)

### Community 197 - "jobs/registry.ts"
Cohesion: 0.22
Nodes (11): dynamic, POST(), TIERS, JobDefinition, JobRunInput, jobs, JobTier, listJobs() (+3 more)

### Community 198 - "portfolio.ts"
Cohesion: 0.22
Nodes (11): MoneyInput, combinedGain, fundGain(), FundSeries, GainRow, GainTotal, monthlyReturn(), PerFundGain (+3 more)

### Community 199 - "drizzle-events-repository.ts"
Cohesion: 0.21
Nodes (7): BudgetEventRow, budgetEvents, BudgetEvent, EventsRepository, DrizzleEventsRepository, toEvent(), MemoryEventsRepository

### Community 200 - "crypto.ts"
Cohesion: 0.22
Nodes (8): createCredentialCipher(), credentialCipher, CredentialCryptoError, parseEncryptionKeys(), resetCredentialCipher(), BASE_ENV, K1, K2

### Community 201 - "trek-sync.test.ts"
Cohesion: 0.17
Nodes (8): ApplyDesiredStateResult, CALL, CONFIG, jobs, repo, state, STATS, trek

### Community 202 - "scopes.ts"
Cohesion: 0.29
Nodes (8): TransactionsScopeSource, cents(), formatCents(), scopeMatches(), scopeMatchesOne(), baseTx, TransactionLike, usageAmount()

### Community 203 - "InterestEntry"
Cohesion: 0.25
Nodes (5): InterestEntriesRepository, InterestEntry, NewInterestEntry, toEntry(), MemoryInterestEntriesRepository

### Community 204 - "Phase 6 checkpoint — Budgets"
Cohesion: 0.18
Nodes (9): Cutover sequence, Operational facts from this phase's reviews — read before running anything, Phase 6 deployment runbook — Budgets, Rollback, Behavior, Decisions and remaining scope, Manual walkthrough, Phase 6 checkpoint — Budgets (+1 more)

### Community 205 - "actions/leave.test.ts"
Cohesion: 0.22
Nodes (7): auth, cache, DAY, repo, store, sync, trek

### Community 206 - "webhook-signature.ts"
Cohesion: 0.48
Nodes (5): fakeProvider(), WebhookRequest, hmacSignatureVerifier(), verifyHmacSignature(), webhookEventName()

### Community 207 - "trek-provider-adapter.ts"
Cohesion: 0.33
Nodes (6): configOf(), credentialSchema, leaveSync, testConnection(), TREK_PROVIDER, SyncRequest

## Knowledge Gaps
- **1265 isolated node(s):** `entrypoint.sh script`, `securityHeaders`, `nextConfig`, `name`, `version` (+1260 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `DbClient` connect `DbClient` to `transactions.ts`, `accounts/api/routes.ts`, `testPrincipal`, `apply-import.itest.ts`, `AccountGroup`, `load-transactions.ts`, `drizzle-allocations-repository.ts`, `IntegrationConnection`, `validate-funds-migration.ts`, `Allocation`, `wallet-provider-adapter.ts`, `funds/application/ports.ts`, `auth/principal.ts`, `withUserContext`, `list-accounts.ts`, `InterestRule`, `payroll-contribution-sink.ts`, `(app)/page.tsx`, `drizzle-scopes-usages-repository.ts`, `Fund`, `validate-vacation-budget-migration.ts`, `PayrollRecord`, `schema/index.ts`, `budgets/application/ports.ts`, `FundContribution`, `interests/application/ports.ts`, `budgets/infrastructure/repositories.itest.ts`, `Transaction`, `PayrollImport`, `validate-teable-migration.ts`, `interest-accrual.itest.ts`, `drizzle-events-repository.ts`, `SyncRun`, `migrate-funds.ts`, `withSystemContext`, `require-principal.ts`, `TransactionCategory`, `SyncKind`, `payroll/application/ports.ts`, `integrations/types.ts`, `expenses/application/ports.ts`, `InterestAccrual`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `assertPermission()` connect `auth/principal.ts` to `create-import.ts`, `earnings.ts`, `accounts/api/routes.ts`, `actions/accounts.ts`, `get-interest-rule-detail.ts`, `ingest.ts`, `list-integrations.ts`, `load-transactions.ts`, `load-interests.ts`, `actions/payroll.ts`, `actions/integrations.ts`, `actions/funds.ts`, `list-accounts.ts`, `payroll-contribution-sink.ts`, `update-interest-rule.ts`, `payroll/api/routes.ts`, `review-import.test.ts`, `expenses.ts`, `interests/application/ports.ts`, `apply-import.ts`, `reconcile-fund.ts`, `interests/api/routes.ts`, `funds/[id]/page.tsx`, `romeDate`, `require-principal.ts`, `load-funds.ts`, `expenses/infrastructure/memory-repositories.ts`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `testPrincipal()` connect `testPrincipal` to `create-import.ts`, `actions/accounts.ts`, `get-interest-rule-detail.ts`, `ingest.ts`, `load-transactions.ts`, `load-interests.ts`, `actions/integrations.ts`, `wallet-provider-adapter.ts`, `testDb`, `auth/principal.ts`, `(app)/page.tsx`, `update-interest-rule.ts`, `payroll/api/routes.ts`, `schema/index.ts`, `review-import.test.ts`, `AuditInput`, `load-payroll.test.ts`, `apply-import.ts`, `interest-accrual.itest.ts`, `romeDate`, `integrations/types.ts`, `expenses/infrastructure/memory-repositories.ts`, `env.ts`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **What connects `entrypoint.sh script`, `securityHeaders`, `nextConfig` to the rest of the system?**
  _1265 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `accounts/[id]/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.09957325746799431 - nodes in this community are weakly interconnected._
- **Should `cn` be split into smaller, more focused modules?**
  _Cohesion score 0.04364035087719298 - nodes in this community are weakly interconnected._
- **Should `budgets/api/routes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05026300409117475 - nodes in this community are weakly interconnected._
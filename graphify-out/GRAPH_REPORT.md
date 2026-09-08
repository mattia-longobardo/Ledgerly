# Graph Report - personal-dashboard  (2026-09-08)

## Corpus Check
- 817 files · ~786,738 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 5236 nodes · 15643 edges · 200 communities (189 shown, 11 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 160 edges (avg confidence: 0.64)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d9012f46`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- accounts/[id]/page.tsx
- cn
- load-company.ts
- budgets/api/routes.ts
- sweep.ts
- trek.ts
- accounts/api/routes.ts
- Finance & Company Platform — Design and Phased Plan
- testPrincipal
- parse.ts
- funds/api/routes.ts
- compilerOptions
- PageGrid.tsx
- DrizzleAccountsRepository
- actions/accounts.ts
- rules.ts
- payroll-ingest.ts
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
- trek-sync.ts
- llm.ts
- Phase 1 — Accounts and Teable retirement
- withUserContext
- ReconciliationIssue
- budgets/application/errors.ts
- security/api/routes.ts
- db/index.ts
- toCents
- list-accounts.ts
- trek.test.ts
- auth/principal.ts
- 5. Data model
- budgets/application/ports.ts
- create-interest-rule.ts
- fromCents
- Finance Dashboard — Brand System
- teamsystem.ts
- format.ts
- timeoff/api/routes.ts
- payroll/api/routes.ts
- render-brand-icons.py
- users
- teable-import.ts
- TimeSeriesChart.tsx
- ContributionsRepository
- AGENTS.md
- machine.ts
- integrations/api/routes.ts
- Mod. Cedolino TS Layout
- middleware.ts
- CLAUDE.md
- scripts
- August 2026 OCR Fixture (Paperless-ngx text)
- contracts.ts
- End-to-end tests
- expenses/application/ports.ts
- wallet-provider-adapter.ts
- PayrollImport
- interests/application/ports.ts
- dashboard-app service
- require-principal.ts
- 7. Domain designs (what each section computes)
- August 2026 PDF-Text Fixture (clean layout)
- MemoryProviderLinksRepository
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
- rls-matrix.itest.ts
- next.config.ts
- get-budget-detail.ts
- get-workspace.ts
- entrypoint.sh
- funds/application/ports.ts
- Checkpoint: Phase 0 + Phase 1 complete (2026-09-03)
- Code 9837 - IMPONIBILE 5% L.199/25
- requirePrincipalOrRedirect
- SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md
- admin/page.tsx
- { GET, POST }
- ADDIZIONALE COMUNALE
- monthly-close.ts
- TransactionCategory
- File Structure
- SyncKind
- payroll/application/ports.ts
- load-funds.ts
- integrations/types.ts
- expenses/api/routes.ts
- review-import.ts
- Migrations out of the legacy app — the record
- InterestAccrual
- env.ts
- [[...route]]/route.ts
- http.ts
- text.ts
- Finance Dashboard API
- housekeeping.itest.ts
- README.md
- Finance Dashboard
- OverviewClient.tsx
- upload.ts
- timeoff/application/ports.ts
- TransactionLabel
- Execution rulings (full-phase run)
- The integration framework
- Checkpoint: Phase 2 complete (2026-09-04)
- Progress
- actions/funds.ts
- company/page.tsx
- wallet-adapter.ts
- TimeoffEvent
- File structure
- get-interest-rule-detail.ts
- Retiring the standalone `wallet-manager` interest container
- DbClient
- Standing procedure
- load-transactions.ts
- Rulings — execution (P3-C1 … P3-C38)
- gotify.ts
- llm-config.ts
- api-client.ts
- funds/infrastructure/memory-repositories.ts
- BalancesRepository
- jobs/registry.ts
- Checkpoint: Phase 3 complete (2026-09-05)
- Allocation
- accounts/application/ports.ts
- app/layout.tsx
- File structure
- Phase 4: Payroll upload pipeline and Company
- interest-accrual.ts
- sigv4.ts
- Architecture overview
- document-store-resolver.ts
- InterestRule
- (app)/page.tsx
- romeDate
- SDD ledger — plan: docs/superpowers/plans/2026-09-05-phase-4-payroll-and-company.md
- RulesTable.tsx
- Rebuild checkpoint — Phases 7–9 (reduced), and the close of the platform rebuild
- paperless-reconciliation.md
- calc/payroll.ts
- Fund
- withSystemContext
- Phase 5 checkpoint — Funds
- payroll/infrastructure/memory-repositories.ts
- File structure
- Endpoints
- use-cases.test.ts
- http/errors.ts
- timeoff.test.ts
- File structure
- management.ts
- UseCaseDeps
- actions/budgets.ts
- FundContribution
- AuditInput
- budgets/infrastructure/repositories.itest.ts
- pg
- @types/react
- reconcile.ts
- ErrorInline.tsx
- portfolio.ts
- permissions.ts
- trek-sync.test.ts
- trek-provider-adapter.ts

## God Nodes (most connected - your core abstractions)
1. `assertPermission()` - 154 edges
2. `Principal` - 115 edges
3. `DbClient` - 112 edges
4. `withUserContext()` - 104 edges
5. `testDb()` - 96 edges
6. `cn()` - 91 edges
7. `testPrincipal()` - 69 edges
8. `succeed()` - 61 edges
9. `fail()` - 59 edges
10. `users` - 59 edges

## Surprising Connections (you probably didn't know these)
- `Code 8054 - CONTRIBUTO DIPENDENTE (negative)` --semantically_similar_to--> `Code 7101 - FONDO C/DIPE (employee pension-fund share)`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d13.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt
- `alerts()` --indirect_call--> `httpRequest()`  [INFERRED]
  dashboard-app/src/lib/jobs/wallet-transactions-sync.test.ts → dashboard-app/src/lib/clients/http.ts
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

## Communities (200 total, 11 thin omitted)

### Community 0 - "accounts/[id]/page.tsx"
Cohesion: 0.08
Nodes (41): AccountDetailActions(), AccountDetailActionsProps, BalanceHistoryRow, BalanceHistoryTable(), BalanceHistoryTableProps, BalancesPageResponse, AccountDetailPage(), dynamic (+33 more)

### Community 1 - "cn"
Cohesion: 0.05
Nodes (65): HREF, OPTIONS, ViewKey, ViewState, FRESH, FUND, Gallery(), MONTHS (+57 more)

### Community 2 - "load-company.ts"
Cohesion: 0.07
Nodes (36): extraction(), principal, seed(), MemoryFundContributionSink, createPayrollContributionSink(), earningsSummary(), getRecord(), listRecords() (+28 more)

### Community 3 - "budgets/api/routes.ts"
Cohesion: 0.05
Nodes (57): addAllocationRoute, addManualUsageRoute, allocationDto(), allocationViewDto(), budgetDto(), commonErrorResponses, createBudgetRoute, deleteManualUsageRoute (+49 more)

### Community 4 - "sweep.ts"
Cohesion: 0.22
Nodes (14): dynamic, GET(), HEARTBEAT_MAX_AGE_MS, heartbeatAgeMs(), heartbeatPath(), isHeartbeatStale(), readHeartbeat(), touchHeartbeat() (+6 more)

### Community 5 - "trek.ts"
Cohesion: 0.09
Nodes (44): SleepFn, UpstreamService, applyDesiredState(), ApplyDesiredStateInput, asRecord(), callTool(), CLIENT_INFO, describe() (+36 more)

### Community 6 - "accounts/api/routes.ts"
Cohesion: 0.06
Nodes (56): accountDto(), balancePointDto(), commonErrorResponses, createAccountRoute, createGroupRoute, decodeCursor(), deleteAccountRoute, deleteGroupRoute (+48 more)

### Community 7 - "Finance & Company Platform — Design and Phased Plan"
Cohesion: 0.08
Nodes (26): 0. How to read this document, 10.1 Teable → PostgreSQL, 10.2 Paperless → payroll silo, 10.3 Single user → users table, 10.4 Deployment, 10. Migration strategy, 12. Intentional breaking changes, 13. Questions worth answering (none block Phase 0–1) (+18 more)

### Community 8 - "testPrincipal"
Cohesion: 0.21
Nodes (9): newAccount(), fundHarness(), seedFund(), setFundDepsFactoryForTests(), setPrincipalForTests(), PermissionDeniedError, deps, tokenDeps (+1 more)

### Community 9 - "parse.ts"
Cohesion: 0.10
Nodes (28): PayslipField, ORDINARY_MONTH_MARKERS, THIRTEENTH_KEYWORDS, CrossValidateInput, median(), PayslipHistoryEntry, LlmOptions, LlmPassResult (+20 more)

### Community 10 - "funds/api/routes.ts"
Cohesion: 0.05
Nodes (61): buildOpenApiDocument(), acknowledgeIssueRoute, addContributionRoute, commonErrorResponses, contributionDto(), createRoute_, detailDto(), fundDto() (+53 more)

### Community 11 - "compilerOptions"
Cohesion: 0.07
Nodes (29): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+21 more)

### Community 12 - "PageGrid.tsx"
Cohesion: 0.09
Nodes (15): LG_SPAN, LG_START, MD_SPAN, PageGrid(), Panel(), PanelProps, Span, Skeleton() (+7 more)

### Community 14 - "actions/accounts.ts"
Cohesion: 0.13
Nodes (34): createAccountAction(), createGroupAction(), deleteAccountAction(), deleteGroupAction(), flag(), mapError(), recordBalanceAction(), renameGroupAction() (+26 more)

### Community 15 - "rules.ts"
Cohesion: 0.10
Nodes (32): Anchor, AUX_ANCHORS, AUX_FIELDS, AuxField, COMPOSITE_FIELDS, FIELD_ANCHORS, GRID_HEADER_SYNONYMS, GridId (+24 more)

### Community 16 - "payroll-ingest.ts"
Cohesion: 0.04
Nodes (73): Counts, due(), DUE_STATUSES, INGEST_BATCH, ingestOne(), JOB_NAME, LOCK_KEY, recordFailure() (+65 more)

### Community 17 - "AccountGroup"
Cohesion: 0.15
Nodes (5): GroupsRepository, AccountGroup, DrizzleGroupsRepository, toGroup(), MemoryGroupsRepository

### Community 18 - "wallet.ts"
Cohesion: 0.07
Nodes (48): requestJson(), withRetry(), REVOLUT_COMPONENT_KEYS, WALLET_ACCOUNTS, WALLET_EXPECTED_CURRENCY, WalletAccountConfig, accountSchema, accountsSchema (+40 more)

### Community 19 - "time.ts"
Cohesion: 0.18
Nodes (21): alignSeries(), carryForward(), CustomRange, Delta, deltaOverRange(), pointsOf(), RangePreset, rangeToMonths() (+13 more)

### Community 20 - "dependencies"
Cohesion: 0.07
Nodes (27): @base-ui-components/react, clsx, dependencies, @base-ui-components/react, clsx, drizzle-orm, hono, @hono/zod-openapi (+19 more)

### Community 21 - "devDependencies"
Cohesion: 0.07
Nodes (27): devDependencies, drizzle-kit, @fontsource/ibm-plex-mono, @fontsource/ibm-plex-sans, msw, @playwright/test, tailwindcss, @tailwindcss/postcss (+19 more)

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
Cohesion: 0.07
Nodes (18): ConnectIntegrationInput, ImportResult, ConnectionPatch, ConnectionsRepository, ConnectionStatePatch, NewConnection, WebhookDeliveriesRepository, WebhookDelivery (+10 more)

### Community 26 - "actions/payroll.ts"
Cohesion: 0.11
Nodes (41): applyPayslipAction(), nextInQueue(), rejectPayslipAction(), revalidate(), toActionError(), uploadPayslipAction(), VerifyActionInput, verifyPayslipAction() (+33 more)

### Community 27 - "confidence.ts"
Cohesion: 0.14
Nodes (21): FieldExtraction, GRID_DEPENDENT_FIELDS, BALANCE_TOLERANCE, checkNetAgainstMedian(), checkNettoBalance(), checkResidualContinuity(), combineField(), crossValidate() (+13 more)

### Community 28 - "actions/integrations.ts"
Cohesion: 0.10
Nodes (28): connectIntegration(), disconnectIntegration(), ConnectionNotFoundError, ConnectionNotUsableError, ConnectionVersionMismatchError, CredentialValidationError, SyncDisabledError, SyncNotSupportedError (+20 more)

### Community 29 - "trek-sync.ts"
Cohesion: 0.15
Nodes (26): LeaveFraction, LeaveKind, DesiredDay, TogglePlanStep, TrekEntry, CODE_BY_TREK_KIND, differs(), planPull() (+18 more)

### Community 30 - "llm.ts"
Cohesion: 0.15
Nodes (16): buildTool(), chatCompletionsUrl(), coerceMonth(), coerceNumber(), DEFAULT_MAX_CHARS, DEFAULT_TIMEOUT_MS, emptyResult(), errorName() (+8 more)

### Community 31 - "Phase 1 — Accounts and Teable retirement"
Cohesion: 0.07
Nodes (27): File structure (what will exist after Phase 1), Global Constraints, Phase 0 — Foundations, Phase 0 + Phase 1: Foundations and Accounts Implementation Plan, Phase 1 — Accounts and Teable retirement, Self-review against the spec, Task 10: Capability resolver and capability-driven navigation, Task 11: Accounts schema with RLS (+19 more)

### Community 32 - "withUserContext"
Cohesion: 0.07
Nodes (54): budgetUsages, reconciliationIssues, seed(), asGroupUser(), asLinkUser(), asUser(), seedUsers(), createBudget() (+46 more)

### Community 33 - "ReconciliationIssue"
Cohesion: 0.12
Nodes (10): ReconciliationIssueRow, IssuesRepository, ListIssuesOptions, ListIssuesPage, ReconciliationIssue, DrizzleIssuesRepository, NewIssue, toIssue() (+2 more)

### Community 34 - "budgets/application/errors.ts"
Cohesion: 0.11
Nodes (33): addAllocation(), schema, base, addManualUsage(), schema, createBudget(), schema, input (+25 more)

### Community 35 - "security/api/routes.ts"
Cohesion: 0.06
Nodes (46): CreatedToken, createTokenAction(), isPermission(), mapError(), revokeTokenAction(), describeCurrentSession(), day(), dynamic (+38 more)

### Community 36 - "db/index.ts"
Cohesion: 0.10
Nodes (35): JobResult, JobStatus, db, instance(), pool, poolInstance(), JOB_NAME, LOCK_KEY (+27 more)

### Community 37 - "toCents"
Cohesion: 0.24
Nodes (13): toCents(), contributingKeys(), missingKeys(), netWorth, NetWorthContributor, NetWorthOptions, observe(), Observed (+5 more)

### Community 38 - "list-accounts.ts"
Cohesion: 0.24
Nodes (18): MonthPoint, AccountDetail, getAccountDetail(), AccountListItem, DEFAULT_TREND_MONTHS, isStale(), listAccounts(), STALE_AFTER_MS (+10 more)

### Community 39 - "trek.test.ts"
Cohesion: 0.17
Nodes (14): resetTrekAuthCache(), callsTo(), CONFIG, entriesPayload(), fetchMock, LIVE_STATS, Rpc, rpcOf() (+6 more)

### Community 40 - "auth/principal.ts"
Cohesion: 0.07
Nodes (51): listTransactions(), ListTransactionsResult, addContribution(), AddContributionInput, schema, createFund(), schema, InvalidInputError (+43 more)

### Community 41 - "5. Data model"
Cohesion: 0.18
Nodes (11): 5.10 Indexes (access-pattern driven), 5.1 Identity and access, 5.2 Integrations, 5.3 Accounts, 5.4 Transactions (Expenses), 5.5 Funds, 5.6 Budgets, 5.7 Interests (+3 more)

### Community 42 - "budgets/application/ports.ts"
Cohesion: 0.04
Nodes (44): VersionMismatchError, AmountVersion, AmountVersionsRepository, Budget, BudgetEvent, BudgetPatch, BudgetsRepository, Clock (+36 more)

### Community 43 - "create-interest-rule.ts"
Cohesion: 0.17
Nodes (13): CreateInterestRuleInput, createInterestRuleSchema, InvalidInputError, NotFoundError, VersionMismatchError, Compounding, DayCount, PostingMode (+5 more)

### Community 44 - "fromCents"
Cohesion: 0.16
Nodes (17): centsFromDecimal(), fromCents(), roundEur(), DailyAccrualInput, DailyAccrualResult, dailyInterest(), formatDecimal(), parseCarry() (+9 more)

### Community 45 - "Finance Dashboard — Brand System"
Cohesion: 0.22
Nodes (8): 1. Strategy, 2. The mark, 3. Assets, 4. Colour, 5. Typography, 6. Voice, 7. Applications, Finance Dashboard — Brand System

### Community 46 - "teamsystem.ts"
Cohesion: 0.23
Nodes (15): parseItalianNumber(), bodyRow(), EMPTY, extractTeamSystem(), findGrid(), isNumericOnly(), numbersOf(), plausibleHours() (+7 more)

### Community 47 - "format.ts"
Cohesion: 0.11
Nodes (23): OverviewAccount, AccountRowProps, DeltaBadge(), DeltaBadgeProps, Tone, TONE_CLASS, TONE_WORD, toneOf() (+15 more)

### Community 48 - "timeoff/api/routes.ts"
Cohesion: 0.07
Nodes (35): balanceDto(), balanceViewDto(), commonErrorResponses, eventDto(), listBalancesRoute, listEventsRoute, listTypesRoute, registerTimeoffRoutes() (+27 more)

### Community 49 - "payroll/api/routes.ts"
Cohesion: 0.05
Nodes (53): applyRoute, commonErrorResponses, componentDto(), createMappingRuleRoute, deleteMappingRuleRoute, earningsRoute, getImportRoute, getRecordRoute (+45 more)

### Community 50 - "render-brand-icons.py"
Cohesion: 0.33
Nodes (3): Rasterise the Finance Dashboard mark to PNG. No rasteriser is installed on this…, radius=0 renders a full-bleed square (maskable); otherwise a rounded square., render()

### Community 51 - "users"
Cohesion: 0.07
Nodes (31): RETENTION, DROPPED_LEGACY_TABLES, TIMEOFF_TABLES, auditEvents, organizations, roles, userIdentities, userRoles (+23 more)

### Community 52 - "teable-import.ts"
Cohesion: 0.15
Nodes (15): centsToString(), DEFAULT_BY_KEY, DEFAULTS, DERIVED_KEYS, EXPORTED_NUMBER_COLUMNS, ExportedPoint, ExportedRecord, pivotExportedRecords() (+7 more)

### Community 53 - "TimeSeriesChart.tsx"
Cohesion: 0.09
Nodes (31): ChartTokens, compactValue(), HoverState, monthKey(), monthTick(), monthTicks(), monthToSeconds(), readTokens() (+23 more)

### Community 54 - "ContributionsRepository"
Cohesion: 0.12
Nodes (3): ContributionsRepository, FundsRepository, PayrollContributionSinkRepositories

### Community 56 - "machine.ts"
Cohesion: 0.15
Nodes (18): dynamic, POST(), dynamic, POST(), Bucket, buckets, constantTimeEqual(), CRON_SECRET_HEADER (+10 more)

### Community 57 - "integrations/api/routes.ts"
Cohesion: 0.06
Nodes (48): CappedRead, commonErrorResponses, conflict, connectionDto(), connectRoute, disconnectRoute, listRoute, notFound (+40 more)

### Community 58 - "Mod. Cedolino TS Layout"
Cohesion: 0.22
Nodes (10): Code 1150 - RATA ADD.REG. A.P., Real Payslip Fixture: Marzo 2026 (doc 96), ADDIZIONALE REGIONALE, Fixture Anonymisation Convention, Employer Header Block (Ditta / ACME Consulting srl), TeamSystem August 2026 Fixture (synthetic-anonymised), IBAN / Bank Accredito Trailer Line, Q/INPS - INAIL Statistical Block (+2 more)

### Community 59 - "middleware.ts"
Cohesion: 0.23
Nodes (11): config, contentSecurityPolicy(), frameAncestorsFor(), hasSessionCookie(), isPublic(), middleware(), PUBLIC_PATHS, PUBLIC_PREFIXES (+3 more)

### Community 61 - "scripts"
Cohesion: 0.12
Nodes (17): scripts, build, db:generate, db:migrate, dev, e2e, lint, migrate:credentials (+9 more)

### Community 62 - "August 2026 OCR Fixture (Paperless-ngx text)"
Cohesion: 0.29
Nodes (7): OCR Digit/Letter Confusion, August 2026 OCR Fixture (Paperless-ngx text), Flattened Residuals Grid OCR Defect, Leave Residuals Grid (FERIE / PERMESSI / ROL / FLESS. / B. ORE), Garbage OCR Fixture (skewed scan), All-Low-Confidence Degradation (Failure Handling), OCR Letter-Spacing Artifact (S -> 'S ')

### Community 63 - "contracts.ts"
Cohesion: 0.09
Nodes (31): ACCOUNT_KEYS, PayslipExtraction, SourceKind, applyImport(), extraction, NOW, principal, StubTimeoffBalanceSink (+23 more)

### Community 64 - "End-to-end tests"
Cohesion: 0.33
Nodes (5): End-to-end tests, Minting a token for `E2E_TOKEN`, Running against a local instance, The API smoke writes real rows, Why there is no login spec

### Community 65 - "expenses/application/ports.ts"
Cohesion: 0.05
Nodes (37): CreateLabelInput, detectRecurringPatterns(), InvalidInputError, TransactionListItem, CategoryPatch, Clock, LabelPatch, ListTransactionsOptions (+29 more)

### Community 66 - "wallet-provider-adapter.ts"
Cohesion: 0.08
Nodes (31): WalletCategory, WalletRecord, CreateCategoryInput, ProviderCategory, ProviderTransaction, TransactionsSource, syncProviderTransactions(), SyncProviderTransactionsDeps (+23 more)

### Community 67 - "PayrollImport"
Cohesion: 0.09
Nodes (11): PayrollImportRow, RaceyImportsRepository, ListImportsOptions, NewPayrollImport, PayrollImport, PayrollImportPatch, PayrollImportsRepository, TERMINAL_STATUSES (+3 more)

### Community 68 - "interests/application/ports.ts"
Cohesion: 0.06
Nodes (27): InterestAccrualRow, interestAccruals, interestEntries, InterestEntryRow, InterestRuleRow, interestRules, createRule(), newRule() (+19 more)

### Community 69 - "dashboard-app service"
Cohesion: 0.38
Nodes (7): dashboard-app service, dashboard-cron supercronic sidecar service, External networks proxy_public and db_internal, projects compose stack, read_only rootfs, cap_drop ALL, tmpfs and limits, Read-only secret file mounts (wallet-token, trek-token), Traefik router with X-Forwarded-Proto https middleware

### Community 70 - "require-principal.ts"
Cohesion: 0.12
Nodes (28): CODES, mapError(), removeTimeoffEventAction(), revalidateTimeoff(), setTimeoffEventAction(), syncTimeoffNowAction(), TIMEOFF_PATHS, backTo() (+20 more)

### Community 71 - "7. Domain designs (what each section computes)"
Cohesion: 0.20
Nodes (10): 7.1 Home, 7.2 Finance Overview, 7.3 Accounts, 7.4 Funds, 7.5 Budgets, 7.6 Interests (reuse / change / deprecate from `interest.py`), 7.7 Expenses, 7.8 Company (+2 more)

### Community 72 - "August 2026 PDF-Text Fixture (clean layout)"
Cohesion: 0.28
Nodes (9): Code 001 - RETRIBUZIONE ORDINARIA, August 2026 PDF-Text Fixture (clean layout), TOTALE RITENUTE, Code 2 - LAVORO ORDIN.(mens.), Code 1101 - IRPEF A CREDITO -MOD.730-, Code 9208 - CREDITO COMPENSATO, Real Payslip Fixture: Luglio 2026 (doc 104, 730 refund), ARROTONDAMENTO (+1 more)

### Community 73 - "MemoryProviderLinksRepository"
Cohesion: 0.16
Nodes (7): ProviderLink, ProviderLinkEntityType, ProviderLinksRepository, DrizzleProviderLinksRepository, toLink(), MemoryProviderLinksRepository, StoredProviderLink

### Community 74 - "SyncRun"
Cohesion: 0.13
Nodes (10): NewSyncRun, SyncRunsRepository, Prepared, RunSyncInput, DrizzleSyncRunsRepository, toRun(), MemorySyncRunsRepository, SyncRun (+2 more)

### Community 75 - "env"
Cohesion: 0.12
Nodes (28): runtime, first(), metadata, safeCallbackUrl(), SearchParams, SignInPage(), SignInButton(), asNumber() (+20 more)

### Community 76 - "interests/api/routes.ts"
Cohesion: 0.08
Nodes (30): accrualDto(), commonErrorResponses, createRoute_, entryDto(), getRoute, IdParamSchema, IfMatchHeaderSchema, listRoute (+22 more)

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
Cohesion: 0.11
Nodes (31): ReviewPayslipPage(), FinanceTabs(), asDate(), dynamic, FundDetailPage(), issueDetail(), issueLabel(), asDate() (+23 more)

### Community 86 - "package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 87 - "rls-matrix.itest.ts"
Cohesion: 0.04
Nodes (42): anAccount(), anImport(), aPayrollRecord(), aTransaction(), Case, CASES, Ids, OCCURRED (+34 more)

### Community 89 - "get-budget-detail.ts"
Cohesion: 0.24
Nodes (19): romeDate(), BudgetDetail, getBudgetDetail(), lastDayOfMonth(), BudgetSummary, listBudgets(), refreshUsages(), RefreshUsagesResult (+11 more)

### Community 90 - "get-workspace.ts"
Cohesion: 0.14
Nodes (25): CachedTrekStats, getCachedTrekStats(), keyFor(), setCachedTrekStats(), isProviderConnectedForPrincipal(), DayDetail, getWorkspace(), GetWorkspaceInput (+17 more)

### Community 92 - "funds/application/ports.ts"
Cohesion: 0.12
Nodes (11): AccountLinkSource, Clock, ContributionSource, FundStatus, PayrollMonthsSource, ReconciliationStatus, ValuationSource, drizzleAccountLinkSource() (+3 more)

### Community 93 - "Checkpoint: Phase 0 + Phase 1 complete (2026-09-03)"
Cohesion: 0.25
Nodes (7): Before Phase 2, Checkpoint: Phase 0 + Phase 1 complete (2026-09-03), Decisions already taken (summary; full text in the ledger), Deployment status (2026-09-03, later the same day), Documents, How to continue, State

### Community 94 - "Code 9837 - IMPONIBILE 5% L.199/25"
Cohesion: 0.50
Nodes (4): Code 9837 - IMPONIBILE 5% L.199/25, Code 9838 - IMPOSTA SOST. 5% L.199/25, Real Payslip Fixture: Giugno 2026 (doc 103), PAGA BASE / PREMIO PR. / SUPERM.ASS Row

### Community 95 - "requirePrincipalOrRedirect"
Cohesion: 0.05
Nodes (47): dynamic, EarningsPage(), metadata, dynamic, EarningsRecordPage(), generateMetadata(), dynamic, metadata (+39 more)

### Community 96 - "SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md"
Cohesion: 0.50
Nodes (3): Pre-flight scan (2026-09-02), Progress, SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md

### Community 97 - "admin/page.tsx"
Cohesion: 0.17
Nodes (14): InterestAccrualDetail, interestAccrualNotice(), AdminSettingsPage(), dynamic, JOB_LABEL, JOBS, metadata, RUN_TIME (+6 more)

### Community 107 - "monthly-close.ts"
Cohesion: 0.16
Nodes (32): alertJobFailure(), errorMessage(), HousekeepingCounts, JOB_NAME, LOCK_KEY, purge(), PURGE_BATCH, RETENTION (+24 more)

### Community 109 - "TransactionCategory"
Cohesion: 0.18
Nodes (6): TransactionDetail, CategoriesRepository, TransactionCategory, DrizzleCategoriesRepository, toCategory(), MemoryCategoriesRepository

### Community 110 - "File Structure"
Cohesion: 0.07
Nodes (28): File Structure, Global Constraints, Phase 3: Expenses and Interests, Rulings, Self-review against the Phase 3 scope, Task 10: Expenses REST API, Task 11: Expenses pages — list and detail, replacing the setup state, Task 12: Recurring-pattern persistence wired into the transactions sync (+20 more)

### Community 111 - "SyncKind"
Cohesion: 0.17
Nodes (7): SyncJob, SyncJobsRepository, DrizzleSyncJobsRepository, toJob(), MemorySyncJobsRepository, SyncKind, SyncSchedule

### Community 112 - "payroll/application/ports.ts"
Cohesion: 0.07
Nodes (34): Confidence, PayrollComponentRow, PayrollMappingRuleRow, createMappingRule(), CreateMappingRuleInput, MappingRuleDeps, Clock, FundContributionWrite (+26 more)

### Community 113 - "load-funds.ts"
Cohesion: 0.18
Nodes (18): FundsCard(), FundDetail, getFundDetail(), FundSummary, summarizeFund(), absoluteReturn(), calendarQuarter(), cents() (+10 more)

### Community 114 - "integrations/types.ts"
Cohesion: 0.08
Nodes (32): IntegrationDeps, drainSyncQueue(), enqueueSync(), handleWebhook(), INBOUND_LIMIT_PER_MINUTE, REPLAY_WINDOW_MS, makeDeps(), principal (+24 more)

### Community 115 - "expenses/api/routes.ts"
Cohesion: 0.07
Nodes (40): categoriesRoute, categoryDto(), commonErrorResponses, createCategoryRoute, createLabelRoute, getRoute, IdParamSchema, IfMatchHeaderSchema (+32 more)

### Community 116 - "review-import.ts"
Cohesion: 0.15
Nodes (11): ConflictError, InvalidInputError, NotFoundError, VersionMismatchError, beginReadOriginal(), OriginalDocument, ReadOriginalReadiness, recordOriginalRead() (+3 more)

### Community 117 - "Migrations out of the legacy app — the record"
Cohesion: 0.33
Nodes (5): Files in this directory, Legacy funds and the vacation ledger, Migrations out of the legacy app — the record, Paperless → the payroll document store, Teable → `accounts` + `account_balances`

### Community 118 - "InterestAccrual"
Cohesion: 0.12
Nodes (7): InterestAccrual, InterestAccrualsRepository, NewInterestAccrual, toAccrual(), MemoryInterestAccrualsRepository, normalizeScale(), PostWalletInterestInput

### Community 119 - "env.ts"
Cohesion: 0.16
Nodes (11): resetEnvCache(), schema, JOB_NAME, RunRow, store, documentStoreConfigured(), savedEnv, saved (+3 more)

### Community 120 - "[[...route]]/route.ts"
Cohesion: 0.14
Nodes (15): bodySchema, dynamic, POST(), app, DELETE, dynamic, GET, PATCH (+7 more)

### Community 121 - "http.ts"
Cohesion: 0.16
Nodes (12): backoffDelay(), HttpError, httpRequest(), HttpRequestInit, isRetryable(), isRetryableStatus(), parseRetryAfter(), readBody() (+4 more)

### Community 122 - "text.ts"
Cohesion: 0.24
Nodes (11): detectPeriodMonth(), fixture(), GARBAGE_TEXT, OCR_TEXT, PDF_TEXT, extractPdfText(), fixNumericOcr(), normalizeText() (+3 more)

### Community 123 - "Finance Dashboard API"
Cohesion: 0.10
Nodes (21): Authentication, Breaking changes in Phase 2, Budgets, Error envelope, Expenses, Finance Dashboard API, Funds, `Idempotency-Key` (+13 more)

### Community 124 - "housekeeping.itest.ts"
Cohesion: 0.13
Nodes (9): idempotencyKeys, JobRun, jobRuns, rateLimitWindows, asSystem(), Db, NOW, requireIdempotencyKey() (+1 more)

### Community 125 - "README.md"
Cohesion: 0.20
Nodes (7): Deferred, Follow-ups found while building, Scope dropped on purpose, Migration numbers (verify with `ls drizzle/*.sql` before generating), Phases 7–9 (reduced): conventions addendum, Rules that replace the shared conventions, Why the plans got shorter

### Community 126 - "Finance Dashboard"
Cohesion: 0.29
Nodes (7): Developing, Documentation, Finance Dashboard, Running it, Stack, Status: Phases 0–9 implemented; Phase 6 is what is deployed, Testing

### Community 127 - "OverviewClient.tsx"
Cohesion: 0.17
Nodes (14): DEFAULT_STATE, OverviewClient(), OverviewClientProps, OverviewSource, PRESET, RANGE_KEYS, readUrl(), toSearch() (+6 more)

### Community 128 - "upload.ts"
Cohesion: 0.10
Nodes (27): DEFAULT_RETENTION_YEARS, markUploaded(), markUploadFailed(), reserveImport(), ReserveImportInput, retentionUntil(), base, NOW (+19 more)

### Community 129 - "timeoff/application/ports.ts"
Cohesion: 0.08
Nodes (14): isWeekendBlocked(), DEFAULT_TIMEOFF_TYPES, seedDefaultTypes(), WorkspaceDay, Clock, EventsRepository, TIMEOFF_CODE_ORDER, TimeoffCode (+6 more)

### Community 130 - "TransactionLabel"
Cohesion: 0.18
Nodes (7): isUniqueViolation(), transactionLabels, LabelsRepository, TransactionLabel, DrizzleLabelsRepository, toLabel(), MemoryLabelsRepository

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

### Community 136 - "actions/funds.ts"
Cohesion: 0.14
Nodes (29): acknowledgeIssueAction(), addContributionAction(), createFundAction(), mapError(), month(), optionalMonth(), parsedMoney(), reconcileFundAction() (+21 more)

### Community 137 - "company/page.tsx"
Cohesion: 0.11
Nodes (22): CompanyPage(), dynamic, metadata, AmountField(), StatEmphasis, StatGrid(), StatGridProps, StatTile() (+14 more)

### Community 138 - "wallet-adapter.ts"
Cohesion: 0.29
Nodes (8): WalletAccount, accountType(), mapWalletAccount(), prefetchedWalletSource(), TYPE_BY_ACCOUNT_TYPE, updatedAt(), WALLET_PROVIDER, walletAccountsSource()

### Community 141 - "TimeoffEvent"
Cohesion: 0.22
Nodes (4): ProviderEventWrite, TimeoffEvent, DrizzleEventsRepository, toEvent()

### Community 142 - "File structure"
Cohesion: 0.12
Nodes (15): Deviation, File structure, Phase 6: Budgets, Rulings, Scope cut, Self-review against the spec, Task 1: Migration 0017 — budget tables and RLS, Task 2: Domain — figures and scopes (+7 more)

### Community 143 - "get-interest-rule-detail.ts"
Cohesion: 0.52
Nodes (6): dayAfter(), getInterestRuleDetail(), InterestRuleDetail, startOfDay(), ProjectionPoint, ReconciliationSummary

### Community 144 - "Retiring the standalone `wallet-manager` interest container"
Cohesion: 0.33
Nodes (5): Before you start: read the container's current configuration, Retiring the standalone `wallet-manager` interest container, Rollback, Steps, What a crash leaves behind, and why this procedure avoids relying on it

### Community 145 - "DbClient"
Cohesion: 0.08
Nodes (31): main(), readTrimmed(), bootstrapOwner(), DbClient, db, pool, providerLinks, TimeoffBalanceRow (+23 more)

### Community 146 - "Standing procedure"
Cohesion: 0.11
Nodes (18): 1. Green gate, 2. Check the database role is `NOSUPERUSER`, 3. Build the image before any downtime, 4. Stop the app, leave everything else running, 5. Back up, 6. Migrate, 7. Start, 8. Verify (+10 more)

### Community 147 - "load-transactions.ts"
Cohesion: 0.11
Nodes (27): mapError(), updateTransactionAction(), ExpensesPage(), dynamic, generateMetadata(), loadTransactionDetail, requirePrincipalOrRedirect, TransactionDetailPage() (+19 more)

### Community 150 - "Rulings — execution (P3-C1 … P3-C38)"
Cohesion: 0.06
Nodes (32): Consequences of P3-C37 and P3-C29 that later work must not contradict, Deferred by design, Expenses rulings, Fix wave batch A — DONE (48709aa, 1e32ff9, f00c132), Fix wave batch B — DONE (da41da2, 61c9c1c, 0a0905b, f3f3832, ce743b4; migration 0014_interest_posting_fixes.sql), Fix wave batch C — DONE (aef890a, ab25461, 9497f59, 60cda52, 09b5739; no migration), Fix-wave re-review dispatched, Fix wave — three sequential batches, all approved on first re-review (+24 more)

### Community 151 - "gotify.ts"
Cohesion: 0.10
Nodes (20): alertPayslipPending(), alertSuccessAfterRetry(), appUrl(), GotifyMessage, JobFailureAlert, notify(), PayslipPendingAlert, RetrySuccessAlert (+12 more)

### Community 152 - "llm-config.ts"
Cohesion: 0.13
Nodes (17): PersonalSettingsPage(), appSettings, asString(), BaseUrlCheck, checkBaseUrl(), ConfigSource, isPrivateHost(), Layers (+9 more)

### Community 153 - "api-client.ts"
Cohesion: 0.18
Nodes (8): apiClient, E2E_TOKEN, headers(), isoDate(), nextMonday(), TOKEN_MISSING_MESSAGE, unique(), Identified

### Community 154 - "funds/infrastructure/memory-repositories.ts"
Cohesion: 0.09
Nodes (16): FundPatch, FundPlan, FundSchedule, PlansRepository, SchedulesRepository, DrizzlePlansRepository, DrizzleSchedulesRepository, toPlan() (+8 more)

### Community 155 - "BalancesRepository"
Cohesion: 0.16
Nodes (6): BalanceView, BalancesRepository, TimeoffBalance, DrizzleBalancesRepository, toBalance(), TimeoffBalanceSinkRepositories

### Community 156 - "jobs/registry.ts"
Cohesion: 0.22
Nodes (11): dynamic, POST(), TIERS, JobDefinition, JobRunInput, jobs, JobTier, listJobs() (+3 more)

### Community 157 - "Checkpoint: Phase 3 complete (2026-09-05)"
Cohesion: 0.15
Nodes (12): Behaviours the plan text and the original checkpoint predate, Checkpoint: Phase 3 complete, whole-branch fix wave closed (2026-09-05), Deployment status, Documents, How to continue, Key design decisions from the fix wave, Not run: the manual walkthrough with a real Wallet token, One parked minor (+4 more)

### Community 158 - "Allocation"
Cohesion: 0.15
Nodes (7): Allocation, AllocationsRepository, AllocationLike, DrizzleAllocationsRepository, toAllocation(), definedEntries(), MemoryAllocationsRepository

### Community 159 - "accounts/application/ports.ts"
Cohesion: 0.06
Nodes (23): NOW, AccountPatch, AccountsRepository, AccountsSource, Clock, NewAccount, NewBalance, ProviderAccount (+15 more)

### Community 160 - "app/layout.tsx"
Cohesion: 0.27
Nodes (6): metadata, viewport, THEME_STORAGE_KEY, ThemeScript(), plexMono, plexSans

### Community 161 - "File structure"
Cohesion: 0.13
Nodes (14): Deferred (append to `docs/superpowers/DEFERRED.md`), Deviation (Task 1, executed 2026-09-07), Deviation (Task 2, executed 2026-09-07), Deviation (Task 3, executed 2026-09-07), Deviation (Task 4, executed 2026-09-07), Deviation (Task 4, fix round 1, 2026-09-08), Deviation (Tasks 2-3, fix round 1, 2026-09-07), Deviation (Tasks 2-3, fix round 2, 2026-09-07) (+6 more)

### Community 162 - "Phase 4: Payroll upload pipeline and Company"
Cohesion: 0.06
Nodes (30): File Structure, Global Constraints, Phase 4: Payroll upload pipeline and Company, Rulings, Self-review against the Phase 4 scope, Task 10: Ingesting an import — scan, extract text, parse, Task 11: Reviewing and applying an import, Task 12: Reading imports, records and the earnings summary (+22 more)

### Community 163 - "interest-accrual.ts"
Cohesion: 0.22
Nodes (11): accrueRule(), AccrueRuleResult, activeRules(), JOB_NAME, LOCK_KEY, PostFailedError, RunInterestAccrualJobInput, tryPost() (+3 more)

### Community 164 - "sigv4.ts"
Cohesion: 0.27
Nodes (11): amzDate(), canonicalPath(), canonicalQuery(), hashPayload(), hmac(), sha256Hex(), signRequest(), SigV4Input (+3 more)

### Community 165 - "Architecture overview"
Cohesion: 0.17
Nodes (12): Architecture overview, Authentication, Capability-driven navigation, Deferred, Integrations and inbound webhooks, Jobs, Known deviations, Module layout (+4 more)

### Community 166 - "document-store-resolver.ts"
Cohesion: 0.09
Nodes (24): DocumentStore, assertStorageKey(), PayrollDepsOptions, DocumentStoreResolution, storeFromDriver(), StoreFromDriverInput, createLocalDocumentStore(), bytes (+16 more)

### Community 167 - "InterestRule"
Cohesion: 0.12
Nodes (11): InterestEntry, InterestRule, InterestRulesRepository, recordPostedEntry(), shouldPost(), accrual, rule, definedEntries() (+3 more)

### Community 168 - "(app)/page.tsx"
Cohesion: 0.16
Nodes (14): dynamic, HomePage(), metadata, TotalBalanceCards(), CardKey, cardState, HOME_CARDS, HomeCard (+6 more)

### Community 169 - "romeDate"
Cohesion: 0.29
Nodes (9): asDate(), classify(), isStale(), snapshotGrace, StalenessInfo, StalenessSource, NOW, DISPLAY_STALENESS_MS (+1 more)

### Community 170 - "SDD ledger — plan: docs/superpowers/plans/2026-09-05-phase-4-payroll-and-company.md"
Cohesion: 0.25
Nodes (7): Corrections this planning pass made to the superseded draft, Deferred by design, Rulings — execution (PH4-C1 … PH4-C13), Rulings — execution, whole-branch review (PH4-C15 … PH4-C22), Rulings — planning (R4-1 … R4-18), SDD ledger — plan: docs/superpowers/plans/2026-09-05-phase-4-payroll-and-company.md, Task-by-task summary

### Community 171 - "RulesTable.tsx"
Cohesion: 0.47
Nodes (5): RuleRow, asPercent(), POSTING_LABEL, RulesTable(), RulesTableProps

### Community 172 - "Rebuild checkpoint — Phases 7–9 (reduced), and the close of the platform rebuild"
Cohesion: 0.17
Nodes (11): Controller rulings issued during the run, Gate, Phase 7, Phase 8, Phase 9, Rebuild checkpoint — Phases 7–9 (reduced), and the close of the platform rebuild, Review record, Rulings — kept, replaced, deferred (+3 more)

### Community 174 - "calc/payroll.ts"
Cohesion: 0.17
Nodes (20): MoneyInput, sumCents(), annualTotals, averageNet(), AverageOptions, averageTaxes(), inYear(), isThirteenthCandidate() (+12 more)

### Community 175 - "Fund"
Cohesion: 0.17
Nodes (9): Fund, NewFund, DrizzleFundsRepository, toFund(), memoryPayrollContributionSink(), MemoryFundsRepository, setup(), TrackingFundsRepository (+1 more)

### Community 176 - "withSystemContext"
Cohesion: 0.09
Nodes (32): dynamic, GET(), personalAccessTokens, seedUserWithAccounts(), seed(), seedTwoUsers(), observingScanner(), auditRows() (+24 more)

### Community 177 - "Phase 5 checkpoint — Funds"
Cohesion: 0.13
Nodes (11): Behavior, Decisions and remaining scope, Deployment, Phase 5 checkpoint — Funds, Verification, Phase 5 implementation decisions, Behavior, Decisions and remaining scope (+3 more)

### Community 178 - "payroll/infrastructure/memory-repositories.ts"
Cohesion: 0.06
Nodes (23): PayrollRecordRow, AppliedImport, RecordDetail, ListRecordsOptions, NewPayrollRecord, PayrollComponent, PayrollComponentsRepository, PayrollRecord (+15 more)

### Community 179 - "File structure"
Cohesion: 0.18
Nodes (10): Deferred (append to `docs/superpowers/DEFERRED.md`), Deviation (Task 2), Deviation (Task 3), Deviation (Task 4), File structure, Phase 9 (reduced): Job lock, housekeeping, management API, closing docs, Task 1 ⚡: Fix `withJobLock` (R9-1), Task 2 ⚡: Housekeeping and inbound hardening (R9-5, R9-6) (+2 more)

### Community 180 - "Endpoints"
Cohesion: 0.20
Nodes (10): Accounts — `accounts.read` / `accounts.write` / `accounts.delete`, Budgets — `budgets.read` / `budgets.write`, Endpoints, Expenses — `expenses.read` / `expenses.write`; management writes `finance.manage`, Funds — `funds.read` / `funds.write`; issues `finance.manage`, Integrations — `integrations.manage`, Interests — `interests.read` / `interests.write`, Payroll — `payroll.read` / `payroll.upload` / `payroll.review` / `payroll.read_original` (+2 more)

### Community 181 - "use-cases.test.ts"
Cohesion: 0.16
Nodes (14): createManualAccount(), createManualAccountSchema, deleteAccount(), UseCaseDeps, DeletionBlockedError, InvalidInputError, NotFoundError, VersionMismatchError (+6 more)

### Community 182 - "http/errors.ts"
Cohesion: 0.36
Nodes (4): ApiError, ErrorBody, ErrorCode, parseExpectedVersion()

### Community 183 - "timeoff.test.ts"
Cohesion: 0.25
Nodes (5): auth, store, sync, TrekYearStats, TrekSyncResult

### Community 184 - "File structure"
Cohesion: 0.29
Nodes (6): Deferred (append to `docs/superpowers/DEFERRED.md`), Deviation (Task 2), File structure, Phase 8 (reduced): Personal access tokens, Task 1 ⚡: Migration 0019 and the token primitive, Task 2 ⚡: Bearer authentication, use cases, routes, bare UI, phase gate

### Community 185 - "management.ts"
Cohesion: 0.11
Nodes (55): connectIntegrationAction(), credentialsFrom(), disconnectIntegrationAction(), mapError(), revalidateIntegrations(), syncIntegrationAction(), testIntegrationAction(), createInterestRuleAction() (+47 more)

### Community 186 - "UseCaseDeps"
Cohesion: 0.24
Nodes (6): UseCaseDeps, isNegativeAmount(), previousDay(), runInterestAccrual(), RunInterestAccrualResult, rule

### Community 187 - "actions/budgets.ts"
Cohesion: 0.07
Nodes (55): addAllocationAction(), addManualUsageAction(), createBudgetAction(), deleteManualUsageAction(), endAllocationAction(), labelsFrom(), mapError(), money() (+47 more)

### Community 188 - "FundContribution"
Cohesion: 0.14
Nodes (6): FundContribution, NewFundContribution, DrizzleContributionsRepository, toContribution(), MemoryContributionsRepository, uniqueViolation()

### Community 189 - "AuditInput"
Cohesion: 0.15
Nodes (7): accountDeps(), setAccountDepsFactoryForTests(), setPrincipalForTests(), onDisconnect(), onDisconnect(), DisconnectFixture, AuditInput

### Community 190 - "budgets/infrastructure/repositories.itest.ts"
Cohesion: 0.05
Nodes (41): AccountBalanceRow, accountBalances, AccountGroupRow, accountGroups, AccountRow, accounts, ProviderLinkRow, BudgetAllocationRow (+33 more)

### Community 193 - "reconcile.ts"
Cohesion: 0.23
Nodes (12): anomalyMonth(), cents(), coversPayrollMonth(), decimalFraction(), DetectedIssue, detectIssues(), formatCents(), formatMedian() (+4 more)

### Community 195 - "ErrorInline.tsx"
Cohesion: 0.06
Nodes (38): HoursPerDayForm(), KEY_STATUS, LlmFormProps, dynamic, IntegrationsPage(), metadata, dynamic, IntegrationPage() (+30 more)

### Community 198 - "portfolio.ts"
Cohesion: 0.23
Nodes (10): combinedGain, fundGain(), FundSeries, GainRow, GainTotal, monthlyReturn(), PerFundGain, cometa (+2 more)

### Community 200 - "permissions.ts"
Cohesion: 0.08
Nodes (25): AdminUserView, ProfileView, SessionView, webhookDeliveries, connectUser(), Db, NOW, seed() (+17 more)

### Community 201 - "trek-sync.test.ts"
Cohesion: 0.10
Nodes (14): ApplyDesiredStateResult, TimeoffStore, RunTrekSyncInput, CALL, CONFIG, EPOCH, jobs, repo (+6 more)

### Community 206 - "trek-provider-adapter.ts"
Cohesion: 0.14
Nodes (15): fakeProvider(), fakeProvider(), fakeProvider(), configOf(), credentialSchema, leaveSync, testConnection(), TREK_PROVIDER (+7 more)

## Knowledge Gaps
- **1276 isolated node(s):** `entrypoint.sh script`, `securityHeaders`, `nextConfig`, `name`, `version` (+1271 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `withUserContext()` connect `withUserContext` to `upload.ts`, `budgets/api/routes.ts`, `accounts/api/routes.ts`, `testPrincipal`, `actions/funds.ts`, `funds/api/routes.ts`, `actions/accounts.ts`, `payroll-ingest.ts`, `DbClient`, `load-transactions.ts`, `load-interests.ts`, `actions/payroll.ts`, `interest-accrual.ts`, `db/index.ts`, `security/api/routes.ts`, `withSystemContext`, `payroll/api/routes.ts`, `timeoff/api/routes.ts`, `users`, `management.ts`, `actions/budgets.ts`, `AuditInput`, `budgets/infrastructure/repositories.itest.ts`, `interests/application/ports.ts`, `require-principal.ts`, `interests/api/routes.ts`, `rls-matrix.itest.ts`, `requirePrincipalOrRedirect`, `monthly-close.ts`, `expenses/api/routes.ts`, `review-import.ts`, `housekeeping.itest.ts`?**
  _High betweenness centrality (0.045) - this node is a cross-community bridge._
- **Why does `assertPermission()` connect `auth/principal.ts` to `upload.ts`, `timeoff/application/ports.ts`, `load-company.ts`, `accounts/api/routes.ts`, `actions/funds.ts`, `actions/accounts.ts`, `get-interest-rule-detail.ts`, `DbClient`, `load-transactions.ts`, `load-interests.ts`, `actions/payroll.ts`, `actions/integrations.ts`, `budgets/application/errors.ts`, `list-accounts.ts`, `create-interest-rule.ts`, `payroll/api/routes.ts`, `use-cases.test.ts`, `management.ts`, `integrations/api/routes.ts`, `actions/budgets.ts`, `contracts.ts`, `expenses/application/ports.ts`, `wallet-provider-adapter.ts`, `require-principal.ts`, `permissions.ts`, `funds/[id]/page.tsx`, `get-budget-detail.ts`, `get-workspace.ts`, `admin/page.tsx`, `TransactionCategory`, `payroll/application/ports.ts`, `load-funds.ts`, `review-import.ts`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **Why does `DbClient` connect `DbClient` to `upload.ts`, `timeoff/application/ports.ts`, `TransactionLabel`, `DrizzleAccountsRepository`, `TimeoffEvent`, `payroll-ingest.ts`, `AccountGroup`, `IntegrationConnection`, `funds/infrastructure/memory-repositories.ts`, `BalancesRepository`, `Allocation`, `accounts/application/ports.ts`, `withUserContext`, `ReconciliationIssue`, `security/api/routes.ts`, `auth/principal.ts`, `budgets/application/ports.ts`, `Fund`, `withSystemContext`, `payroll/infrastructure/memory-repositories.ts`, `FundContribution`, `AuditInput`, `budgets/infrastructure/repositories.itest.ts`, `expenses/application/ports.ts`, `PayrollImport`, `interests/application/ports.ts`, `require-principal.ts`, `permissions.ts`, `MemoryProviderLinksRepository`, `SyncRun`, `rls-matrix.itest.ts`, `funds/application/ports.ts`, `monthly-close.ts`, `TransactionCategory`, `SyncKind`, `payroll/application/ports.ts`, `integrations/types.ts`, `housekeeping.itest.ts`?**
  _High betweenness centrality (0.032) - this node is a cross-community bridge._
- **What connects `entrypoint.sh script`, `securityHeaders`, `nextConfig` to the rest of the system?**
  _1276 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `accounts/[id]/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07993966817496229 - nodes in this community are weakly interconnected._
- **Should `cn` be split into smaller, more focused modules?**
  _Cohesion score 0.0453781512605042 - nodes in this community are weakly interconnected._
- **Should `load-company.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06594071385359952 - nodes in this community are weakly interconnected._
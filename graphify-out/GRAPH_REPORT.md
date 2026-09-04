# Graph Report - personal-dashboard  (2026-09-05)

## Corpus Check
- 521 files · ~416,677 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3317 nodes · 9546 edges · 150 communities (141 shown, 9 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 91 edges (avg confidence: 0.7)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `15bfa94f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- OverviewClient.tsx
- _lib/funds.ts
- cn
- use-cases.test.ts
- heartbeat.ts
- trek.ts
- accounts/api/routes.ts
- Finance & Company Platform — Design and Phased Plan
- accounts/[id]/page.tsx
- parse.ts
- contracts.ts
- compilerOptions
- PageGrid.tsx
- format.ts
- actions/accounts.ts
- rules.ts
- payslip-ingest.ts
- AccountGroup
- wallet.ts
- monthKeyOf
- dependencies
- devDependencies
- 11. Phased implementation plan
- Phase 2 — The integration framework
- load-interests.ts
- IntegrationConnection
- VerifyForm.tsx
- confidence.ts
- integrations/application/deps.ts
- trek-diff.ts
- llm.ts
- Phase 1 — Accounts and Teable retirement
- permissions.ts
- cometa.ts
- romeDate
- validate-teable-migration.ts
- http.ts
- networth.ts
- Account
- trek.test.ts
- expenses/api/routes.ts
- 5. Data model
- trek-sync.test.ts
- interests/application/ports.ts
- toCents
- Finance Dashboard — Brand System
- teamsystem.ts
- gotify.ts
- payroll.ts
- actions/vacation.ts
- render-brand-icons.py
- schema/index.ts
- teable-import.ts
- accounts/application/ports.ts
- actions/payslips.ts
- AGENTS.md
- machine.ts
- integrations/api/routes.ts
- Mod. Cedolino TS Layout
- middleware.ts
- CLAUDE.md
- scripts
- August 2026 OCR Fixture (Paperless-ngx text)
- expenses/infrastructure/memory-repositories.ts
- End-to-end tests
- Transaction
- transaction.ts
- trek-sync.ts
- run-sync.ts
- dashboard-app service
- personal/page.tsx
- 7. Domain designs (what each section computes)
- August 2026 PDF-Text Fixture (clean layout)
- repo/leave.ts
- SyncRun
- env
- interests/api/routes.ts
- Real Payslip Fixture: Agosto 2026
- 8. Security design
- Code 8992 - TRATTAMENTO INT. DL 3/20
- IMPONIBILE IRPEF
- Real Payslip Fixture: Maggio 2026 (doc 102, welfare)
- Real Payslip Fixture: 13a Mensilita 2025 (doc 13)
- Code 300 - ASSENZA X FERIE A.C.(hh)
- Compose healthchecks and autoheal labels
- app/layout.tsx
- package.json
- wallet-adapter.ts
- next.config.ts
- (app)/page.tsx
- auth/principal.ts
- entrypoint.sh
- list-accounts.ts
- Checkpoint: Phase 0 + Phase 1 complete (2026-09-03)
- Code 9837 - IMPONIBILE 5% L.199/25
- admin/page.tsx
- SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md
- interest-accrual.ts
- { GET, POST }
- ADDIZIONALE COMUNALE
- actions/integrations.ts
- TransactionCategory
- File Structure
- SyncKind
- _lib/leave.test.ts
- accounts/infrastructure/memory-repositories.ts
- integrations/types.ts
- assertPermission
- expenses/application/ports.ts
- Teable migration
- InterestRule
- interests/infrastructure/memory-repositories.ts
- expenses.ts
- Phase 1 deployment runbook — accounts and Teable retirement
- text.ts
- Finance Dashboard API
- Phase 2 deployment runbook — integration framework and encrypted credentials
- Architecture overview — Phase 0 + Phase 1 + Phase 2 + Phase 3
- Finance Dashboard
- InterestAccrual
- signin/page.tsx
- actions/leave.ts
- TransactionLabel
- scripts/import-file-credentials.ts
- The integration framework
- Checkpoint: Phase 2 complete (2026-09-04)
- Progress
- MonthGrid.tsx
- react-dom
- tailwindcss
- wallet-provider-adapter.test.ts
- actions/interests.ts
- get-interest-rule-detail.ts
- Phase 3 deployment runbook — Expenses and Interests
- Retiring the standalone `wallet-manager` interest container
- 10. Migration strategy

## God Nodes (most connected - your core abstractions)
1. `cn()` - 98 edges
2. `toCents()` - 55 edges
3. `DbClient` - 55 edges
4. `assertPermission()` - 55 edges
5. `withUserContext()` - 51 edges
6. `fromCents()` - 46 edges
7. `monthKeyOf()` - 46 edges
8. `Principal` - 46 edges
9. `testDb()` - 45 edges
10. `IntegrationConnection` - 40 edges

## Surprising Connections (you probably didn't know these)
- `Code 8054 - CONTRIBUTO DIPENDENTE (negative)` --semantically_similar_to--> `Code 7101 - FONDO C/DIPE (employee pension-fund share)`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d13.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt
- `alerts()` --indirect_call--> `httpRequest()`  [INFERRED]
  dashboard-app/src/lib/jobs/payslip-ingest.test.ts → dashboard-app/src/lib/clients/http.ts
- `alerts()` --indirect_call--> `httpRequest()`  [INFERRED]
  dashboard-app/src/lib/jobs/wallet-refresh.test.ts → dashboard-app/src/lib/clients/http.ts
- `alerts()` --indirect_call--> `httpRequest()`  [INFERRED]
  dashboard-app/src/lib/jobs/wallet-transactions-sync.test.ts → dashboard-app/src/lib/clients/http.ts
- `Code 4 - GIORNI NON LAVORATI` --semantically_similar_to--> `Code 19 - ORE NON LAVORATE`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d14.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **IRPEF Settlement Chain (gross to net)** — dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_imponibile_irpef, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_irpef_lorda, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_totale_detrazioni, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9424_ulteriore_detrazione_mese, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_totale_trattenute_irpef, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_irpef_erario, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_addizionale_regionale, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_addizionale_comunale, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_netto_busta [EXTRACTED 1.00]
- **Leave-Hours Accounting Pattern (offsetting pair + residual grid)** — dashboard_app_src_lib_payroll___fixtures___real_ago2026_300_assenza_x_ferie_ac, dashboard_app_src_lib_payroll___fixtures___real_ago2026_301_ferie_ac, dashboard_app_src_lib_payroll___fixtures___real_d15_308_assenza_x_perm_ac, dashboard_app_src_lib_payroll___fixtures___real_d15_309_permessi_ac, dashboard_app_src_lib_payroll___fixtures___august_2026_pdf_leave_residuals_grid, dashboard_app_src_lib_payroll___fixtures___august_2026_ocr_flattened_residuals_defect [EXTRACTED 1.00]
- **TFR / Complementary Pension Contribution Block** — dashboard_app_src_lib_payroll___fixtures___real_ago2026_7101_fondo_c_dipe, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9109_fondo_c_azienda, dashboard_app_src_lib_payroll___fixtures___real_ago2026_8003_contribuzione_tfr, dashboard_app_src_lib_payroll___fixtures___real_ago2026_7897_esonero_ctr_tfr_prev_c, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9110_comunicazione_dipendente, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_tfr_mese [EXTRACTED 1.00]

## Communities (150 total, 9 thin omitted)

### Community 0 - "OverviewClient.tsx"
Cohesion: 0.08
Nodes (39): FinanceTabs(), HREF, OPTIONS, ViewKey, byYear(), FundTable(), MonthlyGainPanel(), Pct() (+31 more)

### Community 1 - "_lib/funds.ts"
Cohesion: 0.09
Nodes (24): FundsPage(), FundView, loadFund(), loadFunds(), loadPortfolioGain(), absoluteReturn(), BalanceSnapshot, Fund (+16 more)

### Community 2 - "cn"
Cohesion: 0.05
Nodes (64): AccountDetailActions(), AccountDetailActionsProps, ViewState, FundSettingsForm(), FundSettingsFormProps, WithdrawalFlowProps, FRESH, FUND (+56 more)

### Community 3 - "use-cases.test.ts"
Cohesion: 0.13
Nodes (14): createManualAccount(), createManualAccountSchema, deleteAccount(), UseCaseDeps, DeletionBlockedError, InvalidInputError, NotFoundError, VersionMismatchError (+6 more)

### Community 4 - "heartbeat.ts"
Cohesion: 0.41
Nodes (9): dynamic, GET(), HEARTBEAT_MAX_AGE_MS, heartbeatAgeMs(), heartbeatPath(), isHeartbeatStale(), readHeartbeat(), touchHeartbeat() (+1 more)

### Community 5 - "trek.ts"
Cohesion: 0.10
Nodes (36): UpstreamService, ApplyDesiredStateInput, asRecord(), callTool(), CLIENT_INFO, describe(), ensureSession(), entryListSchema (+28 more)

### Community 6 - "accounts/api/routes.ts"
Cohesion: 0.05
Nodes (63): accountDto(), balancePointDto(), commonErrorResponses, createAccountRoute, createGroupRoute, decodeCursor(), deleteAccountRoute, deleteGroupRoute (+55 more)

### Community 7 - "Finance & Company Platform — Design and Phased Plan"
Cohesion: 0.12
Nodes (16): 0. How to read this document, 12. Intentional breaking changes, 13. Questions worth answering (none block Phase 0–1), 1.1 What exists, 1.2 What to keep, change, retire, 1. Repository assessment, 2. Assumptions (stated instead of asked), 3.1 Shape (+8 more)

### Community 8 - "accounts/[id]/page.tsx"
Cohesion: 0.09
Nodes (30): BalanceHistoryRow, BalanceHistoryTable(), BalanceHistoryTableProps, BalancesPageResponse, dynamic, ArchivedAccountsList(), dynamic, metadata (+22 more)

### Community 9 - "parse.ts"
Cohesion: 0.10
Nodes (27): PAYSLIP_FIELDS, AcquiredText, ORDINARY_MONTH_MARKERS, THIRTEENTH_KEYWORDS, median(), PayslipHistoryEntry, LlmOptions, allLowFields() (+19 more)

### Community 10 - "contracts.ts"
Cohesion: 0.11
Nodes (24): REVOLUT_COMPONENT_KEYS, WALLET_ACCOUNTS, WALLET_EXPECTED_CURRENCY, WalletAccountConfig, getBalances(), WalletBalances, ACCOUNT_KEYS, AccountKey (+16 more)

### Community 11 - "compilerOptions"
Cohesion: 0.07
Nodes (29): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+21 more)

### Community 12 - "PageGrid.tsx"
Cohesion: 0.09
Nodes (15): LG_SPAN, LG_START, MD_SPAN, PageGrid(), Panel(), PanelProps, Span, Skeleton() (+7 more)

### Community 13 - "format.ts"
Cohesion: 0.09
Nodes (37): LeaveCard(), LeaveByMonth(), FRACTION_OPTIONS, KIND_OPTIONS, varianceSentence(), OPTIONS, SalarySection(), SalarySectionProps (+29 more)

### Community 14 - "actions/accounts.ts"
Cohesion: 0.29
Nodes (23): createAccountAction(), createGroupAction(), deleteAccountAction(), deleteGroupAction(), flag(), mapError(), recordBalanceAction(), renameGroupAction() (+15 more)

### Community 15 - "rules.ts"
Cohesion: 0.13
Nodes (25): PayslipField, Anchor, AUX_ANCHORS, AUX_FIELDS, AuxField, COMPOSITE_FIELDS, FIELD_ANCHORS, GRID_HEADER_SYNONYMS (+17 more)

### Community 16 - "payslip-ingest.ts"
Cohesion: 0.08
Nodes (32): dynamic, POST(), PaperlessDocument, PayslipExtraction, acquireText(), ingestPayslipDocument(), IngestPayslipInput, IngestTrigger (+24 more)

### Community 17 - "AccountGroup"
Cohesion: 0.15
Nodes (8): isUniqueViolation(), AccountGroupRow, accountGroups, GroupsRepository, AccountGroup, DrizzleGroupsRepository, toGroup(), MemoryGroupsRepository

### Community 18 - "wallet.ts"
Cohesion: 0.08
Nodes (39): SleepFn, withRetry(), accountSchema, accountsSchema, assertFieldSeenSomewhere(), assertPageNotTruncated(), baseUrl(), categoriesSchema (+31 more)

### Community 19 - "monthKeyOf"
Cohesion: 0.15
Nodes (28): TotalBalanceCards(), currentValue(), effectiveSetting(), FundDepositRow, FundSettingRow, initialCapitalCents(), ReturnRow, returnTable() (+20 more)

### Community 20 - "dependencies"
Cohesion: 0.07
Nodes (27): @base-ui-components/react, clsx, dependencies, @base-ui-components/react, clsx, drizzle-orm, hono, @hono/zod-openapi (+19 more)

### Community 21 - "devDependencies"
Cohesion: 0.07
Nodes (27): devDependencies, drizzle-kit, @fontsource/ibm-plex-mono, @fontsource/ibm-plex-sans, msw, @playwright/test, @tailwindcss/postcss, tsx (+19 more)

### Community 22 - "11. Phased implementation plan"
Cohesion: 0.18
Nodes (11): 11. Phased implementation plan, Phase 0 — Foundations (no visible product change), Phase 1 — Accounts and Teable retirement (first vertical slice), Phase 2 — Integration framework and Settings › Integrations, Phase 3 — Expenses and Interests, Phase 4 — Payroll upload pipeline and Company, Phase 5 — Funds expansion, Phase 6 — Budgets (+3 more)

### Community 23 - "Phase 2 — The integration framework"
Cohesion: 0.07
Nodes (27): File Structure, Global Constraints, Phase 2 — Deferred minors first, Phase 2: Integration framework, encrypted credentials and the Settings split, Phase 2 — The integration framework, Rulings, Self-review against the Phase 2 scope, Task 10: The sync engine (+19 more)

### Community 24 - "load-interests.ts"
Cohesion: 0.10
Nodes (29): dynamic, InterestsPage(), metadata, dynamic, InterestRulePage(), metadata, monthStart(), accountDeps() (+21 more)

### Community 25 - "IntegrationConnection"
Cohesion: 0.08
Nodes (19): ConnectIntegrationInput, ImportResult, ConnectionPatch, ConnectionsRepository, ConnectionStatePatch, NewConnection, WebhookDeliveriesRepository, WebhookDelivery (+11 more)

### Community 26 - "VerifyForm.tsx"
Cohesion: 0.12
Nodes (28): extractionOf(), compare(), orderQueue(), placeInQueue(), QueueEntry, QueuePlacement, successorOf(), queue (+20 more)

### Community 27 - "confidence.ts"
Cohesion: 0.13
Nodes (23): VerifyFormProps, FieldExtraction, SanityCheck, GRID_DEPENDENT_FIELDS, BALANCE_TOLERANCE, checkNetAgainstMedian(), checkNettoBalance(), checkResidualContinuity() (+15 more)

### Community 28 - "integrations/application/deps.ts"
Cohesion: 0.08
Nodes (34): IntegrationDeps, drainSyncQueue(), enqueueSync(), ConnectionNotFoundError, ConnectionVersionMismatchError, CredentialValidationError, SyncDisabledError, SyncNotSupportedError (+26 more)

### Community 29 - "trek-diff.ts"
Cohesion: 0.18
Nodes (15): Editing, LeaveDayDetail, LeaveFraction, LeaveKind, DesiredDay, TogglePlanStep, TrekEntry, differs() (+7 more)

### Community 30 - "llm.ts"
Cohesion: 0.14
Nodes (17): buildTool(), chatCompletionsUrl(), coerceMonth(), coerceNumber(), DEFAULT_MAX_CHARS, DEFAULT_TIMEOUT_MS, emptyResult(), errorName() (+9 more)

### Community 31 - "Phase 1 — Accounts and Teable retirement"
Cohesion: 0.07
Nodes (27): File structure (what will exist after Phase 1), Global Constraints, Phase 0 — Foundations, Phase 0 + Phase 1: Foundations and Accounts Implementation Plan, Phase 1 — Accounts and Teable retirement, Self-review against the spec, Task 10: Capability resolver and capability-driven navigation, Task 11: Accounts schema with RLS (+19 more)

### Community 32 - "permissions.ts"
Cohesion: 0.09
Nodes (27): AppLayout(), HomePage(), activeChild(), AppShell(), AppShellProps, IconProps, ICONS, isActive() (+19 more)

### Community 33 - "cometa.ts"
Cohesion: 0.27
Nodes (13): CometaCredit, cometaCreditedDeposits(), cometaSchedule(), creditedByMonth(), creditMonthFor(), JOINING_FEE, quarterIndex(), quarterKey() (+5 more)

### Community 34 - "romeDate"
Cohesion: 0.16
Nodes (21): VacationFundPage(), PersonalSettingsPage(), MonthlyAccrual, MonthlyReturnInput, MoneyInput, PayslipLike, AccrualRateRow, balanceSeries() (+13 more)

### Community 35 - "validate-teable-migration.ts"
Cohesion: 0.10
Nodes (20): APP_MANAGED_KEYS, argv, BlankMonthRow, centsByMonth(), db, differenceLabel(), HAND_TRACKED_KEYS, LEGACY_KEYS (+12 more)

### Community 36 - "http.ts"
Cohesion: 0.10
Nodes (28): backoffDelay(), HttpError, httpRequest(), HttpRequestInit, isRetryable(), isRetryableStatus(), parseRetryAfter(), readBody() (+20 more)

### Community 37 - "networth.ts"
Cohesion: 0.13
Nodes (21): contributingKeys(), missingKeys(), netWorth, NetWorthContributor, NetWorthOptions, observe(), Observed, oldestCapture() (+13 more)

### Community 38 - "Account"
Cohesion: 0.11
Nodes (5): AccountsRepository, Account, base, DrizzleAccountsRepository, toAccount()

### Community 39 - "trek.test.ts"
Cohesion: 0.13
Nodes (19): applyDesiredState(), expectedAction(), isWeekendBlockedError(), planToggles(), resetTrekAuthCache(), callsTo(), CONFIG, entriesPayload() (+11 more)

### Community 40 - "expenses/api/routes.ts"
Cohesion: 0.08
Nodes (31): categoriesRoute, categoryDto(), commonErrorResponses, getRoute, IdParamSchema, IfMatchHeaderSchema, labelDto(), labelsRoute (+23 more)

### Community 41 - "5. Data model"
Cohesion: 0.18
Nodes (11): 5.10 Indexes (access-pattern driven), 5.1 Identity and access, 5.2 Integrations, 5.3 Accounts, 5.4 Transactions (Expenses), 5.5 Funds, 5.6 Budgets, 5.7 Interests (+3 more)

### Community 42 - "trek-sync.test.ts"
Cohesion: 0.17
Nodes (8): ApplyDesiredStateResult, CALL, CONFIG, jobs, repo, state, STATS, trek

### Community 43 - "interests/application/ports.ts"
Cohesion: 0.11
Nodes (18): CreateInterestRuleInput, createInterestRuleSchema, InvalidInputError, NotFoundError, VersionMismatchError, AccountBalanceLookup, Clock, Compounding (+10 more)

### Community 44 - "toCents"
Cohesion: 0.11
Nodes (31): EMPTY, initialCapitalOf(), PortfolioGain, monthlyReturn, centsFromDecimal(), fromCents(), roundEur(), toCents() (+23 more)

### Community 45 - "Finance Dashboard — Brand System"
Cohesion: 0.22
Nodes (8): 1. Strategy, 2. The mark, 3. Assets, 4. Colour, 5. Typography, 6. Voice, 7. Applications, Finance Dashboard — Brand System

### Community 46 - "teamsystem.ts"
Cohesion: 0.23
Nodes (15): parseItalianNumber(), bodyRow(), EMPTY, extractTeamSystem(), findGrid(), isNumericOnly(), numbersOf(), plausibleHours() (+7 more)

### Community 47 - "gotify.ts"
Cohesion: 0.12
Nodes (17): alertPayslipPending(), alertSuccessAfterRetry(), appUrl(), GotifyMessage, JobFailureAlert, notify(), PayslipPendingAlert, RetrySuccessAlert (+9 more)

### Community 48 - "payroll.ts"
Cohesion: 0.09
Nodes (43): extractedField(), FerieView, hoursPerDay(), loadFerie(), LeaveByMonthProps, LeaveCalendarProps, LeaveCalendarView, LeaveMonthView (+35 more)

### Community 49 - "actions/vacation.ts"
Cohesion: 0.10
Nodes (32): parseMoney(), initialSchema, rateSchema, recordWithdrawal(), revalidateVacation(), setAccrualRate(), setInitialValue(), undoWithdrawal() (+24 more)

### Community 50 - "render-brand-icons.py"
Cohesion: 0.33
Nodes (3): Rasterise the Finance Dashboard mark to PNG. No rasteriser is installed on this…, radius=0 renders a full-bleed square (maskable); otherwise a rounded square., render()

### Community 51 - "schema/index.ts"
Cohesion: 0.06
Nodes (60): bootstrapOwner(), db, pool, AccountBalanceRow, accountBalances, AccountRow, accounts, ProviderLinkRow (+52 more)

### Community 52 - "teable-import.ts"
Cohesion: 0.10
Nodes (23): argv, db, dryRun, ExportFile, fromIndex, pool, unknown, balanceSnapshots (+15 more)

### Community 53 - "accounts/application/ports.ts"
Cohesion: 0.13
Nodes (18): ArchivedAccountRow, AccountPatch, AccountsSource, NewBalance, ProviderAccount, balanceRow(), nextStatus(), patch() (+10 more)

### Community 54 - "actions/payslips.ts"
Cohesion: 0.14
Nodes (22): depositSchema, recordManualDeposit(), revalidateFund(), saveFundSettings(), settingsSchema, slugOf(), confirmPayslip(), extractedValue() (+14 more)

### Community 56 - "machine.ts"
Cohesion: 0.09
Nodes (29): dynamic, POST(), TIERS, dynamic, POST(), dynamic, POST(), Bucket (+21 more)

### Community 57 - "integrations/api/routes.ts"
Cohesion: 0.07
Nodes (38): ErrorResponseSchema, CappedRead, commonErrorResponses, conflict, connectionDto(), connectRoute, disconnectRoute, listRoute (+30 more)

### Community 58 - "Mod. Cedolino TS Layout"
Cohesion: 0.22
Nodes (10): Code 1150 - RATA ADD.REG. A.P., Real Payslip Fixture: Marzo 2026 (doc 96), ADDIZIONALE REGIONALE, Fixture Anonymisation Convention, Employer Header Block (Ditta / ACME Consulting srl), TeamSystem August 2026 Fixture (synthetic-anonymised), IBAN / Bank Accredito Trailer Line, Q/INPS - INAIL Statistical Block (+2 more)

### Community 59 - "middleware.ts"
Cohesion: 0.24
Nodes (11): config, contentSecurityPolicy(), frameAncestorsFor(), hasSessionCookie(), isPublic(), middleware(), PUBLIC_PATHS, PUBLIC_PREFIXES (+3 more)

### Community 61 - "scripts"
Cohesion: 0.11
Nodes (19): scripts, build, db:generate, db:migrate, dev, e2e, lint, migrate:credentials (+11 more)

### Community 62 - "August 2026 OCR Fixture (Paperless-ngx text)"
Cohesion: 0.29
Nodes (7): OCR Digit/Letter Confusion, August 2026 OCR Fixture (Paperless-ngx text), Flattened Residuals Grid OCR Defect, Leave Residuals Grid (FERIE / PERMESSI / ROL / FLESS. / B. ORE), Garbage OCR Fixture (skewed scan), All-Low-Confidence Degradation (Failure Handling), OCR Letter-Spacing Artifact (S -> 'S ')

### Community 63 - "expenses/infrastructure/memory-repositories.ts"
Cohesion: 0.15
Nodes (10): newAccount(), category, MemoryCategoriesRepository, MemoryLabelsRepository, MemoryRecurringPatternsRepository, MemoryTransactionsRepository, monotonicId(), deps (+2 more)

### Community 64 - "End-to-end tests"
Cohesion: 0.50
Nodes (3): End-to-end tests, Planned flows (not yet written), `smoke.spec.ts` (implemented)

### Community 65 - "Transaction"
Cohesion: 0.11
Nodes (10): TransactionRow, transactions, ListTransactionsOptions, ListTransactionsPage, NewTransaction, TransactionPatch, TransactionsRepository, Transaction (+2 more)

### Community 66 - "transaction.ts"
Cohesion: 0.10
Nodes (24): WalletCategory, WalletRecord, ProviderCategory, ProviderTransaction, TransactionsSource, syncProviderTransactions(), SyncProviderTransactionsDeps, SyncProviderTransactionsResult (+16 more)

### Community 67 - "trek-sync.ts"
Cohesion: 0.12
Nodes (18): LeaveDaySaved, auth, cache, DAY, repo, store, sync, trek (+10 more)

### Community 68 - "run-sync.ts"
Cohesion: 0.16
Nodes (16): ConnectionNotUsableError, execute(), prepare(), Prepared, recordFailure(), resolve(), Resolved, resumeQueuedSync() (+8 more)

### Community 69 - "dashboard-app service"
Cohesion: 0.38
Nodes (7): dashboard-app service, dashboard-cron supercronic sidecar service, External networks proxy_public and db_internal, projects compose stack, read_only rootfs, cap_drop ALL, tmpfs and limits, Read-only secret file mounts (wallet-token, trek-token), Traefik router with X-Forwarded-Proto https middleware

### Community 70 - "personal/page.tsx"
Cohesion: 0.08
Nodes (31): clearLlmApiKey(), completeFirstRun(), hoursSchema, llmSchema, setHoursPerDay(), setLlmSettings(), DEFAULT_HOURS_PER_DAY, HoursPerDayForm() (+23 more)

### Community 71 - "7. Domain designs (what each section computes)"
Cohesion: 0.20
Nodes (10): 7.1 Home, 7.2 Finance Overview, 7.3 Accounts, 7.4 Funds, 7.5 Budgets, 7.6 Interests (reuse / change / deprecate from `interest.py`), 7.7 Expenses, 7.8 Company (+2 more)

### Community 72 - "August 2026 PDF-Text Fixture (clean layout)"
Cohesion: 0.28
Nodes (9): Code 001 - RETRIBUZIONE ORDINARIA, August 2026 PDF-Text Fixture (clean layout), TOTALE RITENUTE, Code 2 - LAVORO ORDIN.(mens.), Code 1101 - IRPEF A CREDITO -MOD.730-, Code 9208 - CREDITO COMPENSATO, Real Payslip Fixture: Luglio 2026 (doc 104, 730 refund), ARROTONDAMENTO (+1 more)

### Community 73 - "repo/leave.ts"
Cohesion: 0.20
Nodes (17): planPush(), syncPass(), clearPending(), dayAt(), daysInRange(), daysInYear(), deleteDates(), earliestDate() (+9 more)

### Community 74 - "SyncRun"
Cohesion: 0.14
Nodes (7): NewSyncRun, SyncRunsRepository, DrizzleSyncRunsRepository, toRun(), MemorySyncRunsRepository, SyncRun, SyncRunStatus

### Community 75 - "env"
Cohesion: 0.13
Nodes (25): runtime, asNumber(), asString(), authentikProvider(), buildConfig(), discoverOidc(), fetchDiscovery(), { handlers, auth, signIn, signOut } (+17 more)

### Community 76 - "interests/api/routes.ts"
Cohesion: 0.09
Nodes (27): accrualDto(), commonErrorResponses, createRoute_, entryDto(), getRoute, IdParamSchema, IfMatchHeaderSchema, listRoute (+19 more)

### Community 77 - "Real Payslip Fixture: Agosto 2026"
Cohesion: 0.25
Nodes (11): Code 19 - ORE NON LAVORATE, Code 2161 - DONATORI SANGUE, Code 7101 - FONDO C/DIPE (employee pension-fund share), Code 7897 - ESONERO CTR - TFR PREV.C., Code 8003 - CONTRIBUZIONE TFR, Code 9109 - FONDO C/AZIENDA (employer pension-fund share), Code 9110 - COMUNICAZIONE DIPENDENTE, Real Payslip Fixture: Agosto 2026 (+3 more)

### Community 78 - "8. Security design"
Cohesion: 0.40
Nodes (5): 8.1 Authentication and MFA, 8.2 Authorization, 8.3 Web security, 8.4 Data protection, 8. Security design

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

### Community 85 - "app/layout.tsx"
Cohesion: 0.27
Nodes (6): metadata, viewport, THEME_STORAGE_KEY, ThemeScript(), plexMono, plexSans

### Community 86 - "package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 87 - "wallet-adapter.ts"
Cohesion: 0.29
Nodes (8): WalletAccount, accountType(), mapWalletAccount(), prefetchedWalletSource(), TYPE_BY_ACCOUNT_TYPE, updatedAt(), WALLET_PROVIDER, walletAccountsSource()

### Community 89 - "(app)/page.tsx"
Cohesion: 0.11
Nodes (21): DATE_LINE, dynamic, ENTRY_LABEL, metadata, dynamic, FundsCard(), metadata, totalFundValue() (+13 more)

### Community 90 - "auth/principal.ts"
Cohesion: 0.06
Nodes (44): buildOpenApiDocument(), ownerPrincipal(), app, DELETE, dynamic, GET, PATCH, POST (+36 more)

### Community 92 - "list-accounts.ts"
Cohesion: 0.22
Nodes (19): generateMetadata(), MonthPoint, AccountDetail, getAccountDetail(), AccountListItem, DEFAULT_TREND_MONTHS, isStale(), listAccounts() (+11 more)

### Community 93 - "Checkpoint: Phase 0 + Phase 1 complete (2026-09-03)"
Cohesion: 0.25
Nodes (7): Before Phase 2, Checkpoint: Phase 0 + Phase 1 complete (2026-09-03), Decisions already taken (summary; full text in the ledger), Deployment status (2026-09-03, later the same day), Documents, How to continue, State

### Community 94 - "Code 9837 - IMPONIBILE 5% L.199/25"
Cohesion: 0.50
Nodes (4): Code 9837 - IMPONIBILE 5% L.199/25, Code 9838 - IMPOSTA SOST. 5% L.199/25, Real Payslip Fixture: Giugno 2026 (doc 103), PAGA BASE / PREMIO PR. / SUPERM.ASS Row

### Community 95 - "admin/page.tsx"
Cohesion: 0.05
Nodes (56): AccountDetailPage(), encodeCursor(), AccountsPage(), dynamic, metadata, BudgetsPage(), dynamic, metadata (+48 more)

### Community 96 - "SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md"
Cohesion: 0.50
Nodes (3): Pre-flight scan (2026-09-02), Progress, SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md

### Community 97 - "interest-accrual.ts"
Cohesion: 0.08
Nodes (64): asDocId(), dynamic, extractDocId(), ID_KEYS, POST(), dynamic, alertJobFailure(), errorMessage() (+56 more)

### Community 107 - "actions/integrations.ts"
Cohesion: 0.13
Nodes (28): connectIntegrationAction(), credentialsFrom(), disconnectIntegrationAction(), mapError(), revalidateIntegrations(), syncIntegrationAction(), testIntegrationAction(), IntegrationsPage() (+20 more)

### Community 109 - "TransactionCategory"
Cohesion: 0.11
Nodes (12): RecurringPatternRow, recurringPatterns, transactionCategories, TransactionCategoryRow, transactionLabelLinks, TransactionDetail, TransactionListItem, CategoriesRepository (+4 more)

### Community 110 - "File Structure"
Cohesion: 0.07
Nodes (28): File Structure, Global Constraints, Phase 3: Expenses and Interests, Rulings, Self-review against the Phase 3 scope, Task 10: Expenses REST API, Task 11: Expenses pages — list and detail, replacing the setup state, Task 12: Recurring-pattern persistence wired into the transactions sync (+20 more)

### Community 111 - "SyncKind"
Cohesion: 0.19
Nodes (7): SyncJob, SyncJobsRepository, DrizzleSyncJobsRepository, toJob(), MemorySyncJobsRepository, SyncKind, SyncSchedule

### Community 112 - "_lib/leave.test.ts"
Cohesion: 0.20
Nodes (7): payroll, payslips, principal, repo, trekState, vacation, LeaveDayRow

### Community 113 - "accounts/infrastructure/memory-repositories.ts"
Cohesion: 0.08
Nodes (11): NOW, NewAccount, ProviderLink, ProviderLinkEntityType, toLink(), MemoryAccountsRepository, MemoryClock, MemoryProviderLinksRepository (+3 more)

### Community 114 - "integrations/types.ts"
Cohesion: 0.08
Nodes (27): fakeProvider(), configOf(), credentialSchema, leaveSync, onDisconnect(), testConnection(), TREK_PROVIDER, trekProvider (+19 more)

### Community 115 - "assertPermission"
Cohesion: 0.18
Nodes (18): ExpensesPage(), getTransaction(), listCategories(), listLabels(), listRecurringPatterns(), listTransactions(), ListTransactionsResult, UseCaseDeps (+10 more)

### Community 116 - "expenses/application/ports.ts"
Cohesion: 0.13
Nodes (12): detectRecurringPatterns(), Clock, RecurringPatternRecord, RecurringPatternsRepository, Cadence, CADENCE_DAY_BANDS, cadenceFor(), DetectedPattern (+4 more)

### Community 117 - "Teable migration"
Cohesion: 0.29
Nodes (6): Files in this directory, `npm run migrate:teable`, `npm run migrate:teable:validate`, Order of operations, Running against the deployed container, Teable migration

### Community 118 - "InterestRule"
Cohesion: 0.16
Nodes (7): InterestRule, InterestRulePatch, InterestRulesRepository, NewInterestRule, DrizzleInterestRulesRepository, toRule(), MemoryInterestRulesRepository

### Community 119 - "interests/infrastructure/memory-repositories.ts"
Cohesion: 0.15
Nodes (8): InterestEntriesRepository, InterestEntry, NewInterestEntry, rule, DrizzleInterestEntriesRepository, toEntry(), MemoryInterestEntriesRepository, monotonicId()

### Community 120 - "expenses.ts"
Cohesion: 0.16
Nodes (14): mapError(), updateTransactionAction(), dynamic, generateMetadata(), loadTransactionDetail, TransactionDetailPage(), NotFoundError, VersionMismatchError (+6 more)

### Community 121 - "Phase 1 deployment runbook — accounts and Teable retirement"
Cohesion: 0.18
Nodes (11): Cleanup after a successful deploy, Phase 1 deployment runbook — accounts and Teable retirement, Pre-checks, Rollback, Step 1 — build the new image, Step 2 — apply migrations 0004–0006 only, Step 3 — import the legacy history, Step 4 — validate (+3 more)

### Community 122 - "text.ts"
Cohesion: 0.15
Nodes (18): errorMessage(), findLabel(), numbersOnLine(), pick(), readGrid(), resolveAnchor(), resolveField(), round2() (+10 more)

### Community 123 - "Finance Dashboard API"
Cohesion: 0.14
Nodes (14): Authentication, Breaking changes in Phase 2, Endpoints (Phase 1 + Phase 2), Error envelope, Expenses, Finance Dashboard API, `Idempotency-Key`, Integrations (+6 more)

### Community 124 - "Phase 2 deployment runbook — integration framework and encrypted credentials"
Cohesion: 0.18
Nodes (10): 1. Pre-checks, 2. Generate the encryption key, 3. Deploy the new image with the token files still mounted, 4. Import the file-mounted credentials, 5. Verify in the UI, 6. Remove the token files, 7. Verify the tick, 8. Rollback (+2 more)

### Community 125 - "Architecture overview — Phase 0 + Phase 1 + Phase 2 + Phase 3"
Cohesion: 0.20
Nodes (10): API conventions, Architecture overview — Phase 0 + Phase 1 + Phase 2 + Phase 3, Capability-driven navigation and Home, Integration framework, Job tiers, Known deviations, Module layout, RLS context and the `system` role (+2 more)

### Community 126 - "Finance Dashboard"
Cohesion: 0.29
Nodes (7): Developing, Documentation, Finance Dashboard, Running it, Stack, Status: Phase 0 + Phase 1 complete, Testing

### Community 127 - "InterestAccrual"
Cohesion: 0.14
Nodes (7): InterestAccrual, InterestAccrualsRepository, NewInterestAccrual, DrizzleInterestAccrualsRepository, toAccrual(), MemoryInterestAccrualsRepository, PostWalletInterestInput

### Community 128 - "signin/page.tsx"
Cohesion: 0.31
Nodes (7): first(), metadata, safeCallbackUrl(), SearchParams, SignInPage(), SignInButton(), PROVIDER_ID

### Community 129 - "actions/leave.ts"
Cohesion: 0.27
Nodes (17): daySchema, describe(), LEAVE_PATHS, noopSync(), removeLeaveDay(), removeSchema, revalidateLeave(), setLeaveDay() (+9 more)

### Community 130 - "TransactionLabel"
Cohesion: 0.19
Nodes (7): TransactionLabelRow, transactionLabels, LabelsRepository, NewLabel, TransactionLabel, DrizzleLabelsRepository, toLabel()

### Community 132 - "scripts/import-file-credentials.ts"
Cohesion: 0.15
Nodes (15): main(), readTrimmed(), connectIntegration(), FileCredentials, importFileCredentials(), connected(), ownerUserId(), createCredentialCipher() (+7 more)

### Community 133 - "The integration framework"
Cohesion: 0.20
Nodes (10): 1. What an integration is, 2. Credential storage, 3. Key rotation, 4. Connection lifecycle, 5. Sync runs, 6. Inbound webhooks, 7. Adding a provider, The integration framework (+2 more)

### Community 134 - "Checkpoint: Phase 2 complete (2026-09-04)"
Cohesion: 0.25
Nodes (7): Checkpoint: Phase 2 complete (2026-09-04), Decisions already taken (summary; full text in the ledger and in `task-20-brief.md`'s "Rulings" section), Deployment status, Documents, How to continue, State, What a reader should know before Phase 3

### Community 135 - "Progress"
Cohesion: 0.33
Nodes (5): Deferred-minor cleanup wave (batch before Task 19), Pre-flight rulings (2026-09-04), Pre-flight scan, Progress, SDD ledger — plan: docs/superpowers/plans/2026-09-04-phase-2-integrations.md

### Community 136 - "MonthGrid.tsx"
Cohesion: 0.18
Nodes (15): dayNumber(), describeDay(), Dot(), DotKind, fractionOf(), isoOf(), MonthGrid(), MonthGridDayBase (+7 more)

### Community 141 - "wallet-provider-adapter.test.ts"
Cohesion: 0.27
Nodes (4): connectionFixture(), disconnectCtx(), DisconnectFixture, AuditInput

### Community 142 - "actions/interests.ts"
Cohesion: 0.43
Nodes (6): createInterestRuleAction(), mapError(), createInterestRule(), EligibleAccount, RuleForm(), RuleFormProps

### Community 143 - "get-interest-rule-detail.ts"
Cohesion: 0.52
Nodes (6): dayAfter(), getInterestRuleDetail(), InterestRuleDetail, startOfDay(), ProjectionPoint, ReconciliationSummary

### Community 144 - "Phase 3 deployment runbook — Expenses and Interests"
Cohesion: 0.29
Nodes (6): 1. Pre-checks, 2. Deploy, 3. Verify, 4. Rollback, 5. Posting cut-over, Phase 3 deployment runbook — Expenses and Interests

### Community 145 - "Retiring the standalone `wallet-manager` interest container"
Cohesion: 0.33
Nodes (5): Before you start: read the container's current configuration, Retiring the standalone `wallet-manager` interest container, Rollback, Steps, What a crash leaves behind, and why this procedure avoids relying on it

### Community 147 - "10. Migration strategy"
Cohesion: 0.40
Nodes (5): 10.1 Teable → PostgreSQL, 10.2 Paperless → payroll silo, 10.3 Single user → users table, 10.4 Deployment, 10. Migration strategy

## Knowledge Gaps
- **892 isolated node(s):** `entrypoint.sh script`, `securityHeaders`, `nextConfig`, `name`, `version` (+887 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `cn` to `OverviewClient.tsx`, `actions/leave.ts`, `permissions.ts`, `accounts/[id]/page.tsx`, `MonthGrid.tsx`, `PageGrid.tsx`, `format.ts`, `actions/accounts.ts`, `(app)/page.tsx`, `VerifyForm.tsx`, `admin/page.tsx`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `DbClient` connect `auth/principal.ts` to `TransactionLabel`, `scripts/import-file-credentials.ts`, `wallet-provider-adapter.test.ts`, `AccountGroup`, `load-interests.ts`, `IntegrationConnection`, `integrations/application/deps.ts`, `validate-teable-migration.ts`, `Account`, `schema/index.ts`, `teable-import.ts`, `accounts/application/ports.ts`, `Transaction`, `SyncRun`, `interest-accrual.ts`, `TransactionCategory`, `SyncKind`, `integrations/types.ts`, `assertPermission`, `expenses/application/ports.ts`, `InterestRule`, `interests/infrastructure/memory-repositories.ts`, `InterestAccrual`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `withUserContext()` connect `schema/index.ts` to `interest-accrual.ts`, `validate-teable-migration.ts`, `scripts/import-file-credentials.ts`, `accounts/api/routes.ts`, `expenses/api/routes.ts`, `interests/api/routes.ts`, `actions/accounts.ts`, `accounts/infrastructure/memory-repositories.ts`, `assertPermission`, `load-interests.ts`, `auth/principal.ts`?**
  _High betweenness centrality (0.015) - this node is a cross-community bridge._
- **What connects `entrypoint.sh script`, `securityHeaders`, `nextConfig` to the rest of the system?**
  _892 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `OverviewClient.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.07678075855689177 - nodes in this community are weakly interconnected._
- **Should `_lib/funds.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0873015873015873 - nodes in this community are weakly interconnected._
- **Should `cn` be split into smaller, more focused modules?**
  _Cohesion score 0.04568868980963046 - nodes in this community are weakly interconnected._
# Graph Report - personal-dashboard  (2026-09-05)

## Corpus Check
- 534 files · ~470,621 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 3393 nodes · 9750 edges · 166 communities (155 shown, 11 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 90 edges (avg confidence: 0.71)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `09b57398`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- format.ts
- _lib/funds.ts
- cn
- auth/principal.ts
- heartbeat.ts
- trek.ts
- accounts/api/routes.ts
- Finance & Company Platform — Design and Phased Plan
- accounts/[id]/page.tsx
- parse.ts
- contracts.ts
- compilerOptions
- PageGrid.tsx
- work/page.tsx
- actions/accounts.ts
- rules.ts
- payslip-ingest.ts
- AccountGroup
- wallet.ts
- time.ts
- dependencies
- devDependencies
- 11. Phased implementation plan
- Phase 2 — The integration framework
- load-interests.ts
- IntegrationConnection
- VerifyForm.tsx
- confidence.ts
- lifecycle.test.ts
- trek-diff.ts
- llm.ts
- Phase 1 — Accounts and Teable retirement
- resolve.ts
- cometa.ts
- actions/vacation.ts
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
- gotify.ts
- payroll.ts
- require-user.ts
- render-brand-icons.py
- schema/index.ts
- monthKey
- wallet-provider-adapter.test.ts
- actions/payslips.ts
- AGENTS.md
- machine.ts
- integrations/api/routes.ts
- Mod. Cedolino TS Layout
- middleware.ts
- CLAUDE.md
- scripts
- August 2026 OCR Fixture (Paperless-ngx text)
- test/principal.ts
- End-to-end tests
- expenses/infrastructure/memory-repositories.ts
- wallet-provider-adapter.ts
- trek-sync.ts
- run-sync.ts
- dashboard-app service
- succeed
- 7. Domain designs (what each section computes)
- August 2026 PDF-Text Fixture (clean layout)
- repo/leave.ts
- SyncRun
- env
- interests/api/routes.ts
- Real Payslip Fixture: Agosto 2026
- vacation/page.tsx
- Code 8992 - TRATTAMENTO INT. DL 3/20
- IMPONIBILE IRPEF
- Real Payslip Fixture: Maggio 2026 (doc 102, welfare)
- Real Payslip Fixture: 13a Mensilita 2025 (doc 13)
- Code 300 - ASSENZA X FERIE A.C.(hh)
- Compose healthchecks and autoheal labels
- schema/accounts.ts
- package.json
- webhook.itest.ts
- next.config.ts
- (app)/page.tsx
- app.ts
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
- handle-webhook.test.ts
- _lib/leave.test.ts
- ProviderLink
- integrations/types.ts
- load-transactions.ts
- expenses/application/ports.ts
- README.md
- InterestRule
- interests/infrastructure/memory-repositories.ts
- expenses.ts
- Phase 1 deployment runbook — accounts and Teable retirement
- text.ts
- Finance Dashboard API
- Phase 2 deployment runbook — integration framework and encrypted credentials
- Architecture overview — Phase 0 + Phase 1 + Phase 2 + Phase 3
- Finance Dashboard
- DbClient
- [[...route]]/route.ts
- actions/leave.ts
- TransactionLabel
- scripts/import-file-credentials.ts
- The integration framework
- Checkpoint: Phase 2 complete (2026-09-04)
- Progress
- actions/funds.ts
- react-dom
- tailwindcss
- post-interest-entry.test.ts
- actions/types.ts
- get-interest-rule-detail.ts
- Phase 3 deployment runbook — Expenses and Interests
- probes.ts
- interests/application/ports.ts
- 10. Migration strategy
- Rulings — execution (P3-C1 … P3-C38)
- jobs/registry.ts
- llm-config.ts
- expenses-rls.itest.ts
- interest-accrual.itest.ts
- migrate-teable.ts
- list-integrations.ts
- Checkpoint: Phase 3 complete (2026-09-05)
- confidence.test.ts
- accounts/ui/run.ts
- TransactionsTable.tsx
- RulesTable.tsx
- Phase 4: Payroll upload pipeline and Company
- 3. Target architecture
- metrics/route.ts
- PostFailedError

## God Nodes (most connected - your core abstractions)
1. `cn()` - 98 edges
2. `toCents()` - 61 edges
3. `DbClient` - 56 edges
4. `assertPermission()` - 55 edges
5. `withUserContext()` - 55 edges
6. `fromCents()` - 52 edges
7. `testDb()` - 51 edges
8. `monthKeyOf()` - 46 edges
9. `Principal` - 46 edges
10. `IntegrationConnection` - 40 edges

## Surprising Connections (you probably didn't know these)
- `Code 8054 - CONTRIBUTO DIPENDENTE (negative)` --semantically_similar_to--> `Code 7101 - FONDO C/DIPE (employee pension-fund share)`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d13.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt
- `alerts()` --indirect_call--> `httpRequest()`  [INFERRED]
  dashboard-app/src/lib/jobs/wallet-refresh.test.ts → dashboard-app/src/lib/clients/http.ts
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

## Communities (166 total, 11 thin omitted)

### Community 0 - "format.ts"
Cohesion: 0.09
Nodes (39): byYear(), FundTable(), MonthlyGainPanel(), Pct(), tone(), OverviewAccount, dynamic, FundsPage() (+31 more)

### Community 1 - "_lib/funds.ts"
Cohesion: 0.09
Nodes (19): FundView, loadFunds(), FundDepositRow, BalanceSnapshot, balanceSnapshots, Fund, FundDeposit, fundDeposits (+11 more)

### Community 2 - "cn"
Cohesion: 0.05
Nodes (66): DEFAULT_STATE, OverviewClient(), OverviewClientProps, PRESET, RANGE_KEYS, readUrl(), toSearch(), toSeries() (+58 more)

### Community 3 - "auth/principal.ts"
Cohesion: 0.10
Nodes (31): AdminUserView, describeCurrentSession(), loadUsers(), ProfileView, SessionView, createManualAccount(), createManualAccountSchema, deleteAccount() (+23 more)

### Community 4 - "heartbeat.ts"
Cohesion: 0.41
Nodes (9): dynamic, GET(), HEARTBEAT_MAX_AGE_MS, heartbeatAgeMs(), heartbeatPath(), isHeartbeatStale(), readHeartbeat(), touchHeartbeat() (+1 more)

### Community 5 - "trek.ts"
Cohesion: 0.09
Nodes (41): UpstreamService, applyDesiredState(), ApplyDesiredStateInput, asRecord(), callTool(), CLIENT_INFO, describe(), ensureSession() (+33 more)

### Community 6 - "accounts/api/routes.ts"
Cohesion: 0.06
Nodes (56): accountDto(), balancePointDto(), commonErrorResponses, createAccountRoute, createGroupRoute, decodeCursor(), deleteAccountRoute, deleteGroupRoute (+48 more)

### Community 7 - "Finance & Company Platform — Design and Phased Plan"
Cohesion: 0.12
Nodes (16): 0. How to read this document, 12. Intentional breaking changes, 13. Questions worth answering (none block Phase 0–1), 1.1 What exists, 1.2 What to keep, change, retire, 1. Repository assessment, 2. Assumptions (stated instead of asked), 4. Navigation and page map (+8 more)

### Community 8 - "accounts/[id]/page.tsx"
Cohesion: 0.08
Nodes (34): AccountDetailActions(), AccountDetailActionsProps, BalanceHistoryRow, BalanceHistoryTable(), BalanceHistoryTableProps, BalancesPageResponse, AccountDetailPage(), dynamic (+26 more)

### Community 9 - "parse.ts"
Cohesion: 0.10
Nodes (27): PAYSLIP_FIELDS, AcquiredText, ORDINARY_MONTH_MARKERS, THIRTEENTH_KEYWORDS, median(), PayslipHistoryEntry, LlmOptions, allLowFields() (+19 more)

### Community 10 - "contracts.ts"
Cohesion: 0.13
Nodes (18): ACCOUNT_KEYS, AccountKey, JobStatus, SourceKind, JOB_NAME, LOCK_KEY, refresh(), RunWalletRefreshInput (+10 more)

### Community 11 - "compilerOptions"
Cohesion: 0.07
Nodes (29): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+21 more)

### Community 12 - "PageGrid.tsx"
Cohesion: 0.09
Nodes (15): LG_SPAN, LG_START, MD_SPAN, PageGrid(), Panel(), PanelProps, Span, Skeleton() (+7 more)

### Community 13 - "work/page.tsx"
Cohesion: 0.08
Nodes (39): LeaveCard(), LeaveByMonth(), FRACTION_OPTIONS, KIND_OPTIONS, LeaveCalendar(), varianceSentence(), OPTIONS, SalarySection() (+31 more)

### Community 14 - "actions/accounts.ts"
Cohesion: 0.23
Nodes (25): createAccountAction(), createGroupAction(), deleteAccountAction(), deleteGroupAction(), flag(), mapError(), recordBalanceAction(), renameGroupAction() (+17 more)

### Community 15 - "rules.ts"
Cohesion: 0.12
Nodes (26): Anchor, AUX_ANCHORS, AUX_FIELDS, AuxField, COMPOSITE_FIELDS, FIELD_ANCHORS, GRID_HEADER_SYNONYMS, GridId (+18 more)

### Community 16 - "payslip-ingest.ts"
Cohesion: 0.08
Nodes (40): baseUrl(), clearPayslipTagIdCache(), documentSchema, DownloadedDocument, downloadOriginal(), getDocument(), headers(), listPayslipDocuments() (+32 more)

### Community 17 - "AccountGroup"
Cohesion: 0.17
Nodes (6): isUniqueViolation(), GroupsRepository, AccountGroup, DrizzleGroupsRepository, toGroup(), MemoryGroupsRepository

### Community 18 - "wallet.ts"
Cohesion: 0.06
Nodes (59): isRetryable(), requestJson(), SleepFn, withRetry(), REVOLUT_COMPONENT_KEYS, WALLET_ACCOUNTS, WALLET_EXPECTED_CURRENCY, WalletAccountConfig (+51 more)

### Community 19 - "time.ts"
Cohesion: 0.13
Nodes (32): TotalBalanceCards(), absoluteReturn(), currentValue(), FundSettingRow, initialCapitalCents(), ReturnRow, returnTable(), deposits (+24 more)

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
Cohesion: 0.14
Nodes (20): dynamic, InterestRulePage(), metadata, monthStart(), listInterestRules(), accountNamesFor(), AccountNamesLookup, loadInterestRuleDetail() (+12 more)

### Community 25 - "IntegrationConnection"
Cohesion: 0.09
Nodes (7): ConnectionsRepository, DrizzleConnectionsRepository, toConnection(), MemoryConnectionsRepository, Stored, SealedCredential, IntegrationConnection

### Community 26 - "VerifyForm.tsx"
Cohesion: 0.12
Nodes (28): extractionOf(), compare(), orderQueue(), placeInQueue(), QueueEntry, QueuePlacement, successorOf(), queue (+20 more)

### Community 27 - "confidence.ts"
Cohesion: 0.13
Nodes (23): VerifyFormProps, FieldExtraction, SanityCheck, GRID_DEPENDENT_FIELDS, BALANCE_TOLERANCE, checkNetAgainstMedian(), checkNettoBalance(), checkResidualContinuity() (+15 more)

### Community 28 - "lifecycle.test.ts"
Cohesion: 0.16
Nodes (17): connectIntegration(), ConnectIntegrationInput, ConnectionNotFoundError, ConnectionVersionMismatchError, CredentialValidationError, UnknownProviderError, FileCredentials, ImportResult (+9 more)

### Community 29 - "trek-diff.ts"
Cohesion: 0.18
Nodes (17): Editing, LeaveDayDetail, LeaveFraction, LeaveKind, DesiredDay, TogglePlanStep, TrekEntry, differs() (+9 more)

### Community 30 - "llm.ts"
Cohesion: 0.15
Nodes (16): buildTool(), chatCompletionsUrl(), coerceMonth(), coerceNumber(), DEFAULT_MAX_CHARS, DEFAULT_TIMEOUT_MS, emptyResult(), errorName() (+8 more)

### Community 31 - "Phase 1 — Accounts and Teable retirement"
Cohesion: 0.07
Nodes (27): File structure (what will exist after Phase 1), Global Constraints, Phase 0 — Foundations, Phase 0 + Phase 1: Foundations and Accounts Implementation Plan, Phase 1 — Accounts and Teable retirement, Self-review against the spec, Task 10: Capability resolver and capability-driven navigation, Task 11: Accounts schema with RLS (+19 more)

### Community 32 - "resolve.ts"
Cohesion: 0.06
Nodes (36): AppLayout(), metadata, viewport, activeChild(), AppShell(), AppShellProps, IconProps, ICONS (+28 more)

### Community 33 - "cometa.ts"
Cohesion: 0.27
Nodes (13): CometaCredit, cometaCreditedDeposits(), cometaSchedule(), creditedByMonth(), creditMonthFor(), JOINING_FEE, quarterIndex(), quarterKey() (+5 more)

### Community 34 - "actions/vacation.ts"
Cohesion: 0.13
Nodes (22): initialSchema, rateSchema, VACATION_PATHS, WithdrawalRecorded, withdrawalSchema, MonthlyAccrual, effectiveSetting(), MonthlyReturnInput (+14 more)

### Community 35 - "validate-teable-migration.ts"
Cohesion: 0.08
Nodes (31): APP_MANAGED_KEYS, argv, BlankMonthRow, centsByMonth(), db, differenceLabel(), HAND_TRACKED_KEYS, LEGACY_KEYS (+23 more)

### Community 36 - "http.ts"
Cohesion: 0.10
Nodes (19): backoffDelay(), HttpError, httpRequest(), HttpRequestInit, isRetryableStatus(), parseRetryAfter(), readBody(), RetryOptions (+11 more)

### Community 37 - "staleness.ts"
Cohesion: 0.29
Nodes (9): asDate(), classify(), isStale(), snapshotGrace, StalenessInfo, StalenessSource, NOW, DISPLAY_STALENESS_MS (+1 more)

### Community 38 - "accounts/application/ports.ts"
Cohesion: 0.07
Nodes (14): NetWorthAccountSeries, NOW, AccountPatch, AccountsRepository, NewAccount, NewBalance, Account, BalancePoint (+6 more)

### Community 39 - "trek.test.ts"
Cohesion: 0.17
Nodes (14): resetTrekAuthCache(), callsTo(), CONFIG, entriesPayload(), fetchMock, LIVE_STATS, Rpc, rpcOf() (+6 more)

### Community 40 - "expenses/api/routes.ts"
Cohesion: 0.08
Nodes (31): categoriesRoute, categoryDto(), commonErrorResponses, getRoute, IdParamSchema, IfMatchHeaderSchema, labelDto(), labelsRoute (+23 more)

### Community 41 - "5. Data model"
Cohesion: 0.18
Nodes (11): 5.10 Indexes (access-pattern driven), 5.1 Identity and access, 5.2 Integrations, 5.3 Accounts, 5.4 Transactions (Expenses), 5.5 Funds, 5.6 Budgets, 5.7 Interests (+3 more)

### Community 42 - "trek-sync.test.ts"
Cohesion: 0.17
Nodes (8): ApplyDesiredStateResult, CALL, CONFIG, jobs, repo, state, STATS, trek

### Community 43 - "create-interest-rule.ts"
Cohesion: 0.20
Nodes (10): createInterestRule(), createInterestRuleSchema, InvalidInputError, NotFoundError, VersionMismatchError, DATE_RE, isValidDateOnly(), RATE_RE (+2 more)

### Community 44 - "toCents"
Cohesion: 0.13
Nodes (27): EMPTY, initialCapitalOf(), loadPortfolioGain(), PortfolioGain, monthlyReturn, centsFromDecimal(), fromCents(), roundEur() (+19 more)

### Community 45 - "Finance Dashboard — Brand System"
Cohesion: 0.25
Nodes (8): 1. Strategy, 2. The mark, 3. Assets, 4. Colour, 5. Typography, 6. Voice, 7. Applications, Finance Dashboard — Brand System

### Community 46 - "teamsystem.ts"
Cohesion: 0.23
Nodes (15): parseItalianNumber(), bodyRow(), EMPTY, extractTeamSystem(), findGrid(), isNumericOnly(), numbersOf(), plausibleHours() (+7 more)

### Community 47 - "gotify.ts"
Cohesion: 0.17
Nodes (13): alertPayslipPending(), alertSuccessAfterRetry(), appUrl(), GotifyMessage, JobFailureAlert, notify(), PayslipPendingAlert, RetrySuccessAlert (+5 more)

### Community 48 - "payroll.ts"
Cohesion: 0.08
Nodes (47): extractedField(), FerieView, hoursPerDay(), loadFerie(), LeaveByMonthProps, LeaveCalendarProps, LeaveCalendarView, LeaveMonthView (+39 more)

### Community 49 - "require-user.ts"
Cohesion: 0.22
Nodes (11): bodySchema, dynamic, POST(), dynamic, GET(), INLINE_TYPES, AuthedUser, isUnauthorizedError() (+3 more)

### Community 50 - "render-brand-icons.py"
Cohesion: 0.33
Nodes (3): Rasterise the Finance Dashboard mark to PNG. No rasteriser is installed on this…, radius=0 renders a full-bleed square (maskable); otherwise a rounded square., render()

### Community 51 - "schema/index.ts"
Cohesion: 0.18
Nodes (19): accounts, organizations, roles, userIdentities, userRoles, users, calls, asGroupUser() (+11 more)

### Community 52 - "monthKey"
Cohesion: 0.17
Nodes (14): monthKey(), centsToString(), DEFAULT_BY_KEY, DEFAULTS, DERIVED_KEYS, EXPORTED_NUMBER_COLUMNS, pivotExportedRecords(), PlannedAccount (+6 more)

### Community 53 - "wallet-provider-adapter.test.ts"
Cohesion: 0.11
Nodes (15): AccountsSource, ProviderAccount, balanceRow(), nextStatus(), patch(), sameName(), syncProviderAccounts(), SyncProviderAccountsDeps (+7 more)

### Community 54 - "actions/payslips.ts"
Cohesion: 0.24
Nodes (12): confirmPayslip(), extractedValue(), extractionOf(), nullableMoney, PendingEntry, pendingQueue(), rejectPayslip(), revalidatePayslips() (+4 more)

### Community 56 - "machine.ts"
Cohesion: 0.10
Nodes (27): asDocId(), dynamic, extractDocId(), ID_KEYS, POST(), dynamic, POST(), dynamic (+19 more)

### Community 57 - "integrations/api/routes.ts"
Cohesion: 0.08
Nodes (37): CappedRead, commonErrorResponses, conflict, connectionDto(), connectRoute, disconnectRoute, listRoute, notFound (+29 more)

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

### Community 63 - "test/principal.ts"
Cohesion: 0.19
Nodes (8): buildOpenApiDocument(), newAccount(), listTransactions(), ListTransactionsResult, TransactionListItem, deps, tokenDeps, testPrincipal()

### Community 64 - "End-to-end tests"
Cohesion: 0.50
Nodes (3): End-to-end tests, Planned flows (not yet written), `smoke.spec.ts` (implemented)

### Community 65 - "expenses/infrastructure/memory-repositories.ts"
Cohesion: 0.09
Nodes (15): transactionLabels, InvalidInputError, ListTransactionsOptions, ListTransactionsPage, NewTransaction, TransactionPatch, TransactionsRepository, Transaction (+7 more)

### Community 66 - "wallet-provider-adapter.ts"
Cohesion: 0.08
Nodes (28): WalletCategory, WalletRecord, ProviderCategory, ProviderTransaction, TransactionsSource, syncProviderTransactions(), SyncProviderTransactionsDeps, SyncProviderTransactionsResult (+20 more)

### Community 67 - "trek-sync.ts"
Cohesion: 0.12
Nodes (18): LeaveDaySaved, auth, cache, DAY, repo, store, sync, trek (+10 more)

### Community 68 - "run-sync.ts"
Cohesion: 0.09
Nodes (27): IntegrationDeps, drainSyncQueue(), enqueueSync(), ConnectionNotUsableError, SyncDisabledError, SyncNotSupportedError, handleWebhook(), WebhookOutcome (+19 more)

### Community 69 - "dashboard-app service"
Cohesion: 0.38
Nodes (7): dashboard-app service, dashboard-cron supercronic sidecar service, External networks proxy_public and db_internal, projects compose stack, read_only rootfs, cap_drop ALL, tmpfs and limits, Read-only secret file mounts (wallet-token, trek-token), Traefik router with X-Forwarded-Proto https middleware

### Community 70 - "succeed"
Cohesion: 0.21
Nodes (16): clearLlmApiKey(), completeFirstRun(), hoursSchema, llmSchema, setHoursPerDay(), setLlmSettings(), succeed(), HoursPerDayForm() (+8 more)

### Community 71 - "7. Domain designs (what each section computes)"
Cohesion: 0.20
Nodes (10): 7.1 Home, 7.2 Finance Overview, 7.3 Accounts, 7.4 Funds, 7.5 Budgets, 7.6 Interests (reuse / change / deprecate from `interest.py`), 7.7 Expenses, 7.8 Company (+2 more)

### Community 72 - "August 2026 PDF-Text Fixture (clean layout)"
Cohesion: 0.28
Nodes (9): Code 001 - RETRIBUZIONE ORDINARIA, August 2026 PDF-Text Fixture (clean layout), TOTALE RITENUTE, Code 2 - LAVORO ORDIN.(mens.), Code 1101 - IRPEF A CREDITO -MOD.730-, Code 9208 - CREDITO COMPENSATO, Real Payslip Fixture: Luglio 2026 (doc 104, 730 refund), ARROTONDAMENTO (+1 more)

### Community 73 - "repo/leave.ts"
Cohesion: 0.21
Nodes (16): syncPass(), clearPending(), dayAt(), daysInRange(), daysInYear(), deleteDates(), earliestDate(), fractionString() (+8 more)

### Community 74 - "SyncRun"
Cohesion: 0.13
Nodes (10): NewSyncRun, SyncRunsRepository, Prepared, RunSyncInput, DrizzleSyncRunsRepository, toRun(), MemorySyncRunsRepository, SyncRun (+2 more)

### Community 75 - "env"
Cohesion: 0.14
Nodes (25): runtime, asNumber(), asString(), authentikProvider(), buildConfig(), discoverOidc(), fetchDiscovery(), { handlers, auth, signIn, signOut } (+17 more)

### Community 76 - "interests/api/routes.ts"
Cohesion: 0.09
Nodes (27): accrualDto(), commonErrorResponses, createRoute_, entryDto(), getRoute, IdParamSchema, IfMatchHeaderSchema, listRoute (+19 more)

### Community 77 - "Real Payslip Fixture: Agosto 2026"
Cohesion: 0.25
Nodes (11): Code 19 - ORE NON LAVORATE, Code 2161 - DONATORI SANGUE, Code 7101 - FONDO C/DIPE (employee pension-fund share), Code 7897 - ESONERO CTR - TFR PREV.C., Code 8003 - CONTRIBUZIONE TFR, Code 9109 - FONDO C/AZIENDA (employer pension-fund share), Code 9110 - COMUNICAZIONE DIPENDENTE, Real Payslip Fixture: Agosto 2026 (+3 more)

### Community 78 - "vacation/page.tsx"
Cohesion: 0.09
Nodes (28): FinanceTabs(), HREF, OPTIONS, ViewKey, OverviewSource, dynamic, FinanceOverviewPage(), metadata (+20 more)

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

### Community 85 - "schema/accounts.ts"
Cohesion: 0.09
Nodes (13): AccountBalanceRow, AccountGroupRow, accountGroups, AccountRow, ProviderLinkRow, providerLinks, auditEvents, InterestAccrualRow (+5 more)

### Community 86 - "package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 87 - "webhook.itest.ts"
Cohesion: 0.16
Nodes (6): ApiDeps, providerRegistry, providers, registerProvider(), resetProviderRegistry(), IntegrationProvider

### Community 89 - "(app)/page.tsx"
Cohesion: 0.11
Nodes (23): dynamic, FundsCard(), HomePage(), metadata, totalFundValue(), Gallery(), ChartTokens, compactValue() (+15 more)

### Community 90 - "app.ts"
Cohesion: 0.12
Nodes (21): idempotencyKeys, rateLimitWindows, seed(), appFor(), seed(), seed(), appFor(), permissionsForRoles() (+13 more)

### Community 92 - "list-accounts.ts"
Cohesion: 0.25
Nodes (15): UseCaseDeps, getAccountDetail(), AccountListItem, DEFAULT_TREND_MONTHS, isStale(), listAccounts(), STALE_AFTER_MS, trendMonths() (+7 more)

### Community 93 - "Checkpoint: Phase 0 + Phase 1 complete (2026-09-03)"
Cohesion: 0.25
Nodes (7): Before Phase 2, Checkpoint: Phase 0 + Phase 1 complete (2026-09-03), Decisions already taken (summary; full text in the ledger), Deployment status (2026-09-03, later the same day), Documents, How to continue, State

### Community 94 - "Code 9837 - IMPONIBILE 5% L.199/25"
Cohesion: 0.50
Nodes (4): Code 9837 - IMPONIBILE 5% L.199/25, Code 9838 - IMPOSTA SOST. 5% L.199/25, Real Payslip Fixture: Giugno 2026 (doc 103), PAGA BASE / PREMIO PR. / SUPERM.ASS Row

### Community 95 - "admin/page.tsx"
Cohesion: 0.06
Nodes (52): AccountsPage(), dynamic, metadata, BudgetsPage(), dynamic, metadata, dynamic, metadata (+44 more)

### Community 96 - "SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md"
Cohesion: 0.50
Nodes (3): Pre-flight scan (2026-09-02), Progress, SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md

### Community 97 - "interest-accrual.ts"
Cohesion: 0.10
Nodes (54): alertJobFailure(), errorMessage(), JobResult, db, accrueRule(), AccrueRuleResult, activeRules(), JOB_NAME (+46 more)

### Community 107 - "actions/integrations.ts"
Cohesion: 0.23
Nodes (17): connectIntegrationAction(), credentialsFrom(), disconnectIntegrationAction(), mapError(), revalidateIntegrations(), syncIntegrationAction(), testIntegrationAction(), disconnectIntegration() (+9 more)

### Community 109 - "TransactionCategory"
Cohesion: 0.20
Nodes (6): CategoriesRepository, NewCategory, TransactionCategory, DrizzleCategoriesRepository, toCategory(), MemoryCategoriesRepository

### Community 110 - "File Structure"
Cohesion: 0.07
Nodes (28): File Structure, Global Constraints, Phase 3: Expenses and Interests, Rulings, Self-review against the Phase 3 scope, Task 10: Expenses REST API, Task 11: Expenses pages — list and detail, replacing the setup state, Task 12: Recurring-pattern persistence wired into the transactions sync (+20 more)

### Community 111 - "handle-webhook.test.ts"
Cohesion: 0.11
Nodes (16): principal, ConnectionPatch, ConnectionStatePatch, NewConnection, SyncJob, SyncJobsRepository, WebhookDeliveriesRepository, WebhookDelivery (+8 more)

### Community 112 - "_lib/leave.test.ts"
Cohesion: 0.22
Nodes (6): payroll, payslips, principal, repo, trekState, vacation

### Community 113 - "ProviderLink"
Cohesion: 0.15
Nodes (8): AccountDetail, ProviderLink, ProviderLinkEntityType, ProviderLinksRepository, DrizzleProviderLinksRepository, toLink(), MemoryProviderLinksRepository, StoredProviderLink

### Community 114 - "integrations/types.ts"
Cohesion: 0.08
Nodes (25): fakeProvider(), makeDeps(), provider(), makeDeps(), principal, stub(), configOf(), credentialSchema (+17 more)

### Community 115 - "load-transactions.ts"
Cohesion: 0.23
Nodes (12): ExpensesPage(), listCategories(), listLabels(), expenseDeps(), loadRecurringPatterns(), loadTransactionDetail(), loadTransactionsPage(), RecurringPatternRow (+4 more)

### Community 116 - "expenses/application/ports.ts"
Cohesion: 0.11
Nodes (15): detectRecurringPatterns(), listRecurringPatterns(), Clock, RecurringPatternRecord, RecurringPatternsRepository, UseCaseDeps, Cadence, CADENCE_DAY_BANDS (+7 more)

### Community 117 - "README.md"
Cohesion: 0.17
Nodes (6): Files in this directory, `npm run migrate:teable`, `npm run migrate:teable:validate`, Order of operations, Running against the deployed container, Teable migration

### Community 118 - "InterestRule"
Cohesion: 0.16
Nodes (5): InterestRule, InterestRulesRepository, NewInterestRule, DrizzleInterestRulesRepository, toRule()

### Community 119 - "interests/infrastructure/memory-repositories.ts"
Cohesion: 0.09
Nodes (17): InterestRuleDetail, InterestAccrual, InterestEntriesRepository, InterestEntry, InterestRulePatch, NewInterestAccrual, NewInterestEntry, rule (+9 more)

### Community 120 - "expenses.ts"
Cohesion: 0.13
Nodes (15): mapError(), updateTransactionAction(), dynamic, generateMetadata(), loadTransactionDetail, requirePrincipalOrRedirect, TransactionDetailPage(), NotFoundError (+7 more)

### Community 121 - "Phase 1 deployment runbook — accounts and Teable retirement"
Cohesion: 0.18
Nodes (11): Cleanup after a successful deploy, Phase 1 deployment runbook — accounts and Teable retirement, Pre-checks, Rollback, Step 1 — build the new image, Step 2 — apply migrations 0004–0006 only, Step 3 — import the legacy history, Step 4 — validate (+3 more)

### Community 122 - "text.ts"
Cohesion: 0.22
Nodes (12): numbersOnLine(), readGrid(), fixture(), GARBAGE_TEXT, OCR_TEXT, PDF_TEXT, extractPdfText(), fixNumericOcr() (+4 more)

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

### Community 127 - "DbClient"
Cohesion: 0.14
Nodes (10): bootstrapOwner(), DbClient, db, pool, accountBalances, drizzleAccountBalanceLookup(), drizzleAccountOwnershipCheck(), DrizzleInterestAccrualsRepository (+2 more)

### Community 128 - "[[...route]]/route.ts"
Cohesion: 0.14
Nodes (14): app, DELETE, dynamic, GET, PATCH, POST, PUT, first() (+6 more)

### Community 129 - "actions/leave.ts"
Cohesion: 0.27
Nodes (16): daySchema, describe(), LEAVE_PATHS, noopSync(), removeLeaveDay(), removeSchema, revalidateLeave(), setLeaveDay() (+8 more)

### Community 130 - "TransactionLabel"
Cohesion: 0.24
Nodes (6): LabelsRepository, NewLabel, TransactionLabel, DrizzleLabelsRepository, toLabel(), MemoryLabelsRepository

### Community 132 - "scripts/import-file-credentials.ts"
Cohesion: 0.15
Nodes (12): main(), readTrimmed(), DrizzleWebhookDeliveriesRepository, ownerUserId(), createCredentialCipher(), credentialCipher, CredentialCryptoError, parseEncryptionKeys() (+4 more)

### Community 133 - "The integration framework"
Cohesion: 0.20
Nodes (10): 1. What an integration is, 2. Credential storage, 3. Key rotation, 4. Connection lifecycle, 5. Sync runs, 6. Inbound webhooks, 7. Adding a provider, The integration framework (+2 more)

### Community 134 - "Checkpoint: Phase 2 complete (2026-09-04)"
Cohesion: 0.25
Nodes (7): Checkpoint: Phase 2 complete (2026-09-04), Decisions already taken (summary; full text in the ledger and in `task-20-brief.md`'s "Rulings" section), Deployment status, Documents, How to continue, State, What a reader should know before Phase 3

### Community 135 - "Progress"
Cohesion: 0.33
Nodes (5): Deferred-minor cleanup wave (batch before Task 19), Pre-flight rulings (2026-09-04), Pre-flight scan, Progress, SDD ledger — plan: docs/superpowers/plans/2026-09-04-phase-2-integrations.md

### Community 136 - "actions/funds.ts"
Cohesion: 0.20
Nodes (18): depositSchema, recordManualDeposit(), revalidateFund(), saveFundSettings(), settingsSchema, slugOf(), parseMoney(), toNumericString() (+10 more)

### Community 141 - "post-interest-entry.test.ts"
Cohesion: 0.20
Nodes (9): UseCaseDeps, recordPostedEntry(), shouldPost(), accrual, rule, isNegativeAmount(), previousDay(), runInterestAccrual() (+1 more)

### Community 142 - "actions/types.ts"
Cohesion: 0.27
Nodes (9): createInterestRuleAction(), mapError(), ActionFailure, ActionResult, ActionSuccess, errorMessage(), EligibleAccount, RuleForm() (+1 more)

### Community 143 - "get-interest-rule-detail.ts"
Cohesion: 0.23
Nodes (11): dayAfter(), getInterestRuleDetail(), startOfDay(), ProjectionPoint, AccrualPeriodPoint, PaidEntryPoint, reconcileInterest(), ReconciliationStatus (+3 more)

### Community 144 - "Phase 3 deployment runbook — Expenses and Interests"
Cohesion: 0.13
Nodes (12): Before you start: read the container's current configuration, Retiring the standalone `wallet-manager` interest container, Rollback, Steps, What a crash leaves behind, and why this procedure avoids relying on it, 1. Pre-checks, 2. Deploy, 3. Verify (+4 more)

### Community 145 - "probes.ts"
Cohesion: 0.13
Nodes (15): bytea, IntegrationConnectionRow, integrationConnections, IntegrationProviderRow, integrationProviders, SyncJobRow, syncJobs, SyncRunRow (+7 more)

### Community 146 - "interests/application/ports.ts"
Cohesion: 0.12
Nodes (8): CreateInterestRuleInput, AccountBalanceLookup, AccountOwnershipCheck, Clock, Compounding, DayCount, InterestAccrualsRepository, PostingMode

### Community 147 - "10. Migration strategy"
Cohesion: 0.40
Nodes (5): 10.1 Teable → PostgreSQL, 10.2 Paperless → payroll silo, 10.3 Single user → users table, 10.4 Deployment, 10. Migration strategy

### Community 150 - "Rulings — execution (P3-C1 … P3-C38)"
Cohesion: 0.11
Nodes (17): Consequences of P3-C37 and P3-C29 that later work must not contradict, Deferred by design, Expenses rulings, Interests rulings, Phase 3 whole-branch review — dispatched, Pre-flight repair rulings, Pre-flight rulings (2026-09-05), Pre-flight scan (+9 more)

### Community 151 - "jobs/registry.ts"
Cohesion: 0.22
Nodes (11): dynamic, POST(), TIERS, JobDefinition, JobRunInput, jobs, JobTier, listJobs() (+3 more)

### Community 152 - "llm-config.ts"
Cohesion: 0.16
Nodes (12): asString(), BaseUrlCheck, checkBaseUrl(), ConfigSource, isPrivateHost(), Layers, LlmResolvedConfig, readLayers() (+4 more)

### Community 153 - "expenses-rls.itest.ts"
Cohesion: 0.18
Nodes (9): seedTwoUsers(), RecurringPatternRow, recurringPatterns, transactionCategories, TransactionCategoryRow, transactionLabelLinks, TransactionLabelRow, TransactionRow (+1 more)

### Community 154 - "interest-accrual.itest.ts"
Cohesion: 0.24
Nodes (11): createRule(), newRule(), seedPostableUser(), seedUser(), seedUserWithAccounts(), seed(), seedTwoUsers(), importFileCredentials() (+3 more)

### Community 155 - "migrate-teable.ts"
Cohesion: 0.20
Nodes (9): argv, db, dryRun, ExportFile, fromIndex, pool, unknown, ExportedPoint (+1 more)

### Community 156 - "list-integrations.ts"
Cohesion: 0.33
Nodes (8): IntegrationsPage(), IntegrationSummary, listIntegrations(), ConnectFormProps, loadIntegration(), loadIntegrations(), CredentialField, IntegrationCapability

### Community 157 - "Checkpoint: Phase 3 complete (2026-09-05)"
Cohesion: 0.20
Nodes (9): Checkpoint: Phase 3 complete (2026-09-05), Deployment status, Documents, How to continue, Not run: the manual walkthrough with a real Wallet token, State, Two behaviours the plan text predates — do not describe the old ones, What remains (+1 more)

### Community 158 - "confidence.test.ts"
Cohesion: 0.39
Nodes (7): PayslipField, CrossValidateInput, HISTORY, input(), rulesResult(), LlmPassResult, RulesResult

### Community 159 - "accounts/ui/run.ts"
Cohesion: 0.52
Nodes (3): accountDeps(), setAccountDepsFactoryForTests(), setPrincipalForTests()

### Community 160 - "TransactionsTable.tsx"
Cohesion: 0.38
Nodes (6): TransactionRow, toRow(), TransactionsApiItem, TransactionsApiPage, TransactionsTable(), TransactionsTableProps

### Community 161 - "RulesTable.tsx"
Cohesion: 0.47
Nodes (5): RuleRow, asPercent(), POSTING_LABEL, RulesTable(), RulesTableProps

### Community 162 - "Phase 4: Payroll upload pipeline and Company"
Cohesion: 0.33
Nodes (5): File Structure, Global Constraints, Phase 4: Payroll upload pipeline and Company, Rulings, What already exists, and what happens to it

### Community 163 - "3. Target architecture"
Cohesion: 0.40
Nodes (5): 3.1 Shape, 3.2 API surface, 3.3 Capabilities and dynamic composition, 3.4 Background work, 3. Target architecture

## Knowledge Gaps
- **921 isolated node(s):** `entrypoint.sh script`, `securityHeaders`, `nextConfig`, `name`, `version` (+916 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `toCents()` connect `toCents` to `_lib/funds.ts`, `actions/vacation.ts`, `validate-teable-migration.ts`, `cometa.ts`, `expenses/infrastructure/memory-repositories.ts`, `post-interest-entry.test.ts`, `get-interest-rule-detail.ts`, `payroll.ts`, `wallet.ts`, `time.ts`, `monthKey`, `expenses/application/ports.ts`, `list-accounts.ts`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Why does `fromCents()` connect `toCents` to `_lib/funds.ts`, `cometa.ts`, `validate-teable-migration.ts`, `actions/vacation.ts`, `expenses/infrastructure/memory-repositories.ts`, `post-interest-entry.test.ts`, `get-interest-rule-detail.ts`, `payroll.ts`, `wallet.ts`, `time.ts`, `expenses/application/ports.ts`, `list-accounts.ts`?**
  _High betweenness centrality (0.019) - this node is a cross-community bridge._
- **Why does `InterestRulesRepository` connect `InterestRule` to `interests/application/ports.ts`, `interests/infrastructure/memory-repositories.ts`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **What connects `entrypoint.sh script`, `securityHeaders`, `nextConfig` to the rest of the system?**
  _921 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `format.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08599033816425121 - nodes in this community are weakly interconnected._
- **Should `_lib/funds.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09032258064516129 - nodes in this community are weakly interconnected._
- **Should `cn` be split into smaller, more focused modules?**
  _Cohesion score 0.049247606019151846 - nodes in this community are weakly interconnected._
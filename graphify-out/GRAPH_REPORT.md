# Graph Report - personal-dashboard  (2026-09-04)

## Corpus Check
- 416 files · ~313,997 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2716 nodes · 7655 edges · 141 communities (132 shown, 9 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 80 edges (avg confidence: 0.75)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2be87fd9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- [slug]/page.tsx
- legacy.ts
- cn
- assertPermission
- sweep.ts
- trek.ts
- accounts/api/routes.ts
- Finance & Company Platform — Design and Phased Plan
- format.ts
- parse.ts
- contracts.ts
- compilerOptions
- PageGrid.tsx
- work/page.tsx
- actions/accounts.ts
- rules.ts
- payslip-ingest.ts
- AccountGroup
- _lib/funds.ts
- monthKeyOf
- dependencies
- devDependencies
- 11. Phased implementation plan
- Phase 2 — The integration framework
- actions/funds.ts
- IntegrationConnection
- queue.ts
- confidence.ts
- actions/integrations.ts
- trek-diff.ts
- llm.ts
- Phase 1 — Accounts and Teable retirement
- probes.ts
- cometa.ts
- vacation-fund.ts
- validate-teable-migration.ts
- http.ts
- toCents
- Account
- trek.test.ts
- verify/[id]/page.tsx
- 5. Data model
- trek-sync.test.ts
- ErrorInline.tsx
- fromCents
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
- migrate-teable.ts
- End-to-end tests
- run/route.ts
- time.ts
- actions/leave.ts
- IntegrationDeps
- dashboard-app service
- llm-config.ts
- 7. Domain designs (what each section computes)
- August 2026 PDF-Text Fixture (clean layout)
- repo/leave.ts
- SyncRun
- env
- 3. Target architecture
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
- wallet-provider-adapter.ts
- next.config.ts
- (app)/page.tsx
- auth/principal.ts
- entrypoint.sh
- list-accounts.ts
- Checkpoint: Phase 0 + Phase 1 complete (2026-09-03)
- Code 9837 - IMPONIBILE 5% L.199/25
- admin/page.tsx
- SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md
- monthly-close.ts
- { GET, POST }
- ADDIZIONALE COMUNALE
- DisconnectForm.tsx
- jobs/registry.ts
- requireUser
- SyncKind
- _lib/leave.test.ts
- DbClient
- integrations/types.ts
- [provider]/page.tsx
- _lib/leave.ts
- README.md
- integrations/api/routes.itest.ts
- drizzle-sync-runs-repository.ts
- _lib/vacation.ts
- Phase 1 deployment runbook — accounts and Teable retirement
- text.ts
- Finance Dashboard API
- Phase 2 deployment runbook — integration framework and encrypted credentials
- Architecture overview — Phase 0 + Phase 1 + Phase 2
- Finance Dashboard
- leave-variance.ts
- signin/page.tsx
- [[...route]]/route.ts
- personal/page.tsx
- crypto.test.ts
- The integration framework
- Checkpoint: Phase 2 complete (2026-09-04)
- Progress
- bootstrap.ts
- react-dom
- tailwindcss

## God Nodes (most connected - your core abstractions)
1. `cn()` - 98 edges
2. `toCents()` - 47 edges
3. `monthKeyOf()` - 46 edges
4. `IntegrationConnection` - 40 edges
5. `fromCents()` - 38 edges
6. `DbClient` - 38 edges
7. `succeed()` - 35 edges
8. `Panel()` - 35 edges
9. `assertPermission()` - 35 edges
10. `env` - 34 edges

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

## Communities (141 total, 9 thin omitted)

### Community 0 - "[slug]/page.tsx"
Cohesion: 0.13
Nodes (25): byYear(), FundTable(), MonthlyGainPanel(), Pct(), tone(), dynamic, metadata, cellTone() (+17 more)

### Community 1 - "legacy.ts"
Cohesion: 0.09
Nodes (12): BalanceSnapshot, balanceSnapshots, FundDeposit, fundDeposits, funds, fundSettings, JobRun, jobRuns (+4 more)

### Community 2 - "cn"
Cohesion: 0.05
Nodes (69): ViewState, ArchivedAccountsList(), decimal(), PdfFrame(), FRESH, FUND, Gallery(), MONTHS (+61 more)

### Community 3 - "assertPermission"
Cohesion: 0.12
Nodes (25): createManualAccount(), CreateManualAccountInput, createManualAccountSchema, deleteAccount(), DeleteAccountResult, UseCaseDeps, DeletionBlockedError, InvalidInputError (+17 more)

### Community 4 - "sweep.ts"
Cohesion: 0.16
Nodes (21): dynamic, GET(), dynamic, POST(), listPayslipDocuments(), HEARTBEAT_MAX_AGE_MS, heartbeatAgeMs(), heartbeatPath() (+13 more)

### Community 5 - "trek.ts"
Cohesion: 0.10
Nodes (36): UpstreamService, ApplyDesiredStateInput, asRecord(), callTool(), CLIENT_INFO, describe(), ensureSession(), entryListSchema (+28 more)

### Community 6 - "accounts/api/routes.ts"
Cohesion: 0.06
Nodes (57): accountDto(), balancePointDto(), commonErrorResponses, createAccountRoute, createGroupRoute, decodeCursor(), deleteAccountRoute, deleteGroupRoute (+49 more)

### Community 7 - "Finance & Company Platform — Design and Phased Plan"
Cohesion: 0.12
Nodes (16): 0. How to read this document, 10.1 Teable → PostgreSQL, 10.2 Paperless → payroll silo, 10.3 Single user → users table, 10.4 Deployment, 10. Migration strategy, 12. Intentional breaking changes, 13. Questions worth answering (none block Phase 0–1) (+8 more)

### Community 8 - "format.ts"
Cohesion: 0.08
Nodes (38): BalanceHistoryRow, BalanceHistoryTable(), BalanceHistoryTableProps, BalancesPageResponse, AccountDetailPage(), dynamic, encodeCursor(), AccountRowProps (+30 more)

### Community 9 - "parse.ts"
Cohesion: 0.10
Nodes (27): PAYSLIP_FIELDS, AcquiredText, ORDINARY_MONTH_MARKERS, THIRTEENTH_KEYWORDS, median(), PayslipHistoryEntry, LlmOptions, LlmPassResult (+19 more)

### Community 10 - "contracts.ts"
Cohesion: 0.07
Nodes (39): SleepFn, REVOLUT_COMPONENT_KEYS, WALLET_ACCOUNTS, WALLET_EXPECTED_CURRENCY, WalletAccountConfig, accountSchema, accountsSchema, baseUrl() (+31 more)

### Community 11 - "compilerOptions"
Cohesion: 0.07
Nodes (29): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+21 more)

### Community 12 - "PageGrid.tsx"
Cohesion: 0.09
Nodes (14): LG_SPAN, LG_START, MD_SPAN, Panel(), PanelProps, Span, Skeleton(), SkeletonBlockProps (+6 more)

### Community 13 - "work/page.tsx"
Cohesion: 0.12
Nodes (26): LeaveCard(), LeaveByMonth(), FRACTION_OPTIONS, KIND_OPTIONS, LeaveCalendar(), varianceSentence(), OPTIONS, SalarySection() (+18 more)

### Community 14 - "actions/accounts.ts"
Cohesion: 0.44
Nodes (17): createAccountAction(), createGroupAction(), deleteAccountAction(), deleteGroupAction(), flag(), mapError(), recordBalanceAction(), renameGroupAction() (+9 more)

### Community 15 - "rules.ts"
Cohesion: 0.10
Nodes (34): PayslipField, Anchor, AUX_ANCHORS, AUX_FIELDS, AuxField, COMPOSITE_FIELDS, FIELD_ANCHORS, GRID_HEADER_SYNONYMS (+26 more)

### Community 16 - "payslip-ingest.ts"
Cohesion: 0.08
Nodes (35): readBody(), requestJson(), baseUrl(), clearPayslipTagIdCache(), documentSchema, DownloadedDocument, downloadOriginal(), getDocument() (+27 more)

### Community 17 - "AccountGroup"
Cohesion: 0.21
Nodes (3): GroupsRepository, AccountGroup, MemoryGroupsRepository

### Community 18 - "_lib/funds.ts"
Cohesion: 0.19
Nodes (20): FundsPage(), FundView, loadFund(), loadFunds(), EMPTY, initialCapitalOf(), loadPortfolioGain(), PortfolioGain (+12 more)

### Community 19 - "monthKeyOf"
Cohesion: 0.17
Nodes (23): TotalBalanceCards(), currentValue(), FundSettingRow, initialCapitalCents(), ReturnRow, returnTable(), deposits, settings (+15 more)

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

### Community 24 - "actions/funds.ts"
Cohesion: 0.38
Nodes (8): depositSchema, recordManualDeposit(), revalidateFund(), saveFundSettings(), settingsSchema, slugOf(), FundSettingsForm(), FundSettingsFormProps

### Community 25 - "IntegrationConnection"
Cohesion: 0.08
Nodes (17): ConnectIntegrationInput, ConnectionPatch, ConnectionsRepository, ConnectionStatePatch, NewConnection, WebhookDeliveriesRepository, WebhookDelivery, DrizzleConnectionsRepository (+9 more)

### Community 26 - "queue.ts"
Cohesion: 0.25
Nodes (12): compare(), orderQueue(), placeInQueue(), QueueEntry, QueuePlacement, successorOf(), queue, verifyHref() (+4 more)

### Community 27 - "confidence.ts"
Cohesion: 0.11
Nodes (25): VerifyField, VerifyFormProps, Confidence, FieldExtraction, SanityCheck, GRID_DEPENDENT_FIELDS, BALANCE_TOLERANCE, checkNetAgainstMedian() (+17 more)

### Community 28 - "actions/integrations.ts"
Cohesion: 0.08
Nodes (34): credentialsFrom(), connectIntegration(), ConnectionNotFoundError, ConnectionNotUsableError, ConnectionVersionMismatchError, CredentialValidationError, SyncDisabledError, SyncNotSupportedError (+26 more)

### Community 29 - "trek-diff.ts"
Cohesion: 0.19
Nodes (15): Editing, LeaveDayDetail, LeaveFraction, LeaveKind, DesiredDay, TogglePlanStep, TrekEntry, differs() (+7 more)

### Community 30 - "llm.ts"
Cohesion: 0.15
Nodes (16): buildTool(), chatCompletionsUrl(), coerceMonth(), coerceNumber(), DEFAULT_MAX_CHARS, DEFAULT_TIMEOUT_MS, emptyResult(), errorName() (+8 more)

### Community 31 - "Phase 1 — Accounts and Teable retirement"
Cohesion: 0.07
Nodes (27): File structure (what will exist after Phase 1), Global Constraints, Phase 0 — Foundations, Phase 0 + Phase 1: Foundations and Accounts Implementation Plan, Phase 1 — Accounts and Teable retirement, Self-review against the spec, Task 10: Capability resolver and capability-driven navigation, Task 11: Accounts schema with RLS (+19 more)

### Community 32 - "probes.ts"
Cohesion: 0.11
Nodes (24): AppLayout(), CardKey, cardState, HOME_CARDS, HomeCard, isCardVisible(), caps(), EXPENSES_CARD (+16 more)

### Community 33 - "cometa.ts"
Cohesion: 0.27
Nodes (13): CometaCredit, cometaCreditedDeposits(), cometaSchedule(), creditedByMonth(), creditMonthFor(), JOINING_FEE, quarterIndex(), quarterKey() (+5 more)

### Community 34 - "vacation-fund.ts"
Cohesion: 0.19
Nodes (19): VacationFundPage(), MonthlyAccrual, effectiveSetting(), MonthlyReturnInput, MoneyInput, sumCents(), AccrualRateRow, balanceSeries() (+11 more)

### Community 35 - "validate-teable-migration.ts"
Cohesion: 0.14
Nodes (13): APP_MANAGED_KEYS, argv, BlankMonthRow, centsByMonth(), db, differenceLabel(), HAND_TRACKED_KEYS, LEGACY_KEYS (+5 more)

### Community 36 - "http.ts"
Cohesion: 0.17
Nodes (12): backoffDelay(), HttpError, httpRequest(), HttpRequestInit, isRetryable(), isRetryableStatus(), parseRetryAfter(), RetryOptions (+4 more)

### Community 37 - "toCents"
Cohesion: 0.15
Nodes (18): legacySeriesFromSnapshots(), centsFromDecimal(), roundEur(), toCents(), contributingKeys(), missingKeys(), netWorth, NetWorthContributor (+10 more)

### Community 38 - "Account"
Cohesion: 0.08
Nodes (6): AccountsRepository, Account, base, DrizzleAccountsRepository, toAccount(), MemoryAccountsRepository

### Community 39 - "trek.test.ts"
Cohesion: 0.13
Nodes (19): applyDesiredState(), expectedAction(), isWeekendBlockedError(), planToggles(), resetTrekAuthCache(), callsTo(), CONFIG, entriesPayload() (+11 more)

### Community 40 - "verify/[id]/page.tsx"
Cohesion: 0.27
Nodes (10): extractionOf(), VerifiableField, dynamic, FIELD_META, FieldMeta, inputValue(), metadata, VerifyPayslipPage() (+2 more)

### Community 41 - "5. Data model"
Cohesion: 0.18
Nodes (11): 5.10 Indexes (access-pattern driven), 5.1 Identity and access, 5.2 Integrations, 5.3 Accounts, 5.4 Transactions (Expenses), 5.5 Funds, 5.6 Budgets, 5.7 Interests (+3 more)

### Community 42 - "trek-sync.test.ts"
Cohesion: 0.17
Nodes (8): ApplyDesiredStateResult, CALL, CONFIG, jobs, repo, state, STATS, trek

### Community 43 - "ErrorInline.tsx"
Cohesion: 0.15
Nodes (12): AccountDetailActions(), AccountDetailActionsProps, ErrorInline(), ErrorInlineProps, AccountForm(), AccountFormAccount, AccountFormGroupOption, AccountFormProps (+4 more)

### Community 44 - "fromCents"
Cohesion: 0.29
Nodes (9): monthlyReturn, fromCents(), combinedGain, fundGain(), FundSeries, PerFundGain, cometa, fideuram (+1 more)

### Community 45 - "Finance Dashboard — Brand System"
Cohesion: 0.25
Nodes (8): 1. Strategy, 2. The mark, 3. Assets, 4. Colour, 5. Typography, 6. Voice, 7. Applications, Finance Dashboard — Brand System

### Community 46 - "teamsystem.ts"
Cohesion: 0.23
Nodes (15): parseItalianNumber(), bodyRow(), EMPTY, extractTeamSystem(), findGrid(), isNumericOnly(), numbersOf(), plausibleHours() (+7 more)

### Community 47 - "gotify.ts"
Cohesion: 0.13
Nodes (17): alertPayslipPending(), alertSuccessAfterRetry(), appUrl(), GotifyMessage, JobFailureAlert, notify(), PayslipPendingAlert, RetrySuccessAlert (+9 more)

### Community 48 - "payroll.ts"
Cohesion: 0.19
Nodes (19): annualTotals, averageNet(), AverageOptions, averageTaxes(), inYear(), isThirteenthCandidate(), isVerified(), leaveTakenByMonth() (+11 more)

### Community 49 - "actions/vacation.ts"
Cohesion: 0.13
Nodes (26): ActionFailure, ActionResult, ActionSuccess, parseMoney(), toNumericString(), initialSchema, rateSchema, recordWithdrawal() (+18 more)

### Community 50 - "render-brand-icons.py"
Cohesion: 0.33
Nodes (3): Rasterise the Finance Dashboard mark to PNG. No rasteriser is installed on this…, radius=0 renders a full-bleed square (maskable); otherwise a rounded square., render()

### Community 51 - "schema/index.ts"
Cohesion: 0.15
Nodes (20): accounts, auditEvents, organizations, roles, userIdentities, users, webhookDeliveries, idempotencyKeys (+12 more)

### Community 52 - "teable-import.ts"
Cohesion: 0.16
Nodes (16): closePreviousMonth(), addMonths(), centsToString(), DEFAULT_BY_KEY, DEFAULTS, DERIVED_KEYS, EXPORTED_NUMBER_COLUMNS, lastDayOfMonth() (+8 more)

### Community 53 - "accounts/application/ports.ts"
Cohesion: 0.07
Nodes (26): ArchivedAccountRow, NOW, AccountPatch, AccountsSource, Clock, NewAccount, NewBalance, ProviderAccount (+18 more)

### Community 54 - "actions/payslips.ts"
Cohesion: 0.21
Nodes (14): confirmPayslip(), extractedValue(), extractionOf(), nullableMoney, PendingEntry, pendingQueue(), rejectPayslip(), revalidatePayslips() (+6 more)

### Community 56 - "machine.ts"
Cohesion: 0.12
Nodes (23): asDocId(), dynamic, extractDocId(), ID_KEYS, POST(), dynamic, POST(), dynamic (+15 more)

### Community 57 - "integrations/api/routes.ts"
Cohesion: 0.06
Nodes (44): CappedRead, commonErrorResponses, conflict, connectionDto(), connectRoute, disconnectRoute, listRoute, notFound (+36 more)

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

### Community 63 - "migrate-teable.ts"
Cohesion: 0.20
Nodes (9): argv, db, dryRun, ExportFile, fromIndex, pool, unknown, ExportedPoint (+1 more)

### Community 64 - "End-to-end tests"
Cohesion: 0.50
Nodes (3): End-to-end tests, Planned flows (not yet written), `smoke.spec.ts` (implemented)

### Community 65 - "run/route.ts"
Cohesion: 0.31
Nodes (8): bodySchema, dynamic, POST(), dynamic, GET(), INLINE_TYPES, isUnauthorizedError(), unauthorizedResponse()

### Community 66 - "time.ts"
Cohesion: 0.18
Nodes (13): asDate(), classify(), isStale(), snapshotGrace, StalenessInfo, StalenessSource, NOW, DISPLAY_STALENESS_MS (+5 more)

### Community 67 - "actions/leave.ts"
Cohesion: 0.11
Nodes (32): daySchema, describe(), LEAVE_PATHS, LeaveDaySaved, noopSync(), removeLeaveDay(), removeSchema, revalidateLeave() (+24 more)

### Community 68 - "IntegrationDeps"
Cohesion: 0.10
Nodes (18): IntegrationDeps, drainSyncQueue(), makeDeps(), principal, provider(), makeDeps(), principal, stub() (+10 more)

### Community 69 - "dashboard-app service"
Cohesion: 0.38
Nodes (7): dashboard-app service, dashboard-cron supercronic sidecar service, External networks proxy_public and db_internal, projects compose stack, read_only rootfs, cap_drop ALL, tmpfs and limits, Read-only secret file mounts (wallet-token, trek-token), Traefik router with X-Forwarded-Proto https middleware

### Community 70 - "llm-config.ts"
Cohesion: 0.15
Nodes (15): appSettings, asString(), BaseUrlCheck, checkBaseUrl(), ConfigSource, isPrivateHost(), Layers, LlmResolvedConfig (+7 more)

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
Cohesion: 0.13
Nodes (8): NewSyncRun, SyncRunsRepository, Prepared, DrizzleSyncRunsRepository, toRun(), MemorySyncRunsRepository, SyncRun, SyncRunStatus

### Community 75 - "env"
Cohesion: 0.14
Nodes (23): runtime, asNumber(), asString(), authentikProvider(), buildConfig(), discoverOidc(), fetchDiscovery(), { handlers, auth, signIn, signOut } (+15 more)

### Community 76 - "3. Target architecture"
Cohesion: 0.40
Nodes (5): 3.1 Shape, 3.2 API surface, 3.3 Capabilities and dynamic composition, 3.4 Background work, 3. Target architecture

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

### Community 87 - "wallet-provider-adapter.ts"
Cohesion: 0.13
Nodes (17): WalletAccount, deletionDecision, accountDeps(), accountType(), mapWalletAccount(), prefetchedWalletSource(), TYPE_BY_ACCOUNT_TYPE, updatedAt() (+9 more)

### Community 89 - "(app)/page.tsx"
Cohesion: 0.06
Nodes (42): FinanceTabs(), HREF, OPTIONS, ViewKey, DEFAULT_STATE, OverviewAccount, OverviewClient(), OverviewClientProps (+34 more)

### Community 90 - "auth/principal.ts"
Cohesion: 0.08
Nodes (35): buildOpenApiDocument(), ownerPrincipal(), AdminUserView, describeCurrentSession(), ProfileView, SessionView, userRoles, seed() (+27 more)

### Community 92 - "list-accounts.ts"
Cohesion: 0.23
Nodes (18): generateMetadata(), MonthPoint, AccountDetail, getAccountDetail(), AccountListItem, DEFAULT_TREND_MONTHS, isStale(), listAccounts() (+10 more)

### Community 93 - "Checkpoint: Phase 0 + Phase 1 complete (2026-09-03)"
Cohesion: 0.25
Nodes (7): Before Phase 2, Checkpoint: Phase 0 + Phase 1 complete (2026-09-03), Decisions already taken (summary; full text in the ledger), Deployment status (2026-09-03, later the same day), Documents, How to continue, State

### Community 94 - "Code 9837 - IMPONIBILE 5% L.199/25"
Cohesion: 0.50
Nodes (4): Code 9837 - IMPONIBILE 5% L.199/25, Code 9838 - IMPOSTA SOST. 5% L.199/25, Real Payslip Fixture: Giugno 2026 (doc 103), PAGA BASE / PREMIO PR. / SUPERM.ASS Row

### Community 95 - "admin/page.tsx"
Cohesion: 0.07
Nodes (49): AccountsPage(), dynamic, metadata, BudgetsPage(), dynamic, metadata, dynamic, ExpensesPage() (+41 more)

### Community 96 - "SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md"
Cohesion: 0.50
Nodes (3): Pre-flight scan (2026-09-02), Progress, SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md

### Community 97 - "monthly-close.ts"
Cohesion: 0.12
Nodes (36): dynamic, alertJobFailure(), errorMessage(), JobResult, db, instance(), pool(), closeOwner() (+28 more)

### Community 107 - "DisconnectForm.tsx"
Cohesion: 0.18
Nodes (19): connectIntegrationAction(), disconnectIntegrationAction(), mapError(), revalidateIntegrations(), syncIntegrationAction(), testIntegrationAction(), text(), Toast() (+11 more)

### Community 109 - "jobs/registry.ts"
Cohesion: 0.22
Nodes (11): dynamic, POST(), TIERS, JobDefinition, JobRunInput, jobs, JobTier, listJobs() (+3 more)

### Community 110 - "requireUser"
Cohesion: 0.18
Nodes (15): clearLlmApiKey(), completeFirstRun(), hoursSchema, llmSchema, setHoursPerDay(), setLlmSettings(), HoursPerDayForm(), KEY_STATUS (+7 more)

### Community 111 - "SyncKind"
Cohesion: 0.18
Nodes (8): SyncJob, SyncJobsRepository, RunSyncInput, DrizzleSyncJobsRepository, toJob(), MemorySyncJobsRepository, SyncKind, SyncSchedule

### Community 112 - "_lib/leave.test.ts"
Cohesion: 0.22
Nodes (6): payroll, payslips, principal, repo, trekState, vacation

### Community 113 - "DbClient"
Cohesion: 0.09
Nodes (19): main(), readTrimmed(), DbClient, AccountBalanceRow, accountBalances, AccountGroupRow, accountGroups, AccountRow (+11 more)

### Community 114 - "integrations/types.ts"
Cohesion: 0.08
Nodes (28): fakeProvider(), FileCredentials, ImportResult, IntegrationSummary, configOf(), credentialSchema, leaveSync, onDisconnect() (+20 more)

### Community 115 - "[provider]/page.tsx"
Cohesion: 0.16
Nodes (14): dynamic, IntegrationsPage(), metadata, dynamic, IntegrationPage(), IntegrationsList(), loadIntegration(), loadIntegrations() (+6 more)

### Community 116 - "_lib/leave.ts"
Cohesion: 0.21
Nodes (15): hoursPerDay(), LeaveCalendarProps, LeaveCalendarView, LeaveMonthView, loadLeaveCalendar(), monthsOf(), MonthGridDay, LeaveMonthVariance (+7 more)

### Community 117 - "README.md"
Cohesion: 0.16
Nodes (6): Files in this directory, `npm run migrate:teable`, `npm run migrate:teable:validate`, Order of operations, Running against the deployed container, Teable migration

### Community 118 - "integrations/api/routes.itest.ts"
Cohesion: 0.17
Nodes (7): ApiDeps, resetCredentialCipher(), providerRegistry, providers, registerProvider(), resetProviderRegistry(), IntegrationProvider

### Community 119 - "drizzle-sync-runs-repository.ts"
Cohesion: 0.15
Nodes (10): bytea, IntegrationConnectionRow, integrationConnections, IntegrationProviderRow, integrationProviders, SyncJobRow, syncJobs, SyncRunRow (+2 more)

### Community 120 - "_lib/vacation.ts"
Cohesion: 0.24
Nodes (7): extractedField(), FerieView, loadFerie(), ferieRemaining, PayslipExtraction, Payslip, latestVerified()

### Community 121 - "Phase 1 deployment runbook — accounts and Teable retirement"
Cohesion: 0.18
Nodes (11): Cleanup after a successful deploy, Phase 1 deployment runbook — accounts and Teable retirement, Pre-checks, Rollback, Step 1 — build the new image, Step 2 — apply migrations 0004–0006 only, Step 3 — import the legacy history, Step 4 — validate (+3 more)

### Community 122 - "text.ts"
Cohesion: 0.26
Nodes (10): detectPeriodMonth(), fixture(), GARBAGE_TEXT, OCR_TEXT, PDF_TEXT, fixNumericOcr(), normalizeText(), OCR_DIGIT_CONFUSIONS (+2 more)

### Community 123 - "Finance Dashboard API"
Cohesion: 0.17
Nodes (12): Authentication, Breaking changes in Phase 2, Endpoints (Phase 1 + Phase 2), Error envelope, Finance Dashboard API, `Idempotency-Key`, Integrations, Optimistic concurrency (`If-Match` / `version`) (+4 more)

### Community 124 - "Phase 2 deployment runbook — integration framework and encrypted credentials"
Cohesion: 0.18
Nodes (10): 1. Pre-checks, 2. Generate the encryption key, 3. Deploy the new image with the token files still mounted, 4. Import the file-mounted credentials, 5. Verify in the UI, 6. Remove the token files, 7. Verify the tick, 8. Rollback (+2 more)

### Community 125 - "Architecture overview — Phase 0 + Phase 1 + Phase 2"
Cohesion: 0.20
Nodes (10): API conventions, Architecture overview — Phase 0 + Phase 1 + Phase 2, Capability-driven navigation and Home, Integration framework, Job tiers, Known deviations, Module layout, RLS context and the `system` role (+2 more)

### Community 126 - "Finance Dashboard"
Cohesion: 0.29
Nodes (7): Developing, Documentation, Finance Dashboard, Running it, Stack, Status: Phase 0 + Phase 1 complete, Testing

### Community 127 - "leave-variance.ts"
Cohesion: 0.31
Nodes (7): LeaveByMonthProps, flaggedMonths(), leaveVariance(), LeaveVarianceInput, LeaveVarianceStatus, VARIANCE_TOLERANCE_DAYS, LeaveTakenMonth

### Community 128 - "signin/page.tsx"
Cohesion: 0.31
Nodes (7): first(), metadata, safeCallbackUrl(), SearchParams, SignInPage(), SignInButton(), PROVIDER_ID

### Community 129 - "[[...route]]/route.ts"
Cohesion: 0.25
Nodes (7): app, DELETE, dynamic, GET, PATCH, POST, PUT

### Community 130 - "personal/page.tsx"
Cohesion: 0.32
Nodes (6): DEFAULT_HOURS_PER_DAY, loadProfile(), dynamic, metadata, PersonalSettingsPage(), rates()

### Community 132 - "crypto.test.ts"
Cohesion: 0.25
Nodes (5): CredentialCryptoError, parseEncryptionKeys(), BASE_ENV, K1, K2

### Community 133 - "The integration framework"
Cohesion: 0.25
Nodes (8): 1. What an integration is, 2. Credential storage, 3. Key rotation, 4. Connection lifecycle, 5. Sync runs, 6. Inbound webhooks, 7. Adding a provider, The integration framework

### Community 134 - "Checkpoint: Phase 2 complete (2026-09-04)"
Cohesion: 0.25
Nodes (7): Checkpoint: Phase 2 complete (2026-09-04), Decisions already taken (summary; full text in the ledger and in `task-20-brief.md`'s "Rulings" section), Deployment status, Documents, How to continue, State, What a reader should know before Phase 3

### Community 135 - "Progress"
Cohesion: 0.33
Nodes (5): Deferred-minor cleanup wave (batch before Task 19), Pre-flight rulings (2026-09-04), Pre-flight scan, Progress, SDD ledger — plan: docs/superpowers/plans/2026-09-04-phase-2-integrations.md

### Community 136 - "bootstrap.ts"
Cohesion: 0.50
Nodes (3): bootstrapOwner(), db, pool

## Knowledge Gaps
- **771 isolated node(s):** `entrypoint.sh script`, `securityHeaders`, `nextConfig`, `name`, `version` (+766 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `env` connect `env` to `probes.ts`, `monthly-close.ts`, `sweep.ts`, `IntegrationDeps`, `llm-config.ts`, `contracts.ts`, `requireUser`, `gotify.ts`, `payslip-ingest.ts`, `machine.ts`, `IntegrationConnection`, `llm.ts`, `admin/page.tsx`?**
  _High betweenness centrality (0.020) - this node is a cross-community bridge._
- **Why does `cn()` connect `cn` to `[slug]/page.tsx`, `format.ts`, `ErrorInline.tsx`, `PageGrid.tsx`, `work/page.tsx`, `actions/accounts.ts`, `DisconnectForm.tsx`, `[provider]/page.tsx`, `actions/payslips.ts`, `actions/funds.ts`, `(app)/page.tsx`, `admin/page.tsx`?**
  _High betweenness centrality (0.018) - this node is a cross-community bridge._
- **Why does `DbClient` connect `DbClient` to `probes.ts`, `validate-teable-migration.ts`, `IntegrationDeps`, `Account`, `bootstrap.ts`, `SyncRun`, `SyncKind`, `integrations/types.ts`, `schema/index.ts`, `accounts/application/ports.ts`, `integrations/api/routes.itest.ts`, `drizzle-sync-runs-repository.ts`, `IntegrationConnection`, `auth/principal.ts`, `admin/page.tsx`, `migrate-teable.ts`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **What connects `entrypoint.sh script`, `securityHeaders`, `nextConfig` to the rest of the system?**
  _771 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `[slug]/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.12688172043010754 - nodes in this community are weakly interconnected._
- **Should `legacy.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09486166007905138 - nodes in this community are weakly interconnected._
- **Should `cn` be split into smaller, more focused modules?**
  _Cohesion score 0.045442395081529 - nodes in this community are weakly interconnected._
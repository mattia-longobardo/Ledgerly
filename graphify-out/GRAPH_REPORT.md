# Graph Report - personal-dashboard  (2026-09-04)

## Corpus Check
- 327 files · ~255,552 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2229 nodes · 5951 edges · 124 communities (113 shown, 11 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 54 edges (avg confidence: 0.76)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `65aec405`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- format.ts
- legacy.ts
- cn
- use-cases.test.ts
- sweep.ts
- trek.ts
- routes.ts
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
- _lib/funds.ts
- monthKeyOf
- dependencies
- devDependencies
- 11. Phased implementation plan
- Phase 2 — The integration framework
- require-user.ts
- MonthGrid.tsx
- queue.ts
- confidence.ts
- succeed
- trek-diff.ts
- llm.ts
- Phase 1 — Accounts and Teable retirement
- auth/principal.ts
- cometa.ts
- fromCents
- validate-teable-migration.ts
- http.ts
- toCents
- ports.ts
- trek.test.ts
- verify/[id]/page.tsx
- 5. Data model
- trek-sync.test.ts
- AccountForm.tsx
- portfolio.ts
- Finance Dashboard — Brand System
- teamsystem.ts
- gotify.ts
- payroll.ts
- actions/vacation.ts
- render-brand-icons.py
- schema/index.ts
- teable-import.ts
- sync-provider-accounts.ts
- actions/payslips.ts
- AGENTS.md
- machine.ts
- OverviewClient.tsx
- Mod. Cedolino TS Layout
- middleware.ts
- CLAUDE.md
- scripts
- August 2026 OCR Fixture (Paperless-ngx text)
- migrate-teable.ts
- End-to-end tests
- run/route.ts
- staleness.ts
- trek-sync.ts
- probes.ts
- dashboard-app service
- llm-config.ts
- 7. Domain designs (what each section computes)
- August 2026 PDF-Text Fixture (clean layout)
- repo/leave.ts
- 10. Migration strategy
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
- wallet-adapter.ts
- next.config.ts
- (app)/page.tsx
- app.ts
- entrypoint.sh
- list-accounts.ts
- Checkpoint: Phase 0 + Phase 1 complete (2026-09-03)
- Code 9837 - IMPONIBILE 5% L.199/25
- settings/page.tsx
- SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md
- wallet-accounts-sync.ts
- { GET, POST }
- ADDIZIONALE COMUNALE
- trek-sync-job.ts
- SettingsForms.tsx
- run.ts
- _lib/leave.test.ts
- DbClient
- sync-provider-accounts.test.ts
- platform.ts
- Teable migration
- @hono/zod-openapi
- typescript
- Phase 1 deployment runbook — accounts and Teable retirement
- Finance Dashboard API
- Architecture overview — Phase 0 + Phase 1
- Finance Dashboard

## God Nodes (most connected - your core abstractions)
1. `cn()` - 92 edges
2. `toCents()` - 47 edges
3. `monthKeyOf()` - 46 edges
4. `fromCents()` - 38 edges
5. `registerAccountRoutes()` - 33 edges
6. `succeed()` - 31 edges
7. `env` - 31 edges
8. `fail()` - 29 edges
9. `monthKey()` - 29 edges
10. `Account` - 29 edges

## Surprising Connections (you probably didn't know these)
- `Code 8054 - CONTRIBUTO DIPENDENTE (negative)` --semantically_similar_to--> `Code 7101 - FONDO C/DIPE (employee pension-fund share)`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d13.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt
- `alerts()` --indirect_call--> `httpRequest()`  [INFERRED]
  dashboard-app/src/lib/jobs/payslip-ingest.test.ts → dashboard-app/src/lib/clients/http.ts
- `alerts()` --indirect_call--> `httpRequest()`  [INFERRED]
  dashboard-app/src/lib/jobs/wallet-refresh.test.ts → dashboard-app/src/lib/clients/http.ts
- `Code 4 - GIORNI NON LAVORATI` --semantically_similar_to--> `Code 19 - ORE NON LAVORATE`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d14.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt
- `Code 7101 - FONDO C/DIPE (employee pension-fund share)` --semantically_similar_to--> `Code 7053 - QUOTA ISCR.FONDO DIPEND.`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt → dashboard-app/src/lib/payroll/__fixtures__/real/d12.txt

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **IRPEF Settlement Chain (gross to net)** — dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_imponibile_irpef, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_irpef_lorda, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_totale_detrazioni, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9424_ulteriore_detrazione_mese, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_totale_trattenute_irpef, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_irpef_erario, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_addizionale_regionale, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_addizionale_comunale, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_netto_busta [EXTRACTED 1.00]
- **Leave-Hours Accounting Pattern (offsetting pair + residual grid)** — dashboard_app_src_lib_payroll___fixtures___real_ago2026_300_assenza_x_ferie_ac, dashboard_app_src_lib_payroll___fixtures___real_ago2026_301_ferie_ac, dashboard_app_src_lib_payroll___fixtures___real_d15_308_assenza_x_perm_ac, dashboard_app_src_lib_payroll___fixtures___real_d15_309_permessi_ac, dashboard_app_src_lib_payroll___fixtures___august_2026_pdf_leave_residuals_grid, dashboard_app_src_lib_payroll___fixtures___august_2026_ocr_flattened_residuals_defect [EXTRACTED 1.00]
- **TFR / Complementary Pension Contribution Block** — dashboard_app_src_lib_payroll___fixtures___real_ago2026_7101_fondo_c_dipe, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9109_fondo_c_azienda, dashboard_app_src_lib_payroll___fixtures___real_ago2026_8003_contribuzione_tfr, dashboard_app_src_lib_payroll___fixtures___real_ago2026_7897_esonero_ctr_tfr_prev_c, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9110_comunicazione_dipendente, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_tfr_mese [EXTRACTED 1.00]

## Communities (124 total, 11 thin omitted)

### Community 0 - "format.ts"
Cohesion: 0.12
Nodes (29): byYear(), FundTable(), MonthlyGainPanel(), Pct(), tone(), dynamic, FundsPage(), metadata (+21 more)

### Community 1 - "legacy.ts"
Cohesion: 0.10
Nodes (11): BalanceSnapshot, FundDeposit, fundDeposits, funds, fundSettings, JobRun, jobRuns, LeaveDay (+3 more)

### Community 2 - "cn"
Cohesion: 0.06
Nodes (49): HREF, OPTIONS, ViewKey, decimal(), PdfFrame(), toInput(), VerifyForm(), FRESH (+41 more)

### Community 3 - "use-cases.test.ts"
Cohesion: 0.15
Nodes (13): CreateManualAccountInput, createManualAccountSchema, DeleteAccountResult, UseCaseDeps, DeletionBlockedError, InvalidInputError, NotFoundError, VersionMismatchError (+5 more)

### Community 4 - "sweep.ts"
Cohesion: 0.16
Nodes (20): dynamic, GET(), dynamic, POST(), HEARTBEAT_MAX_AGE_MS, heartbeatAgeMs(), heartbeatPath(), isHeartbeatStale() (+12 more)

### Community 5 - "trek.ts"
Cohesion: 0.09
Nodes (43): UpstreamService, applyDesiredState(), ApplyDesiredStateInput, asRecord(), callTool(), CLIENT_INFO, config(), describe() (+35 more)

### Community 6 - "routes.ts"
Cohesion: 0.05
Nodes (59): accountDto(), balancePointDto(), commonErrorResponses, createAccountRoute, createGroupRoute, decodeCursor(), deleteAccountRoute, deleteGroupRoute (+51 more)

### Community 7 - "Finance & Company Platform — Design and Phased Plan"
Cohesion: 0.18
Nodes (11): 0. How to read this document, 12. Intentional breaking changes, 13. Questions worth answering (none block Phase 0–1), 1.1 What exists, 1.2 What to keep, change, retire, 1. Repository assessment, 2. Assumptions (stated instead of asked), 4. Navigation and page map (+3 more)

### Community 8 - "accounts/[id]/page.tsx"
Cohesion: 0.11
Nodes (29): BalanceHistoryRow, BalanceHistoryTable(), BalanceHistoryTableProps, BalancesPageResponse, AccountDetailPage(), dynamic, encodeCursor(), ArchivedAccountRow (+21 more)

### Community 9 - "parse.ts"
Cohesion: 0.11
Nodes (24): PAYSLIP_FIELDS, ORDINARY_MONTH_MARKERS, THIRTEENTH_KEYWORDS, median(), PayslipHistoryEntry, LlmOptions, allLowFields(), detectThirteenth() (+16 more)

### Community 10 - "contracts.ts"
Cohesion: 0.06
Nodes (43): SleepFn, REVOLUT_COMPONENT_KEYS, WALLET_ACCOUNTS, WALLET_EXPECTED_CURRENCY, WalletAccountConfig, accountSchema, accountsSchema, baseUrl() (+35 more)

### Community 11 - "compilerOptions"
Cohesion: 0.07
Nodes (29): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+21 more)

### Community 12 - "PageGrid.tsx"
Cohesion: 0.11
Nodes (14): LG_SPAN, LG_START, MD_SPAN, PageGrid(), PanelProps, Span, Skeleton(), SkeletonBlockProps (+6 more)

### Community 13 - "work/page.tsx"
Cohesion: 0.13
Nodes (24): LeaveCard(), LeaveByMonth(), FRACTION_OPTIONS, KIND_OPTIONS, LeaveCalendar(), varianceSentence(), OPTIONS, SalarySection() (+16 more)

### Community 14 - "actions/accounts.ts"
Cohesion: 0.14
Nodes (38): createAccountAction(), createGroupAction(), deleteAccountAction(), deleteGroupAction(), flag(), mapError(), recordBalanceAction(), renameGroupAction() (+30 more)

### Community 15 - "rules.ts"
Cohesion: 0.10
Nodes (33): Anchor, AUX_ANCHORS, AUX_FIELDS, COMPOSITE_FIELDS, FIELD_ANCHORS, GRID_HEADER_SYNONYMS, GridId, GRIDS (+25 more)

### Community 16 - "payslip-ingest.ts"
Cohesion: 0.09
Nodes (26): PaperlessDocument, PayslipExtraction, AcquiredText, acquireText(), ingestPayslipDocument(), IngestPayslipInput, IngestTrigger, IT_MONTHS (+18 more)

### Community 17 - "AccountGroup"
Cohesion: 0.21
Nodes (3): GroupsRepository, AccountGroup, MemoryGroupsRepository

### Community 18 - "_lib/funds.ts"
Cohesion: 0.22
Nodes (18): FundView, loadFund(), loadFunds(), EMPTY, initialCapitalOf(), loadPortfolioGain(), PortfolioGain, absoluteReturn() (+10 more)

### Community 19 - "monthKeyOf"
Cohesion: 0.11
Nodes (36): OverviewClient(), readUrl(), toSearch(), toSeries(), TotalBalanceCards(), currentValue(), effectiveSetting(), FundDepositRow (+28 more)

### Community 20 - "dependencies"
Cohesion: 0.07
Nodes (27): @base-ui-components/react, clsx, dependencies, @base-ui-components/react, clsx, drizzle-orm, hono, next (+19 more)

### Community 21 - "devDependencies"
Cohesion: 0.07
Nodes (27): devDependencies, drizzle-kit, @fontsource/ibm-plex-mono, @fontsource/ibm-plex-sans, msw, @playwright/test, tailwindcss, @tailwindcss/postcss (+19 more)

### Community 22 - "11. Phased implementation plan"
Cohesion: 0.18
Nodes (11): 11. Phased implementation plan, Phase 0 — Foundations (no visible product change), Phase 1 — Accounts and Teable retirement (first vertical slice), Phase 2 — Integration framework and Settings › Integrations, Phase 3 — Expenses and Interests, Phase 4 — Payroll upload pipeline and Company, Phase 5 — Funds expansion, Phase 6 — Budgets (+3 more)

### Community 23 - "Phase 2 — The integration framework"
Cohesion: 0.07
Nodes (27): File Structure, Global Constraints, Phase 2 — Deferred minors first, Phase 2: Integration framework, encrypted credentials and the Settings split, Phase 2 — The integration framework, Rulings, Self-review against the Phase 2 scope, Task 10: The sync engine (+19 more)

### Community 24 - "require-user.ts"
Cohesion: 0.29
Nodes (10): depositSchema, recordManualDeposit(), revalidateFund(), saveFundSettings(), settingsSchema, slugOf(), FundSettingsForm(), FundSettingsFormProps (+2 more)

### Community 25 - "MonthGrid.tsx"
Cohesion: 0.18
Nodes (15): dayNumber(), describeDay(), Dot(), DotKind, fractionOf(), isoOf(), MonthGrid(), MonthGridDayBase (+7 more)

### Community 26 - "queue.ts"
Cohesion: 0.25
Nodes (12): compare(), orderQueue(), placeInQueue(), QueueEntry, QueuePlacement, successorOf(), queue, verifyHref() (+4 more)

### Community 27 - "confidence.ts"
Cohesion: 0.11
Nodes (30): VerifyFormProps, FieldExtraction, PayslipField, SanityCheck, AuxField, GRID_DEPENDENT_FIELDS, BALANCE_TOLERANCE, checkNetAgainstMedian() (+22 more)

### Community 28 - "succeed"
Cohesion: 0.21
Nodes (19): daySchema, describe(), LEAVE_PATHS, noopSync(), removeLeaveDay(), removeSchema, revalidateLeave(), setLeaveDay() (+11 more)

### Community 29 - "trek-diff.ts"
Cohesion: 0.19
Nodes (16): Editing, LeaveDayDetail, LeaveFraction, LeaveKind, DesiredDay, TogglePlanStep, TrekEntry, differs() (+8 more)

### Community 30 - "llm.ts"
Cohesion: 0.13
Nodes (18): buildTool(), chatCompletionsUrl(), coerceMonth(), coerceNumber(), DEFAULT_BASE_URL, DEFAULT_MAX_CHARS, DEFAULT_TIMEOUT_MS, emptyResult() (+10 more)

### Community 31 - "Phase 1 — Accounts and Teable retirement"
Cohesion: 0.07
Nodes (27): File structure (what will exist after Phase 1), Global Constraints, Phase 0 — Foundations, Phase 0 + Phase 1: Foundations and Accounts Implementation Plan, Phase 1 — Accounts and Teable retirement, Self-review against the spec, Task 10: Capability resolver and capability-driven navigation, Task 11: Accounts schema with RLS (+19 more)

### Community 32 - "auth/principal.ts"
Cohesion: 0.12
Nodes (24): HomePage(), newAccount(), NOW, CardKey, cardState, HOME_CARDS, HomeCard, isCardVisible() (+16 more)

### Community 33 - "cometa.ts"
Cohesion: 0.27
Nodes (13): CometaCredit, cometaCreditedDeposits(), cometaSchedule(), creditedByMonth(), creditMonthFor(), JOINING_FEE, quarterIndex(), quarterKey() (+5 more)

### Community 34 - "fromCents"
Cohesion: 0.16
Nodes (22): VacationFundPage(), MonthlyAccrual, MonthlyReturnInput, centsFromDecimal(), fromCents(), MoneyInput, roundEur(), sumCents() (+14 more)

### Community 35 - "validate-teable-migration.ts"
Cohesion: 0.13
Nodes (14): APP_MANAGED_KEYS, argv, BlankMonthRow, centsByMonth(), db, differenceLabel(), HAND_TRACKED_KEYS, LEGACY_KEYS (+6 more)

### Community 36 - "http.ts"
Cohesion: 0.09
Nodes (32): backoffDelay(), HttpError, httpRequest(), HttpRequestInit, isRetryable(), isRetryableStatus(), parseRetryAfter(), readBody() (+24 more)

### Community 37 - "toCents"
Cohesion: 0.22
Nodes (14): legacySeriesFromSnapshots(), toCents(), contributingKeys(), missingKeys(), netWorth, NetWorthContributor, NetWorthOptions, observe() (+6 more)

### Community 38 - "ports.ts"
Cohesion: 0.06
Nodes (16): AccountPatch, AccountsRepository, NewAccount, NewBalance, ProviderLink, ProviderLinksRepository, Account, BalanceSource (+8 more)

### Community 39 - "trek.test.ts"
Cohesion: 0.17
Nodes (14): resetTrekAuthCache(), callsTo(), entriesPayload(), fetchMock, LIVE_STATS, Rpc, rpcOf(), rpcs() (+6 more)

### Community 40 - "verify/[id]/page.tsx"
Cohesion: 0.22
Nodes (12): extractionOf(), VerifiableField, VerifyField, dynamic, FIELD_META, FieldMeta, inputValue(), metadata (+4 more)

### Community 41 - "5. Data model"
Cohesion: 0.18
Nodes (11): 5.10 Indexes (access-pattern driven), 5.1 Identity and access, 5.2 Integrations, 5.3 Accounts, 5.4 Transactions (Expenses), 5.5 Funds, 5.6 Budgets, 5.7 Interests (+3 more)

### Community 42 - "trek-sync.test.ts"
Cohesion: 0.20
Nodes (6): ApplyDesiredStateResult, jobs, repo, state, STATS, trek

### Community 43 - "AccountForm.tsx"
Cohesion: 0.12
Nodes (18): AccountDetailActions(), AccountDetailActionsProps, ErrorInline(), ErrorInlineProps, SheetForm(), SheetFormStep, AccountOrigin, AccountForm() (+10 more)

### Community 44 - "portfolio.ts"
Cohesion: 0.29
Nodes (8): monthlyReturn, combinedGain, fundGain(), FundSeries, PerFundGain, cometa, fideuram, valueMapCents()

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
Nodes (45): DEFAULT_HOURS_PER_DAY, extractedField(), FerieView, hoursPerDay(), loadFerie(), LeaveByMonthProps, LeaveCalendarProps, LeaveCalendarView (+37 more)

### Community 49 - "actions/vacation.ts"
Cohesion: 0.16
Nodes (21): parseMoney(), initialSchema, rateSchema, recordWithdrawal(), revalidateVacation(), setAccrualRate(), setInitialValue(), undoWithdrawal() (+13 more)

### Community 50 - "render-brand-icons.py"
Cohesion: 0.33
Nodes (3): Rasterise the Finance Dashboard mark to PNG. No rasteriser is installed on this…, radius=0 renders a full-bleed square (maskable); otherwise a rounded square., render()

### Community 51 - "schema/index.ts"
Cohesion: 0.20
Nodes (16): accounts, auditEvents, organizations, roles, userIdentities, userRoles, users, asLinkUser() (+8 more)

### Community 52 - "teable-import.ts"
Cohesion: 0.17
Nodes (13): centsToString(), DEFAULT_BY_KEY, DEFAULTS, DERIVED_KEYS, EXPORTED_NUMBER_COLUMNS, pivotExportedRecords(), PlannedAccount, PlannedBalance (+5 more)

### Community 53 - "sync-provider-accounts.ts"
Cohesion: 0.29
Nodes (8): AccountsSource, balanceRow(), nextStatus(), patch(), sameName(), syncProviderAccounts(), SyncProviderAccountsDeps, SyncProviderAccountsResult

### Community 54 - "actions/payslips.ts"
Cohesion: 0.24
Nodes (13): confirmPayslip(), extractedValue(), extractionOf(), nullableMoney, PendingEntry, pendingQueue(), rejectPayslip(), revalidatePayslips() (+5 more)

### Community 56 - "machine.ts"
Cohesion: 0.15
Nodes (18): asDocId(), dynamic, extractDocId(), ID_KEYS, POST(), Bucket, buckets, constantTimeEqual() (+10 more)

### Community 57 - "OverviewClient.tsx"
Cohesion: 0.19
Nodes (12): DEFAULT_STATE, OverviewAccount, OverviewClientProps, PRESET, RANGE_KEYS, ViewState, AccountRowProps, DeltaBadgeProps (+4 more)

### Community 58 - "Mod. Cedolino TS Layout"
Cohesion: 0.22
Nodes (10): Code 1150 - RATA ADD.REG. A.P., Real Payslip Fixture: Marzo 2026 (doc 96), ADDIZIONALE REGIONALE, Fixture Anonymisation Convention, Employer Header Block (Ditta / ACME Consulting srl), TeamSystem August 2026 Fixture (synthetic-anonymised), IBAN / Bank Accredito Trailer Line, Q/INPS - INAIL Statistical Block (+2 more)

### Community 59 - "middleware.ts"
Cohesion: 0.24
Nodes (11): config, contentSecurityPolicy(), frameAncestorsFor(), hasSessionCookie(), isPublic(), middleware(), PUBLIC_PATHS, PUBLIC_PREFIXES (+3 more)

### Community 61 - "scripts"
Cohesion: 0.11
Nodes (18): scripts, build, db:generate, db:migrate, dev, e2e, lint, migrate:teable (+10 more)

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

### Community 66 - "staleness.ts"
Cohesion: 0.29
Nodes (9): asDate(), classify(), isStale(), snapshotGrace, StalenessInfo, StalenessSource, NOW, DISPLAY_STALENESS_MS (+1 more)

### Community 67 - "trek-sync.ts"
Cohesion: 0.13
Nodes (18): LeaveDaySaved, auth, cache, DAY, repo, sync, trek, TrekCallOptions (+10 more)

### Community 68 - "probes.ts"
Cohesion: 0.22
Nodes (8): AppLayout(), trekConfig, buildNavigation(), countIsNonZero(), dataProbes(), realProbes, CapabilityProbes, resolveCapabilities()

### Community 69 - "dashboard-app service"
Cohesion: 0.38
Nodes (7): dashboard-app service, dashboard-cron supercronic sidecar service, External networks proxy_public and db_internal, projects compose stack, read_only rootfs, cap_drop ALL, tmpfs and limits, Read-only secret file mounts (wallet-token, trek-token), Traefik router with X-Forwarded-Proto https middleware

### Community 70 - "llm-config.ts"
Cohesion: 0.16
Nodes (14): appSettings, asString(), BaseUrlCheck, ConfigSource, Layers, llmConfigStatus, llmOptionsFromConfig(), LlmResolvedConfig (+6 more)

### Community 71 - "7. Domain designs (what each section computes)"
Cohesion: 0.20
Nodes (10): 7.1 Home, 7.2 Finance Overview, 7.3 Accounts, 7.4 Funds, 7.5 Budgets, 7.6 Interests (reuse / change / deprecate from `interest.py`), 7.7 Expenses, 7.8 Company (+2 more)

### Community 72 - "August 2026 PDF-Text Fixture (clean layout)"
Cohesion: 0.28
Nodes (9): Code 001 - RETRIBUZIONE ORDINARIA, August 2026 PDF-Text Fixture (clean layout), TOTALE RITENUTE, Code 2 - LAVORO ORDIN.(mens.), Code 1101 - IRPEF A CREDITO -MOD.730-, Code 9208 - CREDITO COMPENSATO, Real Payslip Fixture: Luglio 2026 (doc 104, 730 refund), ARROTONDAMENTO (+1 more)

### Community 73 - "repo/leave.ts"
Cohesion: 0.18
Nodes (18): isTrekNotConfigured(), empty(), syncPass(), clearPending(), dayAt(), daysInRange(), daysInYear(), deleteDates() (+10 more)

### Community 74 - "10. Migration strategy"
Cohesion: 0.40
Nodes (5): 10.1 Teable → PostgreSQL, 10.2 Paperless → payroll silo, 10.3 Single user → users table, 10.4 Deployment, 10. Migration strategy

### Community 75 - "env"
Cohesion: 0.06
Nodes (45): runtime, app, DELETE, dynamic, GET, PATCH, POST, PUT (+37 more)

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

### Community 87 - "wallet-adapter.ts"
Cohesion: 0.29
Nodes (7): WalletAccount, ProviderAccount, accountType(), mapWalletAccount(), TYPE_BY_ACCOUNT_TYPE, updatedAt(), WALLET_PROVIDER

### Community 89 - "(app)/page.tsx"
Cohesion: 0.12
Nodes (19): dynamic, FundsCard(), metadata, totalFundValue(), ChartTokens, compactValue(), HoverState, monthKey() (+11 more)

### Community 90 - "app.ts"
Cohesion: 0.11
Nodes (18): buildOpenApiDocument(), seed(), ApiDeps, ApiEnv, Authenticated, AuthMethod, createApiApp(), registerAllRoutes() (+10 more)

### Community 92 - "list-accounts.ts"
Cohesion: 0.22
Nodes (19): generateMetadata(), MonthPoint, AccountDetail, getAccountDetail(), AccountListItem, DEFAULT_TREND_MONTHS, isStale(), listAccounts() (+11 more)

### Community 93 - "Checkpoint: Phase 0 + Phase 1 complete (2026-09-03)"
Cohesion: 0.25
Nodes (7): Before Phase 2, Checkpoint: Phase 0 + Phase 1 complete (2026-09-03), Decisions already taken (summary; full text in the ledger), Deployment status (2026-09-03, later the same day), Documents, How to continue, State

### Community 94 - "Code 9837 - IMPONIBILE 5% L.199/25"
Cohesion: 0.50
Nodes (4): Code 9837 - IMPONIBILE 5% L.199/25, Code 9838 - IMPOSTA SOST. 5% L.199/25, Real Payslip Fixture: Giugno 2026 (doc 103), PAGA BASE / PREMIO PR. / SUPERM.ASS Row

### Community 95 - "settings/page.tsx"
Cohesion: 0.07
Nodes (45): dynamic, metadata, BudgetsPage(), dynamic, metadata, FinanceTabs(), OverviewSource, dynamic (+37 more)

### Community 96 - "SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md"
Cohesion: 0.50
Nodes (3): Pre-flight scan (2026-09-02), Progress, SDD ledger — plan: docs/superpowers/plans/2026-09-02-phase-0-1-foundations-and-accounts.md

### Community 97 - "wallet-accounts-sync.ts"
Cohesion: 0.13
Nodes (25): dynamic, alertJobFailure(), errorMessage(), db, instance(), pool(), schema, walletToken() (+17 more)

### Community 109 - "trek-sync-job.ts"
Cohesion: 0.11
Nodes (23): dynamic, POST(), TIERS, dynamic, POST(), dynamic, POST(), verifyCronSecret() (+15 more)

### Community 110 - "SettingsForms.tsx"
Cohesion: 0.16
Nodes (16): clearLlmApiKey(), completeFirstRun(), hoursSchema, llmSchema, setHoursPerDay(), setLlmSettings(), HoursPerDayForm(), KEY_STATUS (+8 more)

### Community 111 - "run.ts"
Cohesion: 0.42
Nodes (4): accountDeps(), setAccountDepsFactoryForTests(), setPrincipalForTests(), recordAudit()

### Community 112 - "_lib/leave.test.ts"
Cohesion: 0.25
Nodes (5): payroll, payslips, repo, trekState, vacation

### Community 113 - "DbClient"
Cohesion: 0.08
Nodes (16): bootstrapOwner(), DbClient, db, pool, AccountBalanceRow, accountBalances, AccountGroupRow, accountGroups (+8 more)

### Community 117 - "Teable migration"
Cohesion: 0.29
Nodes (6): Files in this directory, `npm run migrate:teable`, `npm run migrate:teable:validate`, Order of operations, Running against the deployed container, Teable migration

### Community 121 - "Phase 1 deployment runbook — accounts and Teable retirement"
Cohesion: 0.18
Nodes (11): Cleanup after a successful deploy, Phase 1 deployment runbook — accounts and Teable retirement, Pre-checks, Rollback, Step 1 — build the new image, Step 2 — apply migrations 0004–0006 only, Step 3 — import the legacy history, Step 4 — validate (+3 more)

### Community 123 - "Finance Dashboard API"
Cohesion: 0.20
Nodes (10): Authentication, Endpoints (Phase 1), Error envelope, Finance Dashboard API, `Idempotency-Key`, Optimistic concurrency (`If-Match` / `version`), Pagination, Regenerating `openapi.json` (+2 more)

### Community 125 - "Architecture overview — Phase 0 + Phase 1"
Cohesion: 0.22
Nodes (9): API conventions, Architecture overview — Phase 0 + Phase 1, Capability-driven navigation and Home, Job tiers, Known deviations, Module layout, RLS context and the `system` role, The use-case rule (+1 more)

### Community 126 - "Finance Dashboard"
Cohesion: 0.29
Nodes (7): Developing, Documentation, Finance Dashboard, Running it, Stack, Status: Phase 0 + Phase 1 complete, Testing

## Knowledge Gaps
- **687 isolated node(s):** `entrypoint.sh script`, `securityHeaders`, `nextConfig`, `name`, `version` (+682 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **11 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `cn` to `format.ts`, `(app)/page.tsx`, `accounts/[id]/page.tsx`, `env`, `PageGrid.tsx`, `work/page.tsx`, `actions/accounts.ts`, `AccountForm.tsx`, `payroll.ts`, `SettingsForms.tsx`, `monthKeyOf`, `require-user.ts`, `OverviewClient.tsx`, `MonthGrid.tsx`, `settings/page.tsx`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `env` connect `env` to `wallet-accounts-sync.ts`, `http.ts`, `probes.ts`, `llm-config.ts`, `contracts.ts`, `trek-sync-job.ts`, `gotify.ts`, `machine.ts`, `require-user.ts`, `llm.ts`, `settings/page.tsx`?**
  _High betweenness centrality (0.014) - this node is a cross-community bridge._
- **Why does `MemoryClock` connect `ports.ts` to `auth/principal.ts`, `sync-provider-accounts.test.ts`, `use-cases.test.ts`, `run.ts`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `registerAccountRoutes()` (e.g. with `groupDto()` and `monthPointDto()`) actually correct?**
  _`registerAccountRoutes()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `entrypoint.sh script`, `securityHeaders`, `nextConfig` to the rest of the system?**
  _687 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `format.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11596638655462185 - nodes in this community are weakly interconnected._
- **Should `legacy.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09956709956709957 - nodes in this community are weakly interconnected._
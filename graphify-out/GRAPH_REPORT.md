# Graph Report - personal-dashboard  (2026-09-01)

## Corpus Check
- 217 files · ~145,531 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1672 nodes · 4220 edges · 107 communities (94 shown, 13 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 77 edges (avg confidence: 0.83)
- Token cost: 328,031 input · 0 output

## Community Hubs (Navigation)
- Vacation & Leave Views
- Webhook & Sweep Routes
- Teable Allocation Client
- Finance Tabs & Preview
- Money & Payroll Math
- Trek RPC Client
- Fund Return Calculation
- Fund Gain UI Panels
- Jobs & Settings Actions
- Payslip Field Parsing
- Wallet API Client
- TypeScript Compiler Config
- Loading Skeleton Screens
- Funds Page Screenshot
- Monthly Snapshot Job
- Payslip Anchor Definitions
- Payslip Ingest Job
- Vacation Fund Ledger
- Sparkline & Row Components
- Finance Overview Client
- Runtime Dependencies
- Dev Dependencies
- Cron Routes & Machine Auth
- Fund Detail Page
- HTTP Retry Client
- Leave Calendar Grid
- Authentik OIDC Auth
- Extraction Confidence Scoring
- Payslip Rules Engine
- Trek Leave Diffing
- LLM Extraction Pass
- Vacation Server Actions
- App Shell & Navigation
- LLM Config Resolution
- Paperless-ngx Client
- Trek Sync Orchestration
- Wallet Refresh Job
- Net Worth Aggregation
- Staleness Classification
- Trek Client Tests
- Balance Snapshot Repository
- Settings Page Sections
- Home Page Cards
- Gotify Alerting
- Drizzle Database Schema
- Leave Day Repository
- TeamSystem Grid Extraction
- Trek Sync Job
- Cometa Quarterly Credits
- Job Run API Routes
- Payslip Confirm Actions
- Sweep Job Tests
- Fund Settings Form
- Leave Server Actions
- Metrics & DB Pool
- Fund Return Data Model
- Health & Heartbeat
- Time Series Chart
- TeamSystem Payslip Layout
- CSP Middleware
- Auth Defects & Decisions
- NPM Scripts
- OCR Defect Fixtures
- Testing & Hardening Posture
- Wallet & Balance Caching
- Root Layout & Fonts
- Trek Sync Tests
- Fund Repository
- Scheduled Job Reliability
- Deployment Stack Topology
- Error Boundary Components
- Sign-In Page
- Gross Pay Line Codes
- Exposure & Observability
- Leave Action Tests
- Settings Action Tests
- Leave Lib Tests
- TFR & Contribution Codes
- Pension Fund Codes
- Tax Deduction Codes
- IRPEF Tax Bases
- Welfare & Gross Totals
- Tredicesima Codes
- Ferie & Permessi Codes
- Boot & Migration Sequence
- Payroll Parsing Pipeline
- Package Manifest
- Design Directions
- Next.js Config
- Migration Runner
- Environment Schema
- Container Entrypoint
- Next.js Type Shim
- Zod Dependency
- Playwright Dependency
- React Types Dependency
- Vitest Dependency
- NextAuth Route Handler
- Auth Route Exports
- Municipal Surtax Line

## God Nodes (most connected - your core abstractions)
1. `cn()` - 72 edges
2. `monthKeyOf()` - 46 edges
3. `toCents()` - 43 edges
4. `fromCents()` - 35 edges
5. `env` - 35 edges
6. `requireUser()` - 31 edges
7. `monthKey()` - 31 edges
8. `succeed()` - 26 edges
9. `formatEur()` - 26 edges
10. `httpRequest()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `Hourly sweep as webhook fallback` --semantically_similar_to--> `Idempotency, advisory lock and 3-day grace catch-up`  [INFERRED] [semantically similar]
  DEPLOY.md → PLAN.md
- `Wallet token hot rotation via file bind mount` --semantically_similar_to--> `X-Cron-Secret / X-Webhook-Secret machine endpoints`  [INFERRED] [semantically similar]
  DEPLOY.md → PLAN.md
- `dashboard-app service` --conceptually_related_to--> `Lazy DB Proxy — never read env at module scope`  [INFERRED]
  docker-compose.yml → DEPLOY.md
- `Balance cache keyed per column, not per newest row` --semantically_similar_to--> `Strict phase ordering — never write a partial row`  [INFERRED] [semantically similar]
  DEPLOY.md → PLAN.md
- `dashboard-app service` --conceptually_related_to--> `Container and CSP hardening posture`  [AMBIGUOUS]
  docker-compose.yml → PLAN.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Three-layer single-user auth enforcement** — plan_single_user_enforcement, deploy_authentik_provider_dashboard, deploy_sub_mode_user_uuid, plan_require_user_helper, deploy_middleware_cookie_prefix_match, plan_authjs_oidc [EXTRACTED 1.00]
- **Monthly snapshot job pipeline** — plan_scheduled_jobs, plan_strict_phase_ordering, plan_idempotency_catchup, plan_monthly_snapshots_table, plan_wallet_integration, plan_teable_integration, plan_job_runs_table [EXTRACTED 1.00]
- **Payslip ingest-to-verified pipeline** — deploy_paperless_webhook_workflow, deploy_hourly_sweep_fallback, plan_payroll_parsing_pipeline, plan_hybrid_extraction, deploy_payslip_month_from_title, plan_verification_screen, plan_payslips_table [EXTRACTED 1.00]
- **Leave-Hours Accounting Pattern (offsetting pair + residual grid)** — dashboard_app_src_lib_payroll___fixtures___real_ago2026_300_assenza_x_ferie_ac, dashboard_app_src_lib_payroll___fixtures___real_ago2026_301_ferie_ac, dashboard_app_src_lib_payroll___fixtures___real_d15_308_assenza_x_perm_ac, dashboard_app_src_lib_payroll___fixtures___real_d15_309_permessi_ac, dashboard_app_src_lib_payroll___fixtures___august_2026_pdf_leave_residuals_grid, dashboard_app_src_lib_payroll___fixtures___august_2026_ocr_flattened_residuals_defect [EXTRACTED 1.00]
- **TFR / Complementary Pension Contribution Block** — dashboard_app_src_lib_payroll___fixtures___real_ago2026_7101_fondo_c_dipe, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9109_fondo_c_azienda, dashboard_app_src_lib_payroll___fixtures___real_ago2026_8003_contribuzione_tfr, dashboard_app_src_lib_payroll___fixtures___real_ago2026_7897_esonero_ctr_tfr_prev_c, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9110_comunicazione_dipendente, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_tfr_mese [EXTRACTED 1.00]
- **IRPEF Settlement Chain (gross to net)** — dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_imponibile_irpef, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_irpef_lorda, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_totale_detrazioni, dashboard_app_src_lib_payroll___fixtures___real_ago2026_9424_ulteriore_detrazione_mese, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_totale_trattenute_irpef, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_irpef_erario, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_addizionale_regionale, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_addizionale_comunale, dashboard_app_src_lib_payroll___fixtures___teamsystem_august_2026_netto_busta [EXTRACTED 1.00]
- **Fund Performance Reporting Pattern (cards + methodology + table + footnote)** — image_fideuram_fund_card, image_fondo_cometa_fund_card, image_monthly_return_table, image_gain_calculation_methodology, image_cometa_cost_footnote [INFERRED 0.95]
- **Contribution-Adjusted Return Model (paid in vs value vs true gain)** — image_paid_in_column, image_deposited_amount, image_total_column_dual_metric, image_gain_calculation_methodology, image_since_mar_2026_summary_row [INFERRED 0.85]
- **Dashboard Visual System (light minimal shell, mono numerics, semantic color, theme toggle)** — image_minimal_light_design_language, image_monospace_numeric_typography, image_green_red_semantic_coloring, image_theme_toggle_controls, image_sidebar_navigation [INFERRED 0.85]

## Communities (107 total, 13 thin omitted)

### Community 0 - "Vacation & Leave Views"
Cohesion: 0.05
Nodes (65): extractedField(), extractionOf(), FerieView, hoursPerDay(), loadFerie(), LeaveByMonthProps, OPTIONS, SalarySection() (+57 more)

### Community 1 - "Webhook & Sweep Routes"
Cohesion: 0.09
Nodes (40): asDocId(), dynamic, extractDocId(), ID_KEYS, POST(), dynamic, POST(), TeablePoint (+32 more)

### Community 2 - "Teable Allocation Client"
Cohesion: 0.09
Nodes (38): AllocationRowInput, AllocationWriteAction, assertFieldsExist(), assertWritable(), clearFieldMapCache(), createAllocationRow(), deleteAllocationField(), fieldListSchema (+30 more)

### Community 3 - "Finance Tabs & Preview"
Cohesion: 0.07
Nodes (31): FinanceTabs(), HREF, OPTIONS, ViewKey, FRESH, FUND, MONTHS, NOW (+23 more)

### Community 4 - "Money & Payroll Math"
Cohesion: 0.12
Nodes (31): absoluteReturn(), monthlyReturn, centsFromDecimal(), fromCents(), roundEur(), toCents(), annualTotals, averageNet() (+23 more)

### Community 5 - "Trek RPC Client"
Cohesion: 0.10
Nodes (34): ApplyDesiredStateInput, asRecord(), callTool(), CLIENT_INFO, describe(), ensureSession(), entryListSchema, entrySchema (+26 more)

### Community 6 - "Fund Return Calculation"
Cohesion: 0.14
Nodes (30): currentValue(), FundSettingRow, initialCapitalCents(), MonthlyReturnInput, ReturnRow, returnTable(), deposits, settings (+22 more)

### Community 7 - "Fund Gain UI Panels"
Cohesion: 0.11
Nodes (29): FundTable(), MonthlyGainPanel(), Pct(), tone(), dynamic, metadata, DeltaBadge(), Tone (+21 more)

### Community 8 - "Jobs & Settings Actions"
Cohesion: 0.14
Nodes (29): clearPoisonedSnapshot(), monthSchema, revalidateJobs(), runSnapshotNow(), syncLeaveNow(), clearLlmApiKey(), completeFirstRun(), deleteAccount() (+21 more)

### Community 9 - "Payslip Field Parsing"
Cohesion: 0.10
Nodes (27): PAYSLIP_FIELDS, AcquiredText, ORDINARY_MONTH_MARKERS, THIRTEENTH_KEYWORDS, median(), PayslipHistoryEntry, LlmOptions, LlmPassResult (+19 more)

### Community 10 - "Wallet API Client"
Cohesion: 0.10
Nodes (24): SleepFn, REVOLUT_COMPONENT_KEYS, WALLET_ACCOUNTS, WALLET_EXPECTED_CURRENCY, WalletAccountConfig, accountSchema, accountsSchema, baseUrl() (+16 more)

### Community 11 - "TypeScript Compiler Config"
Cohesion: 0.07
Nodes (29): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+21 more)

### Community 12 - "Loading Skeleton Screens"
Cohesion: 0.13
Nodes (8): Skeleton(), SkeletonBlockProps, SkeletonChart(), SkeletonHero(), SkeletonProps, SkeletonRows(), SkeletonText(), SkeletonTile()

### Community 13 - "Funds Page Screenshot"
Cohesion: 0.12
Nodes (29): As-of Timestamp (01/09, 20:07), Cometa Cost Footnote (22,32 EUR costs, not counted as loss), Cometa Quarterly Payment and Month-Lag Rule, Deposited Amount Reference (5000,00 EUR / 2173,74 EUR), Fideuram Fund Card (5174,54 EUR), Finance Section (active sidebar item), Finance Tab Bar (Overview / Funds / Vacation fund), Fondo Cometa Fund Card (2228,13 EUR) (+21 more)

### Community 14 - "Monthly Snapshot Job"
Cohesion: 0.10
Nodes (24): AllocationWriteResult, JobResult, execute(), IN_ROUTE_ATTEMPTS, JOB_NAME, MAX_ATTEMPTS, Outcome, Phase3Input (+16 more)

### Community 15 - "Payslip Anchor Definitions"
Cohesion: 0.13
Nodes (25): PayslipField, Anchor, AUX_ANCHORS, AUX_FIELDS, AuxField, COMPOSITE_FIELDS, FIELD_ANCHORS, GRID_HEADER_SYNONYMS (+17 more)

### Community 16 - "Payslip Ingest Job"
Cohesion: 0.14
Nodes (23): errorMessage(), downloadOriginal(), getDocument(), acquireText(), ingestPayslipDocument(), IngestPayslipInput, IngestTrigger, IT_MONTHS (+15 more)

### Community 17 - "Vacation Fund Ledger"
Cohesion: 0.16
Nodes (22): DATE_LINE, dynamic, ENTRY_LABEL, metadata, VacationFundPage(), effectiveSetting(), sumCents(), AccrualRateRow (+14 more)

### Community 18 - "Sparkline & Row Components"
Cohesion: 0.13
Nodes (19): Sparkline(), SparklineProps, SparkTone, TONE_CLASS, AccountRow(), AccountRowProps, Body(), cn() (+11 more)

### Community 19 - "Finance Overview Client"
Cohesion: 0.13
Nodes (21): OverviewAccount, OverviewClient(), OverviewClientProps, PRESET, toSeries(), dynamic, FinanceOverviewPage(), metadata (+13 more)

### Community 20 - "Runtime Dependencies"
Cohesion: 0.09
Nodes (23): @base-ui-components/react, clsx, dependencies, @base-ui-components/react, clsx, drizzle-orm, next, next-auth (+15 more)

### Community 21 - "Dev Dependencies"
Cohesion: 0.09
Nodes (23): devDependencies, drizzle-kit, @fontsource/ibm-plex-mono, @fontsource/ibm-plex-sans, msw, tailwindcss, @tailwindcss/postcss, tsx (+15 more)

### Community 22 - "Cron Routes & Machine Auth"
Cohesion: 0.15
Nodes (18): dynamic, POST(), dynamic, POST(), Bucket, buckets, constantTimeEqual(), CRON_SECRET_HEADER (+10 more)

### Community 23 - "Fund Detail Page"
Cohesion: 0.17
Nodes (19): cellTone(), dynamic, FundDetailPage(), FundView, loadFund(), loadFunds(), EMPTY, initialCapitalOf() (+11 more)

### Community 24 - "HTTP Retry Client"
Cohesion: 0.15
Nodes (16): backoffDelay(), HttpError, httpRequest(), HttpRequestInit, isRetryable(), isRetryableStatus(), parseRetryAfter(), readBody() (+8 more)

### Community 25 - "Leave Calendar Grid"
Cohesion: 0.13
Nodes (19): Editing, FRACTION_OPTIONS, KIND_OPTIONS, LeaveCalendarProps, LeaveCalendarView, dayNumber(), describeDay(), Dot() (+11 more)

### Community 26 - "Authentik OIDC Auth"
Cohesion: 0.22
Nodes (20): asNumber(), asString(), authentikProvider(), buildConfig(), discoverOidc(), fetchDiscovery(), { handlers, auth, signIn, signOut }, logAuthEvent() (+12 more)

### Community 27 - "Extraction Confidence Scoring"
Cohesion: 0.14
Nodes (21): FieldExtraction, GRID_DEPENDENT_FIELDS, BALANCE_TOLERANCE, checkNetAgainstMedian(), checkNettoBalance(), checkResidualContinuity(), combineField(), crossValidate() (+13 more)

### Community 28 - "Payslip Rules Engine"
Cohesion: 0.14
Nodes (19): detectPeriodMonth(), errorMessage(), findLabel(), numbersOnLine(), pick(), readGrid(), resolveAnchor(), resolveField() (+11 more)

### Community 29 - "Trek Leave Diffing"
Cohesion: 0.19
Nodes (16): LeaveDayDetail, LeaveFraction, LeaveKind, DesiredDay, TogglePlanStep, TrekEntry, differs(), plannedDaysByMonth() (+8 more)

### Community 30 - "LLM Extraction Pass"
Cohesion: 0.15
Nodes (16): buildTool(), chatCompletionsUrl(), coerceMonth(), coerceNumber(), DEFAULT_MAX_CHARS, DEFAULT_TIMEOUT_MS, emptyResult(), errorName() (+8 more)

### Community 31 - "Vacation Server Actions"
Cohesion: 0.18
Nodes (16): ActionFailure, ActionSuccess, parseMoney(), initialSchema, rateSchema, recordWithdrawal(), revalidateVacation(), setAccrualRate() (+8 more)

### Community 32 - "App Shell & Navigation"
Cohesion: 0.13
Nodes (15): FundsPage(), AppLayout(), AppShell(), AppShellProps, IconProps, isActive(), TABS, apply() (+7 more)

### Community 33 - "LLM Config Resolution"
Cohesion: 0.14
Nodes (16): appSettings, asString(), BaseUrlCheck, checkBaseUrl(), ConfigSource, isPrivateHost(), Layers, llmConfigStatus (+8 more)

### Community 34 - "Paperless-ngx Client"
Cohesion: 0.16
Nodes (14): baseUrl(), clearPayslipTagIdCache(), documentSchema, DownloadedDocument, headers(), listPayslipDocuments(), ListPayslipOptions, pageSchema (+6 more)

### Community 35 - "Trek Sync Orchestration"
Cohesion: 0.20
Nodes (17): applyDesiredState(), config(), getEntries(), getStats(), isTrekNotConfigured(), parseOrThrow(), retryPolicy(), TrekYearStats (+9 more)

### Community 36 - "Wallet Refresh Job"
Cohesion: 0.18
Nodes (15): dynamic, POST(), getBalances(), JOB_NAME, LOCK_KEY, refresh(), runWalletRefresh(), RunWalletRefreshInput (+7 more)

### Community 37 - "Net Worth Aggregation"
Cohesion: 0.22
Nodes (13): contributingKeys(), missingKeys(), netWorth, NetWorthContributor, NetWorthOptions, observe(), Observed, oldestCapture() (+5 more)

### Community 38 - "Staleness Classification"
Cohesion: 0.18
Nodes (14): asDate(), classify(), isStale(), snapshotGrace, StalenessInfo, StalenessSource, NOW, ACCOUNT_KEYS (+6 more)

### Community 39 - "Trek Client Tests"
Cohesion: 0.16
Nodes (15): planToggles(), resetTrekAuthCache(), callsTo(), entriesPayload(), fetchMock, LIVE_STATS, Rpc, rpcOf() (+7 more)

### Community 40 - "Balance Snapshot Repository"
Cohesion: 0.15
Nodes (11): balances, NOW, repo, SourceKind, balanceSnapshots, latestBalance, monthlyHistoryQuery(), MonthlyRow (+3 more)

### Community 41 - "Settings Page Sections"
Cohesion: 0.15
Nodes (14): DEFAULT_HOURS_PER_DAY, dynamic, JOB_LABEL, JOBS, metadata, RUN_TIME, SettingsPage(), STATUS_TONE (+6 more)

### Community 42 - "Home Page Cards"
Cohesion: 0.21
Nodes (12): dynamic, HomePage(), metadata, spark(), LeaveByMonth(), varianceSentence(), Gallery(), EmptyState() (+4 more)

### Community 43 - "Gotify Alerting"
Cohesion: 0.17
Nodes (14): alertJobFailure(), alertPayslipPending(), alertSuccessAfterRetry(), appUrl(), GotifyMessage, JobFailureAlert, notify(), PayslipPendingAlert (+6 more)

### Community 44 - "Drizzle Database Schema"
Cohesion: 0.13
Nodes (9): BalanceSnapshot, FundDeposit, JobRun, LeaveDay, MonthlySnapshot, vacationAccrualRate, VacationEntry, vacationLedger (+1 more)

### Community 45 - "Leave Day Repository"
Cohesion: 0.18
Nodes (13): leaveDays, dayAt(), daysInRange(), daysInYear(), fractionString(), LeaveOrigin, pendingDays(), PendingOp (+5 more)

### Community 46 - "TeamSystem Grid Extraction"
Cohesion: 0.23
Nodes (15): parseItalianNumber(), bodyRow(), EMPTY, extractTeamSystem(), findGrid(), isNumericOnly(), numbersOf(), plausibleHours() (+7 more)

### Community 47 - "Trek Sync Job"
Cohesion: 0.22
Nodes (13): LeaveDaySaved, TrekCallOptions, trekConfigured(), trekConfig, JOB_NAME, runTrekSyncJob(), RunTrekSyncJobInput, summarize() (+5 more)

### Community 48 - "Cometa Quarterly Credits"
Cohesion: 0.24
Nodes (14): CometaCredit, cometaCreditedDeposits(), cometaSchedule(), creditedByMonth(), creditMonthFor(), JOINING_FEE, MonthlyAccrual, quarterIndex() (+6 more)

### Community 49 - "Job Run API Routes"
Cohesion: 0.25
Nodes (11): bodySchema, dynamic, POST(), dynamic, GET(), INLINE_TYPES, AuthedUser, isUnauthorizedError() (+3 more)

### Community 50 - "Payslip Confirm Actions"
Cohesion: 0.24
Nodes (13): confirmPayslip(), extractedValue(), extractionOf(), nullableMoney, PendingEntry, pendingQueue(), rejectPayslip(), revalidatePayslips() (+5 more)

### Community 51 - "Sweep Job Tests"
Cohesion: 0.19
Nodes (10): BALANCES, cache, historyRows(), latestRows(), RunRow, SnapshotRow, store, teableRows() (+2 more)

### Community 52 - "Fund Settings Form"
Cohesion: 0.27
Nodes (10): depositSchema, recordManualDeposit(), revalidateFund(), saveFundSettings(), settingsSchema, slugOf(), FundSettingsForm(), FundSettingsFormProps (+2 more)

### Community 53 - "Leave Server Actions"
Cohesion: 0.29
Nodes (12): daySchema, describe(), LEAVE_PATHS, noopSync(), removeLeaveDay(), removeSchema, revalidateLeave(), setLeaveDay() (+4 more)

### Community 54 - "Metrics & DB Pool"
Cohesion: 0.19
Nodes (9): dynamic, db, instance(), pool(), trackedAccounts, get(), list(), remove() (+1 more)

### Community 55 - "Fund Return Data Model"
Cohesion: 0.21
Nodes (13): baselineMonth() — scoring starts after first credit, Cometa quarterly contribution lag, Fund return computation model, Payslip month derived from Paperless title, A recorded value describes the month before it, Computation model — deposits, returns, ferie, fund_deposits table, fund_settings effective-dated config (+5 more)

### Community 56 - "Health & Heartbeat"
Cohesion: 0.41
Nodes (9): dynamic, GET(), HEARTBEAT_MAX_AGE_MS, heartbeatAgeMs(), heartbeatPath(), isHeartbeatStale(), readHeartbeat(), touchHeartbeat() (+1 more)

### Community 57 - "Time Series Chart"
Cohesion: 0.27
Nodes (11): ChartTokens, compactValue(), HoverState, monthKey(), monthTick(), monthToSeconds(), readTokens(), TICK_MONTH (+3 more)

### Community 58 - "TeamSystem Payslip Layout"
Cohesion: 0.18
Nodes (12): Code 1150 - RATA ADD.REG. A.P., Real Payslip Fixture: Giugno 2026 (doc 103), Real Payslip Fixture: Marzo 2026 (doc 96), ADDIZIONALE REGIONALE, Fixture Anonymisation Convention, Employer Header Block (Ditta / ACME Consulting srl), TeamSystem August 2026 Fixture (synthetic-anonymised), IBAN / Bank Accredito Trailer Line (+4 more)

### Community 59 - "CSP Middleware"
Cohesion: 0.24
Nodes (11): config, contentSecurityPolicy(), frameAncestorsFor(), hasSessionCookie(), isPublic(), middleware(), PUBLIC_PATHS, PUBLIC_PREFIXES (+3 more)

### Community 60 - "Auth Defects & Decisions"
Cohesion: 0.21
Nodes (12): E2E login flow test, auth() not usable as middleware wrapper with lazy config, Authentik Dashboard OIDC provider, Empty grant_types breaks every login, Session cookie chunking — match by prefix, middleware must export runtime = nodejs, proxy.ts unusable under output: standalone, No bound server action on the login path (+4 more)

### Community 61 - "NPM Scripts"
Cohesion: 0.18
Nodes (11): scripts, build, db:generate, db:migrate, dev, e2e, lint, start (+3 more)

### Community 62 - "OCR Defect Fixtures"
Cohesion: 0.18
Nodes (11): OCR Digit/Letter Confusion, August 2026 OCR Fixture (Paperless-ngx text), Flattened Residuals Grid OCR Defect, Leave Residuals Grid (FERIE / PERMESSI / ROL / FLESS. / B. ORE), Garbage OCR Fixture (skewed scan), All-Low-Confidence Degradation (Failure Handling), Code 1405 - FESTIVITA' NON GOD. (gg), Code 9824 - SOMMA ART.1 C.4 L.207/24 (+3 more)

### Community 63 - "Testing & Hardening Posture"
Cohesion: 0.20
Nodes (11): End-to-end test suite (two critical flows), E2E verify-commit flow test, dashboard DB in pg_dump routine with tested restore, frame-ancestors 'self' scoped to the PDF preview route, Postgres least-privilege dashboard role, PUBLIC CONNECT grant defeats role-level REVOKE, read_only rootfs, cap_drop ALL, tmpfs and limits, Container and CSP hardening posture (+3 more)

### Community 64 - "Wallet & Balance Caching"
Cohesion: 0.25
Nodes (11): Balance cache keyed per column, not per newest row, Wallet API 401 server-side revocation (resolved), Live Wallet account names (ING - Salary, Revolut, Savings, Holidays), balance_snapshots read cache, Cache-and-revalidate data flow with as-of stamps, Strict phase ordering — never write a partial row, Teable Allocation integration contract, TOTAL formula column as home hero balance (+3 more)

### Community 65 - "Root Layout & Fonts"
Cohesion: 0.27
Nodes (6): metadata, viewport, THEME_STORAGE_KEY, ThemeScript(), plexMono, plexSans

### Community 66 - "Trek Sync Tests"
Cohesion: 0.20
Nodes (6): ApplyDesiredStateResult, jobs, repo, state, STATS, trek

### Community 67 - "Fund Repository"
Cohesion: 0.20
Nodes (3): fundDeposits, funds, fundSettings

### Community 68 - "Scheduled Job Reliability"
Cohesion: 0.22
Nodes (10): Missing file bind-mount target becomes a directory, Hourly sweep as webhook fallback, Paperless-ngx payslip webhook workflow, Wallet token hot rotation via file bind mount, Read-only secret file mounts (wallet-token, trek-token), Idempotency, advisory lock and 3-day grace catch-up, X-Cron-Secret / X-Webhook-Secret machine endpoints, monthly_snapshots idempotency authority (+2 more)

### Community 69 - "Deployment Stack Topology"
Cohesion: 0.33
Nodes (10): First deploy procedure and boot log order, Personal Dashboard Operator Runbook, supercronic vendored from pinned release binary, dashboard-app service, dashboard-cron supercronic sidecar service, External networks proxy_public and db_internal, projects compose stack, Personal Dashboard Implementation Plan (+2 more)

### Community 71 - "Sign-In Page"
Cohesion: 0.31
Nodes (7): first(), metadata, safeCallbackUrl(), SearchParams, SignInPage(), SignInButton(), PROVIDER_ID

### Community 72 - "Gross Pay Line Codes"
Cohesion: 0.28
Nodes (9): Code 001 - RETRIBUZIONE ORDINARIA, August 2026 PDF-Text Fixture (clean layout), TOTALE RITENUTE, Code 2 - LAVORO ORDIN.(mens.), Code 1101 - IRPEF A CREDITO -MOD.730-, Code 9208 - CREDITO COMPENSATO, Real Payslip Fixture: Luglio 2026 (doc 104, 730 refund), ARROTONDAMENTO (+1 more)

### Community 73 - "Exposure & Observability"
Cohesion: 0.25
Nodes (9): Exposure option A — public via Cloudflare tunnel, Lazy DB Proxy — never read env at module scope, Prometheus scrape of /metrics plus blackbox probe, TLS at Cloudflare edge and __Host- Secure cookie, Traefik router with X-Forwarded-Proto https middleware, Exposure decision — public via Cloudflare tunnel, Gotify alerting policy and /metrics observability, job_runs scheduler observability table (+1 more)

### Community 74 - "Leave Action Tests"
Cohesion: 0.25
Nodes (6): auth, cache, DAY, repo, sync, trek

### Community 75 - "Settings Action Tests"
Cohesion: 0.25
Nodes (6): auth, cache, env, repo, teable, TrackedAccount

### Community 76 - "Leave Lib Tests"
Cohesion: 0.25
Nodes (5): payroll, payslips, repo, trekState, vacation

### Community 77 - "TFR & Contribution Codes"
Cohesion: 0.36
Nodes (8): Code 19 - ORE NON LAVORATE, Code 2161 - DONATORI SANGUE, Code 7897 - ESONERO CTR - TFR PREV.C., Code 8003 - CONTRIBUZIONE TFR, Code 9837 - IMPONIBILE 5% L.199/25, Code 9838 - IMPOSTA SOST. 5% L.199/25, Real Payslip Fixture: Agosto 2026, TFR MESE

### Community 78 - "Pension Fund Codes"
Cohesion: 0.33
Nodes (7): Code 7101 - FONDO C/DIPE (employee pension-fund share), Code 9109 - FONDO C/AZIENDA (employer pension-fund share), Code 9110 - COMUNICAZIONE DIPENDENTE, Code 7052 - QUOTA ISCR. FONDO AZIENDA, Code 7053 - QUOTA ISCR.FONDO DIPEND., Real Payslip Fixture: Novembre 2025 (doc 12), Code 8054 - CONTRIBUTO DIPENDENTE (negative)

### Community 79 - "Tax Deduction Codes"
Cohesion: 0.29
Nodes (7): Code 9424 - ULTERIORE DETRAZIONE MESE, Real Payslip Fixture: Aprile 2026 (doc 101), Code 8992 - TRATTAMENTO INT. DL 3/20, Code 4 - GIORNI NON LAVORATI, Real Payslip Fixture: Ottobre 2025 (doc 14, partial month), PROGRESSIVI ANNUI Block, ULTERIORE DETRAZIONE

### Community 80 - "IRPEF Tax Bases"
Cohesion: 0.29
Nodes (7): IMPON. CONTR. SOC. (social-contribution taxable base), IMPONIBILE IRPEF, IRPEF ERARIO, IRPEF LORDA, TOTALE CONTRIBUTI SOCIALI, TOTALE DETRAZIONI, TOTALE TRATTENUTE IRPEF

### Community 81 - "Welfare & Gross Totals"
Cohesion: 0.33
Nodes (6): TOTALE COMPETENZE, Codice CCNL C011, Code 9582 - RIMBORSI - WELFARE AZ., Code 9586 - RET. NATURA - WELFARE AZ., Real Payslip Fixture: Maggio 2026 (doc 102, welfare), TOTALE LORDO

### Community 82 - "Tredicesima Codes"
Cohesion: 0.40
Nodes (6): Code 900 - TREDICESIMA MENSILITA, December 2026 Tredicesima Fixture (standalone document), Code 8056 - CONTRIBUZIONE C/AZIENDA (negative), Code 901 - 13^ MENSILITA'(hh), Real Payslip Fixture: 13a Mensilita 2025 (doc 13), MESE RETRIBUITO Pay-Period Line

### Community 83 - "Ferie & Permessi Codes"
Cohesion: 0.47
Nodes (6): Code 300 - ASSENZA X FERIE A.C.(hh), Code 301 - FERIE A.C.(hh), Real Payslip Fixture: Gennaio 2026 (doc 11), Code 308 - ASSENZA X PERM. A.C.(hh), Code 309 - PERMESSI A.C.(hh), Real Payslip Fixture: Febbraio 2026 (doc 15)

### Community 84 - "Boot & Migration Sequence"
Cohesion: 0.33
Nodes (6): entrypoint.sh boot sequence, migrate.mjs esbuild bundle, Migrations are a fatal boot dependency, Compose healthchecks and autoheal labels, dashboard Postgres schema, Drizzle ORM with drizzle-kit migrations

### Community 85 - "Payroll Parsing Pipeline"
Cohesion: 0.33
Nodes (6): Monthly leave used from body row 300 ASSENZA X FERIE A.C., Known gap: ROL hours used never captured, Hybrid rules + LLM extraction with per-field confidence, Paperless-ngx API client contract, Payroll parsing pipeline, TeamSystem Mod. Cedolino TS anchor labels

### Community 86 - "Package Manifest"
Cohesion: 0.40
Nodes (4): name, private, type, version

### Community 87 - "Design Directions"
Cohesion: 0.50
Nodes (4): Design direction Instrument, Design direction Ledger, Design direction Terra, Owned <TimeSeriesChart> over uPlot/visx

## Ambiguous Edges - Review These
- `Container and CSP hardening posture` → `dashboard-app service`  [AMBIGUOUS]
  docker-compose.yml · relation: conceptually_related_to
- `Left Sidebar Navigation (Home, Finance, Work)` → `Bottom-Left Theme Toggle Controls`  [AMBIGUOUS]
  image.png · relation: conceptually_related_to
- `Vacation Fund Tab` → `Monthly Return Section`  [AMBIGUOUS]
  image.png · relation: conceptually_related_to

## Knowledge Gaps
- **465 isolated node(s):** `entrypoint.sh script`, `securityHeaders`, `nextConfig`, `name`, `version` (+460 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `Container and CSP hardening posture` and `dashboard-app service`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Left Sidebar Navigation (Home, Finance, Work)` and `Bottom-Left Theme Toggle Controls`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **What is the exact relationship between `Vacation Fund Tab` and `Monthly Return Section`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `cn()` connect `Sparkline & Row Components` to `Vacation & Leave Views`, `App Shell & Navigation`, `Finance Tabs & Preview`, `Error Boundary Components`, `Fund Gain UI Panels`, `Settings Page Sections`, `Home Page Cards`, `Loading Skeleton Screens`, `Finance Overview Client`, `Fund Settings Form`, `Leave Server Actions`, `Leave Calendar Grid`, `Time Series Chart`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **Why does `env` connect `Authentik OIDC Auth` to `App Shell & Navigation`, `Webhook & Sweep Routes`, `Paperless-ngx Client`, `Teable Allocation Client`, `LLM Config Resolution`, `Wallet API Client`, `Gotify Alerting`, `Job Run API Routes`, `Cron Routes & Machine Auth`, `Metrics & DB Pool`, `Environment Schema`, `LLM Extraction Pass`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `monthKeyOf()` connect `Fund Return Calculation` to `Vacation & Leave Views`, `Teable Allocation Client`, `Money & Payroll Math`, `Net Worth Aggregation`, `Staleness Classification`, `Jobs & Settings Actions`, `Payslip Ingest Job`, `Vacation Fund Ledger`, `Payslip Confirm Actions`, `Fund Settings Form`, `Vacation Server Actions`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `entrypoint.sh script`, `securityHeaders`, `nextConfig` to the rest of the system?**
  _465 weakly-connected nodes found - possible documentation gaps or missing edges._
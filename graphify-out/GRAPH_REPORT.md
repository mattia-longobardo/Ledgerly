# Graph Report - personal-dashboard  (2026-09-02)

## Corpus Check
- 204 files · ~136,942 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1633 nodes · 4236 edges · 98 communities (84 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 45 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `dec9d870`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- VerifyForm.tsx
- sweep.ts
- teable.ts
- preview/page.tsx
- monthKeyOf
- trek.ts
- _lib/funds.ts
- Finance Dashboard - Desktop & Mobile Redesign Plan
- actions/settings.ts
- parse.ts
- wallet.ts
- compilerOptions
- PageGrid.tsx
- OverviewClient.tsx
- monthly-snapshot.ts
- rules.ts
- payslip-ingest.ts
- time.ts
- format.ts
- paperless.ts
- dependencies
- devDependencies
- actions/vacation.ts
- toCents
- http.ts
- MonthGrid.tsx
- env
- confidence.ts
- text.ts
- trek-diff.ts
- llm.ts
- cn
- requireUserOrRedirect
- llm-config.ts
- settings/page.tsx
- _lib/leave.ts
- repo/leave.ts
- accounts.ts
- staleness.ts
- trek.test.ts
- contracts.ts
- ErrorInline.tsx
- work/page.tsx
- gotify.ts
- schema.ts
- Finance Dashboard — Brand System
- teamsystem.ts
- trek-sync.ts
- cometa.ts
- payroll.ts
- render-brand-icons.py
- sweep.test.ts
- actions/payslips.ts
- Code 9837 - IMPONIBILE 5% L.199/25
- index.ts
- AGENTS.md
- heartbeat.ts
- TimeSeriesChart.tsx
- Mod. Cedolino TS Layout
- middleware.ts
- CLAUDE.md
- scripts
- August 2026 OCR Fixture (Paperless-ngx text)
- @types/react-dom
- README.md
- app/layout.tsx
- trek-sync.test.ts
- actions/leave.test.ts
- LeaveCalendar.tsx
- dashboard-app service
- _lib/leave.test.ts
- actions/funds.ts
- August 2026 PDF-Text Fixture (clean layout)
- requireUser
- settings.test.ts
- Real Payslip Fixture: Agosto 2026
- Code 8992 - TRATTAMENTO INT. DL 3/20
- IMPONIBILE IRPEF
- Real Payslip Fixture: Maggio 2026 (doc 102, welfare)
- Real Payslip Fixture: 13a Mensilita 2025 (doc 13)
- Code 300 - ASSENZA X FERIE A.C.(hh)
- Compose healthchecks and autoheal labels
- package.json
- next.config.ts
- migrate.ts
- entrypoint.sh
- zod
- @playwright/test
- vitest
- { GET, POST }
- ADDIZIONALE COMUNALE

## God Nodes (most connected - your core abstractions)
1. `cn()` - 80 edges
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
- `Code 8054 - CONTRIBUTO DIPENDENTE (negative)` --semantically_similar_to--> `Code 7101 - FONDO C/DIPE (employee pension-fund share)`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d13.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt
- `alerts()` --indirect_call--> `httpRequest()`  [INFERRED]
  dashboard-app/src/lib/jobs/payslip-ingest.test.ts → dashboard-app/src/lib/clients/http.ts
- `Code 9824 - SOMMA ART.1 C.4 L.207/24` --semantically_similar_to--> `Code 9837 - IMPONIBILE 5% L.199/25`  [INFERRED] [semantically similar]
  dashboard-app/src/lib/payroll/__fixtures__/real/d10.txt → dashboard-app/src/lib/payroll/__fixtures__/real/ago2026.txt
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

## Communities (98 total, 14 thin omitted)

### Community 0 - "VerifyForm.tsx"
Cohesion: 0.12
Nodes (30): extractionOf(), compare(), orderQueue(), placeInQueue(), QueueEntry, QueuePlacement, successorOf(), queue (+22 more)

### Community 1 - "sweep.ts"
Cohesion: 0.09
Nodes (41): bodySchema, dynamic, POST(), runMonthlySnapshot(), snapshotLockKey(), alreadyMarkedMissed(), backfillPoints(), cacheable() (+33 more)

### Community 2 - "teable.ts"
Cohesion: 0.08
Nodes (41): requestJson(), AllocationRowInput, AllocationWriteAction, AllocationWriteResult, assertFieldsExist(), assertWritable(), clearFieldMapCache(), createAllocationRow() (+33 more)

### Community 3 - "preview/page.tsx"
Cohesion: 0.10
Nodes (21): FRESH, FUND, Gallery(), MONTHS, NOW, OLD, SAMPLE_SERIES, SHORT_SERIES (+13 more)

### Community 4 - "monthKeyOf"
Cohesion: 0.15
Nodes (26): MonthlyAccrual, currentValue(), effectiveSetting(), FundDepositRow, FundSettingRow, initialCapitalCents(), MonthlyReturnInput, ReturnRow (+18 more)

### Community 5 - "trek.ts"
Cohesion: 0.09
Nodes (35): UpstreamService, ApplyDesiredStateInput, asRecord(), callTool(), CLIENT_INFO, describe(), ensureSession(), entryListSchema (+27 more)

### Community 6 - "_lib/funds.ts"
Cohesion: 0.17
Nodes (17): FundView, loadFund(), loadFunds(), loadPortfolioGain(), balances, NOW, repo, absoluteReturn() (+9 more)

### Community 7 - "Finance Dashboard - Desktop & Mobile Redesign Plan"
Cohesion: 0.06
Nodes (31): 0. Read this first: what this plan is and is not, 1. Design direction, 2.1 Shell, 2.2 Column system, 2.3 Container queries are the load-bearing 2026 technique, 2.4 Other 2026 techniques to use (each must earn its place), 2. The core fix: a real desktop grid, 3.1 Home (`/`) (+23 more)

### Community 8 - "actions/settings.ts"
Cohesion: 0.14
Nodes (27): clearPoisonedSnapshot(), monthSchema, revalidateJobs(), runSnapshotNow(), clearLlmApiKey(), completeFirstRun(), deleteAccount(), hoursSchema (+19 more)

### Community 9 - "parse.ts"
Cohesion: 0.10
Nodes (27): PAYSLIP_FIELDS, AcquiredText, ORDINARY_MONTH_MARKERS, THIRTEENTH_KEYWORDS, median(), PayslipHistoryEntry, LlmOptions, LlmPassResult (+19 more)

### Community 10 - "wallet.ts"
Cohesion: 0.10
Nodes (28): SleepFn, REVOLUT_COMPONENT_KEYS, WALLET_ACCOUNTS, WALLET_EXPECTED_CURRENCY, WalletAccountConfig, accountSchema, accountsSchema, baseUrl() (+20 more)

### Community 11 - "compilerOptions"
Cohesion: 0.07
Nodes (29): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+21 more)

### Community 12 - "PageGrid.tsx"
Cohesion: 0.12
Nodes (15): LG_SPAN, LG_START, MD_SPAN, PageGrid(), Panel(), PanelProps, Span, Skeleton() (+7 more)

### Community 13 - "OverviewClient.tsx"
Cohesion: 0.09
Nodes (28): FinanceTabs(), HREF, OPTIONS, ViewKey, DEFAULT_STATE, OverviewAccount, OverviewClient(), OverviewClientProps (+20 more)

### Community 14 - "monthly-snapshot.ts"
Cohesion: 0.11
Nodes (21): JobResult, execute(), IN_ROUTE_ATTEMPTS, JOB_NAME, MAX_ATTEMPTS, Outcome, Phase3Input, RunMonthlySnapshotInput (+13 more)

### Community 15 - "rules.ts"
Cohesion: 0.13
Nodes (25): PayslipField, Anchor, AUX_ANCHORS, AUX_FIELDS, AuxField, COMPOSITE_FIELDS, FIELD_ANCHORS, GRID_HEADER_SYNONYMS (+17 more)

### Community 16 - "payslip-ingest.ts"
Cohesion: 0.10
Nodes (25): errorMessage(), PayslipExtraction, payslips, acquireText(), ingestPayslipDocument(), IngestPayslipInput, IngestTrigger, IT_MONTHS (+17 more)

### Community 17 - "time.ts"
Cohesion: 0.19
Nodes (18): VacationFundPage(), sumCents(), AccrualRateRow, balanceSeries(), effectiveRate(), entryMonth(), ExpectedAccrual, expectedAccruals() (+10 more)

### Community 18 - "format.ts"
Cohesion: 0.09
Nodes (38): byYear(), FundTable(), MonthlyGainPanel(), Pct(), tone(), dynamic, FundsPage(), metadata (+30 more)

### Community 19 - "paperless.ts"
Cohesion: 0.13
Nodes (21): dynamic, GET(), INLINE_TYPES, isUnauthorizedError(), unauthorizedResponse(), baseUrl(), clearPayslipTagIdCache(), documentSchema (+13 more)

### Community 20 - "dependencies"
Cohesion: 0.09
Nodes (23): @base-ui-components/react, clsx, dependencies, @base-ui-components/react, clsx, drizzle-orm, next, next-auth (+15 more)

### Community 21 - "devDependencies"
Cohesion: 0.09
Nodes (23): devDependencies, drizzle-kit, @fontsource/ibm-plex-mono, @fontsource/ibm-plex-sans, msw, tailwindcss, @tailwindcss/postcss, tsx (+15 more)

### Community 22 - "actions/vacation.ts"
Cohesion: 0.16
Nodes (21): parseMoney(), initialSchema, rateSchema, recordWithdrawal(), revalidateVacation(), setAccrualRate(), setInitialValue(), undoWithdrawal() (+13 more)

### Community 23 - "toCents"
Cohesion: 0.20
Nodes (15): EMPTY, initialCapitalOf(), PortfolioGain, monthlyReturn, centsFromDecimal(), roundEur(), toCents(), combinedGain (+7 more)

### Community 24 - "http.ts"
Cohesion: 0.11
Nodes (20): backoffDelay(), HttpError, httpRequest(), HttpRequestInit, isRetryable(), isRetryableStatus(), parseRetryAfter(), readBody() (+12 more)

### Community 25 - "MonthGrid.tsx"
Cohesion: 0.21
Nodes (13): dayNumber(), describeDay(), Dot(), DotKind, fractionOf(), isoOf(), MonthGrid(), MonthGridDayBase (+5 more)

### Community 26 - "env"
Cohesion: 0.05
Nodes (57): runtime, dynamic, POST(), asDocId(), dynamic, extractDocId(), ID_KEYS, POST() (+49 more)

### Community 27 - "confidence.ts"
Cohesion: 0.14
Nodes (21): FieldExtraction, GRID_DEPENDENT_FIELDS, BALANCE_TOLERANCE, checkNetAgainstMedian(), checkNettoBalance(), checkResidualContinuity(), combineField(), crossValidate() (+13 more)

### Community 28 - "text.ts"
Cohesion: 0.14
Nodes (19): detectPeriodMonth(), errorMessage(), findLabel(), numbersOnLine(), pick(), readGrid(), resolveAnchor(), resolveField() (+11 more)

### Community 29 - "trek-diff.ts"
Cohesion: 0.18
Nodes (17): Editing, LeaveDayDetail, LeaveFraction, LeaveKind, DesiredDay, TogglePlanStep, TrekEntry, differs() (+9 more)

### Community 30 - "llm.ts"
Cohesion: 0.15
Nodes (16): buildTool(), chatCompletionsUrl(), coerceMonth(), coerceNumber(), DEFAULT_MAX_CHARS, DEFAULT_TIMEOUT_MS, emptyResult(), errorName() (+8 more)

### Community 31 - "cn"
Cohesion: 0.14
Nodes (19): dynamic, metadata, Sparkline(), SparklineProps, SparkTone, TONE_CLASS, AccountList(), AccountRow() (+11 more)

### Community 32 - "requireUserOrRedirect"
Cohesion: 0.14
Nodes (14): FinanceOverviewPage(), AppLayout(), AppShell(), AppShellProps, IconProps, isActive(), TABS, apply() (+6 more)

### Community 33 - "llm-config.ts"
Cohesion: 0.13
Nodes (18): SettingsPage(), appSettings, asString(), BaseUrlCheck, checkBaseUrl(), ConfigSource, isPrivateHost(), Layers (+10 more)

### Community 34 - "settings/page.tsx"
Cohesion: 0.13
Nodes (16): DATE_LINE, dynamic, ENTRY_LABEL, metadata, dynamic, JOB_LABEL, JOBS, metadata (+8 more)

### Community 35 - "_lib/leave.ts"
Cohesion: 0.12
Nodes (24): DEFAULT_HOURS_PER_DAY, extractedField(), FerieView, hoursPerDay(), LeaveByMonthProps, LeaveCalendarProps, LeaveCalendarView, LeaveMonthView (+16 more)

### Community 36 - "repo/leave.ts"
Cohesion: 0.20
Nodes (15): clearPending(), dayAt(), daysInRange(), daysInYear(), deleteDates(), earliestDate(), fractionString(), LeaveOrigin (+7 more)

### Community 37 - "accounts.ts"
Cohesion: 0.13
Nodes (24): accountLabel(), AccountsSnapshot, AccountView, APP_MANAGED_KEYS, buildTotal(), emptyView(), LABELS, loadAccounts() (+16 more)

### Community 38 - "staleness.ts"
Cohesion: 0.29
Nodes (9): asDate(), classify(), isStale(), snapshotGrace, StalenessInfo, StalenessSource, NOW, DISPLAY_STALENESS_MS (+1 more)

### Community 39 - "trek.test.ts"
Cohesion: 0.16
Nodes (15): planToggles(), resetTrekAuthCache(), callsTo(), entriesPayload(), fetchMock, LIVE_STATS, Rpc, rpcOf() (+7 more)

### Community 40 - "contracts.ts"
Cohesion: 0.15
Nodes (15): ACCOUNT_KEYS, AccountBalance, AccountKey, JobStatus, NET_WORTH_KEYS, NetWorthKey, REFRESH_STALENESS_MS, SourceKind (+7 more)

### Community 42 - "work/page.tsx"
Cohesion: 0.12
Nodes (28): loadFerie(), HomePage(), LeaveByMonth(), varianceSentence(), OPTIONS, SalarySection(), SalarySectionProps, SalaryWindow (+20 more)

### Community 43 - "gotify.ts"
Cohesion: 0.17
Nodes (14): alertJobFailure(), alertPayslipPending(), alertSuccessAfterRetry(), appUrl(), GotifyMessage, JobFailureAlert, notify(), PayslipPendingAlert (+6 more)

### Community 44 - "schema.ts"
Cohesion: 0.10
Nodes (12): BalanceSnapshot, FundDeposit, fundDeposits, funds, fundSettings, JobRun, jobRuns, LeaveDay (+4 more)

### Community 45 - "Finance Dashboard — Brand System"
Cohesion: 0.22
Nodes (8): 1. Strategy, 2. The mark, 3. Assets, 4. Colour, 5. Typography, 6. Voice, 7. Applications, Finance Dashboard — Brand System

### Community 46 - "teamsystem.ts"
Cohesion: 0.23
Nodes (15): parseItalianNumber(), bodyRow(), EMPTY, extractTeamSystem(), findGrid(), isNumericOnly(), numbersOf(), plausibleHours() (+7 more)

### Community 47 - "trek-sync.ts"
Cohesion: 0.23
Nodes (15): applyDesiredState(), config(), getEntries(), getStats(), isTrekNotConfigured(), parseOrThrow(), retryPolicy(), TrekCallOptions (+7 more)

### Community 48 - "cometa.ts"
Cohesion: 0.26
Nodes (14): CometaCredit, cometaCreditedDeposits(), cometaSchedule(), creditedByMonth(), creditMonthFor(), JOINING_FEE, quarterIndex(), quarterKey() (+6 more)

### Community 49 - "payroll.ts"
Cohesion: 0.19
Nodes (19): fromCents(), annualTotals, averageNet(), AverageOptions, averageTaxes(), ferieRemaining, inYear(), isThirteenthCandidate() (+11 more)

### Community 50 - "render-brand-icons.py"
Cohesion: 0.33
Nodes (3): Rasterise the Finance Dashboard mark to PNG. No rasteriser is installed on this…, radius=0 renders a full-bleed square (maskable); otherwise a rounded square., render()

### Community 51 - "sweep.test.ts"
Cohesion: 0.19
Nodes (10): BALANCES, cache, historyRows(), latestRows(), RunRow, SnapshotRow, store, teableRows() (+2 more)

### Community 52 - "actions/payslips.ts"
Cohesion: 0.18
Nodes (15): confirmPayslip(), extractedValue(), extractionOf(), nullableMoney, PendingEntry, pendingQueue(), rejectPayslip(), revalidatePayslips() (+7 more)

### Community 53 - "Code 9837 - IMPONIBILE 5% L.199/25"
Cohesion: 0.50
Nodes (4): Code 9837 - IMPONIBILE 5% L.199/25, Code 9838 - IMPOSTA SOST. 5% L.199/25, Real Payslip Fixture: Giugno 2026 (doc 103), PAGA BASE / PREMIO PR. / SUPERM.ASS Row

### Community 54 - "index.ts"
Cohesion: 0.19
Nodes (9): dynamic, db, instance(), pool(), trackedAccounts, get(), list(), remove() (+1 more)

### Community 56 - "heartbeat.ts"
Cohesion: 0.41
Nodes (9): dynamic, GET(), HEARTBEAT_MAX_AGE_MS, heartbeatAgeMs(), heartbeatPath(), isHeartbeatStale(), readHeartbeat(), touchHeartbeat() (+1 more)

### Community 57 - "TimeSeriesChart.tsx"
Cohesion: 0.24
Nodes (13): ChartTokens, compactValue(), HoverState, monthKey(), monthTick(), monthTicks(), monthToSeconds(), readTokens() (+5 more)

### Community 58 - "Mod. Cedolino TS Layout"
Cohesion: 0.22
Nodes (10): Code 1150 - RATA ADD.REG. A.P., Real Payslip Fixture: Marzo 2026 (doc 96), ADDIZIONALE REGIONALE, Fixture Anonymisation Convention, Employer Header Block (Ditta / ACME Consulting srl), TeamSystem August 2026 Fixture (synthetic-anonymised), IBAN / Bank Accredito Trailer Line, Q/INPS - INAIL Statistical Block (+2 more)

### Community 59 - "middleware.ts"
Cohesion: 0.24
Nodes (11): config, contentSecurityPolicy(), frameAncestorsFor(), hasSessionCookie(), isPublic(), middleware(), PUBLIC_PATHS, PUBLIC_PREFIXES (+3 more)

### Community 61 - "scripts"
Cohesion: 0.18
Nodes (11): scripts, build, db:generate, db:migrate, dev, e2e, lint, start (+3 more)

### Community 62 - "August 2026 OCR Fixture (Paperless-ngx text)"
Cohesion: 0.29
Nodes (7): OCR Digit/Letter Confusion, August 2026 OCR Fixture (Paperless-ngx text), Flattened Residuals Grid OCR Defect, Leave Residuals Grid (FERIE / PERMESSI / ROL / FLESS. / B. ORE), Garbage OCR Fixture (skewed scan), All-Low-Confidence Degradation (Failure Handling), OCR Letter-Spacing Artifact (S -> 'S ')

### Community 65 - "app/layout.tsx"
Cohesion: 0.27
Nodes (6): metadata, viewport, THEME_STORAGE_KEY, ThemeScript(), plexMono, plexSans

### Community 66 - "trek-sync.test.ts"
Cohesion: 0.20
Nodes (6): ApplyDesiredStateResult, jobs, repo, state, STATS, trek

### Community 67 - "actions/leave.test.ts"
Cohesion: 0.20
Nodes (8): LeaveDaySaved, auth, cache, DAY, repo, sync, trek, TrekSyncResult

### Community 68 - "LeaveCalendar.tsx"
Cohesion: 0.22
Nodes (18): daySchema, describe(), LEAVE_PATHS, noopSync(), removeLeaveDay(), removeSchema, revalidateLeave(), setLeaveDay() (+10 more)

### Community 69 - "dashboard-app service"
Cohesion: 0.38
Nodes (7): dashboard-app service, dashboard-cron supercronic sidecar service, External networks proxy_public and db_internal, projects compose stack, read_only rootfs, cap_drop ALL, tmpfs and limits, Read-only secret file mounts (wallet-token, trek-token), Traefik router with X-Forwarded-Proto https middleware

### Community 70 - "_lib/leave.test.ts"
Cohesion: 0.25
Nodes (5): payroll, payslips, repo, trekState, vacation

### Community 71 - "actions/funds.ts"
Cohesion: 0.27
Nodes (10): depositSchema, recordManualDeposit(), revalidateFund(), saveFundSettings(), settingsSchema, slugOf(), FundSettingsForm(), FundSettingsFormProps (+2 more)

### Community 72 - "August 2026 PDF-Text Fixture (clean layout)"
Cohesion: 0.28
Nodes (9): Code 001 - RETRIBUZIONE ORDINARIA, August 2026 PDF-Text Fixture (clean layout), TOTALE RITENUTE, Code 2 - LAVORO ORDIN.(mens.), Code 1101 - IRPEF A CREDITO -MOD.730-, Code 9208 - CREDITO COMPENSATO, Real Payslip Fixture: Luglio 2026 (doc 104, 730 refund), ARROTONDAMENTO (+1 more)

### Community 73 - "requireUser"
Cohesion: 0.40
Nodes (4): AuthedUser, getUserOrNull(), requireUser(), UnauthorizedError

### Community 75 - "settings.test.ts"
Cohesion: 0.25
Nodes (6): auth, cache, env, repo, teable, TrackedAccount

### Community 77 - "Real Payslip Fixture: Agosto 2026"
Cohesion: 0.25
Nodes (11): Code 19 - ORE NON LAVORATE, Code 2161 - DONATORI SANGUE, Code 7101 - FONDO C/DIPE (employee pension-fund share), Code 7897 - ESONERO CTR - TFR PREV.C., Code 8003 - CONTRIBUZIONE TFR, Code 9109 - FONDO C/AZIENDA (employer pension-fund share), Code 9110 - COMUNICAZIONE DIPENDENTE, Real Payslip Fixture: Agosto 2026 (+3 more)

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

### Community 86 - "package.json"
Cohesion: 0.40
Nodes (4): name, private, type, version

## Knowledge Gaps
- **507 isolated node(s):** `entrypoint.sh script`, `securityHeaders`, `nextConfig`, `name`, `version` (+502 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `env` connect `env` to `sweep.ts`, `teable.ts`, `llm-config.ts`, `requireUser`, `wallet.ts`, `gotify.ts`, `paperless.ts`, `index.ts`, `llm.ts`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **Why does `cn()` connect `cn` to `VerifyForm.tsx`, `llm-config.ts`, `settings/page.tsx`, `preview/page.tsx`, `LeaveCalendar.tsx`, `requireUserOrRedirect`, `actions/funds.ts`, `ErrorInline.tsx`, `work/page.tsx`, `PageGrid.tsx`, `OverviewClient.tsx`, `format.ts`, `TimeSeriesChart.tsx`, `MonthGrid.tsx`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `monthKeyOf()` connect `monthKeyOf` to `sweep.ts`, `teable.ts`, `_lib/leave.ts`, `accounts.ts`, `staleness.ts`, `actions/funds.ts`, `actions/settings.ts`, `OverviewClient.tsx`, `payslip-ingest.ts`, `payroll.ts`, `time.ts`, `actions/payslips.ts`, `actions/vacation.ts`, `toCents`?**
  _High betweenness centrality (0.022) - this node is a cross-community bridge._
- **What connects `entrypoint.sh script`, `securityHeaders`, `nextConfig` to the rest of the system?**
  _507 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `VerifyForm.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.11587301587301588 - nodes in this community are weakly interconnected._
- **Should `sweep.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.09250693802035152 - nodes in this community are weakly interconnected._
- **Should `teable.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08115942028985507 - nodes in this community are weakly interconnected._
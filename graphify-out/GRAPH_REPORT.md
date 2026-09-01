# Graph Report - personal-dashboard  (2026-09-01)

## Corpus Check
- 202 files · ~131,497 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1583 nodes · 4101 edges · 97 communities (83 shown, 14 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 45 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `52023614`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- queue.ts
- sweep.ts
- teable.ts
- preview/page.tsx
- monthKeyOf
- trek.ts
- _lib/funds.ts
- [slug]/page.tsx
- actions/settings.ts
- parse.ts
- wallet.ts
- compilerOptions
- Skeleton.tsx
- OverviewClient.tsx
- monthly-snapshot.ts
- rules.ts
- payslip-ingest.ts
- fromCents
- format.ts
- accounts.ts
- dependencies
- devDependencies
- machine.ts
- toCents
- http.ts
- MonthGrid.tsx
- env
- confidence.ts
- text.ts
- trek-diff.ts
- llm.ts
- (app)/page.tsx
- cn
- settings/page.tsx
- [id]/page.tsx
- _lib/leave.ts
- repo/leave.ts
- networth.ts
- staleness.ts
- trek.test.ts
- contracts.ts
- VerifyForm.tsx
- work/page.tsx
- gotify.ts
- schema.ts
- Finance Dashboard — Brand System
- teamsystem.ts
- trek-sync.ts
- cometa.ts
- _lib/vacation.ts
- render-brand-icons.py
- sweep.test.ts
- SalarySection.tsx
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
- llm-config.test.ts
- August 2026 PDF-Text Fixture (clean layout)
- tracked-accounts.ts
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
1. `cn()` - 76 edges
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

## Communities (97 total, 14 thin omitted)

### Community 0 - "queue.ts"
Cohesion: 0.25
Nodes (12): compare(), orderQueue(), placeInQueue(), QueueEntry, QueuePlacement, successorOf(), queue, verifyHref() (+4 more)

### Community 1 - "sweep.ts"
Cohesion: 0.14
Nodes (19): TeablePoint, JOB_NAME, alreadyMarkedMissed(), backfillPoints(), cacheable(), fingerprint(), HandPoint, handTrackedLatest() (+11 more)

### Community 2 - "teable.ts"
Cohesion: 0.09
Nodes (39): requestJson(), AllocationRowInput, AllocationWriteAction, AllocationWriteResult, assertFieldsExist(), assertWritable(), clearFieldMapCache(), createAllocationRow() (+31 more)

### Community 3 - "preview/page.tsx"
Cohesion: 0.11
Nodes (23): WithdrawalFlowProps, FRESH, FUND, Gallery(), MONTHS, NOW, OLD, SAMPLE_SERIES (+15 more)

### Community 4 - "monthKeyOf"
Cohesion: 0.13
Nodes (31): FundsPage(), annualTotals, AverageOptions, inYear(), isThirteenthCandidate(), isVerified(), netPerMonthSeries(), ordinary() (+23 more)

### Community 5 - "trek.ts"
Cohesion: 0.09
Nodes (43): applyDesiredState(), ApplyDesiredStateInput, asRecord(), callTool(), CLIENT_INFO, config(), describe(), ensureSession() (+35 more)

### Community 6 - "_lib/funds.ts"
Cohesion: 0.20
Nodes (19): FundView, loadFunds(), absoluteReturn(), currentValue(), effectiveSetting(), FundDepositRow, FundSettingRow, initialCapitalCents() (+11 more)

### Community 7 - "[slug]/page.tsx"
Cohesion: 0.20
Nodes (15): FundTable(), Pct(), tone(), cellTone(), dynamic, FundDetailPage(), loadFund(), DeltaBadge() (+7 more)

### Community 8 - "actions/settings.ts"
Cohesion: 0.05
Nodes (92): depositSchema, recordManualDeposit(), revalidateFund(), saveFundSettings(), settingsSchema, slugOf(), clearPoisonedSnapshot(), monthSchema (+84 more)

### Community 9 - "parse.ts"
Cohesion: 0.10
Nodes (27): PAYSLIP_FIELDS, AcquiredText, ORDINARY_MONTH_MARKERS, THIRTEENTH_KEYWORDS, median(), PayslipHistoryEntry, LlmOptions, allLowFields() (+19 more)

### Community 10 - "wallet.ts"
Cohesion: 0.11
Nodes (25): SleepFn, REVOLUT_COMPONENT_KEYS, WALLET_ACCOUNTS, WALLET_EXPECTED_CURRENCY, WalletAccountConfig, accountSchema, accountsSchema, baseUrl() (+17 more)

### Community 11 - "compilerOptions"
Cohesion: 0.07
Nodes (29): compilerOptions, allowJs, esModuleInterop, incremental, isolatedModules, jsx, lib, module (+21 more)

### Community 12 - "Skeleton.tsx"
Cohesion: 0.13
Nodes (8): Skeleton(), SkeletonBlockProps, SkeletonChart(), SkeletonHero(), SkeletonProps, SkeletonRows(), SkeletonText(), SkeletonTile()

### Community 13 - "OverviewClient.tsx"
Cohesion: 0.14
Nodes (16): OverviewAccount, OverviewClient(), OverviewClientProps, PRESET, toSeries(), dynamic, metadata, MonthRange (+8 more)

### Community 14 - "monthly-snapshot.ts"
Cohesion: 0.12
Nodes (35): alertJobFailure(), alertSuccessAfterRetry(), notify(), errorMessage(), JobResult, execute(), IN_ROUTE_ATTEMPTS, Outcome (+27 more)

### Community 15 - "rules.ts"
Cohesion: 0.13
Nodes (25): PayslipField, Anchor, AUX_ANCHORS, AUX_FIELDS, AuxField, COMPOSITE_FIELDS, FIELD_ANCHORS, GRID_HEADER_SYNONYMS (+17 more)

### Community 16 - "payslip-ingest.ts"
Cohesion: 0.14
Nodes (18): PayslipExtraction, ingestPayslipDocument(), IngestPayslipInput, IngestTrigger, IT_MONTHS, JOB_NAME, loadHistory(), metadataMonth() (+10 more)

### Community 17 - "fromCents"
Cohesion: 0.17
Nodes (21): VacationFundPage(), MonthlyAccrual, MonthlyReturnInput, centsFromDecimal(), fromCents(), MoneyInput, roundEur(), sumCents() (+13 more)

### Community 18 - "format.ts"
Cohesion: 0.11
Nodes (23): AccountRow(), AccountRowProps, Body(), DeltaBadgeProps, CentsMode, MoneySize, MoneyValueProps, SIZE_CLASS (+15 more)

### Community 19 - "accounts.ts"
Cohesion: 0.15
Nodes (16): accountLabel(), AccountsSnapshot, APP_MANAGED_KEYS, buildTotal(), emptyView(), LABELS, loadAccounts(), REVOLUT_SUB_KEYS (+8 more)

### Community 20 - "dependencies"
Cohesion: 0.09
Nodes (23): @base-ui-components/react, clsx, dependencies, @base-ui-components/react, clsx, drizzle-orm, next, next-auth (+15 more)

### Community 21 - "devDependencies"
Cohesion: 0.09
Nodes (23): devDependencies, drizzle-kit, @fontsource/ibm-plex-mono, @fontsource/ibm-plex-sans, msw, tailwindcss, @tailwindcss/postcss, tsx (+15 more)

### Community 22 - "machine.ts"
Cohesion: 0.10
Nodes (27): dynamic, POST(), asDocId(), dynamic, extractDocId(), ID_KEYS, POST(), dynamic (+19 more)

### Community 23 - "toCents"
Cohesion: 0.22
Nodes (14): EMPTY, initialCapitalOf(), PortfolioGain, monthlyReturn, toCents(), toHours(), combinedGain, fundGain() (+6 more)

### Community 24 - "http.ts"
Cohesion: 0.07
Nodes (29): backoffDelay(), HttpError, httpRequest(), HttpRequestInit, isRetryable(), isRetryableStatus(), parseRetryAfter(), readBody() (+21 more)

### Community 25 - "MonthGrid.tsx"
Cohesion: 0.21
Nodes (13): dayNumber(), describeDay(), Dot(), DotKind, fractionOf(), isoOf(), MonthGrid(), MonthGridDayBase (+5 more)

### Community 26 - "env"
Cohesion: 0.07
Nodes (45): runtime, first(), metadata, safeCallbackUrl(), SearchParams, SignInPage(), SignInButton(), asNumber() (+37 more)

### Community 27 - "confidence.ts"
Cohesion: 0.13
Nodes (23): VerifyFormProps, FieldExtraction, SanityCheck, GRID_DEPENDENT_FIELDS, BALANCE_TOLERANCE, checkNetAgainstMedian(), checkNettoBalance(), checkResidualContinuity() (+15 more)

### Community 28 - "text.ts"
Cohesion: 0.13
Nodes (20): acquireText(), errorMessage(), findLabel(), numbersOnLine(), pick(), readGrid(), resolveAnchor(), resolveField() (+12 more)

### Community 29 - "trek-diff.ts"
Cohesion: 0.20
Nodes (15): LeaveDayDetail, LeaveFraction, LeaveKind, DesiredDay, TogglePlanStep, TrekEntry, differs(), planPull() (+7 more)

### Community 30 - "llm.ts"
Cohesion: 0.13
Nodes (17): buildTool(), chatCompletionsUrl(), coerceMonth(), DEFAULT_BASE_URL, DEFAULT_MAX_CHARS, DEFAULT_TIMEOUT_MS, emptyResult(), errorName() (+9 more)

### Community 31 - "(app)/page.tsx"
Cohesion: 0.07
Nodes (27): FinanceTabs(), HREF, OPTIONS, ViewKey, MonthlyGainPanel(), dynamic, metadata, FinanceOverviewPage() (+19 more)

### Community 32 - "cn"
Cohesion: 0.12
Nodes (20): AppShell(), AppShellProps, IconProps, isActive(), TABS, apply(), ORDER, readStored() (+12 more)

### Community 33 - "settings/page.tsx"
Cohesion: 0.12
Nodes (23): DEFAULT_HOURS_PER_DAY, dynamic, JOB_LABEL, JOBS, metadata, RUN_TIME, SettingsPage(), STATUS_TONE (+15 more)

### Community 34 - "[id]/page.tsx"
Cohesion: 0.15
Nodes (13): extractionOf(), VerifiableField, dynamic, FIELD_META, FieldMeta, inputValue(), metadata, VerifyPayslipPage() (+5 more)

### Community 35 - "_lib/leave.ts"
Cohesion: 0.20
Nodes (14): hoursPerDay(), LeaveByMonthProps, LeaveMonthView, loadLeaveCalendar(), monthsOf(), MonthGridDay, flaggedMonths(), leaveVariance() (+6 more)

### Community 36 - "repo/leave.ts"
Cohesion: 0.18
Nodes (18): isTrekNotConfigured(), leaveDays, syncPass(), clearPending(), dayAt(), daysInRange(), daysInYear(), deleteDates() (+10 more)

### Community 37 - "networth.ts"
Cohesion: 0.22
Nodes (13): contributingKeys(), missingKeys(), netWorth, NetWorthContributor, NetWorthOptions, observe(), Observed, oldestCapture() (+5 more)

### Community 38 - "staleness.ts"
Cohesion: 0.29
Nodes (9): asDate(), classify(), isStale(), snapshotGrace, StalenessInfo, StalenessSource, NOW, DISPLAY_STALENESS_MS (+1 more)

### Community 39 - "trek.test.ts"
Cohesion: 0.17
Nodes (14): resetTrekAuthCache(), callsTo(), entriesPayload(), fetchMock, LIVE_STATS, Rpc, rpcOf(), rpcs() (+6 more)

### Community 40 - "contracts.ts"
Cohesion: 0.14
Nodes (14): ACCOUNT_KEYS, AccountBalance, JobStatus, NET_WORTH_KEYS, NetWorthKey, REFRESH_STALENESS_MS, SourceKind, Valued (+6 more)

### Community 41 - "VerifyForm.tsx"
Cohesion: 0.18
Nodes (8): decimal(), PdfFrame(), toInput(), VerifyField, VerifyForm(), ErrorInline(), ErrorInlineProps, Confidence

### Community 42 - "work/page.tsx"
Cohesion: 0.27
Nodes (12): HomePage(), LeaveByMonth(), varianceSentence(), SalarySection(), dynamic, metadata, STATUS_CHIP, EmptyState() (+4 more)

### Community 43 - "gotify.ts"
Cohesion: 0.19
Nodes (11): alertPayslipPending(), appUrl(), GotifyMessage, JobFailureAlert, PayslipPendingAlert, RetrySuccessAlert, BASE_ENV, CONFIGURED (+3 more)

### Community 44 - "schema.ts"
Cohesion: 0.10
Nodes (11): BalanceSnapshot, FundDeposit, fundDeposits, funds, fundSettings, JobRun, jobRuns, LeaveDay (+3 more)

### Community 45 - "Finance Dashboard — Brand System"
Cohesion: 0.22
Nodes (8): 1. Strategy, 2. The mark, 3. Assets, 4. Colour, 5. Typography, 6. Voice, 7. Applications, Finance Dashboard — Brand System

### Community 46 - "teamsystem.ts"
Cohesion: 0.21
Nodes (16): parseItalianNumber(), coerceNumber(), bodyRow(), EMPTY, extractTeamSystem(), findGrid(), isNumericOnly(), numbersOf() (+8 more)

### Community 47 - "trek-sync.ts"
Cohesion: 0.16
Nodes (20): LeaveDaySaved, TrekCallOptions, trekConfigured(), TrekYearStats, empty(), JOB_NAME, runTrekSyncJob(), RunTrekSyncJobInput (+12 more)

### Community 48 - "cometa.ts"
Cohesion: 0.25
Nodes (15): loadPortfolioGain(), CometaCredit, cometaCreditedDeposits(), cometaSchedule(), creditedByMonth(), creditMonthFor(), JOINING_FEE, quarterIndex() (+7 more)

### Community 49 - "_lib/vacation.ts"
Cohesion: 0.22
Nodes (14): extractedField(), FerieView, loadFerie(), WorkPage(), averageNet(), averageTaxes(), ferieRemaining, leaveTakenByMonth() (+6 more)

### Community 50 - "render-brand-icons.py"
Cohesion: 0.33
Nodes (3): Rasterise the Finance Dashboard mark to PNG. No rasteriser is installed on this…, radius=0 renders a full-bleed square (maskable); otherwise a rounded square., render()

### Community 51 - "sweep.test.ts"
Cohesion: 0.19
Nodes (10): BALANCES, cache, historyRows(), latestRows(), RunRow, SnapshotRow, store, teableRows() (+2 more)

### Community 52 - "SalarySection.tsx"
Cohesion: 0.24
Nodes (8): OPTIONS, SalarySectionProps, SalaryWindow, WindowKey, StatEmphasis, StatGrid(), StatTile(), StatTileProps

### Community 53 - "Code 9837 - IMPONIBILE 5% L.199/25"
Cohesion: 0.50
Nodes (4): Code 9837 - IMPONIBILE 5% L.199/25, Code 9838 - IMPOSTA SOST. 5% L.199/25, Real Payslip Fixture: Giugno 2026 (doc 103), PAGA BASE / PREMIO PR. / SUPERM.ASS Row

### Community 54 - "index.ts"
Cohesion: 0.19
Nodes (9): dynamic, db, instance(), pool(), appSettings, vacationAccrualRate, vacationLedger, deleteEntry() (+1 more)

### Community 56 - "heartbeat.ts"
Cohesion: 0.41
Nodes (9): dynamic, GET(), HEARTBEAT_MAX_AGE_MS, heartbeatAgeMs(), heartbeatPath(), isHeartbeatStale(), readHeartbeat(), touchHeartbeat() (+1 more)

### Community 57 - "TimeSeriesChart.tsx"
Cohesion: 0.26
Nodes (12): ChartTokens, compactValue(), HoverState, monthKey(), monthTick(), monthToSeconds(), readTokens(), TICK_MONTH (+4 more)

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
Cohesion: 0.25
Nodes (6): auth, cache, DAY, repo, sync, trek

### Community 68 - "LeaveCalendar.tsx"
Cohesion: 0.32
Nodes (6): Editing, FRACTION_OPTIONS, KIND_OPTIONS, LeaveCalendarProps, LeaveCalendarView, LeaveMonthVariance

### Community 69 - "dashboard-app service"
Cohesion: 0.38
Nodes (7): dashboard-app service, dashboard-cron supercronic sidecar service, External networks proxy_public and db_internal, projects compose stack, read_only rootfs, cap_drop ALL, tmpfs and limits, Read-only secret file mounts (wallet-token, trek-token), Traefik router with X-Forwarded-Proto https middleware

### Community 70 - "_lib/leave.test.ts"
Cohesion: 0.25
Nodes (5): payroll, payslips, repo, trekState, vacation

### Community 72 - "August 2026 PDF-Text Fixture (clean layout)"
Cohesion: 0.28
Nodes (9): Code 001 - RETRIBUZIONE ORDINARIA, August 2026 PDF-Text Fixture (clean layout), TOTALE RITENUTE, Code 2 - LAVORO ORDIN.(mens.), Code 1101 - IRPEF A CREDITO -MOD.730-, Code 9208 - CREDITO COMPENSATO, Real Payslip Fixture: Luglio 2026 (doc 104, 730 refund), ARROTONDAMENTO (+1 more)

### Community 75 - "tracked-accounts.ts"
Cohesion: 0.14
Nodes (11): auth, cache, env, repo, teable, TrackedAccount, trackedAccounts, get() (+3 more)

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
- **472 isolated node(s):** `entrypoint.sh script`, `securityHeaders`, `nextConfig`, `name`, `version` (+467 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `cn()` connect `cn` to `settings/page.tsx`, `preview/page.tsx`, `LeaveCalendar.tsx`, `[slug]/page.tsx`, `actions/settings.ts`, `VerifyForm.tsx`, `work/page.tsx`, `Skeleton.tsx`, `OverviewClient.tsx`, `_lib/vacation.ts`, `format.ts`, `SalarySection.tsx`, `TimeSeriesChart.tsx`, `MonthGrid.tsx`, `(app)/page.tsx`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `env` connect `env` to `sweep.ts`, `teable.ts`, `settings/page.tsx`, `actions/settings.ts`, `wallet.ts`, `gotify.ts`, `monthly-snapshot.ts`, `machine.ts`, `index.ts`, `llm.ts`, `(app)/page.tsx`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `monthKeyOf()` connect `monthKeyOf` to `teable.ts`, `_lib/leave.ts`, `networth.ts`, `_lib/funds.ts`, `staleness.ts`, `actions/settings.ts`, `payslip-ingest.ts`, `fromCents`, `toCents`?**
  _High betweenness centrality (0.013) - this node is a cross-community bridge._
- **What connects `entrypoint.sh script`, `securityHeaders`, `nextConfig` to the rest of the system?**
  _472 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `sweep.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.14210526315789473 - nodes in this community are weakly interconnected._
- **Should `teable.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.08668076109936575 - nodes in this community are weakly interconnected._
- **Should `preview/page.tsx` be split into smaller, more focused modules?**
  _Cohesion score 0.10837438423645321 - nodes in this community are weakly interconnected._
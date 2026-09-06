# Phase 5 implementation decisions

This durable record preserves the implementation rulings and their tradeoffs.
See the checkpoint for verification and deployment state.

Ruling R5-C1: ContributionLike includes accrualPeriodEnd; actual posting +1 stays authoritative (spec §7.4). Preserve legacy visible +2 only as explicit validator comparison. Cost: intentionally changed historical monthly display timing, reported clearly.

Ruling R5-C2: opening capital is an auditable adjustment contribution; fixed monthly plan is forecast only, no fabricated recurring paid rows. Earliest legacy setting defines migrated initial capital exactly as legacy totalDeposited. Cost: distinguish planning from actual contributions in UI.

Ruling R5-C3: reversals negate originals including negative fees; no sign-only rejection of positive reversal. Payroll linkage is payroll provenance even source=migration. Cost: extra tests for provenance and reversal edge cases.

Ruling R5-C4: use parent fund row locks for financial mutations and explicit owner/currency account validation. Cost: same-fund writes serialize, avoiding duplicated reversals/openings/fees.

Ruling R5-C5: migration creates missing valuation accounts only from existing actual legacy snapshots; preserve exact snapshot values and dates, idempotent history import. Production inspection: both fund accounts missing; silo/trek connected, Wallet already error; 12 payroll records/imports visible under system context. Cost: two new manual accounts representing existing real funds, not invented values.

Ruling R5-C5 refinement: retain the legacy monthlyHistoryQuery winner, not every daily latest snapshot: periodic raw.kind=latest is a carried-forward fallback and must not override actual history. Use Europe/Rome months, non-latest first, captured_at/id descending. Cost: importing one canonical historical valuation per month (the exact displayed legacy figure), not redundant sweep snapshots.

Ruling R5-C6: quarterly spans alone cannot distinguish absent January/February payslips. Enrich contributions with optional payrollAccrualMonth via PayrollMonthsSource.liveRecords before detectIssues; exact month wins over span fallback. Cost: one extra source query, no schema column; false missing matches avoided.

Ruling R5-C7: expected payroll months must be fund-specific via mapped components (EXISTS), ordinary live payroll only. liveRecords gains includeExtraordinary=false; reconciliation requests true to enrich all linked contributions exactly. Prevents unrelated Cometa payroll from generating missing issues on Fideuram and extraordinary quarter spans masking absent ordinary months. Production mappings verified read-only. Task4 owns dependency correction and tests.

R5-C8: applyImport supports existing-record re-apply after verification; sink must replace contributions linked to current payrollRecordId as well as supersededRecordId, across owner funds. Otherwise unique violation/removed mapping stale rows. Remove original/reversal pair together preserving audit events, ordered fund locks. Task7 plan deviation recorded before implementation. Consider obsolete posting system fees when a mapping is removed; document policy/test.

Ruling R5-C9: Funds form input must use an exact localized decimal-string parser instead of the plan-mandated shared Number/toFixed shortcut, because accepted numeric(16,2) values demonstrably lose cents. Keep the fix Funds-scoped; malformed grouping/exponents/excess precision are refused. Cost: stricter form input validation, no shared-module behavior changes.

Ruling R5-C10: the chart formatter belongs in a Funds client wrapper receiving serializable currency/series props. A server closure cannot cross Next.js RSC boundaries. Cost: one small client wrapper; preserves currency formatting and existing chart component.

Ruling R5-C11: distinguish snapshot-created valuation accounts with durable funds-migration audit provenance (including exact snapshot key), so the validator checks full canonical history only for that path and accepts an existing valued account without legacy snapshots. Editable account notes alone are insufficient. Pre-fix rehearsal accounts can backfill provenance once from exact machine notes and an existing key; subsequent reruns write zero. Cost: one audit event per created/backfilled valuation account, preserving history checks after notes edits.

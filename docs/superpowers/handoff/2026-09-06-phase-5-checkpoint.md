# Phase 5 checkpoint — Funds

Implementation and local verification are complete; final review and production
redeployment are pending. This checkpoint will record the cutover before closure.
Phase 5 stacks on the deployed Phase 4 payroll pipeline and Company module.

## Behavior

Funds now have owner-scoped plans, effective schedules, signed contributions,
reversals and reconciliation. A manually maintained fund works independently
of payroll. Quarterly March accrual posts in April. Payroll apply/reapply and
supersession replace the related fund entries transactionally, retaining a
waived system fee when replacement contributions keep the same posting.

The Funds list, detail pages and Home read the module. Account-linked values
stay null when unavailable; mixed currencies are not added without conversion.
The REST API exposes eleven documented operations. Legacy fund tables remain
migration archives; application and payroll writes use the new module.

## Migration and operations

See [the deployment runbook](../../deploy/phase-5-runbook.md) for the isolated
rehearsal, targeted Compose cutover, backup and rollback sequence. The old app
must stop before schema migration 0016 renames the old funds table.

Production baseline on 2026-09-06: Fideuram deposited 5000.00 EUR, value
5174.54 EUR; Cometa posted net 2173.74 EUR, value 2228.13 EUR. Its Q3 accrual
posts in October. Combined value is 7402.67 EUR. Each fund has nine canonical
monthly valuations, January–September 2026.

## Verification

At commit `3ad5f9b`: type checking, 1,229 unit tests, 214 integration tests,
production build and OpenAPI drift check passed. Both Funds routes appear in
the build route table. Legacy references remain only in schema/migration code.

The production-data rehearsal created two funds, two linked accounts,
18 canonical valuations, two plans, two schedules and 35 contributions
(63 writes). The immediate rerun wrote zero rows. The reviewed provenance fix
then added two audit events; its next rerun again wrote zero. Validation remained
green after the independent snapshot-key checks were added. Independent validation passed
for two funds over 23 months, including future Q3 postings and four explicitly
reported changes from legacy visible dates to actual posting dates.

The final UI correction (`f196f2b`) passed 1,261 unit tests, type checking and
production build. Its regressions cover exact localized form amounts and the
serializable server/client chart boundary. The shared money parser is unchanged.

Authenticated Playwright checks used a synthetic local session against the
isolated production clone, with no production mutations. They passed:

- Both linked fund detail pages, Funds list and Home, plus 390px layouts with
  no document overflow or browser page errors.
- Real forms: create a manual fund, opening plan, quarterly schedule, comma
  decimal contribution, March-to-April posting, reversal and reconciliation.
- Exact persisted `90000000000000.01` from a localized form input.
- API idempotent replay, later plans leaving actual money unchanged, null
  valuation, and manual funds ignoring unrelated payroll months.
- Missing payroll-month detection, retained acknowledgement, and resolution
  after restoring the contribution.
- Synthetic verified payroll imports: March-to-April posting, employee/employer
  amounts, one fee, reapply, supersession, replacement after reversal, and
  preservation of a waived system fee.

The payroll walkthrough excludes document upload/extraction. Real OIDC login
has not been exercised; the local authenticated flows are separate evidence.

## Decisions and remaining scope

The phase plan records these five decisions:

- R5-1: rename the old `funds` table to `legacy_funds`; create the owner-scoped
  replacement without changing the archived foreign keys.
- R5-2: calculate posting from the schedule's accrual-period end plus its lag;
  quarterly March with lag one posts in April.
- R5-3: represent fees as signed contribution rows, with one system fee per
  posting and the legacy joining fee imported once.
- R5-4: replace superseded payroll contributions within the payroll transaction;
  preserve audit records when removing an original and its reversal.
- R5-5: reconcile idempotently, retaining acknowledgements and resolving issues
  that are no longer detected.

Implementation clarifications add that earliest opening capital becomes one auditable adjustment;
subsequent plans do not fabricate paid contributions. Legacy Cometa displayed
quarters one month later than actual posting; validation reports that intended
timing change explicitly. Missing valuation accounts use actual canonical
legacy snapshots, preserving the old monthly selection.

Dedicated `fund_valuations`, delayed/matched reconciliation, additional charts,
and contribution-type management remain deferred by the phase plan.

# Phase 5 checkpoint — Funds

**Implemented, reviewed and deployed on 2026-09-06 at 17:36 Europe/Rome.**
Phase 5 stacks on the deployed Phase 4 payroll pipeline and Company module.
The deployed application code is commit `0dc939e`; the final documentation
commit records this checkpoint and the updated code graph.

## Behavior

Funds have owner-scoped plans, effective schedules, signed contributions,
reversals and reconciliation. A manually maintained fund works independently
of payroll. Quarterly March accrual posts in April. Payroll apply/reapply and
supersession replace related entries transactionally, preserving waived fees
when replacement contributions retain the same posting.

The Funds list, detail pages and Home read the module. Account-linked values
stay null when unavailable; mixed currencies are not added without conversion.
The REST API exposes eleven documented operations. Contribution/reversal APIs
serialize principal/key pairs and commit their successful replay response with
the financial mutation. Only committed 201 successes consume new keys.

Money remains exact in form input, stored rows, aggregate response contracts
and displayed text, including chart tooltips and accessible tables. Chart
coordinates use numbers. Legacy slug bookmarks redirect to owned UUID routes;
unknown identifiers return normal not-found responses.

## Deployment

Service: `dashboard-app`, at <https://fin.longobardo.me>.

Image: `sha256:4c490096cc1118506b55a02d9e75bdec9288dbf02268112890caaa5bc867fec5`.

The image was built before stopping the old app. A final custom-format backup
was then taken and its archive verified: 170441 bytes, mode 0600, at
`/home/mattia/backups/personal-dashboard/2026-09-06-phase5/pre-phase5-final.dump`.
The rollback image remains `dashboard:pre-phase5-20260906`.
See [the runbook](../../deploy/phase-5-runbook.md) for backup and restore steps.

Bundled schema migration, fund migration and independent validation passed.
Production imported two funds, two accounts, eighteen valuations, two plans,
two schedules, thirty-five contributions and two provenance audit events:
65 writes. A second migration wrote zero. Validation examined two funds over
23 months and reported four intended legacy-visible/actual-posting differences.
The database now has seventeen migrations through 0016 and ten accounts.

| Fund | Posted deposited total, September 2026 | Latest value |
|---|---:|---:|
| Fideuram | 5000.00 EUR | 5174.54 EUR |
| Cometa | 2173.74 EUR | 2228.13 EUR |

Values sum to 7402.67 EUR. Cometa includes its 10.32 joining fee and three posted
quarterly fees; Q3 posts in October. Each fund has nine canonical monthly
valuations, January–September 2026. These values were asserted directly after
production migration. Legacy tables remain migration archives.

Post-deploy checks: container healthy, `/api/health` 200 with database up,
unauthenticated `/api/v1/funds` 401, and `/finance/funds` 307 to sign-in.
No dashboard scheduler was running before cutover, so none was started.
All service commands targeted only `dashboard-app`, with no dependency restart.

## Verification

Final full gates on `0dc939e`: **1287 unit tests in 143 files, 219 integration
tests in 42 files**, typecheck, production build, Docker build, OpenAPI generation
with zero drift, and diff check passed. Both Funds routes appear in the build.
Legacy references remain only in schema/migration code; runtime fee constants
and legacy fund writes are removed. Full-branch review plus the combined fix
rereview approved all findings with no remaining Critical/Important issue.

The isolated production-copy migration passed before browser mutations. It
first wrote 63 rows, then zero; the later provenance correction added two audit
events and again reran with zero writes. The final validator passed the same
23-month data check. Migration fixture tests also covered existing valued
accounts without snapshots, incorrect snapshot identities, future-row loss,
canonical valuation corruption, ambiguous accounts and owner-count refusal.

Authenticated Playwright used a synthetic local session against that isolated
copy. The following passed without browser page errors:

- Linked fund pages, list and Home; both real fund details at 390px without
  document overflow.
- Real forms for manual creation, opening plan, quarterly schedule, comma-decimal
  contribution, March-to-April posting, reversal and reconciliation.
- Exact persistence and displayed cents for `90000000000000.01`.
- Sequential replay, later plans leaving paid money unchanged, null valuation
  and manual funds ignoring unrelated payroll months.
- Missing-month detection, retained acknowledgement and resolution after restore.
- Synthetic verified payroll imports: employee/employer posting, one fee,
  reapply, supersession, replacement after reversal and waived-fee preservation.
- Four overlapping identical API requests returning the same 201 body and one
  contribution; conflicting bodies returning 201/422; an exact aggregate of
  `120000000000000.00`; legacy redirects and invalid-ID not-found behavior.

Real-Postgres regressions additionally injected audit/cache failures and proved
rollback of both the financial entry and replay state. The payroll walkthrough
excludes upload/extraction. **Real OIDC login remains untested**; local session
checks and public production auth-gating checks are separate evidence.

`graphify update .` completed: 4523 nodes, 13115 edges, 184 communities, AST-only
without API cost. Its optional SQL parser is absent; SQL was covered directly
by migration review and PostgreSQL tests. Existing pg/PDF/Next warning noise
remains a platform cleanup item.

## Decisions and remaining scope

R5-1 preserves the legacy table by renaming it; R5-2 uses accrual-period end plus
posting lag; R5-3 stores fees as rows; R5-4 replaces superseded payroll entries
transactionally; R5-5 reconciles idempotently while retaining acknowledgements.
The [implementation decision ledger](2026-09-06-phase-5-ledger.md) records the
additional rulings, rationale and costs, including exact money, fee reversals,
fund-specific payroll matching and independently verified snapshot provenance.

Dedicated `fund_valuations`, delayed/matched reconciliation, more charts and
contribution-type management remain deferred by the phase plan. Extreme-width
amounts can clip a currency suffix in a fixed summary tile; exact cents and
full contribution text remain available. Long-number layout polish is deferred.

Private verification artifacts are preserved alongside the backup in
`/home/mattia/backups/personal-dashboard/2026-09-06-phase5/verification/`.
No remote push was performed. Phase 6 was not started.

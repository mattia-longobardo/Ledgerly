# Finance Dashboard API

REST API mounted at `/api/v1`, built with Hono + `@hono/zod-openapi`
(`dashboard-app/src/platform/http/app.ts`). The full machine-readable contract
is [`openapi.json`](./openapi.json) in this directory; this file is the
narrative version — how to authenticate, what errors look like, and how to
work with the conventions the generated document doesn't spell out on its
own.

## Authentication

Two credentials, checked in this order (`src/platform/http/authenticate.ts`):

1. **`Authorization: Bearer pat_…`** — a personal access token. See
   **Security** below.
2. **The session cookie.** Sign in through the app (`/signin` → Authentik
   OIDC); the browser's `__Host-authjs.session-token` cookie then
   authenticates every `/api/v1/*` request. `securitySchemes.session` is
   `apiKey / cookie / __Host-authjs.session-token`.

A request that carries an `Authorization: Bearer pat_…` header is decided by
that token alone — there is **no fallback to the cookie** when it fails.
Falling back would mean a revoked or expired token kept working for anyone who
happened to be signed in, which is precisely when a revocation has to be
visible. A `Bearer` credential of some other shape is not ours and is ignored,
so the cookie decides.

Every request without a valid credential gets `401 unauthorized`
(`src/platform/http/app.ts`'s auth middleware, ahead of rate limiting and the
route handlers). Scripts and jobs calling the API from outside a browser
should use a token; carrying the cookie explicitly still works (see
`docs/deploy/phase-1-runbook.md` step 6 for the exact `curl` invocation).

Machine-to-machine job triggers (`POST /api/jobs/tick?tier=...`) are a
separate, non-`/api/v1` endpoint authenticated by `X-Cron-Secret`, not part of
this document.

Every authenticated route in `openapi.json` now advertises **both** schemes
(`security: [{ session: [] }, { bearer: [] }]`, the shared
`AUTHENTICATED_SECURITY` constant in
`src/platform/http/security-schemes.ts`). Before Phase 9 the routes declared
the cookie alone, which told a token holder their token would not work and left
clients generated from the document unable to send one — a documentation bug,
not a behavioural one: `authenticate` has accepted both since Phase 8. The one
exception is `/security/tokens*`, which stays session-only on purpose so a
leaked token cannot mint its own successor.

## `X-Requested-With` on writes

Every `POST`/`PUT`/`PATCH`/`DELETE` authenticated by the session cookie must
carry an `X-Requested-With` header with any non-empty value; without it the
request is refused with `403 csrf_required` before it reaches a handler
(spec §8.3, `src/platform/http/app.ts`).

The header's *value* is never inspected — only its presence. It works because
a cross-site HTML form cannot set a custom header: adding one forces a CORS
preflight, which this app answers for nobody, so a hostile page can no longer
ride along on the browser's cookie. Reads (`GET`) are unaffected.

```bash
curl -X POST "https://$DASHBOARD_HOST/api/v1/integrations/wallet/sync" \
  -H "Cookie: __Host-authjs.session-token=<cookie>" \
  -H "X-Requested-With: curl"
```

**Token-authenticated writes are exempt.** A browser never attaches an
`Authorization` header on its own, so a cross-site form cannot forge one and
there is nothing for the header to defend against. The check keys on how the
request authenticated, not on the path.

## Error envelope

Every error response has the same shape:

```json
{
  "error": {
    "code": "not_found",
    "message": "Human-readable, safe to show",
    "requestId": "3f2a...",
    "details": { "...": "optional, present on validation_failed and conflict" }
  }
}
```

`code` is one of a fixed catalogue (`src/platform/http/errors.ts`):

| Code | Status | When |
|---|---|---|
| `validation_failed` | 422 (or 428 for a missing `Idempotency-Key`) | request body/query fails its Zod schema |
| `unauthorized` | 401 | no session |
| `permission_denied` | 403 | session lacks the required permission |
| `csrf_required` | 403 | cookie-authenticated write without `X-Requested-With` (see the section above) |
| `not_found` | 404 | no such resource, or it belongs to another user (RLS makes the two indistinguishable) |
| `conflict` | 409 | e.g. deleting an account still referenced elsewhere without `confirmSynced` |
| `version_mismatch` | 409 | optimistic-concurrency check failed |
| `precondition_required` | 428 | a write that needs a version sent none (no `If-Match`, no body `version`) |
| `idempotency_key_reused` | 422 | same `Idempotency-Key` sent with a different request body |
| `rate_limited` | 429 | over the per-minute limit |
| `integration_unavailable` | 503 | the provider itself failed or was unreachable during connect/test/sync (an `UpstreamError`) — not the same as "not connected", which is a `409 conflict` |
| `internal` | 500 | unhandled — logged server-side with `requestId`, nothing else leaks |

`requestId` is also echoed on the response as the `x-request-id` header
(taken from the request's own `x-request-id` if it sent one) — quote it when
reporting a problem.

## Pagination

Cursor-based on the one paginated endpoint today,
`GET /accounts/{id}/balances`:

- `limit` — clamped to `[1, 200]`, defaults to 50.
- `cursor` — the base64url encoding of the previous page's last item's
  `asOf`; omit it for the first page.
- Response: `{ "items": [...], "nextCursor": "..." }` — `nextCursor` is
  present only when there's another page.

Other list endpoints (`GET /accounts`, `GET /account-groups`) are not
paginated — they return everything the caller owns, which is small by
construction (one person's accounts and groups).

## `Idempotency-Key`

Required (`428 validation_failed` if missing — a `428`, not `422`, on the
*header itself* being absent) on:

- `POST /accounts`
- `POST /accounts/{id}/balances`
- `POST /funds/{id}/contributions`
- `POST /funds/{id}/contributions/{cid}/reverse`
- `POST /budgets/{id}/usages`

Send any client-generated unique string (a UUID is fine). The server hashes
`METHOD path\nbody` and stores it against `(principalId, "<namespace>:<key>")`
for 24 hours, where `<namespace>` is the owning module (`accounts`, `funds`,
`budgets`). The namespace is internal: the `Idempotency-Key` you send is never
itself prefixed, it only scopes how the row is addressed, so the same literal
key value used against two different modules is two independent keys.

- Same key, same request → the original response is replayed verbatim
  (including the original status code), no re-execution.
- Same key, different request → `422 idempotency_key_reused`.
- New key → executes normally, and is cached only if it succeeds.
- A failure is **not** cached, `4xx` or `5xx` alike: the write and its
  idempotency row commit in one transaction, so an error rolls both back and a
  retry with the same key runs the handler again rather than replaying the
  failure for 24 hours.

This makes retried creates safe under a flaky connection: retry with the same
key and you get the account you already created back, not a duplicate. The
write, its audit and event rows, and the idempotency row all commit together,
serialized per `(namespace, principalId, key)`, so two concurrent retries
carrying one key cannot both execute.

## Optimistic concurrency (`If-Match` / `version`)

Every mutable entity — accounts, groups — carries an integer `version`.
`PATCH /accounts/{id}` (and the group rename/delete routes) require you to
say which version you're updating:

- `If-Match: "3"` header (quotes optional, stripped if present), **or**
- `"version": 3` in the request body.

If neither is present: `428 precondition_required`. If the version doesn't match
the current one: `409 version_mismatch` — someone else changed it first;
re-`GET`, look at the fresh `version`, and retry.

**Not every table has one.** `transaction_categories`, `transaction_labels`,
`sync_jobs` and `reconciliation_issues` carry no `version` column, so the
management routes added in Phase 9 for them
(`PATCH /expenses/categories/{id}`, `PATCH /expenses/labels/{id}`,
`PATCH /integrations/{provider}/sync-jobs/{kind}`,
`POST /reconciliation/issues/{id}/resolve`) take no `If-Match` and answer no
`428`. They are last-writer-wins patches over a handful of fields, and each
write records what it changed in `audit_events`.
`PATCH /payroll/mapping-rules/{id}` does carry a version and follows the rule
above.

## Versioning

The whole surface is namespaced `/api/v1` — a breaking change gets `/api/v2`
alongside it, not an in-place change. There is no per-route version header.

## Integrations

Full narrative guide: [`docs/integrations/README.md`](../integrations/README.md).

`POST /integrations/{provider}/connect`'s request body carries a
write-only `credentials` object — the exact fields depend on the provider
(`GET /integrations` lists each one's `credentialFields`). It is never
echoed back: no response schema in this API has a `credentials` field at
all, so there is nothing to accidentally leave populated later.

`POST /integrations/{provider}/sync` answers `{ "run": SyncRun }` and is
**idempotent per running job**: a second call while a sync for that
`(connection, kind)` is already in flight returns the run already in
progress rather than starting a second one against the same provider.

`POST /webhooks/{provider}` is the one unauthenticated route under
`/api/v1` — no session cookie, and therefore no `X-Requested-With` either.
It verifies `X-Signature: sha256=<hex>` (HMAC-SHA256 over the raw body)
against the receiving connection's own `webhookSecret` instead. Any failure
— bad signature, unknown provider, unreadable body, or a sync it would
queue being switched off — answers a flat `404`, the same for every cause,
so the endpoint never confirms what does or doesn't exist. A successful
call answers `202` and queues the work; it does not run the sync inline
(see `docs/integrations/README.md` §6).

`PATCH /integrations/{provider}/sync-jobs/{kind}` (Phase 9,
`integrations.manage`) takes `{"enabled": true|false}` and switches one sync
kind on or off without disconnecting the provider. A disabled kind is skipped by
the scheduler and refuses an inbound webhook delivery for that kind; its cursor
is left alone, so switching it back on resumes rather than re-imports. A
provider that is not connected has no `sync_jobs` rows to toggle and answers
`422 validation_failed`.

Inbound webhooks carry two guards (Phase 9): the same signed body seen twice
within 24 hours is answered `202` with `queued: 0` and enqueues nothing — an
idempotent acknowledgement, so a provider retrying a delivery whose response it
never saw does not turn one event into two syncs — and a connection sending more
than 60 deliveries a minute gets `429 rate_limited`.

### Breaking changes in Phase 2

`POST /api/v1/integrations/wallet/sync` **keeps its path**, but:

- It now answers `{ "run": SyncRun }` instead of the Phase-1 result shape —
  the counts that used to be the top-level response body are now under
  `run.stats`.
- It no longer requires the `owner` role. The only permission it checks is
  `integrations.manage` — a connection has its own owner now, so the
  Phase-1 restriction (a sync rewrites the whole household account graph,
  and there was no per-connection owner to scope it to) no longer applies.
- A `sync_runs` row returned from this or any integrations route can be
  `status: "queued"` — a run a webhook created before anything executed it.
  A caller that only expected `running`/`success`/`failed` should treat
  `queued` as "accepted, not yet started," not as an error shape.

## Expenses

`GET /transactions`, `GET /transactions/{id}`, `PATCH /transactions/{id}`,
`GET /transaction-categories`, `GET /transaction-labels`,
`GET /transactions/recurring-patterns`. Transactions, categories and labels
are read-only from the Wallet sync's point of view — the sync creates and
updates them; a user can only recategorise, label and annotate what already
exists. `PATCH /transactions/{id}` follows the same `If-Match`/`version`
convention as `PATCH /accounts/{id}`.

Categories and labels themselves are managed under `/expenses/…` (Phase 9):
`POST /expenses/categories`, `PATCH /expenses/categories/{id}`,
`POST /expenses/labels`, `PATCH /expenses/labels/{id}`, all gated on
`finance.manage`. The read routes keep their older `/transaction-categories`
and `/transaction-labels` paths.

Two rules are worth knowing before you call them:

- **Archiving is not deleting.** `PATCH /expenses/categories/{id}` with
  `{"archived": true}` sets `archived_at`; the row stays, and every transaction
  that points at it keeps pointing at it. `{"archived": false}` brings it back.
  There is no delete — it would orphan history.
- **A provider-mirrored category cannot be renamed here.** A category the
  Wallet sync mirrors has a `provider_links` row, and the sync rewrites its name
  from the provider on every pass; accepting a rename would look like it worked
  and be silently undone. It answers `422 validation_failed`. Its `color` and
  `parentId` are local-only and stay editable.

## Interests

`GET /interest-rules`, `POST /interest-rules`, `GET /interest-rules/{id}`
(accepts `periodStart`, `periodEnd`, `projectionDays` query parameters and
returns the rule together with its accruals, entries, a reconciliation
summary for the period, and a forward projection), `PATCH /interest-rules/{id}`.
The reconciliation summary's `status` is one of `matched`, `missing`,
`delayed`, `anomalous`, or `no_data` — `no_data` means no accrual rows exist
for the period yet (the daily job hasn't reached it), which is a distinct
fact from `matched` and never reported as a match made from zero evidence.
Every rule defaults to `postingMode: "analyze_only"`; flipping it to
`"post_to_provider"` is the only way this API ever writes to Wallet, and only
for a rule whose account is still a live synced Wallet account with a
connected integration — see
[`dashboard-app/docs/migration/wallet-manager-cutover.md`](../../dashboard-app/docs/migration/wallet-manager-cutover.md)
for the operational procedure.

## Funds

`GET /funds` lists active funds and their current valuation, deposited total,
absolute return and open-issue count; pass `includeArchived=true` to include
archived funds. `POST /funds` creates one, and `GET /funds/{id}` returns its
effective plan and schedule together with their history, contributions,
quarterly totals, value series and reconciliation issues. Monetary values stay
decimal strings throughout the API.

`PATCH /funds/{id}` follows the shared `If-Match` / body `version` convention.
Schedules and plans are effective-dated records created with
`POST /funds/{id}/schedules` and `POST /funds/{id}/plans`; schedule posting lag
is limited to 0–12 months. `GET /funds/{id}/contributions` accepts inclusive
`from` and `to` month keys in `YYYY-MM-01` form and returns
`{ "items": [...], "nextCursor": null }`.

Contribution creation and reversal use the two idempotent endpoints listed
above. Each principal/key pair is serialized, and the committed `201` response
is stored in the same transaction as the financial mutation. Concurrent
identical requests replay that result; a different body with the same live key
returns `422`. An uncached error is re-evaluated on retry. Computed totals and
returns may exceed the numeric(16,2) limit of an individual stored contribution;
they remain exact decimal strings in the response contract.

Reversals create a compensating contribution and leave the original
record intact. `POST /funds/{id}/reconcile` refreshes the issue set, and
`POST /funds/issues/{issueId}/acknowledge` acknowledges an open issue. Fund
responses never expose ownership or resolver user IDs.

`GET /reconciliation/issues` (Phase 9) is the cross-domain list: every issue the
caller owns, whatever wrote it, newest first, with `domain`, `status` and
`severity` filters and the usual `cursor`/`limit` pagination.
`POST /reconciliation/issues/{issueId}/resolve` closes one for good — the
counterpart of `acknowledge` ("seen, still true"). Resolving takes the row out
of the partial unique index that keeps one live issue per (entity, kind), so if
the condition recurs a *fresh* issue is opened rather than the old one being
quietly reused; resolving an already-resolved issue is `404`. Both are gated on
`finance.manage`, not `funds.read`, because they span domains.

## Payroll

`GET /payroll/imports`, `POST /payroll/imports` (multipart, `file` part),
`GET /payroll/imports/{id}`, `POST /payroll/imports/{id}/verify`,
`POST /payroll/imports/{id}/reject`, `POST /payroll/imports/{id}/apply`,
`POST /payroll/imports/{id}/retry`, `GET /payroll/imports/{id}/original`,
`GET /payroll/records`, `GET /payroll/records/{id}`, `GET /payroll/earnings`.

The upload is idempotent on the **sha256 of the bytes, per user**, enforced by a
database constraint rather than an application check: uploading the same file
twice answers `409 duplicate` with `details.existingImportId`, and can therefore
never produce two payroll records. `Idempotency-Key` is honoured by a second
constraint on `(user_id, idempotency_key)`; the platform idempotency middleware
is deliberately not used here, because it hashes and stores the whole request
body and the body is a 10 MB binary.

`POST .../verify` and `POST .../reject` follow the same `If-Match`/`version`
convention as `PATCH /accounts/{id}`. `POST .../apply` is idempotent and
re-runnable but **not reversible**: the reverse of a wrong apply is uploading a
corrected payslip, whose apply supersedes the previous record.

`GET .../original` streams the stored PDF with `Cache-Control: no-store` and is
recorded in `audit_events`. It answers `409 conflict` — never the bytes — for an
import whose malware scan has not returned clean, and for one whose original the
retention job has already purged.

`GET /payroll/earnings` computes gross, net, taxes and contributions per month,
quarter and year from `payroll_records` and `payroll_components`, excluding
superseded records. A figure the payslip did not state is `null`, never `0`.

`GET /payroll/mapping-rules`, `POST /payroll/mapping-rules`,
`PATCH /payroll/mapping-rules/{id}` and `DELETE /payroll/mapping-rules/{id}`
(Phase 9, `payroll.review`) manage the rules that classify a payslip component
into a kind and a target. The `GET` returns the seeded global catalogue merged
with the caller's own rules in the order the classifier resolves them
(`priority asc, id asc`), each carrying `global` and `version`.

- A **global** rule has `global: true`, `version: null` and an id like
  `global-000`: it lives in code (`DEFAULT_MAPPING_RULES`), has no database row,
  and cannot be edited or deleted. Override one by adding your own rule at a
  lower `priority`.
- `priority` defaults to `100 + n`, where *n* is how many rules you already
  have, so a new rule lands after the globals and after your earlier ones. Pass
  it explicitly (below 100) to shadow a global.
- `matchLabel` is a regular expression and is compiled when the rule is saved;
  an invalid pattern is `422 validation_failed` rather than a rule that
  silently never matches. `matchCode` is compared literally against the
  parser's own field codes. A rule needs at least one of the two.

## Budgets

`GET /budgets` lists the caller's budgets with their current figures
(`initial`, `allocated`, `used`, `remaining`, `goalProgress`); pass
`includeArchived=true` to include archived budgets. `POST /budgets` creates
one together with its first amount version. `GET /budgets/{id}` returns full
detail: amount-version history, allocations (each with its `sourceLabel` and
`availableInSource` when sourced from a fund or account), scopes, usages,
recent events, and a month-by-month `remaining` series — and, as a side
effect, refreshes scope-matched usages first, so the detail a caller reads is
always current.

`PATCH /budgets/{id}` follows the shared `If-Match` / body `version`
convention. Archiving is `PATCH { "status": "archived" }` — the server sets
`archivedAt` itself; a caller cannot set `archivedAt` directly, and `version`
never reaches the underlying patch (it is consumed for the concurrency check
and stripped before the patch is applied).

`POST /budgets/{id}/amount-versions` records a new initial-amount version
effective from a given date, preserving history rather than overwriting it.
Allocations are virtual: `POST /budgets/{id}/allocations` never moves money,
it only affects the budget's computed figures; `sourceKind` is `fund`,
`account`, or `none`, and a sourced allocation must reference a fund or
account the caller owns. `PATCH /budgets/{id}/allocations/{aid}` ends an
allocation by setting `effectiveTo` (body `{ "version": ..., "effectiveTo":
"YYYY-MM-DD" }`, same `If-Match`/`version` convention).

`PUT /budgets/{id}/scopes` replaces the full scope set for a budget in one
call (an `account`, `category`, `label`, or `fund` scope; a `fund` scope
never matches a transaction, since transactions aren't posted against
funds) and triggers a refresh of scope-matched usages. `POST
/budgets/{id}/usages` records a manual usage row and requires an
`Idempotency-Key`, since it is a financial record; `DELETE
/budgets/{id}/usages/{uid}` removes one (`204`) — only a manual row, never a
scope-matched one. `POST /budgets/{id}/refresh` recomputes scope-matched
usages against the transaction ledger on demand and reports `{ inserted,
updated, deleted }`.

Money stays a decimal string throughout, including `remaining` (which can be
negative). Budget, allocation, usage and event responses never expose
ownership fields.

## Time off

`GET /timeoff/types` lists the caller's time off types and, on the first call
that touches the module, seeds the three defaults (`vacation`, `permits`,
`comp`) with the `hoursPerDay` the app setting carries. There is no route to
edit a type in this phase.

`GET /timeoff/workspace?year=&date=` returns one year in a single read: the
types, the latest balance per type (`remainingHours`, `remainingDays`,
`usedYtdHours`, `asOf`, `source`), every booked day of the year keyed by date
in `byDate`, the day named by `date` in `selected`, the next ten days ahead in
`upcoming`, `plannedDaysYtd`, how many days are still waiting for the Trek sync
in `pendingCount`, whether Trek is connected, and Trek's own last-cached
figures. `year` defaults to the current one.

`GET /timeoff/events?from=&to=` lists the booked days in a closed range,
`date asc`. `GET /timeoff/balances?year=` returns every balance row whose
`asOf` falls in that year, oldest first — one row per applied payslip, never
summed (a payslip's used figure is already year-to-date).

`PUT /timeoff/events/{date}` books or changes one day (`fraction` is `"1.00"`
or `"0.50"`, `typeCode` one of the five codes, `note` optional). `DELETE
/timeoff/events/{date}` removes one (`204`). Neither carries an
`Idempotency-Key`: a day is addressed by its own date, so the write is
idempotent by construction, and a booked day is not a financial record.
Saturdays and Sundays are refused with `422 validation_failed` — Trek's own
plan blocks them, so a round trip could only ever come back refused. So is a
date that is well shaped but not a real calendar day (`2026-02-31`), on every
route that takes one.

Both writes are **staged, never sent**: the day is saved locally with
`pendingOp` set, and the Trek sync is the only thing that talks to the
provider. A day Trek holds is kept as a tombstone (`pendingOp: "delete"`)
until the next pass carries the removal upstream; a day Trek has never held is
deleted outright.

Every quantity — fractions, hours, days, balances — is a two-decimal string,
and `null` means "no figure on file", rendered as "—" by the UI. It is never
`"0.00"`. Type, event and balance responses expose no ownership fields.

## Security

`POST /security/tokens` creates a personal access token, `GET /security/tokens`
lists the caller's own, `DELETE /security/tokens/{id}` revokes one (`204`).
There is no permission code on any of the three: a token can only ever grant
what its owner already holds, so managing your own is not a privilege on top
of being an active user.

**These three routes are session-only.** A request authenticated by a token
gets `403 permission_denied` whatever its scopes say — a token that could mint
or revoke tokens would turn one leak into a permanent, self-renewing foothold
that survives revoking the token it came from.

### The token

`pat_<8 character prefix>.<43 character secret>`. The database keeps the
prefix and `sha256(<whole token>)`; the plain token exists only in the `201`
body of the request that created it and is never retrievable again — `GET
/security/tokens` has no `token` field, and neither has the audit row
(`security.token_created` records the name, prefix, scopes and expiry).

```bash
curl "https://$DASHBOARD_HOST/api/v1/accounts" \
  -H "Authorization: Bearer $DASHBOARD_TOKEN"
```

### Scopes

`scopes` is a list of permission codes and must be a **subset of the caller's
current permissions** at creation (`422 validation_failed` otherwise). At
every use the token's scopes are re-intersected with the owner's permissions
*as they are then*, so demoting a user immediately shrinks every token they
hold; nothing has to be re-issued or swept. A call outside the resulting set
is `403 permission_denied` exactly as it would be for a session.

### Lifetime

`expiresAt` is optional; omit it or send `null` for a token that does not
expire. A token stops authenticating the moment it is revoked, the moment it
expires, or the moment its owner stops being `active` — all three answer `401
unauthorized`. `lastUsedAt` is stamped at most once a minute per token, so a
busy client does not turn every read into a write.

## Regenerating `openapi.json`

The document is generated from the same `createRoute`/Zod schemas the route
handlers use, so it cannot drift from the code by construction — except that
the *committed file* can go stale after an edit. A test enforces that it
doesn't: `src/platform/http/openapi-drift.test.ts` fails if
`scripts/openapi.ts`'s output no longer matches `docs/api/openapi.json`.

```bash
cd dashboard-app
npm run openapi:generate   # writes docs/api/openapi.json
npm test                   # openapi-drift.test.ts should now pass
```

Run this after adding or changing a route, before committing.

## Endpoints (Phase 1 + Phase 2)

All under `/api/v1`. Every route accepts a session cookie or a personal access
token *except* the inbound webhook, which authenticates itself by HMAC instead
(see **Integrations** below), and `/security/tokens*`, which is session-only. Every session route also requires a permission, enforced inside the
use case it calls (reads need `accounts.read`, writes need
`accounts.write`, deletes need `accounts.delete`, every integrations route
needs `integrations.manage`) — see `src/platform/auth/permissions.ts` for
the full grant per role:

| Method | Path | Notes |
|---|---|---|
| `GET` | `/accounts` | `?months=&includeArchived=` — each item includes latest balance + monthly trend |
| `POST` | `/accounts` | requires `Idempotency-Key` |
| `GET` | `/accounts/{id}` | `?months=` — includes history, trend, and the provider link if synced |
| `PATCH` | `/accounts/{id}` | requires `If-Match` or body `version` |
| `DELETE` | `/accounts/{id}` | `?confirmSynced=true` to force-archive a synced account instead of erroring |
| `POST` | `/accounts/{id}/balances` | requires `Idempotency-Key`; manual accounts only |
| `GET` | `/accounts/{id}/balances` | cursor-paginated, newest first |
| `GET` | `/account-groups` | |
| `POST` | `/account-groups` | |
| `PATCH` | `/account-groups/{id}` | |
| `DELETE` | `/account-groups/{id}` | accounts in the group become ungrouped, not deleted |
| `GET` | `/net-worth` | `?months=` — total and per-account monthly series |
| `GET` | `/integrations` | every registered provider, with its connection when there is one |
| `POST` | `/integrations/{provider}/connect` | stores and tests a credential; a failed test is still `200` |
| `POST` | `/integrations/{provider}/test` | re-tests the stored credential |
| `POST` | `/integrations/{provider}/sync` | see **Breaking changes in Phase 2** below |
| `POST` | `/integrations/{provider}/disconnect` | destroys the credential and applies a disconnect policy |
| `GET` | `/integrations/{provider}/sync-runs` | `?limit=` (1–10, default 10) — most recent first |
| `PATCH` | `/integrations/{provider}/sync-jobs/{kind}` | `{"enabled":…}`; `422` when the provider is not connected |
| `POST` | `/webhooks/{provider}` | **not** session-authenticated — see **Integrations** below |
| `POST` | `/expenses/categories` | `finance.manage` |
| `PATCH` | `/expenses/categories/{id}` | no `If-Match` (no `version` column); a provider-mirrored category refuses a rename |
| `POST` | `/expenses/labels` | `finance.manage` |
| `PATCH` | `/expenses/labels/{id}` | no `If-Match` |
| `GET` | `/payroll/mapping-rules` | `payroll.review`; globals merged with the caller's own, classifier order |
| `POST` | `/payroll/mapping-rules` | `priority` defaults to `100 + n` |
| `PATCH` | `/payroll/mapping-rules/{id}` | requires `If-Match` or body `version`; user rules only |
| `DELETE` | `/payroll/mapping-rules/{id}` | `204`; user rules only |
| `GET` | `/reconciliation/issues` | `finance.manage`; `?domain=&status=&severity=&cursor=&limit=` |
| `POST` | `/reconciliation/issues/{issueId}/resolve` | `finance.manage`; `404` if already resolved |
| `POST` | `/security/tokens` | session-only; the `201` body carries `token` once |
| `GET` | `/security/tokens` | session-only; never the token or its hash |
| `DELETE` | `/security/tokens/{id}` | session-only; `204` |

See [`openapi.json`](./openapi.json) for the full request/response schemas,
or serve it with any Swagger UI / Redoc instance pointed at
`https://<dashboard-host>/api/v1/openapi.json` (itself session-gated, per the
smoke test).

**Base URL.** Every path key in the document is already absolute
(`/api/v1/accounts`, …), so `servers` is `[{ "url": "/" }]` — the origin root.
Resolve a request as origin + path key; do not prepend `/api/v1` a second
time. Point a client at `https://<dashboard-host>` as its server, not at
`https://<dashboard-host>/api/v1`.

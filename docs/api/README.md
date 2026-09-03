# Finance Dashboard API

REST API mounted at `/api/v1`, built with Hono + `@hono/zod-openapi`
(`dashboard-app/src/platform/http/app.ts`). The full machine-readable contract
is [`openapi.json`](./openapi.json) in this directory; this file is the
narrative version — how to authenticate, what errors look like, and how to
work with the conventions the generated document doesn't spell out on its
own.

## Authentication

Today: **session cookie only.** Sign in through the app (`/signin` →
Authentik OIDC), then the browser's `__Host-authjs.session-token` cookie
authenticates every `/api/v1/*` request — there is no separate API key flow
yet. `security: [{ session: [] }]` on every route in `openapi.json` documents
this (`securitySchemes.session` is `apiKey / cookie /
__Host-authjs.session-token`).

Every request without a valid session gets `401 unauthorized`
(`src/platform/http/app.ts`'s auth middleware, ahead of rate limiting and the
route handlers). Scripts and jobs that need to call the API from outside a
browser have to carry that cookie explicitly (see
`docs/deploy/phase-1-runbook.md` step 6 for the exact `curl` invocation).

**Personal access tokens are deferred to Phase 8.** They will add
`Authorization: Bearer <token>` with scopes, without changing anything
described here.

Machine-to-machine job triggers (`POST /api/jobs/tick?tier=...`) are a
separate, non-`/api/v1` endpoint authenticated by `X-Cron-Secret`, not part of
this document.

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
| `validation_failed` | 422 (or 428 for a missing header) | request body/query fails its Zod schema |
| `unauthorized` | 401 | no session |
| `permission_denied` | 403 | session lacks the required permission |
| `not_found` | 404 | no such resource, or it belongs to another user (RLS makes the two indistinguishable) |
| `conflict` | 409 | e.g. deleting an account still referenced elsewhere without `confirmSynced` |
| `version_mismatch` | 409 (or 428 if no version was sent) | optimistic-concurrency check failed |
| `idempotency_key_reused` | 422 | same `Idempotency-Key` sent with a different request body |
| `rate_limited` | 429 | over the per-minute limit |
| `integration_unavailable` | 503 | e.g. Wallet sync called with no token configured |
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

Send any client-generated unique string (a UUID is fine). The server hashes
`METHOD path\nbody` and stores it against `(principalId, key)` for 24 hours:

- Same key, same request → the original response is replayed verbatim
  (including the original status code), no re-execution.
- Same key, different request → `422 idempotency_key_reused`.
- New key → executes normally and gets cached.

This makes retried creates safe under a flaky connection: retry with the same
key and you get the account you already created back, not a duplicate.

## Optimistic concurrency (`If-Match` / `version`)

Every mutable entity — accounts, groups — carries an integer `version`.
`PATCH /accounts/{id}` (and the group rename/delete routes) require you to
say which version you're updating:

- `If-Match: "3"` header (quotes optional, stripped if present), **or**
- `"version": 3` in the request body.

If neither is present: `428 version_mismatch`. If the version doesn't match
the current one: `409 version_mismatch` — someone else changed it first;
re-`GET`, look at the fresh `version`, and retry.

## Versioning

The whole surface is namespaced `/api/v1` — a breaking change gets `/api/v2`
alongside it, not an in-place change. There is no per-route version header.

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

## Endpoints (Phase 1)

All under `/api/v1`, all requiring a session. Every route also requires a
permission, enforced inside the use case it calls (reads need
`accounts.read`, writes need `accounts.write`, deletes need
`accounts.delete`, the Wallet sync needs `integrations.manage`) — see
`src/platform/auth/permissions.ts` for the full grant per role:

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
| `POST` | `/integrations/wallet/sync` | requires `integrations.manage`; `503 integration_unavailable` if no Wallet token is configured |
| `GET` | `/net-worth` | `?months=` — total and per-account monthly series |

See [`openapi.json`](./openapi.json) for the full request/response schemas,
or serve it with any Swagger UI / Redoc instance pointed at
`https://<dashboard-host>/api/v1/openapi.json` (itself session-gated, per the
smoke test).

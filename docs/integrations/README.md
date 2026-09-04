# The integration framework

Everything the dashboard needs to connect to an external provider — Budget
Makers Wallet and Trek today — lives behind one small contract, one
encrypted credential store, and one sync engine. This is the guide to that
framework: what it is, how a credential is protected, how a connection's
lifecycle works, and how to add a new provider. For the wire-level API
surface, see [`docs/api/README.md`](../api/README.md)'s **Integrations**
section and [`openapi.json`](../api/openapi.json).

## 1. What an integration is

An integration is one implementation of `IntegrationProvider`
(`dashboard-app/src/platform/integrations/types.ts`):

```ts
export interface IntegrationProvider {
  code: ProviderCode;
  label: string;
  capabilities: readonly IntegrationCapability[];
  credentialSchema: ZodType<Record<string, string>>;
  credentialFields: readonly CredentialField[];
  testConnection(
    credentials: Record<string, string>,
    settings: Record<string, unknown>,
  ): Promise<TestResult>;
  syncs: Partial<Record<SyncKind, SyncHandler>>;
  webhook?: {
    verify(req: WebhookRequest, secret: string): boolean;
    toSyncRequests(payload: unknown): SyncRequest[];
  };
  onDisconnect(ctx: DisconnectContext): Promise<void>;
}
```

Everything else in the framework — the use cases in
`src/modules/integrations/application/`, the repositories in
`infrastructure/`, and the REST routes in `api/` — speaks only `ProviderCode`
and `SyncKind`. **Provider field names live only in `*-adapter.ts`.**
`wallet-provider-adapter.ts` and `trek-provider-adapter.ts` are the only
files allowed to name a Budget Makers Wallet or Trek field; nothing upstream
of them imports a module that does, and nothing upstream of them needs to.

## 2. Credential storage

`APP_ENCRYPTION_KEY` is a comma-separated list of `<keyId>:<base64 32-byte
key>` entries, where the **first entry is the active key** and every other
entry exists only to decrypt older blobs.

Each key must be exactly 32 bytes once base64-decoded, and each `keyId` must
match `^[a-z0-9_-]{1,32}$`. Generate one with:

```bash
printf 'k1:%s' "$(openssl rand -base64 32)"
```

Parsed by `src/platform/integrations/crypto.ts` (`parseEncryptionKeys`,
`createCredentialCipher`). A stored credential's ciphertext layout is:

```
0x01 || iv(12) || tag(16) || ciphertext
```

with the key id passed as AES-GCM additional authenticated data, so a blob
cannot be replayed under a different key id.

Credentials live in `integration_connections.credentials_ciphertext`
(`bytea`) alongside `key_id` (the id the blob was sealed under, so a
rotation can retire an old key once every connection has been reconnected).
A credential is:

- **Never returned by the API.** Every DTO the routes build
  (`connectionDto`, `summaryDto`) has no field for it.
- **Never logged.** A handler's own error message is scanned for the exact
  credential values this run was handed and redacted before it reaches
  `sync_runs.error` or an audit payload (`run-sync.ts`'s
  `redactCredentials`).
- **Never audited by value.** `recordAudit` writes the fact that a
  credential was written (`integration.connect`, `integration.disconnect`,
  etc.), never its content.

## 3. Key rotation

1. Put the **new** key first in `APP_ENCRYPTION_KEY`, keeping the old one
   after it.
2. Redeploy.
3. From Settings › Integrations, reconnect each integration — reconnecting
   re-seals its credential under the new active key.
4. Only once every connection has been reconnected, drop the old entry.

Phase 2 has no bulk re-seal job: a credential is re-sealed only when its
connection is reconnected. That means a retired key **cannot** be dropped
from `APP_ENCRYPTION_KEY` until every connection has gone through step 3 —
dropping it earlier makes any connection still sealed under it
undecryptable.

## 4. Connection lifecycle

A connection moves through **connect → test → sync → disconnect**:

- **Connect** (`POST /integrations/{provider}/connect`) validates the
  credential against the provider's `credentialSchema`, stores it encrypted,
  and immediately tests it. A failed test is still a `200`: the connection
  lands in `error` with the provider's own message, not a request failure.
- **Test** (`POST /integrations/{provider}/test`) re-runs `testConnection`
  against the stored credential without changing anything else.
- **Sync** (`POST /integrations/{provider}/sync`, or a scheduled tick) runs
  one `SyncHandler`: `fetch` talks to the provider with no transaction open,
  `apply` writes the result inside one.
- **Disconnect** (`POST /integrations/{provider}/disconnect`) destroys the
  credential and applies a disconnect policy (below) to what the provider
  created.

The connection's status machine:

```
disconnected → connected | error
```

`disabled` is not reached by any transition this phase's code performs — it
exists in the status column's check constraint and the type as a manual
pause a future administrative path can set, and a `disabled` connection is
never synced from (`isUsable`). A `connected` connection that fails a sync
moves to `error`; a `connected` or `error` connection that passes `test`
moves to `connected`.

### `transactions` (Wallet)

Incremental and cursor-based, unlike the `accounts` `SyncKind`'s full listing:
the cursor is `{ sinceDate: string }`, the Rome date the last successful pass
ran. Each pass re-requests from a week before that date (`RECORDS_LOOKBACK_DAYS`
in `wallet-provider-adapter.ts`) rather than exactly from it, so a record whose
`updatedAt` changed after the cursor moved past it is still picked up on the
next pass — safe because every write this handler makes is an idempotent
upsert keyed by `provider_links`, never an append. `fetch` makes two Wallet
round trips (`/records`, `/categories`) with no transaction open; `apply`
delegates the whole reconciliation — transactions, categories, labels,
transfer pairing — to `syncProviderTransactions` in the expenses module, the
same fetch/apply split `accountsSync` uses.

### The optional interest-posting adapter

Not a `SyncKind` — it is a push, not a pull, so it does not go through the
sync engine at all. `src/lib/jobs/interest-accrual.ts`, after computing a
day's accrual, calls `openConnection` and a live `provider_links` lookup in
short, sequential, un-nested transactions, then calls
`postWalletInterestEntry` (`src/modules/interests/infrastructure/
wallet-interest-posting-adapter.ts`) with no transaction open, exactly like
every other Wallet network call in this codebase. It only fires when a rule's
`postingMode` is `"post_to_provider"` — the default is `"analyze_only"`
(spec §13.2).

It posts **only the current day's accrual** — there is deliberately no
automatic sweep over a backlog of unposted days. An earlier version of this
job did sweep up to 30 days on the theory that a Wallet outage shouldn't
permanently lose a day; that sweep had no way to tell "a day this rule was
never meant to post" from "a day posting failed on," so it was removed
outright rather than narrowed (see the job's own doc comment for the full
reasoning). A day that fails to post is logged
(`interest_post_skipped`/`interest_post_failed`) and counted in the job's
`job_runs` detail for an operator to act on; recovering it is a deliberate
manual act, never something the next tick does on its own.

The three disconnect policies, and the exact sentence
`describeDisconnectPolicy` returns for each (the UI and the API share this
string verbatim so they can never describe a policy differently):

- **`keep`** — "Keep everything. The credential is deleted; synced accounts
  and their history stay exactly as they are."
- **`archive`** — "Archive. The credential is deleted and every account this
  provider owned is archived, history included."
- **`purge`** — "Purge. The credential is deleted, the provider links are
  removed, and accounts nothing else references are deleted."

## 5. Sync runs

Every sync attempt — scheduled, manual, or queued by a webhook — is one row
in `sync_runs`:

| Column | Meaning |
|---|---|
| `id` | Primary key. |
| `connection_id` | The connection this run belongs to. |
| `job_id` | The `sync_jobs` row (connection, kind) this run belongs to, or null. |
| `kind` | The `SyncKind` this run executed. |
| `status` | See below. |
| `trigger` | `cron` \| `manual` \| `webhook` \| `api`. |
| `stats` | Free-form counts the handler's `apply` returned. |
| `error` | Set only on `failed`, with any credential value redacted. |
| `started_at` / `finished_at` | `finished_at` is null while a run is `queued` or `running`. |

The four statuses a run can reach: **`queued`** (a webhook enqueued it and
nobody has executed it yet), **`running`**, **`success`**, and **`failed`**
(a fifth, **`skipped`**, exists in the type but is not produced by anything
in this phase). A manual trigger against a kind that already has a run
`running` **joins** that run instead of starting a second one — `runSync` is
idempotent per running job.

Runs surface in two places: Settings › Integrations (the last several runs
per connection, via `IntegrationsList`/`SyncRunsTable`), and
`GET /api/v1/integrations/{provider}/sync-runs` (most recent first, `limit`
1–10, default 10).

A `sync_queue` job in Settings › Administration can be reported as
`success` while draining a batch that contained individually failed runs —
the job's own status only reflects whether the drain itself ran, not
whether every row it drained succeeded — so the Integrations page above is
where those per-run failures are actually visible.

## 6. Inbound webhooks

`POST /api/v1/webhooks/{provider}` is the one unauthenticated route in the
API — no session cookie, no `X-Requested-With`. It authenticates itself with
an HMAC instead:

```
X-Signature: sha256=<hex-encoded-hmac-sha256>
```

computed over the **raw** request body, keyed by the receiving connection's
own `webhookSecret` (part of that connection's stored credential, not a
deployment-wide secret). The path names only the provider, so the framework
tries every connected candidate's own secret until one verifies.

Any failure — no connection's secret verifies the signature, the provider
doesn't exist, the signed body isn't JSON, or the sync it would queue is
switched off — answers **`404`**. A machine endpoint must not confirm what
exists, so a bad signature and an unknown provider look identical from the
outside.

Exactly one `webhook_deliveries` row is written either way (accepted or
rejected), recording the provider, the event name, a hash of the payload,
and the outcome.

A verified webhook does **not** sync inline — it enqueues a `queued`
`sync_runs` row (`enqueueSync`) and returns `202`. The hourly `sync_queue`
job (`drainSyncQueue`) claims queued rows and runs each one in its
connection owner's user context, so a webhook's effect on the database
always shows up on the next hourly tick, not immediately.

Worked example, signing a Wallet webhook body by hand:

```bash
BODY='{"event":"account.updated"}'
SECRET='the-connections-webhookSecret'
SIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')

curl -X POST "https://$DASHBOARD_HOST/api/v1/webhooks/wallet" \
  -H "Content-Type: application/json" \
  -H "X-Signature: sha256=$SIG" \
  -d "$BODY"
```

## 7. Adding a provider

1. Write `<name>-adapter.ts` under
   `src/modules/integrations/infrastructure/`, implementing
   `IntegrationProvider`. This is the only file allowed to name the
   provider's own field shapes.
2. Register it in `src/platform/integrations/register-all.ts`
   (`ensureProvidersRegistered`), alongside `walletProvider` and
   `trekProvider`.
3. Add its code to the `ProviderCode` union in
   `src/platform/integrations/types.ts`.
4. Add a row for it to the `integration_providers` seed, in a new migration
   (`integration_providers` is a static catalogue table the migrations own —
   see `STATIC_TABLES` in `src/test/db.ts`).

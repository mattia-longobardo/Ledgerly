# End-to-end tests

Three specs, driven by Playwright against a **running instance**
(`E2E_BASE_URL`, default `http://localhost:3000`). There is no `webServer` in
`playwright.config.ts`: the app needs a database and the full environment
`src/lib/env.ts` validates at boot, so the server is started by hand, or it is
the deployment being smoke-tested.

| Spec | Needs | What it proves |
|---|---|---|
| `smoke.spec.ts` | a running app | `/api/health` answers, `/api/v1/openapi.json` is `401` without a credential, `/` redirects to `/signin`. |
| `settings.spec.ts` | a running app | the four Settings routes redirect a signed-out visitor to `/signin`; `/api/v1/integrations` is `401`; an unsigned webhook post is `404`. |
| `smoke-api.spec.ts` | a running app **and** `E2E_TOKEN` | accounts, budgets, funds and time off answer over `Authorization: Bearer`. Skips with a message when the token is absent. |

```bash
npm run e2e                      # smoke + settings; the API smoke skips
E2E_TOKEN=pat_… npm run e2e      # all three
```

## Why there is no login spec

Sign-in goes through Authentik: `/signin` redirects to the OIDC provider,
which owns the password form, the MFA challenge and the session it hands
back. None of that is ours to automate, and driving a real identity through a
real provider is not something a repository check can do. The specs therefore
cover exactly two things: what an **unauthenticated** visitor sees, and what a
**token**-authenticated script gets. Everything between the two — the signed-in
browser session — is verified by hand, during a deployment walkthrough.

Bearer authentication exists precisely so this gap is coverable at all: a
personal access token is a credential a script can hold, and the API is the
same Hono app the pages call use cases from.

## Minting a token for `E2E_TOKEN`

1. Sign in and open **Settings › Security**.
2. Under **Tokens**, give the token a name (`e2e`, say) and tick the scopes
   the smoke uses:
   `accounts.read`, `accounts.write`,
   `budgets.read`, `budgets.write`,
   `funds.read`, `funds.write`,
   `timeoff.read`, `timeoff.write`.
   A token can never hold a scope its owner does not have, and the scopes are
   re-intersected with the owner's current permissions on every request — so a
   token is only ever as powerful as the account that minted it, at the moment
   it is used.
3. Set an expiry if you want one, and submit. **The token is shown once**, on
   the page that created it. It is stored as a sha256 hash; nothing can show
   it again.
4. Export it for the run: `export E2E_TOKEN=pat_…`.

A token cannot mint or revoke another token (Ruling P8-2): `/security/tokens`
is session-only, so `E2E_TOKEN` cannot be rotated from a spec. Revoke it from
the same page when the run is done.

## The API smoke writes real rows

`smoke-api.spec.ts` creates a manual account with an opening balance, a budget
with one allocation sourced from that account, a fund with one contribution,
and books one day of time off — which it removes again. Nothing else is
cleaned up: names carry a random suffix so re-runs never collide, but the rows
stay.

**Run it against a throwaway database.** Against production it leaves a stray
account, budget and fund behind for someone to delete by hand.

The account/budget leg is the one assertion worth keeping: a budget allocation
is *virtual*, so the account's balance must be byte-for-byte identical before
and after the allocation exists. That is the Budgets exit line, checked
against a running deployment rather than a test harness.

## Running against a local instance

```bash
npm run test:db:up      # throwaway Postgres on :55432

export DATABASE_URL=postgresql://app_test:app_test@localhost:55432/dashboard_test
export AUTH_URL=http://localhost:3000
export AUTH_SECRET=$(openssl rand -base64 32)
export OIDC_ISSUER=http://localhost:9999/application/o/dashboard/
export OIDC_CLIENT_ID=x OIDC_CLIENT_SECRET=x AUTHORIZED_SUB=e2e-owner
export APP_ENCRYPTION_KEY="e2e:$(openssl rand -base64 32)"
export CRON_SECRET=$(openssl rand -hex 16) WEBHOOK_SECRET=$(openssl rand -hex 16)

npm run db:migrate      # creates the schema and bootstraps the owner
npm run build && npx next start   # or `npm run dev` for a faster loop
npm run e2e
```

Authentik is contacted only on sign-in, so the dummy `OIDC_*` values above are
enough to boot and to run every spec here — including the API smoke, which
never signs in.

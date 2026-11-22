# API and MCP

Ledgerly has two doors for programs: the REST API `/api/v1` for scripts, and the MCP server
`/api/mcp` for AI assistants. Both use OAuth2, and a token always acts as one user and never beyond
that user. There are no administrative routes.

Changes to both are listed in [`api-changelog.md`](api-changelog.md). The design is in
[`auth-design.md`](auth-design.md).

## OAuth2 in short

Ledgerly is its own authorization server. The issuer is `https://dash.longobardo.me/api/auth`.

| What                  | Where                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------- |
| Server metadata       | `/.well-known/oauth-authorization-server/api/auth`, `/.well-known/openid-configuration` |
| Resource metadata     | `/.well-known/oauth-protected-resource/api/v1` (and `/api/mcp`)                        |
| Token endpoint        | `/api/auth/oauth2/token`                                                               |
| Client registration   | `/api/auth/oauth2/register` (public clients only, for MCP)                             |
| Signing keys (JWKS)   | `/api/auth/jwks`                                                                       |

- **Access tokens** are JWTs valid for one hour. Each token is for one resource: a token for
  `/api/mcp` does not work on `/api/v1`, and the opposite.
- **Refresh tokens** rotate and are valid for 30 days.
- **Scopes:** `read`, `write`, `imports`, `investments:read`. `read` does not include
  `investments:read`.
- **Rate limit:** 120 calls per minute per client (token). The web's own session cookie has 1200 per minute per person (decision H57). `X-RateLimit-Limit` says the caller's allowance.
- **Errors:** without a valid token, `401` with a `WWW-Authenticate` header that points to the
  resource metadata. With a token that lacks the scope, `403 insufficient_scope`.

## REST API (`/api/v1`)

### Get a token

Create an API client in **Settings → Security**. It is a confidential client that acts as you. The
secret is shown once. Delete the client to stop its tokens at once.

```bash
TOKEN=$(curl -sS -u "$CLIENT_ID:$CLIENT_SECRET" https://dash.longobardo.me/api/auth/oauth2/token \
  -d grant_type=client_credentials -d resource=https://dash.longobardo.me/api/v1 | jq -r .access_token)
curl -sS -H "Authorization: Bearer $TOKEN" https://dash.longobardo.me/api/v1/summary
```

### The web's session

The web app of the instance calls `/api/v1` with its session cookie, from the same origin. A session
gets the scopes `read`, `write`, `imports`, `investments:read`, `security` and `session`, and `admin`
for an admin.
`session` is never granted to a token: the routes that ask for it (the IBAN, H45) answer the web's pages only,
and a token gets `403`. It follows the rules of
every page: a session that still owes its TOTP setup, a revoked session or a blocked person gets
`401`. A write (any method but `GET`, `HEAD`, `OPTIONS`) by cookie must carry `Origin` equal to the
instance's address and the header `X-Ledgerly-CSRF` (any value; `SESSION_CSRF_HEADER` of
`@ledgerly/api-contract`), otherwise `403`. `/api/v1` answers no CORS request, so no other origin
reads an answer made with the cookie. With an `Authorization` header the cookie is not read: the
token alone decides, and a bad token is `401` even next to a valid cookie.

### Routes

| Route                                      | Scope              |
| ------------------------------------------ | ------------------ |
| `GET /meta`                                | none               |
| `GET /preferences`, `GET /profile`         | `read`             |
| `PATCH /preferences`, `PATCH /profile`     | `write`            |
| `GET /categories`, `/labels`, `/source-categories`, `/categories/{id}/macro-move` | `read` |
| the writes of categories, labels and source categories ([changelog](api-changelog.md)) | `write` |
| `GET /connections`, `/connections/runs`, `/connections/{id}/choice`, `/connections/{id}/outcome`, `/banks`, `/plugins`, `/sources/{slug}`, `/sources/{slug}/deactivation` | `read` |
| the actions of connections, banks, sources and plugins ([changelog](api-changelog.md)) | `write` |
| `GET /accounts`                            | `read`             |
| `GET /accounts/{id}/balances`              | `read`             |
| `GET /accounts/{id}/iban`, `GET /accounts/{id}/switch/identifiers` | `session` (web only) |
| `GET /transactions`, `/transactions/{id}`, `/transactions/view`, `/transactions/facets`, `/transactions/spending`, `/transactions/review`, `/payees`, `/rules`, `/search` | `read` |
| the writes of movements, manual movements, categories to review and rules ([changelog](api-changelog.md)) | `write` |
| `GET /budgets`, `/budgets/view`, `/budgets/overview`, `/budgets/{budget}` | `read` |
| `PUT /budgets/{budget}/limit`, `POST /budgets/{budget}/stop`, `PUT /budgets/{budget}/alerts` | `write` |
| `GET /pockets`, `/pockets/overview`, `/pockets/candidates`, `/pockets/{id}` | `read` |
| the writes of pockets, their deposits, linked expenses and planned expenses ([changelog](api-changelog.md)) | `write` |
| `GET /subscriptions`, `/subscriptions/suggestions` | `read` |
| the writes of subscriptions: create, change, state, delete ([changelog](api-changelog.md)) | `write` |
| `GET /interests`, `/interests/{id}` | `read` |
| the writes of interests: create, change, state, post and mark a settlement ([changelog](api-changelog.md)) | `write` |
| `GET /timeoff/{year}`, `/timeoff/allowances`, `/timeoff/holidays/*` | `read` |
| the writes of time off: allowance, leave, undo, holiday calendars ([changelog](api-changelog.md)) | `write` |
| `GET /payroll/payslips`, `/payroll/payslips/{id}`, `/payroll/codes` | `read` |
| the writes of payroll: a value, verify, apply, reopen, reject, retry, rename, delete, the code map ([changelog](api-changelog.md)) | `write` |
| `POST /payroll/payslips/{id}/llm-fill` (the web's own session only: a token gets 403) | `session` |
| `GET /funds`, `/funds/setup`, `/funds/{id}`, `/funds/{id}/valuations`, `/contributions`, `/settings`, `/debit-match`, `/movement-candidates` | `read` |
| the writes of funds: the fund, its values, operations, decisions, sources, fees, «Rebuild from payslips» ([changelog](api-changelog.md)) | `write` |
| `GET /summary`                             | `read`             |
| `POST /accounts/{id}/balances`             | `write`            |
| `POST /imports`                            | `imports`          |
| `GET /investments`, `/investments/home`, `/investments/catalog`, `/investments/{accountId}`, `/holdings`, `/activity`, `/positions` | `investments:read` |
| the writes of investments: a manual service, its address and value, operations, reconciliations, an empty reading, transfers, «Sync now», the key's check, disconnection and revocation ([changelog](api-changelog.md)) | `write` |
| `GET /investments/{accountId}/connection`, `POST /investments/connections`, `PUT /investments/{accountId}/key` (the web's own session only: a token gets 403) | `session` |

Amounts are decimal strings, never JSON numbers. An account balance is in the account's currency;
the totals of `/summary` are in your display currency. The investment routes never return keys or
connection errors.

Personal access tokens (`pat_…`) were removed: they return `401`.

`GET /meta` answers without a token: the version of the instance, the level of the API
(`apiLevel`), the lowest client level it answers in full (`minClientLevel`), the capabilities of
the routes it serves and the scopes it grants. An app reads it before it signs in, and hides what
the instance does not list.

The OpenAPI document of every route of the contract is `docs/openapi.json`, generated from
`packages/api-contract` (`npm run openapi`). A release only adds to it: `npm test` compares it with
the document of the last release, `baselines/contract/openapi.json`.

## MCP server (`/api/mcp`)

URL: `https://dash.longobardo.me/api/mcp`. Transport: Streamable HTTP, stateless (POST only).

The server is **read-only**. Each tool needs `read` (the investment tools need `investments:read`)
and uses the same services as the REST API.

| Tool                       | Same data as                                |
| -------------------------- | ------------------------------------------- |
| `get_summary`              | `GET /api/v1/summary`                       |
| `list_accounts`            | `GET /api/v1/accounts`                      |
| `get_account_balances`     | `GET /api/v1/accounts/{id}/balances`        |
| `list_transactions`        | `GET /api/v1/transactions`                  |
| `get_spending`             | `GET /api/v1/transactions/spending`         |
| `list_budgets`             | `GET /api/v1/budgets`                       |
| `list_pockets`             | `GET /api/v1/pockets`                       |
| `list_subscriptions`       | `GET /api/v1/subscriptions`                 |
| `list_interest_rules`      | `GET /api/v1/interests`                     |
| `get_interest_rule`        | `GET /api/v1/interests/{id}`                |
| `get_time_off`             | `GET /api/v1/timeoff/{year}`                |
| `get_payroll`              | `GET /api/v1/payroll/payslips`              |
| `get_payslip`              | `GET /api/v1/payroll/payslips/{id}`         |
| `get_funds`                | `GET /api/v1/funds`                         |
| `get_fund`                 | `GET /api/v1/funds/{id}`                    |
| `list_investments`         | `GET /api/v1/investments`                   |
| `get_investment_holdings`  | `GET /api/v1/investments/{accountId}/holdings` |
| `get_investment`           | `GET /api/v1/investments/{accountId}`       |

### Connect a client

The client registers itself: there is nothing to configure on the server. You sign in, then you
approve the access on the consent page.

- **Claude (web or desktop):** Settings → Connectors → Add custom connector, with the URL above.
  Leave client ID and secret empty.
- **Claude Code:** `claude mcp add --transport http ledgerly https://dash.longobardo.me/api/mcp`,
  then `/mcp` → ledgerly → Authenticate.
- **MCP Inspector:** `npx @modelcontextprotocol/inspector`, transport "Streamable HTTP", then
  "Open Auth Settings" → "Quick OAuth Flow".
- **A script:** use an API client with scope `read`, get a token with
  `resource=https://dash.longobardo.me/api/mcp`, and send JSON-RPC with
  `Accept: application/json, text/event-stream`.

Self-registered clients are public (PKCE, no secret). Their redirect URIs must be on loopback or
on the allowlist in `src/platform/auth/oauth.ts`. They can reach `/api/mcp` only.

**Connected apps** in **Settings → Security** lists the approved clients. **Revoke** deletes the
approval and the refresh tokens; the access token ends within one hour. To block a client at once,
set `disabled` on its row in the `oauth_clients` table.

## Document import

`POST /api/v1/imports` (scope `imports`) reads a document through the same pipeline as the upload
screen. Send `multipart/form-data` with `kind` (`payslip`) and `file` (at most 10 MB). The answer is
`201` for a new document and `200` with `duplicate: true` when the same file (same SHA-256) is
already there. The document is read after the answer goes out.

The kinds `cometa_operations` and `cometa_position` are still accepted as values, and refused: the
answer is `415 unsupported_format` and the file is not stored. A fund's documents are not read any
more.

```bash
curl -sS -H "Authorization: Bearer $TOKEN" -F kind=payslip -F file=@payslip.pdf \
  https://dash.longobardo.me/api/v1/imports
```

To create an API client from the server, without a browser: `npm run user:create-api-client`.

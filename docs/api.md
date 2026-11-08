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
- **Rate limit:** 120 calls per minute per client.
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

### Routes

| Route                                      | Scope              |
| ------------------------------------------ | ------------------ |
| `GET /accounts`                            | `read`             |
| `GET /accounts/{id}/balances`              | `read`             |
| `GET /transactions`                        | `read`             |
| `GET /summary`                             | `read`             |
| `POST /accounts/{id}/balances`             | `write`            |
| `POST /imports`                            | `imports`          |
| `GET /investments`                         | `investments:read` |
| `GET /investments/{accountId}/holdings`    | `investments:read` |

Amounts are decimal strings, never JSON numbers. An account balance is in the account's currency;
the totals of `/summary` are in your display currency. The investment routes never return keys or
connection errors.

Personal access tokens (`pat_…`) were removed: they return `401`.

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
| `list_budgets`             | the Budgets page                            |
| `list_investments`         | `GET /api/v1/investments`                   |
| `get_investment_holdings`  | `GET /api/v1/investments/{accountId}/holdings` |

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
screen. Send `multipart/form-data` with `kind` (`payslip`, `cometa_operations` or
`cometa_position`) and `file` (at most 10 MB). The answer is `201` for a new document and `200`
with `duplicate: true` when the same file (same SHA-256) is already there. The document is read
after the answer goes out.

```bash
curl -sS -H "Authorization: Bearer $TOKEN" -F kind=payslip -F file=@payslip.pdf \
  https://dash.longobardo.me/api/v1/imports
```

To create an API client from the server, without a browser: `npm run user:create-api-client`.

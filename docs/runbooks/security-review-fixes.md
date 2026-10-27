# Security review fixes (PERS-49) — deploy, rollback, secret rotation

Runbook for the fixes of the PERS-49 review (task PERS-57). Secrets are never written here: only
where they live.

## What the deploy changes

| ID | Change | Data |
|---|---|---|
| SEC-01 | DCR: loopback or allowlisted redirects only; resource `/api/mcp` only; scopes `read offline_access`. Consent screen shows the redirect hosts and "unverified client" | `0032_dcr_mcp_only`: existing DCR clients lose the `/api/v1` link and the write scopes; their `/api/v1` or write refresh tokens and consents are deleted |
| SEC-02 | `next` 16.4.3, `zod` 4.6.7, `hono` 4.13.14, `nodemailer` 10.2.1, `npm audit fix` (undici, sharp, source-map-js) | — |
| SEC-04 | `PAPERLESS_ALLOWED_ORIGINS` (default `http://paperless-ngx:8000`); generic Paperless errors in the UI | — |
| SEC-05 | Settings › Security › Connected apps with "Revoke"; password reset and admin 2FA reset delete OAuth refresh tokens | — |
| SEC-08 | `integrations-sync` skips `revoked` connections and banned people | — |
| SEC-09 | `/api/mcp` body capped at 1 MB while streaming; Paperless downloads at 11 MB, JSON pages at 4 MB | — |

New environment variable: `PAPERLESS_ALLOWED_ORIGINS` (optional, `.env.homelab`).

## Deploy

1. `git -C projects/Ledgerly log origin/main..main` is empty, or the extra commits are in the branch.
2. Dump: `docker exec postgres pg_dump -U postgres -Fc ledgerly > backups/ledgerly/pre-sec-fixes.dump`.
3. Rollback images: `docker tag ledgerly:latest ledgerly:pre-sec-fixes` and
   `docker tag ledgerly-cron:latest ledgerly-cron:pre-sec-fixes`.
4. `docker compose build && docker compose up -d --wait` (the migration runs on boot).
5. Check: `/api/health`; a DCR with `redirect_uris: ["https://evil.example/cb"]` → `400
   invalid_redirect_uri`; a DCR with `resources: [".../api/v1"]` → `400 invalid_target`; the MCP
   flow from Claude Code or MCP Inspector; Settings › Security shows "Connected apps".

## Rollback

- **App**: `docker tag ledgerly:pre-sec-fixes ledgerly:latest && docker compose up -d --no-build --wait ledgerly`.
  The previous image ignores the migration. DCR clients stay limited to `/api/mcp` and `read`
  in the data, which the previous image accepts; a client that needs more registers again.
- **Data**: `0032` only deletes link rows, refresh tokens and consents. A full restore is
  `pg_restore --clean -d ledgerly backups/ledgerly/pre-sec-fixes.dump`, only if needed.

## Rotation of `BETTER_AUTH_SECRET` (INFO-02)

The one secret signs and encrypts several things. Know the impact before you rotate it:

| What | Effect of a new secret |
|---|---|
| Sessions and their cookies | every person is signed out |
| TOTP secrets and recovery codes (`two_factors`, encrypted) | **unreadable**: every password account must set up TOTP again; recovery codes stop working |
| JWKS private keys (`jwks`, encrypted) | unreadable: new keys are made on the next token; every access token in flight is refused |
| Signed consent and authorize queries, reset and invitation links | links in flight stop working |
| OAuth refresh tokens and client secrets (stored hashed) | not affected by the secret itself, but the clients must sign in again because the sessions end |

Procedure:

1. Rotate only when the secret is compromised. Tell the users first: they must set up TOTP again.
2. Dump the database (as in Deploy step 2).
3. Put the new value in `.env.homelab` (`openssl rand -base64 48`, no `$` in the value).
4. `docker compose up -d --wait ledgerly ledgerly-cron`.
5. Delete the rows that the new secret cannot read, so nobody sees a broken TOTP prompt:
   `DELETE FROM two_factors; UPDATE users SET two_factor_enabled = false; DELETE FROM jwks;`.
   With `TWO_FACTOR_POLICY=required`, each password account is sent to the TOTP setup on the next
   sign-in. SSO accounts are not affected.
6. Check: sign in with Authentik and with a password account; an MCP client signs in again.

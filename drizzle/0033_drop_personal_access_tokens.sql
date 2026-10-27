-- PERS-59 (docs/auth-design.md T5): /api/v1 accepts only OAuth access tokens, so the personal
-- access tokens go. The last one was revoked in PERS-57; the table is dumped to
-- backups/ledgerly/ before the deploy. Idempotent.
DROP TABLE IF EXISTS "personal_access_tokens" CASCADE;

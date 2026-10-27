-- PERS-49 SEC-01: a self-registered (DCR) client reaches the read-only MCP and nothing else.
-- New registrations get that from the plugin options; this brings the clients registered before
-- in line. A DCR client is a public one without an owner. Idempotent.
DELETE FROM "oauth_client_resources"
WHERE "resource_id" LIKE '%/api/v1'
  AND "client_id" IN (
    SELECT "client_id" FROM "oauth_clients"
    WHERE "user_id" IS NULL AND "token_endpoint_auth_method" = 'none'
  );
--> statement-breakpoint
UPDATE "oauth_clients"
SET "scopes" = ARRAY['read', 'offline_access']
WHERE "user_id" IS NULL AND "token_endpoint_auth_method" = 'none';
--> statement-breakpoint
-- Their refresh tokens and consents for /api/v1 or for more than reading go: the next connection
-- asks again, on the consent screen that now shows where the code goes.
DELETE FROM "oauth_refresh_tokens"
WHERE "client_id" IN (
    SELECT "client_id" FROM "oauth_clients"
    WHERE "user_id" IS NULL AND "token_endpoint_auth_method" = 'none'
  )
  AND (
    EXISTS (SELECT 1 FROM unnest("resources") AS r WHERE r LIKE '%/api/v1')
    OR "scopes" && ARRAY['write', 'imports']
  );
--> statement-breakpoint
DELETE FROM "oauth_consents"
WHERE "client_id" IN (
    SELECT "client_id" FROM "oauth_clients"
    WHERE "user_id" IS NULL AND "token_endpoint_auth_method" = 'none'
  )
  AND (
    EXISTS (SELECT 1 FROM unnest("resources") AS r WHERE r LIKE '%/api/v1')
    OR "scopes" && ARRAY['write', 'imports']
  );

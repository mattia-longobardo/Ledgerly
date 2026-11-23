-- R5c P3a: Wallet and Trek are plugins. Their connections and everything keyed by their provider
-- move from `wallet` / `trek` to `plugin:wallet` / `plugin:trek`; the person who has a connection has
-- the plugin on (decision H30). A day of the calendar is `external`, no longer `trek`. No rule
-- publishes interests on its source any more (decision H37, ST-14). The credentials stay sealed as
-- they are: the plugins take the same keys. Every statement has its own WHERE: run again, it
-- changes nothing. Rollback: docs/design/rewrite-plan/r5c-rollback.sql.
UPDATE "integration_connections" SET "provider" = 'plugin:wallet' WHERE "provider" = 'wallet';--> statement-breakpoint
UPDATE "integration_connections" SET "provider" = 'plugin:trek' WHERE "provider" = 'trek';--> statement-breakpoint
UPDATE "provider_links" SET "provider" = 'plugin:wallet' WHERE "provider" = 'wallet';--> statement-breakpoint
UPDATE "provider_links" SET "provider" = 'plugin:trek' WHERE "provider" = 'trek';--> statement-breakpoint
UPDATE "source_categories" SET "provider" = 'plugin:wallet' WHERE "provider" = 'wallet';--> statement-breakpoint
UPDATE "source_categories" SET "provider" = 'plugin:trek' WHERE "provider" = 'trek';--> statement-breakpoint
UPDATE "source_settings" SET "provider" = 'plugin:wallet' WHERE "provider" = 'wallet';--> statement-breakpoint
UPDATE "source_settings" SET "provider" = 'plugin:trek' WHERE "provider" = 'trek';--> statement-breakpoint
UPDATE "source_skipped_accounts" SET "provider" = 'plugin:wallet' WHERE "provider" = 'wallet';--> statement-breakpoint
UPDATE "source_skipped_accounts" SET "provider" = 'plugin:trek' WHERE "provider" = 'trek';--> statement-breakpoint
UPDATE "accounts" SET "provider" = 'plugin:wallet' WHERE "provider" = 'wallet';--> statement-breakpoint
UPDATE "accounts" SET "provider" = 'plugin:trek' WHERE "provider" = 'trek';--> statement-breakpoint
UPDATE "account_switches" SET "from_provider" = 'plugin:wallet' WHERE "from_provider" = 'wallet';--> statement-breakpoint
UPDATE "account_switches" SET "to_provider" = 'plugin:wallet' WHERE "to_provider" = 'wallet';--> statement-breakpoint
INSERT INTO "plugin_activations" ("user_id", "plugin_id", "active", "activated_at")
SELECT DISTINCT "user_id", substr("provider", length('plugin:') + 1), true, now()
FROM "integration_connections"
WHERE "provider" IN ('plugin:wallet', 'plugin:trek')
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "leave_days" SET "origin" = 'external' WHERE "origin" = 'trek';--> statement-breakpoint
UPDATE "interest_rules" SET "mode" = 'analyze_only' WHERE "mode" = 'post_to_provider';

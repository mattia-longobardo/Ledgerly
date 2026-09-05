ALTER TABLE "interest_entries" ALTER COLUMN "transaction_id" SET DATA TYPE text;
--> statement-breakpoint
-- B7 / Ruling P3-C42: `interest_rules_owner` (0012_interests.sql) checked
-- only that `user_id` matched the caller — never that `account_id` actually
-- belongs to that same user. `createInterestRule` gained its own explicit
-- ownership check in the same fix wave; this is the database-level
-- backstop against any future write path (a script, a repair tool, a bug)
-- that bypasses that use case.
DROP POLICY interest_rules_owner ON interest_rules;
--> statement-breakpoint
CREATE POLICY interest_rules_owner ON interest_rules
  USING (app_is_system() OR user_id = app_current_user_id())
  WITH CHECK (app_is_system() OR (
    user_id = app_current_user_id()
    AND EXISTS (SELECT 1 FROM accounts a WHERE a.id = interest_rules.account_id AND a.user_id = interest_rules.user_id)
  ));

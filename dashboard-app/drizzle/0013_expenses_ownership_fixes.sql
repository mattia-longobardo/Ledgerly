DROP INDEX "recurring_patterns_user_payee_uq";--> statement-breakpoint
ALTER TABLE "recurring_patterns" ADD COLUMN "sign" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "recurring_patterns_user_payee_currency_sign_uq" ON "recurring_patterns" USING btree ("user_id","payee","currency","sign");--> statement-breakpoint
ALTER TABLE "recurring_patterns" ADD CONSTRAINT "recurring_patterns_sign_ck" CHECK ("recurring_patterns"."sign" IN ('+','-'));
--> statement-breakpoint
-- A5: the transaction_label_links policy (0011_transactions.sql) only ever
-- joined back to `transactions`, never to `transaction_labels` — a caller
-- that owned the transaction could link in another user's label, since a
-- foreign key check is not subject to RLS. Also folds in A7's column
-- qualification: `t.id = transaction_id` referenced the outer table's
-- column unqualified, which a future same-named column on `transactions`
-- would silently rebind to the inner alias instead.
DROP POLICY transaction_label_links_owner ON transaction_label_links;
--> statement-breakpoint
CREATE POLICY transaction_label_links_owner ON transaction_label_links
  USING (app_is_system() OR EXISTS (
    SELECT 1 FROM transactions t WHERE t.id = transaction_label_links.transaction_id AND t.user_id = app_current_user_id()
  ))
  WITH CHECK (app_is_system() OR (
    EXISTS (SELECT 1 FROM transactions t WHERE t.id = transaction_label_links.transaction_id AND t.user_id = app_current_user_id())
    AND EXISTS (SELECT 1 FROM transaction_labels l WHERE l.id = transaction_label_links.label_id AND l.user_id = app_current_user_id())
  ));
--> statement-breakpoint
-- A7: same unqualified-column hardening for interest_accruals
-- (0012_interests.sql) — `r.id = rule_id` is correct today only because
-- nothing on `interest_accruals` itself is named `rule_id`'s counterpart;
-- qualify it so a future column can never silently rebind the reference.
DROP POLICY interest_accruals_owner ON interest_accruals;
--> statement-breakpoint
CREATE POLICY interest_accruals_owner ON interest_accruals
  USING (app_is_system() OR EXISTS (
    SELECT 1 FROM interest_rules r WHERE r.id = interest_accruals.rule_id AND r.user_id = app_current_user_id()
  ))
  WITH CHECK (app_is_system() OR EXISTS (
    SELECT 1 FROM interest_rules r WHERE r.id = interest_accruals.rule_id AND r.user_id = app_current_user_id()
  ));
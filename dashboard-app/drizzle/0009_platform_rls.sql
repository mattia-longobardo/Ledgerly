CREATE OR REPLACE FUNCTION app_is_admin() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT current_setting('app.role', true) = 'admin' $$;
--> statement-breakpoint
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE audit_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY audit_events_owner ON audit_events USING (app_is_system() OR app_is_admin() OR actor_user_id = app_current_user_id()) WITH CHECK (app_is_system() OR actor_user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY idempotency_keys_owner ON idempotency_keys USING (app_is_system() OR principal_id = app_current_user_id()) WITH CHECK (app_is_system() OR principal_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE rate_limit_windows ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE rate_limit_windows FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY rate_limit_windows_owner ON rate_limit_windows USING (app_is_system() OR principal_id = app_current_user_id()) WITH CHECK (app_is_system() OR principal_id = app_current_user_id());

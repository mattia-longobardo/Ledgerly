CREATE TABLE "integration_connections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"status" text DEFAULT 'disconnected' NOT NULL,
	"credentials_ciphertext" "bytea",
	"key_id" text,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_test_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"last_error" text,
	"disconnect_policy" text DEFAULT 'keep' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_connections_status_ck" CHECK ("integration_connections"."status" IN ('disconnected','connected','error','disabled')),
	CONSTRAINT "integration_connections_policy_ck" CHECK ("integration_connections"."disconnect_policy" IN ('keep','archive','purge'))
);
--> statement-breakpoint
CREATE TABLE "integration_providers" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"schedule" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"cursor" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_jobs_schedule_ck" CHECK ("sync_jobs"."schedule" IN ('hourly','daily','monthly'))
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid NOT NULL,
	"job_id" uuid,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"trigger" text NOT NULL,
	"stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "sync_runs_status_ck" CHECK ("sync_runs"."status" IN ('queued','running','success','failed','skipped')),
	CONSTRAINT "sync_runs_trigger_ck" CHECK ("sync_runs"."trigger" IN ('cron','manual','webhook','api'))
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"connection_id" uuid,
	"provider" text NOT NULL,
	"direction" text DEFAULT 'inbound' NOT NULL,
	"event" text NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"response_code" integer,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_direction_ck" CHECK ("webhook_deliveries"."direction" IN ('inbound','outbound')),
	CONSTRAINT "webhook_deliveries_status_ck" CHECK ("webhook_deliveries"."status" IN ('accepted','rejected','delivered','failed'))
);
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_provider_integration_providers_code_fk" FOREIGN KEY ("provider") REFERENCES "public"."integration_providers"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_job_id_sync_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."sync_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_connection_id_integration_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."integration_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_connections_user_provider_uq" ON "integration_connections" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_jobs_connection_kind_uq" ON "sync_jobs" USING btree ("connection_id","kind");--> statement-breakpoint
CREATE INDEX "sync_runs_connection_started_idx" ON "sync_runs" USING btree ("connection_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sync_runs_job_started_idx" ON "sync_runs" USING btree ("job_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "sync_runs_queued_idx" ON "sync_runs" USING btree ("status","started_at");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_provider_received_idx" ON "webhook_deliveries" USING btree ("provider","received_at" DESC NULLS LAST);
--> statement-breakpoint
INSERT INTO integration_providers (code, label, capabilities) VALUES
  ('wallet', 'Budget Makers Wallet', '["accounts","transactions","interest_posting"]'::jsonb),
  ('trek', 'Trek', '["leave"]'::jsonb)
ON CONFLICT (code) DO NOTHING;
--> statement-breakpoint
ALTER TABLE integration_connections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE integration_connections FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY integration_connections_owner ON integration_connections USING (app_is_system() OR user_id = app_current_user_id()) WITH CHECK (app_is_system() OR user_id = app_current_user_id());
--> statement-breakpoint
ALTER TABLE sync_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sync_jobs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sync_jobs_owner ON sync_jobs USING (app_is_system() OR EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = app_current_user_id())) WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = app_current_user_id()));
--> statement-breakpoint
ALTER TABLE sync_runs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE sync_runs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY sync_runs_owner ON sync_runs USING (app_is_system() OR EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = app_current_user_id())) WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = app_current_user_id()));
--> statement-breakpoint
ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE webhook_deliveries FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY webhook_deliveries_owner ON webhook_deliveries USING (app_is_system() OR EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = app_current_user_id())) WITH CHECK (app_is_system() OR EXISTS (SELECT 1 FROM integration_connections c WHERE c.id = connection_id AND c.user_id = app_current_user_id()));

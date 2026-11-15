CREATE TABLE "plugin_activations" (
	"user_id" uuid NOT NULL,
	"plugin_id" text NOT NULL,
	"active" boolean NOT NULL,
	"activated_at" timestamp with time zone,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_activations_pk" PRIMARY KEY("user_id","plugin_id")
);
--> statement-breakpoint
CREATE TABLE "plugin_auth_states" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"plugin_id" text NOT NULL,
	"state_hash" text NOT NULL,
	"session_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_auth_states_hash_uq" UNIQUE("state_hash")
);
--> statement-breakpoint
CREATE TABLE "plugin_user_credentials" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"plugin_id" text NOT NULL,
	"credentials" "bytea" NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"invalid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugin_user_credentials_user_plugin_uq" UNIQUE("user_id","plugin_id")
);
--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" text PRIMARY KEY NOT NULL,
	"url" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"contract" text NOT NULL,
	"state" text DEFAULT 'ready' NOT NULL,
	"verified" boolean DEFAULT true NOT NULL,
	"manifest_read_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plugins_id_ck" CHECK ("plugins"."id" ~ '^[a-z][a-z0-9-]{1,30}$'),
	CONSTRAINT "plugins_state_ck" CHECK ("plugins"."state" in ('ready', 'unreachable'))
);
--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "instance_key" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "integration_connections" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "plugin_activations" ADD CONSTRAINT "plugin_activations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_auth_states" ADD CONSTRAINT "plugin_auth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plugin_user_credentials" ADD CONSTRAINT "plugin_user_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plugin_auth_states_expires_idx" ON "plugin_auth_states" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_user_provider_instance_uq" UNIQUE("user_id","provider","instance_key");
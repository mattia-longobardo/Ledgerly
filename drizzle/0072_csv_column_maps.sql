-- R5c P5: the map of the columns of a CSV file, saved per account «a mano» (decision ST-8). A new
-- table only: no row of another table changes. Rollback: docs/design/rewrite-plan/r5c-rollback.sql.
CREATE TABLE "csv_column_maps" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"map" jsonb NOT NULL,
	"delimiter" text NOT NULL,
	"decimal_separator" text NOT NULL,
	"date_format" text NOT NULL,
	"skip_rows" integer DEFAULT 0 NOT NULL,
	"header" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "csv_column_maps_delimiter_ck" CHECK (char_length("csv_column_maps"."delimiter") = 1),
	CONSTRAINT "csv_column_maps_decimal_ck" CHECK (char_length("csv_column_maps"."decimal_separator") = 1),
	CONSTRAINT "csv_column_maps_skip_ck" CHECK ("csv_column_maps"."skip_rows" >= 0)
);
--> statement-breakpoint
ALTER TABLE "csv_column_maps" ADD CONSTRAINT "csv_column_maps_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "csv_column_maps" ADD CONSTRAINT "csv_column_maps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "csv_column_maps_user_idx" ON "csv_column_maps" USING btree ("user_id");
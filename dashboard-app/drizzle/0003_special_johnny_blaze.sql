CREATE TABLE "tracked_accounts" (
	"slug" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"teable_column" text NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "tracked_accounts_sort_idx" ON "tracked_accounts" USING btree ("sort_order","slug");
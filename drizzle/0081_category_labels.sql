CREATE TABLE "category_labels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"category_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"payee" text,
	"note" text,
	"amount_cents" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_labels_kind_ck" CHECK ("category_labels"."kind" in ('income', 'expense'))
);
--> statement-breakpoint
ALTER TABLE "category_models" ADD COLUMN "group_threshold" real;--> statement-breakpoint
ALTER TABLE "category_labels" ADD CONSTRAINT "category_labels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_labels" ADD CONSTRAINT "category_labels_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "category_labels_user_idx" ON "category_labels" USING btree ("user_id","source");
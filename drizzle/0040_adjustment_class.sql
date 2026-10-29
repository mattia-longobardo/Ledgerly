-- PERS-118 (U3): what a correction stands for (docs/design/investments-ux.md §4.9). Additive: null = data,
-- the class of every correction written before it.
ALTER TABLE "investment_operations" ADD COLUMN "adjustment_class" text;--> statement-breakpoint
ALTER TABLE "investment_operations" ADD CONSTRAINT "investment_operations_adjustment_class_ck" CHECK ("investment_operations"."adjustment_class" is null or ("investment_operations"."kind" = 'adjustment' and "investment_operations"."adjustment_class" in ('data', 'capital', 'result')));
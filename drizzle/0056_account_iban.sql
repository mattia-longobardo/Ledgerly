-- Release N4a (docs/design/rewrite-plan/03-releases.md "N4", 04-now.md §4.6 and §4.6.1): the IBAN of
-- an account (H39, H45-H47) and the accounts a source could not add because their IBAN is already
-- here. Additive: the image before this release writes none of the new columns and never reads them.
ALTER TABLE "integration_connections" ADD COLUMN "iban_conflicts" jsonb;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "iban" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "iban_from_source" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "accounts_user_iban_idx" ON "accounts" USING btree ("user_id","iban") WHERE "accounts"."iban" is not null;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_iban_ck" CHECK ("accounts"."iban" is null or "accounts"."iban" ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$');--> statement-breakpoint
--> statement-breakpoint
-- Data (H46, 06-data.md §6.1): the values of "IBAN or reference" that are a valid IBAN are copied
-- into the IBAN field, compact and upper case, as `normalizeIban` (src/platform/iban.ts) writes them:
-- the shape, then the ISO 13616 mod-97 check, with each letter as two digits (A = 10 … Z = 35).
-- Only the accounts with a mode have the field (H47): not an investment, a pension or a crypto one.
-- "reference" is not changed. Two accounts with the same IBAN both get it (04-now.md §4.6.1, point 6).
UPDATE "accounts" a
SET "iban" = c."iban"
FROM (
  SELECT "id", upper(regexp_replace("reference", '[[:space:]-]', '', 'g')) AS "iban"
  FROM "accounts"
  WHERE "reference" IS NOT NULL
    AND "iban" IS NULL
    AND "type" NOT IN ('investment', 'pension', 'crypto')
) c
WHERE a."id" = c."id"
  AND c."iban" ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'
  AND mod(
    (
      SELECT string_agg(CASE WHEN ch ~ '[A-Z]' THEN (ascii(ch) - 55)::text ELSE ch END, '' ORDER BY n)
      FROM regexp_split_to_table(substr(c."iban", 5) || substr(c."iban", 1, 4), '') WITH ORDINALITY AS t(ch, n)
    )::numeric,
    97
  ) = 1;

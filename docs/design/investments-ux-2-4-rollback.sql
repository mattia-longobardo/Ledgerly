-- Investments UX U2–U4 rollback (docs/design/investments-ux-2-4.md, PERS-119): the two additive
-- columns of the release and their rows in the journal, so that a new deploy applies them again.
-- Optional: the image before the release (`ledgerly:pre-ux-2-4`) never reads them. Run it only
-- after that image is back up, and only if the release is not coming back soon: what it drops is
-- the class of every correction chosen since (U3) and the cost eToro gave on every sync (U4).
BEGIN;

-- 0041_reading_cost (U4).
ALTER TABLE "investment_reading_positions" DROP COLUMN IF EXISTS "cost_cents";

-- 0040_adjustment_class (U3).
ALTER TABLE "investment_operations" DROP CONSTRAINT IF EXISTS "investment_operations_adjustment_class_ck";
ALTER TABLE "investment_operations" DROP COLUMN IF EXISTS "adjustment_class";

-- The journal rows: `created_at` is the `when` of each migration in drizzle/meta/_journal.json.
DELETE FROM drizzle.__drizzle_migrations WHERE created_at IN (1793269266730, 1793274877087);

COMMIT;

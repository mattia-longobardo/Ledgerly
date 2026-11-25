-- Wallet's tree of categories (2026-11-25, decisions 1A, 3A, 4B, 5A): the people who started from
-- the 15 old default groups move to the 11 groups and 70 sub-categories of `groups.json`. An old
-- default the person left as it was (name, kind, no parent, no sub-category) is renamed and moved
-- into the new tree — its movements, budgets and rules point at its id and follow it —; every group
-- and sub-category they still miss is created, in the language their old names were written in,
-- with the group's colour. A category the person made or changed is never touched; its old mark
-- goes, so no table points at it any more. Re-runnable, in one transaction (the temporary tables go
-- at its end): `wallet-tree.itest.ts` runs this file again on fixtures. The tree below is
-- `groups.json` as of this release and stays so: a later change of the tree is a later migration.
CREATE TEMP TABLE "wallet_tree" ("key" text PRIMARY KEY, "parent_key" text, "type" text NOT NULL, "color" text, "en" text NOT NULL, "it" text NOT NULL, "position" integer NOT NULL) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO "wallet_tree" VALUES
('food_drinks', NULL, 'expense', '#ed4a49', 'Food & Drinks', 'Cibo e bevande', 1),
('food_drinks.bar_cafe', 'food_drinks', 'expense', NULL, 'Bar, cafe', 'Bar, caffè', 2),
('food_drinks.restaurants', 'food_drinks', 'expense', NULL, 'Restaurant, fast-food', 'Ristoranti, fast food', 3),
('food_drinks.groceries', 'food_drinks', 'expense', NULL, 'Groceries', 'Spesa alimentare', 4),
('shopping', NULL, 'expense', '#3fa9e5', 'Shopping', 'Shopping', 5),
('shopping.drugstore', 'shopping', 'expense', NULL, 'Drug-store, chemist', 'Farmacia, drogheria', 6),
('shopping.leisure_time', 'shopping', 'expense', NULL, 'Leisure time', 'Tempo libero', 7),
('shopping.stationery_tools', 'shopping', 'expense', NULL, 'Stationery, tools', 'Cartoleria, attrezzi', 8),
('shopping.gifts', 'shopping', 'expense', NULL, 'Gifts, joy', 'Regali', 9),
('shopping.electronics', 'shopping', 'expense', NULL, 'Electronics, accessories', 'Elettronica, accessori', 10),
('shopping.pets', 'shopping', 'expense', NULL, 'Pets, animals', 'Animali', 11),
('shopping.home_garden', 'shopping', 'expense', NULL, 'Home, garden', 'Casa, giardino', 12),
('shopping.kids', 'shopping', 'expense', NULL, 'Kids', 'Bambini', 13),
('shopping.health_beauty', 'shopping', 'expense', NULL, 'Health and beauty', 'Salute e bellezza', 14),
('shopping.jewels', 'shopping', 'expense', NULL, 'Jewels, accessories', 'Gioielli, accessori', 15),
('shopping.clothes', 'shopping', 'expense', NULL, 'Clothes & Footwear', 'Abbigliamento e scarpe', 16),
('housing', NULL, 'expense', '#df911a', 'Housing', 'Casa', 17),
('housing.property_insurance', 'housing', 'expense', NULL, 'Property insurance', 'Assicurazione casa', 18),
('housing.maintenance', 'housing', 'expense', NULL, 'Maintenance, repairs', 'Manutenzione, riparazioni', 19),
('housing.services', 'housing', 'expense', NULL, 'Services', 'Servizi', 20),
('housing.utilities', 'housing', 'expense', NULL, 'Energy, utilities', 'Energia, utenze', 21),
('housing.mortgage', 'housing', 'expense', NULL, 'Mortgage', 'Mutuo', 22),
('housing.rent', 'housing', 'expense', NULL, 'Rent', 'Affitto', 23),
('transportation', NULL, 'expense', '#a8afb8', 'Transportation', 'Trasporti', 24),
('transportation.business_trips', 'transportation', 'expense', NULL, 'Business trips', 'Viaggi di lavoro', 25),
('transportation.long_distance', 'transportation', 'expense', NULL, 'Long distance', 'Lunga distanza', 26),
('transportation.taxi', 'transportation', 'expense', NULL, 'Taxi', 'Taxi', 27),
('transportation.public_transport', 'transportation', 'expense', NULL, 'Public transport', 'Trasporto pubblico', 28),
('vehicle', NULL, 'expense', '#8e57d8', 'Vehicle', 'Veicoli', 29),
('vehicle.leasing', 'vehicle', 'expense', NULL, 'Leasing', 'Leasing', 30),
('vehicle.vehicle_insurance', 'vehicle', 'expense', NULL, 'Vehicle insurance', 'Assicurazione veicolo', 31),
('vehicle.rentals', 'vehicle', 'expense', NULL, 'Rentals', 'Noleggi', 32),
('vehicle.vehicle_maintenance', 'vehicle', 'expense', NULL, 'Vehicle maintenance', 'Manutenzione veicolo', 33),
('vehicle.parking', 'vehicle', 'expense', NULL, 'Parking', 'Parcheggio', 34),
('vehicle.fuel', 'vehicle', 'expense', NULL, 'Fuel', 'Carburante', 35),
('life_entertainment', NULL, 'expense', '#4db956', 'Life & Entertainment', 'Vita e svago', 36),
('life_entertainment.gambling', 'life_entertainment', 'expense', NULL, 'Lottery, gambling', 'Lotterie, giochi', 37),
('life_entertainment.alcohol_tobacco', 'life_entertainment', 'expense', NULL, 'Alcohol, tobacco', 'Alcol, tabacco', 38),
('life_entertainment.charity', 'life_entertainment', 'expense', NULL, 'Charity, gifts', 'Beneficenza, regali', 39),
('life_entertainment.holidays', 'life_entertainment', 'expense', NULL, 'Holiday, trips, hotels', 'Vacanze, viaggi, hotel', 40),
('life_entertainment.streaming', 'life_entertainment', 'expense', NULL, 'TV, Streaming', 'TV, streaming', 41),
('life_entertainment.books_subscriptions', 'life_entertainment', 'expense', NULL, 'Books, audio, subscriptions', 'Libri, audio, abbonamenti', 42),
('life_entertainment.education', 'life_entertainment', 'expense', NULL, 'Education, development', 'Istruzione, formazione', 43),
('life_entertainment.hobbies', 'life_entertainment', 'expense', NULL, 'Hobbies', 'Hobby', 44),
('life_entertainment.life_events', 'life_entertainment', 'expense', NULL, 'Life events', 'Eventi della vita', 45),
('life_entertainment.culture_events', 'life_entertainment', 'expense', NULL, 'Culture, sport events', 'Cultura, eventi sportivi', 46),
('life_entertainment.sport_fitness', 'life_entertainment', 'expense', NULL, 'Active sport, fitness', 'Sport, fitness', 47),
('life_entertainment.wellness', 'life_entertainment', 'expense', NULL, 'Wellness, beauty', 'Benessere, bellezza', 48),
('life_entertainment.health_care', 'life_entertainment', 'expense', NULL, 'Health care, doctor', 'Sanità, medico', 49),
('communication_pc', NULL, 'expense', '#356ddc', 'Communication, PC', 'Comunicazioni, PC', 50),
('communication_pc.postal', 'communication_pc', 'expense', NULL, 'Postal services', 'Servizi postali', 51),
('communication_pc.software', 'communication_pc', 'expense', NULL, 'Software, apps, games', 'Software, app, giochi', 52),
('communication_pc.internet', 'communication_pc', 'expense', NULL, 'Internet', 'Internet', 53),
('communication_pc.telephony', 'communication_pc', 'expense', NULL, 'Telephony, mobile phone', 'Telefonia, cellulare', 54),
('financial_expenses', NULL, 'expense', '#05b9cf', 'Financial expenses', 'Spese finanziarie', 55),
('financial_expenses.child_support', 'financial_expenses', 'expense', NULL, 'Child Support', 'Mantenimento figli', 56),
('financial_expenses.charges_fees', 'financial_expenses', 'expense', NULL, 'Charges, Fees', 'Commissioni, spese', 57),
('financial_expenses.advisory', 'financial_expenses', 'expense', NULL, 'Advisory', 'Consulenze', 58),
('financial_expenses.fines', 'financial_expenses', 'expense', NULL, 'Fines', 'Multe', 59),
('financial_expenses.loans_interests', 'financial_expenses', 'expense', NULL, 'Loans, interests', 'Prestiti, interessi', 60),
('financial_expenses.insurances', 'financial_expenses', 'expense', NULL, 'Insurances', 'Assicurazioni', 61),
('financial_expenses.taxes', 'financial_expenses', 'expense', NULL, 'Taxes', 'Tasse', 62),
('investments', NULL, 'expense', '#e141aa', 'Investments', 'Investimenti', 63),
('investments.collections', 'investments', 'expense', NULL, 'Collections', 'Collezioni', 64),
('investments.savings', 'investments', 'expense', NULL, 'Savings', 'Risparmi', 65),
('investments.financial_investments', 'investments', 'expense', NULL, 'Financial investments', 'Investimenti finanziari', 66),
('investments.vehicles_chattels', 'investments', 'expense', NULL, 'Vehicles, chattels', 'Veicoli, beni mobili', 67),
('investments.realty', 'investments', 'expense', NULL, 'Realty', 'Immobili', 68),
('income', NULL, 'income', '#ebc831', 'Income', 'Entrate', 69),
('income.gifts_received', 'income', 'income', NULL, 'Gifts', 'Regali ricevuti', 70),
('income.child_support_received', 'income', 'income', NULL, 'Child Support', 'Mantenimento figli', 71),
('income.refunds', 'income', 'income', NULL, 'Refunds (tax, purchase)', 'Rimborsi', 72),
('income.winnings', 'income', 'income', NULL, 'Lottery, gambling', 'Vincite', 73),
('income.checks_coupons', 'income', 'income', NULL, 'Checks, coupons', 'Buoni, coupon', 74),
('income.lending_renting', 'income', 'income', NULL, 'Lending, renting', 'Prestiti, noleggi', 75),
('income.grants', 'income', 'income', NULL, 'Dues & grants', 'Contributi, sussidi', 76),
('income.rental_income', 'income', 'income', NULL, 'Rental income', 'Affitti incassati', 77),
('income.sale', 'income', 'income', NULL, 'Sale', 'Vendite', 78),
('income.interests_dividends', 'income', 'income', NULL, 'Interests, dividends', 'Interessi, dividendi', 79),
('income.wage_invoices', 'income', 'income', NULL, 'Wage, invoices', 'Stipendio, fatture', 80),
('others', NULL, 'expense', '#5e646c', 'Others', 'Altro', 81);--> statement-breakpoint
CREATE TEMP TABLE "wallet_old" ("old_key" text PRIMARY KEY, "new_key" text NOT NULL, "en" text NOT NULL, "it" text NOT NULL, "type" text NOT NULL) ON COMMIT DROP;--> statement-breakpoint
INSERT INTO "wallet_old" VALUES
('home', 'housing', 'Home', 'Casa', 'expense'),
('groceries', 'food_drinks.groceries', 'Groceries', 'Spesa alimentare', 'expense'),
('restaurants', 'food_drinks.restaurants', 'Restaurants and bars', 'Ristoranti e bar', 'expense'),
('transport', 'transportation', 'Transport', 'Trasporti', 'expense'),
('health', 'life_entertainment.health_care', 'Health', 'Salute', 'expense'),
('shopping', 'shopping', 'Shopping', 'Shopping', 'expense'),
('leisure', 'life_entertainment', 'Leisure', 'Tempo libero', 'expense'),
('travel', 'life_entertainment.holidays', 'Travel', 'Viaggi', 'expense'),
('subscriptions', 'communication_pc', 'Subscriptions and services', 'Abbonamenti e servizi', 'expense'),
('taxes_fees', 'financial_expenses', 'Taxes and fees', 'Tasse e commissioni', 'expense'),
('other', 'others', 'Other', 'Altro', 'expense'),
('income', 'income.wage_invoices', 'Work', 'Lavoro', 'income'),
('other_income', 'income', 'Other income', 'Altre entrate', 'income');--> statement-breakpoint
-- The people who started from the old defaults and are not in the tree yet ("shopping" and "income"
-- are keys of both: a sub-category's key, with its dot, is the tree's only), and their language.
CREATE TEMP TABLE "wallet_people" ON COMMIT DROP AS
SELECT m."user_id", bool_or(c."name" = o."it" AND o."it" <> o."en") AS "italian"
FROM "category_group_marks" m JOIN "wallet_old" o ON o."old_key" = m."group_key" JOIN "categories" c ON c."id" = m."category_id"
WHERE NOT EXISTS (SELECT 1 FROM "category_group_marks" k WHERE k."user_id" = m."user_id" AND k."group_key" LIKE '%.%')
GROUP BY m."user_id";--> statement-breakpoint
-- The old defaults the person left as they were.
CREATE TEMP TABLE "wallet_moves" ON COMMIT DROP AS
SELECT c."id", c."user_id", o."new_key", t."parent_key", CASE WHEN p."italian" THEN t."it" ELSE t."en" END AS "name", t."color"
FROM "category_group_marks" m
JOIN "wallet_old" o ON o."old_key" = m."group_key"
JOIN "wallet_tree" t ON t."key" = o."new_key"
JOIN "categories" c ON c."id" = m."category_id"
JOIN "wallet_people" p ON p."user_id" = m."user_id"
WHERE c."archived_at" IS NULL AND c."parent_id" IS NULL AND c."type" = o."type" AND c."name" IN (o."en", o."it")
  AND NOT EXISTS (SELECT 1 FROM "categories" k WHERE k."parent_id" = c."id");--> statement-breakpoint
-- Every old mark steps aside first: an old key may be a new key with another meaning ("income").
UPDATE "category_group_marks" m SET "group_key" = '~old:' || m."group_key" FROM "wallet_old" o
WHERE o."old_key" = m."group_key" AND m."user_id" IN (SELECT "user_id" FROM "wallet_people");--> statement-breakpoint
-- An old default that becomes a group: its new name and the group's colour, unless the person chose one.
UPDATE "categories" c SET "name" = w."name", "color" = coalesce(c."color", w."color"), "updated_at" = now()
FROM "wallet_moves" w
WHERE c."id" = w."id" AND w."parent_key" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "categories" k WHERE k."user_id" = c."user_id" AND k."parent_id" IS NULL AND k."name" = w."name" AND k."id" <> c."id");--> statement-breakpoint
UPDATE "category_group_marks" m SET "group_key" = w."new_key"
FROM "wallet_moves" w JOIN "categories" c ON c."id" = w."id"
WHERE m."category_id" = w."id" AND w."parent_key" IS NULL AND c."name" = w."name";--> statement-breakpoint
-- The groups each person still misses, then their marks (a category of the same name, kind and level counts).
INSERT INTO "categories" ("user_id", "name", "type", "color")
SELECT p."user_id", CASE WHEN p."italian" THEN t."it" ELSE t."en" END, t."type", t."color"
FROM "wallet_people" p CROSS JOIN "wallet_tree" t
WHERE t."parent_key" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "category_group_marks" m WHERE m."user_id" = p."user_id" AND m."group_key" = t."key")
ORDER BY p."user_id", t."position"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "category_group_marks" ("category_id", "user_id", "group_key")
SELECT c."id", p."user_id", t."key"
FROM "wallet_people" p CROSS JOIN "wallet_tree" t
JOIN "categories" c ON c."user_id" = p."user_id" AND c."parent_id" IS NULL AND c."archived_at" IS NULL AND c."type" = t."type"
  AND c."name" = CASE WHEN p."italian" THEN t."it" ELSE t."en" END
WHERE t."parent_key" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "category_group_marks" m WHERE m."user_id" = p."user_id" AND m."group_key" = t."key")
  AND NOT EXISTS (SELECT 1 FROM "category_group_marks" m WHERE m."category_id" = c."id")
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- An old default that becomes a sub-category moves under its group, with its new name.
UPDATE "categories" c SET "parent_id" = g."category_id", "name" = w."name", "updated_at" = now()
FROM "wallet_moves" w
JOIN "category_group_marks" g ON g."user_id" = w."user_id" AND g."group_key" = w."parent_key"
WHERE c."id" = w."id" AND w."parent_key" IS NOT NULL AND c."parent_id" IS NULL
  AND NOT EXISTS (SELECT 1 FROM "categories" k WHERE k."user_id" = c."user_id" AND k."parent_id" = g."category_id" AND k."name" = w."name");--> statement-breakpoint
UPDATE "category_group_marks" m SET "group_key" = w."new_key"
FROM "wallet_moves" w JOIN "categories" c ON c."id" = w."id"
WHERE m."category_id" = w."id" AND w."parent_key" IS NOT NULL AND c."parent_id" IS NOT NULL;--> statement-breakpoint
-- The sub-categories each person still misses, under their group, then their marks.
INSERT INTO "categories" ("user_id", "name", "type", "parent_id")
SELECT p."user_id", CASE WHEN p."italian" THEN t."it" ELSE t."en" END, t."type", g."category_id"
FROM "wallet_people" p CROSS JOIN "wallet_tree" t
JOIN "category_group_marks" g ON g."user_id" = p."user_id" AND g."group_key" = t."parent_key"
WHERE t."parent_key" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "category_group_marks" m WHERE m."user_id" = p."user_id" AND m."group_key" = t."key")
ORDER BY p."user_id", t."position"
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "category_group_marks" ("category_id", "user_id", "group_key")
SELECT c."id", p."user_id", t."key"
FROM "wallet_people" p CROSS JOIN "wallet_tree" t
JOIN "category_group_marks" g ON g."user_id" = p."user_id" AND g."group_key" = t."parent_key"
JOIN "categories" c ON c."user_id" = p."user_id" AND c."parent_id" = g."category_id" AND c."archived_at" IS NULL AND c."type" = t."type"
  AND c."name" = CASE WHEN p."italian" THEN t."it" ELSE t."en" END
WHERE t."parent_key" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "category_group_marks" m WHERE m."user_id" = p."user_id" AND m."group_key" = t."key")
  AND NOT EXISTS (SELECT 1 FROM "category_group_marks" m WHERE m."category_id" = c."id")
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- The old marks left are on categories the person made their own: no table points at them any more.
DELETE FROM "category_group_marks" WHERE "group_key" LIKE '~old:%';

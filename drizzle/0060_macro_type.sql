-- N3.3 (categories-and-rules.md §3.4): the type of every movement, once, by the rule of §3.2 —
-- the same rule as `src/modules/transactions/macro.ts`. Data only; recovery is the release's dump.
UPDATE "transactions" AS u SET "type" = n."type", "locally_edited" = n.marker
FROM (
  SELECT t.id,
    CASE
      WHEN t.transfer_group_id IS NOT NULL THEN t.type
      WHEN c.type = 'transfer' THEN 'transfer'
      WHEN t.type = 'transfer' AND t.origin = 'provider' AND NOT ('type' = ANY(t.locally_edited)) THEN 'transfer'
      WHEN t.amount_cents > 0 THEN 'income'
      WHEN t.amount_cents < 0 THEN 'expense'
      WHEN t.type = 'transfer' THEN 'income'
      ELSE t.type
    END AS "type",
    CASE
      WHEN t.transfer_group_id IS NOT NULL THEN t.locally_edited
      WHEN c.type = 'transfer' THEN array(SELECT f FROM unnest(array_append(array_remove(t.locally_edited, 'type'), 'type')) f ORDER BY f COLLATE "C")
      ELSE array_remove(t.locally_edited, 'type')
    END AS marker
  FROM "transactions" t LEFT JOIN "categories" c ON c.id = t.category_id
) AS n
WHERE u.id = n.id AND (u."type" <> n."type" OR u.locally_edited <> n.marker);

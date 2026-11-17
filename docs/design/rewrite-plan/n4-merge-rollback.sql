-- Recovery of the N4 correction "join an account of the bank already here" (decision H54,
-- docs/design/rewrite-plan/03-releases.md "N4", migration 0058_account_merge).
--
-- Use it ONLY before going back to the image before this correction, and only when a switch that
-- joined an account is still open (no "Undo switch" from the interface). The image before does not
-- know the join: its "Undo switch" would leave the joined account archived, without its bank, and
-- its movements not counting. This file does what "Undo switch" does, for every open switch that
-- joined an account, of every person:
--   1. every bank link the join moved goes back to the joined account's movement, which counts again;
--   2. a movement kept gets back the category and the note it had, when it still holds the joined
--      account's ones;
--   3. every transfer pair of the switch goes back to the type and the group it had;
--   4. the rows the bank brought to the account no longer count, and the bank's links on the
--      account's rows go;
--   5. the interest rules get back their mode;
--   6. the account comes from the source of before again; an IBAN the switch gave goes;
--   7. the joined account takes its bank back, as it was;
--   8. the switch is closed.
-- Switches without a join are not touched: the image before undoes them itself.
-- No row of a movement is deleted. Run it in one transaction, after a dump:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/design/rewrite-plan/n4-merge-rollback.sql
BEGIN;

CREATE TEMP TABLE joins ON COMMIT DROP AS
SELECT * FROM account_switches WHERE undone_at IS NULL AND merged_account_id IS NOT NULL;

-- 1. The bank's links back to the joined account's movements; those count again.
UPDATE provider_links l SET entity_id = m.double_id, updated_at = now()
FROM switch_merged_movements m JOIN joins s ON s.id = m.switch_id
WHERE m.undone_at IS NULL AND m.external_id IS NOT NULL
  AND l.user_id = m.user_id AND l.provider = s.to_provider AND l.entity_type = 'transaction'
  AND l.external_id = m.external_id;

UPDATE transactions t SET removed_upstream_at = NULL
FROM switch_merged_movements m JOIN joins s ON s.id = m.switch_id
WHERE m.undone_at IS NULL AND t.id = m.double_id;

-- 2. Category and note of a movement kept, back as they were when the join's ones are still there.
UPDATE transactions k
SET category_id = (m.kept_before->>'categoryId')::uuid,
    category_origin = m.kept_before->>'categoryOrigin',
    category_confidence = (m.kept_before->>'categoryConfidence')::real,
    category_model_version = (m.kept_before->>'categoryModelVersion')::integer,
    suggested_category_id = (m.kept_before->>'suggestedCategoryId')::uuid,
    category_reason = m.kept_before->>'categoryReason',
    category_reason_params = m.kept_before->'categoryReasonParams',
    locally_edited = array_remove(k.locally_edited, 'categoryId')
      || CASE WHEN m.kept_before->'locallyEdited' ? 'categoryId' THEN ARRAY['categoryId'] ELSE ARRAY[]::text[] END
FROM switch_merged_movements m JOIN joins s ON s.id = m.switch_id, transactions d
WHERE m.undone_at IS NULL AND m.kept_before IS NOT NULL AND k.id = m.kept_id AND d.id = m.double_id
  AND k.category_origin = 'user' AND k.category_id = d.category_id
  AND k.category_id IS DISTINCT FROM (m.kept_before->>'categoryId')::uuid;

UPDATE transactions k
SET note = m.kept_before->>'note',
    locally_edited = array_remove(k.locally_edited, 'note')
      || CASE WHEN m.kept_before->'locallyEdited' ? 'note' THEN ARRAY['note'] ELSE ARRAY[]::text[] END
FROM switch_merged_movements m JOIN joins s ON s.id = m.switch_id, transactions d
WHERE m.undone_at IS NULL AND m.kept_before IS NOT NULL AND k.id = m.kept_id AND d.id = m.double_id
  AND k.note IS NOT DISTINCT FROM d.note
  AND k.note IS DISTINCT FROM m.kept_before->>'note';

UPDATE switch_merged_movements m SET undone_at = now()
FROM joins s WHERE s.id = m.switch_id AND m.undone_at IS NULL;

-- 3. Transfers back to income and spending, as they were.
UPDATE transactions t
SET type = p.out_before->>'type', transfer_group_id = (p.out_before->>'transferGroupId')::uuid
FROM switch_transfer_pairs p JOIN joins s ON s.id = p.switch_id
WHERE p.undone_at IS NULL AND t.id = p.out_id;

UPDATE transactions t
SET type = p.in_before->>'type', transfer_group_id = (p.in_before->>'transferGroupId')::uuid
FROM switch_transfer_pairs p JOIN joins s ON s.id = p.switch_id
WHERE p.undone_at IS NULL AND t.id = p.in_id;

UPDATE switch_transfer_pairs p SET undone_at = now()
FROM joins s WHERE s.id = p.switch_id AND p.undone_at IS NULL;

-- 4. The bank's rows of the account no longer count; the bank's links on the account's rows go.
UPDATE transactions t SET removed_upstream_at = now()
FROM joins s
WHERE t.account_id = s.account_id AND t.removed_upstream_at IS NULL
  AND EXISTS (SELECT 1 FROM provider_links l WHERE l.entity_type = 'transaction' AND l.entity_id = t.id AND l.provider = s.to_provider)
  AND NOT EXISTS (SELECT 1 FROM provider_links l WHERE l.entity_type = 'transaction' AND l.entity_id = t.id AND l.provider = s.from_provider);

DELETE FROM provider_links l
USING transactions t, joins s
WHERE l.entity_type = 'transaction' AND l.entity_id = t.id
  AND t.account_id = s.account_id AND l.provider = s.to_provider;

-- 5. The interest rules get back their mode.
UPDATE interest_rules r SET mode = m.mode
FROM joins s, jsonb_to_recordset(s.interest_modes) AS m("ruleId" uuid, mode text)
WHERE r.id = m."ruleId";

-- 6. The account comes from the source of before.
UPDATE accounts a
SET provider = s.from_provider, provider_account_id = s.from_provider_account_id, origin = 'synced',
    iban = CASE WHEN s.iban_taken THEN NULL ELSE a.iban END,
    iban_from_source = CASE WHEN s.iban_taken THEN false ELSE a.iban_from_source END
FROM joins s
WHERE a.id = s.account_id;

-- 7. The joined account takes its bank back.
UPDATE accounts a
SET origin = 'synced', provider = s.to_provider, provider_account_id = s.to_provider_account_id,
    state = CASE WHEN s.merged_state = 'unavailable' THEN 'unavailable' ELSE 'active' END,
    archived_at = NULL, updated_at = now()
FROM joins s
WHERE a.id = s.merged_account_id AND a.provider IS NULL;

-- 8. The switch is closed.
UPDATE account_switches a SET undone_at = now() FROM joins s WHERE a.id = s.id;

COMMIT;

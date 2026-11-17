-- Recovery of N4b (docs/design/rewrite-plan/03-releases.md "N4", 04-now.md §4.6.1 point 16).
--
-- Use it ONLY before going back to the image `pre-n4b`, and only when a switch is still open (no
-- "Undo switch" from the interface). The image before N4b does not know the tables of the switch:
-- without this file the transfers of an open switch would stay transfers, and the account would
-- stay on the bank. It does what "Undo switch" does, for every open switch of every person:
--   1. every transfer pair of the switch goes back to the type and the group it had;
--   2. the rows the bank brought (a bank link and no link of the source of before) no longer count
--      (`removed_upstream_at`), and the bank's links on the account's rows go;
--   3. the interest rules get back their mode;
--   4. the account comes from the source of before again; an IBAN the switch gave goes;
--   5. the switch is closed.
-- No row of a movement is deleted. Run it in one transaction, after a dump:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f docs/design/rewrite-plan/n4-rollback.sql
BEGIN;

-- 1. Transfers back to income and spending, as they were.
UPDATE transactions t
SET type = p.out_before->>'type', transfer_group_id = (p.out_before->>'transferGroupId')::uuid
FROM switch_transfer_pairs p JOIN account_switches s ON s.id = p.switch_id
WHERE s.undone_at IS NULL AND p.undone_at IS NULL AND t.id = p.out_id;

UPDATE transactions t
SET type = p.in_before->>'type', transfer_group_id = (p.in_before->>'transferGroupId')::uuid
FROM switch_transfer_pairs p JOIN account_switches s ON s.id = p.switch_id
WHERE s.undone_at IS NULL AND p.undone_at IS NULL AND t.id = p.in_id;

UPDATE switch_transfer_pairs p SET undone_at = now()
FROM account_switches s
WHERE s.id = p.switch_id AND s.undone_at IS NULL AND p.undone_at IS NULL;

-- 2. The bank's rows no longer count; the bank's links on the account's rows go.
UPDATE transactions t SET removed_upstream_at = now()
FROM account_switches s
WHERE s.undone_at IS NULL AND t.account_id = s.account_id AND t.removed_upstream_at IS NULL
  AND EXISTS (SELECT 1 FROM provider_links l WHERE l.entity_type = 'transaction' AND l.entity_id = t.id AND l.provider = s.to_provider)
  AND NOT EXISTS (SELECT 1 FROM provider_links l WHERE l.entity_type = 'transaction' AND l.entity_id = t.id AND l.provider = s.from_provider);

DELETE FROM provider_links l
USING transactions t, account_switches s
WHERE s.undone_at IS NULL AND l.entity_type = 'transaction' AND l.entity_id = t.id
  AND t.account_id = s.account_id AND l.provider = s.to_provider;

-- 3. The interest rules get back their mode.
UPDATE interest_rules r SET mode = m.mode
FROM account_switches s, jsonb_to_recordset(s.interest_modes) AS m("ruleId" uuid, mode text)
WHERE s.undone_at IS NULL AND r.id = m."ruleId";

-- 4. The account comes from the source of before.
UPDATE accounts a
SET provider = s.from_provider, provider_account_id = s.from_provider_account_id,
    iban = CASE WHEN s.iban_taken THEN NULL ELSE a.iban END,
    iban_from_source = CASE WHEN s.iban_taken THEN false ELSE a.iban_from_source END
FROM account_switches s
WHERE s.undone_at IS NULL AND a.id = s.account_id;

-- 5. The switch is closed.
UPDATE account_switches SET undone_at = now() WHERE undone_at IS NULL;

COMMIT;

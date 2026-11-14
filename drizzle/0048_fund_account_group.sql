-- Release N6, exception X2 (docs/design/rewrite-plan/11-standardization.md §11.2.5, decision ST-17):
-- every fund is a pension fund, so the account that holds a fund's value is of type `pension`. The
-- account of a fund that had a debit plan was an `investment` account: it moves to the pension
-- group. Net worth does not change; the subtotal of the two groups does. The image before this
-- release takes both types.
UPDATE accounts
SET type = 'pension'
WHERE type = 'investment'
  AND id IN (SELECT valuation_account_id FROM funds);

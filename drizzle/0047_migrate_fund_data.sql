-- Release N6, step A2 (docs/design/rewrite-plan/11-standardization.md §11.2.4): the funds that exist
-- move to the single model. Nothing of the model before is changed or removed: `fund_deposits`,
-- `fund_deposit_rules`, `pension_rules`, `fund_fee_tariffs` and the old columns of `funds` stay as
-- they are, so the image before this release reads what it always read. They leave with R5f.
--
--   1. A fund with a debit plan (`type = 'pac'`): one `bank_debit` source from its plan and its
--      rule, its two fees as rows of `fund_fees`, and each deposit copied into `fund_operations` as
--      a `voluntary` operation with `origin_key = 'deposit:' || id`.
--   2. A fund fed by the payslip (`type = 'pension'`): one `payroll` source from its schedule rule
--      (the three components, by quarter, the due dates, the tolerance, the contract's percentages
--      in the note), the two fees of the rule and the published tariff as rows of `fund_fees`.
--      Its operations, its valuations and its documents are not touched.
--   3. `funds.code` takes the value of `funds.isin`.
--
-- The copy of the deposits is checked here, inside the transaction of the migration (test SN2): the
-- migration fails, and writes nothing, when the count, the sum debited, the sum of the fees or the
-- number of linked movements of the copy differ from the deposits.
--
-- The labels of the rows are data of the fund, written in the language of its owner, who may
-- change them. A fee of the tariff that the fund's own rule already states (the joining fee, the
-- membership fee) is not written twice: the rule's row carries the tariff's figure in its note.
DO $$
DECLARE
  fund record;
  schedule record;
  contract record;
  rule record;
  tariff record;
  italian boolean;
  v_source uuid;
  v_due_day smallint;
  v_due_offset smallint;
  v_due_entries jsonb;
  entry_count int;
  rule_days int;
  rule_offsets int;
  v_note text;
  fee_label text;
  fee_note text;
  deposits_count bigint;
  deposits_charged numeric;
  deposits_fees numeric;
  deposits_linked bigint;
  copied_count bigint;
  copied_charged numeric;
  copied_fees numeric;
  copied_linked bigint;
BEGIN
  FOR fund IN
    SELECT f.*, coalesce(p.locale, 'en') AS locale
    FROM funds f
    LEFT JOIN user_preferences p ON p.user_id = f.user_id
    WHERE NOT EXISTS (SELECT 1 FROM fund_contribution_sources s WHERE s.fund_id = f.id)
      AND NOT EXISTS (SELECT 1 FROM fund_fees x WHERE x.fund_id = f.id)
    ORDER BY f.created_at, f.id
  LOOP
    italian := fund.locale = 'it';
    v_source := NULL;

    IF fund.type = 'pac' THEN
      SELECT r.* INTO rule FROM fund_deposit_rules r WHERE r.fund_id = fund.id;
      IF fund.monthly_cents IS NOT NULL OR rule.id IS NOT NULL THEN
        INSERT INTO fund_contribution_sources
          (user_id, fund_id, kind, state, account_id, payee_match, amount_cents, debit_day,
           interval_count, interval_unit)
        VALUES
          (fund.user_id, fund.id, 'bank_debit',
           CASE WHEN rule.id IS NOT NULL AND NOT rule.active THEN 'paused' ELSE 'active' END,
           coalesce(rule.account_id, fund.debit_account_id), rule.payee_match, fund.monthly_cents,
           fund.debit_day, 1, 'month')
        RETURNING id INTO v_source;
      END IF;
      IF fund.deposit_fee_cents IS NOT NULL AND fund.deposit_fee_cents > 0 THEN
        INSERT INTO fund_fees (user_id, fund_id, label, basis, amount_cents, source_id)
        VALUES (fund.user_id, fund.id,
                CASE WHEN italian THEN 'Commissione per versamento' ELSE 'Fee per payment' END,
                'per_contribution', fund.deposit_fee_cents, v_source);
      END IF;
      IF fund.ter IS NOT NULL AND fund.ter > 0 THEN
        INSERT INTO fund_fees (user_id, fund_id, label, basis, rate, period)
        VALUES (fund.user_id, fund.id,
                CASE WHEN italian THEN 'Costi di gestione' ELSE 'Management costs' END,
                'on_assets', fund.ter, 'year');
      END IF;

      INSERT INTO fund_operations
        (user_id, fund_id, origin_key, original_type, classification, operation_date, worker_cents,
         fees_cents, fees_unknown, net_cents, transaction_id, source, source_id, note, created_at,
         updated_at)
      SELECT d.user_id, d.fund_id, 'deposit:' || d.id, 'voluntary', 'voluntary', d."on",
             d.charged_cents, coalesce(d.fee_cents, 0), d.fee_cents IS NULL,
             d.charged_cents - coalesce(d.fee_cents, 0), d.transaction_id, d.source,
             CASE WHEN d.source = 'rule' THEN v_source END, left(d.note, 200), d.created_at,
             d.updated_at
      FROM fund_deposits d
      WHERE d.fund_id = fund.id
      ORDER BY d."on", d.id;

    ELSE
      SELECT r.* INTO schedule
      FROM pension_rules r
      WHERE r.fund_id = fund.id AND r.kind = 'payment_schedule'
      ORDER BY r.valid_from DESC, r.id
      LIMIT 1;

      -- The due dates of the schedule in force, one entry per quarter. When every quarter is due
      -- on the same day, the same number of months after its end, they are a rule of two fields;
      -- otherwise they stay as explicit dates. A fund with no readable schedule had its transfers
      -- due on the 20th of the month after each quarter: that is what its numbers were built on,
      -- so that is what it keeps.
      SELECT count(*),
             count(DISTINCT (e ->> 'day')::int),
             count(DISTINCT (e ->> 'month')::int
                              + CASE WHEN (e ->> 'nextYear')::boolean THEN 12 ELSE 0 END
                              - (e ->> 'quarter')::int * 3),
             min((e ->> 'day')::int),
             min((e ->> 'month')::int
                   + CASE WHEN (e ->> 'nextYear')::boolean THEN 12 ELSE 0 END
                   - (e ->> 'quarter')::int * 3),
             jsonb_agg(jsonb_build_object('period', (e ->> 'quarter')::int,
                                          'month', (e ->> 'month')::int,
                                          'day', (e ->> 'day')::int,
                                          'nextYear', (e ->> 'nextYear')::boolean)
                       ORDER BY (e ->> 'quarter')::int)
      INTO entry_count, rule_days, rule_offsets, v_due_day, v_due_offset, v_due_entries
      FROM jsonb_array_elements(
             CASE WHEN jsonb_typeof(schedule.schedule) = 'array' THEN schedule.schedule ELSE '[]'::jsonb END
           ) AS e
      WHERE (e ->> 'quarter') ~ '^[1-4]$' AND (e ->> 'month') ~ '^([1-9]|1[0-2])$'
        AND (e ->> 'day') ~ '^([1-9]|1[0-9]|2[0-8])$' AND (e ->> 'nextYear') IN ('true', 'false');
      IF entry_count = 0 THEN
        v_due_day := 20;
        v_due_offset := 1;
        v_due_entries := NULL;
      ELSIF entry_count = 4 AND rule_days = 1 AND rule_offsets = 1 AND v_due_offset BETWEEN 0 AND 3 THEN
        v_due_entries := NULL;
      ELSE
        v_due_day := NULL;
        v_due_offset := NULL;
      END IF;

      SELECT r.* INTO contract
      FROM pension_rules r
      WHERE r.fund_id = fund.id AND r.kind = 'contribution'
      ORDER BY r.valid_from DESC, r.id
      LIMIT 1;
      v_note := NULL;
      IF contract.id IS NOT NULL THEN
        v_note := left(concat_ws(' · ',
          nullif(contract.ccnl, ''),
          nullif(contract.base, ''),
          CASE WHEN contract.worker_pct IS NOT NULL
               THEN (CASE WHEN italian THEN 'lavoratore ' ELSE 'worker ' END)
                    || trim(trailing '.' FROM trim(trailing '0' FROM contract.worker_pct::text)) || ' %' END,
          CASE WHEN contract.employer_pct IS NOT NULL
               THEN (CASE WHEN italian THEN 'datore di lavoro ' ELSE 'employer ' END)
                    || trim(trailing '.' FROM trim(trailing '0' FROM contract.employer_pct::text)) || ' %' END,
          CASE WHEN contract.tfr_pct IS NOT NULL
               THEN 'TFR ' || trim(trailing '.' FROM trim(trailing '0' FROM contract.tfr_pct::text)) || ' %' END,
          (CASE WHEN italian THEN 'dal ' ELSE 'from ' END) || contract.valid_from::text
        ), 300);
      END IF;

      INSERT INTO fund_contribution_sources
        (user_id, fund_id, kind, state, components, accrual_period, due_day, due_offset_months,
         due_entries, tolerance_days, note)
      VALUES
        (fund.user_id, fund.id, 'payroll',
         CASE WHEN fund.receives_payroll THEN 'active' ELSE 'paused' END,
         ARRAY['worker', 'employer', 'tfr'], 'quarter', v_due_day, v_due_offset, v_due_entries,
         coalesce(schedule.tolerance_days, 15), v_note)
      RETURNING id INTO v_source;

      -- The published tariff of the fund's provider, its newest version: the joining and the
      -- membership figures go in the notes of the rule's own rows below.
      IF schedule.id IS NOT NULL AND schedule.enrollment_fee_cents > 0 THEN
        SELECT string_agg(to_char(t.amount_cents / 100.0, 'FM999990.00') || ' EUR', ' + ' ORDER BY t.item)
        INTO fee_note
        FROM fund_fee_tariffs t
        WHERE t.provider = lower(coalesce(fund.provider, 'cometa')) AND t.unit = 'once'
          AND t.amount_cents IS NOT NULL
          AND t.valid_from = (SELECT max(valid_from) FROM fund_fee_tariffs
                              WHERE provider = lower(coalesce(fund.provider, 'cometa')));
        INSERT INTO fund_fees (user_id, fund_id, label, basis, amount_cents, source_id, note)
        VALUES (fund.user_id, fund.id, CASE WHEN italian THEN 'Adesione' ELSE 'Joining' END, 'one_off',
                schedule.enrollment_fee_cents, v_source,
                CASE WHEN fee_note IS NOT NULL
                     THEN (CASE WHEN italian THEN 'Tariffa pubblicata: ' ELSE 'Published tariff: ' END) || fee_note END);
      END IF;
      IF schedule.id IS NOT NULL AND schedule.quarter_fee_cents > 0 THEN
        SELECT string_agg(to_char(t.amount_cents / 100.0, 'FM999990.00') || ' EUR', ' + ' ORDER BY t.item)
        INTO fee_note
        FROM fund_fee_tariffs t
        WHERE t.provider = lower(coalesce(fund.provider, 'cometa')) AND t.unit = 'year'
          AND t.amount_cents IS NOT NULL
          AND t.valid_from = (SELECT max(valid_from) FROM fund_fee_tariffs
                              WHERE provider = lower(coalesce(fund.provider, 'cometa')));
        INSERT INTO fund_fees (user_id, fund_id, label, basis, amount_cents, period, source_id, note)
        VALUES (fund.user_id, fund.id,
                CASE WHEN italian THEN 'Quota associativa' ELSE 'Membership fee' END, 'periodic',
                schedule.quarter_fee_cents, 'quarter', v_source,
                CASE WHEN fee_note IS NOT NULL
                     THEN (CASE WHEN italian THEN 'Tariffa pubblicata: ' ELSE 'Published tariff: ' END)
                          || fee_note || (CASE WHEN italian THEN ' all''anno' ELSE ' a year' END) END);
      END IF;

      FOR tariff IN
        SELECT t.*
        FROM fund_fee_tariffs t
        WHERE t.provider = lower(coalesce(fund.provider, 'cometa'))
          AND t.unit IN ('year_of_assets', 'request')
          AND t.valid_from = (SELECT max(valid_from) FROM fund_fee_tariffs
                              WHERE provider = lower(coalesce(fund.provider, 'cometa')))
        ORDER BY t.unit DESC, t.item
      LOOP
        IF tariff.unit = 'year_of_assets' THEN
          CONTINUE WHEN tariff.rate IS NULL OR tariff.rate <= 0;
          fee_label := (CASE WHEN italian THEN 'Gestione · ' ELSE 'Management · ' END)
                       || initcap(replace(regexp_replace(tariff.item, '^management_', ''), '_', ' '));
          INSERT INTO fund_fees (user_id, fund_id, label, basis, rate, period, valid_from, note)
          VALUES (fund.user_id, fund.id, left(fee_label, 80), 'on_assets', tariff.rate, 'year',
                  tariff.valid_from, left(tariff.source_url, 300));
        ELSE
          CONTINUE WHEN tariff.amount_cents IS NULL OR tariff.amount_cents <= 0;
          fee_label := CASE tariff.item
            WHEN 'advance' THEN CASE WHEN italian THEN 'Anticipazione' ELSE 'Advance' END
            WHEN 'transfer' THEN CASE WHEN italian THEN 'Trasferimento' ELSE 'Transfer' END
            WHEN 'redemption' THEN CASE WHEN italian THEN 'Riscatto' ELSE 'Redemption' END
            WHEN 'switch' THEN CASE WHEN italian THEN 'Cambio di comparto' ELSE 'Change of compartment' END
            WHEN 'beneficiary' THEN CASE WHEN italian THEN 'Designazione dei beneficiari' ELSE 'Beneficiary designation' END
            WHEN 'assignment' THEN CASE WHEN italian THEN 'Cessione' ELSE 'Assignment' END
            ELSE initcap(replace(tariff.item, '_', ' '))
          END;
          fee_note := CASE tariff.note
            WHEN 'online_half' THEN CASE WHEN italian THEN 'Metà importo per una richiesta online' ELSE 'Half for an online request' END
            WHEN 'first_free' THEN CASE WHEN italian THEN 'La prima è gratuita' ELSE 'The first is free' END
          END;
          INSERT INTO fund_fees (user_id, fund_id, label, basis, amount_cents, valid_from, note)
          VALUES (fund.user_id, fund.id, left(fee_label, 80), 'per_request', tariff.amount_cents,
                  tariff.valid_from, left(concat_ws(' · ', fee_note, tariff.source_url), 300));
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  UPDATE funds SET code = left(isin, 40) WHERE isin IS NOT NULL AND code IS NULL;

  -- Test SN2: the copy is the deposits, or nothing is written.
  SELECT count(*), coalesce(sum(d.charged_cents), 0), coalesce(sum(coalesce(d.fee_cents, 0)), 0),
         count(d.transaction_id)
  INTO deposits_count, deposits_charged, deposits_fees, deposits_linked
  FROM fund_deposits d
  JOIN funds f ON f.id = d.fund_id
  WHERE f.type = 'pac';
  SELECT count(*), coalesce(sum(o.worker_cents), 0), coalesce(sum(o.fees_cents), 0),
         count(o.transaction_id)
  INTO copied_count, copied_charged, copied_fees, copied_linked
  FROM fund_operations o
  WHERE o.origin_key LIKE 'deposit:%';
  IF copied_count <> deposits_count OR copied_charged <> deposits_charged
     OR copied_fees <> deposits_fees OR copied_linked <> deposits_linked THEN
    RAISE EXCEPTION 'N6 A2: the copy of the deposits differs (rows % of %, debited % of %, fees % of %, movements % of %)',
      copied_count, deposits_count, copied_charged, deposits_charged, copied_fees, deposits_fees,
      copied_linked, deposits_linked;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM fund_deposits d
    JOIN funds f ON f.id = d.fund_id
    LEFT JOIN fund_operations o ON o.fund_id = d.fund_id AND o.origin_key = 'deposit:' || d.id
    WHERE f.type = 'pac'
      AND (o.id IS NULL OR o.operation_date <> d."on" OR o.worker_cents <> d.charged_cents
           OR o.fees_cents <> coalesce(d.fee_cents, 0) OR o.fees_unknown <> (d.fee_cents IS NULL)
           OR o.transaction_id IS DISTINCT FROM d.transaction_id OR o.source <> d.source)
  ) THEN
    RAISE EXCEPTION 'N6 A2: a copied deposit differs from its original';
  END IF;
  RAISE NOTICE 'N6 A2: % deposits copied, % sources, % fees',
    copied_count,
    (SELECT count(*) FROM fund_contribution_sources),
    (SELECT count(*) FROM fund_fees);
END $$;

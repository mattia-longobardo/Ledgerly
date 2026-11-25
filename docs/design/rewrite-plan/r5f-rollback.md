# R5f.2 · Deploy and way back

R5f.2 (migration `0077_r5f_cleanup`) removes columns, tables and values. It is the one release of the
plan that is **not** compatible with the image before it: the images `pre-r5f` alone do not bring it
back. The way back is the dump `r5f`, restored over `ledgerly`. Every command runs on the homelab, from
the checkout of the deploy (`~/docker/projects/ledgerly`), at the SHA approved by Mattia.

## 1. Before the deploy: the exact counts

`0077` stops if a table holds more rows than the ones counted for it, but it accepts fewer: the tests
and a new instance have less in them. In production the counts have to be equal. The query below has to
answer the numbers of the PR, one by one. Any difference: stop, do not deploy, write it in the issue.

```sh
docker exec postgres psql -U mattia -d ledgerly -At -c "
select 'job_runs quarter', count(*) from job_runs where tier = 'quarter' union all
select 'fund_fee_tariffs', count(*) from fund_fee_tariffs union all
select 'fund_deposits', count(*) from fund_deposits union all
select 'fund_deposit_rules', count(*) from fund_deposit_rules union all
select 'pension_rules', count(*) from pension_rules union all
select 'timeoff_allowances', count(*) from timeoff_allowances union all
select 'funds', count(*) from funds union all
select 'payslips', count(*) from payslips union all
select 'pension_competences', count(*) from pension_competences union all
select 'leave_days', count(*) from leave_days union all
select 'leave_types', count(*) from leave_types union all
select 'interest_rules', count(*) from interest_rules union all
select 'documents of a fund', count(*) from documents where kind <> 'payslip' union all
select 'pocket withdrawals', count(*) from pocket_movements where kind in ('withdrawal', 'adjustment') union all
select 'patron saints', count(*) from user_preferences where patron_month is not null union all
select 'module funds', count(*) from user_preferences where 'funds' = any(modules)"
```

## 2. The dump and its restore test

The dump is taken inside the running `ledgerly` container, before the build (`scripts/release.sh`, step
3). To have it before anything else and test it, take it on its own first, with the release id `r5f`:

```sh
folder=$(sh scripts/release-dump.sh r5f | tail -n 1)    # ../ledgerly-dumps/r5f-<sha7>/ledgerly.dump
docker exec postgres psql -U mattia -d postgres -c "create database ledgerly_r5f_restore owner ledgerly"
docker exec -i postgres pg_restore -U mattia -d ledgerly_r5f_restore --no-owner --role=ledgerly < "$folder/ledgerly.dump"
```

The restore is right when every table has the same rows as production:

```sh
count() { docker exec postgres psql -U mattia -d "$1" -At -c "
  select string_agg(format('%s %s', table_name,
    (xpath('/row/n/text()', query_to_xml(format('select count(*) as n from %I', table_name), false, true, '')))[1]::text), E'\n' order by table_name)
  from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'"; }
diff <(count ledgerly) <(count ledgerly_r5f_restore) && echo "restore: equal"
docker exec postgres psql -U mattia -d postgres -c "drop database ledgerly_r5f_restore"
```

`restore: equal` or stop. The dump stays until Mattia says to remove it (06-data.md §6.3).

## 3. The deploy

```sh
sh scripts/release.sh r5f --before-from ../ledgerly-v0.71.0
```

`release.sh` takes the dump again in the same folder (the database has not changed since step 2) and
tags the images `pre-r5f`. The numbers "before" are read with the code of `v0.71.0`, the "after" with the
new one: a person whose time off has figures sees them by type now, a declared difference (status 2).

After the deploy, the check of the schema:

```sh
docker exec postgres psql -U mattia -d ledgerly -At \
  -c "select count(*) from drizzle.__drizzle_migrations" \
  -c "select count(*) from information_schema.columns where table_name = 'payslips' and column_name = 'type'" \
  -c "select count(*) from information_schema.tables where table_name in ('fund_deposits', 'pension_rules', 'timeoff_allowances')"
```

78, 0 and 0. Then `@smoke`, the `@site` tests of the selection and the tag.

## 4. The way back

Only with the dump of step 2. What was written between the deploy and the way back is lost: decide fast.

```sh
docker compose stop ledgerly ledgerly-web ledgerly-worker
docker exec postgres psql -U mattia -d postgres -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = 'ledgerly'"
docker exec -i postgres pg_restore -U mattia -d ledgerly --clean --if-exists --no-owner --role=ledgerly < "$folder/ledgerly.dump"
for service in ledgerly ledgerly-web; do docker tag "$service:pre-r5f" "$service:latest"; done
docker compose up -d --no-build --wait ledgerly ledgerly-web ledgerly-worker
```

For every plugin `release.sh` tagged (`docker images | grep pre-r5f`): `docker tag <image>:pre-r5f
<image>:latest && docker compose up -d --no-build <service>`. Then: the migrations are 77 again, the
health answers `ok`, `@smoke` is green, `/api/v1/meta` answers `0.71.0`. Notify the problem
(`homelab-notify ledgerly`) and set the issue `blocked`.

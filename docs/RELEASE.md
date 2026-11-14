# Releasing Ledgerly

The checklist of spec §13, written so that somebody who did not write the code can run it. Every
step says what to do, what you should see, and what it means if you do not see it.

> **What changed from §13, and why.** §13 was written when `dash.longobardo.me` still served the
> previous dashboard, and it says to release onto a **new** `finance` database with a new
> `finance-dashboard` bucket, keeping the old `dashboard` database intact for rollback. That is no
> longer the world: there is no `dashboard-app` container and no `dashboard` database — Ledgerly
> already serves that host, on the `ledgerly` database and the `ledgerly` bucket, with Authentik
> already pointing at it. Those names were chosen to avoid a collision that no longer exists, so
> renaming them now would be a migration of live data for no gain. **Decided by the owner on
> 2026-09-21: the database and the bucket keep the name `ledgerly`.** Steps 1, 2 and 4 of §13 have
> no object any more and are marked as such below.

## 0. Before you start

You need a shell on the homelab host, in this checkout, with Docker. Everything else the release
needs is already there.

```bash
cd ~/docker/projects/ledgerly
git status          # clean, on the branch you mean to release
git log --oneline -1
```

Check that the running site is the one you think it is:

```bash
curl -s https://dash.longobardo.me/api/health
# {"status":"ok","db":"up","heartbeat":"fresh"}
```

`heartbeat` is `fresh` when the cron sidecar has ticked recently, `absent` for the first minutes
after a restart (that is normal), and `stale` when the sidecar has stopped — worth fixing before a
release, not during one.

## 1. The gate

Nothing is released that has not passed all of it. The checks that need the new build deployed come
back in step 4. The names `G1`…`G9` are those of the rewrite plan
([`design/rewrite-plan/03-releases.md`](design/rewrite-plan/03-releases.md) §3.1).

```bash
npm run format:check && npm run lint && npm run typecheck   # G1
npm test                          # G2 and G4: the unit tests, with `src/architecture.test.ts`
npm run assertions-diff           # G2: no refactor commit changed a test besides its imports
npm run test:integration          # G3 and G5: container on db_internal, `ledgerly_test` only
npm run perf                      # G9: no view or route slower or with more queries than its baseline
npm run db:generate               # must report no new migration to write
```

`npm run db:generate` printing a new migration file means the schema in the code and the migrations
on disk have drifted: commit the generated migration before going further, never after.

What the gate compares against lives in `baselines/` and is described in
[`operations.md`](operations.md#measures-and-baselines). A baseline is rewritten only by the commit
that removes a violation or by a written decision — never to make a step pass.

**The version.** The commit that closes a release sets `version` in `package.json` (and in
`package-lock.json`) to the tag its deploy will create (`git-policy` §9): the Maintenance card
prints that number, so it has to be the one in production.

## 2. Keep the way back: image, dump, numbers

`<id>` is the release (`n1`, `r2`, …). Three things, in this order, just before the build.

```bash
docker tag ledgerly:latest ledgerly:pre-<id>          # and ledgerly-cron, if `cron/` changed
folder=$(sh scripts/release-dump.sh <id> | tail -n 1) # add --no-dump for a release with no migration
npm run numbers -- "$folder" before                   # prints the instant: keep it for step 4
```

- **The image** `pre-<id>` is the rollback of the code (step 8). The last five are kept.
- **The dump** is `pg_dump -Fc` of `ledgerly`, taken and verified (`pg_restore --list`) by the
  script, in `../Ledgerly-dumps/<id>-<sha7>/` with its `sha256` and a `MANIFEST.txt`. It is
  mandatory when the release has a migration or changes data; `--no-dump` makes the folder only.
  Where the folder is, who may read it and how long a dump is kept:
  [`operations.md`](operations.md#release-dumps).
- **The numbers snapshot** "before" (`numbers-before.json`, in the same folder) is every number the
  app shows, for every real user, read in one transaction that is rolled back. Step 4 takes it again.

The application also backs itself up every day (`database-backup`, in the bucket under `backups/`).
That is another thing: it is not the release's dump and a release does not rely on it.

> §13 step 2 — recovering the production environment values from `docker inspect dashboard-app` —
> **has no object**: `.env.homelab` exists and is the file Compose reads. Check it is still
> complete against `.env.example`, and remember that no value in it may contain a `$`.

## 3. Build and start

```bash
docker compose build ledgerly ledgerly-cron
docker compose up -d ledgerly ledgerly-cron
```

Migrations are applied by the container's entrypoint before the server starts
(`entrypoint.sh` → `migrate.mjs`), so there is no migration command to run by hand. The process
**refuses to start** if any environment value is missing or malformed, and says which one:

```bash
docker logs --tail 40 ledgerly
```

`[env] refusing to start: …` means a value is wrong — fix `.env.homelab` and bring it up again. The
container will not serve a half-configured app.

> §13 step 3 — a production `docker-compose.yml` with new service names — **has no object**:
> `docker-compose.yml` in this repository *is* the production one, with `ledgerly` and
> `ledgerly-cron` on `proxy_public`, `db_internal` and `mail_internal`.
>
> §13 step 4 — adding the Better Auth callback URI in Authentik — **has no object**: the
> `ledgerly` provider and application already exist there, with the `Ledgerly` group deciding who
> is an admin.

## 4. Check it, from outside

```bash
curl -s https://dash.longobardo.me/api/health     # G8: status ok, db up
npm run numbers -- "$folder" after --as-of <the instant step 2 printed>
npm run numbers -- --diff "$folder/numbers-before.json" "$folder/numbers-after.json"   # G5: "uguale"
npm run e2e                                        # G6: drives the deployed site
```

The two snapshots must be equal: `uguale`. Anything else prints how many numbers differ and their
names, never their values — a difference stops the release until it is explained (a sync that ran
between the two is an explanation; a number the release was not meant to move is a rollback). Only
the verdict and the names go in a comment: the files stay in the folder.

`npm run e2e` is the real check: it creates its `@example.test` users, walks every journey,
measures **every screen** at 1440 and 400 px in both themes, crosses the app from the keyboard, and
deletes the users and everything they own afterwards. It never touches anybody else's data.

Then open the site yourself and look at it. The e2e suite cannot tell you that a screen is ugly.

## 5. The first admin

Only needed on a database that has none — not on an upgrade.

Whoever signs in first through Authentik while a member of the `Ledgerly` group is an admin. If
Authentik is unavailable, make a password admin from the host:

```bash
ADMIN_PASSWORD='…' npm run user:create-admin -- you@example.com "Your Name"
```

## 6. Connect what comes from outside

As the admin, in the app:

1. **Settings → Integrations → Wallet**: paste the Budget Makers Wallet token. The first sync
   fetches **twelve months** in monthly windows and takes a while; the sync log on the same card
   shows every attempt, skipped ones included. Every pass after that re-reads the last seven days.
2. **Settings → Integrations → Trek**: connect the leave calendar. The first pass brings days in
   and never deletes one it does not know about.
3. **Settings → Profile**: your time zone, number format and, if you want it, a company holiday
   calendar.

## 7. Bring your own documents in

1. **Payroll → Add payslip**: upload the real payslips, oldest first. Each opens its review beside
   the PDF; confirm or correct anything marked *inferred*, acknowledge any failed check you accept,
   then **Verify** and **Apply to payroll**. Nothing enters the register until you apply it.
2. **Funds → Add fund → Pension fund**: create the fund, then **Import documents** for the Cometa
   operations export and the position summary. Operations are previewed row by row before anything
   is applied.
3. Check **Time off**: the residual should now come from the payslips, with the payslip it read
   named beside it.

## 8. If it goes wrong — rollback

```bash
# 1. back to the image of step 2
docker tag ledgerly:pre-<id> ledgerly:latest
docker compose up -d --no-build ledgerly

# 2. only if a change to the data is wrong: restore the dump of step 2
docker stop ledgerly
(cd "$folder" && sha256sum -c ledgerly.dump.sha256)
docker compose run --rm --no-deps -T --entrypoint sh ledgerly \
  -c 'pg_restore --clean --if-exists --no-owner -d "$DATABASE_URL"' < "$folder/ledgerly.dump"
docker compose up -d --no-build ledgerly
```

The image alone is enough for almost every release: a migration is always compatible with the
image before it ([`design/rewrite-plan/06-data.md`](design/rewrite-plan/06-data.md) §6.2), so the
schema stays and only the code goes back. Restoring the database undoes everything that happened
after the dump, including anything imported since. Restore only when the alternative is worse, and
never while the app is serving: stop `ledgerly` first.

## 9. After

- Watch `docker logs -f ledgerly` for a few minutes, and `/api/health` until `heartbeat` is `fresh`
  again (the hourly tick runs at minute 30).
- **Settings → Integrations** lists every scheduled job with its last run: the first hourly tick
  after a release is the one to look at.
- If `GOTIFY_URL` and `GOTIFY_TOKEN` are set, a failed job tells the admins by itself. If they are
  empty the alerts are simply off, which is a choice and not a fault.

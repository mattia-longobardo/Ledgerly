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

Nothing is released that has not passed all of it. The last two need the new build to be deployed,
so they come back in step 4.

```bash
npm run format:check && npm run lint && npm run typecheck && npm test
npm run test:integration          # container on db_internal, `ledgerly_test` only
npm run db:generate               # must report no new migration to write
```

`npm run db:generate` printing a new migration file means the schema in the code and the migrations
on disk have drifted: commit the generated migration before going further, never after.

## 2. Back the database up, and keep the backup

This is §13 step 1, against the database that actually exists.

The application backs itself up every day (`database-backup`), but a release is exactly the moment
the automatic backup is too old. Take one by hand: as an admin, **Settings → Server →
Maintenance → Back up now**, and wait for the card to show the new backup with its size. The dump
lands in the bucket under `backups/`, in `pg_dump -Fc` custom format, which is what `pg_restore`
takes.

Then write down, on paper or in your notes:

- the tag of the image now running: `docker inspect --format '{{.Image}}' ledgerly`
- the name and size of the backup the card shows.

Those two lines are the rollback plan. Do not skip them.

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
curl -s https://dash.longobardo.me/api/health     # status ok, db up
npm run e2e                                        # drives the deployed site
```

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
# 1. back to the image you wrote down in step 2
docker stop ledgerly && docker rm ledgerly
docker tag <the image id you wrote down> ledgerly:latest
docker compose up -d ledgerly ledgerly-cron

# 2. if the database has to go back too, restore the dump you took in step 2
#    (download it from the bucket under `backups/` first)
docker exec -i postgres pg_restore -U ledgerly -d ledgerly --clean --if-exists < <the dump>
```

Restoring the database undoes everything that happened after the backup, including anything you
imported in step 7. Restore only when the alternative is worse, and never while the app is
serving: stop `ledgerly` first.

> §13's rollback speaks of "the previous image and the `dashboard` database". The previous image is
> the one you wrote down; the `dashboard` database no longer exists, and its place is taken by the
> backup you took in step 2. That is why step 2 is not optional.

## 9. After

- Watch `docker logs -f ledgerly` for a few minutes, and `/api/health` until `heartbeat` is `fresh`
  again (the hourly tick runs at minute 07).
- **Settings → Integrations** lists every scheduled job with its last run: the first hourly tick
  after a release is the one to look at.
- If `GOTIFY_URL` and `GOTIFY_TOKEN` are set, a failed job tells the admins by itself. If they are
  empty the alerts are simply off, which is a choice and not a fault.

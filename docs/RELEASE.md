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

Nothing is released that has not passed its gate. The gate of a release is the tests of what the
release changed: [`testing.md`](testing.md) has the map `changed files → module → command`, and
`npm run test:select` reads the release diff (highest tag `vX.Y.Z` → `HEAD`) with it and prints the
commands. The names `G1`…`G10` are those of the rewrite plan
([`design/rewrite-plan/03-releases.md`](design/rewrite-plan/03-releases.md) §3.1).

```bash
npm run format:check && npm run lint && npm run typecheck   # G1, always
npm test                          # G2 and G4, always complete: the unit tests, with `tools/architecture.test.ts`
npm run assertions-diff           # G2: no refactor commit changed a test besides its imports
npm run test:select               # prints the rest: what follows is its answer for this release
sh scripts/test-integration.sh <the modules of the selection>   # G3 and G5; with no argument, all of it
npm run perf -- --queries         # G9, always: no view or route with more queries than its baseline
npm run perf                      # G9, the times: only when the selection says so, one series
npx playwright test -c playwright.preview.config.ts <the specs of the selection>   # G6, on the local preview
npm run db:generate               # must report no new migration to write
```

The gate runs **one time, on the final SHA**. On the commits before it: G1, `npm test` and the tests
of the files of the commit. The E2E run on the local preview before the deploy
([`testing.md`](testing.md), "The E2E tests, one time, on the local preview"); the deployed site
gets `@smoke` and the `@site` tests in step 4. The full suite runs before a deploy only when
`npm run test:select` prints `FULL SUITE`; it runs each night and at the end of a phase (G10).

`npm run db:generate` printing a new migration file means the schema in the code and the migrations
on disk have drifted: commit the generated migration before going further, never after.

What the gate compares against lives in `baselines/` and is described in
[`operations.md`](operations.md#measures-and-baselines). A baseline is rewritten only by the commit
that removes a violation or by a written decision — never to make a step pass.

**The version.** The commit that closes a release sets `version` in `package.json` (and in
`package-lock.json`) to the tag its deploy will create (`git-policy` §9): the Maintenance card
prints that number, so it has to be the one in production. Since R0 the root and every workspace
carry the same version (`tools/architecture.test.ts` holds them to it): `npm version <x.y.z>
--workspaces --include-workspace-root --no-git-tag-version` sets them all, and `npm run test:select`
reads a change of the version alone, in any `package.json` and in the lockfile, as no change.

## 2. Keep the way back: image, dump, numbers

`<id>` is the release (`n1`, `r2`, …). Three things, in this order, just before the build.

`sh scripts/release.sh <id> [--no-dump] [--cron] [--plugin <id>] [--before-from <checkout>]` runs this step and
steps 3 and 4 (health and numbers) in one go, under the deploy lock. It **stops before the build**
when the image, the dump or the snapshot "before" fails, or when `numbers-before.json` is missing,
empty or different from its checksum: a snapshot taken after the build says nothing about a
release that moves data. `--before-from` reads the snapshot "before" with the code of another
checkout (the release in production): a release with a migration needs it. Status 2 means deployed,
with numbers that differ. Every plugin of the catalog (`packages/domain/src/platform/plugins/catalog.json`) and
`ledgerly-egress` are in every release by themselves; `--plugin <id>` adds only a plugin outside it. The commands below are what the script runs.

```bash
docker tag ledgerly:latest ledgerly:pre-<id>          # the worker runs this image too
folder=$(sh scripts/release-dump.sh <id> | tail -n 1) # add --no-dump for a release with no migration
npm run numbers -- "$folder" before                   # prints the instant: keep it for step 4
```

- **The image** `pre-<id>` is the rollback of the code (step 8). The last five are kept.
- **The dump** is `pg_dump -Fc` of `ledgerly`, taken and verified (`pg_restore --list`) by the
  script, in `../ledgerly-dumps/<id>-<sha7>/` with its `sha256` and a `MANIFEST.txt`. It is
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

### The documents a fund's import left (release N6, step A4)

Done on 15/11/2026, with `v0.16.0`. The one-time scripts of the step (`scripts/fund-documents.ts`,
`scripts/fund-documents-on-homelab.sh`, `src/modules/imports/retired.ts`) were removed after it: they
are in the history of the repository, before the commit that removed them.

## 3. Build and start

```bash
docker compose build ledgerly
docker compose up -d --wait ledgerly
docker compose up -d --wait --no-build --remove-orphans ledgerly-worker
```

`scripts/release.sh` does not build the application when the image `ledgerly:preview` carries the
commit of the release (`sh scripts/preview-on-test.sh build`, from a clean tree): it gives that
image the tag `ledgerly:latest` and starts it — the image the E2E tests ran on. It says which of
the two it did (`image: …`). To build in any case, remove the image first
(`docker image rm ledgerly:preview`) or set `LEDGERLY_PREVIEW_IMAGE=none`. The way back does not
change: `ledgerly:pre-<id>` is tagged before `latest` moves (§8).

Migrations are applied by the container's entrypoint before the server starts
(`entrypoint.sh` → `migrate.mjs`), so there is no migration command to run by hand. The process
**refuses to start** if any environment value is missing or malformed, and says which one:

```bash
docker logs --tail 40 ledgerly
```

`[env] refusing to start: …` means a value is wrong — fix `.env.homelab` and bring it up again. The
container will not serve a half-configured app.

> §13 step 3 — a production `docker-compose.yml` with new service names — **has no object**:
> `docker-compose.yml` in this repository *is* the production one, with `ledgerly` on
> `proxy_public`, `db_internal` and `mail_internal` (and, from R1, `ledgerly-worker`).
>
> §13 step 4 — adding the Better Auth callback URI in Authentik — **has no object**: the
> `ledgerly` provider and application already exist there, with the `Ledgerly` group deciding who
> is an admin.

## 4. Check it, from outside

```bash
curl -s https://dash.longobardo.me/api/health     # G8: status ok, db up
npm run numbers -- "$folder" after --as-of <the instant step 2 printed>
npm run numbers -- --diff "$folder/numbers-before.json" "$folder/numbers-after.json"   # G5: "uguale"
E2E_ORIGIN=127.0.0.1 npx playwright test -g @smoke  # G6: the smoke tests, at the site's origin
E2E_ORIGIN=127.0.0.1 npx playwright test <specs> -g @site  # G6: the tests about the site itself, for the selected specs, at the site's origin
```

The two snapshots must be equal: `uguale`. Anything else prints how many numbers differ and their
names, never their values — a difference stops the release until it is explained (a sync that ran
between the two is an explanation; a number the release was not meant to move is a rollback). Only
the verdict and the names go in a comment: the files stay in the folder.

`scripts/release.sh` runs the first three commands and `@smoke` itself — at Traefik's origin, not
through Cloudflare, whose rate limit a run of them passes; a red smoke test is a failed deploy, with the rollback of step 8. The `@site` tests are the ones `npm run test:select` printed
under "After the deploy", at the site's origin too (`E2E_ORIGIN`): through Cloudflare they hit its rate limit. The E2E tests create their `@example.test` users before the run and delete
them, with everything they own, after it: they never touch anybody else's data. The rest of the
suite already ran on the preview, before the deploy: it does not run again here.

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
   fetches **twelve months** in monthly windows and takes a while; the row says "Update in
   progress…", and the log under "Advanced" shows every attempt, skipped ones included. Every pass after that re-reads the last seven days.
2. **Settings → Integrations → Trek**: connect the leave calendar. The first pass brings days in
   and never deletes one it does not know about.
3. **Settings → Profile**: your time zone, number format and, if you want it, a company holiday
   calendar.

## 7. Bring your own documents in

1. **Payroll → Add payslip**: upload the real payslips, oldest first. Each opens its review beside
   the PDF; confirm or correct anything marked *inferred*, acknowledge any failed check you accept,
   then **Verify** and **Apply to payroll**. Nothing enters the register until you apply it.
2. **Funds → Add fund**: create the fund in four steps. Switch on **Payslip** if your payslip pays
   into it: the contributions of the payslips already applied arrive at once. Then **Update value**
   with the value the fund reports.
3. Check **Time off**: the residual should now come from the payslips, with the payslip it read
   named beside it.

## 8. If it goes wrong — rollback

```bash
# 1. back to the images of step 2
docker tag ledgerly:pre-<id> ledgerly:latest && docker tag ledgerly-web:pre-<id> ledgerly-web:latest
docker compose up -d --no-build ledgerly ledgerly-web ledgerly-worker

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

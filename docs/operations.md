# Operations

How Ledgerly runs on the homelab, how to configure it, and the admin tasks.

## Architecture

`docker-compose.yml` starts seven containers. The server and the worker read `.env.homelab`; the
interface reads none of it (rewrite plan R4).

| Container                       | Role                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| `ledgerly`                      | The server (target `server`): `/api`, `/.well-known`. Applies the migrations at start.   |
| `ledgerly-web`                  | The interface (target `web`, image `ledgerly-web`): every other path. No database.       |
| `ledgerly-worker`               | The jobs and the syncs: the image `ledgerly`, `node /app/worker.mjs` (R1). See below.    |
| `ledgerly-plugin-enablebanking` | A plugin: reads banks through Enable Banking when the app asks. See below.               |
| `ledgerly-plugin-wallet`        | A plugin: reads Wallet with each person's token. See below.                              |
| `ledgerly-plugin-trek`          | A plugin: keeps the leave days level with each person's Trek. See below.                 |
| `ledgerly-egress`               | The plugins' forward proxy: their only way to the internet (`apps/egress`). See below.   |

- The interface's environment is `LEDGERLY_API_URL` (the server on `ledgerly_internal`),
  `LEDGERLY_ROLE=web` (its image) and `.env.web`, which holds public values only:
  `OIDC_DISCOVERY_URL` (the CSP's `form-action`) and `INSTANCE_CONTACT` (`/privacy`, `/terms`).
  `tools/web-env.test.ts` holds the service and the file to that list: no `DATABASE_URL`, no key.
  Its pages ask the server for the session (`/api/web/session`, the cookie only) and read the rest
  from `/api/v1` in the browser. Its health check is `/privacy`, a page with no session.
- The server is on `proxy_public` (Traefik), `db_internal` (Postgres, S3) and `ledgerly_internal`
  (`internal: true`, the interface only). The worker is on
  `db_internal`, `mail_internal`, `ledgerly_plugins` and `ledgerly_egress` (its way to the providers
  it calls itself: the exchanges, the ECB, the holidays); it has no port. The server is on
  `ledgerly_plugins` and `ledgerly_egress` too.
- At start, the app checks every environment variable (`src/platform/env.ts`). If a check fails,
  the app does not start.
- The app's health (`/api/health`) depends on the database only. It says the worker's heartbeat
  (`fresh`, `stale`, `absent`) without counting it; the worker's own health check is
  `node /app/worker.mjs --health` (a beat in `worker_heartbeats` in the last two minutes).
- `projects/stack.sh` finds both containers, so `./stack.sh up` starts them with the other projects.

### Plugins

A plugin is a small container of the standard installation. It speaks to one provider and keeps
nothing: no database, no encryption key, no volume, a read-only file system. Contract and rules:
`docs/design/rewrite-plan/04-now.md` §4.1; code: `plugins/<id>/` and `src/platform/plugins/`.

- **Only the app calls a plugin**, on the network `ledgerly_plugins` (`internal: true`). A plugin
  is not on `db_internal`, `proxy_public` or `mail_internal`, and has no port on the host. It calls
  its provider through `ledgerly-egress` only (below).
- **The catalog of the official plugins** (decisions H27, H28):
  `packages/domain/src/platform/plugins/catalog.json`, read by the core through a zod schema
  (`catalog.ts`) and by the proxy. One entry per plugin: `id`, `image` (the compose image, and the
  name of its container), `digest`, `egress` (the hosts every person shares) and, for a plugin whose
  host is the person's own, `dynamicHost.credential` (the credential that holds its address: Trek's
  `baseUrl`). A plugin of `PLUGIN_URLS` that is not in the catalog is never called, not even for its
  manifest, and is never listed to a person: Admin › Server › Diagnostics shows it as "Not an
  official plugin". A new official plugin is one entry, its service in compose, and its secrets.
  It lives in the domain package, not in `plugins/`: the core imports it, and no file of a
  package may import outside it (rule M1).
- **The digest** is the sha256 of the plugin's bundled `/app/server.mjs`. esbuild gives the same
  bytes for the same source and lockfile, here and in the image (checked: the three images built
  locally have the digests of the catalog), so the digest is reproducible without a registry.
  `npm run plugins:catalog` writes it after a change to a plugin (its version too: every release
  changes every plugin's digest); `tools/plugin-catalog.test.ts` (`npm test`) fails when it does not
  match a fresh bundle of the source. The core has no Docker socket: `sh scripts/plugins-check.sh`
  compares `docker exec <container> sha256sum /app/server.mjs` with the catalog, read only. It runs
  as the last step of `scripts/release.sh` and as a gate of the nightly suite (`scripts/full-suite.sh`).
- **The egress proxy** (`ledgerly-egress`, code in `apps/egress/`, decisions I8, A15): a forward
  proxy of the repository, Node only (`node:*`, no dependency), run by Node's type stripping. It is on
  `ledgerly_plugins` and on `ledgerly_egress`, the only network with a way out that a plugin can
  reach through it. A plugin sets `HTTPS_PROXY=http://<id>:<secret>@ledgerly-egress:3128` and
  `NODE_USE_ENV_PROXY=1` (compose), so its `fetch` sends `CONNECT host:443` with
  `Proxy-Authorization`. The proxy allows only: port 443 (TLS stays end to end, the proxy sees no
  content); the plugin proved by its own secret; a host of its catalog entry, or of a live grant;
  a name whose every address is public. It resolves the name itself, refuses private, loopback,
  link-local, shared (100.64/10, the VPN) and multicast addresses — Docker's networks included, all
  in 172.16/12 or 192.168/16 — also IPv4-mapped, and connects to the very address it checked (no
  second resolution). Each decision is one line of `docker logs ledgerly-egress`
  (`allow`/`refuse <plugin> <host:port> <reason>`).
- **The person's own host** (decision D1): before each call to a plugin whose entry has
  `dynamicHost`, the core (`packages/plugin-host/src/egress.ts`, from the calendar's calls) sends
  `POST /grants {plugin, host, ttlSeconds: 300}` to `EGRESS_URL` (port 8081) with
  `Authorization: Bearer <EGRESS_ADMIN_SECRET>`. The proxy keeps the grant in memory for at most 10
  minutes (a restart loses it; the next call sends it again) and refuses a host that is not a name
  or has a private address. Only `https://` on port 443: a Trek on another port or on the LAN
  cannot be reached.
- **Nobody installs a plugin in the interface.** The app knows its plugins from `PLUGIN_URLS` and
  reads each manifest by itself (again after one hour). A plugin with no manifest read is not shown.
- **Each person turns a plugin on for themselves**, in Settings › Integrations, and enters their own
  credentials. The app seals them (`APP_ENCRYPTION_KEY`) and sends them to the plugin in the body of
  each call. Turning the plugin off stops every call for that person; what is saved stays.
- **Reading a bank.** After the access the person chooses what each account of the bank is here
  (a new account, one of theirs kept by hand, or nothing), and the app reads the bank at once.
  Then it reads the bank on the connection's own schedule, through the same dispatcher as every
  other connection, and when the person presses "Update now". The recommended schedule, and the
  default, is three times a day (07:10, 13:10, 19:10 in the person's zone); the person changes it
  with "Change" in Settings › Plugins › Enable Banking. A bank allows at most 4 automatic readings
  a day (PSD2 limit), so the schedule cannot ask for more. A bank that
  answers "no more calls" puts the automatic readings on hold for six hours; "Update now" still
  works. A person connects as many banks as they want: one connection per bank (from N2). A movement is recognised by the bank's reference, or by a hash when it gives none, so a
  second reading writes nothing twice. "Disconnect" closes the access of that bank and leaves its
  accounts, with their balances and movements, as accounts kept by hand.
- **The prices plugin (R5d).** `ledgerly-plugin-prices` declares `prices.daily` and asks no
  credential: it serves the instance, not a person, and Settings does not list it. The app calls
  its `POST /prices` from the daily prices job, for the markets of the assets whose price is
  automatic. It reaches only `query1.finance.yahoo.com` and `query2.finance.yahoo.com`; Yahoo's
  endpoint is no official API and has no licence for automated use (risk accepted by Mattia on
  22/11/2026). The registry of instruments is the app's own: it calls `api.openfigi.com` and
  `registers.esma.europa.eu` itself. Its secret is the pair `prices=` of `PLUGIN_URLS` and
  `PLUGIN_SECRETS`, and `.env.plugin-prices` with the same value. It is in the catalog like every
  plugin, so it goes out through `ledgerly-egress` (`HTTPS_PROXY` in `.env.plugin-prices`) and is
  deployed by every release.
- **The state of a connection (from N2).** One pure rule for every provider
  (`src/platform/integrations/status.ts`): five values, a closed list of error codes
  (`auth`, `consent_expired`, `rate_limited`, `provider_down`, `invalid_data`) and the streak of
  failures, kept on `integration_connections.error_code` and `consecutive_failures`. A connection
  is late when a reading failed or the reading its schedule owed is more than 15 minutes overdue.
  The warnings are generic (`sync_failed`, `sync_stale`, `consent_expiring` in
  `notifications_log`, with the connection as the key) and are sent by the dispatcher after each
  pass (`alerts.ts`). `sync_runs` is kept for 30 days and says who started each run (`origin`),
  its code, the HTTP status and the app's version; nothing new stores what a provider said. A
  run left `running` for more than an hour is closed as `failed` with the reason `orphaned`, by
  the dispatcher at each pass and by `housekeeping`.
- **Diagnostics.** Admin › Server shows, for each plugin of `PLUGIN_URLS`, whether it answers
  (`plugins.state`, `manifest_read_at`, `unreachable_since`). It shows nothing of any person.
- **Where the pieces join.** The runtime (`packages/plugin-host`) states a port for the writes;
  `src/app/(app)/banks/sink.ts` fills it with the services of the accounts and of the
  transactions; `src/app/plugin-wiring.ts` registers the dispatcher's pass. The tick route and
  "Run now" import the wiring.
- **A source read with a token, a leave calendar (from R5c).** Wallet and Trek are plugins like the
  banks, read by two engines of `packages/plugin-host`: `src/movements/` (capability `source.read`:
  accounts, movements, categories, manual movements sent, edits) and `src/leave/` (capability
  `leaveCalendar`: the days off). What an engine does with a plugin — send the manual movements,
  write the categories, take edits, delete a category — is what the plugin's manifest declares
  (`createRecord`, `categories`, `editRecord`, `deleteCategory`); no code names a provider. Their
  ports are filled in `apps/api/src/plugin-sinks.ts` (`wireDomain`). Their card and page in
  Settings › Integrations are the same for both, drawn from `GET /plugins` (`kind`, `fields`): a
  source or a calendar not in `PLUGIN_URLS`, or whose manifest was never read, is not shown.
- **The shared secret** proves to the plugin that the app is calling. It is in two files, with the
  same value: `PLUGIN_SECRETS=<id>=<secret>` in `.env.homelab`, and `PLUGIN_SHARED_SECRET=<secret>`
  in `.env.plugin-<id>` (mode `600`, not committed). The plugin does not read
  `.env.homelab`. To rotate: write a new value in both files, then
  `docker compose up -d ledgerly ledgerly-plugin-<id>`.
- **The variables of the plugins and of the proxy** (names only; every secret
  `openssl rand -hex 32`: hexadecimal, so it goes in a URL as it is):

  | File | Variables |
  | --- | --- |
  | `.env.homelab` | `PLUGIN_URLS` with `wallet=http://ledgerly-plugin-wallet:8787` and `trek=http://ledgerly-plugin-trek:8787` beside `enablebanking`; `PLUGIN_SECRETS` with their secrets; `EGRESS_URL=http://ledgerly-egress:8081`; `EGRESS_ADMIN_SECRET` |
  | `.env.plugin-<id>` (each plugin) | `PLUGIN_SHARED_SECRET`; `HTTPS_PROXY=http://<id>:<egress secret>@ledgerly-egress:3128` |
  | `.env.egress` | `EGRESS_SECRETS=enablebanking=<s1>,wallet=<s2>,trek=<s3>,prices=<s4>` (the same values as in each `HTTPS_PROXY`); `EGRESS_ADMIN_SECRET` (the value of `.env.homelab`) |

  To rotate a plugin's egress secret: both files, then
  `docker compose up -d ledgerly-egress ledgerly-plugin-<id>`.
- **The return address** of a provider is `https://<host>/api/v1/plugins/<id>/callback`. It takes
  the session cookie, not a token: a return is accepted only for the session that started it.
- **What a bank exposes:** `scripts/plugin-probe.ts` reads every plugin connection through its
  plugin and prints numbers only (accounts, kinds of balance, ids, codes, depth of the history);
  `--from <day>` reads from a day, `--fixture` prints a sample with every name, number, amount and
  text replaced by its shape. It writes nothing. It needs the database and the plugin, so it runs
  with the two networks: the command of `scripts/on-homelab.sh` with
  `--network db_internal --network ledgerly_plugins`.
- **A plugin that cannot reach its provider:** `docker logs ledgerly-egress` says why
  (`refuse … host`: not in its entry, or no grant; `address`: a private address; `port`;
  `unauthenticated`: its `HTTPS_PROXY` secret is not the one of `EGRESS_SECRETS`).
- **A plugin that does not answer:** people see "The connection to banks is not available now".
  Read `docker logs ledgerly-plugin-<id>`; the container restarts by itself (`autoheal`). To stop a
  plugin for everybody: `docker compose stop ledgerly-plugin-<id>`. The app keeps working.

### Network access

`dash.longobardo.me` is public through the Cloudflare tunnel only. Traefik has two routers on the
entrypoint `web`, the target of the Cloudflare tunnel, both with the middleware `ledgerly-https`:
`ledgerly-router` takes `/api` and `/.well-known` to `ledgerly` (priority 100), and
`ledgerly-web-router` takes the rest of the host to `ledgerly-web` (priority 10). A third router,
`ledgerly-originals-router` (priority 200), takes `/api/v1/originals/` to `ledgerly` with the access
log off: the signed token of an original is in its path. `ledgerly-router` also has the middleware
`ledgerly-body-limit`: a request body above 12 MiB gets a 413 from Traefik, before the app, on
every route of `/api` (the app's own limits are 11 MiB for files and 1 MiB for JSON). The
middleware buffers the answer too, so `/api/export.zip`, which is streamed, has its own router
`ledgerly-export-router` (priority 200) without it. The rate limits and
the security headers are the app's own, in both containers. There is no `websecure` router: Pi-hole
has no local record for `dash`, so the LAN also goes through Cloudflare.

Port 80 is not forwarded, so the tunnel is the only public entrance. Never publish port 3000 on the
host.

## Background jobs

The jobs are in `apps/web/src/platform/jobs/registry.ts`; the worker runs them (`apps/worker`, release
R1). Details on the sync schedule and on the queue: [`scheduler.md`](scheduler.md).

Times are Europe/Rome (`SCHEDULE` in the registry).

| When                     | Jobs                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Every minute             | `integrations-sync` (only for links that are due)                                                                                                                       |
| Every hour, at :30       | `interests-accrual`, `documents-sweep`                                                                                                                                   |
| Every day, at 12:00      | `housekeeping`, `accounts-alerts`, `subscriptions-check`, `pockets-accrual` (each pocket on its day of the month), `pockets-planned-cleanup`, `documents-retention`, `holidays-refresh`, `fx-rates-refresh`, `database-backup` |
| The 1st of each month    | `accounts-snapshot`, `monthly-summary`                                                                                                                |
| After a sync with changes | `recurrences-refresh`, `subscriptions-check`, `budgets-alerts`, `funds-deposits`                                                                                         |
| Only by hand             | `export-all`                                                                                                                                                             |

An admin can see each job with its last run in **Settings → Integrations**, and start it with
**Run now**: the job goes in the worker's queue. A job that is already running is skipped.

## Deploy

Full procedure, with lock, health check and rollback: the repo's `AGENTS.md` (local, not in Git)
and [`RELEASE.md`](RELEASE.md). In short, for a release `<id>`:

```bash
docker tag ledgerly:latest ledgerly:pre-<id> && docker tag ledgerly-web:latest ledgerly-web:pre-<id>
folder=$(sh scripts/release-dump.sh <id> | tail -n 1)   # --no-dump: no migration, no data change
npm run numbers -- "$folder" before
docker compose build ledgerly ledgerly-web && docker compose up -d --wait ledgerly ledgerly-web
docker compose up -d --wait --no-build ledgerly-worker
curl -s https://dash.longobardo.me/api/health    # {"status":"ok","db":"up",…}
npm run numbers -- "$folder" after --as-of <the instant "before" printed>
npm run numbers -- --diff "$folder/numbers-before.json" "$folder/numbers-after.json"   # uguale
npm run e2e
```

The worker runs the image `ledgerly`: it has no build of its own, and it is restarted after the app.
`scripts/release.sh` also builds and starts every plugin of the catalog and `ledgerly-egress` (a
plugin's bundle carries the release's version), then checks the running bundles against the
catalog (`scripts/plugins-check.sh`).

### First deploy of the egress proxy (R5c)

`ledgerly_plugins` becomes `internal`: Docker does not change an existing network, so it is made
again once, with the app stopped for about a minute.

1. Write the variables of the table in "Plugins" (`.env.egress`, `.env.plugin-wallet`,
   `.env.plugin-trek`, `HTTPS_PROXY` in `.env.plugin-enablebanking` and `.env.plugin-prices`, the new values of
   `.env.homelab`), mode `600`.
2. Disconnect what is not of this compose file: `docker network inspect ledgerly_plugins` (a
   preview: `docker network disconnect ledgerly_plugins <container>`).
3. `docker compose stop ledgerly ledgerly-worker ledgerly-plugin-enablebanking ledgerly-plugin-prices && docker network rm ledgerly_plugins`
4. The release: `sh scripts/release.sh <id> …` creates `ledgerly_plugins` (internal) and
   `ledgerly_egress`, and starts the plugins and the proxy.
5. Check: `docker network inspect ledgerly_plugins --format '{{.Internal}}'` is `true`;
   `sh scripts/plugins-check.sh` prints the four digests; `docker logs ledgerly-egress` shows
   `allow` lines after a reading of each plugin; Admin › Server › Diagnostics shows the four plugins.

### Release dumps

Every release has a folder in `/home/mattia/docker/projects/ledgerly-dumps/` — beside this
checkout, outside this repository and outside the Homelab one. It has no compose file, so
`projects/stack.sh` skips it.

| What        | Rule                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------- |
| Folder      | `<id>-<sha7>/`, made by `scripts/release-dump.sh <id>`                                       |
| Files       | `ledgerly.dump` (`pg_dump -Fc`), `ledgerly.dump.sha256`, `MANIFEST.txt`, `numbers-*.json`    |
| Permissions | Folders `700`, files `600`, owner `1000:1000`                                                |
| Check       | `pg_restore --list` right after the dump (the script does it and fails on an empty list)     |
| Kept        | The last 5 releases that have a dump. Never delete the release in production or the one before it |
| Who deletes | The agent that deploys, after a successful deploy, naming what it removed in the deploy comment |
| `pre-*`     | Same window: the images of the last 5 releases. `scripts/release.sh` (step 9) removes the older ones after a successful release; the Docker cleanup does not touch them |
| Secrets     | A dump and a numbers snapshot hold personal data and encrypted credentials: they never leave the server, and never go in a comment or an attachment |

`MANIFEST.txt` says the release, the SHA, the tag before it, the date, the last migration and the
`pre-*` images. The daily `database-backup` (below) is another thing and stays as it is.

### Measures and baselines

`baselines/` holds what the gate compares the code against (rewrite plan,
[`design/rewrite-plan/10-modularity.md`](design/rewrite-plan/10-modularity.md)). Each file is
written by a command and checked by another.

| File                                 | Written by                                                    | Checked by                                  |
| ------------------------------------ | ------------------------------------------------------------- | ------------------------------------------- |
| `modularity.json`, `exports.json`    | `npm run modularity`                                          | `npm test` (`tools/architecture.test.ts`)   |
| `cleanliness.json`                   | `npm run cleanliness`                                         | `npm run lint`                              |
| `duplication.json`                   | `npm run duplication`                                         | `npm run duplication -- --check`            |
| `performance.json`                   | `npm run perf -- --write`                                     | `npm run perf`                              |
| `numbers/reference.json`             | `npm run test:integration -- tools/baselines.itest.ts -u`     | `npm run test:integration`                  |
| `contract/api.json`, `contract/mcp.json` | the same command                                          | `npm run test:integration`                  |
| `assertions-exceptions.json`         | by hand, with the decision that allows the change             | `npm run assertions-diff`                   |
| `contract/openapi.json`              | `npm run openapi -- --release`, at each release that adds routes | `npm test` (`tools/contract.test.ts`): only additions |

- **Modularity:** the known imports between modules, the units that import each other and the
  cycles; from R0 also the packages' dependencies that §10.2 does not allow and the imports out of
  a package (M1), the imports past a module's entry (M3) and another unit's tables (M5). The lists
  only get shorter: a new violation fails the test, and so does an entry that is gone until
  `npm run modularity` removes it. `exports.json` is the reference of every entry of a package
  (M7): a change of a package's interface changes it in the same commit. What has no list must
  hold everywhere: a package imports only what its `package.json` declares, the domain never
  reaches Next.js, React or Hono, no package cycle, a client component only the `client.ts`
  entries, no browser file (`"use client"`, `packages/ui`, `apps/static`) that reaches `platform/db`
  or `pg` through any chain of imports (a `"use server"` file stops the walk), one name declared once in a unit of the domain, every package at the root's version.
- **Cleanliness (R0):** rules Q1-Q3 (the names and the purity of a module's files) and Q5-Q8, Q10
  (names, size of a file and of a function, complexity, `any` and `as`) with ESLint, thresholds of
  decision I15 in `scripts/cleanliness-rules.json`. `eslint.config.mjs` turns a rule off for the
  files on its list only; `npm run lint` fails on a new violation and on an entry that is gone.
  `tsc` holds the unused locals and parameters and `tools/cleanliness.test.ts` the exports without
  a use (Q9). A file split in parts (`service.ts` → `service/`) is measured as the file it was.
- **Duplication:** the lines that are a copy of other lines (50 tokens and 6 lines, names and
  literals made equal), per unit. A measure, with no threshold yet.
- **Performance:** median time and number of queries of the widest views and of every route of
  `/api/v1`, on the heavy user of `ledgerly_test`. `npm run perf` fails when a view or a route
  sends more queries, or when its median is more than 10% (and 3 ms) worse. The measure is the
  best median of 5 processes (`scripts/perf-on-test.sh` runs `scripts/perf-probe.ts` 5 times,
  `scripts/perf-compare.ts` compares): the same code gave one process 45 ms and the next 55, each
  steady, so more runs in one process did not help. When a round fails, one second round of 5
  tells a busy host from a slower step. Before every process the test database is vacuumed
  (`scripts/perf-vacuum.ts`), and every process alternates with one of the reference version (the
  highest release tag, or `LEDGERLY_PERF_REFERENCE=<tag>`, checked out under `test-results/`): the
  measures in `ALTERNATED` of `scripts/perf-compare.ts` (today «expensesView (tre anni)», whose time
  the collector decides, and «Overview» and «GET /investments», whose time moves with the host) are
  held to the reference's best median of the same session, not to the file, with the same 10%. A
  measure joins `ALTERNATED` only when the reference of the same session gives its time within 10%:
  the time moved with the host, not with the code (decision of 20/11/2026).
  The run takes about 3 minutes. The 10% and the baseline did not change. `npm run perf -- --queries` runs one process and holds the number of queries only (about
  15 s): it is the part that runs at every release ([testing.md](testing.md)). A slower time
  Mattia accepted is in `ACCEPTED_TIMES` of `scripts/perf-compare.ts`, with the step that takes it
  back: printed, not held; its queries still are. Today: none.
- **Numbers and contract:** what the read services, the REST API and the MCP tools answer about the
  reference user (`test/reference-user.ts`) with the clock stopped. Byte for byte.
- **Numbers of production:** `npm run numbers`, before and after a deploy. See above.

## Configuration

All settings are in `.env.homelab` (template: `.env.example`). Do not commit this file.

- **No `$` in any value.** Compose reads `$` as a variable, and the value reaches the container cut.
- **Generate every secret:** `BETTER_AUTH_SECRET`, `CRON_SECRET` (32+ characters), `METRICS_TOKEN`,
  `APP_ENCRYPTION_KEY`, the OIDC client secret, the S3 keys. The app refuses the placeholder values
  of `.env.example`.
- `BETTER_AUTH_URL` and `OIDC_DISCOVERY_URL` must use `https`.
- If `SMTP_USER` is set, `SMTP_SECURE` or `SMTP_REQUIRE_TLS` must be on.
- `TWO_FACTOR_POLICY`: `required` (default) or `optional`. Restart the container after a change.
- `TRUSTED_PROXY_IPS`: the address of Traefik on the Docker network. The app trusts
  `X-Forwarded-For` from that address only, for the sign-in rate limit (5 attempts per minute per
  client). If Traefik's address changes, update this value.
- `INSTANCE_CONTACT` (optional): how to reach the host, shown on the public pages `/privacy` and
  `/terms`. Anybody can read it. Empty: the pages tell the reader to ask whoever gave the account.
  Restart the container after a change.
- `PLUGIN_URLS`, `PLUGIN_SECRETS` (optional): the plugins of the instance and the secret shared
  with each (32+ characters). See "Plugins". Empty: the app has no plugin.
- `GOTIFY_URL`, `GOTIFY_TOKEN` (optional): failed jobs send a notification to the admins.
- Authentik and mail settings saved in **Admin → Server** override `.env.homelab`.

### `APP_ENCRYPTION_KEY`

Keep a copy of this key outside the server.

- It encrypts the provider tokens and keys (for example the Wallet token). All other data is not
  encrypted. If you lose the key, paste the tokens again in **Settings → Integrations**.
- **To rotate the key**, put the new key first and keep the old one:
  `APP_ENCRYPTION_KEY=k2:<new>,k1:<old>`. If you replace the old key instead, the app starts, but
  each sync fails with "Unknown key id".

## Homelab services

Ledgerly uses the shared homelab services (`/home/mattia/docker`, conventions in its `AGENTS.md`).

| Service    | Use                                                                                     |
| ---------- | --------------------------------------------------------------------------------------- |
| Postgres   | Database `ledgerly`, role `ledgerly`. Tests use `ledgerly_test`, `ledgerly_<1-4>_test`. |
| Silo (S3)  | Bucket `ledgerly`, one folder per area: `payslips/`, `exports/`, `backups/`.            |
| Authentik  | OIDC application `ledgerly`. Members of `OIDC_ADMIN_GROUP` become admins at sign-in.    |
| Stalwart   | Mail from `no-reply@longobardo.me`, implicit TLS on port 465.                           |
| Prometheus | Scrapes `GET /api/metrics` on `ledgerly:3000`, with `METRICS_TOKEN` as bearer token.    |

Create the database once:

```sql
CREATE ROLE ledgerly LOGIN PASSWORD '<the DATABASE_URL password>';
CREATE DATABASE ledgerly OWNER ledgerly;
-- PUBLIC gets CONNECT and TEMP on every new database: other roles must not use it.
REVOKE CONNECT, TEMP ON DATABASE ledgerly FROM PUBLIC;
GRANT CONNECT ON DATABASE ledgerly TO ledgerly;
```

**Authentik redirect URI:** `<BETTER_AUTH_URL>/api/auth/callback/authentik`. Use this path, not
`/api/auth/oauth2/callback/…`: with the wrong one, Authentik answers `redirect_uri_no_match`. The
`profile` scope mapping puts `groups` in the token; the admin role depends on it.

## Backups

`database-backup` runs every day. It uploads a `pg_dump -Fc` of the database to `backups/` in the
bucket and keeps the last 30. The dump is not encrypted, so you can restore it without the app's key.

## Admin tasks

### Create the first admin

Do this before anybody else can reach the app. Use one of the two ways:

- Run `ADMIN_PASSWORD=<12-128 characters> npm run user:create-admin -- <email> "<name>"` on the
  homelab host.
- Sign in with **Continue with Authentik**.

Sign-up is closed. The first user created becomes admin automatically.

### Manage users

Use **Admin → Users**. Removing someone from the Authentik admin group does not remove the admin
role in Ledgerly: demote the user there.

### Lost two-factor authentication

- **A user:** an admin uses **Reset 2FA** in **Admin → Users**.
- **The only admin:** run this on the `ledgerly` database, then sign in again.

  ```sql
  UPDATE users SET two_factor_enabled = false WHERE email = '…';
  DELETE FROM two_factors WHERE user_id = (SELECT id FROM users WHERE email = '…');
  ```

### Password reset

The reset email goes only to accounts with a password. An SSO-only account signs in with
**Continue with Authentik**.

### Export all data

**Admin → Server → Export all data** writes one archive per user under `exports/<userId>/` in the
bucket.

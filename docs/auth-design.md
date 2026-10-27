# Ledgerly — design di autenticazione (PERS-44 / PERS-45)

Stato: proposta, solo design. Riferimento per gli stage successivi di PERS-44.
Data analisi: 2026-10-27, su `main` = `origin/main` (`ae78c01`).

Obiettivi:

1. Login web: utente/password locali con 2FA (TOTP + codici di recupero) oppure OIDC con Authentik.
2. Server MCP di Ledgerly protetto con OAuth2 (MCP Authorization).
3. `/api/v1` con OAuth2, senza interrompere l'integrazione Paperless → Ledgerly.
4. Orario di sincronizzazione delle integrazioni scelto dall'utente (D7).

## 1. Stato attuale

### 1.1 Login web

- Libreria: **better-auth 1.7.4** (`src/platform/auth/auth.ts`), adapter Drizzle su Postgres
  (`ledgerly`), hash password argon2id (`@node-rs/argon2`).
- Plugin attivi: `admin` (ruoli `admin`/`user`), `genericOAuth` (provider `authentik`, PKCE,
  verifica id token, ruolo admin dal gruppo `OIDC_ADMIN_GROUP`), `nextCookies`.
- Metodi: email/password (`authClient.signIn.email`, sign-up chiuso, solo inviti o
  `user:create-admin`) e **OIDC Authentik già funzionante** (provider `Ledgerly` in Authentik,
  client confidential, callback `/api/auth/callback/authentik`). Discovery e credenziali da env
  (`OIDC_*`) o da Admin › Server.
- Sessioni: tabella `sessions`, 30 giorni, cookie better-auth. `src/proxy.ts` reindirizza a
  `/sign-in` senza cookie (comodità, non confine di sicurezza); ogni pagina chiama
  `requireSession()`.
- Rate limit su DB (`rate_limits`): `/sign-in/email` 5/min.
- **Nessun 2FA locale.** Il 2FA oggi esiste solo dentro Authentik (flow di Authentik).
- Tabelle coinvolte: `users`, `sessions`, `auth_accounts`, `verifications`, `rate_limits`,
  `invitations`.
- Dati reali: 1 utente, collegato solo ad Authentik (nessun account password).

### 1.2 API `/api/v1`

- Hono, unico ingresso `src/app/api/v1/[[...route]]/route.ts`, autenticazione in
  `src/platform/api/auth.ts` (`withToken(scope)`).
- Credenziale: **Personal Access Token** `pat_<prefix>.<secret>` (`personal_access_tokens`,
  solo sha256 del segreto), scope `read` | `write` | `imports`, scadenza opzionale, revoca.
  Creati in Settings › Security.
- Il token diventa lo stesso `Ctx` della sessione: tutti i servizi restano filtrati con
  `userScoped(ctx)`. Rate limit 120 chiamate/min per token, per worker.
- Route: `GET /accounts`, `GET /accounts/{id}/balances`, `POST /accounts/{id}/balances` (`write`),
  `GET /transactions`, `GET /summary` (`read`), `POST /imports` (`imports`).
- Fuori perimetro (segreti condivisi, non utente): `/api/jobs/tick` (`CRON_SECRET`, chiamato da
  `ledgerly-cron`), `/api/metrics` (`METRICS_TOKEN`, Prometheus). Restano invariati.
- Dati reali: **1 PAT attivo**, scope `{imports}`: è quello di Paperless.

### 1.3 Integrazione Paperless → Ledgerly

- Lato Paperless (`storage/` stack, `paperless-ngx-homelab:3.2.1-responses`): **Workflow 1
  "Ledgerly – buste paga"**, abilitato.
  - Trigger: *Document Updated*, tipo documento `Payroll` (id 48), tutte le sorgenti.
  - Azione: *Webhook* `POST https://dash.longobardo.me/api/v1/imports`, multipart con il **file
    originale**, parametro `kind=payslip`, header `Authorization` statico (il PAT).
- Lato Ledgerly: `src/modules/imports/api.ts` → `uploadPayslip` → lettura in `after()`.
  Deduplica per `(user_id, sha256)` del file: un secondo invio dello stesso PDF risponde
  `200 duplicate: true` senza effetti.
- Il traffico passa da Cloudflare (Paperless chiama il dominio pubblico). Ultimo uso del PAT:
  2026-10-11; 14 buste paga importate.
- **Vincolo chiave**: il webhook di Paperless invia solo header statici. Non può ottenere né
  rinnovare un access token OAuth2.

### 1.4 Authentik ed esposizione

- Authentik **2026.8.5** (`security/`), `https://auth.longobardo.me`. Provider OAuth2 già
  presenti: Ledgerly, Paperless, Immich, Grafana, Seafile, Vaultwarden, Janus, Trek, Airtrail,
  NetBird, Portainer. Tutti client *confidential* configurati a mano.
- Esposizione Ledgerly: Cloudflare tunnel `*.longobardo.me` → Traefik `:80` (router `web`, senza
  filtro) → `ledgerly:3000`. Il router `websecure` ha `lan-only@file` (accesso diretto solo da
  LAN/NetBird). Quindi **dash.longobardo.me è pubblico tramite Cloudflare**: un client MCP cloud
  (es. Claude) può raggiungerlo senza modifiche a `network/`.

## 2. Decisioni

### D1 — Libreria: resta better-auth, aggiornata a 1.7.14

- 2FA: plugin core `twoFactor` di better-auth (TOTP RFC 6238, codici di recupero, "dispositivo
  fidato").
- OAuth2 Authorization Server: pacchetto ufficiale **`@better-auth/oauth-provider` 1.7.14**
  (richiede `better-auth ^1.7.14` e il plugin `jwt` per JWKS). Verificato sul pacchetto
  pubblicato: grant `authorization_code` (PKCE), `refresh_token`, `client_credentials`; endpoint
  `/oauth2/authorize|token|register|introspect|revoke`; metadata RFC 8414
  (`oauthProviderAuthServerMetadata`); helper per resource server e challenge `WWW-Authenticate`
  (`oauthProviderResourceClient`); tabelle `oauthClient` (con `userId` proprietario),
  `oauthAccessToken`, `oauthRefreshToken`, `oauthConsent`, `oauthResource`.
- MCP: `@modelcontextprotocol/sdk` (1.32.x), trasporto Streamable HTTP.
- Scartate: librerie separate (`otplib`, `oidc-provider` di panva, Ory Hydra) — duplicherebbero
  utenti, sessioni e rate limit che better-auth già gestisce.
- Rischio: il salto 1.7.4 → 1.7.14 va verificato sulla patch `withDiscoveryDeadline` e sui test
  `auth.itest.ts` prima di tutto il resto (task T0).

### D2 — Login web

- Restano **due strade**: Authentik (consigliata) e email/password locale.
- **2FA obbligatorio per gli account password**: dopo la password, se l'utente non ha TOTP
  attivo viene portato alla pagina di attivazione e non accede all'app finché non conferma un
  codice e scarica i codici di recupero (10, uso singolo). Motivo: l'app è pubblica su internet.
- **Per gli utenti SSO il 2FA è di Authentik**: Ledgerly non chiede un secondo fattore a chi entra
  da Authentik (doppio prompt inutile). Già oggi il reset password non crea password per utenti
  solo-SSO; resta così.
- Pagina `/sign-in/two-factor` (TOTP o codice di recupero), opzione "ricorda dispositivo 30 giorni".
  Settings › Security: attiva/disattiva TOTP (con password), rigenera codici di recupero.
- Admin: può azzerare il 2FA di un utente (nuovo permesso), che al login successivo lo riattiva.
- Rate limit: `/two-factor/verify-totp` e `/two-factor/verify-backup-code` 5/min.
- Schema: colonna `users.two_factor_enabled`, tabella `two_factors` (segreto e codici cifrati da
  better-auth). Migrazione Drizzle additiva, nessun dato da convertire.
- Il flusso di invito (`acceptInviteAction`, che oggi fa `signInEmail`) passa dalla stessa
  attivazione 2FA.
- Scartato: "2FA opzionale" (lascia esposto un account password senza secondo fattore) e
  "solo Authentik, togliere le password" (perdi l'accesso se Authentik è giù; il task chiede
  entrambe le strade).

### D3 — Authorization Server per API e MCP: **Ledgerly stesso**

Ledgerly diventa Authorization Server (issuer `https://dash.longobardo.me/api/auth`) con
`@better-auth/oauth-provider`. Authentik resta l'**Identity Provider** a monte: la pagina
`/oauth2/authorize` usa la sessione Ledgerly, che si ottiene con Authentik o con password + TOTP.

Motivi:

- **Client MCP**: Claude e simili si registrano da soli (RFC 7591 Dynamic Client Registration)
  e scoprono l'AS da RFC 9728 → RFC 8414. Con Ledgerly come AS la registrazione dinamica,
  la protected resource metadata e l'audience per risorsa sono nello stesso codice. Con Authentik
  ogni client andrebbe creato a mano; il supporto DCR di Authentik 2026.8 **non è verificato**
  (verificare nella documentazione di Authentik prima di riconsiderare).
- **Scope e consenso di dominio** (`read`, `write`, `imports`) con schermata di consenso
  di Ledgerly; i token mappano direttamente su `users.id` → `Ctx`, senza tabella di mapping `sub`.
- **Disponibilità**: l'API non dipende da Authentik a ogni chiamata (validazione JWT locale via
  JWKS); se Authentik è giù, i token emessi restano validi e il login password+TOTP funziona.
- Coerenza: oggi i PAT sono già emessi da Ledgerly; si sostituisce il formato, non il proprietario.

Scartate:

- **Authentik come AS**: centralizza, ma senza DCR certo, con scope/audience da configurare a mano
  per ogni client e accoppiamento forte (Authentik giù = API e MCP giù).
- **AS dedicato (Keycloak, Hydra)**: un servizio in più da gestire per un solo utente.

Parametri:

- Risorse (RFC 8707, claim `aud`): `https://dash.longobardo.me/api/v1` e
  `https://dash.longobardo.me/api/mcp`. Un token per una risorsa non vale per l'altra.
- Access token **JWT** firmati (plugin `jwt`, JWKS su `/api/auth/jwks`), TTL **1 h**.
  Refresh token a rotazione, TTL **30 giorni**, revoca su logout/disattivazione utente/ban.
- Scope: `read`, `write`, `imports` (stessi nomi dei PAT) + `openid profile email offline_access`.
- PKCE obbligatorio (S256) per `authorization_code`. Consenso sempre richiesto per i client
  dinamici; `skipConsent` solo per client creati dall'admin.
- **DCR aperto ma solo client pubblici** (`token_endpoint_auth_method=none`), redirect URI https o
  loopback, rate limit su `/oauth2/register`. Registrarsi non dà accesso: serve login + consenso.
  Client confidential (`client_credentials`) solo da Settings, legati all'utente (`userId`).
- **Client Credentials per script personali**: Settings › Security › "Client API" sostituisce i
  PAT: l'utente crea un client (nome, scope), vede il segreto una volta; il token ottenuto agisce
  come l'utente proprietario del client. Il ban dell'utente invalida i suoi client.
- Utente bannato: token rifiutati in validazione (come oggi per i PAT).

### D4 — Compatibilità dei PAT

- **Periodo di transizione**: `/api/v1` accetta **sia** JWT OAuth2 **sia** PAT finché la
  migrazione Paperless (§3) non è chiusa. Durante la transizione: nessun nuovo PAT (la UI li
  rimpiazza con i Client API), i PAT esistenti funzionano fino a revoca o scadenza.
- Fine transizione (task T5): via la verifica PAT dal middleware, PAT revocati, tabella eliminata
  con migrazione dopo dump. Oggi esiste un solo PAT (Paperless), quindi l'impatto è noto.
- Il middleware distingue per formato: `pat_…` → percorso legacy, altrimenti JWT. Log di ogni uso
  PAT (`[api] legacy token used`) per sapere quando è davvero inutilizzato.
- Scartato: "taglio netto" (romperebbe Paperless) e "PAT per sempre" (non soddisfa l'obiettivo 3).
- **Eseguito (T5, PERS-59)**: codice PAT e tabella `personal_access_tokens` rimossi (migrazione
  `0033`); `/api/v1` accetta solo JWT OAuth2.

### D5 — Integrazione Paperless: **Ledgerly legge da Paperless (pull)**

> **Superata (PERS-47, PERS-57).** Mattia ha scelto l'opzione A il 27/10/2026: resta il webhook del
> Workflow 1, con un token OAuth2 `client_credentials` ottenuto dalla patch del fork Paperless
> (`docs/runbooks/oauth-paperless-migration.md`). Il provider pull resta nel codice, non collegato;
> non c'è l'utente `ledgerly-sync`. Il testo sotto resta come storia della decisione.

Il webhook di Paperless manda solo header statici: non può fare `client_credentials` (token di 1 h
da rinnovare). Si inverte il verso: Ledgerly diventa client dell'API di Paperless.

- Nuovo provider in `src/platform/integrations/paperless/` (stesso schema di `wallet` e `trek`):
  connessione per utente in `integration_connections` con credenziali sigillate (`sealJson`,
  `APP_ENCRYPTION_KEY`): URL Paperless + token API Paperless + mappa *tipo documento → kind*
  (`Payroll` → `payslip`; Cometa opzionale).
- Sync `paperless` lanciato dal dispatcher delle integrazioni all'orario scelto dall'utente (D7;
  default ogni ora, come Wallet e Trek oggi): legge
  `GET /api/documents/?document_type__id__in=…&modified__gt=<cursore>&ordering=modified`, scarica
  `GET /api/documents/{id}/download/?original=true` (stessi byte del webhook → stesso sha256) e
  chiama `uploadPayslip` / `uploadCometaDocument` + lettura come oggi. Cursore = ultimo `modified`
  importato, salvato sulla connessione. Rete fuori da ogni transazione DB (regola di AGENTS.md).
- URL interno `http://paperless-ngx:8000` (entrambi su `proxy_public`): niente giro su Cloudflare.
- Token Paperless di un utente Paperless dedicato **`ledgerly-sync`**, sola lettura, con
  visibilità solo sui documenti necessari (permessi Paperless).
- Bottone "Sincronizza ora" e stato (ultimo OK, ultimo errore) nella card Integrazioni, come Wallet.

Vantaggi: nessun segreto in ingresso su Ledgerly; un documento perso (Ledgerly giù durante un
webhook) viene recuperato al giro successivo; l'API pubblica resta solo OAuth2.
Costo: latenza pari all'intervallo scelto (D7; 1 h di default, minimo 15 min) e codice nuovo nel modulo
integrazioni.

Scartate:

- **`client_credentials` diretto da Paperless**: impossibile, header statici.
- **Token OAuth2 a lunga durata incollato nel webhook**: è un PAT con un altro nome, senza rotazione.
- **Relay sidecar** (riceve il webhook in rete interna, fa `client_credentials`, inoltra):
  servizio in più da mantenere e il primo salto resta un segreto statico.
- **Patch del fork Paperless** per webhook OAuth2: divergenza dal upstream su un'immagine già
  personalizzata.
- **Tenere il PAT solo per `imports`**: resta come rollback, non come soluzione.

### D6 — Server MCP

- **Nella stessa app**, route `src/app/api/mcp/route.ts`, **Streamable HTTP stateless**
  (POST JSON-RPC; GET/DELETE 405). Motivi: riusa i servizi dei moduli, `Ctx` e `userScoped` senza
  duplicare logica (come `/api/v1`); nessun container, rete o route Traefik in più.
  Scartato container separato: dovrebbe chiamare `/api/v1` o il DB direttamente, duplicando
  scope e regole.
- Path `/api/mcp` e non `/mcp`: il matcher di `src/proxy.ts` già esclude `api/` dal redirect a
  `/sign-in`. **Da aggiungere al matcher**: `.well-known/` (altrimenti la metadata riceve un
  redirect).
- Autorizzazione (spec MCP Authorization):
  - senza token o token non valido → `401` con
    `WWW-Authenticate: Bearer resource_metadata="https://dash.longobardo.me/.well-known/oauth-protected-resource/api/mcp"`;
  - `/.well-known/oauth-protected-resource/api/mcp` (RFC 9728) → `authorization_servers`
    = issuer di Ledgerly, `scopes_supported`;
  - `/.well-known/oauth-authorization-server/api/auth` (RFC 8414) e, per compatibilità client,
    alias `/.well-known/oauth-authorization-server` e `/.well-known/openid-configuration`;
  - `aud` del token = `https://dash.longobardo.me/api/mcp`; scope insufficiente → `403`
    `insufficient_scope`.
- Tool v1 (stessi servizi di `/api/v1`, importi come stringhe in centesimi come l'API):

  | Tool | Scope | Effetto |
  |---|---|---|
  | `get_summary` | `read` | Sintesi patrimonio/periodo (come `GET /summary`) |
  | `list_accounts` | `read` | Conti e saldi correnti |
  | `get_account_balances` | `read` | Storico saldi di un conto |
  | `list_transactions` | `read` | Movimenti con filtri (periodo, conto, categoria, testo), paginati |
  | `list_budgets` | `read` | Budget e consumo del periodo |
  | `record_account_balance` | `write` | Registra un saldo (come `POST /accounts/{id}/balances`) |

  Nessun tool di cancellazione o amministrazione. Altri tool (investimenti, buste paga, fondi)
  in un task successivo, uno per servizio esistente.
- Rate limit per client OAuth (stesso `takeSlot` dell'API, chiave = `client_id`).
- Da verificare in implementazione: nome esatto del trasporto web-standard dell'SDK
  (`WebStandardStreamableHTTPServerTransport` o equivalente) e supporto di
  *Client ID Metadata Documents* (revisione MCP 2025-11-25) in `@better-auth/oauth-provider`;
  se assente, basta la DCR.

### D7 — Orario di sincronizzazione delle integrazioni scelto dall'utente

> **Sostituita** da [`docs/scheduler.md`](scheduler.md) (PERS-60, 27/10/2026): regole libere e
> combinabili al minuto, tier `minute` al posto di `quarter`. Il testo sotto resta come storia della
> decisione.

Requisito 4 di PERS-44: ogni utente sceglie quando si sincronizzano le sue integrazioni.

**Integrazioni coinvolte**: tutte quelle con una riga in `integration_connections`, cioè i
`PROVIDERS` di `src/platform/integrations/rules.ts`:

- `wallet` (job `wallet-sync`, oggi nel tier `hourly`);
- `trek` (job `trek-sync`, oggi nel tier `hourly`);
- `paperless` (nuovo, D5).

Non coinvolto: `holidays-refresh`, che aggiorna i calendari festivi una volta al giorno. Non è una
connessione dell'utente e resta nel tier `daily`.

**Granularità**: un orario per connessione, scelto tra tre modalità.

| Modalità | Valori | Esempio |
|---|---|---|
| `interval` | ogni 15, 30, 60, 120, 180, 240, 360, 720 o 1440 minuti, allineato alla mezzanotte locale | ogni 6 h → 00:00, 06:00, 12:00, 18:00 |
| `times` | da 1 a 6 orari del giorno, a passi di 15 minuti | 07:00 e 19:30 |
| `manual` | solo "Sincronizza ora" | — |

- Il minimo è 15 minuti, perché il cron batte ogni 15 minuti e il valore protegge le API a monte
  (Wallet ha dei limiti di chiamate). Gli orari sono rispettati con uno scarto massimo di un tick
  (≤ 15 min).
- Scartata l'**espressione cron libera**: la validazione è complessa, la UI non è guidata e un
  valore sbagliato può martellare un'API esterna. Le tre modalità coprono i casi reali.
- **Timezone**: quella delle preferenze dell'utente (`preferences.timeZone`, già nel `Ctx`).
  Gli orari sono orari locali, calcolati con `src/platform/dates.ts`. Al cambio dell'ora legale
  "07:00" resta 07:00 locale. Se l'utente cambia timezone, il prossimo run viene ricalcolato.
- **Default**: `interval` ogni 60 minuti per tutte e tre le integrazioni, cioè il comportamento
  di oggi. La migrazione non cambia nulla finché l'utente non modifica l'orario.

**Persistenza (migrazione Drizzle additiva)** sulla tabella `integration_connections`:

- `schedule jsonb not null default '{"mode":"interval","everyMinutes":60}'`. La forma viene
  validata con zod in `rules.ts`, e un `check` SQL ammette solo le tre modalità.
- `next_sync_at timestamptz`: il prossimo run dovuto. Viene calcolato al salvataggio
  dell'orario, dopo ogni run e al cambio di timezone. È `null` con `manual`.
- Indice parziale `(next_sync_at) where state = 'active'`.
- Il calcolo del prossimo run è una funzione pura `nextSyncAt(schedule, timeZone, after)` in
  `rules.ts`, con test unitari su DST, fine mese e orari multipli.

**Scheduler**: nessun nuovo servizio, si estende quello esistente.

- Nuovo job `integrations-sync` (dispatcher) nel registry. Prende il posto di `wallet-sync` e
  `trek-sync` come job schedulati. Restano le funzioni di sync per provider, che il dispatcher
  chiama. A ogni passaggio legge le connessioni `active` con `next_sync_at <= now`
  (`ORDER BY next_sync_at, id`) e per ciascuna:
  1. prende un lock `sync:<provider>:<userId>`, lo stesso che usa "Sincronizza ora", così i due
     non si sovrappongono;
  2. esegue la sync;
  3. aggiorna `next_sync_at`.

  Un errore non anticipa il run successivo: lo stato `error` e i `sync_runs` funzionano come
  oggi.
- Nuovo tier `quarter` in `Tier`/`ScheduledTier`, che contiene solo `integrations-sync`. Il job è
  anche **primo** nel tier `hourly`. In questo modo, al tick `:07`, i job che oggi dipendono da
  `wallet-sync` (`subscriptions-check`, `budget-alerts`, `interests-accrual`) vedono ancora i
  movimenti appena sincronizzati, come oggi.
- `cron/crontab` aggiunge una riga
  `22,37,52 * * * * … /api/jobs/tick?tier=quarter`. La riga hourly `7 * * * *` resta, quindi i
  tick sono `:07`, `:22`, `:37`, `:52`. Le due righe non si sovrappongono mai.
  `/api/jobs/tick` accetta il nuovo tier e usa lo stesso `CRON_SECRET`. L'heartbeat e il
  `job:<name>` lock restano invariati.
- **Effetto sui job dipendenti**: se Wallet si sincronizza a un orario non allineato all'ora
  (es. 07:30), i job hourly vedono i nuovi movimenti al tick `:07` successivo. Quindi gli avvisi
  budget arrivano fino a 1 h dopo la sync, non dopo il movimento. Questo è accettato, ed è
  documentato nella card.
- Admin › Jobs: "Run now" su `integrations-sync` esegue solo le connessioni dovute. Il
  "Sincronizza ora" della card esegue la connessione dell'utente subito e non sposta
  `next_sync_at`.

**UI**: Settings › Integrazioni, nella card di ogni provider.

- Un controllo "Sincronizzazione" con la modalità (radio: *Ogni…* / *Agli orari…* / *Solo
  manuale*), la select dell'intervallo oppure fino a 6 campi orario a passi di 15 minuti.
- Sotto: la timezone usata (link alle preferenze) e "Prossima sincronizzazione: <data ora
  locale>".
- Salvataggio con una Server Action nel file `actions.ts` della pagina integrazioni, validazione
  zod lato server, testi in `messages/en.json` e `messages/it.json`.
- La card con il nuovo controllo entra in `tests/e2e/a11y.spec.ts` (regole F9: target ≥ 24 px,
  versione stretta senza controlli mancanti).

**Effetto sulla domanda aperta 2**: il ritardo massimo del pull Paperless non è più fisso a 1 h.
È l'intervallo scelto (minimo 15 min, default 60 min) oppure la distanza tra due orari in
modalità `times`, più al massimo un tick (≤ 15 min). Con `manual` dipende dall'utente.

**Task**: implementato in **T3**, prima del provider Paperless, così Paperless nasce già con
l'orario configurabile. Wallet e Trek passano al dispatcher nello stesso task. Lo schema delle
connessioni e la UI sono condivisi, quindi va fatto una volta sola. Prima del deploy: confronto dei
`sync_runs` di Wallet e Trek su 24 h prima e dopo (stessa cadenza oraria, nessun run doppio).
Rollback: immagine `ledgerly:pre-sync-schedule` e la riga di crontab tolta. Le colonne nuove
possono restare: la versione precedente le ignora.

## 3. Migrazione Paperless — passi, verifica, rollback

Regola: in ogni momento almeno una delle due strade (webhook PAT, pull) è attiva. La deduplica
`sha256` rende sicuro averle **entrambe** attive.

| # | Passo | Chi | Verifica | Rollback |
|---|---|---|---|---|
| 0 | Deploy di T2 (OAuth2 + PAT legacy ancora accettati) e T3 (provider Paperless, spento) | agente | `POST /api/v1/imports` col PAT risponde come prima (test con PDF già importato → `200 duplicate`); log `[api] legacy token used` | immagine `ledgerly:pre-oauth` |
| 1 | Creare in Paperless l'utente `ledgerly-sync` (sola lettura, visibilità sui documenti `Payroll`) e il suo token API | Mattia | `GET /api/documents/?document_type__id=48` col token restituisce le buste paga | eliminare l'utente |
| 2 | Configurare l'integrazione Paperless in Ledgerly (URL interno, token, `Payroll → payslip`), cursore iniziale = 90 giorni fa | Mattia | "Prova connessione" OK | disconnettere l'integrazione |
| 3 | "Sincronizza ora" | Mattia/agente | `job_runs` ok; tutti i documenti esistenti risultano `duplicate`; numero di `documents` invariato | disconnettere |
| 4 | Periodo parallelo: webhook **e** pull attivi. Test: modificare un campo di una busta paga in Paperless | — | webhook → `duplicate`; pull → `duplicate`; nessun documento nuovo | nessuno necessario |
| 5 | Disattivare (non cancellare) il Workflow 1 in Paperless | Mattia | alla busta paga successiva (o con un PDF di test su utente `@example.test`) il documento arriva dal pull entro l'intervallo scelto (D7) | riattivare il Workflow 1 |
| 6 | Dopo 1 ciclo paga / 14 giorni senza errori: revocare il PAT di Paperless in Ledgerly, cancellare Workflow 1 e webhook in Paperless | Mattia | log senza `legacy token used`; job `paperless-sync` verde | ricreare un PAT `imports` e il workflow webhook (possibile finché T5 non è deployato: per questo T5 parte solo dopo questa verifica) |
| 7 | T5: rimozione del codice PAT e della tabella (dump prima) | agente | test + `docker compose up --wait` | immagine `ledgerly:pre-pat-removal` e restore del dump |

## 4. Task di implementazione

Ogni deploy: confrontare `main` locale e `origin/main`, immagine di rollback `ledgerly:pre-<nome>`,
migrazioni con dump in `backups/ledgerly/`.

| Task | Contenuto | Dipende da |
|---|---|---|
| **T0** — upgrade better-auth 1.7.14 | Bump, verifica patch `withDiscoveryDeadline`, `auth.itest.ts`, login Authentik in prod | — |
| **T1** — Login 2FA | Plugin `twoFactor` + client, pagine `/sign-in/two-factor` e attivazione forzata, Settings › Security (TOTP, codici), reset admin, rate limit, i18n en/it, a11y e2e delle nuove schermate, migrazione | T0 |
| **T2** — OAuth2 AS + API | `jwt` + `@better-auth/oauth-provider`, metadata `.well-known`, matcher proxy, pagina consenso, `withToken` che accetta JWT (aud `/api/v1`) e PAT legacy, Client API in Settings (sostituisce la creazione PAT), README | T0 (consigliato dopo T1: il consenso eredita il 2FA) |
| **T3** — Orari di sync (D7) + integrazione Paperless (pull) | Prima D7 (schema, dispatcher, tier `quarter`, crontab, UI orario, migrazione di Wallet e Trek), poi provider `paperless`, client, card Integrazioni, test con fixture | T2 per il deploy coordinato (può essere sviluppato in parallelo) |
| **T4** — Server MCP | `/api/mcp` Streamable HTTP, RFC 9728, tool v1, test con MCP Inspector e connettore Claude | T2 |
| **T5** — Fine transizione PAT | Rimozione PAT dopo il passo 6 del §3 | T3 + conferma di Mattia |

T1 e T2 possono procedere in parallelo dopo T0; T3 e T4 in parallelo dopo T2.

## 5. Configurazione e operatore

- Nuove variabili (solo nomi, in `.env.homelab`): nessuna obbligatoria prevista. Chiavi JWKS
  generate e salvate da better-auth nel DB (`jwks`, cifrate con `BETTER_AUTH_SECRET`). Il token
  Paperless sta nella connessione cifrata, non nell'env.
- Authentik: **nessuna modifica obbligatoria**. Consigliato: policy MFA sul flow di
  autenticazione usato dal provider `Ledgerly` (oggi non verificato da questo design).
- Paperless: utente `ledgerly-sync` + token (passo 1); disattivazione e poi cancellazione del
  Workflow 1 (passi 5–6).
- Cloudflare: verificare che Bot Fight Mode / WAF non blocchino le richieste dei client MCP cloud
  su `/api/mcp`, `/api/auth/oauth2/*` e `/.well-known/*`.
- `ledgerly-cron`: nuova riga del tier `quarter` in `cron/crontab` (D7), quindi rebuild del
  sidecar in T3.
- `network/`: nessuna modifica (il dominio è già pubblico via tunnel).

## 6. Domande aperte per Mattia

1. 2FA **obbligatorio** per gli account password (proposta) o facoltativo?
2. OK al **pull** da Paperless al posto del webhook? Il ritardo massimo ora è l'orario che scegli
   tu (D7): default ogni ora, minimo ogni 15 minuti. Ti serve un default diverso per Paperless?
3. Tool MCP in scrittura: basta `record_account_balance` in v1, o tutto in sola lettura?
4. Durata del periodo di transizione PAT: 14 giorni / un ciclo paga va bene?

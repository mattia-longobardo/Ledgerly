# F8 — Settings e Admin

> Piano da eseguire **in linea**, lotto dopo lotto, come F3–F7. Chi lo riprende in mano non ha il
> contesto della sessione che l'ha scritto: qui dentro c'è tutto quello che serve.

## 0. Come si legge

1. `CLAUDE.md` alla radice — convenzioni vincolanti. In particolare: le Server Action del modulo
   utenti stanno in `src/modules/users/actions.ts`, nessuna I/O di rete dentro una transazione,
   ogni query dell'utente passa da `userScoped(ctx)`, ogni stringa in `messages/en.json` **e**
   `messages/it.json`.
2. `docs/specs/2026-09-13-dev-0.1-design.md` — **§7.10 Settings e Admin** (vincolante), §5 intero
   (Better Auth, controlli di accesso, **§5.3 token personali**, container), §6 (tabelle:
   `personal_access_tokens`, `app_settings`, `invitations`, `notifications_log`), §4.2 (`api.ts`
   per modulo), §9.3 (`/api/v1/imports`), §9.4 (S3, SMTP, Gotify, credenziali cifrate),
   §10.2 (backup giornaliero, riepilogo mensile), §10.4 (notifiche), §11 (test), §12 (fasi).
3. Il design (`UI Recreation and branding decisions/Finance Dashboard.dc.html`, sola lettura):
   - riga 853–857 **Access tokens** — «Personal access tokens for the read-only API used by Home
     Assistant and scripts. Tokens are hashed at rest; the full value is shown once», tabella
     Name · Token · Scopes · Expires · Last used · Status · Revoke, bottone «New token»;
   - riga 860–863 **Sessions** (già fatto in F0);
   - riga 870–877 **Admin › Users** — le due schede Users/Server, la frase sui due ruoli, «Invite
     user», righe con iniziali, nome, email, metodo, selettore Admin/User, ultimo accesso, stato,
     «Reset password» e «Remove»;
   - riga 884 **Authentik (OIDC)** — issuer, client id, client secret, gruppo admin, «Discovery
     document reachable · last check 07:10», «Test connection», «Save»;
   - riga 885 **Outgoing email (SMTP)** — host, porta, cifratura (SSL/TLS · STARTTLS · None),
     utente, password, indirizzo mittente, tre interruttori (Invitations & resets · Sync failures ·
     Monthly summary), «Send test email», «Save»;
   - riga 886–891 **Maintenance** — ultimo backup, pianificazione, conservazione, versione,
     «Back up now», «Export all data».
4. `docs/plans/2026-09-13-f0-foundations.md` — Task 9 (Better Auth, ruoli, cancelli), Task 10
   (email, inviti, reset), Task 12 (job, health, metrics), Task 18 (Settings: Profile e Security).
   F8 **continua** quel lavoro: quasi tutto l'impianto c'è, mancano i chiamanti.
5. `docs/plans/2026-09-16-f2-integrazioni-wallet-expenses.md` §8 — la cassaforte delle credenziali
   cifrate e il registro dei passaggi: è il modello da cui copiare le impostazioni del server.

## 1. Obiettivo

F8 secondo §12: **Admin › Users e Server, SMTP, token + `/api/v1`, esportazione, backup, notifiche,
riepilogo mensile**.

Il prodotto della fase: un'istanza che un amministratore può **governare dalla schermata** invece
che dal file d'ambiente — chi entra, come, con quale provider e quale posta — e un'applicazione che
**parla verso l'esterno**: un token personale per Home Assistant e gli script, l'esportazione di
tutto quello che è proprio, un backup che esiste davvero e delle email che dicono quando qualcosa
è andato storto.

Fuori perimetro: la revisione finale, l'accessibilità sistematica e la documentazione di rilascio
(sono F9); l'autenticazione a due fattori e le passkey (mai chieste); l'impersonificazione di un
utente (deliberatamente non concessa, `src/platform/auth/permissions.ts`); una `/api/v1` completa —
si espone **solo quello che serve a uno script** (D5), e l'interfaccia deve continuare a funzionare
se `/api/v1` non esistesse.

## 2. Punto di partenza (2026-09-21)

Branch `dev-0.1` con F7 consegnata (`facdbff`); ultime migrazioni `0018`/`0019`. F8 è, più di ogni
altra fase, **lavoro di chiamanti**: l'impianto è quasi tutto in piedi da F0 e non è mai stato usato.

**Già pronto e da riusare, non da rifare:**

- `app_settings` (`src/platform/settings/`) — chiave, `value jsonb` per quello che si può rimostrare,
  `sealed bytea` per quello che no, `updated_by`. Oggi ci vive **una sola chiave**, `llm.fallback`, e
  il suo servizio è il modello esatto da seguire: `requireAdminCtx`, una vista che restituisce un
  `keyHint` (le ultime 4 cifre) e mai il segreto, un lettore unico che apre il sigillo, una prova di
  connessione con `fetch` iniettabile.
- La cifratura: `seal`/`open`/`sealJson`/`openJson` (`src/platform/crypto.ts`) con anello di chiavi
  ruotabile (`APP_ENCRYPTION_KEY=id:base64[,vecchie…]`).
- Better Auth 1.7 completo: sessioni **nel database**, plugin `admin` già configurato con i permessi
  `user: list|set-role|ban|delete` e `session: list|revoke` (`src/platform/auth/permissions.ts`),
  Authentik via `genericOAuth`, `requireSession()`/`requireAdmin()` (quest'ultimo risponde 404),
  primo utente = admin, promozione da gruppo Authentik a ogni accesso.
- **Gli inviti per metà**: `createInvitation`, `hashToken`, `sendInvitationEmail`, `acceptInvitation`,
  `completeInvitationWithSso`, `deleteExpiredInvitations`, la tabella `invitations`, la pagina di
  accettazione e la rotta di completamento SSO. **Le prime due non hanno un solo chiamante**: manca
  esattamente la metà che sta dalla parte dell'amministratore.
- Email: `sendMail` (nodemailer, solo testo) e i modelli i18n costruiti con `createTranslator` di
  `use-intl/core` sul namespace `emails.*`, che funzionano dentro i job.
- `notifyOnce` + `notifications_log`: la dedup con finestra di riposo, con l'invio **fuori** da
  qualunque transazione e un fallimento di consegna che non fa cadere il job.
- I job: `JobDefinition {name, tier, run()}`, `withJobLock` su connessione dedicata senza
  transazione aperta, `job_runs`, il battito cardiaco, `forEachUser` con isolamento per utente, e
  `housekeeping` (90 giorni) che è già il posto dove si pota tutto ciò che invecchia.
- S3: `putObject`/`getObject`/`deleteObject`/`deleteFolder`, chiavi validate da `assertStorageKey`
  (solo minuscole, niente `..`). Cartelle in uso: **solo** `payslips/` e `cometa/`.
- `/api/health` e `/api/metrics` (bearer, formato Prometheus, tre serie).
- Settings con il suo layout a schede e la scheda **Server** già riservata agli admin: la pagina
  esiste e contiene solo la card del fallback LLM, con scritto in un commento «F8 the rest of the page».

**Assente per davvero (è il perimetro di F8):**

| Cosa | Stato |
|---|---|
| `personal_access_tokens`, `/api/v1`, autenticazione a token | nessuna riga in tutto il repository |
| Admin › Users (elenco, invito, ruolo, reset, blocco, rimozione) | nessuna schermata, nessun servizio |
| Impostazioni OIDC e SMTP nel database | SMTP e OIDC si leggono **solo** dall'ambiente |
| Esportazione dei dati (ZIP, JSON) | esiste un solo CSV, quello degli abbonamenti, con il suo `field()` locale |
| Backup del database | `pg_dump` non compare da nessuna parte, `backups/` non esiste |
| Avviso agli admin quando un job fallisce | Gotify: zero occorrenze |
| Riepilogo mensile | la preferenza `monthly_summary` si salva e **non la legge nessuno** |
| Card «esegui un job a mano» (§10.3) | il commento di Settings › Integrations dice che non era di F2 |

## 3. Contratti decisi in anticipo

### 3.1 Collocazione

```
src/platform/settings/     service.ts  — si aggiungono le chiavi oidc.provider, smtp.transport, backup.last
src/platform/tokens/       schema.ts  rules.ts  service.ts     — i token personali
src/platform/api/          app.ts (Hono)  auth.ts (bearer → Ctx)  errors.ts
src/modules/<nome>/api.ts  le rotte del modulo, montate dall'app Hono (§4.2)
src/platform/export/       service.ts (il pacchetto)  zip.ts (l'involucro)  csv.ts (il campo, tolto dalla rotta degli abbonamenti)
src/platform/backup/       service.ts (pg_dump → S3)  jobs.ts
src/platform/alerts/       gotify.ts — l'avviso agli admin, silenzioso se non configurato
src/modules/users/         admin.ts (servizio admin)  actions.ts (le azioni nuove)  ui/*
src/app/api/v1/[[...route]]/route.ts    l'unico punto d'ingresso di /api/v1
src/app/(app)/settings/users/           Admin › Users
src/app/(app)/settings/server/          le card nuove accanto a quella del LLM
src/app/(app)/settings/security/        la card dei token
src/app/(app)/settings/data/export.zip/route.ts   l'esportazione dei propri dati
```

I token sono di piattaforma e non un modulo: **autenticano**, come le sessioni, e come `settings`,
`notifications` e `integrations` hanno una loro `schema.ts` sotto `src/platform/`. Le funzioni
amministrative degli utenti stanno invece in `src/modules/users/` perché gli utenti sono un modulo,
e `CLAUDE.md` vincola le sue Server Action a `src/modules/users/actions.ts`.

### 3.2 Una tabella nuova — migrazione `0020_personal_access_tokens.sql`

```sql
personal_access_tokens(
  id, user_id → users ON DELETE CASCADE,
  name        text not null,            -- ≤ 60 caratteri, quello che l'utente ci scrive sopra
  prefix      text not null unique,     -- 8 caratteri [a-z0-9], la parte che si può mostrare
  token_hash  text not null unique,     -- sha256 esadecimale del segreto
  scopes      text[] not null,          -- sottoinsieme non vuoto di read | write | imports
  expires_at  timestamptz,              -- facoltativa (§5.3)
  last_used_at timestamptz,
  revoked_at  timestamptz,
  created_at, updated_at
)
index personal_access_tokens_user_idx (user_id, created_at desc)
check  scopes <> '{}' and scopes <@ array['read','write','imports']
check  length(name) between 1 and 60
check  prefix ~ '^[a-z0-9]{8}$'
```

Nient'altro. `invitations`, `app_settings`, `notifications_log`, `job_runs` e le colonne
`users.banned/ban_reason/ban_expires` esistono già e sono migrate.

**sha256 e non argon2**: il segreto sono 32 byte casuali, non una password scelta da una persona.
Non c'è dizionario da cui partire, e la verifica deve costare poco perché avviene a ogni chiamata.

### 3.3 Firme

```ts
// src/platform/tokens/rules.ts — puro, unitario
export const TOKEN_SCOPES = ["read", "write", "imports"] as const;
export function mintToken(): { token: string; prefix: string; hash: string };   // pat_<prefix>.<segreto>
export function parseToken(value: string): { prefix: string; hash: string } | null;
export function tokenState(row, now): "active" | "expired" | "revoked";
export function allows(scopes: readonly Scope[], needed: Scope): boolean;

// src/platform/tokens/service.ts
export async function listTokens(ctx): Promise<TokenView[]>;                    // mai il segreto
export async function createToken(ctx, input): Promise<{ view: TokenView; token: string }>;
export async function revokeToken(ctx, id): Promise<void>;
export async function authenticateToken(value: string): Promise<{ ctx: Ctx; scopes: Scope[] } | null>;
export async function touchToken(id: string): Promise<void>;                    // al massimo una volta al minuto

// src/modules/users/admin.ts — ogni funzione ricontrolla ctx.role, come fa platform/settings
export async function listPeople(ctx): Promise<PersonRow[]>;                    // utenti + inviti in sospeso
export async function invitePerson(ctx, { email, role }): Promise<void>;
export async function revokeInvitation(ctx, id): Promise<void>;
export async function setPersonRole(ctx, userId, role): Promise<void>;
export async function setPersonBlocked(ctx, userId, blocked): Promise<void>;
export async function sendPersonReset(ctx, userId): Promise<"sent" | "sso_only">;
export async function removePerson(ctx, userId): Promise<void>;

// src/platform/settings/service.ts — le chiavi nuove, stesso stampo di llm.fallback
export async function oidcView(ctx): Promise<OidcView | null>;                  // segreto → keyHint
export async function saveOidc(ctx, input): Promise<{ signedEveryoneOut: boolean }>;
export async function testOidc(ctx, deps?): Promise<OidcProbeResult>;
export async function smtpView(ctx): Promise<SmtpView | null>;
export async function saveSmtp(ctx, input): Promise<void>;
export async function sendTestEmail(ctx): Promise<MailProbeResult>;
export async function mailPolicy(): Promise<{ invitations: boolean; syncAlerts: boolean; monthlySummary: boolean }>;

// src/platform/export/service.ts
export async function exportUser(ctx): Promise<ReadableStream<Uint8Array>>;     // ZIP in streaming
export async function exportEverything(ctx): Promise<{ key: string; bytes: number }>;   // admin → S3

// src/platform/backup/service.ts
export async function backupNow(ctx, deps = { dump }): Promise<BackupResult>;
export async function lastBackup(): Promise<BackupResult | null>;               // da app_settings
```

### 3.4 Regole sottili, decise qui una volta sola

1. **L'ultimo amministratore non si tocca.** Togliere il ruolo, bloccare o rimuovere l'ultimo admin
   rimasto è rifiutato con `last_admin`, e nessuno può rimuovere sé stesso. Un'istanza senza admin
   si ripara solo dal container, e una schermata che permette di murarsi fuori è un difetto.
2. **Rimuovere un utente cancella anche ciò che sta fuori dal database.** Prima la riga (le chiavi
   esterne portano via tutto in transazione), **poi** `payslips/<id>/`, `cometa/<id>/`,
   `exports/<id>/` con `deleteFolder` — fuori dalla transazione, perché è I/O di rete. L'ordine è
   questo e non l'inverso: un utente cancellato a metà che riesce ancora ad accedere è peggio di un
   oggetto orfano, e gli orfani li raccoglie `housekeeping`.
3. **Le impostazioni salvate sostituiscono l'ambiente, non lo cancellano** (§5.1). `readEnv()` resta
   il valore iniziale; `app_settings` vince quando c'è. Un'istanza appena installata funziona con il
   solo `.env.homelab`, esattamente come oggi.
4. **Come si accorgono i processi che le impostazioni sono cambiate.** `getAuth()` e il trasporto di
   `mail.ts` sono memoizzati per processo, e un salvataggio avviene in **un** processo. Ognuno dei
   due tiene accanto all'istanza l'`updated_at` della chiave da cui è stato costruito e lo
   riverifica al massimo **ogni 30 secondi** (una lettura per chiave primaria); chi salva invalida
   subito la propria. Costo: una lettura minuscola ogni 30 s per processo. Prezzo: fino a 30 secondi
   di ritardo sugli altri lavoratori. È il compromesso migliore disponibile senza un canale fra
   processi, e va scritto nel commento perché non sembri una svista.
5. **Cambiare l'issuer OIDC disconnette tutti** (§5.1 e il design). Il salvataggio confronta l'issuer
   vecchio con il nuovo e, se è cambiato, cancella **tutte** le sessioni: le identità che quelle
   sessioni rappresentano non sono più garantite da nessuno.
6. **I tre interruttori della posta** (inviti e reset · avvisi di sincronizzazione · riepilogo
   mensile) decidono se quella categoria parte. Spegnere «inviti e reset» **spegne anche il link di
   reimpostazione della password**: la card lo dice a voce alta accanto all'interruttore, perché è
   l'unica combinazione che può chiudere fuori un utente.
7. **Il token si mostra una volta sola** e non è più recuperabile: lo dice la card prima di crearlo e
   la riga dopo, dove resta solo il prefisso. `last_used_at` si aggiorna con un `UPDATE … WHERE
   last_used_at IS NULL OR last_used_at < now() - interval '1 minute'`, così una chiamata al secondo
   non diventa una scrittura al secondo (§5.3).
8. **Un token non vale mai più del suo utente.** `/api/v1` costruisce lo stesso `Ctx` di una sessione
   e ogni lettura passa da `userScoped(ctx)`; **nessuna rotta amministrativa esiste sotto `/api/v1`**,
   e un token di un admin non ne guadagna. Lo scopo è un secondo cancello, non il primo: i servizi
   continuano a controllare per conto loro (§5.2 — il confine non è mai il middleware).
9. **Perché Hono e non rotte Next a mano** (§4.2, D5): un solo punto d'ingresso
   `src/app/api/v1/[[...route]]/route.ts`, l'autenticazione a token in un posto solo, gli errori in
   un formato solo. Ogni modulo espone le sue rotte in `api.ts` e **chiama i propri servizi**: la
   REST non ha una seconda implementazione di niente (D5).
10. **Che cosa entra in `/api/v1` nella 0.1** — solo ciò che serve davvero a uno script:
    `GET /accounts`, `GET /accounts/{id}/balances`, `GET /transactions`, `GET /summary`
    (patrimonio, liquidità, entrate/uscite del mese: la card di Home Assistant) con scopo `read`;
    `POST /accounts/{id}/balances` con scopo `write` (una lettura registrata da uno script);
    `POST /imports` con scopo `imports` (§9.3, stessa pipeline dell'interfaccia). Nient'altro.
11. **L'esportazione passa dai servizi dei moduli, mai dalle loro tabelle.** È il vincolo di
    `src/architecture.test.ts`, ed è anche giusto: l'export deve vedere i dati come li vede la
    schermata. `src/platform/export/service.ts` è l'unico posto del repository che dipende da tutti i
    moduli, e il commento in testa deve dire perché.
12. **Due esportazioni diverse perché sono due problemi diversi.** Quella dell'utente è una rotta che
    **trasmette** lo ZIP (`GET /settings/data/export.zip`): niente tabella, niente copia su S3,
    niente link che scade. Quella dell'admin («Export all data») è un **job**, perché mette insieme i
    documenti di tutti e non può stare nel tempo di una richiesta: scrive in `exports/` e la card
    mostra l'ultimo pacchetto.
13. **ZIP**: si aggiunge `yazl` (piccola, in streaming, tipi a parte). Scrivere a mano un formato
    contenitore per risparmiare una dipendenza è il tipo di economia che si paga a rileggerla.
14. **Backup**: `pg_dump -Fc` trasmesso a S3 in `backups/`, se ne tengono 30, potatura in
    `housekeeping`. Il client non può essere più vecchio del server, e il server dell'homelab è
    **18.6** (`pgvector/pgvector:pg18`). Verificato il 2026-09-21: l'immagine di base `node:22-alpine`
    è Alpine **3.24.2** e `apk add --no-cache postgresql18-client` installa esattamente
    `pg_dump 18.6` — una riga nello stadio `runner` del Dockerfile, nessun cambio di base e nessun
    container aggiuntivo. Il container ha il filesystem in sola lettura: il dump non tocca il disco,
    si tiene in memoria con un tetto esplicito e si carica in una volta. `backupNow(ctx, deps)` ha il
    comando iniettabile, così il test d'integrazione non ha bisogno di `pg_dump` dentro il container
    dei test — e il percorso vero si verifica una volta sola, a mano, sul sito.
15. **L'avviso agli admin** (§10.4) è Gotify, configurato da `GOTIFY_URL` e `GOTIFY_TOKEN`
    facoltativi: se non ci sono, la funzione non fa nulla e non si lamenta. Parte da `runTier` quando
    un job finisce `failed`, con il nome del job e l'errore già redatto — mai le credenziali.
16. **Il riepilogo mensile** è un job `monthly-summary` in coda a `accounts-snapshot` e
    `pockets-accrual`, perché deve raccontare numeri già assestati. Legge `user_preferences.
    monthly_summary` (oggi non lo legge nessuno), rispetta l'interruttore globale della posta, e
    usa `forEachUser` così l'errore di un utente non ferma gli altri.

### 3.5 Test

- **Unitari**: `tokens/rules.ts` (conio, analisi di un valore malformato, scadenza, scopi, stato);
  `export/csv.ts` (virgolette, separatore, BOM) e `export/zip.ts`; le regole di `users/admin`
  (ultimo admin, sé stessi); la scelta issuer-cambiato; la politica della posta.
- **Integrazione**: i token da capo a fondo (crea → autentica → `last_used_at` non più di una volta
  al minuto → revoca → un token di B non vede i dati di A); `users/admin` (invito, ruolo, blocco,
  rimozione con la pulizia di S3, il rifiuto sull'ultimo admin); `settings` (salvataggio e
  `keyHint`, issuer cambiato che cancella le sessioni); l'esportazione di un utente che contiene i
  suoi documenti e **nessuno** di quelli di un altro; il backup con il comando finto.
- **Isolamento (§11)**: per **ogni** rotta di `/api/v1` un test che dimostra che il token di B non
  legge, non modifica e non referenzia i dati di A. È il test che la specifica chiede per ogni
  modulo, esteso alla superficie nuova.
- **End-to-end**: un percorso admin (Users: invita, cambia ruolo, blocca, rimuovi; Server: salva
  SMTP e manda l'email di prova con un host irraggiungibile e leggi l'errore) e un percorso utente
  (crea un token, vedilo una volta, revocalo; esporta i propri dati e controlla che lo ZIP arrivi).
  Serve un utente admin: si promuove `owner` in `scripts/seed-e2e.ts` (è `@example.test`, nasce e
  muore con l'esecuzione) e gli si dà una sessione in `SESSIONS`.

### 3.6 Dove spec, design e realtà divergono — proposte

1. **L'avatar** (§7.10, Profile) non esiste e nessun'altra fase lo prevede. Proposta: **fuori da
   F8**, a meno che il resto non chiuda in anticipo; è l'unica voce di §7.10 puramente estetica, e
   F8 è già la fase più larga del piano.
2. **Il dump del backup non è cifrato.** Proposta: lasciarlo in chiaro nel bucket privato, perché un
   backup che si apre solo con l'anello di chiavi dell'applicazione è un backup che non salva
   dall'unico scenario per cui esiste (l'applicazione perduta). Da confermare col proprietario.
3. **La card «esegui un job a mano»** (§10.3) sta in Settings › Integrations e F2 l'ha rimandata.
   Proposta: entra in F8 con Admin › Server, perché è amministrativa; costa poco (`JOBS` è già un
   elenco) e senza di lei «Run now» della specifica non esiste da nessuna parte.
4. **La versione** nella card Maintenance: `package.json` + la versione di Next + `SHOW
   server_version` da Postgres, lette a richiesta. Nessuna variabile d'ambiente nuova.
5. **Lo scopo `write`** serve a una sola rotta nella 0.1. Proposta: tenerlo comunque nel modello,
   perché toglierlo e rimetterlo dopo vuol dire migrare i token della gente.

## 4. Lotti

Ogni lotto si chiude con il suo pezzo di cancello e può essere pubblicato da solo. L'ordine non è
negoziabile: P0 tocca l'autenticazione, e conviene che sia la cosa più riposata del lotto.

### P0 — Le impostazioni del server
`oidc.provider` e `smtp.transport` in `app_settings`; `getAuth()` e il trasporto della posta che
leggono le impostazioni prima dell'ambiente, con la riverifica ogni 30 s; le card Authentik e SMTP
con «Test connection» e «Send test email»; i tre interruttori; l'issuer cambiato che disconnette.

### P1 — Admin › Users
`src/modules/users/admin.ts`, la scheda `/settings/users` (admin), l'elenco con gli inviti in
sospeso, «Invite user» che finalmente chiama `createInvitation` + `sendInvitationEmail`, il
selettore del ruolo, blocca/sblocca, «Reset password», «Remove» con conferma e pulizia di S3.

### P2 — Token personali
Migrazione `0020`, `src/platform/tokens/`, la card in Settings › Security con la tabella del design
e il valore mostrato una volta sola.

### P3 — `/api/v1`
L'app Hono, l'autenticazione a token, `api.ts` nei moduli interessati, le sei rotte di §3.4.10, i
test di isolamento, la limitazione di frequenza.

### P4 — Esportazione
`export/csv.ts` (il `field()` tolto dalla rotta degli abbonamenti e reso comune), `export/zip.ts`,
la rotta dell'utente in Settings › Data, il job «Export all data» e la sua voce nella card
Maintenance.

### P5 — Backup
`postgresql-client` 18 nell'immagine, `backup/service.ts`, il job giornaliero, «Back up now», la
conservazione a 30 in `housekeeping`, la card Maintenance completa.

### P6 — Notifiche, riepilogo mensile e cancello
Gotify per i job falliti, la card «esegui un job a mano», il job `monthly-summary`, le stringhe
mancanti nei due cataloghi, il cancello intero e la pubblicazione.

## 5. Cancello

`npm run format && npm run lint && npm run typecheck && npm run format:check && npm test`, poi
`npm run test:integration`, `npm run db:generate` (nessuna differenza), `docker compose build &&
docker compose up -d`, `/api/health`, `npm run e2e`, e il confronto a schermo delle schermate nuove
con le righe 853–891 del design. Axe e i controlli di layout a 1440 e 400 px su `/settings/users`,
`/settings/server`, `/settings/security`.

## 6. Fatto quando

- Un amministratore invita una persona, le cambia ruolo, la blocca, le manda il link di reset e la
  rimuove — e la rimozione non lascia né righe né oggetti su S3.
- Authentik e SMTP si configurano dalla schermata, la prova dice se funzionano, e cambiare l'issuer
  disconnette tutti.
- Un token creato in Security fa funzionare `curl -H "Authorization: Bearer pat_…"` su
  `/api/v1/summary`, non vede i dati di nessun altro, e revocato smette di funzionare.
- «Export my data» scarica uno ZIP che contiene i propri CSV, il proprio JSON e i propri originali.
- «Back up now» lascia un `pg_dump` in `backups/` e la card dice quando e quanto grande.
- Un job che fallisce arriva agli admin; il primo del mese chi ha acceso il riepilogo lo riceve.
- Ogni stringa nuova esiste in `messages/en.json` **e** in `messages/it.json`.

## 7. Resta al proprietario

1. `GOTIFY_URL` e `GOTIFY_TOKEN` in `.env.homelab` (facoltativi; senza, gli avvisi agli admin
   restano spenti). Nessun valore può contenere un `$`.
2. Decidere su §3.6.2: backup in chiaro nel bucket, o sigillato con l'anello di chiavi.
3. Eseguire «Back up now» una volta sul sito dopo P5: è l'unico modo di verificare il `pg_dump` vero.
4. Dire se l'avatar (§3.6.1) entra in F8 o aspetta F9.

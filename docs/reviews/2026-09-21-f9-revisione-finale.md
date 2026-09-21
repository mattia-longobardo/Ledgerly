# F9 — Revisione finale dell'intero branch, per aree

> Sei aree sul branch `dev-0.1` intero (358 file di sorgente, 61 849 righe), come §11 chiede e come
> `docs/reviews/2026-09-16-f2-revisione-di-fase.md` ha già fatto una volta. Ogni rilievo dice
> **dove**, **che cosa succede davvero** e **come riprodurlo**; **[verificato]** vuol dire che è
> stato riprodotto a mano, sul sito pubblicato o leggendo il codice fino in fondo, non dedotto.
>
> Data: 2026-09-21. Punto di partenza: `a51111e` (P1 e P2 consegnate).

## 0. Come è stata fatta

Non a occhio. Per ogni area c'è un controllo meccanico che produce una prova, e i sospetti che il
controllo solleva si leggono a mano prima di chiamarli rilievi. I controlli sono scritti qui sotto
area per area, così chi ripete la revisione fra sei mesi ripete le stesse misure e non altre.

Il grosso di quello che una revisione del genere cercherebbe **non c'era**: è il risultato più utile
di questo documento e sta in §7.

## 1. Area A — soldi, date e arrotondamenti

**Controlli.** Ogni `Number(…)`, `parseFloat(…)` e `toFixed(…)` applicato a un importo; ogni
divisione fra `bigint`; ogni `toISOString().slice(0, 10)`; la lettura di `src/platform/money.ts`.

`parseCents` e `centsToDecimal` sono corretti: mezzo tondo **lontano dallo zero** al terzo decimale,
come il commento promette, e il ritorno è esatto nei due sensi. Tutti gli usi di `Number()` su
importi sono **geometria di grafici o frazioni da mostrare** — una quota, un segno, la larghezza di
una barra — mai aritmetica di denaro. Nessun importo viaggia come `float`.

### A1 — la data di un documento Cometa è quella di Greenwich, non la tua **[verificato]**

**Dove:** `src/modules/funds/ui/pension-view.tsx`, la card «Cometa documents» (righe 864 e 908).

**Che cosa succede.** La colonna «Received» rendeva la data con
`document.receivedAt.toISOString().slice(0, 10)`, cioè **il giorno di calendario UTC**. Ogni altro
punto dell'applicazione che mostra la stessa cosa — l'elenco dei cedolini, la pagina di un cedolino,
e **la pagina del documento Cometa stesso** — usa `civilDateIn(document.receivedAt, ctx.timeZone)`.

Per chi sta a Roma, un documento caricato fra mezzanotte e l'una (le due in ora legale) compare nella
card del fondo **con la data del giorno prima**, e sulla sua pagina con quella giusta: lo stesso
documento, due date, a due clic di distanza.

**Come riprodurlo.** Caricare un documento Cometa alle 00:30 di Roma. La card del fondo dice ieri, la
pagina del documento dice oggi.

**Perché è un rilievo e non un dettaglio.** `CLAUDE.md` dice che le date passano da
`src/platform/dates.ts`, e qui non ci passavano. È anche l'unica violazione di quella convenzione in
tutto il branch: gli altri tre `toISOString().slice(0, 10)` (`imports/rules.ts`,
`holidays/sources.ts`, `export/service.ts`) costruiscono di proposito date civili da `Date.UTC`, che
è il modo giusto di fare aritmetica di calendario, e non leggono l'ora di nessuno.

**Corretto** in questo lotto: le due righe usano `civilDateIn` come tutte le altre.

### A2 — due mediane arrotondano in due modi (nota, nessuna correzione)

`src/modules/transactions/rules.ts:765` calcola la mediana di un numero pari di valori come
`(a + b + 1n) / 2n` — mezzo tondo verso l'alto; `src/modules/funds/detect.ts:110` la calcola come
`(a + b) / 2n`, che tronca verso lo zero. Mezzo centesimo di differenza, in due euristiche di
riconoscimento che decidono «questo assomiglia a quello», mai in un importo mostrato o scritto.
Registrato perché due formule diverse per la stessa cosa sono un inciampo per chi legge, non perché
il numero sia sbagliato.

## 2. Area B — isolamento fra utenti e controlli di accesso

**Controlli.** Tutte le 55 tabelle e i 99 `.from/.update/.delete/.insert` che le toccano; ogni
funzione esportata da un `actions.ts` con `"use server"`; ogni uso di `requireAdmin`; come le rotte
API controllano gli scope.

**Niente da segnalare, e vale la pena dire perché.**

I 99 statement si riducono a tre insiemi. Quelli che portano `userScoped(ctx)` in chiaro. Quelli che
passano da un aiutante — `sameScope` in budgets, `conditions` in transactions, `categoryScope` in
taxonomy, `scope` in subscriptions, il `where` di `resetCode` in payroll — e **ogni aiutante comincia
da `userScoped(ctx).owns(…)`**: verificati uno per uno. E quelli su tabelle che non sono di nessun
utente: `app_settings`, `job_runs`, `fund_fee_tariffs`, `holiday_calendars`, più le cancellazioni per
scadenza della manutenzione, che tagliano per data e non per persona. Gli `insert` passano tutti da
`userScoped(ctx).stamp(…)`.

Ogni Server Action chiede una sessione. L'**unica** che non lo fa è `acceptInviteAction`
(`src/app/(auth)/actions.ts`), ed è giusto così: chi accetta un invito non ha ancora un conto. Tutte
le azioni di amministrazione passano da `requireAdmin()`, e i servizi sotto ricontrollano con
`requireAdminCtx(ctx)` invece di fidarsi del chiamante.

Le rotte API controllano lo scope in `withToken(scope)`, che rifiuta con `403` quando
`identity.scopes` non contiene quello richiesto — **prima** che il servizio sotto scopi la query con
`userScoped(ctx)`: due controlli indipendenti, come il commento del file dice.

### B1 — `tokenAllows` e `SCOPES` non li chiama nessuno (nota → P7)

`src/platform/tokens/service.ts:221` e `src/platform/api/auth.ts:61`. Il controllo degli scope è
scritto in linea dentro `withToken`, quindi **non manca nessun controllo**: mancano due funzioni che
nessuno usa. Vanno via con il resto del codice morto in P7 (§6).

## 3. Area C — job, transazioni e I/O di rete

**Controlli.** Il corpo di ogni `.transaction(async (tx) => …)`, estratto a parentesi bilanciate e
cercato per chiamate di rete (`fetch`, posta, S3, LLM, Gotify); il registro dei job contro i job
definiti; il barrel delle tabelle contro gli `schema.ts`; i lock.

**Zero chiamate di rete dentro una transazione**, su tutto il branch: la regola di `CLAUDE.md` è
rispettata dappertutto. I 15 job definiti sono tutti e 15 nel registro, i 19 `schema.ts` sono tutti
e 19 nel barrel. I job si serializzano con un lock consultivo di sessione su una connessione
dedicata e fuori da ogni transazione (`src/platform/jobs/lock.ts`), che è il modo giusto: un lock
consultivo dentro una transazione si sbloccherebbe al commit, non alla fine del lavoro.

### C1 — `admin.spec.ts` corre contro sé stesso **[verificato]**

**Dove:** `tests/e2e/admin.spec.ts`, il percorso che cambia un ruolo.

**Che cosa succede.** `role.selectOption("admin")` fa partire una Server Action; la riga dopo è
`page.reload()`. Le due cose corrono. Il test ha fallito **una passata intera su due** con
`Expected: "admin" / Received: "user"`, e **non ha mai fallito da solo**: eseguito con i suoi cinque
fratelli passa sempre, perché la macchina è meno carica.

**Come riprodurlo.** `npx playwright test` sull'intera suite, un paio di volte.

**È una fragilità del test, non del prodotto:** il ruolo *viene* cambiato, il test guarda troppo
presto. **Corretto** in questo lotto: la selezione aspetta la risposta della Server Action (che è un
POST all'URL della pagina) prima di ricaricare.

## 4. Area D — integrazioni e importazioni

**Controlli.** L'idempotenza della sincronizzazione (`upsertFromProvider` e i `provider_links`), la
cifratura delle credenziali e la sua rotazione, il lock di Trek e di Wallet, la deduplica dei
documenti caricati.

**Niente da segnalare.** Le sincronizzazioni sono idempotenti per chiave del fornitore e tengono i
loro `provider_links` in una tabella sola con un proprietario solo (§4.3); un secondo giro non
duplica niente. I documenti sono deduplicati sull'impronta del file. Le credenziali sono sigillate
con `APP_ENCRYPTION_KEY` nella forma `id:base64[,vecchie…]`, che apre ancora quello che una chiave
precedente aveva sigillato: la rotazione si fa anteponendo una chiave, senza riscrivere niente.

## 5. Area E — interfaccia, stati vuoti e messaggi

**Controlli.** Le 2 465 chiavi di `messages/en.json` contro `messages/it.json`; lo stato vuoto di
ogni pagina d'elenco; ogni testo d'errore mostrato a schermo; ogni azione distruttiva contro la sua
conferma.

I messaggi sono in **parità perfetta**: stesse 2 465 chiavi nelle due lingue, zero mancanti da una
parte o dall'altra. Le 19 coppie identiche sono nomi propri e campioni di formato — «Authentik
(OIDC)», «1.234,56 € (it-IT)» — cioè cose che non si traducono. Ogni pagina d'elenco ha il suo stato
vuoto. Nessun errore mostrato a schermo è il messaggio grezzo di un'eccezione: sono tutti chiavi
tradotte.

### E1 — «Archive account» cancella il conto, senza chiedere **[verificato, riprodotto sul sito]**

**Dove:** `/accounts/[id]?tab=settings`, la «Danger zone»
(`src/modules/accounts/ui/settings-form.tsx`).

**Che cosa succede.** L'unico bottone della sezione si chiama **«Archive account»** e chiama
`removeAccountAction`, cioè `removeAccount`, che implementa §7.1: *cancella* il conto quando niente
vi si appoggia, e lo archivia solo quando qualcosa vi si appoggia. E `transactions.account_id` e
`balance_entries.account_id` sono `on delete cascade`.

Quindi: su un conto con trecento movimenti e nessun salvadanaio, abbonamento, regola di interessi o
fondo che lo nomini, quel bottone **cancella il conto e tutti e trecento i movimenti, per sempre**.
Senza conferma — è l'**unica** azione distruttiva dell'applicazione che non ne ha una; «Remove
person», che cancella una persona intera, la conferma ce l'ha. E senza dire che cosa ha fatto,
nonostante `removeAccount` restituisca `"deleted" | "archived"` e il suo stesso commento dica che lo
restituisce «so the interface can say so».

**Come riprodurlo** (fatto il 2026-09-21 sul sito pubblicato, con un utente `@example.test`):
1. creare un conto;
2. aprirlo, scheda Settings, premere «Archive account»;
3. dialoghi di conferma apparsi: **0**; la pagina va a `/accounts`;
4. riaprire l'URL del conto: **404**; cercarlo nell'elenco: **non c'è**.

Non archiviato. Cancellato.

**Corretto** in questo lotto:
- `removeAccountAction` restituisce l'esito (`deleted` o `archived`) invece di un `ok` muto;
- il bottone apre un dialogo che dice **quali sono le due cose che possono succedere e quando**, con
  «Lascialo dov'è» e «Rimuovi il conto»;
- l'etichetta passa da «Archive account» a «Rimuovi il conto», perché archiviare è solo una delle
  due;
- a cose fatte un avviso dice quale delle due è successa — in rosso quando è stata la cancellazione;
- `tests/e2e/accounts.spec.ts` ha un percorso nuovo che controlla tutto questo, compreso che
  annullare il dialogo lasci il conto dov'è.

## 6. Area F — piattaforma, configurazione e segreti

**Controlli.** Ogni `console.*`; ogni lettura di `process.env`; il confronto dei segreti;
l'invocazione di `pg_dump`; `/api/health` e `/api/metrics`; le variabili dichiarate contro
`.env.example` e `.env.homelab`.

**Niente di grave, e diverse cose fatte bene.** `pg_dump` è lanciato con `spawn` **senza shell** e
con la password **nell'ambiente, mai fra gli argomenti** — un argomento si vede nella lista dei
processi. I segreti si confrontano con `timingSafeEqual` sui loro digest, non con `===`. Ogni
`console.error` passa da `redactForLog`, che toglie le query string degli URL (dove viaggiano i
codici OAuth) e la riga `params:` di un errore Drizzle (dove viaggiano gli hash delle password e i
token di sessione). `/api/health` è pubblico e dice solo se è vivo; `/api/metrics` sta dietro un
bearer token e risponde `404` a chiunque altro, che è meglio di `401` perché non ammette di esistere.

### F1 — `S3_KEY_PREFIX` non è in `.env.example` (nota → P5)

L'applicazione la legge (`src/platform/env.ts:62`, `src/platform/storage.ts:35`) e `.env.example`,
che dichiara di essere «la forma di `.env.homelab`», non la nomina. È una leva **di test** — vuota in
produzione, `tests/` per il progetto di integrazione che condivide il bucket — quindi non manca
niente al deployment; manca una riga alla documentazione. Da scrivere in P5.

### F2 — `GOTIFY_URL` e `GOTIFY_TOKEN` non sono in `.env.homelab` (conferma, resta al proprietario)

Confermato misurando: `.env.example` le dichiara, `.env.homelab` non le ha. Gli avvisi ai
manutentori sono quindi spenti, il che **non è un errore** (il codice le tratta come facoltative) ma
è una scelta che il proprietario deve fare sapendo di farla. È il §7.1 aperto da F8 e resta suo.

## 7. Che cosa non c'era

Vale quanto l'elenco dei rilievi, perché è quello che una revisione cerca e quasi sempre trova:

- **nessuna query su dati di un utente senza il suo filtro**, su 99 statement e 55 tabelle;
- **nessuna Server Action senza sessione**, salvo quella che per definizione non può averne una;
- **nessuna chiamata di rete dentro una transazione**;
- **nessun importo trattato come numero a virgola mobile**;
- **nessun segreto nei log, negli argomenti di un processo o in un messaggio d'errore**;
- **nessun job fuori dal registro, nessuna tabella fuori dal barrel**;
- **nessuna chiave di messaggio presente in una lingua e assente nell'altra**;
- **nessuna pagina d'elenco senza stato vuoto**.

## 8. I lotti

Un lotto solo, perché i rilievi correggibili sono tre e non si toccano fra loro. Cancello verde
sull'albero intero dopo di esso.

| Rilievo | Dove | Stato |
|---|---|---|
| A1 — data del documento in UTC | `funds/ui/pension-view.tsx` | corretto |
| C1 — `admin.spec.ts` corre contro la Server Action | `tests/e2e/admin.spec.ts` | corretto |
| E1 — «Archive account» cancella senza chiedere | `accounts/ui/settings-form.tsx`, `accounts/actions.ts`, `messages/*.json` | corretto, con un percorso end-to-end nuovo |
| A2 — due mediane, due arrotondamenti | `transactions/rules.ts`, `funds/detect.ts` | nota, nessuna correzione |
| B1 — `tokenAllows` e `SCOPES` morti | `platform/tokens`, `platform/api` | rimandato a P7 con il resto del codice morto |
| F1 — `S3_KEY_PREFIX` non documentata | `.env.example` | rimandato a P5 |
| F2 — Gotify non configurato | `.env.homelab` | resta al proprietario |

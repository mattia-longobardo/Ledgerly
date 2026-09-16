# F2 — revisione di fase (§11), 2026-09-16

Revisione dell'intero branch divisa per **sei aree**, sul diff `145e6fe..HEAD`
(96 file, ~18.000 righe). Il cancello automatico era e resta verde: `typecheck`,
`lint`, `format:check`, 621 test unitari, 210 di integrazione, 13 end-to-end con
la build. Quello che segue è quindi, per costruzione, **ciò che una suite verde
non vede**.

I rilievi contrassegnati **[verificato]** sono stati riprodotti a mano
dall'orchestratore, non accettati sulla parola del revisore.

Resta fuori da questo documento il **confronto visivo con il design**, che §11
assegna al proprietario.

---

## Lotto A — **CHIUSO** (2026-09-16)

Tutti e sei corretti. Cancello verde sull'albero intero: 647 test unitari, 219 di
integrazione, 13 end-to-end con la build. Tre correzioni sono state verificate
**per mutazione** — riscrivendo il difetto e controllando quali test cadono —
perché tre dei sei erano coperti da asserzioni che passavano col bug.

Decisione del proprietario applicata a tutto il lotto: **meglio una passata
fallita che dati sbagliati in silenzio.**

Due conseguenze della decisione, accettate e da sapere:

- **Il freno può incollarsi.** Se l'utente cancella davvero più di metà dei
  movimenti di una finestra, la passata fallisce ogni ora e in F2 non c'è modo di
  dire «confermo la sparizione». Niente si perde e i movimenti restano visibili.
  L'alternativa automatica — fidarsi di un dubbio che si ripete identico —
  riaprirebbe la cancellazione silenziosa, perché un provider che tronca ripete
  identico anche lui. Una via d'uscita nell'interfaccia è lavoro da F3.
- **§7.2 letta alla lettera vorrebbe la rimozione** anche da una risposta vuota:
  una risposta vuota *è* una risposta. Il freno è una **deroga deliberata**, e
  va scritta in §7.2 dal proprietario, altrimenti la prossima lettura della
  specifica la leggerà come un difetto.

Dettaglio che non era nel piano e che è emerso correggendo: costruire l'oggetto
degli header fuori dal `try` **non** sposta il lancio, perché con un oggetto
semplice è `fetch` stesso a chiamare `Headers.append`. La chiusura vera è
passare a `fetch` un'istanza `Headers` già valida, più un `catch` **senza
binding** (un errore che nessuno tiene in mano non può essere interpolato) e una
redazione su qualunque messaggio estraneo.

### Rilievi originali



Tutti nascondono o sporcano dati al primo uso reale. Un collaudo eseguito sopra
questo codice farebbe sospettare il provider invece del nostro motore, e
nasconderebbe dati in modo non reversibile.

### A1. Il token può finire nel database, in pagina e nei log **[verificato]**
`wallet/client.ts:226-235`

Un token con un carattere di controllo **in mezzo** (incollato da una pagina
andata a capo; `token.trim()` toglie solo i bordi) fa lanciare a undici un errore
che **cita il valore**. Riprodotto su Node 22.22:
`Headers.append: "Bearer secret\rtoken" is an invalid header value.`
L'header è costruito dentro il `try`, l'errore è catturato e incartato in
`WalletError("network", …)`, quindi il token in chiaro finisce in
`sync_runs.error`, in `integration_connections.last_error`, nella card di
Settings › Integrations (mostrata verbatim) e in `console.error`. Viene anche
ritentato 5 volte per un valore che non funzionerà mai.

Direzione: rifiutare in `connectWalletAction`/`readToken` un token che non è un
valore di header valido, e non incartare mai il messaggio originale di un errore
di costruzione degli header.

### A2. `removed_upstream_at` applicato a conti che la risposta non copriva **[verificato]**
`wallet/sync.ts:214-221` + `:324-336`

`syncTransactions` itera su **tutti** i conti collegati e passa la finestra anche
a quelli per cui Wallet non ha restituito niente. Un conto cancellato in Wallet
diventa `unavailable` (giusto, §7.1) ma resta nella mappa: ogni ora riceve `[]`
con la finestra, e **tutti i suoi movimenti nella finestra vengono nascosti**.
Non tornano mai, perché la condizione che li ripristinerebbe è quella che non si
verificherà più. Al ricollegamento le finestre sono 12 mensili: dodici mesi di
storia nascosti in una passata. §7.1 vieta di cancellare un conto sparito, e
nascondere i suoi movimenti è cancellarlo di fatto.

Direzione: passare la finestra solo ai conti presenti in `remote` in questa
passata — informazione che `syncAccounts` ha e non propaga.

### A3. Il verdetto di sparizione poggia su premesse non dimostrate
`wallet/client.ts:326` + `wallet/sync.ts:314-340` (convergente da due aree)

Due premesse senza alcun controllo: «pagina intera» dedotto **solo** da
`page.length < limit` (nessun `hasMore`, nessun totale, nessuna verifica che le
righe cadano nella finestra chiesta), e una risposta `200` con zero righe
trattata come autorevole. Se il server impone una sua page size (100 mentre
chiediamo 500), ogni finestra sembra intera e i movimenti oltre il centesimo
vengono dichiarati spariti, per sempre, con il run a `success`.

La stessa prudenza è **già** applicata a `/accounts` e `/categories`
(`assertWholePage`: «meglio una passata fallita»); a `/records` — l'unico
endpoint che può cancellare dati — non è applicata.

Direzione: un freno in `syncTransactions` che rifiuta il verdetto di sparizione
quando la risposta è sospetta (finestra vuota a fronte di righe memorizzate, o
rimozioni sopra una soglia) e chiude la corsa come `failed`; più un rifiuto
rumoroso se il provider restituisce un movimento fuori dalla finestra chiesta.

### A4. Il giorno del provider viene buttato quando `recordDate` porta un'ora
`wallet/sync.ts:157` (convergente da due aree)

`occurredAt: movement.occurredAt ?? startOfDayIn(movement.occurredOn, tz)`: se
Wallet manda un istante, `occurredOn` (il giorno che Wallet ha timbrato) viene
scartato e il giorno civile che l'app rilegge con `civilDateIn` è un altro.
`2026-01-20T23:40:00Z` → provider `2026-01-20`, app `2026-01-21` a Roma; a ovest
di Greenwich lo scarto è nel verso opposto. Il giorno del provider non è
persistito da nessuna parte, quindi niente può riconciliarlo.

Amplificazione: l'appartenenza alla finestra è misurata nel fuso dell'utente
mentre Wallet filtra sul proprio `recordDate` → un movimento può essere **dentro**
la finestra dell'app e **fuori** dal filtro di Wallet, quindi dichiarato sparito
ogni ora. La fixture con la `Z` esiste già; nessun test copre la combinazione.

### A5. «Sync now» in concorrenza col job orario duplica i movimenti **[verificato]**
`integrations/service.ts:167-183` + `settings/integrations/actions.ts:117`

Il job prende un advisory lock sul **nome del job**; «Sync now» non prende alcun
lock e `recordRun` non ha guardie contro una corsa già aperta. Due aree erano in
disaccordo sull'esito: risolto leggendo `linkExternal` — l'upsert ha come target
la chiave **esterna** e in `DO UPDATE` riscrive `entity_id`, quindi la seconda
passata **riesce**. Esito: due righe in `transactions` per un solo movimento
Wallet, denaro contato due volte fino alla passata successiva, e una riga orfana
che resta per sempre etichettata «sparita dal provider».

Direzione: `withJobLock("wallet-sync:" + connection.id)` in `syncWalletNowAction`,
con risposta «già in corso» se non lo ottiene.

### A6. Un nome di categoria oltre 60 caratteri decategorizza i movimenti
`modules/transactions/taxonomy.ts:247` + `service.ts:206-222`

`adoptOrCreateCategory` valida il nome **prima** di consultare il collegamento
del provider. Un nome oltre `NAME_MAX = 60` lancia `invalid`, il servizio
restituisce `null`, e `planProviderMerge` scrive `categoryId: null` su movimenti
già categorizzati e già collegati — ogni ora, per tutta la finestra. §9.1 vuole
collegamento → nome esatto → creazione: qui l'ordine è invertito. Stesso schema,
con posta minore, per le etichette (vengono togliate).

---

## Lotto B — prima di F3

Budget e abbonamenti si appoggiano direttamente su transazioni e categorie.

- **B1. Il totale dell'intestazione di mese è calcolato sulla pagina**, non
  sull'intervallo (`queries.ts:654-666`, reso in `expenses/page.tsx:100-106`).
  `rows` è già passato per `limit(500)`: il mese al confine del taglio mostra un
  numero di denaro sbagliato con l'autorevolezza di uno giusto (esempio del
  revisore: gennaio legge −340,00 € invece di −2.980,00 €). `monthlyTotals`
  calcola la risposta giusta in SQL ed è **codice morto**.
- **B2. Il totale in testa alla card «By category» non è il totale delle sue
  righe** (`breakdown-card.tsx:29` + `page.tsx:197`): somma con segno e giroconti
  compresi contro valori assoluti senza giroconti. Con stipendio +2.500 e spese
  −2.500 la card dice «0,00 €» sopra due righe da 2.500.
- **B3. Spazio ruba l'attivazione a ogni pulsante** (`transactions-table.tsx:105-127`):
  la guardia delle scorciatoie non esclude `button`.
- **B4. L'intestazione ordinabile annuncia la direzione sbagliata** su
  payee/account/category (`transactions-table.tsx:356-358`): il ramo `else` dice
  sempre «descending», il default di quelle colonne è `asc`.
- **B5. `acc` e `cat` non sono validati** (`ui/filters.ts:194-202`): `/expenses?acc=x`
  → uuid invalido → tutta la schermata cade nell'error boundary, contro il
  fallback che il file stesso dichiara.
- **B6. Due job notificano la stessa condizione** (`transactions/jobs.ts:186-274`
  contro `accounts/jobs.ts:96-135`): con 10 conti sono ~11 email a settimana per
  un solo token morto, e un conto `unavailable` ne manda una a settimana **per
  sempre** (§7.1 vieta di cancellarlo, `accountAlerts` tace solo per `archived`).
- **B7. Un token revocato viene descritto come «sincronizzazione obsoleta»**
  invece di «token rifiutato», che è l'unica frase azionabile (`sync.ts:388-391`).
  Collegato: `states.revoked` è etichettato «Scollegato», ma è lo stato che
  l'utente **non** causa mai — quello che causa lui è `absent`.
- **B8. `sync_runs` non è potata da nessuno** (`platform/jobs/housekeeping.ts`):
  §10.2 chiede la pulizia delle esecuzioni oltre 90 giorni; un collegamento
  revocato scrive 2 righe l'ora per sempre.
- **B9. Codice morto nella piattaforma**: `applyPresence`,
  `reconcileExternalIds`, `unlinkEntities` senza chiamanti di produzione, e
  `provider_links.missing_since` **sempre `NULL`**. Due implementazioni della
  regola di §7.2 di cui una non gira mai (§4.3 vuole una sola fonte di verità).
  Conseguenza concreta: cancellare un conto lascia orfane le righe di
  `provider_links`, e la funzione per toglierle esiste e non viene chiamata.
  *Causa: la decisione dell'orchestratore di far passare il motore da
  `options.window`.*
- **B10. L'avvio non si rifiuta di partire senza `APP_ENCRYPTION_KEY`**
  (`src/instrumentation.ts:7`): il processo resta in ascolto e risponde **500 a
  tutto**, `/api/health` compreso, ristampando l'intero ZodError a ogni probe
  fino a far ruotare via i log precedenti; `autoheal` riavvia in loop e Traefik
  instrada un 500. Il README afferma il contrario. Direzione: `process.exit(1)`.
- **B11. Con «Show hidden» i totali includono i movimenti nascosti**
  (`queries.ts:260-262`): §7.2 concede la visibilità, non l'ingresso nei totali.
- **B12. Un'etichetta cancellata torna alla sincronizzazione successiva**
  (`taxonomy.ts:366-391`): §7.2 elenca la cancellazione, §9.1 dice «etichette per
  nome», e le due si scontrano. Va deciso: marcatore o archiviazione.

---

## Lotto C — dopo, o decisione del proprietario

- **Una decina di test che non provano quello che il titolo dice.** Il più
  importante: **la garanzia centrale dei soldi non è tenuta ferma da nessun
  test** — tutti i 15 importi delle fixture danno lo stesso risultato per il
  percorso «testo sorgente» e per quello `number`, quindi togliere il reviver non
  farebbe fallire niente; e il commento in `mapping.test.ts:165` («half-up sul
  testo è l'unico modo di arrivare a 101») è falso. Poi: i bordi di 3 fasce di
  ricorrenza su 5 non asseriti, `facetCounts` senza test, il tie-break
  dell'ordinamento mai esercitato, il cooldown delle notifiche non asseribile.
- **Irrigidimento del container di §5.4 assente** su entrambi i servizi:
  `read_only`, `tmpfs`, `no-new-privileges`, `cap_drop`. Preesistente da F1.
- **`TRUSTED_PROXY_IPS` fissa l'IP dinamico del container Traefik**: ricreare
  Traefik degrada in silenzio il rate limit a un bucket unico. `172.18.0.0/16`
  chiude il caso.
- **`name: projects` è condiviso da tre compose file**: un `--remove-orphans`
  cancellerebbe `horizon`, `horizon-mcp`, `horizon-worker` e `wallet-manager`.
  AGENTS.md §2 descrive `projects/` come stack con `include:`, che non è ciò che
  c'è su disco.
- **Nessuno interroga `/api/metrics`** e `dash.longobardo.me` non è in nessun
  target blackbox: `job_last_success_timestamp` non arriva a nessuna dashboard,
  quindi «wallet-sync è riuscito l'ultima volta 9 ore fa» non è visibile da
  nessuna parte (§10.4, AGENTS.md §5.D).
- **`[migrate] schema is up to date` è stampato incondizionatamente** dopo
  `runMigrations` (`scripts/migrate.ts:10`), quindi appare anche quando una
  migrazione è appena stata applicata.
- **Il backfill può superare `--max-time 600`** del tick: curl esce 28, il lavoro
  lato server continua, e ogni tick successivo scrive `skipped/already_running`.
  Durante l'unica operazione manuale di §10 il proprietario vede un cron rosso
  mentre la sincronizzazione procede.
- **Valuta diversa da EUR accettata in silenzio** (`mapping.ts:248`): §2 dice che
  l'euro è imposto, non presunto.
- **`payee` non persistito in `recurring_patterns`**: `payeeKeyOf` è
  irreversibile, e F3 dovrà mostrare un beneficiario presentabile. Decisione
  dell'orchestratore da rivedere.
- Chiavi di catalogo inerti (`expenses.countTransactions` morta,
  `filters.accounts.one` un passthrough), plurali italiani mancanti in
  `settings.integrations.counts.*` («1 nuovi»), e la conferma di Disconnect che
  non dice di distruggere il registro delle sincronizzazioni.

---

## Cosa è stato verificato e tiene

Conta quanto l'elenco sopra.

- **La matematica di §7.2 è giusta numero per numero**: le dieci estremità delle
  cinque fasce sono inclusive, `< 3` per le occorrenze, tolleranza in interi
  esatta e inclusiva al bordo, mediana a conteggio pari half-up **simmetrica**
  sui negativi, intervallo medio half-up.
- **Disciplina `bigint` senza eccezioni**: nessun `Number(` su un importo in
  tutto il modulo; ogni `sum()` ricostruito con `BigInt`.
- **Isolamento fra utenti solido**, condizioni di join comprese, e i test più
  completi del branch (lettura, modifica, cancellazione **e** riferimento
  forgiato). Le azioni multiple ignorano gli id non propri senza contarli.
- **Il token non torna al browser** da nessun percorso della pagina: il tipo non
  ha un campo in cui viaggiare, il campo è `type="password"` senza valore, e
  `readCredentials` è chiamata in un solo punto.
- **Nessuna chiamata di rete dentro una transazione**, su ogni ramo, compreso
  quello d'errore.
- **Gli importi sono formattati sul server** e attraversano il confine come
  stringhe: nessuno cambia col locale del browser.
- **`startOfDayIn`**, dopo la correzione di §11.3, è pulita su **tutte le 418
  zone** a ogni cambio di offset dal 2026 al 2036.
- **La migrazione è additiva e coerente**: `drizzle-kit check` pulito, snapshot
  rigenerato identico, nessuna tabella di F1 toccata.
- **Il cursore del backfill è corretto**: scritto solo a backfill completato, una
  passata caduta a metà ripete i 12 mesi invece di perderli.
- **Se `APP_ENCRYPTION_KEY` andasse perduta** si perde **solo** il token di
  Wallet — è l'unica colonna cifrata — e incollarne uno nuovo è la procedura di
  ripristino, che conserva anche lo storico.

---

## Aggiunte alla lista del collaudo col token

Emerse correggendo il lotto A, oltre alle otto già elencate:

- **`transferCounterRecordId` è il campo più pericoloso e resta non verificabile
  in laboratorio.** §7.2 abbina i giroconti **solo** su quel riferimento, quindi
  un nome di campo sbagliato significa nessun giroconto abbinato mai, senza un
  messaggio. La guardia `assertFieldSeenSomewhere` è stata ripristinata per
  `recordType` e `recordState` ma **non** per questo campo, con una ragione
  buona: una pagina senza nessun giroconto è una pagina del tutto normale,
  quindi «assente da ogni record» lì non dimostra niente e la guardia farebbe
  fallire quasi ogni passata. Va verificato su una pagina vera, oppure coperto
  con un contatore sull'intera passata (giroconti letti contro riferimenti
  presenti e abbinati).
- **Un carattere di controllo C0 passa `new Headers`** e fa fallire undici più
  tardi con un generico `fetch failed`: nessuna fuga, ma cinque tentativi
  bruciati. Per questo `isUsableToken` è più severo di `new Headers`.

## Già corretto in questa tornata

- Il percorso end-to-end di Expenses scadeva il 1° ottobre: le date del seed ora
  si derivano da `today()` (`605c84c`).
- Il README non diceva che `APP_ENCRYPTION_KEY` va messa in salvo né come si
  ruota senza danni, e non era nella lista dei segreti da generare (`605c84c`).
- Il registro dei job non era coperto da nessun test (`19409b6`).

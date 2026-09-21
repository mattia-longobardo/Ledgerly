# F7 — Ferie (Time off) + Trek

> Piano da eseguire **in linea**, lotto dopo lotto, come F3–F6. Chi lo riprende in mano non ha il
> contesto della sessione che l'ha scritto: qui dentro c'è tutto quello che serve.

## 0. Come si legge

1. `CLAUDE.md` alla radice — convenzioni vincolanti.
2. `docs/specs/2026-09-13-dev-0.1-design.md` — **§7.9 Ferie** e **§9.2 Trek** (vincolanti), §6 (tabelle
   `timeoff_allowances`, `leave_days`), §7.8 (ferie dai cedolini: istantanee, eventi, mese di utilizzo),
   §8.2–8.3 (schermate e componenti), §10.2 (job orario), §11 (test), §12 (fasi).
3. Il design (`UI Recreation and branding decisions/Finance Dashboard.dc.html`, sola lettura):
   **Time off** righe 778–810 — intestazione «Work & Time off» con anno e dotazioni, KPI *Vacation*
   e *ROL* con rimanente/goduto/pianificato, barre «By month», calendario annuale a 12 mesi con
   legenda (Vacation · ROL · Planned · Public holiday), tabella «Leave days» (Date · Type · Duration ·
   Note · Status) con i filtri tutti/goduti/pianificati, modale «Add leave»; Settings › Integrations
   righe ~840 (la card di un collegamento: stato, ultima sincronizzazione, «Sync now», «Configure»).
4. `docs/plans/2026-09-16-f2-integrazioni-wallet-expenses.md` §8 (cassaforte delle credenziali, motore
   di sincronizzazione, `sync_jobs`/`sync_runs`, Settings › Integrations) e
   `docs/plans/2026-09-19-f5-importazioni-payroll.md` §8 (ferie dai cedolini).
5. **Il vecchio client Trek**, solo come riferimento (spec §0.5, mai copiato):
   `git show origin/main:dashboard-app/src/lib/clients/trek.ts` — trasporto MCP, semantica del
   toggle, `planToggles` puro; `…/src/lib/jobs/trek-sync-job.ts` — politica del job (un passaggio
   parziale è un fallimento, nessun avviso all'ora).

## 1. Obiettivo

F7 secondo §12: **§7.9 (ferie, ROL, festività, residui, calendario) e §9.2 (sincronizzazione Trek)**.
Il prodotto della fase: una schermata Time off che dice, per l'anno scelto, quanto è maturato, quanto
è stato goduto, quanto è pianificato e quanto resta — con la provenienza di ogni numero — e una
sincronizzazione con Trek che **non cancella mai un giorno per sbaglio**.

Fuori perimetro: `/api/v1` per le ferie (F8), approvazioni o flussi aziendali, il calendario di altri
utenti, lo strumento delle festività aziendali di Trek (non si chiama mai, §3.4.9), ferie a cavallo
di anni con finestra diversa dall'anno solare (Trek le gestisce, noi mostriamo le sue statistiche
senza ricalcolarle, §3.6.4).

## 2. Punto di partenza (2026-09-20)

- Branch `dev-0.1` con F6 consegnata; ultima migrazione `0012_pension_cometa`.
- **Già pronto:**
  - `src/platform/holidays.ts` — festività italiane calcolate (Pasqua e Pasquetta comprese),
    `isWeekend`, `isHoliday`, `isBookable`, santo patrono da preferenze (`patron_month`/`patron_day`);
  - `user_preferences.minutes_per_day` (60–720) — le ore per giorno delle conversioni;
  - la cassaforte delle credenziali e il motore di sincronizzazione (`saveConnection`,
    `readCredentials`, `recordRun`/`finishRun`/`skipRun`, `saveSyncJob`, `markConnection`,
    `listRuns`), con `PROVIDERS = ["wallet"]` e `SYNC_KINDS = ["accounts", "transactions"]` da
    estendere;
  - Settings › Integrations con la card di un collegamento, «Sync now» e il registro dei passaggi;
  - **le ferie dai cedolini (F5)**: `leave_balance_snapshots` (per cedolino applicato e tipo
    `vacation|rol|permit`: A.P., maturato, goduto, residuo **in ore**, con l'evidenza dell'unità) e
    `payroll_leave_events` (ore per tipo, `payroll_period` e `usage_period` = mese del cedolino − 1);
  - i job (`JOBS` in `src/platform/jobs/registry.ts`), `forEachUser`, le notifiche, `job_runs`.
- **Assente:** qualunque tabella o schermata di ferie; nessun codice Trek nel branch.

## 3. Contratti decisi in anticipo

### 3.1 Collocazione

```
src/modules/timeoff/      schema.ts  rules.ts  service.ts  queries.ts  actions.ts  jobs.ts  ui/*
src/platform/integrations/trek/   client.ts (MCP + toggle puro)  sync.ts (passaggio)  mapping.ts
src/app/(app)/timeoff/page.tsx    la schermata Time off
```

Le ferie sono un modulo di dominio; Trek è un'integrazione di piattaforma, come Wallet. Il modulo
`timeoff` **legge i cedolini** attraverso funzioni di servizio di `payroll` (mai le sue tabelle):
la dipendenza va solo da `timeoff` a `payroll`, e `payroll` non sa che le ferie esistono.

### 3.2 Tabelle — una migrazione `0013_timeoff_trek.sql`

Colonne comuni come sempre (`id`, `user_id`, `created_at`, `updated_at`).

- **`timeoff_allowances`** (§6) — `year` (smallint), `vacation_days numeric(5,2)`,
  `rol_minutes integer`, `carried_days numeric(5,2)` (default 0), `note`. UNIQUE `(user_id, year)`.
  CHECK: anno 1990–2200, valori ≥ 0, `carried_days` ≤ 400.
- **`leave_days`** (§6) — una riga per giorno e tipo:
  `on date`, `kind` `vacation | rol | comp | sick | other`, `fraction numeric(2,1)` (1.0 o 0.5, solo
  per i tipi a giorni), `minutes integer` (solo per il ROL), `note`, `origin` `manual | trek`,
  `pending` `none | upsert | delete`, `synced_at`, `trek_fraction numeric(2,1)` e `trek_kind`
  (l'ultimo stato **osservato** su Trek: è ciò che rende sicuro un toggle di cancellazione).
  UNIQUE `(user_id, on, kind)`; indice `(user_id, on)` e indice parziale su `pending <> 'none'`.
  CHECK: `(kind = 'rol') = (minutes is not null)`, `(kind <> 'rol') = (fraction is not null)`,
  `fraction in (0.5, 1.0)`, `minutes between 1 and 1440`, `pending = 'delete'` ammesso solo con
  `origin = 'trek'` o `synced_at is not null` (non si chiede a Trek di cancellare ciò che non ha mai
  avuto).
- **`provider_links`** non riceve nuove righe: la chiave di un giorno su Trek è la **data**
  (`vacay_entries` è unico per utente+piano+data), quindi non serve conservare l'id numerico (§3.6.6).
- **Liste di piattaforma:** `PROVIDERS` guadagna `"trek"`, `SYNC_KINDS` guadagna `"leave"`
  (`src/platform/integrations/rules.ts`), e i CHECK che le elencano si aggiornano nella stessa
  migrazione.

### 3.3 Firme

```ts
// modules/timeoff/rules.ts — puro
minutesToDays(minutes, minutesPerDay): number
daysToMinutes(days, minutesPerDay): number
bookable(date, patron): { ok: true } | { ok: false; reason: "weekend" | "holiday" }
dayStatus(date, today): "taken" | "planned"                 // passato = goduto, futuro = pianificato
residual(input): ResidualView                               // §3.4.2, con la provenienza
monthBars(days, year, minutesPerDay): MonthBar[]            // le barre «By month» del design
calendar(year, days, holidays, weekStart): CalendarMonth[]  // le 12 griglie del design

// modules/timeoff/service.ts
saveAllowance(ctx, year, input) / allowanceOf(ctx, year)
saveLeaveDay(ctx, input)        // un giorno o un intervallo: rifiuta weekend e festivi
deleteLeaveDay(ctx, id)         // marca `pending=delete` se Trek lo conosce, altrimenti cancella
listLeaveDays(ctx, { from, to })
markSynced(ctx, ids, observed)  // esito di un passaggio: `pending=none`, `trek_*` osservati

// modules/payroll/service.ts (nuove, lette da timeoff)
leaveSnapshotsOf(ctx, year): LeaveSnapshot[]   // istantanee dei cedolini applicati
leaveEventsOf(ctx, year): LeaveEvent[]         // eventi per mese di utilizzo

// platform/integrations/trek/client.ts
planToggles(current, desired, removals): TogglePlan          // puro, il cuore della sicurezza
getEntries(year, opts) / getStats(year, opts) / toggleEntry(step, opts)

// platform/integrations/trek/sync.ts
syncTrek(ctx, { year, trigger }): TrekSyncResult             // scrive, poi rilegge (§3.4.7)
syncTrekNow(ctx)                                             // «Sync now» e il passaggio immediato
```

### 3.4 Regole sottili, decise qui una volta sola

1. **Prenotabilità** (§7.9): weekend e festivi non si prenotano — festività italiane calcolate più il
   santo patrono delle preferenze. Il rifiuto è un esito di dominio (`weekend` / `holiday`), non un
   errore generico, e la modale lo dice sul campo data.
2. **Residuo, con la provenienza** (§7.9, la regola vincolante):
   - se esiste un'istantanea da cedolino per il tipo: `RES. (ore)` dell'ultimo cedolino applicato
     **meno** le giornate successive al mese di utilizzo che quel cedolino copre (godute + pianificate),
     convertite con le ore per giorno; la card dice «Residuo esposto nel cedolino di ‹mese›; utilizzi
     contabilizzati fino a ‹mese − 1›»;
   - altrimenti: `dotazione + riportati − godute − pianificate`.
   Le due formule non si mescolano mai e l'interfaccia dice sempre quale ha usato.
3. **Stato derivato** (§7.9): passato = goduto, futuro = pianificato. Non è una colonna: oggi cambia
   da solo. «Oggi» è la data reale nel fuso dell'utente (§8.4.6).
4. **ROL in minuti**, ferie e recuperi in giornate (1 o 0,5). La conversione usa
   `minutes_per_day` delle preferenze; nessun «8 ore» scritto nel codice.
5. **Gli eventi da cedolino sono mensili**, non giornalieri (F5: ore per `usage_period`): compaiono
   nella tabella come righe di mese con origine `payroll`, sola lettura, e **non** sono righe di
   `leave_days` (§3.6.1). Non si sommano al residuo quando il residuo viene dall'istantanea: sono la
   stessa cosa vista due volte.
6. **Il ROL non va mai a Trek** (§9.2), né `sick` né `other`: Trek conosce solo `vacation` e `comp`.
7. **Un passaggio Trek**: prima si inviano le modifiche locali, poi si legge l'anno (§9.2 «Trek decide
   se un giorno esiste»):
   1. si legge l'anno (`get_vacay_entries`) per sapere che cosa c'è **ora**;
   2. `planToggles(current, desired, removals)` — puro — riduce al minimo insieme di toggle;
   3. ogni toggle si invia **una volta sola**, mai in cieco: un invio fallito o incerto lascia
      `pending` com'è e si riprova al passaggio dopo, **dopo aver riletto**;
   4. si rilegge l'anno e si riconcilia: ciò che Trek ha e noi no diventa una riga `origin='trek'`;
      ciò che noi abbiamo e Trek no torna `pending='upsert'`;
   5. `get_vacay_stats` **una volta per passaggio** (persiste il riporto come effetto collaterale:
      non è una lettura pura) e solo per mostrarlo come riscontro.
8. **Il toggle è il suo stesso inverso**: si cancella un giorno inviando la coppia
   (`fraction`, `kind`) **osservata** su Trek, non quella desiderata. Per questo `trek_fraction` e
   `trek_kind` stanno sulla riga: senza l'ultimo stato osservato una cancellazione può ricreare il
   giorno.
9. **Lo strumento delle festività aziendali non si chiama mai** (§9.2): cancella le voci di tutti.
10. **Salvare o togliere un giorno avvia subito un passaggio** in background (`after()`, come la
    lettura di un documento in F5), oltre al job orario; il collegamento si scrive al momento
    dell'invio; **scollegare Trek chiude le rimozioni in sospeso** (`pending='delete'` → la riga si
    cancella davvero, perché non c'è più nessuno a cui chiederlo).
11. **Esito del passaggio**: un passaggio in cui la lettura riesce ma un invio no è registrato
    `failed` (le due agende sono andate a divergere), **senza avviso**: alla cadenza oraria sarebbe
    rumore, e il badge di obsolescenza in Settings › Integrations è il segnale giusto (vecchio job,
    §0.5). Un utente senza collegamento Trek non scrive nessuna riga di `job_runs`.
12. **Concorrenza**: un solo passaggio per utente alla volta (lock di sessione come `wallet-sync`);
    «Sync now» mentre ne gira uno restituisce quello in corso, non ne apre un secondo.
13. **Dotazioni**: una riga per anno; l'anno senza riga usa quello precedente come proposta nella
    modale, mai come valore implicito nei conti (senza dotazione e senza istantanea il residuo è
    «—» con il motivo).

### 3.5 Test

- **Unitari** (`rules.ts`, `client.ts`): conversioni ore↔giorni, prenotabilità (weekend, festivo,
  patrono), stato passato/futuro, **residuo nelle due forme** e la scelta fra le due, barre per mese,
  celle del calendario (inizio settimana dalle preferenze), e `planToggles` esaustivo — i due casi
  «uguale» (toggle = cancella) e «già assente» (toggle = ricrea) sono quelli che devono restare no-op.
- **Integrazione**: dotazioni e giornate con isolamento fra utenti; ciclo di vita di `pending`
  (salvataggio → upsert → sincronizzato → cancellazione → delete → sparizione); riconciliazione di un
  anno con un **finto server MCP** (`fetch` sostituito): risposte SSE, payload a doppia codifica,
  sessione `Mcp-Session-Id`, 401 che rigenera la sessione una volta sola, toggle fallito che resta
  `pending`. Nessuna chiamata di rete vera.
- **Dati veri** (saltati senza `Payroll/`): il residuo calcolato dalle istantanee dei 12 cedolini
  coincide con quanto la specifica dei cedolini dichiara (`A.P. + MAT. − GOD. = RES.`), e il mese di
  utilizzo è quello del cedolino − 1.
- **E2E** sul sito, utente `timeoff@example.test`: dotazione, aggiunta di ferie e di ROL, rifiuto di
  un sabato e di un festivo, calendario e tabella, filtro pianificate/godute, 1440 px e 400 px. Trek
  resta **scollegato** negli e2e (non esiste un Trek di prova): la card mostra «Non collegato» e la
  pagina non tenta nessun passaggio.

### 3.6 Dove spec, design e realtà divergono — proposte

1. **`leave_days.origin` resta `manual | trek`**, senza `payroll` (§6 lo elencava): gli eventi da
   cedolino sono **mensili** (ore per mese di utilizzo), non giornalieri, e non possono essere righe
   di un giorno senza inventare una data. Compaiono nella tabella come righe di mese, con origine
   `payroll` nell'etichetta e sola lettura — che è quello che chiede §7.9.
2. **`trek_fraction` / `trek_kind` sulla riga** (non previsti da §6): senza l'ultimo stato osservato
   una cancellazione su Trek rischia di **ricreare** il giorno (§3.4.8).
3. **Il ROL resta fuori da Trek anche nella lettura**: se Trek mostrasse un `comp` che noi teniamo
   come ROL, vince la nostra classificazione e il giorno non si tocca; il caso si segnala in revisione
   invece di riscriverlo.
4. **Le statistiche di Trek non diventano numeri nostri**: si mostrano accanto ai nostri come
   riscontro («Trek dice: 26 giorni, 11 usati, 15 residui»), perché onorano una finestra di anno
   (solare/fiscale/anniversario) che l'app non modella e perché leggerle **persiste** il riporto.
5. **Mezze giornate**: Trek rappresenta la frazione, non *quale* metà. La nota è l'unico posto dove
   «mattina/pomeriggio» può stare, e resta locale.
6. **Nessuna riga in `provider_links`** per i giorni: la chiave è la data, e un id numerico in più
   sarebbe uno stato da tenere allineato senza guadagno (§3.2).
7. **Malattia e «altro»** non si prenotano nel futuro senza avviso: si possono registrare, ma la
   modale dice che non vanno a Trek e non consumano la dotazione ferie.
8. **Un giorno passato modificato a mano** si invia comunque a Trek (è un fatto, non un piano);
   quello che non si fa è dedurre cancellazioni dall'assenza: `removals` è sempre una lista esplicita.

## 4. Lotti

```
L0 schema ── L1 regole e servizio ── L2 schermata Time off ── L3 client Trek ── L4 passaggio, job e Settings ── L5 rifiniture, e2e, cancello
```

Ogni lotto: test prima, cancello (§5), deploy, e2e sul sito con utenti `@example.test`.

### L0 — Schema
Migrazione `0013`; `PROVIDERS` e `SYNC_KINDS` estesi (CHECK compresi); `timeoff_allowances` e
`leave_days` con i loro vincoli; voce di navigazione (`navigation.ts`, icona `calendar-days` in
`icons.ts`, gruppo «Work», visibile anche nel foglio More di mobile). **Test**: CHECK, unicità,
isolamento, e il test del registro delle rotte se esiste.

### L1 — Regole e servizio
`rules.ts` puro (conversioni, prenotabilità, stato, residuo nelle due forme, barre, calendario);
`service.ts` (dotazioni, giornate, intervalli, `pending`); le due letture nuove in `payroll/service.ts`.
**Test**: unitari delle regole (compreso il residuo dalle istantanee vere) e d'integrazione del
servizio.

### L2 — Schermata Time off
`/timeoff`: intestazione con anno e dotazioni, KPI Ferie e ROL con rimanente/goduto/pianificato e la
provenienza del residuo, barre per mese, calendario annuale con legenda, tabella con filtri, modale
«Add leave» (giorno o intervallo, tipo, frazione o ore, nota), modifica ed eliminazione. Messaggi in
`en.json` e `it.json`. **Test**: unitari dei componenti puri, e2e a 1440 e 400 px.

### L3 — Client Trek
`client.ts`: `planToggles` puro + trasporto MCP (initialize, `Mcp-Session-Id`,
`notifications/initialized`, SSE, payload a doppia codifica, `tools/call`), letture con ritentativi,
**scritture mai ritentate alla cieca**, una sola re-inizializzazione su 401/sessione rifiutata.
**Test**: `planToggles` esaustivo; trasporto contro un finto server MCP.

### L4 — Passaggio, job e Settings
`sync.ts` (scrivi → rileggi → riconcilia, lock, `sync_runs` e `sync_jobs`), job orario `trek-sync`,
passaggio immediato dopo un salvataggio, card Trek in Settings › Integrations (URL + token, «Sync
now», ultimo esito, scollega che chiude le rimozioni in sospeso). **Test**: integrazione con il finto
server (passaggio completo, invio fallito che resta pendente, riconciliazione, scollegamento).

### L5 — Rifiniture e cancello
Stati vuoti ed errori, accessibilità del calendario da tastiera, confronto con il design, e2e completi,
cancello, deploy, §8 del piano.

## 5. Cancello

```
npm run format && npm run lint && npm run typecheck && npm run format:check && npm test && npm run test:integration
docker compose build && docker compose up -d && curl -fsS https://dash.longobardo.me/api/health
npm run e2e
```
In più: `db:generate` → nessuna differenza; nessun dato personale nei file cambiati (`grep` prima di
ogni commit, come in F5 e F6).

## 6. Fatto quando

- §7.9 e §9.2 hanno codice e test; il residuo mostra sempre da dove viene; weekend e festivi non si
  prenotano; il ROL non compare mai in una richiesta verso Trek.
- Un giorno salvato nell'app arriva su Trek al passaggio successivo (o subito), un giorno tolto
  sparisce, e **nessun passaggio ripetuto cancella un giorno** — provato dal finto server e dai test
  di `planToggles`.
- La schermata Time off regge il confronto con il design a 1440 e a 400 px.

## 7. Resta al proprietario

- Confermare §3.6 (soprattutto 1, 2, 3 e 4).
- Collegare Trek in Settings › Integrations con un token statico `trek_…` che abbia il gruppo di
  scope `vacay` in scrittura (Trek → Settings → MCP tokens), e verificare **un passaggio vero** su
  un giorno inventato, poi toglierlo.
- I commit.

## 8. Esito

Fase implementata il 2026-09-20, lotti L0–L5 in un unico passaggio, con cancello e deploy dopo L2,
dopo L4 e alla fine. Distribuita su `https://dash.longobardo.me`; migrazione **`0015_timeoff_trek`**
applicata (non `0013`: il §2 del piano era fermo a `0012`, ma `0013` e `0014` erano già state scritte
da F6 e dalle preferenze).

### 8.1 Verifiche

- **Unitari 1125, integrazione 435, end-to-end 51/51** sul sito; `db:generate` → nessuna differenza;
  `format`, `lint`, `typecheck`, `format:check` puliti.
- **Nuovi test**: 34 unitari sulle regole (conversioni, prenotabilità, stato, residuo nelle due forme,
  barre, calendario), 13 sui componenti puri, 36 sul client Trek (`planToggles` esaustivo + finto
  server MCP), 8 d'integrazione sui CHECK dello schema, 26 sul servizio, 9 sulle due letture nuove di
  `payroll`, 23 sul passaggio Trek.
- **Accessibilità**: `/timeoff` e `/settings/integrations` superano axe (WCAG 2.1 A/AA) e i controlli
  di layout a **1440 px e 400 px**; entrambe aggiunte a `tests/e2e/a11y.spec.ts`.
- **Controllo a video** su `/timeoff` e su Settings › Integrations con screenshot da una spec
  temporanea (non committata), come chiede la regola del proprietario.
- Nessun dato personale nei file cambiati (`grep` prima del commit: l'unico riscontro era il nome di
  battesimo del proprietario in una fixture del client Trek, sostituito con «Test Person»).

### 8.2 Difetti trovati facendo girare le cose, non leggendole

1. **Il ROL arrotondato a mezza giornata** (trovato aprendo la pagina, non dai test). Il residuo
   passava per i *giorni*: 3,5 h di ROL su una giornata da 8 h sono 0,4375 di giornata, arrotondate a
   0,5 e ritrasformate in 4 h — e «28,5 h rimanenti» diventava 28. Il residuo, le barre e il flag
   «mezza giornata» del calendario ora **lavorano in minuti**, e i giorni si ottengono dividendo (che
   per le giornate è esatto, perché sono intere o mezze in partenza). C'è un test di regressione.
2. **`SYNC_KINDS` allargato avrebbe fatto registrare al passaggio Wallet una corsa `leave` inesistente**:
   `wallet/sync.ts` iterava l'elenco globale. Aggiunta `KINDS_OF` (le specie *di ciascun* provider), e
   ogni motore itera le proprie.
3. **Contrasto insufficiente sulle mezze giornate** (axe): la diagonale passava sotto il numero, che
   restava per metà sul colore e per metà fuori. Ora il colore riempie la cella e la frazione è un
   **angolo tagliato** in alto a destra, lontano dalla cifra.
4. **La tabella non entrava in 400 px**: `overflow-x-auto` non bastava (una flex child cresce col
   contenuto), servivano `min-w-0` sulla card e due colonne che si tolgono di mezzo — la nota sparisce
   e lo stato passa sotto la data.
5. Tre test usavano `"trek"` come provider sconosciuto di comodo: F7 lo rende noto, e ora usano
   `"monzo"`.
6. `unit-dom` aveva un `testTimeout` di 5 s: sotto carico le interazioni `userEvent` più lunghe
   scadevano a intermittenza. Portato a 20 s (è tempo per lo scheduler, non per le asserzioni).

### 8.3 Scelte fatte in implementazione

1. **I totali stanno in minuti, ovunque.** `ResidualView` e `MonthBar` espongono minuti; giorni e ore
   si ricavano al bordo della presentazione. È la conseguenza del difetto 1: i minuti sono l'unità
   più fine, e convertire verso il basso non perde niente.
2. **Un giorno che Trek non può rappresentare non si indovina.** Trek tiene una riga per *data*, noi
   una per data *e tipo*: mezza giornata di ferie più mezza di recupero sullo stesso giorno non è
   esprimibile. `splitForTrek` la tiene fuori, la riga resta `pending` e la data è riportata fra i
   `conflicts` — mandarne una delle due significherebbe prenotare un giorno che la persona non ha
   chiesto. Il piano non prevedeva il caso; è il §3.6.3 applicato alla lettera.
3. **Il desiderato è l'anno intero, non solo il pendente.** Il diff confronta ogni giornata Trek-idonea
   con l'anno che Trek riporta: una giornata che Trek ha perso torna da sola al passaggio dopo, senza
   che nessuno debba accorgersene prima.
4. **La sessione MCP sta sull'istanza del client, non in una variabile di modulo** (come faceva il
   vecchio client): il job scorre gli utenti uno a uno, e una sessione aperta con il token di una
   persona non deve mai essere presentata per un'altra.
5. **La card Trek non riceve né token né URL.** Entrambi vivono nella colonna sigillata, che solo
   `readCredentials` apre e solo dentro una Server Action: sostituire il collegamento vuol dire
   indicarli di nuovo, ed è il prezzo onesto del non mandarli mai al browser.
6. **`Th` ha guadagnato `className`** (come `Td` già aveva), per la colonna che si toglie di mezzo a
   schermo stretto.
7. **L'anno e il filtro stanno nell'URL**, non nello stato del componente: la pagina è letta sul
   server comunque, e un anno che vale la pena guardare vale la pena linkarlo.
8. **Oggi è «goduto», non «pianificato»**: una giornata che si sta usando adesso si sta usando.
9. **Le statistiche di Trek stanno sul `cursor` di `sync_jobs`** (§3.6.4): il passaggio le legge una
   volta e le scrive lì, e la schermata le mostra accanto alle nostre («Trek dice: 29 giorni, 11
   usati, 18 residui») senza aprire un collegamento per conto suo. Restano di Trek ed etichettate
   come tali: onorano una finestra di anno che l'app non modella. Se l'ultimo passaggio non copriva
   l'anno mostrato, non si mostra niente — meglio nulla di un numero di un altro anno.

### 8.4 §3.6 — che cosa è stato confermato

Tutte e otto le proposte sono state implementate come scritte. In più il §8.3.2 sopra: il caso di due
tipi Trek-idonei sullo stesso giorno, che il §3.6.3 non nominava.

### 8.5 Resta al proprietario

- **Collegare Trek** in Settings › Integrations (indirizzo + token statico `trek_…` con il gruppo di
  scope `vacay` in scrittura) e provare **un passaggio vero** su un giorno inventato, poi toglierlo.
  Finché non è collegato la card dice «Non collegato» e nessun passaggio viene tentato — che è
  esattamente come girano gli e2e.
- Confermare le scelte del §8.3 (soprattutto 1 e 2).
- I commit.


## 9. Secondo giro (2026-09-21) — richieste del proprietario

Quattro richieste, dopo aver visto la fase 7 in funzione. Lotti M0–M4, con cancello e deploy alla
fine. Migrazione **`0016_holiday_calendars`**.

### 9.1 M0 — Trek passa a OAuth 2.1

Trek ha smesso di accettare il token statico: in produzione la connessione era già `revoked`. La
ricognizione sulla sua istanza (è nello stack: `travel/docker-compose.yml`, wiki in
`/app/wiki/MCP-Setup.md`) ha trovato tre modi di autenticarsi, e uno solo adatto a noi:

- **machine client** (`grant_type=client_credentials`), che Trek documenta proprio «for AI agents
  and scripts». Il token «acts as its owner» — l'utente che ha creato il client — ristretto agli
  scope scelti lì. Un'ora di vita, **nessun refresh token**, nessuna rotazione.
- Il flusso col browser (`authorization_code` + PKCE) è quello giusto per un client interattivo e
  quello sbagliato per noi: il passaggio gira da un job orario, e alle 07 di ogni ora non c'è
  nessuno davanti a una schermata di consenso.

Quindi la credenziale sigillata non è più `{baseUrl, token}` ma **`{baseUrl, clientId, clientSecret}`**,
e il client chiede un token a `POST {baseUrl}/oauth/token` con scope `vacay:read vacay:write` e
`resource={baseUrl}/mcp`, lo tiene per la sua ora (meno un minuto di margine) e ne chiede un altro
quando `/mcp` risponde 401 — una volta sola.

Due sensi diversi di «credenziale rifiutata», tenuti distinti perché si comportano in modo opposto:
`token_rejected` (401 da `/mcp`: il bearer è scaduto → se ne prende un altro e si riprova) e
`client_rejected` (il token endpoint rifiuta il machine client → non si riprova affatto, perché un
segreto sbagliato non diventa giusto se lo si rimanda).

### 9.2 M1 — Il calendario si clicca, il tasto non c'è più

«Add leave» è sparito dalla topbar. Ogni giorno su cui può succedere qualcosa — un giorno feriale
libero, o uno che porta già una giornata — è un vero `<button>`: il primo apre la modale già sulla
data, il secondo la apre in modifica. Sabati, domeniche e festivi **non** sono pulsanti, perché non
si possono prenotare: gli elementi interattivi del calendario sono esattamente i giorni su cui si
può agire.

Da tastiera: **una tabulazione per mese**, poi le frecce camminano sui giorni (e solo su quelli che
fanno qualcosa), Home e End vanno al primo e all'ultimo. Dodici fermate invece di trecentosessantacinque.
Le celle sono passate da 22 a 24 px, perché un bersaglio da premere sotto i 24 px è un difetto che
il controllo di layout degli e2e rifiuta — giustamente.

### 9.3 M2 — Avvisi: giornate godute che non risultano

`unrecordedLeave` confronta, mese per mese, le ore che il cedolino dichiara usate con quello che le
giornate segnate valgono. Dove il cedolino conta di più compare un avviso in cima alla schermata.
Solo in quella direzione: più segnate che sul cedolino è lo stato normale di un mese il cui cedolino
non è ancora arrivato, e avvisare lì griderebbe al lupo ogni mese. Un `permit` del payroll conta
come ROL, che è il tipo con cui viene confermato (F5).

### 9.4 M3 — Calendari delle festività, online

`platform/holidays.ts` è diventato `platform/holidays/` con tabelle, fonti, servizio e job.

- **Due fonti**, scelte dopo averle provate dal vivo: **OpenHolidays** (~30 paesi europei) nomina
  paese, regione **e provincia**, e porta le feste locali — `IT-LO-MI` restituisce davvero
  Sant'Ambrogio il 7 dicembre, che è esattamente la «città» che si intende quando la si chiede.
  **Nager.Date** (~110 paesi) copre il resto del mondo, ma solo a livello nazionale. Dove arrivano
  entrambe vince la più fine.
- **Più calendari per persona** (fino a 10), anche di paesi diversi da quello di residenza.
- **`holiday_days` è una cache, non un calcolo**: un giorno festivo è un fatto di qualcun altro e si
  sposta. Un aggiornamento **sostituisce** l'anno, così una festa ritirata se ne può andare davvero;
  una fonte che fallisce **non scrive niente**, perché un anno vuoto renderebbe Natale prenotabile.
- Job giornaliero `holidays-refresh`, quest'anno e il prossimo (le ferie si prenotano in anticipo).
- **Una regola sola**, dicibile a voce: valgono i calendari sottoscritti; chi non ne ha nessuno
  ricade sulle festività italiane calcolate più il patrono delle preferenze. Chi *ha* sottoscritto
  calendari e non ha ancora ricevuto niente non ricade su niente: indovinare l'Italia per chi ha
  scelto il Giappone rifiuterebbe i giorni sbagliati.
- `bookable()` e `calendar()` non prendono più il patrono ma **un insieme di date**: quando una
  regola pura decide di una data, la domanda è solo «c'è dentro».

### 9.5 Verifiche

- **Unitari 1155, integrazione 457, end-to-end 52/52** sul sito; `format`, `lint`, `typecheck`,
  `format:check` puliti; `db:generate` → nessuna differenza.
- Axe (WCAG 2.1 A/AA) e i controlli di layout su `/timeoff` e `/settings/integrations` a **1440 e
  400 px**: puliti. Le celle del calendario sono passate a 24 px proprio perché ora si premono.
- Nuovi test: 7 sul grant OAuth di Trek, 4 sul calendario cliccabile, 7 sugli avvisi, 22 sulle due
  fonti (con `fetch` finto), 17 d'integrazione sui calendari.
- Le due API sono state interrogate dal vivo dal container prima di scrivere una riga, per sapere
  che cosa rispondono davvero invece di fidarsi della documentazione.
- Un e2e nuovo (`tests/e2e/holidays.spec.ts`) fa il giro vero: Italia → Lombardy · Milan → i giorni
  arrivano da OpenHolidays → il **7 dicembre smette di essere prenotabile** su `/timeoff` → tolto il
  calendario, torna com'era. Quel test **chiama davvero** openholidaysapi.org: «aggiornati online» è
  il requisito, e un test con la fonte finta proverebbe solo che la finta funziona.

### 9.6 Due difetti che solo lo schermo poteva trovare

Entrambi sul confine fra Server e Client Component — invisibili a `typecheck`, a `lint` e a 1155
test unitari, perché vitest non impone quel confine. La pagina rispondeva 500 e basta.

1. **`weekdayInitials()` e `KIND_CLASS` esportati da un file `"use client"`** e chiamati dalla
   pagina, che rende sul server: «Attempted to call weekdayInitials() from the server». Sono valori
   puri e ora stanno in `ui/kinds.ts`, che non è né l'uno né l'altro.
2. **Funzioni passate come prop a un componente client** (`labelFor`, `emptyLabelFor`): non si può.
   Le etichette se le costruisce il calendario, che è client e ha già `useTranslations` e
   `useLocale` — ed è anche il posto giusto, visto che è lui a disegnarle.

La morale è quella della fase precedente, di nuovo: il cancello verde dice che il codice compila e
che i test passano, non che la pagina si apre.


## 10. Terzo giro (2026-09-21) — richieste del proprietario

Otto richieste, arrivate mentre la fase girava. Lotti N0–N7, con cancello e deploy alla fine.
Migrazione **`0017_rol_in_days`**. Due agenti in parallelo su pezzi separati (Trek e i test), il
resto in sequenza.

### 10.1 N0 — Il ROL si prenota a mezza o intera giornata

`leave_days.minutes` **non esiste più**: ogni tipo ha `fraction` NOT NULL, 0.5 o 1.0. Nessuno
prenota le ferie al minuto, e due unità che convivevano erano la causa del difetto del giro
precedente. La migrazione converte le righe esistenti con la giornata lavorativa *di quella
persona* (`minutes_per_day`), con 480 come ripiego per chi non ha preferenze, **prima** di rendere
la colonna obbligatoria.

I totali restano in minuti, perché il cedolino dà le ore e la dotazione i giorni: i minuti sono la
più fine delle due, e convertire verso il basso non perde niente.

### 10.2 N1 — Il riporto vale per entrambi

`carried_rol_minutes` nuova colonna. Il residuo ROL somma il riporto esattamente come fa quello
delle ferie; prima era fisso a zero, e per chi aveva ore avanzate dall'anno prima il residuo usciva
semplicemente troppo piccolo. **Quando il residuo viene dal cedolino il riporto non si somma**: il
RES. stampato è già `A.P. + MAT. − GOD.`, e sommarlo lo conterebbe due volte.

### 10.3 N2 — «Goduto» lo decide il cedolino, non il calendario

`dayStatus` non guarda più «oggi» ma fino a che mese i cedolini applicati hanno contabilizzato. Una
giornata è **goduta** quando l'azienda l'ha contata; tutto il resto — il futuro *e* i giorni di un
mese il cui cedolino non è arrivato — è **pianificato**. Senza nessun cedolino, niente è goduto: che
è la cosa giusta da dire a chi i numeri dell'azienda non li ha mai dati all'app.

Di conseguenza il residuo dal cedolino è `RES. − pianificati`, che è esattamente la vecchia formula
detta meglio.

### 10.4 N3 — Il calendario si usa a clic

Un clic su un giorno libero lo fa ferie; un altro lo fa ROL; il tasto destro (o Canc da tastiera) lo
toglie. La decisione la prende il **server** da quello che è scritto, non il browser da quello che
ha disegnato: due clic di seguito si mettono in fila invece di litigare. Un giorno che porta
qualcos'altro — malattia, recupero, due mezze giornate — apre la modale invece di essere
sovrascritto: una scorciatoia non deve mai buttare via qualcosa che qualcuno ha detto apposta.
Clic con Alt o Maiusc apre comunque la modale: è la via per la mezza giornata. Una dicitura sopra il
calendario dice tutto questo in una riga.

### 10.5 N4 — Su Trek va tutto come vacanza

Trek non ha i ROL, e un giorno che su Trek non c'è per un collega è un giorno in cui sei al lavoro.
Quindi ferie, ROL e recuperi partono tutti come `vacation`, e le frazioni della stessa data si
**sommano** (tetto a una giornata): mezza giornata di ferie più mezza di ROL diventano una giornata
intera invece del conflitto irrisolvibile del giro prima. Localmente il ROL resta un ROL.

### 10.6 N5 / N5b / N7 — Quello che la schermata dice adesso

- Una **card in più**: le giornate prese nell'anno, tutti i tipi insieme, con la separazione fra
  contabilizzate e pianificate, la ripartizione per tipo e — se c'è — il totale concesso.
- Il **ROL è in giorni** ovunque: intestazione, card, tabella. Una sola unità sullo schermo.
- Un **avviso quando si sfora**: se le giornate segnate superano il residuo, misurato contro lo
  stesso numero che la card ha usato, così l'avviso e la card non possono mai dire cose diverse.
- Un'**impostazione dei giorni totali concessi** (ferie + ROL). Se le due parti non tornano col
  totale, lo si dice: sono due cifre copiate da un contratto, e quale delle due sia sbagliata non
  tocca all'app deciderlo.
- La **tabella è raggruppata per mesi**: l'intestazione del mese dice quanto il cedolino conta,
  quanto risulta segnato, quanto è pianificato e quanto manca. Le righe-mese del cedolino sono
  sparite dal corpo: stavano meglio nell'intestazione del mese di cui parlano, accanto a quello che
  contraddicono.

### 10.7 Difetti trovati leggendo il codice di Trek, non il nostro

Trek è nello stack, quindi `vacay.service.ts` e il suo database si possono leggere. Due cose che
nessun test avrebbe trovato:

1. **`get_vacay_entries` risponde per il PIANO, non per chi chiama.** Su un piano condiviso
   restituisce anche le ferie dei colleghi, e adottarle avrebbe scritto i loro giorni sulla
   dotazione del proprietario. Ora il client chiede a `/oauth/userinfo` di chi è il token e tiene
   solo le sue. Se Trek non lo dice, non filtra: un filtro che non sa di chi è il giorno non deve
   decidere che non è di nessuno.
2. **La finestra dell'anno non è l'anno solare.** È l'anno di ferie del visualizzatore, allineato
   al mese: con un anno fiscale o di anniversario tornano date dell'anno prima e dopo. Ora il client
   tiene solo le date dell'anno chiesto.

La frazione, invece, Trek la dà giusta (`REAL`, 0.5 o 1) e il client la leggeva già giusta: c'è ora
un test che lo fissa, perché è la cosa che il proprietario ha segnalato.

### 10.8 Verifiche

- **Unitari 1183, integrazione 469, end-to-end 52/52** sul sito; `format`, `lint`, `typecheck`,
  `format:check` puliti; `db:generate` → nessuna differenza.
- Axe e i controlli di layout su `/timeoff` a **1440 e 400 px**: puliti.
- Il difetto trovato a video, ancora una volta: la card nuova aveva rubato la chiave `cards.taken`
  alle altre due, che stampavano `timeoff.cards.taken` al posto di «0 d taken». Compilava, i test
  passavano, e la pagina lo diceva a voce alta.

## 11. Quarto giro (N8): il calendario dice la verità e si lascia usare

Tre richieste del proprietario, tutte e tre su quello che il calendario mostra o non mostra.

### 11.1 I giorni «planned» erano disegnati come quelli già contati

**Il difetto.** Un giorno pianificato e un giorno che una busta paga ha già contato erano lo stesso
rettangolo pieno. L'unica differenza era un bordo `--accent` di 1 px — e `--accent` e `--primary`
sono lo stesso teal `#0e7490`: invisibile, letteralmente. La distinzione che N2 aveva introdotto
nei numeri non esisteva nel disegno.

**Il rimedio.** Il pieno vuol dire *contato*, il vuoto vuol dire *ancora mio*:

- `KIND_BORDER` e `KIND_TEXT` in `ui/kinds.ts`, un colore per tipo (ferie teal, ROL ambra).
- Un giorno pianificato si disegna **cavo**: bordo di 2 px del suo tipo, numero dello stesso colore,
  nessun riempimento. Un giorno contato resta pieno, come prima.
- Una mezza giornata pianificata perde il triangolo d'angolo (non c'è riempimento su cui stare) e
  prende un cuneo in basso a sinistra, del colore del tipo.
- La legenda guadagna **Planned** (quadrato cavo) e **Counted** (quadrato pieno): la differenza è
  solo un disegno, quindi il disegno va detto a parole.
- La cella espone `data-status`, così il fatto è verificabile e non solo guardabile.

### 11.2 Cancellare richiedeva una seconda azione

**Il difetto.** `clear()` si difendeva con `if (!booked[date]) return;` — e `booked` è quello che ha
detto l'ultimo render del server. Un giorno prenotato un istante prima risultava vuoto al browser: il
tasto destro non faceva nulla, in silenzio, e il giorno spariva solo alla prossima azione qualsiasi.

**Il rimedio.** La guardia è sparita: il client chiede sempre al server, che è l'unico a sapere cosa
c'è davvero su quel giorno. `clearDayAction` risponde `{ removed, pending }`, e il toast distingue
«tolto» da «in attesa che Trek lo confermi» invece di tacere. Un test lo fissa come regressione.

### 11.3 Tenere premuto fa mezza giornata

La misura che si cambia più spesso era l'unica che costringeva ad aprire un dialogo.

- `halveDay(ctx, date)`: una giornata intera di ferie o ROL diventa mezza, mezza torna intera.
  Rifiuta (`not_cyclable`) tutto ciò che il click già rifiuta — malattia, recupero, un giorno già
  diviso fra due tipi — perché una scorciatoia non deve mai riscrivere ciò che qualcuno ha dichiarato.
- Conserva `trekFraction`/`trekKind` osservati e rimette `pending: 'upsert'`: Trek deve sapere che la
  misura è cambiata, e una cancellazione futura ha ancora bisogno di sapere cosa Trek teneva.
- `HOLD_MS = 450` nel client, con `endPress` (tiene il segno, se il tempo è scattato) distinto da
  `cancelPress` (dimentica): lasciare andare dopo un hold **non** deve anche far avanzare il tipo.
  Era un bug vero, trovato dal test prima che dallo schermo.
- La didascalia dice ora tutte e quattro le gesture in una frase sola.

### 11.4 Verifiche

- **Unitari 1188, integrazione 480, end-to-end 52/52** sul sito; `format`, `lint`, `typecheck`,
  `format:check` puliti; `db:generate` → nessuna differenza. Nessuna migrazione nuova: il quarto
  giro non tocca lo schema.
- Axe e i controlli di layout su `/timeoff` a **1440 e 400 px**: puliti.
- A video, sul sito: i giorni pianificati sono cavi e leggibili accanto alle festività grigie, il
  cuneo della mezza giornata si vede, e il tasto destro toglie il giorno al primo colpo.

## 12. Quinto giro (N9): la dotazione dice meno, l'avviso dice meglio

Tre richieste del proprietario, tutte e tre su **chi** dice un numero.

### 12.1 Il riporto dell'anno prima non si chiede più

**Il difetto.** La dotazione aveva due campi — «Carried over from last year» e «ROL carried over
from last year» — per una cosa che il cedolino stampa già: la colonna **A.P.**. Due risposte alla
stessa domanda, che potevano non coincidere e senza un modo per sapere quale fosse quella giusta.

**Il rimedio.** Le colonne `carried_days` e `carried_rol_minutes` spariscono (migrazione 0019), e
il riporto arriva da `leaveSnapshotsOf().previousYearHours`, cedolino per tipo, il più recente che
lo dichiari — una rettifica ristampa A.P. come ristampa tutto il resto. Le due regole di prima
restano intatte: su base cedolino **non** si somma (è già dentro al RES., A.P. + MAT. − GOD. =
RES.), su base dotazione sì. Senza cedolini il riporto è `0` e non un numero di nostra invenzione.

### 12.2 Anche i ROL si dichiarano in giorni

`rol_minutes` diventa `rol_days` (migrazione 0018, con la conversione fatta sulla giornata
lavorativa di ciascun utente). Il contratto parla di ore, ma tutta la schermata conta in giorni da
N5: un campo nell'unica unità che nient'altro usa è un campo che la gente converte a mente e
sbaglia. `allowanceMismatchDays` non ha più bisogno della giornata lavorativa per confrontare le
parti con il totale: ora sono tre numeri nella stessa unità.

### 12.3 L'avviso aspetta che i giorni siano maturati

**Il difetto.** Il RES. di un cedolino è il saldo **a quel mese**. Due settimane prenotate ad agosto
venivano misurate contro il saldo di febbraio, che di quei sei mesi di lavoro non sa nulla: l'avviso
scattava per una cosa che non era vera. Gli avvisi sbagliati sono il modo in cui una schermata
insegna a ignorarla.

**Il rimedio.** Le ferie maturano lavorando: ogni giorno lavorativo — anche quello passato in ferie
o in ROL — aggiunge `dotazione dell'anno ÷ giorni lavorativi dell'anno`. `workingDaysOf(anno,
festività)` è il denominatore, ed è lo stesso calendario contro cui si prenota un giorno, così i due
conti non possono divergere. I giorni pianificati vengono percorsi in ordine di data, ciascuno
contro ciò che è maturato **alla sua data**, e l'avviso riporta lo scarto peggiore e il giorno in
cui capita: «2 g in più di quanto avrai maturato entro il 18 dicembre» dice quali giorni spostare,
«sei di 2 g» no.

Due vincoli, entrambi deliberati:

1. **La maturazione può solo assolvere, mai accusare.** Se il residuo piano è ancora positivo non
   si dice nulla, comunque siano ordinati i giorni: anticipare le ferie è cosa che i datori
   concedono, e lamentarsene sarebbe un avviso nuovo che nessuno ha chiesto.
2. **Il mese del cedolino non si conta due volte.** Il RES. di marzo ha già dentro il MAT. di marzo,
   quindi si matura solo dai mesi successivi. È l'unico modo in cui questo calcolo potrebbe
   regalare giorni che non esistono.

Senza una dotazione dichiarata non c'è rateo, e l'avviso resta quello di prima — cifra di fine
anno, nessun giorno da nominare. Un rateo dedotto dal saldo di un cedolino sarebbe un numero
inventato da noi messo sotto un avviso sulle ferie di qualcuno.

### 12.4 Verifiche

- `src/modules/timeoff/queries.itest.ts`, nuovo: su un cedolino vero (il gemello di marzo 2031,
  A.P. 5 h ferie e 10 h ROL) il riporto arriva dall'A.P., non viene sommato due volte al RES., e le
  stesse dieci giornate tacciono a dicembre e fanno scattare l'avviso ad aprile.

## 13. Sesto giro (N10): mezza giornata di ferie e mezza di ROL

Il gesto che mancava. Un clic parla di un tipo alla volta — ferie, poi ROL, poi ferie — e la forma
più comune che un clic non raggiunge è la giornata divisa: una mattina di ROL e un pomeriggio di
ferie. Finora richiedeva due passaggi dal dialogo.

**Ora:** tasto destro **tenuto premuto** → mezza giornata di ferie e mezza di ROL; tenuto ancora →
di nuovo una giornata intera di ferie. Un gesto che non si disfa da sé è un gesto che nessuno prova.

`splitDay` rifiuta quello che rifiutano gli altri due (malattia, recupero, qualunque cosa un
dialogo abbia dichiarato, un giorno non lavorativo) e conserva la nota e — per la metà di ferie —
quello che Trek era stato osservato tenere: senza la coppia osservata un toggle ricrea il giorno
che voleva togliere. La metà di ROL è riga nuova e non rivendica nulla di Trek.

**La parte difficile era il browser.** `contextmenu` arriva all'andata sotto X11 e macOS, al
ritorno sotto Windows, e la durata della pressione si conosce solo al ritorno. Quindi: il tasto
destro decide su `pointerup`, `contextmenu` fa solo `preventDefault` e cede il passo se una
pressione è in corso o se il giorno è già stato trattato da meno di mezzo secondo. Un test unitario
fissa i due ordini e che in nessuno dei due il giorno venga tolto due volte.

**E una cosa vista solo a schermo.** Una giornata divisa *pianificata* veniva disegnata esattamente
come una di sole ferie: la cella cava non ha riempimento in cui l'angolo del secondo tipo possa
tagliare, e quel secondo tipo non si vedeva affatto. Ora il secondo tipo ha un angolo suo. I test
passavano tutti, e la pagina mostrava un gesto intero reso invisibile.

### 13.1 Verifiche

- **Unitari 1199, integrazione 491, end-to-end 52/52** sul sito; `format`, `lint`, `typecheck`,
  `format:check` puliti; `db:generate` → nessuna differenza oltre alle migrazioni 0018 e 0019.
- Axe e i controlli di layout su `/timeoff` a **1440 e 400 px**: puliti.
- A schermo: la dotazione chiede ferie, ROL e totale in giorni e nient'altro; il 6 marzo diviso si
  distingue dal 5 marzo di sole ferie.

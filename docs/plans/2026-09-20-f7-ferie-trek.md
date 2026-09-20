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

*(da scrivere a fine fase.)*

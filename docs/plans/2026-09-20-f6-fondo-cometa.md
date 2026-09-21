# F6 — Fondo Cometa

> Piano eseguito **in linea**, lotto dopo lotto, come F3–F5. Chi lo riprende in mano non ha il
> contesto della sessione che l'ha scritto: qui dentro c'è tutto quello che serve.

## 0. Come si legge

1. `CLAUDE.md` alla radice — convenzioni vincolanti.
2. `docs/specs/2026-09-13-dev-0.1-design.md` — **§7.7 parte pensione** (vincolante), §6 (tabelle dei
   fondi pensione), §7.8 "Applicazione" (i sink verso i fondi), §8.4.7 ("Paid in", niente "+∞ %"),
   §9.3 (pipeline), §11 (fixture reali e gemelli), §12.
3. **`Fondo Cometa/COMETA-guida-e-specifiche-financial-dashboard.md`** — la guida del proprietario
   (438 righe, locale, mai committata). Il piano la cita come `GC §…`. Si implementano §§1–6 e §§8–13
   (spec §7.7); §9.4 (XIRR, TWR) è facoltativa ed è fuori da F6 (§3.6.8).
4. `docs/plans/2026-09-19-f4-interessi-pac.md` §8 (fondi, conto di valorizzazione, schede di Fund
   detail) e `docs/plans/2026-09-19-f5-importazioni-payroll.md` §8 (pipeline dei documenti, evidenze,
   cedolini, codici).
5. Il design (`UI Recreation and branding decisions/Finance Dashboard.dc.html`, sola lettura): Funds
   460–495, Fund detail pensione 495–600 (Overview, "Contributions", "Why the numbers differ",
   "Accrued in payslips", "Employer transfers", "Add a voluntary contribution"), dati e testi
   1304–1316 (`COMETA_PAYSLIP`, `COMETA_OPS`, `COMETA_QUARTERS`, righe del raccordo). Dove il design
   contraddice la guida vale la guida (§3.6).

## 1. Obiettivo

F6 secondo §12: **la parte pensione di §7.7 — competenze, importazioni, riconciliazione, metriche,
interfaccia** — sul fondo Cometa, con le sei grandezze della GC §1 sempre distinte: maturato nei
cedolini, accreditato al fondo, investito in quote, valore alla sua data, guadagno dopo i costi
osservabili, importo ancora da riconciliare con la sua scadenza.

Fuori perimetro: XIRR/TWR e rendimento del comparto (GC §9.4, facoltativi), simulatori di
prestazioni e anticipazioni (GC §7), ferie e Trek (F7), `/api/v1/imports` (F8), altri fondi pensione
diversi da Cometa (il modello li permette, i parser no).

## 2. Punto di partenza (2026-09-20)

- Branch `dev-0.1` con F5 committata (`b4a6613`). Ultima migrazione `0011`.
- **Già pronto:** `funds.type` accetta `pension` (F4 crea solo `pac`); `balance_entries.source` ha
  `import`; `accounts.type` ha `pension`; la pipeline documenti (F5) ha già i tipi
  `cometa_operations` e `cometa_position`, riconosce la tabella HTML mascherata da `.xls` (§9.3) e
  salva gli originali sotto `cometa/<userId>/…`; evidenze con pagina e riquadro, revisione, stati,
  job di sicurezza; il viewer PDF; i cedolini applicati con righe grezze, campi e mappa dei codici
  (7101, 9109, 8003, 7052/7053, 8054/8056, 9110, 7897 già con il loro ruolo).
- **I documenti veri** in `Fondo Cometa/` (locali): `DettaglioOperazioni.xls` — una tabella HTML di 16
  colonne (Tipo Operazione, Stato Operazione, Data Operazione, Trimestre Comp. "2026 SECONDO", codice
  fiscale e nome dell'azienda, Importo Lordo Aderente/Azienda, Tfr, Altro, Quota Spese, Importo Netto
  Spese, Comparto, Numero Quote, Valore Quota, Data Valore Quota), una riga per operazione e
  comparto; `riepilogo_posizione.pdf` — una pagina con etichetta a sinistra e importo a destra sulla
  stessa riga (valore alla data, TFR, Aderente, Azienda, Trasferimento, Totale entrate, Anticipi,
  Riscatti, Rate R.I.T.A., Totale uscite, Rendimento).
- I 12 cedolini e i due documenti Cometa sono tutti i dati della GC §8: i test sui dati veri li
  leggono da lì, e i valori attesi **dalla guida a runtime** (come in F5; nessun importo nel repo).

## 3. Contratti decisi in anticipo

### 3.1 Collocazione

```
src/modules/funds/        schema.ts (+ tabelle pensione)  pension/rules.ts  pension/service.ts
                          pension/queries.ts  pension/reconcile.ts  pension/metrics.ts
                          parse/cometa-operations.ts  parse/cometa-position.ts  ui/pension-*.tsx
src/modules/payroll/      pension.ts   competenze da un cedolino applicato (i dati sono di payroll)
src/app/(app)/funds/[id]/ schede pensione (Overview, Contributions, Valuations, Settings)
src/app/(app)/funds/[id]/documents/[docId]/   revisione di un documento Cometa
```

La pensione sta nel modulo `funds` (spec §6 la elenca lì). Le competenze nascono in `payroll` (che
possiede i campi del cedolino) e **si consegnano** a `funds` con una funzione di servizio, dentro la
transazione di applicazione: la dipendenza va solo da `payroll` a `funds`, mai al contrario.

### 3.2 Tabelle — una migrazione `0012_pension_cometa.sql`

Colonne comuni come sempre. Importi `bigint` in centesimi; quote `numeric(18,6)`, valore quota
`numeric(14,6)` (GC §10: precisioni distinte, mai float).

- **`funds`** (modifica) — `receives_payroll boolean` (un solo fondo pensione per utente, indice
  unico parziale): il fondo a cui vanno le competenze dei cedolini (§3.6.2).
- **`pension_rules`** (§6, GC §3.2, §4) — `fund_id`, `kind` `contribution | payment_schedule`,
  `valid_from`, `valid_to`, `ccnl`, `base` (testo), `worker_pct`, `employer_pct`, `tfr_pct`
  (`numeric(6,4)` null), `schedule jsonb` (per `payment_schedule`: `[{quarter, month, day,
  next_year}]`), `tolerance_days` (default 15), `source`, `verified_on`. Seminata alla creazione del
  fondo con la scadenza Cometa (20/4, 20/7, 20/10, 20/1 dell'anno dopo).
- **`pension_competences`** (§6, GC §8.2) — una riga per cedolino applicato: `fund_id`,
  `payslip_id` (UNIQUE), `payroll_period` (null per la 13ª), `payslip_type`, `year`,
  `quarter` (1–4; la 13ª va nel IV), `worker_cents`, `employer_cents`, `tfr_cents`,
  `worker_enrollment_cents`, `employer_enrollment_cents`, `worker_adjustment_cents`,
  `employer_adjustment_cents` (segno conservato, tutti null quando la voce manca), `source_line_ids
  uuid[]`. Nessuna FK verso `payslips` (modulo diverso): la coerenza la tiene il sink.
- **`fund_operations`** (§6, GC §8.4, §10) — `fund_id`, `document_id` null (import o manuale),
  `origin_key` (impronta per la deduplica fra export, §3.4.4), `original_type`, `classification`
  `contribution | enrollment | voluntary | transfer_in | switch | withdrawal | other`,
  `original_state`, `competence_year`, `competence_quarter`, `operation_date`,
  `worker_cents`, `employer_cents`, `tfr_cents`, `other_cents`, `fees_cents`, `net_cents`,
  `employer_tax_code` (dell'azienda, non personale), `transaction_id` null (versamento volontario
  collegato a un movimento, come i PAC), `source` `import | manual`.
- **`unit_movements`** (§6) — `operation_id`, `compartment`, `units`, `unit_price`,
  `unit_price_date`. Più movimenti per operazione: gli importi di testata non si ripetono.
- **`position_snapshots`** (§6, GC §8.5) — `fund_id`, `document_id` null, `valuation_date`,
  `value_cents`, `tfr_cents`, `worker_cents`, `employer_cents`, `transfers_in_cents`,
  `inflows_cents`, `advances_cents`, `redemptions_cents`, `rita_cents`, `outflows_cents`,
  `reported_gain_cents`, `balance_entry_id` (il saldo `import` sul conto di valorizzazione: il valore
  ha una sola fonte, come in F4). UNIQUE `(fund_id, valuation_date)`.
- **`reconciliation_links`** (§6, GC §10–11) — `fund_id`, `year`, `quarter`, `component`
  `worker | employer | tfr | enrollment`, `competence_id` null, `operation_id` null,
  `allocated_cents`, più una riga di decisione per trimestre × componente: `decision`
  `accepted_difference | pending` , `difference_cents`, `note`, `decided_by`, `decided_at`.
  (Due tabelle se in L0 risulta più chiaro: `reconciliation_links` e `reconciliation_decisions`.)
- **`fund_fee_tariffs`** (§6, GC §6) — `provider`, `valid_from`, `valid_to`, `item`, `amount_cents` o
  `rate` (`numeric(8,6)`), `unit`, `note`, `source_url`. Dati pubblici della scheda costi Cometa, non
  personali: seminati dalla migrazione o dal seed del fondo. Solo per spiegare (§3.4.9).

### 3.3 Firme

```ts
// modules/payroll/pension.ts — dai campi di un cedolino applicato
pensionCompetenceOf(payslip, lines): CompetenceInput      // puro
// in applyPayslip / sostituzione: funds.recordCompetence(ctx, input, tx) / funds.dropCompetence(ctx, payslipId, tx)
appliedCompetences(ctx): CompetenceInput[]               // per ricostruire (§3.4.2)

// modules/funds/pension
createPensionFund(ctx, input)                            // conto di valorizzazione `pension`, regole seminate
recordCompetence(ctx, input, tx) / dropCompetence(ctx, payslipId, tx) / replaceCompetences(ctx, inputs)
parseCometaOperations(html | rows): ParsedOperation[]    // puro
parseCometaPosition(pages): ParsedPosition               // puro, con evidenze
importOperations(ctx, fundId, documentId) / importPosition(ctx, fundId, documentId)
reconcile(competences, operations, rules, freshness, today): QuarterStatus[]   // puro
decideDifference(ctx, fundId, year, quarter, component, note)
pensionMetrics(snapshot, operations, competences, statuses): PensionMetrics      // puro
addVoluntaryContribution(ctx, fundId, input)             // operazione `manual`, collegabile a un movimento
```

### 3.4 Regole sottili, decise qui una volta sola

1. **Sei grandezze** (GC §1), mai intercambiabili, ognuna con la sua etichetta e la sua data: maturato
   (competenze), accreditato (entrate lorde delle operazioni), investito (netto delle operazioni,
   quote), valore (ultimo snapshot, con la sua data — mai "oggi"), guadagno, da riconciliare (con la
   scadenza del trimestre).
2. **Competenze** (spec §7.7, GC §8.2–8.3) dai campi del cedolino applicato:
   lavoratore = 7101 + 8054 (effettivo, `employeeFundEffective`); azienda = 9109
   (`employerFundPrinted`); TFR = **solo la voce 8003** (`tfrContributionLine`), mai la casella
   "TFR MESE" (ottobre: nessuna contribuzione, GC §8.2); iscrizione 7053/7052 a parte; 9110 e 7897
   non aggiungono nulla. La 13ª porta il suo lavoratore effettivo e **nessuna quota azienda**: la
   rettifica 8056 si conserva in `employer_adjustment_cents` e **non si somma** (il caso "tredicesima + dicembre"
   della GC §13). Trimestre dal mese del cedolino; la 13ª nel IV. Un cedolino sostituito
   (F5) toglie la sua competenza; i cedolini applicati prima di F6 si pubblicano con una
   ricostruzione (`replaceCompetences`) alla creazione del fondo e con un bottone in Settings.
3. **Scadenze** (GC §4): 20 aprile, 20 luglio, 20 ottobre, 20 gennaio dell'anno dopo, da una regola
   versionata (`pension_rules`), con una **tolleranza di visualizzazione** (15 giorni, design) distinta
   dalla scadenza.
4. **Import delle operazioni** (§9.3, GC §8.4, §11): colonne per **nome dell'intestazione**, non per
   posizione; numeri italiani; "2026 SECONDO" → anno 2026, trimestre II. Righe con la stessa testata
   (tipo, data, trimestre, importi) e comparti diversi sono **un'operazione con più movimenti quote**:
   la testata non si moltiplica. Classificazione interpretata accanto alla descrizione originale:
   "Contributo" con netto zero, nessuna quota e spese = aderente + azienda → `enrollment` (GC §8.4).
   Deduplica: lo stesso file per hash (F5); export diversi che si sovrappongono per `origin_key` =
   impronta dei campi dell'operazione (tipo, data, trimestre, importi, comparto, quote) — mai due
   operazioni vere eliminate solo perché hanno stessa data e importo: un'impronta già presente con
   un'altra riga identica nello **stesso** export vale due volte.
5. **Snapshot della posizione** (GC §8.5): letto con coordinate (etichetta a sinistra, importo sulla
   stessa baseline), evidenze con riquadro, revisione come in F5; all'applicazione scrive lo snapshot
   e il saldo `import` del conto di valorizzazione alla data di valorizzazione. Un "Aderente" o
   "Azienda" del PDF comprende le iscrizioni (GC §8.5).
6. **Riconciliazione** per anno × trimestre × componente (lavoratore, azienda, TFR; l'iscrizione a
   sé): maturato (competenze del trimestre) contro accreditato (operazioni `contribution` di quel
   trimestre). Stati (GC §11, spec §7.7): *maturato non scaduto* (scadenza futura, nessun movimento)
   · *da verificare dopo scadenza* (scadenza + tolleranza passata **e** l'ultimo export è stato
   importato dopo di essa) · *presente nel fondo* · *investito* (con quote) · *riconciliato* (importi
   uguali al centesimo) · *discrepanza* (differenza non spiegata e non accettata) · *dati incompleti*
   (manca un cedolino del trimestre o nessun export copre la scadenza). **Un export vecchio non
   produce mai "da verificare"**: la freschezza è la data di ricezione dell'ultimo export applicato
   (§3.6.7). Molti-a-molti: più competenze e più operazioni per trimestre; arretrati e rettifiche
   restano collegati al trimestre di competenza. Una differenza accettata dal revisore si conserva con
   nota; nessuna "commissione" automatica per far quadrare (GC §11.9).
7. **Metriche** (GC §9.1–9.2, §12): valore (ultimo snapshot); versato = entrate lorde delle operazioni
   incluse le iscrizioni (controllo con "Totale entrate" dello snapshot quando i perimetri coincidono,
   GC §11.8); guadagno dall'inizio = valore − entrate lorde − trasferimenti in ingresso + uscite
   lorde (GC §9.3); **guadagno ÷ versato "non annualizzato"**; spese esplicite (somma delle spese
   delle operazioni, con il dettaglio iscrizione / associativa); da accreditare = competenze dei
   trimestri non ancora nel fondo, con la scadenza; competenze coperte fino a. Il pannello "Perché i
   numeri differiscono?" mostra il raccordo maturato − non ancora versato + iscrizioni = versato;
   − spese = investito; + guadagno = valore. Metriche non calcolabili → "—" con il motivo (§8.4.7).
8. **Grafico** del valore: solo punti documentati (snapshot, e il netto investito alle date quota),
   a gradini; nessuna serie giornaliera inventata (GC §5). I contributi sono una serie separata:
   un gradino da accredito non è profitto (GC §12).
9. **Costi** (GC §6): fa fede la colonna spese delle operazioni; il tariffario versionato serve solo a
   spiegare; i costi indiretti del comparto sono "già nel valore quota", mostrati come stima
   informativa, mai sottratti.
10. **Fiscalità** (GC §7): sezione informativa per anno esplicito — contributi lavoratore + azienda
    (TFR escluso) contro il limite di deducibilità dell'anno (5.164,57 € fino al 2025, 5.300 € dal
    2026, dati pubblici versionati), con l'avvertenza che l'anno fiscale certificato può differire
    dalla data operazione. Nessun credito fiscale aggiunto al patrimonio.
11. **Patrimonio**: il conto di valorizzazione è di tipo `pension`, nel patrimonio ma non nella
    liquidità (F1); le competenze non ancora versate **non** si sommano al patrimonio (GC §3.3,
    politica esplicita: nessun "credito da cedolino").
12. **Versamento volontario** (design, GC §3.1): un'operazione `manual` `voluntary`, collegabile a un
    movimento del conto come i versamenti PAC; aumenta il versato, mai il guadagno.

### 3.5 Test sui dati veri e gemelli

- **Dati veri** (saltati se mancano `Payroll/` o `Fondo Cometa/`): i 12 cedolini + l'export + il PDF,
  attraverso lo stesso codice; valori attesi letti dalla guida (tabelle §8.2, §8.4, §8.5 e i casi
  §13) a runtime. **Ogni caso della GC §13 è un test**: quelli che i dati veri non contengono
  (trasferimento in ingresso, cambio comparto, uscita, contributo extra, trimestre con più righe,
  snapshot vecchio, documento mancante) si provano sui gemelli.
- **Gemelli** in `tests/fixtures/cometa/`: generatore dell'export HTML (stesse 16 colonne) e del PDF
  di riepilogo (stesse etichette e posizioni), con numeri inventati coerenti con i gemelli payroll di
  F5 (marzo, aprile, 13ª del 2031); e2e con quelli.

### 3.6 Dove spec, guida, design e codice divergono — proposte

1. **XLS/XLSX veri** (§9.3 "accettati anche"): l'unico export reale è la tabella HTML. → F6 legge
   la tabella HTML e l'**XLSX** (con una piccola dipendenza da scegliere in L2, solo lettura); un
   **XLS binario** (OLE2) viene rifiutato con "esporta in XLSX o HTML" finché non ne vediamo uno.
2. **Più fondi pensione** per persona: le competenze dei cedolini vanno al fondo con
   `receives_payroll` (uno solo, scelto alla creazione; il primo fondo pensione lo è di default).
3. **Chi scrive le competenze**: il sink di §7.8 va da `payroll` a `funds` dentro l'applicazione; la
   ricostruzione per i cedolini già applicati passa per un'azione dell'app che legge da `payroll` e
   scrive in `funds` (nessun import circolare fra moduli).
4. **La rettifica aziendale della 13ª** (8056): esclusa dalle competenze e mostrata come rettifica
   "da rivedere" (coerente con la specifica dei cedolini L147 e con la GC §8.3); un revisore può
   accettarla con una nota.
5. **Grafico**: il design interpola fra gli estratti "per la visualizzazione"; la guida (GC §5) lo
   vieta come serie reale. → punti documentati a gradini, nessuna interpolazione.
6. **Regole contributive** (`pension_rules` `contribution`): si registrano e si mostrano (CCNL, base,
   percentuali, fonte, verificata il); nessun controllo automatico delle percentuali finché la base
   (minimi contrattuali) non è nei dati — gli importi documentati prevalgono (GC §3.2).
7. **Freschezza dei dati** per "da verificare dopo scadenza": la data di **ricezione** dell'ultimo
   export applicato (un export elenca tutte le operazioni fino a quel momento), non la data
   dell'ultima operazione; con la tolleranza di 15 giorni.
8. **XIRR, TWR, rendimento del comparto** (GC §9.4): fuori da F6; il pannello dice "non disponibile"
   dove il design li mostrerebbe.
9. **Etichette**: "Paid in" dove il design dice "Accrued in payslip" (spec §8.4.7), e mai "deposits"
   da solo (GC §12): maturato, versato, investito.
10. **Revisione dei documenti Cometa**: una pagina di revisione per documento sotto il fondo
    (`/funds/[id]/documents/[docId]`), con il viewer per il PDF e l'anteprima delle righe per l'export
    (nuove / già presenti / ambigue), prima di "Applica".

## 4. Lotti

```
L0 schema ── L1 competenze dai cedolini ── L2 export operazioni ── L3 PDF posizione
                                         └───────────── L4 riconciliazione ── L5 metriche e UI ── L6 costi, fisco, volontari
```

Ogni lotto: test prima, cancello (§5), deploy, e2e sul sito con utenti `@example.test` e gemelli.

### L0 — Schema
Migrazione `0012`; `tables.ts`; creazione di un fondo pensione (conto `pension`, regole seminate,
`receives_payroll`); tariffario seminato. **Test**: CHECK, unicità, isolamento di ogni tabella nuova.

### L1 — Competenze dai cedolini
`payroll/pension.ts`, sink in `applyPayslip` e nella sostituzione, ricostruzione. **Test**: gemelli
(ordinario, 13ª, sostituzione) e dati veri (tabella GC §8.2: totali, dicembre + 13ª, ottobre
senza contribuzione, iscrizione a parte, 7101+9110 senza doppioni).

### L2 — Export delle operazioni
Parser HTML (e XLSX), revisione con anteprima, applicazione con deduplica. **Test**: dati veri (GC
§8.4), stessa importazione due volte, export sovrapposti, trimestre con più comparti, iscrizione.

### L3 — PDF della posizione
Parser a coordinate con evidenze, revisione con il viewer, snapshot + saldo `import`. **Test**: dati
veri (GC §8.5), gemello, snapshot vecchio.

### L4 — Riconciliazione
`reconcile.ts` puro, decisioni del revisore. **Test**: i totali per trimestre della GC §13, luglio +
agosto "maturato non scaduto", export vecchio dopo la scadenza, discrepanza e differenza accettata,
molti-a-molti, rettifica di un trimestre.

### L5 — Metriche e interfaccia
`metrics.ts` e le schede di Fund detail pensione (Overview con KPI, grafico, operazioni, raccordo;
Contributions con "Accrued in payslips" per mese e stato, "Employer transfers" per trimestre;
Valuations con gli snapshot; Settings con regole, tolleranza e ricostruzione), colonne pensione nella
lista Funds, creazione del fondo. **Test**: tutti i casi GC §13 (dati veri + gemelli), e2e a 1440 e
400 px.

### L6 — Costi, fiscalità, versamenti volontari
Sezione costi (effettivi vs tariffario vs stima indiretta), sezione fiscale per anno, "Add
contribution". **Test**: spese esplicite della GC §13 (dati veri), limiti per anno, volontario che aumenta il versato
e non il guadagno.

## 5. Cancello

```
npm run format && npm run lint && npm run typecheck && npm run format:check && npm test && npm run test:integration
docker compose build && docker compose up -d && curl -fsS https://dash.longobardo.me/api/health
npm run e2e
```
In più: `db:generate` → nessuna differenza; nessun importo, nome o documento personale in git
(`grep` sui file cambiati prima di ogni commit, come alla fine di F5).

## 6. Fatto quando

- §7.7 parte pensione e le §§1–6, 8–13 della GC hanno codice e test; **ogni caso della GC §13 è un
  test verde** (sui dati veri in locale, sui gemelli sempre).
- Il fondo Cometa del proprietario, con i suoi cedolini applicati e i due documenti importati, mostra
  le grandezze della GC §12 "Riepilogo".

## 7. Resta al proprietario

- Confermare §3.6 (soprattutto 1, 2, 4, 5, 7).
- Creare il fondo Cometa sul sito, importare export e PDF, rivedere.
- I commit.

## 8. Esito

Fase implementata il 2026-09-20, lotti L0–L6 in un unico passaggio, con cancello e deploy alla fine.
Distribuita su `https://dash.longobardo.me` (migrazione `0012_pension_cometa` applicata). Il
proprietario ha detto «procedi con la fase 6»: §3.6 vale come confermata, con le deviazioni qui sotto.

### 8.1 Verifiche

| Controllo | Esito |
|---|---|
| `format`, `lint`, `typecheck`, `format:check` | verdi |
| `npm test` | 940/940 (base 894) |
| `npm run test:integration` | 342/342 (base 310) |
| `db:generate` | nessuna differenza |
| deploy + `/api/health` | `ok`; le sette tabelle nuove e `funds.receives_payroll` sul database |
| `npm run e2e` sul sito | 37/37: `cometa.spec.ts` (percorso completo e 400 px) nuovo |
| dati personali in git | `grep` sui 35 file cambiati: nessun importo, nome o codice fiscale |

- **Dati veri** (in locale, `src/modules/funds/pension/real-cometa.test.ts`, saltato senza `Payroll/`
  o `Fondo Cometa/`): **15 test verdi** sui 12 cedolini + l'export + il PDF, con ogni valore atteso
  letto **dalla guida a runtime**. Coperti: la tabella §8.2 riga per riga (ottobre a zero, iscrizione
  a parte, dicembre + tredicesima una volta sola), la tabella §8.4 riga per riga con totali e quote,
  la tabella §8.5, la riconciliazione al centesimo dei tre trimestri accreditati, luglio + agosto
  «maturato non scaduto» con la loro scadenza, l'export vecchio che non accusa nessuno, il riepilogo
  §12 (versato, spese, investito, guadagno, rapporto semplice, quote) e il raccordo senza residui.
- **Gemelli** in `tests/fixtures/cometa/`: generatore dell'export HTML (le 16 colonne vere, un
  `<tbody>` per operazione), lo stesso export in XLSX e il PDF di riepilogo disegnato con pdf-lib
  alle posizioni reali. Numeri inventati coerenti con i gemelli payroll del 2031, più due cedolini
  nuovi (`JANUARY` con le quote d'iscrizione, `FEBRUARY`) per avere un trimestre intero.
- **Casi GC §13**: ognuno è un test. Sui dati veri quelli che i documenti contengono; sui gemelli
  trasferimento in ingresso, cambio comparto, uscita, versamento volontario, trimestre con più
  comparti, export sovrapposti, importazione ripetuta, documento mancante, differenza accettata.

### 8.2 Scelte fatte in implementazione

1. **Impronta dell'operazione senza comparto, quote, prezzi e stato** (§3.4.4 li elencava): un export
   preso prima della quotazione non li ha, e quello preso dopo deve **aggiornare** quell'operazione,
   non aggiungerne una seconda. Restano tipo, data, competenza, importi e azienda — il confronto che
   chiede la GC §11.6 —, e due righe identiche dello stesso export restano due operazioni grazie al
   numero d'occorrenza (`…#2`).
2. **Applicare un export non cancella mai nulla**: l'export del portale è filtrabile per anno e per
   azienda, quindi un'operazione assente non è "annullata". Una riga corretta dal fondo arriva perciò
   come operazione nuova e il trimestre mostra una discrepanza da rivedere: il revisore decide.
3. **XLSX senza nuove dipendenze** (§3.6.1 ne prevedeva una): `src/modules/funds/parse/xlsx.ts` legge
   la directory centrale dello ZIP e il foglio con `node:zlib`, valori soltanto. L'XLS binario (OLE2)
   è rifiutato con «esportalo in XLSX o HTML».
4. **Il tipo del documento Cometa si riconosce dal contenuto** al caricamento (spec §9.3): un PDF è il
   riepilogo, una tabella HTML o un XLSX è il dettaglio operazioni. Un solo bottone «Importa documenti».
5. **Evidenze**: per il riepilogo una riga per campo con pagina e riquadro, correggibile come in F5;
   per l'export una riga per cella di ogni operazione (riga e colonna nell'etichetta), senza
   correzione — all'applicazione il file viene riletto, così ciò che entra è ciò che il file dice.
6. **Tariffario seminato da una costante versionata** alla creazione del fondo, non dalla migrazione:
   i test d'integrazione svuotano ogni tabella, e una riga di sola migrazione sparirebbe.
7. **`numeric(7,4)`** per le percentuali delle regole: il 100 % del TFR non entra in `numeric(6,4)`.
8. **Quote**: `numeric(18,6)` restituisce sempre sei decimali; la somma toglie gli zeri di riempimento
   e non scende sotto i tre decimali che il fondo stampa (`82.155`, `40.000`).
9. **`saveImportBalance` / `deleteImportBalance`** nuovi in `accounts/service.ts`: il riepilogo scrive
   il saldo `import` del conto di valorizzazione dentro la transazione che salva lo snapshot, e una
   correzione `manual` dello stesso giorno continua a vincere (`SOURCE_RANK`).
10. **Il valore di un fondo pensione nella lista** è quello del suo ultimo riepilogo **con la sua
    data**, non il saldo «a oggi»: un fondo valorizzato solo a una data futura (i gemelli del 2031)
    restava altrimenti vuoto in lista e pieno nel dettaglio.
11. **Orchestrazione payroll ↔ fondi nel livello app** (`src/app/(app)/funds/pension-setup.ts`): la
    creazione del fondo e «Ricostruisci dai cedolini» leggono da `payroll` e scrivono in `funds`, così
    la dipendenza fra moduli resta solo da `payroll` a `funds` (§3.6.3).
12. **Stati**: una differenza accettata si mostra come «Riconciliato» con la nota del revisore accanto,
    e decade da sola appena la differenza cambia; un trimestre a cui manca un cedolino è «Dati
    incompleti» anche prima della scadenza, perché è il dato a mancare, non il versamento.
13. **Job `cometa-sweep`** (orario, in coda al registro): rilegge i documenti Cometa rimasti in lettura,
    come `payslips-sweep` fa per i cedolini.
14. **Sezione fiscale** per anno di **operazione**, iscrizioni escluse dai contributi dedotti, con
    l'avvertenza che l'anno fiscale certificato può differire (GC §7).
15. **Versamento volontario**: importo nella colonna «aderente», nessun trimestre di competenza (non
    si riconcilia con nessun cedolino), collegabile a un movimento come i versamenti PAC; aumenta il
    versato e abbassa il guadagno, mai il contrario.

### 8.3 Fuori perimetro, come previsto

XIRR, TWR e rendimento del comparto (GC §9.4) non ci sono: il pannello mostra il rapporto semplice con
l'etichetta «non annualizzato». Il grafico disegna solo punti documentati (riepiloghi e quote × valore
quota alle date quota), a gradini, senza interpolazione (§3.6.5).

### 8.4 Resta al proprietario

- Creare il fondo Cometa sul sito («Aggiungi fondo pensione»), poi importare `DettaglioOperazioni.xls`
  e `riepilogo_posizione.pdf`, rivederli e applicarli: i 12 cedolini già applicati pubblicano le loro
  competenze alla creazione del fondo.
- Controllo visivo delle schede pensione rispetto al design, e la revisione di fase.
- I commit.

## 9. Correzioni dopo la revisione del proprietario (2026-09-20)

Sette rilievi a schermo, tutti chiusi e verificati sul sito deployato.

1. **Impostazioni a due colonne.** `SettingsGrid` non affianca più due sezioni: una sezione per riga,
   titolo e descrizione nella colonna di sinistra (240 px), la carta che prende tutto il resto. Affiancare
   dimezzava la riga, nessuna delle due sezioni raggiungeva la soglia a cui il titolo va di fianco alla
   carta e tornavano entrambe impilate — il difetto che l'affiancamento doveva evitare. La prop `wide`
   è sparita con la griglia. Vale per `/settings/profile`, `/settings/server`, `/settings/security`,
   `/settings/data`, `/settings/integrations` (la carta «Data sources» ora riempie la riga) e per la
   scheda Impostazioni del fondo. `tests/e2e/wide.spec.ts` verifica il contratto nuovo a 1280 e 2560 px.
2. **Un fondo alimentato dai soli cedolini è completo.** Decisione vincolante del proprietario: i due
   documenti Cometa non vanno caricati, **il calendario dei versamenti nelle impostazioni è la fonte di
   verità** su quando il denaro arriva al fondo. Nuovo stato `transferred` («Versato»): un trimestre
   oltre la scadenza, senza nessun export con cui confrontarlo e senza cedolini mancanti, è versato —
   non più «Dati incompleti · nessun export importato», che accusava l'utente di un file mai richiesto.
   Il motivo `no_export` non esiste più; `incomplete` resta solo per un cedolino mancante o un export
   anteriore alla scadenza. Nessuna modifica al database: lo stato è calcolato.
3. **Niente inviti a importare.** La riga «I cedolini portano già il maturato… i due documenti di Cometa
   aggiungono…» è stata rimossa da Panoramica e Valutazioni, con le sue chiavi (`funds.pension.missing.*`).
4. **Versato che segue il trimestre.** In `/funds` la supplenza dei cedolini non conta più il maturato di
   ogni mese alla data del cedolino: ogni trimestre entra alla **sua scadenza** (`pensionInflows` legge il
   calendario in forza del fondo, `COMETA_SCHEDULE` in mancanza) e prima di allora il fondo ha maturato
   qualcosa e versato nulla. Lo stesso vale per il KPI «Versato al fondo» (`metrics.transferredCents`) e
   per «Da accreditare», che non conta più i trimestri già versati.
5. **Carte pari.** «Perché i numeri differiscono» e «Posizione» — e la coppia «Versamento volontario» /
   «Deducibilità» — si allungano alla stessa altezza.
6. **Bersagli.** `LinkButton`, le checkbox e i link di tabella arrivano a 24 px di altezza; il controllo
   permanente (`tests/e2e/a11y.spec.ts`) misura la label quando il controllo ci sta dentro, perché è
   quella il bersaglio. Zero violazioni WCAG 2.1 A/AA su tutte le pagine toccate, a 1440 e 400 px.

Non verificato a schermo: `/settings/server`, che richiede un utente admin — usa gli stessi due
componenti delle altre quattro pagine impostazioni, verificate.

### 9.1 Il guadagno di un fondo senza documenti propri (2026-09-20)

Con una valutazione scritta a mano e nessuna operazione importata, il guadagno era misurato contro
zero e la posizione intera si leggeva come guadagno: «+2.251,05 € · — · 0,00 € versato». Ora il
guadagno sta su **quello che il calendario ha già portato entro la data del valore**
(`PensionMetrics.gainBasisCents`), come già fanno le operazioni con la loro data: denaro uscito dopo
il riepilogo non è dentro il valore con cui lo si confronta. Se non è entrato nulla di noto, il
guadagno è **sconosciuto** (`nothing_paid`) e non pari all'intera posizione. L'intestazione stampa lo
stesso versato su cui sta il guadagno, il ponte «Perché i numeri differiscono» parte da quello, e la
linea «versato» del grafico sale a gradini alle scadenze invece di restare piatta a zero.

La didascalia «secondo il calendario dei versamenti» è stata rimossa dalla lista fondi, dal riquadro
«Versato al fondo» e dall'intestazione («il fondo non l'ha ancora confermato»): il versato di un fondo
alimentato dai cedolini è un versato come gli altri e non porta etichette di provenienza. Con lei sono
sparite le chiavi `funds.table.fromPayslips`, `funds.pension.kpis.paidInAccrued`,
`funds.pension.header.accruedNote` e il campo ormai inutile `FundRow.paidInFromPayslips`.

### 9.2 Quote fuori, rendimenti e proiezione dentro (2026-09-20)

**Quote, valore quota e giacenze** non si vedono più: erano quantità che solo i documenti di Cometa
sanno dire, e quei documenti non si caricano. Via dalla carta «Posizione» («Quote possedute», «Ultimo
valore quota»), dalla tabella delle operazioni, dalla tabella e dal modulo delle valutazioni — che ora
chiede giorno, importo e nota —, e dai testi che le nominavano. Le colonne restano nel database e i
parser continuano a leggerle: una valutazione registrata prima conserva le sue.

**Rendimento mensile e «Dove sta andando»** stanno ora anche sul fondo pensione, affiancate:

- il rendimento è il Simple Dietz di §7.7, sugli stessi dodici mesi del PAC, con migliore/peggiore
  mese e quanti sono stati positivi. Ciò che «è entrato» nel mese è l'operazione del fondo se ce n'è
  una, altrimenti il trimestre che il calendario ha versato (`paidInFlows`);
- la proiezione dice quanto sarà stato **versato** fra 1, 3, 5 e 10 anni al ritmo degli ultimi dodici
  mesi — un dato certo, che non ha bisogno né di un tasso né di una valutazione — e quanto varrà a
  tre tassi **di ipotesi** (2 %, 4 %, 6 %), dichiarati tali nella carta e nelle intestazioni. Il tasso
  del fondo stesso compare come quarta colonna solo quando ci sono dodici mesi misurati
  (`annualisedReturn`): annualizzare un trimestre fortunato è il modo più convincente che questa
  pagina avrebbe di mentire.

La scheda **Valutazioni** del fondo pensione elenca ora le valutazioni registrate a mano, con
«Modifica» e «Elimina» come su un PAC: sono gli unici punti di valore di un fondo che non importa
documenti, e servono ai due grafici qui sopra.

Corretto lungo la strada: con meno di tredici mesi di storia la serie dei valori finiva più corta dei
mesi da misurare e `monthlyReturns` leggeva oltre l'array, mescolando `undefined` a un `bigint` —
la pagina del fondo rispondeva «Qualcosa è andato storto». Ora la serie viene chiesta per nome e il
mese senza estremo è ignoto, non zero.

### 9.3 Categorie di Wallet acquisite dalla lista (2026-09-20)

Verificato sull'OpenAPI ufficiale (`GET /v1/api/categories`): Wallet **espone** le categorie con
`id`, `name`, `group`, `parentId`, `systemId`, `archived`. Fino a ora una categoria arrivava qui solo
quando arrivava un movimento che la citava, quindi una categoria creata su Wallet e non ancora usata
era invisibile. Adesso ogni passata di sincronizzazione prende la lista intera e acquisisce quelle che
non sono già rispecchiate — per link di categoria **o** di gruppo, altrimenti ne creerebbe una copia
ogni ora —, con il gruppo di Wallet come genitore, saltando le archiviate. Passa dallo stesso
`adoptOrCreateCategory` dei movimenti, quindi un nome già presente viene adottato e collegato invece
che duplicato. Il registro di Settings › Integrazioni conta l'operazione come «categorie acquisite».

Limite noto e invariato: Wallet non pubblica il **tipo** di una categoria, quindi una nuova nasce col
tipo del suo gruppo e si corregge da qui; il tipo non viene mai spostato da una sincronizzazione.

### 9.4 Il tipo di una categoria lo dicono i suoi movimenti (2026-09-20)

Acquisire le categorie dalla lista di Wallet ha fatto emergere il problema vero: **Wallet non
pubblica il tipo**, quindi ogni categoria adottata nasceva «uscita» — stipendio e interessi compresi.
Sul fondo del proprietario «Interest, dividends» aveva 32 movimenti tutti in entrata ed era salvata
come uscita, e per questo **non compariva** fra le categorie che la regola d'interesse può proporre
(il selettore offre solo entrate, spec §7.6). Nessuna scorciatoia era praticabile da mano: in un
gruppo il tipo è quello del gruppo ed è bloccato.

I movimenti però il tipo ce l'hanno. `alignCategoryTypesToMovements` sposta ogni categoria al tipo
che i suoi movimenti dichiarano, in coda alla passata di sincronizzazione — dopo l'importazione, mai
prima, o giudicherebbe sui movimenti dell'ora precedente. Le regole:

- serve evidenza: meno di tre movimenti non dicono nulla (`TYPE_EVIDENCE_MIN`);
- serve accordo: il tipo dominante deve portare almeno l'80 % dei movimenti (`TYPE_EVIDENCE_SHARE`).
  Wallet lascia archiviare un rimborso sotto una categoria di entrata, e un movimento contrario su
  settantotto è rumore; quattro su dieci sono un disaccordo e allora non si decide niente;
- un tipo scelto a mano qui non si tocca mai: è a questo che serve il marcatore `type` in
  `locally_edited`, già scritto da Settings › Dati;
- un gruppo che si sposta porta con sé i figli **senza movimenti propri**, perché una categoria in un
  gruppo è del tipo del gruppo (F2.5) e quei figli non hanno altro da dire. Un figlio con movimenti
  propri segue i propri.

Esito sulla prima passata reale (20 set 2026, 19:07): **37 categorie acquisite** dalla lista e **13
con il tipo corretto**. Le entrate sono passate da 0 a 12, «Interest, dividends» inclusa e collegata
al suo id di Wallet, che è ciò che serve perché l'interesse venga pubblicato là con la categoria
giusta. Il registro di Settings › Integrazioni conta l'operazione come «categorie con il tipo
corretto».

### 9.5 I grafici del fondo (2026-09-20)

**La barra prima di aprile.** Le due serie venivano disegnate interpolando fra un punto mensile e il
successivo, quindi un accredito del 20 aprile faceva salire la linea già da marzo. Ora entrambe sono
**a gradini** (`Series.step`): piatte fino al giorno in cui la cosa succede, poi verticali. Né il
versato né il valore si muovono durante il mese: l'uno si sposta quando il denaro esce, l'altro
quando un documento o una valutazione lo dice.

**Il grafico come quello dell'overview.** `MultiLine` ha ora il `hover` che già avevano `AreaLine` e
`StackedArea`: mirino e riquadro con mese, valore e versato. Le ascisse mostrano fino a dodici
etichette invece di cinque, quindi su una finestra di un anno ci sono tutti i mesi. E accanto ai
preset 1A/2A/Tutto c'è il **`MonthRangePicker`** dell'overview: un intervallo scelto a mano vince sul
preset e viene disegnato per intero, mese per mese, anche dove il fondo non ha nulla da mostrare.

**Le percentuali sbagliate.** «+150 % mese migliore, −59 % peggiore» erano l'artefatto previsto dal
modo in cui erano calcolate: Simple Dietz mese per mese contro un valore **tenuto fermo** dall'ultimo
documento. Nel mese in cui arrivava l'accredito il valore non si era mosso — nessuno aveva valutato il
fondo — quindi il versato leggeva come una perdita della propria dimensione; il mese in cui arrivava
una valutazione incassava in un colpo la crescita di tutti i mesi prima. Nessuno dei due era un
rendimento.

Un rendimento ha bisogno di **due estremi documentati**. `periodReturns` misura ogni tratto fra una
valutazione e la successiva, sottrae il versato del tratto e tiene le proprie date: tre mesi e un
mese non sono confrontabili come «mesi», e la pagina dice quale è quale invece di far finta. Da qui
`periodStats` (composto, migliore, peggiore, quanti positivi) e `annualisedOverPeriods`, che porta a
un anno solo con almeno un anno di storia dietro. Vale per il PAC come per il fondo pensione.

**La pagina di dettaglio** (`/funds/[id]/returns`, link «Dettaglio» sulla carta): i quattro numeri in
testa, il grafico a barre con il dettaglio del tratto sotto il puntatore — valore iniziale, finale,
versato, guadagno — e la tabella con una riga per tratto, in cui ogni cifra si ricontrolla a mano. Su
telefono la tabella diventa una lista, come ogni altra tabella qui; lo stesso per la tabella della
proiezione, e le coppie di carte hanno ora tracce `minmax(0,…)` perché una tabella larga non allarghi
la riga oltre lo schermo.

### 9.6 Doppio clic, ricorrenza dei PAC, galleria via (2026-09-20)

**Doppio clic su un movimento** apre lo stesso pannello che aprono la voce «Modifica» del menu di riga
e il tasto `E`: il mouse guadagna una scorciatoia e non si sposta nient'altro. Un doppio clic che
cade su un controllo della riga — la casella, il chip della categoria, il menu — resta di quel
controllo, e la selezione di testo che il doppio clic lascia dietro viene tolta, perché era un gesto
e non la richiesta di selezionare una parola.

**«Trova questo addebito ovunque»** (scheda Versamenti di un PAC). Si sceglie un addebito del fondo e
l'app legge ciò che lo rende riconoscibile, **senza chiedere niente a nessun modello**: l'
identificativo creditore della domiciliazione SEPA, il riferimento del mandato, o in mancanza di
entrambi il beneficiario (`funds/detect.ts`). Poi dice quanti addebiti portano lo stesso nome, da
quando, quanto costano di solito e ogni quanti giorni tornano. Nulla viene scritto finché non si
preme «Usa questo»: allora quel testo diventa la regola del fondo, i versamenti passati entrano e i
futuri seguono da soli, perché `matchDeposits` gira a ogni sincronizzazione.

Due precisazioni che i dati veri hanno imposto:

- l'identificativo creditore si prende **solo** se il testo lo nomina o se il codice azienda è `ZZZ`.
  La sola forma non basta: un IBAN italiano è due lettere, due cifre e altri ventitré caratteri, cioè
  lo stesso stampo. Fra gli identificativi presenti nei movimenti del proprietario, **48 erano IBAN**
  e 16 identificativi creditore, e solo l'etichetta o lo `ZZZ` li distingueva. Scambiare un numero di
  conto per un creditore avrebbe agganciato ogni addebito mai passato su quel conto;
- la regola ora cerca il suo testo **anche nella causale**, non solo nel beneficiario: un
  identificativo vive lì, e una regola creata da uno non avrebbe agganciato niente.

**La pagina `/components`** (la galleria del design system) non c'è più: rotta, voce di menu, icona,
etichette e test. `/components` risponde 404.

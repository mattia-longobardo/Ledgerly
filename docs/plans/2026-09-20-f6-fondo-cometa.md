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

*(da scrivere a fine fase.)*

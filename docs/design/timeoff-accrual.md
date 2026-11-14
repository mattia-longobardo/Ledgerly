# Time Off: maturazione mensile di ferie e ROL

Stato: **approvata da Mattia il 14/11/2026 con tutti i default di §6** (opzione A, U1 + U2, rilascio `N5.1` dopo N5). Nessun codice di prodotto cambia con questo documento.

Richiesta (14/11/2026): la pagina Time Off serve anche per pianificare. Oltre al residuo di oggi, l'utente vuole vedere quanto matura ogni mese e quanto avrà a una data futura. La sorgente è la busta paga. Un residuo negativo è un caso normale.

La funzione non è nel piano di riscrittura (`docs/design/rewrite-plan/`).

## 1. Cosa è disponibile oggi

### 1.1 Buste paga

Il lettore legge già tutti i campi necessari. Non serve un lettore nuovo.

| Dato | Dove | Note |
|---|---|---|
| 12 campi dei saldi: `vacation`, `rol`, `permit` × `PreviousYear` (A.P.), `Accrued` (MAT.), `Used` (GOD.), `Remaining` (RES.) | `src/modules/payroll/fields.ts:76-87`, etichette in `parse/reply-teamsystem.ts:92-103` | Unità: **ore**. Solo dalle regole del lettore: il fallback LLM non li riempie |
| Controllo `A.P. + MAT. − GOD. = RES.` | `parse/checks.ts:170-181` (`leave_<kind>`) | Errore se non torna; un campo vuoto vale zero |
| Saldi salvati per busta paga applicata | tabella `leave_balance_snapshots` (`payroll/schema.ts:222`), scritta da `writeLeave` (`payroll/service.ts:691`) | Una riga per busta paga e tipo; colonne `previous_year`, `accrued`, `used`, `remaining`, `unit = 'hours'` |
| Assenze godute, per mese di uso | tabella `payroll_leave_events`, da `parse/leave.ts` | Righe FERIE (301) e PERMESSI (309); mese di uso = mese della busta paga − 1 |
| Contratto verso Time Off | `leaveSnapshotsOf(ctx, year)` e `leaveEventsOf(ctx, year)` (`payroll/service.ts:797`, `:833`) | `LeaveSnapshot` espone già `accruedHours` |

Presenza nei dati di produzione (lettura in sola lettura, solo conteggi):

- Ferie e ROL: uno snapshot per ogni mese, senza buchi, su 2 anni solari. `MAT.` e `RES.` sono presenti in tutte le righe.
- `A.P.` e `GOD.` sono presenti solo in una parte delle righe (campo vuoto quando il valore è zero).
- `MAT.` è il **progressivo dell'anno**: cresce ogni mese e riparte a gennaio. La differenza tra due mesi consecutivi è la maturazione del mese. Le differenze hanno 2 soli valori distinti per tipo (arrotondamento): la maturazione mensile è costante.
- `permit`: i campi esistono, nessuna riga in produzione.
- I documenti di prova (`tests/fixtures/payroll/samples.ts`) hanno gli stessi 4 campi per ferie e ROL, in ore.

Conclusione: la maturazione mensile **è già nel database**. Oggi la usa solo `payroll`, per riconoscere un permesso come ROL (`parse/leave.ts`, `confirmedBy`).

### 1.2 Time Off

| Cosa | Dove | Come funziona |
|---|---|---|
| Dotazione | `timeoff_allowances` (`timeoff/schema.ts`): `vacation_days`, `rol_days`, `total_days` per anno | Inserita a mano, in giorni. Il riporto non si inserisce: è `A.P.` della busta paga |
| Residuo | `residual()` (`timeoff/rules.ts:210`) | Base `payslip`: `RES.` dell'ultima busta paga − giorni pianificati. Base `allowance`: dotazione + riporto − goduti − pianificati. Base `unknown`: nessun numero |
| Goduto / pianificato | `dayStatus()` con `countedThrough` | `countedThrough` = mese dell'ultima busta paga − 1 |
| Maturazione | `accrualPerWorkingDay()` e `overdrawn()` (`timeoff/rules.ts:602`, `:639`) | Dotazione dichiarata ÷ giorni lavorativi dell'anno. Serve **solo** per decidere l'avviso di superamento e la sua data. Non si vede |
| Vista | `timeOffView(ctx, year)` (`timeoff/queries.ts:123`) | Tutto per un solo anno solare |
| Trek | `trek` in `TimeOffView` | Numeri di Trek mostrati a fianco, mai sommati ai nostri |

Time Off non è esposto da API e MCP. `scripts/numbers-snapshot.ts` include i residui di Time Off.

## 2. Cosa manca per una proiezione nel tempo

| # | Mancanza | Effetto |
|---|---|---|
| G1 | Time Off non legge `accruedHours`. La sola maturazione usata viene dalla dotazione dichiarata | Il ritmo mostrato può essere diverso da quello del datore di lavoro |
| G2 | `residual()` dà un numero per anno, non un saldo a una data | Non si può rispondere a «quanto avrò il 10 agosto» |
| G3 | Letture per anno solare: `leaveSnapshotsOf(year)` | Un anno futuro senza buste paga usa la base `allowance` o `unknown`, con riporto 0. A gennaio, prima della prima busta paga, il residuo cambia base |
| G4 | La maturazione non si vede: né per mese, né come totale previsto | L'utente non sa quanto matura |
| G5 | Unità diverse: busta paga in ore, dotazione in giorni, schermo in giorni (`minutesPerDay`) | Il ritmo dalla dotazione e il ritmo dalla busta paga possono non coincidere |
| G6 | L'ultima busta paga è vecchia di 1-2 mesi | La proiezione deve coprire anche il tratto tra l'ultima busta paga e oggi |

## 3. Cosa vede l'utente (uguale nelle due opzioni)

| # | Elemento | Dove |
|---|---|---|
| U1 | «Matura X giorni al mese» e «Previsto al 31/12: Y» | Schede Ferie e ROL (`KindCard`) |
| U2 | «Residuo previsto al \<primo giorno dell'assenza\>: prima → dopo» | Pannello di N5, al posto del residuo di fine anno |
| U3 | Linea del residuo a fine mese: mesi passati dalle buste paga, mesi futuri previsti | Grafico «By month», sopra le barre |

Formula comune: `previsto(D) = saldo di partenza + ritmo × mesi maturati fino a D − giorni pianificati fino a D`. Il valore può essere negativo; lo schermo lo mostra senza blocco. Le schede di oggi non cambiano numero: U1 aggiunge righe.

## 4. Opzioni

### Opzione A · Ritmo letto dalle buste paga

- **Ritmo:** media delle differenze di `MAT.` tra buste paga consecutive dello stesso anno (ultimi 12 mesi). Per la busta paga di gennaio la differenza è `MAT.` stesso.
- **Saldo di partenza:** `RES.` dell'ultima busta paga applicata, anche se è dell'anno precedente.
- **Senza buste paga** (meno di 2 snapshot): ritmo = dotazione dichiarata ÷ 12. Senza dotazione: nessuna proiezione, lo schermo lo dice.
- **Cambio di anno:** il saldo previsto al 31/12 è il riporto dell'anno dopo. Il ritmo continua.
- **Avviso di superamento:** `overdrawn()` usa lo stesso ritmo. Un solo ritmo in tutta la pagina.

### Opzione B · Regola dalla dotazione, corretta dalla busta paga

- **Ritmo:** dotazione dichiarata dell'anno ÷ 12 (o per giorno lavorativo, come oggi in `accrualPerWorkingDay`).
- **Saldo di partenza:** `RES.` dell'ultima busta paga. Ogni busta paga nuova corregge la partenza.
- **Controllo:** se la differenza di `MAT.` della busta paga è diversa dalla regola, lo schermo mostra un avviso.
- **Anno futuro:** serve la dotazione di quell'anno. Senza, la proiezione usa quella dell'ultimo anno dichiarato.
- **Avviso di superamento:** `overdrawn()` resta come oggi.

### Confronto

| | A · dalle buste paga | B · dalla dotazione |
|---|---|---|
| Fedeltà al datore di lavoro | Alta: il ritmo è quello stampato | Dipende dal valore inserito e da `minutesPerDay` (G5) |
| Lavoro dell'utente | Nessuno | Dotazione corretta per ogni anno |
| Utente senza buste paga | Funziona con il ripiego sulla dotazione | Funziona |
| Schema | Nessun cambio | Nessun cambio |
| Sync con Trek | Nessun effetto | Nessun effetto |
| Numeri esistenti | Residui uguali. **Cambia** la data e l'importo dell'avviso di superamento (ritmo nuovo). Anno futuro: da `allowance`/`unknown` a «previsto» | Residui e avviso uguali. Anno futuro: da `allowance`/`unknown` a «previsto» |
| Codice | Funzione di contratto in `payroll` (ultimo snapshot e differenze, senza limite di anno); file nuovo `timeoff/accrual.ts`; `timeOffView`; U1-U3; `numbers-snapshot` | File nuovo `timeoff/accrual.ts`; lettura dell'ultimo snapshot; `timeOffView`; U1-U3; avviso di differenza |
| Criteri §6 attesi | Tutti «no» (nessuna migrazione, nessun job, nessuna rete) | Tutti «no» |
| Git | `main` · `feat(timeoff)` | `main` · `feat(timeoff)` |
| Dimensione | **M** (~2 giorni con U1+U2; U3 +0,5) | **S** (~1 giorno con U1+U2; U3 +0,5) |
| Adatto alla riscrittura | Sì: `MAT.` entra nel contratto `LeaveBalanceSource` (R2); l'adattatore manuale usa il ripiego | Sì: non tocca il contratto |

Scartata: **maturazione inserita a mano per mese**. Ripete un dato che la busta paga stampa già e crea due risposte alla stessa domanda (stessa ragione del riporto, `timeoff/schema.ts`).

## 5. Consiglio

**Opzione A, con il ripiego sulla dotazione.** Motivi:

1. Il dato è già letto, controllato e salvato per ogni mese. Il ritmo è costante: la proiezione è affidabile.
2. È la richiesta di Mattia: l'informazione viene dalle buste paga.
3. Elimina il problema delle unità (G5) e non chiede manutenzione della dotazione.
4. Il ripiego copre l'utente senza buste paga, quindi A contiene il caso utile di B.

Costo accettato: l'avviso di superamento cambia ritmo. È una decisione scritta (domanda D5).

**Rilascio: dopo N5, in fase A**, come rilascio proprio (`N5.1 · Time Off: maturazione`). Motivi: nessuna migrazione e nessun criterio §6; il pannello di N5 ha già la riga «residuo prima → dopo» dove entra U2; la funzione serve ora per pianificare il 2027. In R2 (timeoff) la formula passa nella riscrittura con `residual()`: una funzione pura e una funzione di contratto in più. Vincolo: la logica va in un file nuovo, perché `timeoff/rules.ts` è già nella lista dei file da dividere e i controlli di modularità di N0 non devono peggiorare.

Alternativa: farla in R2. Meno codice da portare, ma la funzione arriva dopo tutta la fase A.

## 6. Decisioni

Mattia ha confermato tutti i default il 14/11/2026. U3 (linea nel grafico) non è nel primo rilascio.

| # | Decisione | Deciso (default) |
|---|---|---|
| D1 | Sorgente del ritmo | A: buste paga, con ripiego sulla dotazione |
| D2 | Cosa si vede nel primo rilascio | U1 + U2. U3 (linea nel grafico) nello stesso rilascio solo se confermi |
| D3 | Quando conta la maturazione di un mese | A fine mese: un'assenza il 15 agosto conta la maturazione fino a luglio (stima prudente) |
| D4 | Cambio di anno | Tutto il residuo di ferie e ROL passa all'anno dopo, come `A.P.` in busta paga. Nessuna regola di scadenza o pagamento dei ROL |
| D5 | Avviso di superamento | Usa lo stesso ritmo della proiezione (data e importo dell'avviso possono cambiare) |
| D6 | Anno senza buste paga (2027 visto oggi, gennaio) | Mostra il «previsto» dall'ultima busta paga, con etichetta chiara; non la base `allowance` |
| D7 | Rilascio | Dopo N5 in fase A (`N5.1`), commit su `main` |

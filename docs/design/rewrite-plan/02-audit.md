# 2. Audit del codice

Indice del piano: [`../rewrite-plan.md`](../rewrite-plan.md).

L'audit è l'ingresso del refactor ([`05-refactor.md`](05-refactor.md)) e dà i valori di partenza delle regole di
[`10-modularity.md`](10-modularity.md). Ogni voce ha un ID, il tipo, i riferimenti
`percorso:riga` e una proposta. Base: `main` a `5fbbdbc`, sola lettura, nessun test eseguito.

| File di dettaglio | Aree | Voci |
|---|---|---|
| [`audit-domain.md`](audit-domain.md) | accounts, transactions, budgets, subscriptions, pockets, interests, imports, users, trasversali | 83 (`ACC`, `TRX`, `BUD`, `SUB`, `POC`, `INT`, `IMP`, `USR`, `TR`) |
| [`audit-platform.md`](audit-platform.md) | investments, funds, payroll, timeoff, integrations, jobs, API, MCP, platform | 82 (`INV`, `FND`, `PAY`, `TOF`, `INTG`, `JOB`, `API`, `MCP`, `PLT`) |
| [`audit-ui.md`](audit-ui.md) | design system, shell, tutte le schermate, messaggi | 70 circa (`UI-*`) |

## 2.0 Priorità di ogni voce

Ogni voce dei tre file di dettaglio ha la colonna **P**: la priorità del refactor che tocca
([`10-modularity.md`](10-modularity.md) §10.1). Una voce ha una sola priorità: la più alta che tocca.

| P | Priorità | Tipi di voce | Voci |
|---|---|---|---|
| 1 | Modularità | doppione, stesso numero in due modi, componente simile (nessuna duplicazione); confine debole, accoppiamento server (basso accoppiamento, interfacce chiare); funzione con più compiti (responsabilità singola) | 199 |
| 2 | Pulizia e chiarezza | file grande, residuo, token, debito, nota | 49 |
| 3 | Prestazioni | Voci il cui effetto principale è il costo di esecuzione: query in ciclo, dati caricati due volte, un giro di rete per gesto | 9: INV-4, POC-3, IMP-5, INT-7, SUB-9, TRX-11, UI-ACC-7, UI-TOF-2, UI-PAY-1 |

Regole di classificazione:

- Il tipo decide la priorità. Eccezioni: le 9 voci di priorità 3, e UI-INV-10 («debito», ma è un confine: priorità 1).
- Un «file grande» è priorità 2 per la dimensione. La sua divisione segue le responsabilità: il lavoro è nel passo di
  modularità dello stesso modulo.
- Una voce di priorità 3 che è anche un doppione si chiude prima come doppione, poi si misura.
- Le voci «probabile bug» (§2.5) non sono refactor: sono correzioni, con una decisione di Mattia.

Voci per modulo e priorità:

| Dominio e platform | P1 | P2 | P3 | | Interfaccia | P1 | P2 | P3 |
|---|---|---|---|---|---|---|---|---|
| accounts (`ACC`) | 10 | 2 | 0 | | `UI-DS` | 17 | 6 | 0 |
| transactions (`TRX`) | 9 | 2 | 1 | | `UI-NAV` | 5 | 2 | 0 |
| budgets (`BUD`) | 7 | 1 | 0 | | `UI-OVR` | 3 | 0 | 0 |
| subscriptions (`SUB`) | 8 | 0 | 1 | | `UI-ACC` | 6 | 1 | 1 |
| pockets (`POC`) | 5 | 2 | 1 | | `UI-EXP` | 3 | 1 | 0 |
| interests (`INT`) | 7 | 0 | 1 | | `UI-BUD` | 2 | 0 | 0 |
| imports (`IMP`) | 6 | 1 | 1 | | `UI-SUB` | 0 | 2 | 0 |
| users (`USR`) | 7 | 1 | 0 | | `UI-PCK` | 1 | 1 | 0 |
| trasversali (`TR`) | 9 | 1 | 0 | | `UI-INT` | 1 | 0 | 0 |
| investments (`INV`) | 9 | 2 | 1 | | `UI-INV` | 8 | 2 | 0 |
| funds (`FND`) | 10 | 2 | 0 | | `UI-FND` | 3 | 3 | 0 |
| payroll (`PAY`) | 7 | 2 | 0 | | `UI-PAY` | 2 | 1 | 1 |
| timeoff (`TOF`) | 7 | 1 | 0 | | `UI-TOF` | 3 | 2 | 1 |
| integrations (`INTG`) | 8 | 2 | 0 | | `UI-SET` | 6 | 2 | 0 |
| jobs (`JOB`) | 6 | 3 | 0 | | `UI-AUT` | 2 | 0 | 0 |
| API (`API`) | 7 | 0 | 0 | | `UI-MSG` | 2 | 2 | 0 |
| MCP (`MCP`) | 4 | 1 | 0 | | | | | |
| platform (`PLT`) | 9 | 1 | 0 | | | | | |
| **Totale** | **135** | **24** | **6** | | **Totale** | **64** | **25** | **3** |

Tipi di voce: **doppione** (lo stesso codice in più copie), **stesso numero in due modi** (rischio diretto per il
vincolo «stessi numeri»), **confine debole** (dipendenza nella direzione sbagliata o ciclo), **file grande**,
**residuo** (codice o schema senza uso), **accoppiamento server** (schermata legata a Next.js sul server), **token**.

## 2.1 Numeri di sintesi

| Misura | Valore | Riferimento |
|---|---|---|
| Righe TypeScript in `src/` | circa 135.000 | `src/modules` 79.000, `src/platform` 30.000, `src/app` 20.000, `src/ui` 5.700 |
| Server Actions | 153 in 21 file `"use server"` | `audit-platform.md`, «Numeri» |
| Endpoint `/api/v1` | 7 in 5 gruppi, 2 in scrittura | `src/platform/api/app.ts:22-26` |
| Strumenti MCP | 7, sola lettura | `src/platform/mcp/tools.ts` |
| Job nel registro | 20, tutti nel processo web | `src/platform/jobs/registry.ts:52-86` |
| Lavori in background fuori dal registro (`after()`) | 8 punti | JOB-6 |
| Import di Wallet o Trek da fuori le loro cartelle | 18 in 14 file | INTG-1 |
| Import dei moduli da Wallet e Trek | 15 | INTG-2 |
| Import `platform → modules` | 80 in 21 file | PLT-3 |
| Cicli tra moduli | accounts ↔ transactions, accounts → investments → accounts, investments ↔ funds, funds ↔ payroll, imports ↔ payroll/funds, users ↔ `platform/auth`, timeoff ↔ Trek | TR-7, INV-9, FND-11, IMP-1, USR-1, TOF-1 |
| Copie di `ActionResult` / `failed()` / `revalidate()` | 26 tipi, 14 + 14 funzioni | PLT-8, TR-1 |
| Definizioni zod di «data civile» | 14 | TR-2, MCP-4 |
| File non di test oltre 500 righe (dominio e platform) | 42 | TR-10, `audit-platform.md` |
| Componenti: Server Component async / client | 61 file (68 funzioni) / 89 file | `audit-ui.md` §1 |
| Tabelle scritte due volte (tabella + lista mobile) | 28 su 40, con 3 soglie diverse | UI-DS-3 |
| Valori Tailwind arbitrari | 364 | UI-DS-16, UI-DS-17 |
| File componente oltre 400 righe | 19, pari al 41% delle righe `.tsx` | `audit-ui.md` §15 |
| Chiavi di traduzione | 3.619 per lingua; 381 valori ripetuti | UI-MSG-1 |

## 2.2 Sintesi per modulo

Le voci in **grassetto** toccano un numero che l'utente vede. La decisione è presa (14/11/2026, H5): vale il numero
delle pagine ([`09-risks.md`](09-risks.md) §9.5, D1-D11).

| Modulo | Doppioni principali | Stesso numero in due modi | Confini deboli | File grandi |
|---|---|---|---|---|
| accounts | Upsert dei saldi ×4 (ACC-6), serie di fine mese ×3 (ACC-10), mapper REST e MCP (ACC-5) | **ACC-1** patrimonio e riquadri da due query; **ACC-2** `previousNetWorth` sempre `null` su API, MCP e mail; **ACC-3** totale dello snapshot; ACC-4 due definizioni di saldo a una data | Ciclo con transactions e investments (ACC-8); controlli generici nella cartella `ui/` (ACC-11) | `service.ts` 963 (ACC-7) |
| transactions | Tre query «candidati» (TRX-8), chiave del beneficiario ×3 (TRX-9), filtri REST e MCP divergenti (TRX-5) | **TRX-1** `net` include i trasferimenti; **TRX-2** somme senza valuta; TRX-3 quota per categoria ×3; **TRX-4** spesa del periodo da 4 query | Wallet dentro job, azioni, servizio e tassonomia (TRX-6) | 5 file oltre 500 righe (TRX-7) |
| budgets | Query dei limiti copiata (BUD-3), controlli conto e categoria ×5 (BUD-7) | BUD-4 tre confronti spesa/limite; BUD-5 famiglia di categorie in JS e in SQL | Solo MCP, nessuna rotta REST (BUD-2); job che importa dalla UI (BUD-6) | — |
| subscriptions | Insieme «già trovati» ×3 (SUB-2), aritmetica delle date riscritta (SUB-5) | **SUB-1** prossimi 30 giorni con due finestre; SUB-3 costo mensile ×2; **SUB-4** saldo proiettato senza conversione | Legge tabelle e costanti di transactions (SUB-8) | — |
| pockets | Mappa dei nomi dei conti ×5 (POC-7), query in ciclo (POC-3) | **POC-1** saldo solo dentro la vista; **POC-2** saldo libero senza conversione | Ripartizione dell'interesse nella query (POC-5) | `pocket-actions.tsx` 725 (POC-6) |
| interests | Schemi in `service.ts` (INT-5), 4 calcoli di periodo (INT-6) | INT-3 due soglie di «lettura vecchia»; **INT-4** interesse maturato sommato in 4 punti | Client Wallet e sync Wallet nel modulo (INT-1, INT-2) | — |
| imports | Limite dei file controllato in 4 punti (IMP-4), upload ×3 (PAY-2) | — | Il modulo generico importa payroll e funds (IMP-1, IMP-2); `after()` di Next nella rotta Hono (IMP-3) | — |
| users | Costruzione di `Ctx` ×3 (USR-3), enum delle preferenze ×3 (USR-4) | — | Ciclo con `platform/auth` (USR-1); infrastruttura dei job nel modulo (USR-2); preferenze di timeoff qui (USR-6) | — |
| investments | Formula di `performance` ×3 (INV-2), `abs` ×6 (INV-6), decimali a virgola fissa ×4 (INV-12) | **INV-1** tre rendimenti per servizio; **INV-3** valore ricalcolato e valore salvato; **INV-5** export con archiviati e senza conversione | Ciclo con funds (INV-9); BCE chiamata dal modulo (INV-10) | 7 file oltre 500 righe; `sync.ts` 2.195 (INV-7) |
| funds | Rendimento ×5 (FND-4), helper copiati tra file (FND-6), periodo e grafici doppi con investments (FND-7, FND-8) | **FND-1** due motori vivi; **FND-2** «versato» ×3, uno senza `transfer_in`; **FND-3** valore del fondo ×4 | Ciclo con payroll (FND-11) | 10 file oltre 500 righe (FND-12) |
| payroll | `readLater` ×3 (PAY-1), pipeline di estrazione ×2 (PAY-3), sweep ×2 (PAY-4) | — | Scrive nelle tabelle pensione (PAY-5); tipi di ferie doppi con timeoff (PAY-6); nessuna rotta di lettura (PAY-8) | `service.ts` 858 (PAY-7) |
| timeoff | `nudgeTrek` ×2 (TOF-3), risultati e `failed()` ×2 (TOF-5) | TOF-4 residuo da tre fonti | Trek nello schema, nelle regole e nel servizio (TOF-1, TOF-2); nessuna rotta e nessuno strumento MCP (TOF-7) | `rules.ts` 781 (TOF-8) |
| integrations | Client HTTP ×3 stili (INTG-4), motore dei pass ×3 (INTG-5), esito del pass ×4 (INTG-6) | — | Un provider registrato in 5 posti (INTG-3); azioni di connessione per provider (INTG-7) | 7 file oltre 500 righe (INTG-9) |
| jobs | Elenco «dopo la sync» doppio (JOB-4) | — | Job nel processo web (JOB-1); nessun recupero delle righe `running` (JOB-2); heartbeat su file (JOB-5); limiti in memoria di processo (JOB-9) | — |
| API e MCP | Serializzatori ×2 per 4 risposte (API-2); autenticazione ×2 (API-5) | **API-3** stessa risorsa, parametri e default diversi | L'export è un terzo contratto (API-7); `list_budgets` solo su MCP (MCP-2) | — |
| platform | Conversione valutaria ×2 (**PLT-1**: può differire di un centesimo), `requireAdminCtx` ×3 (PLT-4), impostazioni sigillate ×3 (PLT-5) | PLT-1 | Barrel delle tabelle e test di architettura limitato (PLT-3); tre canali di notifica (PLT-6) | `auth.ts` 511 (PLT-7) |
| Interfaccia | 28 tabelle doppie (UI-DS-3); home e dettaglio di Funds e Investments scritti due volte (UI-FND-1, UI-INV-1); hero ×8 (UI-INV-2); card andamento ×3 (UI-INV-3); card composizione ×3 (UI-ACC-3); «aggiorna valore» ×4 (UI-ACC-5); segmented ×4, stepper ×3, KPI ×8 (UI-DS-1, UI-DS-2, UI-DS-5); stato di sync ×5 (UI-ACC-1) | — | `src/ui` dipende da `next/link`, `next/navigation` e `@/platform` (UI-DS-20); componenti condivisi in una cartella di route (UI-INV-10) | 19 file (`audit-ui.md` §15) |

## 2.3 Cosa è già solido e va protetto

| Punto | Riferimento |
|---|---|
| `Ctx` e `userScoped(ctx)` sono usati in modo uniforme da interfaccia, API, MCP e job | PLT-10 |
| L'MCP chiama gli stessi servizi dell'API: i numeri coincidono a livello di servizio | MCP-1 |
| `monthlyFigures` è l'unica fonte di `GET /summary`, `get_summary` e della mail mensile | API-6 |
| Le 153 azioni sono già chiamate in modo imperativo (`await` in `startTransition`): zero `useActionState`, zero `<form action>`. Il passaggio a REST è meccanico | `audit-ui.md` §1 |
| `src/ui` non conosce il catalogo dei messaggi: le etichette arrivano come prop | UI-DS-20 |
| Funds usa già il controllo di periodo di Investments | UI-EXP-1 |
| Investments condivide già i serializzatori tra API e MCP | API-2 |

## 2.4 Componenti e strutture condivise che il refactor crea

Elenco completo con i riferimenti: `audit-ui.md` §16. Le strutture di dominio:

| Struttura | Sostituisce | Voci |
|---|---|---|
| `domain/shared/money`: tipo `Money { cents, currency }`, `Fixed(scale)`, divisione arrotondata, `parseAmount` | 4 implementazioni di decimali, 5 arrotondamenti, somme senza valuta | TR-4, INV-12, SUB-6, ACC-9 |
| `domain/shared/dates` e `domain/shared/period`: un tipo `Period`, un parser, `monthEndSeries` | 6 calcoli di periodo, 3 serie di fine mese | INT-6, FND-7, ACC-10, SUB-5 |
| `domain/returns`: `simple`, `onNetCapital`, `modifiedDietz`, `xirr`, `moneyWeighted` | 8 calcoli di rendimento tra investments e funds | INV-1, INV-2, FND-4 |
| `domain/fx`: una sola conversione, `ensureRange` | 2 percorsi di conversione, 2 download BCE | PLT-1, PLT-2, INV-10 |
| `api-contract`: primitive zod, DTO, schema dei filtri, `Result` ed errori, scope per risorsa | 14 `civilDate`, 4 mapper doppi, 26 tipi di risultato | TR-2, TR-3, API-2, PLT-8, MCP-3 |
| Porte del dominio: `MovementsSource`, `LedgerPosting`, `CategorySync`, `LeaveCalendarSync`, registro `DocumentKind → parser` | Import diretti tra moduli e integrazioni; 3 pipeline di documenti | INTG-1, INTG-2, TOF-1, IMP-1, PAY-3 |
| `plugin-host`: `runPass` (lock, run, skip, revoca, backoff), client HTTP comune, manifest | 3 motori di pass, 3 stili di client, 5 registri | INTG-3, INTG-4, INTG-5 |
| `worker`: registro dei job composto, trigger multipli, coda persistente, reaper, `forEachUser` | 20 job via HTTP, 8 `after()`, righe orfane | JOB-1…JOB-8, USR-2 |
| Read-model unico per area (`InvestmentsSnapshot`, `fundValueAt`, `spending`, `pocketBalances`, `netWorth`) | Più query per lo stesso numero | ACC-1, TRX-4, INV-3, INV-4, FND-1, FND-3, POC-1 |

## 2.5 Difetti probabili trovati dall'audit

Non sono parte del refactor: sono correzioni. Decisione di Mattia del 14/11/2026 (H4, [`09-risks.md`](09-risks.md) §9.5):
BUD-1 si corregge subito, come `fix`, in una sotto-issue separata; ACC-2 e FND-2 si correggono nel passo R2 del loro
modulo, con un commit separato e un test.

| Voce | Difetto | Effetto |
|---|---|---|
| ACC-2 | `previousNetWorth` è sempre `null` in `GET /summary`, `get_summary` e nella mail mensile (`src/platform/reports/monthly.ts:44`, `src/modules/accounts/queries.ts:414`) | API, MCP e mail non hanno la variazione che Overview mostra |
| BUD-1 | `stopLimit` scrive la riga `stopped` senza `accountId` (`src/modules/budgets/service.ts:106-113`) | Un budget per conto si ferma sull'ambito sbagliato. **Corretto** (H4) in `main` a `86e3d43`, tag `v0.10.2`, con un test di integrazione. Le righe già scritte non sono toccate |
| FND-2 | Una delle tre funzioni del «versato» esclude `transfer_in` (`src/modules/funds/queries.ts:96`) | Export e riga «Fondi» di Investments possono differire dalle pagine Funds |
| JOB-2 | Una riga `running` rimasta dopo un riavvio non viene mai chiusa (`src/platform/jobs/housekeeping.ts:18-23`) | 4 righe ferme in produzione. Si chiude in N2 e R1 |

## 2.6 Voci nuove della revisione sulla standardizzazione

Revisione approvata da Mattia il 14/11/2026 (decisione H17). Base: `main` a `9be59db`, sola lettura, nessun test eseguito.
Sono solo voci **non** presenti nei tre file di dettaglio. I totali di §2.0 e §2.1 restano quelli dell'audit di
`5fbbdbc`. Voci nuove: 28 (14 di priorità 1, 12 di priorità 2, 2 di priorità 3).

La logica su misura per fornitore, fondo, datore o paese è un elenco a parte, con meccanismo standard e rilascio:
[`11-standardization.md`](11-standardization.md) §11.5.

**Prodotto e interfaccia** (`OP-1`…`OP-16`)

| ID | P | Voce | Dove | Proposta | Rilascio che la chiude |
|---|---|---|---|---|---|
| OP-1 | 2 | Tre parole per «movimento»: «Expenses» (pagina e menu), «Transactions» (tab del conto), «Movements» (mail e dialog). La pagina contiene anche entrate e giroconti | `messages/en.json:1457`, `:80`, `:1635` | Una parola nel glossario | R5a |
| OP-2 | 2 | «Connection» ha due significati: addebiti di un conto e collegamento a un fornitore. In più: «provider», «service», «integration» | `messages/en.json:1648`; `src/app/(app)/settings/integrations/page.tsx:80` | «Collegamento» per il legame, «sorgente» per il fornitore | R5a |
| OP-3 | 1 | Stati diversi per la stessa idea: `active/paused/cancelled`, `active/paused/archived`, `active/paused`, `active/archived` | `src/modules/subscriptions/rules.ts:7`; `src/modules/pockets/rules.ts:5`; `src/modules/interests/rules.ts:8`; `src/modules/funds/rules.ts:5` | Un tipo comune in `shared`: attivo · in pausa · concluso. I valori salvati non cambiano | R2 (tipo, per modulo); R5a (etichette) |
| OP-4 | 1 | «Connections» del conto duplica Subscriptions: la prima è scritta a mano, la seconda rilevata | `src/modules/accounts/rules.ts:31` | Una sola lista, in Subscriptions, con il filtro per conto (decisione ST-13) | R5a; R5f (tabella) |
| OP-5 | 1 | Tre regole «il beneficiario contiene…»: versamenti dei fondi, abbonamenti, interessi | `src/modules/funds/schema.ts:173-199`; `src/modules/subscriptions/rules.ts:170`; `messages/en.json:2203` | Un abbinatore di movimenti (E7) e un componente «Collega a un movimento» | R2 (transactions); R3 (componente) |
| OP-6 | 2 | Tre parole per la ricorrenza: «Billing», «Payout», «Accrues on»; «Accrual» significa tre cose | `messages/en.json:2076`, `:2198`, `:1879`, `:1823`, `:2150` | Un controllo «Frequenza» con le stesse opzioni (estende UI-INT-1) | R3 (`RecurrenceField`); R5a (testi) |
| OP-7 | 1 | Creazione con forme diverse: conto = pagina intera; budget e fondo = dialog | `src/app/(app)/accounts/new/page.tsx:20`; `src/modules/budgets/ui/add-budget.tsx:69` | Una forma: dialog a passi, campi facoltativi dopo (estende UI-DS-11) | R3 |
| OP-8 | 2 | Il conto nuovo chiede 8 campi | `src/modules/accounts/ui/account-form.tsx:71-110` | 4 campi: nome, tipo, valuta, saldo. Il resto in Impostazioni | R5b |
| OP-9 | 2 | Stati vuoti con uscite diverse: Overview porta a «Aggiungi conto», Expenses a una scheda tecnica | `src/app/(app)/page.tsx:44-46`; `src/app/(app)/expenses/page.tsx:230` | Regola: ogni stato vuoto offre per prima l'azione manuale | N3 (Expenses); R3 (regola) |
| OP-10 | 2 | «Archive» e «Remove» quasi uguali sul conto; «Remove» archivia o cancella secondo riferimenti nascosti | `src/modules/accounts/ui/settings-form.tsx:117-140` | Un'azione con l'esito scritto prima della conferma | R5b |
| OP-11 | 2 | La ricerca rapida trova solo pockets, fondi e abbonamenti | `src/app/(app)/palette-actions.ts:19-23` | Aggiungere conti, movimenti, budget, categorie | R5a |
| OP-12 | 1 | Scelte di notifica in tre posti: per budget, in Profile, per conto | `src/modules/budgets/jobs.ts:72`; `messages/en.json:1620` | Una pagina «Avvisi» | R5e |
| OP-13 | 2 | Payroll e Time Off usano parole diverse per le stesse assenze; giorni e ore nella stessa pagina | `messages/en.json:4144`, `:4542`, `:4474`, `:4487` | Nomi dai tipi di assenza dell'utente; un'unità per tipo | R5g |
| OP-14 | 2 | La revisione della busta paga mostra parole del lettore («TRATTENUTE CORPO», «Line 8003») | `messages/en.json:4237`, `:4370` | Testi del profilo, non del core | R5g |
| OP-15 | 1 | Dettaglio con forme diverse: Pockets e Interests hanno una pagina `[id]`; Subscriptions una pagina sola con dialog | `src/app/(app)/pockets`, `src/app/(app)/subscriptions` | Regola unica: lista più pagina di dettaglio quando l'oggetto ha uno storico | R3 |
| OP-16 | 1 | Tolleranza di Subscriptions dichiarata due volte | `src/app/(app)/subscriptions/page.tsx:26`; `src/modules/subscriptions/schema.ts:47` | Un solo valore | R2 (subscriptions) |

**Codice e dati** (`OT-1`…`OT-12`)

| ID | P | Voce | Dove | Proposta | Rilascio che la chiude |
|---|---|---|---|---|---|
| OT-1 | 1 | Due servizi di creazione e due file di azioni per lo stesso oggetto (il fondo) | `src/modules/funds/service.ts:120-151`; `src/modules/funds/pension/service.ts:106-158`; `src/modules/funds/actions.ts`; `src/modules/funds/pension/actions.ts` | Un servizio `createFund` con le sorgenti | N6 |
| OT-2 | 1 | Check DB generati da liste TypeScript sui vocabolari aperti (tipo di documento, fonte festiva, fonte di cambio, tipi di sync ed entità, prodotti): un'estensione non può aggiungere un valore senza una migrazione | `src/modules/imports/schema.ts:65`; `src/platform/holidays/schema.ts:61`; `src/platform/fx/schema.ts:28` | Check di formato più registro (regola M13) | N6 (tipo di documento); R2 (per modulo); R5f |
| OT-3 | 1 | Chiavi di traduzione costruite a runtime con lo slug del fornitore o del tipo, con cast | `messages/it.json:3585-3607`; `src/modules/investments/ui/dialogs.tsx:984`, `:1050-1051`, `:1119-1122`; `src/modules/funds/ui/fund-valuations.tsx:315` | Testi dal descrittore (E5; regola M14) | N6 (funds); R3 (investments) |
| OT-4 | 1 | Due liste dello stesso concetto («va a Trek»), con un difetto probabile | `src/modules/timeoff/actions.ts:112-113`; `src/modules/timeoff/rules.ts:38` | Una lista; test (decisione ST-23) | N5 |
| OT-5 | 1 | Ogni lettura di un fondo pensione carica tutta la mappa dei codici e tutte le buste paga di payroll | `src/modules/funds/pension/queries.ts:160-178` | Con l'evento `PayslipApplied` il fondo ha già i suoi dati | R2 (payroll, funds) |
| OT-6 | 1 | Indirizzo e formato della chiave del servizio AI dichiarati in 3 punti | `src/modules/payroll/llm.ts:11`; `src/platform/settings/llm-probe.ts:19`; `src/platform/settings/service.ts:48-58` | Un solo client, con l'indirizzo dalle impostazioni (E8) | R2 (users e impostazioni) |
| OT-7 | 1 | Mappa lingua → locale ripetuta in 5 file | `src/modules/users/rules.ts:26-27`; `src/modules/subscriptions/ui/present.ts:99`; `src/modules/timeoff/ui/settings-forms.tsx:191`; `src/app/(app)/settings/profile/preferences-form.tsx:42`; `src/app/(app)/settings/integrations/schedule-control.tsx:152` | Una funzione in `shared` | R0 |
| OT-8 | 2 | Codice e testi senza uso (`isHoliday`, `isBookable`, chiavi dei tipi di fondo); commento «impostazione dell'admin» su una costante | `src/platform/holidays/rules.ts:100-107`; `messages/it.json:3243-3249`; `src/modules/imports/rules.ts:70` | Rimozione; commento corretto | R0 |
| OT-9 | 2 | Il commento dice «24 mesi per ccxt», la costante vale 365 giorni. Non verificato quale è in vigore | `src/platform/integrations/investments/source.ts:119`; `src/platform/integrations/ccxt/binance.ts:1186` | Verifica con un test; una sola costante dichiarata dal descrittore | R2 (investments) |
| OT-10 | 2 | Indirizzi di un sito esterno salvati come dati di ogni fondo | `src/modules/funds/pension/rules.ts:95-101` | Nel modello di fondo | N6 |
| OT-11 | 3 | La lettura della tariffa esegue un `INSERT … on conflict do nothing` di 13 righe a ogni lettura di un fondo pensione | `src/modules/funds/pension/service.ts:90-97` | Sparisce con `fund_fees` | N6 |
| OT-12 | 3 | Time Off legge saldi ed eventi di payroll a ogni vista per decidere «goduto» | `src/modules/timeoff/queries.ts:129-155` | Con `LeaveBalanceSource` il saldo arriva già calcolato; misura prima e dopo | R2 (payroll) |

Limiti di questa analisi: i riferimenti di riga sono di `9be59db`; non sono letti per intero `sync.ts` di investments,
le cartelle dei provider e le migrazioni SQL. OT-4 e OT-9 chiedono un test prima di ogni correzione.

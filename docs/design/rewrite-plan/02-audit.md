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

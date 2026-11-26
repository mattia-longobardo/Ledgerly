# Versamenti e prelievi di Investments come movimenti nei conti (PERS-651)

Stato: **approvata da Mattia il 26/11/2026 (§5, decisioni), parte server implementata (PERS-655).** Stage 1 di
PERS-651 (PERS-652): proposta; stage 2 (PERS-655): server; stage 3: client.
Base: `main` a `cee7a120` (`v0.78.1`), produzione `v0.78.0`. Dati di produzione: solo conteggi, nessun importo o nome.

Decisioni precedenti che questa proposta rispetta:

- PERS-342 (`v0.9.0`): un servizio manuale (`provider = manual`) è una vista in sola lettura del suo conto. I suoi
  movimenti sono i movimenti del conto. Nessuna duplicazione in `investment_operations`.
- R5d (PERS-575, PERS-587): il portafoglio manuale (`provider = portfolio`) ha cassa e posizioni scritte a mano.
  Investments scrive il valore del conto (fonte `portfolio` in `balance_entries`). D2: cassa mai sotto zero.
- R5g: Payroll standard. Fondo pensione standard con fonti di contribuzione `payroll`, `bank_debit`, `manual`.
- PERS-627 (`v0.78.0`): un giroconto non ha categoria, ha conto di partenza e di arrivo, può andare verso o da un
  «conto esterno», e il dialog di modifica cambia il tipo spesa/entrata/giroconto. Regole in
  `packages/domain/src/modules/transactions/rules/giroconti.ts`: una coppia certa si forma da sola, un pareggio è
  una proposta per la persona.
- 12-account-modes.md §12.2: un movimento a mano cambia il saldo del conto.

## 1. Stato attuale

### 1.1 Dove si salvano deposit e withdrawal

| Oggetto | Tabella | Modulo e API | Relazione con i conti |
|---|---|---|---|
| Versamento/prelievo di un **portafoglio manuale** | `investment_events` + `investment_operations` (gamba `main`, `kind` `deposit`/`withdrawal`) | `recordOperation` in `packages/domain/src/modules/investments/service/operations.ts`; route «Record operation» in `apps/api/src/investments/portfolio-routes.ts` (`PORTFOLIO_ONLY`) | Cambia la cassa del portafoglio, quindi il valore del conto (fonte `portfolio`). **Nessun movimento in `transactions`.** `investment_events.transaction_id` esiste (unico, `on delete set null`) e accetta un movimento della banca nella stessa direzione (`requireLinkable`), ma il dialog non lo offre |
| Servizio **manuale** (PERS-342) | Nessuna operazione | `refuseValueChange` rifiuta deposit/withdrawal | I movimenti sono quelli del conto. Solo «Update value» |
| Servizio **sincronizzato** (eToro, Binance) | `investment_events` con `origin` del provider | Sync del provider | Deposit/withdrawal arrivano dal provider. Nessun movimento in `transactions` |
| Versamento a un **fondo pensione** | `fund_operations` (`source`, `source_id` → `fund_contribution_sources.kind`) | `packages/domain/src/modules/funds/service/operations.ts`, `debits.ts` | `fund_operations.transaction_id` collega già un movimento della banca: a mano (`/funds/{id}/movement-candidates`, select nel form del versamento) o in automatico per una fonte `bank_debit`. Nessun movimento creato |
| Trasferimenti tra servizi | `investment_events.transfer_group_id` | `service/transfers.ts` | Solo tra due servizi, non con un conto bancario |

Patrimonio netto: legge `balance_entries`. Per un conto gestito da Investments vale la sola fonte `portfolio` da
`managed_since` (`saveProviderBalance`, `accounts/service/balances.ts`). I giroconti non entrano nei totali di
entrate e spese.

Payroll: una busta paga non crea movimenti. Il netto arriva in banca come entrata sincronizzata. Il contributo a un
fondo con fonte `payroll` è trattenuto dal lordo: **non passa mai da un conto della persona.**

### 1.2 Produzione (conteggi in sola lettura, 26/11/2026)

| Dato | Conteggio |
|---|---|
| Conti `checking` sincronizzati (Enable Banking), con IBAN | 2 |
| Conti `other` sincronizzati (Enable Banking) | 2 |
| Conti `investment` a mano | 1 (il conto del portafoglio Fineco) |
| Servizi Investments | 1, `provider = portfolio`, modo `assets` |
| Deposit nel portafoglio | 1, **senza** `transaction_id` |
| Withdrawal | 0 |
| Fondi pensione, operazioni dei fondi, fonti di contribuzione | 0 |
| Buste paga | 0 |
| Movimenti in `transactions` | 429, tutti `origin = provider`, tutti su conti bancari; 0 sul conto Fineco |
| Movimenti giroconto con conto di arrivo = conto Fineco | 1, senza gemello (`transfer_group_id` nullo) |
| Proposte di giroconto aperte | 0 |
| Conto Wallet collegato | nessuno |

### 1.3 Prova Playwright

Metodo: copia del database di produzione (dati delle sessioni, credenziali, OAuth e collegamenti esclusi) in un
Postgres temporaneo su tmpfs, su una rete Docker `--internal`. L'immagine di produzione (`ledgerly:latest`) gira su
quella rete, senza plugin, egress e worker. Sessione temporanea solo nella copia. Lo script blocca ogni richiesta
che non è GET/HEAD. Alla fine: container, rete e file cancellati. La produzione non ha ricevuto scritture.

Risultato (testo mascherato, solo etichette e conteggi):

- **Investments → Fineco → Activity:** «Deposits and withdrawals · 1». «Record operation» → tipo Deposit: campi
  `Date`, `Amount`, `Note`. **Nessun campo per il conto di partenza o per un movimento della banca.**
- **Accounts → Fineco:** origine «From portfolio», «Shown in Investments». Tab «Transactions»: segnaposto
  «Transactions arrive with expenses. This account's transactions will appear here once the expenses module lands.»
  (testo vecchio, vedi §6).
- **Expenses:** il movimento della banca verso Fineco c'è, come giroconto «From <conto corrente> → to <Fineco>»,
  con lo stato **«Waiting for the other side»**.

## 2. Rischio di doppio conteggio: verificato

L'uscita dalla banca verso Fineco **arriva già** dalla sincronizzazione Enable Banking. In produzione il deposit e il
movimento della banca hanno **lo stesso importo e lo stesso giorno**; il movimento è già un giroconto verso Fineco che
aspetta il gemello. Wallet non è collegato e il conto del portafoglio non ha una sorgente (R5d rifiuta un portafoglio
su un conto letto da una sorgente), quindi sul lato Fineco non arriva nessun movimento.

Conseguenze, se un deposit crea un movimento nuovo senza abbinarlo:

1. Un'**entrata** nuova su Fineco più l'uscita della banca (giroconto): le entrate del mese crescono di un importo che
   è solo uno spostamento di denaro.
2. Un **giroconto** nuovo «da conto corrente → Fineco»: il conto corrente mostra due uscite verso Fineco.
3. Un movimento a mano sul conto Fineco cambia il saldo (§12.2): il valore del conto conta la stessa somma due volte,
   una nella cassa del portafoglio e una nel movimento.

Abbinamento proposto (§3.1): il movimento creato dal deposit è la **gamba di arrivo** del giroconto che la banca ha
già. Il deposit non crea una seconda uscita.

## 3. Proposta

Regola generale: ogni versamento o prelievo che la persona scrive in Investments ha **una gamba sul conto di
investimento** in `transactions`. La gamba non cambia il saldo del conto (il valore resta della fonte `portfolio` o
del fondo). La gamba si abbina al movimento della banca, quando c'è, con le regole dei giroconti di PERS-627.

### 3.1 Tipo di default del movimento

| Opzione | Compromesso |
|---|---|
| A. Sempre entrata (prelievo: spesa) | Semplice. Gonfia entrate e spese: quasi ogni versamento è uno spostamento dai conti della persona. Mattia deve correggere quasi ogni movimento |
| B. Sempre giroconto da «conto esterno» | Neutro nei totali. Non usa il movimento della banca: il giroconto della banca resta «Waiting for the other side» |
| **C. Giroconto abbinato, altrimenti giroconto da «conto esterno»** | Usa la regola dei giroconti: un movimento della banca libero, stesso importo, direzione opposta, ±3 giorni (`MATCH_DAYS`), **unico** → coppia; più candidati → proposta; nessuno → giroconto da «conto esterno». Più lavoro lato server |

**Raccomandazione: C.** Nel dialog «Record operation» il deposit ha un campo nuovo **«Dal conto»** (prelievo:
**«Verso il conto»**), precompilato con il candidato:

- `<movimento della banca proposto>` (default se unico);
- un altro dei conti della persona (giroconto con gemello in attesa, come in PERS-627);
- «Conto esterno» (giroconto da fuori);
- «Entrata» (prelievo: «Spesa»).

Dopo il salvataggio, Mattia cambia il tipo della gamba dal dialog di modifica dei movimenti (PERS-627), come per ogni
altro movimento. Il cambio di tipo non tocca il deposit.

### 3.2 Il conto di investimento lato conti

Il conto esiste già: un servizio di Investments è sempre su un conto di Accounts (PERS-342, R5d; in produzione 1
conto `investment`). **Nessun conto nuovo.** La gamba va su quel conto.

Vincolo tecnico [DEV]: la gamba non deve cambiare il saldo del conto (§2, punto 3). Opzioni:

| Opzione | Compromesso |
|---|---|
| **a. Origine nuova `investments` in `TRANSACTION_ORIGINS`** (migrazione additiva del check) | Esplicita: esclusa dai punti di saldo dei movimenti a mano, dall'invio alla sorgente, dai doppioni CSV. Ogni filtro su `origin` va controllato |
| b. Origine `manual` ed esclusione dei conti con `managed_since` dal ricalcolo dei saldi | Nessun valore nuovo. Regola nascosta: un movimento a mano vero su quel conto non cambierebbe più il saldo |

**Raccomandazione: a.**

### 3.3 Eccezione payroll

Si riconosce **per operazione, non per conto**: un'operazione di un fondo con fonte di contribuzione `payroll`
(`fund_contribution_sources.kind = 'payroll'`, componenti `worker`/`employer`/`tfr`) non crea una gamba. Il denaro non
passa da un conto della persona, quindi non c'è un movimento da mostrare.

| Caso | Movimento |
|---|---|
| Fondo alimentato solo dal payroll | Nessuno |
| Stesso fondo, versamento volontario a mano o con addebito (`manual`, `bank_debit`) | Sì, come §3.1. Con `bank_debit` il collegamento esiste già (`fund_operations.transaction_id`): la gamba si abbina a quel movimento |
| Portafoglio manuale | Sempre (non ha payroll) |

Alternativa scartata: un flag «alimentato dal payroll» sul conto. Bloccherebbe anche i versamenti volontari sullo
stesso fondo.

### 3.4 Modifica e cancellazione

| Azione | Effetto |
|---|---|
| Deposit modificato (data, importo) | La gamba segue, nella stessa transazione del database. Se l'abbinamento non regge più (importo diverso), la coppia si scioglie e il movimento della banca torna «in attesa» |
| Deposit modificato («Dal conto») | Cambia il gemello o il tipo della gamba |
| Deposit cancellato | La gamba creata da Ledgerly si cancella. Il movimento della banca **resta** (è del provider) e torna giroconto «in attesa» |
| Gamba modificata in Expenses | Tipo, categoria, nota: sì. Importo, data, conto: no, con il rimando «Modifica in Investments» |
| Gamba cancellata in Expenses | Rifiutata, con il rimando a Investments |
| Movimento della banca rimosso dalla sorgente | `transaction_id` diventa `null` (FK esistente); la gamba resta giroconto da «conto esterno» |

Le revisioni (`investment_operation_revisions`, A2) restano come oggi.

### 3.5 Storico

In produzione: 1 deposit, 0 withdrawal, 0 operazioni di fondi.

| Opzione | Compromesso |
|---|---|
| A. Nessun movimento per lo storico | Nessun rischio. Il giroconto della banca resta «in attesa» |
| **B. Passaggio una tantum con la regola di §3.1** | Coppia certa → gamba abbinata; pareggio → proposta; nessun candidato → gamba da «conto esterno». In produzione: 1 coppia certa (stesso importo, stesso giorno) |
| C. Tutto come «conto esterno» | Doppio conteggio visivo con la banca |

**Raccomandazione: B**, come job idempotente (nessun dato distrutto), con prova a secco e conteggi prima del deploy.

### 3.6 Effetti

| Area | Effetto |
|---|---|
| Patrimonio netto, Overview, snapshot | Nessuno: la gamba non cambia il saldo (§3.2) |
| Totali entrate/spese, budget | Nessuno con il giroconto (default). Se Mattia cambia la gamba in entrata o spesa, conta come ogni entrata o spesa |
| P&L Investments, «Net deposits», XIRR | Nessuno: il deposit resta l'operazione della cassa |
| Abbonamenti | `linkedPayeeKeys` usa già `investment_events.transaction_id`: il versamento abbinato resta fuori dagli abbonamenti |
| Export | Le gambe compaiono nell'export dei movimenti, con l'origine nuova |
| `/api/v1` | Campi additivi: sul movimento `investmentEventId` (o `linkedOperation`); sul corpo di deposit/withdrawal `from`/`to` (id del movimento, id del conto, `outside`, `income`/`expense`). `transactionId` esistente resta valido |
| MCP | `list_transactions` mostra le gambe con l'origine; nessun tool nuovo |
| Servizi sincronizzati (eToro, Binance) | Stessa regola dei portafogli manuali (decisione 4, §5.2) |

### 3.7 Divisione del lavoro per lo stage 2

Ordine: contratto, conferma di perimetro, route, dominio, test. Una PR per parte, migrazioni additive.

**Server** (`ledgerly-server2` o Homelab Homeserver Dev; dopo il merge di PERS-650, che tocca gli stessi file dei
giroconti):

| Passo | File principali |
|---|---|
| Contratto: `from`/`to` su deposit/withdrawal, campo di collegamento sul movimento | `packages/api-contract/src/investments/bodies.ts`, `register.ts`; `packages/api-contract/src/transactions/*` |
| Migrazione additiva: origine `investments`; `investment_events.leg_transaction_id`, `fund_operations.leg_transaction_id` (uuid, FK, unici) | `packages/domain/src/modules/transactions/rules/vocabulary.ts`, schema di investments e funds, `packages/domain/drizzle/` |
| Porta di transactions per creare, aggiornare e cancellare una gamba e abbinarla (regole di `giroconti.ts`, senza duplicarle) | `packages/domain/src/modules/transactions/service/giroconti.ts`, `index.ts` |
| Deposit/withdrawal con gamba nella stessa transazione | `investments/service/operations.ts`, `apps/api/src/investments/portfolio-routes.ts` |
| Fondi: gamba per `manual`/`bank_debit`, nessuna per `payroll` | `funds/service/operations.ts`, `debits.ts` |
| Saldo: origine `investments` fuori dai punti dei movimenti a mano | `accounts/service/derived-balances.ts`, `transactions/manual.ts` |
| Regole in Expenses: importo/data/conto e cancellazione rifiutati per una gamba | `apps/api/src/transactions/manual.ts`, `routes.ts` |
| Job storico (§3.5) e test: unit delle regole, integration su `ledgerly_test_3`, «stessi numeri» su patrimonio e P&L | `apps/worker`, `*.itest.ts` |

**Client** (Ledgerly Client Dev, dopo il contratto):

| Passo | File principali |
|---|---|
| Campo «Dal conto»/«Verso il conto» nel dialog «Record operation» e nel form del versamento del fondo | `apps/web/src/modules/investments/ui/` (dialog delle operazioni), `apps/web/src/modules/funds/ui/contribution-fields.tsx` |
| Activity: il collegamento al movimento | `apps/web/src/app/(app)/investments/[accountId]/activity/` |
| Expenses: etichetta «Investments» sulla gamba, campi bloccati con rimando | dialog di modifica di PERS-627 |
| Accounts → conto di investimento: tab «Transactions» con l'elenco, al posto del segnaposto | `apps/web/src/app/(app)/accounts/[id]/` |

## 4. Domande per Mattia

Solo le domande che cambiano il risultato. Ognuna ha il default raccomandato.

1. **Tipo di default.** Un versamento senza movimento della banca corrispondente diventa giroconto da «conto
   esterno» (neutro nei totali) o entrata? **Default: giroconto da «conto esterno»**; lo cambi tu in entrata.
2. **Abbinamento automatico.** Se esiste un solo movimento della banca con lo stesso importo, direzione opposta e
   ±3 giorni, Ledgerly lo abbina da solo o te lo propone sempre? **Default: da solo se unico, proposta se più di
   uno** (come i giroconti di PERS-627).
3. **Storico.** Il deposit già presente riceve il movimento (in produzione: 1 abbinamento certo)? **Default: sì,
   con il passaggio una tantum di §3.5.**
4. **Servizi sincronizzati (eToro, Binance).** Anche i loro deposit e withdrawal devono avere una gamba nei conti?
   **Default: no per ora**; oggi non ce ne sono in produzione. Si aggiunge con la stessa regola quando serve.

## 5. Decisioni

Risposta di Mattia su PERS-651 (26/11/2026): «ok default per tutti tranne 4».

| # | Decisione |
|---|---|
| 1 | Versamento senza movimento della banca corrispondente: **giroconto da «conto esterno»**. Mattia cambia il tipo dopo, nel dialog di modifica (PERS-627) |
| 2 | Un solo movimento della banca corrispondente: **abbinamento automatico**. Più candidati: **proposta** |
| 3 | Il deposit già presente in produzione **riceve** la gamba, con un passaggio una tantum e la stessa regola |
| 4 | **Cambiato rispetto al default:** la stessa regola vale **anche per i servizi sincronizzati** (eToro, Binance) |

### 5.1 Come funziona (implementazione, PERS-655)

- **Gamba.** Ogni deposit/withdrawal (gamba `main` di `investment_events` con `kind` `deposit`/`withdrawal`) ha
  un movimento in `transactions` sul conto del servizio: `origin = investments`, `type = transfer`, importo con
  segno (deposit `+`, withdrawal `−`), giorno del deposit a mezzogiorno. Il collegamento è
  `investment_events.leg_transaction_id` (unico, `on delete set null`). Un servizio manuale (PERS-342) non
  scrive gambe.
- **Saldo.** L'origine `investments` è fuori dai punti dei movimenti a mano e dai movimenti del provider
  (`dailyNetByAccount` e `manualMovementsByAccount` filtrano `provider`/`manual`): patrimonio, Overview, P&L e
  Net deposits non cambiano. Una lettura della sorgente non tocca mai la gamba.
- **Abbinamento.** Dopo ogni scrittura, la gamba passa per le regole dei giroconti (`linkOwnTransfers`, nessuna
  regola duplicata): candidato unico → coppia; più candidati → proposta. Nessun candidato e nessuna proposta →
  giroconto da «conto esterno» (decisione 1). Una gamba «esterna» scelta da Ledgerly (senza il marcatore `type`)
  resta **libera**: quando il movimento della banca arriva con una sincronizzazione successiva, la regola la
  abbina. Una scelta della persona (marcatore `type`) non cambia più.
- **Scelta nel dialog.** Corpo di deposit/withdrawal: `transactionId` (movimento della banca, abbinamento a mano)
  oppure `counterpart` (`account`, `outside`, `none`). Senza i due: regola automatica.
- **Modifica.** Nuovo importo: la coppia si scioglie, il movimento della banca torna «in attesa», la gamba torna
  alla regola. Stesso importo, altro giorno: la coppia resta. Le scelte della persona restano.
- **Cancellazione.** Il deposit cancellato cancella la gamba nella stessa transazione; il movimento della banca
  resta e torna «in attesa».
- **Expenses.** Tipo, categoria, nota e visibilità: sì. Importo, data, conto: no (solo i movimenti `manual` si
  modificano). Cancellazione di una gamba nascosta: rifiutata (resta finché c'è il deposit).
- **Fondi (eccezione payroll per operazione).** Un versamento `voluntary` (a mano, da addebito `bank_debit` o da
  documento) ha la gamba sul conto del fondo (`fund_operations.leg_transaction_id`), abbinata al movimento che lo
  ha pagato (`transaction_id`) quando c'è. Un contributo da busta paga (`contribution`) non ha gamba. Le altre
  operazioni (adesione, trasferimento in entrata, switch, riscatto) non hanno gamba: fuori da questa decisione.
- **Moduli.** Investments e Funds non importano transactions: scrivono le gambe con la porta `CashLegs`,
  realizzata da transactions (`cashLegsOfTransactions`) e collegata in `wireDomain` (10-modularity.md §10.3).

### 5.2 Servizi sincronizzati (decisione 4)

| Domanda | Risposta |
|---|---|
| Dove salvano depositi e prelievi | `investment_events` con `origin = provider` e la gamba `main` con `kind` `deposit`/`withdrawal`, importo convertito nella valuta del conto (`sync/events.ts`, `writeEvents`). L'id del provider è in `provider_links` (`entity_type = investment_event`) |
| Come si legano | Dopo ogni passaggio dei flussi (`runFlows`) e dopo il primo collegamento (`connect.ts`), `linkCashLegs` scrive la gamba degli eventi che non ce l'hanno e le abbina con la stessa regola |
| Come si evita il doppio conteggio | Un evento già visto (stesso id del provider) non si scrive una seconda volta (`writeEvents` salta gli id noti). Una gamba per evento (`leg_transaction_id` unico); `linkCashLegs` scrive solo le gambe mancanti o cambiate: un passaggio che rilegge gli stessi eventi non scrive niente |
| Taglio dei 12 mesi (PERS-145) | Un evento cancellato dal taglio perde la gamba al passaggio successivo (le gambe senza evento vanno via, il movimento della banca torna «in attesa») |
| Scollegamento | Il servizio torna manuale (PERS-342): le gambe già scritte restano come sono, nessuna gamba nuova |

### 5.3 Storico (decisione 3)

`node /app/worker.mjs --link-investment-legs`, una volta dopo il deploy: per ogni persona, ogni servizio
(`linkAllCashLegs`) e ogni fondo (`linkAllFundLegs`). Stampa solo conteggi. Idempotente: un secondo passaggio
scrive 0 righe. Prima del deploy: prova sui conteggi (in produzione 1 deposit, 1 abbinamento certo atteso).

### 5.4 Contratto per il client (stage 3)

| Dove | Campo |
|---|---|
| `POST /investments/{accountId}/operations`, deposit/withdrawal | `transactionId` (esistente) o `counterpart`: `{ kind: "account", accountId }`, `{ kind: "outside" }`, `{ kind: "none" }`, nullable, opzionale |
| Activity (`activityRow`) | `legTransactionId`: id della gamba in Expenses, nullable |
| Registro del fondo (`operationRow`) | `legTransactionId`: id della gamba, nullable |
| Movimenti (`transactionLine.origin`) | valore nuovo `investments`: la gamba. Il client mostra «Investments» e blocca importo, data, conto e cancellazione |
| Cambio di tipo della gamba | `PUT /transactions/{id}/transfer` e `POST /transactions/transfer-pairs` (esistenti, PERS-627) |

### 5.5 Valute diverse (PERS-659, rilievo R2 di PERS-658)

Un servizio in USD (eToro) riceve un bonifico in EUR: con la sola regola «stesso importo, stessa valuta» la gamba
non si abbinava mai e il bonifico restava «in attesa», contro la decisione 4.

| Punto | Regola |
|---|---|
| Quando vale | Solo tra una gamba `origin = investments` e un movimento di altra origine, in due valute. Due movimenti della banca in valute diverse non si abbinano mai; con la stessa valuta nulla cambia (PERS-627/PERS-650) |
| Conversione | Importo del bonifico convertito nella valuta della gamba con `fx_rates` (ultima fixing BCE al giorno del bonifico, `convertCents`). Senza tasso: nessun abbinamento |
| Scarto massimo | **3 %** della gamba (`FX_GAP_PERCENT` in `rules/giroconti.ts`) |
| Resto della regola | Invariato: ±3 giorni (±5 con l'IBAN), un solo candidato → coppia, più candidati alla stessa distanza → proposta, nessuno → «conto esterno» |
| Lettura | `rowsAround` legge anche tutte le gambe di Investments e i movimenti nei ±5 giorni di ciascuna; i tassi si leggono solo se c'è una gamba e più di una valuta (`service/conversion.ts`) |

Perché 3 %: il costo di cambio del broker su un versamento in un'altra valuta (eToro: circa 0,5–1,5 % secondo il
metodo) più il movimento del cambio tra il giorno del bonifico e quello dell'accredito (di solito sotto l'1 % in
3 giorni). Uno scarto più largo aumenta il rischio di abbinare il bonifico sbagliato; una parità resta comunque una
proposta. In produzione (26/11/2026, sola lettura) non ci sono servizi eToro o Binance collegati né loro
depositi/prelievi: 0 casi con valuta diversa oggi.

Rollback: nessuna modifica allo schema; lo script `investments-cash-movements-rollback.sql` resta valido.

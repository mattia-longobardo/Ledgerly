# Piani di acquisto a quote intere (PERS-681)

Stato: **design approvato** (domande D1 e D2 decise da Mattia il 27/11/2026). Lo sviluppo del server è PERS-703.
Base: `main` a `f5dcac55` (`v0.80.0`). Sostituisce il modello «un piano = uno strumento» di
[`11-standardization.md`](rewrite-plan/11-standardization.md) §11.3.1 per i piani nuovi e convertiti; il job, «Da fare» e
l'abbinatore del conto di addebito (E7) di §11.3.2-§11.3.3 restano.

Tutti i nomi (A, B, C) e i numeri di questo documento sono inventati.

## 0. Decisioni già prese da Mattia (27/11/2026)

| # | Decisione |
|---|---|
| M1 | Il resto non speso passa all'esecuzione dopo: si somma all'importo |
| M2 | Se una quota costa più della parte dello strumento, lo strumento si salta in quell'esecuzione; la sua parte va nel resto |
| M3 | L'esecuzione **propone** gli acquisti. Mattia conferma e può correggere il prezzo reale prima che le operazioni esistano |
| M4 | I piani R5d esistenti si convertono: strumenti e cadenza restano, l'importo va inserito di nuovo |
| D1 | Le commissioni sono **fuori** dall'importo: 200 € di titoli, commissioni in più |
| D2 | Un'esecuzione scartata o non confermata **passa** il suo importo all'esecuzione dopo |

Modello: un piano ha 1-10 strumenti con una percentuale ciascuno (somma 100 %), un importo per esecuzione e una cadenza
giornaliera, settimanale o mensile. Si comprano solo quote intere.

## 1. Stato attuale (R5d, `v0.63.0`/`v0.65.0`)

| Oggetto | Dove | Limite rispetto al modello di Mattia |
|---|---|---|
| `investment_plans` | `packages/domain/src/modules/investments/schema.ts` | Un solo `asset_id`; importo **o** quantità; `fractions` facoltativo; frequenze `week`, `month`, `quarter` (niente giornaliera) |
| `investment_plan_runs` | idem | Un prezzo e un acquisto per esecuzione; nessun resto |
| `investment_operations.plan_run_id` (unico) | idem | Un'operazione per esecuzione |
| Calcolo | `rules/plans.ts` (`quantityFor`, `instalment`) | Arrotonda per difetto, ma il resto si perde |
| Job `investment-plans` | `apps/api/src/investments/plans-job.ts` → `runDuePlans` | Crea le scadenze, cerca il prezzo, propone o scrive (`auto`) |
| API | `packages/api-contract/src/investments/plans.ts` | `GET/POST/PATCH /plans`, `runs`, `confirm`, `skip`, `debit`, `backfill` |
| UI | `apps/web/src/modules/investments/ui/plans/` | Scheda «Piani», dialog del piano, conferma della rata, rate passate |
| «Da fare» | `plan_run_to_confirm`, `plan_run_no_cash`, `plan_run_price_missing` | Restano, con le esecuzioni nuove |

## 2. Algoritmo di allocazione

### 2.1 Ingressi

- `importo`: centesimi nella **valuta del piano** = valuta del conto del Portafoglio manuale.
- `resto_in`: il `resto_out` dell'esecuzione chiusa precedente (0 alla prima). Può essere negativo (§2.4).
- `budget = max(0, importo + resto_in)`.
- Per ogni strumento `i`: peso `w_i` in punti base (1-10000, somma 10000), prezzo `p_i` nella valuta del suo mercato,
  cambio BCE `r_i` del giorno del prezzo (unità della valuta dello strumento per unità della valuta del piano;
  `r_i = 1` se le valute coincidono).

### 2.2 Passi

Per ogni strumento, indipendentemente dagli altri:

1. `obiettivo_i = floor(budget × w_i / 10000)` in centesimi della valuta del piano.
2. `prezzo_piano_i = p_i / r_i`, alla scala dei prezzi (`PRICE_SCALE`), senza arrotondare ai centesimi.
3. `q_i = floor(obiettivo_i / prezzo_piano_i)`: quote intere, mai frazioni.
4. `q_i = 0` → riga **saltata** (M2), motivo `too_expensive`.
5. `spesa_i = round_half_up(q_i × p_i / r_i)` in centesimi (stessa regola di `positionCents` e `atRate`).

Poi: `spesa = Σ spesa_i`, `resto_out = budget − spesa`.

Regole:

- **Arrotondamento:** sempre per difetto su obiettivo e quote; solo la spesa in centesimi è arrotondata al più vicino.
  Un'esecuzione non spende mai più del budget al prezzo di chiusura.
- **Ordine:** non conta. Nessun secondo giro ridistribuisce il resto in quella esecuzione: il resto va nell'esecuzione
  dopo (M1), dove alza gli obiettivi. Le righe si mostrano per peso decrescente, poi per nome.
- **Limite del resto:** per ogni strumento quel che resta è minore di una quota (o pari all'obiettivo, se saltato). Il
  resto non cresce senza limite: quando supera il prezzo di una quota, l'esecuzione dopo la compra (esempio 1, run 4).
- **Commissioni:** fuori dal budget (come R5d): si registrano su ogni operazione e non cambiano il resto (D1).
- Funzione pura `allocateWholeShares(input) → { lines, spentCents, carryOutCents }` in `rules/plans.ts`, con gli esempi
  sotto come test unitari.

### 2.3 Esempi (numeri inventati)

**Esempio 1: tre strumenti, il resto si accumula e poi si spende.** Importo 200,00 €; A 50 %, B 30 %, C 20 %, tutti in €.

| Run | Budget | A (prezzo → quote → spesa) | B | C | Spesa | Resto |
|---|---|---|---|---|---|---|
| 1 | 200,00 | 41,30 → 2 → 82,60 | 18,75 → 3 → 56,25 | 9,10 → 4 → 36,40 | 175,25 | 24,75 |
| 2 | 224,75 | 42,00 → 2 → 84,00 (obiettivo 112,37) | 19,10 → 3 → 57,30 | 9,40 → 4 → 37,60 | 178,90 | 45,85 |
| 3 | 245,85 | 42,00 → 2 → 84,00 | 19,10 → 3 → 57,30 | 9,40 → 5 → 47,00 | 188,30 | 57,55 |
| 4 | 257,55 | 42,00 → 3 → 126,00 | 19,10 → 4 → 76,40 | 9,40 → 5 → 47,00 | 249,40 | 8,15 |

**Esempio 2: uno strumento saltato (M2).** Importo 100,00 €; A 70 % a 55,00 €, B 30 % a 38,00 €.

| Run | Budget | A | B | Spesa | Resto |
|---|---|---|---|---|---|
| 1 | 100,00 | obiettivo 70,00 → 1 → 55,00 | obiettivo 30,00 < 38,00 → **saltato** | 55,00 | 45,00 (15,00 di A + 30,00 di B) |
| 2 | 145,00 | 101,50 → 1 → 55,00 | 43,50 → 1 → 38,00 | 93,00 | 52,00 |

**Esempio 3: strumento in un'altra valuta.** Piano in €, importo 150,00 €; A 60 % a 24,10 €; B 40 % a 31,00 $,
cambio BCE 1 € = 1,0800 $ (B = 28,7037 €).

| Riga | Obiettivo | Quote | Spesa |
|---|---|---|---|
| A | 90,00 € | 3 | 72,30 € |
| B | 60,00 € | 2 | 62,00 $ = 57,41 € |
| Totale | | | 129,71 €, resto 20,29 € |

L'operazione di B si registra in $ con il suo cambio (`fxRate`), come una registrazione a mano.

**Esempio 4: prezzo reale corretto alla conferma (M3).** Proposta dell'esempio 3. Mattia esegue gli ordini e scrive i
prezzi reali: A 24,18 €, B 31,05 $. Le quote restano 3 e 2 (gli ordini sono già fatti).
Spesa: 72,54 € + 62,10 $ (57,50 €) = 130,04 €. Resto: 150,00 − 130,04 = **19,96 €**.

### 2.4 Correzioni alla conferma

- Mattia può cambiare per ogni riga: prezzo, quote (anche su una riga saltata), commissione; per l'esecuzione: la data.
- Se cambia un prezzo senza toccare le quote, la UI chiede l'anteprima al server (§5) e mostra le quote ricalcolate
  come proposta; le quote scritte a mano vincono sempre.
- `resto_out = budget − spesa reale`. Se i prezzi reali sono più alti, il resto è negativo e riduce il budget
  dell'esecuzione dopo (mai sotto 0, §2.1). Così la somma investita nel tempo segue l'importo.

## 3. Modello dati e migrazione

Migrazione additiva `0084_plan_baskets` (numero indicativo: il primo libero al momento dello sviluppo).

### 3.1 `investment_plans` (colonne nuove)

| Colonna | Tipo | Nota |
|---|---|---|
| `model` | `text not null default 'single'`, check `single`/`basket` | `single` = piano R5d non convertito; `basket` = modello nuovo |
| `execution_amount_cents` | `bigint null`, `> 0` | Importo per esecuzione nella valuta del conto. `null` su un piano convertito: «Importo da inserire» |

Le colonne R5d (`asset_id`, `amount_cents`, `quantity`, `fractions`, `mode`) restano e restano valide, così l'immagine
precedente legge ogni riga. Su un piano `basket` nuovo: `asset_id` = strumento col peso più alto, `amount_cents` =
importo, `quantity` null, `fractions` false, `mode` `propose`. Il codice nuovo non le legge per `basket`.

Frequenze: `PLAN_FREQUENCIES` diventa `day`, `week`, `month`, `quarter` (check allargato). La UI nuova offre
giornaliera, settimanale, mensile (con `interval`: ogni N); `quarter` resta solo in lettura per i piani R5d e la
conversione lo scrive come `month` con `interval × 3`.
Cadenza `day`: solo lunedì-venerdì. Se il primo prezzo trovato è di un giorno dopo la scadenza e un'altra esecuzione
del piano ha quel giorno, l'esecuzione si chiude `skipped` con motivo `market_closed` (borsa chiusa) e il suo importo
non si aggiunge.

### 3.2 Tabella nuova `investment_plan_instruments`

| Colonna | Nota |
|---|---|
| `id`, `user_id` | come le altre tabelle |
| `plan_id` | → `investment_plans`, `on delete cascade` |
| `asset_id` | → `investment_assets`, `on delete restrict` |
| `weight_bp` | `integer`, 1-10000 |
| `position` | ordine di inserimento |

Vincoli: `unique (plan_id, asset_id)`. La somma 10000 e il limite di 10 righe si controllano nel servizio (in una
transazione), non con un trigger.

### 3.3 `investment_plan_runs` (colonne e stati nuovi)

| Colonna | Nota |
|---|---|
| `budget_cents` | `importo + resto_in` fissato alla creazione della proposta |
| `carry_in_cents` | `resto_in` usato |
| `carry_out_cents` | scritto alla chiusura (`recorded`, `skipped`, `expired`); `null` finché è aperta |

Stati: si aggiunge `expired` (§4.3). Motivi (`PLAN_RUN_REASONS`): si aggiungono `market_closed`, `amount_missing`.

### 3.4 Tabella nuova `investment_plan_run_lines`

| Colonna | Nota |
|---|---|
| `run_id` | → `investment_plan_runs`, `on delete cascade` |
| `asset_id`, `weight_bp` | copia del piano al momento della proposta: cambiare il piano non cambia una proposta aperta |
| `price`, `price_currency`, `price_on`, `fx_rate` | prezzo di chiusura usato e cambio BCE; `null` se manca |
| `target_cents`, `quantity`, `spent_cents` | risultato di §2.2 (proposta); alla conferma i valori reali |
| `state` | `buy`, `too_expensive`, `price_missing` |
| `event_id` | → `investment_events`, `on delete set null`, **unico**: l'acquisto registrato della riga |

Vincoli: `unique (run_id, asset_id)`, `unique (event_id)`. `investment_operations.plan_run_id` resta solo per i piani
`single`: un piano `basket` lega l'acquisto dalla riga, non dall'operazione.

### 3.5 Conversione dei piani R5d (M4)

Nella stessa migrazione, per ogni piano con `model = 'single'`:

1. `insert into investment_plan_instruments (plan_id, asset_id, weight_bp) select id, asset_id, 10000`.
2. `update investment_plans set model = 'basket', execution_amount_cents = null`. Nessuna colonna R5d cambia:
   `quarter` diventa `month × 3` in lettura (`scheduleOf`), non nei dati, così il rollback non deve ripristinare niente.
3. Le esecuzioni aperte (`pending`, `waiting_price`, `proposed`) di un piano convertito → `skipped` con motivo
   `amount_missing`; quelle chiuse restano come storico.
4. Il job ignora un piano `basket` con `execution_amount_cents` null. «Da fare» mostra l'evento nuovo
   `plan_amount_missing` («Piano {nome}: inserisci l'importo»). Salvato l'importo, la prima esecuzione è la prossima
   scadenza da oggi, con `resto_in = 0`.

La modalità `auto` sparisce dalla UI: ogni esecuzione `basket` è una proposta (M3).

### 3.6 Rollback

1. **Immagini:** `ledgerly:pre-pers-681` e `ledgerly-cron:pre-pers-681` (nomi da confermare nel rilascio) +
   dump prima del deploy (la conversione scrive righe esistenti).
2. **SQL** `docs/design/investments-plans-whole-shares-rollback.sql` (lo scrive lo sviluppo), in una transazione:
   - pausa dei piani che l'immagine precedente eseguirebbe male: `update investment_plans set state = 'paused'
     where model = 'basket' and (created_at >= <deploy> or frequency = 'day' or id in (select plan_id from
     investment_plan_instruments group by plan_id having count(*) > 1))`; l'elenco va a Mattia, che li riattiva dopo;
   - `update investment_plans set model = 'single'` (le colonne R5d sono intatte, §3.5);
   - `update investment_plan_runs set state = 'skipped' where state = 'expired' or (state in ('pending',
     'waiting_price', 'proposed') and id in (select run_id from investment_plan_run_lines))`;
   - le righe di `investment_plan_run_lines` e `investment_plan_instruments` restano: l'immagine precedente non le legge.
   - Un piano convertito con la sua quota R5d riprende come prima; un piano modificato dopo il deploy (strumenti,
     importo) riprende con i valori R5d vecchi, quindi è in pausa se ha più strumenti o cadenza `day`.
3. **Per sempre** (mai necessario per le immagini): `drop table investment_plan_run_lines, investment_plan_instruments`,
   `drop column` delle colonne nuove, check di frequenza e stato come prima, riga di `drizzle.__drizzle_migrations`.

Gli acquisti già confermati restano operazioni normali in ogni caso.

## 4. Flusso della proposta

### 4.1 Quando nasce

Job `investment-plans` (giornaliero, dopo le chiusure; `runDuePlans`), per ogni piano `basket` attivo con importo:

1. crea l'esecuzione della scadenza (`unique (plan_id, due_on)`), recupero dopo un fermo: al massimo 12 (`MAX_CATCH_UP`);
2. cerca per ogni strumento la prima chiusura alla data di scadenza o dopo, e il cambio BCE di quel giorno;
3. **tutti i prezzi presenti** → calcola §2.2, scrive righe e budget, stato `proposed`, evento `plan_run_to_confirm`;
4. **almeno un prezzo mancante** → stato `waiting_price`, nuovo tentativo il giorno dopo (§6);
5. tutto nella transazione dell'esecuzione; due giri del job nello stesso giorno non scrivono niente due volte.

Il `resto_in` è il `carry_out_cents` dell'ultima esecuzione chiusa del piano. Se la precedente è ancora aperta, vale
§4.3.

### 4.2 Dove la vede Mattia

- «Da fare» (Home): «Piano {nome}: conferma gli acquisti del {data}» → apre la proposta.
- Portafoglio manuale → scheda «Piani» → riga del piano → elenco esecuzioni: l'esecuzione `proposed` è in alto con il
  pulsante «Rivedi».
- Dialog «Rivedi la proposta»: una riga per strumento (peso, prezzo di chiusura e giorno, quote, spesa, stato);
  campi modificabili prezzo, quote, commissione; in fondo budget, spesa, resto per la prossima; data dell'esecuzione.

### 4.3 Conferma, modifica, scarto, scadenza

| Azione | Effetto |
|---|---|
| **Conferma** | Un acquisto (`buyWithin`) per ogni riga con quote > 0, tutti o nessuno, in una transazione; `event_id` sulla riga; esecuzione `recorded`, `carry_out = budget − spesa reale`. Cassa insufficiente → errore `negative_cash`, niente scritto: Mattia registra prima il versamento |
| **Modifica** | Solo nel dialog, prima della conferma: anteprima dal server (§5), nessuna scrittura |
| **Scarta** | Esecuzione `skipped`, nessun acquisto, `carry_out = budget` (M1, D2: tutto il non speso passa) |
| **Non confermata alla scadenza dopo** | Quando il job crea la proposta della scadenza seguente, la precedente ancora `proposed` diventa `expired` con `carry_out = budget`, e il budget nuovo la include. Così ogni proposta aperta ha un `resto_in` certo e ce n'è al massimo una per piano |

Dopo la conferma un acquisto è un'operazione normale: si modifica con la modifica delle operazioni (PERS-683). La
modifica successiva **non** ricalcola il resto dell'esecuzione (il resto si fissa alla conferma).

Conto di addebito (E7): l'abbinatore cerca un movimento in uscita pari a spesa + commissioni dell'esecuzione, come oggi.

## 5. API `/api/v1`

Contratto in `packages/api-contract/src/investments/plans.ts` e `plan-schemas.ts`; voce in `docs/api-changelog.md`.

| Metodo e percorso | Cambio | Body / risposta |
|---|---|---|
| `GET /investments/{accountId}/plans` | Esteso | Ogni piano: `model`, `currency`, `amount` (null = da inserire), `instruments[] {assetId, name, weight}`, `frequency`, `interval`, `day`, `carry` (resto attuale), `nextDueOn`, `state` |
| `POST /investments/{accountId}/plans` | Cambiato | `{ name, amount, instruments: [{ assetId \| instrument+mic, weight }], frequency: day\|week\|month, interval, day, startOn (≥ oggi), endOn \| runsLimit, fee, debitAccountId }`. Il corpo R5d (`assetId` + `amount`/`quantity`) → 400 `plan_model_retired` |
| `PATCH /investments/{accountId}/plans/{planId}` | Esteso | Stessi campi; vale dalla prossima esecuzione, una proposta aperta non cambia |
| `GET …/plans/{planId}/runs` | Esteso | `budget`, `carryIn`, `carryOut`, `lines[] {assetId, weight, price, priceCurrency, priceOn, fxRate, target, quantity, spent, state, eventId}` |
| `POST …/runs/{runId}/preview` | **Nuovo** | `{ lines: [{ assetId, unitPrice?, quantity? }] }` → stessa forma di una run, nessuna scrittura. Unico punto di calcolo: la UI non calcola |
| `POST …/runs/{runId}/confirm` | Cambiato per `basket` | `{ on?, lines: [{ assetId, quantity, unitPrice, fee? }] }` → `{ eventIds[] }`. Errori: 409 `not_editable`, 422 `negative_cash`, 400 riga mancante o strumento estraneo |
| `POST …/runs/{runId}/skip` | Invariato | Scarto (§4.3) |
| `POST …/runs/{runId}/debit` | Invariato | |
| `GET/POST …/plans/{planId}/backfill` | Solo `single` | Un piano `basket` → 400 `plan_model_retired`: un acquisto passato si registra a mano |

MCP: `list_investment_plans` (sola lettura) restituisce la forma estesa. Eventi «Da fare»: `plan_run_to_confirm`,
`plan_run_price_missing`, `plan_amount_missing` (nuovo). `plan_run_no_cash` resta per i piani `single`.

## 6. Prezzo del giorno

- **Fonte:** le chiusure giornaliere del registro strumenti (`instrument_prices`, porta `marketPrices().closesUpTo`),
  scritte dalla lettura dei prezzi (`prices-job`, plugin `ledgerly-plugin-prices`, Yahoo) sul mercato scelto
  dall'asset. Cambio: tabella BCE di `platform/fx`. **Nessuna fonte nuova.**
- **Dipendenza da PERS-682:** se la diagnosi trova che gli strumenti del portafoglio non hanno chiusure (simbolo,
  mercato, job), ogni esecuzione va nel caso «prezzo mancante» finché la correzione non è in produzione. Il design
  non cambia; cambia solo quanto spesso Mattia scrive il prezzo a mano.
- **Prezzo mancante:** l'esecuzione resta `waiting_price` e il job riprova ogni giorno. Dopo `isStale` (5 giorni
  lavorativi, come R5d) diventa `proposed` lo stesso: righe con prezzo calcolate, righe senza prezzo `price_missing`
  con quote 0, evento `plan_run_price_missing`. Mattia scrive il prezzo nel dialog; l'anteprima calcola le quote.
  La conferma rifiuta una riga `price_missing` senza prezzo e con quote > 0.
- **Cambio mancante** (strumento in altra valuta): stesso trattamento del prezzo mancante.

## 7. Schermate e stati

Scheda «Piani» del Portafoglio manuale (sostituisce `apps/web/src/modules/investments/ui/plans/`). Ogni testo in
`messages/en.json` e `messages/it.json`. Tabella a 1440 px, lista sotto `md` con gli stessi controlli (F9).

| Stato | Cosa si vede |
|---|---|
| **Vuoto** | «Nessun piano di acquisto» + «Nuovo piano» |
| **Piano da completare** (convertito) | Riga del piano con avviso «Importo da inserire» e pulsante «Imposta importo»; nessuna esecuzione nuova |
| **Piano attivo** | Strumenti con %, importo, cadenza, prossima esecuzione, resto attuale; menu: Modifica, Pausa, Elimina (chiede conferma) |
| **Proposta** | Esecuzione `proposed` in alto con «Rivedi»; dialog di §4.2; badge «Saltato: quota oltre la sua parte» e «Prezzo da inserire» sulle righe |
| **In attesa di prezzo** | «Prezzi non ancora disponibili, nuovo tentativo domani» |
| **Confermata** | Esecuzione «Registrata»: spesa, resto, link alle operazioni nella scheda «Attività» |
| **Scartata / Scaduta** | Esecuzione con lo stato e il resto passato alla successiva |
| **Errore** | Nel dialog: cassa insufficiente (con link a «Registra versamento»), prezzo mancante, piano cambiato da un'altra scheda (409). Nel form: somma pesi ≠ 100 %, più di 10 strumenti, strumento ripetuto |

Form «Nuovo piano»: nome; importo; strumenti (scelta dal registro come in «Registra operazione», percentuale per
riga, somma in tempo reale); cadenza (giornaliera/settimanale/mensile, ogni N, giorno); inizio, fine o numero di
esecuzioni; commissione per ordine; conto di addebito facoltativo.

## 8. Sotto-task

Un solo rilascio con il resto di PERS-681, uno alla volta con gli altri rilasci aperti. Server prima, client dopo.

### 8.1 Server — Ledgerly Server Dev 2

- Migrazione `0084_plan_baskets` (§3) con conversione e file di rollback SQL.
- `allocateWholeShares` pura + test unitari con gli esempi 1-4 e i casi limite (budget 0, resto negativo, tutte le
  righe saltate, 10 strumenti, pesi 1 bp).
- `runDuePlans` per `basket` (§4.1, §4.3 scadenza, §6), servizi `previewRun`, `confirmRun` (tutti o nessuno),
  `skipRun`; schema del piano (pesi, 10 righe); `scheduleOf` con `day` e `quarter` → `month × 3`.
- Contratto, rotte, MCP, evento `plan_amount_missing`, `docs/api-changelog.md`, `scripts/test-map.ts`.
- Test di integrazione: idempotenza del job (due giri), conversione di un piano R5d, conferma con cassa insufficiente,
  scadenza della proposta, prezzo mancante → proposta dopo `isStale`, strumento in altra valuta.

### 8.2 Client — Ledgerly Client Dev

- Scheda «Piani», form, dialog «Rivedi la proposta» con anteprima dal server, voci «Da fare».
- Messaggi `en`/`it`, a11y e tastiera (F9) per form, dialog e lista, con dati del seed `layout`.
- E2E (utenti `@example.test`, strumenti e prezzi finti nel seed), uno per stato:

| Stato | Prova E2E |
|---|---|
| Vuoto | Portafoglio senza piani: messaggio e «Nuovo piano» apre il form |
| Errore del form | Pesi 60 + 30: «Salva» rifiuta con il messaggio della somma |
| Piano attivo | Crea un piano con 2 strumenti: la riga mostra %, importo, cadenza, prossima data |
| Da completare | Piano convertito dal seed: avviso «Importo da inserire», salvato l'importo l'avviso sparisce |
| Proposta | Esecuzione `proposed` dal seed: quote e resto uguali all'esempio 1 run 1; riga saltata nell'esempio 2 |
| Modifica | Cambia un prezzo: quote e resto aggiornati dall'anteprima |
| Confermata | Conferma: stato «Registrata», due operazioni nella scheda «Attività», resto mostrato sul piano |
| Scartata | Scarta: stato «Scartata», resto = budget |
| In attesa di prezzo / prezzo mancante | Riga «Prezzo da inserire»: conferma bloccata finché il prezzo manca |
| Errore di cassa | Cassa del seed sotto la spesa: errore e link «Registra versamento», nessuna operazione scritta |

## 9. Domande per Mattia

Decise il 27/11/2026: D1 e D2 sono in §0. Rischio noto di D2: con la cadenza giornaliera, giorni senza
conferma accumulano budget.

## 10. Fuori da questo design

- Storico dei prezzi dal giorno dell'acquisto (commento di Mattia su PERS-681): lo copre la correzione dei prezzi
  dopo PERS-682.
- Esecuzione automatica senza conferma (`auto`): esclusa da M3.
- «Registra le esecuzioni passate» per i piani `basket`: non c'è; un acquisto passato si registra a mano.

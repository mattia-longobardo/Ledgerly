# Investments · redesign UX/UI

PERS-112 (28/10/2026), issue madre PERS-79. **Solo design**: nessun codice dell'app, nessuna migrazione e
nessun deploy prima dell'approvazione di Mattia.

Input:

- audit della sezione in produzione, PERS-110 (`main` @ `cb9e70f`): i riferimenti `H1`–`H12`, `S1`–`S16`,
  `D1`–`D6`, `C1`–`C2`, `M1`–`M3`, `V1`–`V4`, `A1`–`A4` rimandano a quel report;
- ricerca dei pattern, PERS-111: i riferimenti `P1`–`P10` sono i 10 pattern della sua sezione 7;
- struttura approvata da Mattia il 28/10/2026: §6 del report PERS-110. Questo documento la dettaglia e
  non propone strutture alternative;
- design funzionale `docs/design/investments.md` (§2.4 rendimento, §4 UI) e `investments-history.md`
  (PERS-100, storico stimato e selettore del periodo).

Mockup: `docs/design/investments-ux/mockups/*.html` (HTML statico con i token di `globals.css`, dati di
esempio, non reali). Gli screenshot desktop 1440 px e mobile 390 px sono allegati a PERS-112.

## 0. Principi

1. **Un periodo guida tutto** (§6.1, P4). Il periodo scelto cambia ogni numero di P&L della sezione:
   hero, KPI, grafico, lista dei servizi, posizioni e movimenti. Il periodo sta nell'URL e passa da una
   pagina all'altra e da un tab all'altro.
2. **Un numero, un valore.** Il P&L di un livello è sempre la somma delle righe del livello sotto:
   la riga "Totale" dei servizi è uguale all'hero; la somma di posizioni chiuse, aperte e commissioni
   di un servizio è uguale al P&L del servizio. Se un dato manca, una riga esplicita chiude la somma
   (§4.6). Nessun numero cambia tra due pagine per lo stesso periodo.
3. **Il P&L prima, il valore dopo** (§6.2, H1, H2). La prima riga di ogni pagina risponde a "quanto ho
   guadagnato o perso nel periodo". Il valore attuale è la seconda informazione. "Versato netto" non è
   mai una metrica di testa.
4. **Un dato parziale si mostra dal giorno in cui è affidabile**, con un'etichetta. Mai "—" quando
   l'app ha un dato valido per una parte del periodo (S1).
5. **Due livelli di profondità** (P1, NN/g). Portafoglio → servizio, con tab nel servizio. La
   diagnostica (letture, copertura, rettifiche, chiave) è nel tab Collegamento, mai in Panoramica.
6. **Stessi colori ovunque** (H7). Il colore di un servizio è `colorFor(account, index)` di
   `modules/accounts/ui/display.ts`, con l'indice di Overview: grafico, lista, composizione e Overview
   usano lo stesso colore.
7. **Stile di Ledgerly senza nuovi token.** Solo componenti esistenti: `Page`, `Card`, `CardHeader`,
   `KpiTile`, `TabLinks`, `Segmented`, `PeriodStepper`, `DateRangePicker`, `Chip`, `Badge`, `Table`
   (doppia vista desktop/mobile), `StackedArea`, `Bars`, `CompositionBar`, `Sparkline`, `Menu`.

## 1. Architettura delle informazioni

### 1.1 Mappa delle pagine

```text
Finance ▸ Investments
│
├─ /investments                         Portafoglio · Profit & Loss
│    ├─ Hero P&L del periodo + valore oggi
│    ├─ KPI: Realizzato · Non realizzato · Proventi · Commissioni e cambio
│    ├─ Grafico "Andamento"  [P&L | Valore]
│    ├─ Servizi (lista legata al grafico)
│    └─ Composizione oggi  [Servizio | Classe | Valuta]
│
├─ /investments/[accountId]             Servizio · tab "Panoramica"
├─ /investments/[accountId]/positions   Servizio · tab "Posizioni"   [Aperte | Chiuse nel periodo | Tutte le chiuse]
├─ /investments/[accountId]/activity    Servizio · tab "Movimenti"   (paginati, filtri, gruppi per mese)
├─ /investments/[accountId]/connection  Servizio · tab "Collegamento" (dati ricevuti, sync, correzioni, chiave, impostazioni)
│
└─ /investments/catalog                 Catalogo (invariato, correzioni C1–C2)
```

- I tab sono **route**, non stato client: `TabLinks` (come Settings), un URL per tab, il tasto Indietro
  funziona, ogni tab entra in `tests/e2e/a11y.spec.ts`. Il layout comune (`[accountId]/layout.tsx`)
  disegna testata, tab e selettore del periodo una volta sola.
- Collegamento e Movimenti sono tab anche per i conti manuali. Su un conto manuale "Collegamento" si
  chiama **"Impostazioni"** e contiene solo le impostazioni e le correzioni manuali (§3.6).
- Il terzo livello (dettaglio asset) **non** è una pagina nuova: una riga di Posizioni apre Movimenti
  filtrati sull'asset (`/activity?asset=<id>`). Resta il limite di due livelli (P1).
- Breadcrumb: `Investments / eToro / Posizioni`. Il selettore del periodo e il parametro `period`
  restano uguali quando si cambia tab o si apre un servizio dalla lista.

### 1.2 URL e stato

| Parametro          | Valori                       | Default            | Note                                                                    |
| ------------------ | ---------------------------- | ------------------ | ----------------------------------------------------------------------- |
| `period`           | `2026`, `2025`, …, `all`     | anno in corso      | Anno in corso = "da inizio anno" (YTD). Nessun parametro = default      |
| `from`, `to`       | `YYYY-MM-DD`                 | —                  | Intervallo personalizzato a giorni; vince su `period`                   |
| `view`             | `pnl`, `value`               | `pnl`              | Vista del grafico                                                       |
| `by`               | `service`, `class`, `ccy`    | `service`          | Solo home, raggruppamento della Composizione                            |
| `status`           | `open`, `closed`, `all`      | `open`             | Solo Posizioni                                                          |
| `type`, `q`, `p`, `asset` | tipo, testo, pagina, asset | tutti, —, 1, — | Solo Movimenti                                                       |

I parametri di oggi (`range=3m|1y|all`, `from`/`to` a mesi, `grain`) ricevono un redirect permanente
al parametro nuovo più vicino (`1y` → anno in corso, `all` → `all`, mesi → primo e ultimo giorno).
I link salvati restano validi.

## 2. Periodo

### 2.1 Controllo

Il controllo riusa i due pattern che Ledgerly ha già (audit §3): `Segmented` + `PeriodStepper` di
Accounts e `DateRangePicker` a giorni (`src/ui/date-range-picker.tsx`, `RangeGrain = "day"`).

```text
[ Anno | Tutto | Personalizzato ]   ‹  2026 · da inizio anno  ›
```

- **Anno**: lo stepper va da un anno all'altro. L'anno in corso si legge "2026 · da inizio anno",
  come in Accounts. `‹` si disattiva sul primo anno con dati, `›` sull'anno in corso.
- **Tutto**: dal primo giorno con dati a oggi. Lo stepper sparisce; al suo posto "dal 28 ott 2024".
- **Personalizzato**: apre il `DateRangePicker` a giorni (mockup `03-period-picker`) con le
  scorciatoie `2026 da inizio anno · 2025 · 2024 · Ultimi 12 mesi · Tutto`, i campi Dal/Al digitabili e
  "Applica". Il bottone mostra l'intervallo ("10 giu – 30 set 2026").
- Mobile: segmented su una riga, stepper sotto, stesso comportamento (mockup `01-home-mobile`).

### 2.2 Granularità del grafico

Automatica, senza controllo Month/Day (M3):

| Periodo           | Vista P&L                | Vista Valore             |
| ----------------- | ------------------------ | ------------------------ |
| ≤ 92 giorni       | barre per settimana      | punti per giorno         |
| un anno o ≤ 1 anno | barre per mese          | punti a fine mese        |
| Tutto, > 1 anno   | barre per anno           | punti a fine mese        |

### 2.3 Cosa segue il periodo e cosa no

| Segue il periodo                                            | È sempre "a oggi"                            |
| ----------------------------------------------------------- | -------------------------------------------- |
| P&L (hero, KPI, colonne P&L e Rendimento, contributo)       | Valore attuale, quantità, prezzo            |
| Grafico, movimenti, posizioni chiuse nel periodo             | Composizione (dice "oggi" nel titolo)        |
| Versamenti, prelievi, commissioni, proventi                 | Stato del collegamento e della chiave        |

Un periodo passato (es. 2025) mostra anche il **valore al 31/12/2025** accanto al valore di oggi.

## 3. Schermate

Le figure ASCII sono la struttura; i mockup HTML sono il riferimento visivo. Desktop = 1440 px,
mobile = 390 px.

### 3.1 Home `/investments` (mockup `01-home`, `02-home-value`)

Desktop:

```text
Investments                              [Anno|Tutto|Personalizzato] ‹ 2026 · da inizio anno › [Aggiungi servizio]

Profitto e perdita · 2026 da inizio anno
+498,44 €  +16,8 %                                               (1) da controllare: Binance, storico stimato
Valore oggi 3.473,36 € · 3 servizi · i fondi (7.884,79 €) sono in Funds

┌Realizzato──────┐┌Non realizzato──┐┌Proventi────────┐┌Commissioni e cambio┐
│ +437,90 €      ││ +114,70 €      ││ +3,12 €        ││ −57,28 €           │
│ vendite 2026   ││ posizioni aperte││ dividendi…    ││ comm. −21,40 · cambio −35,88 │
└────────────────┘└────────────────┘└────────────────┘└────────────────────┘
┌Andamento ─────────────────────────────────────────────────────── [P&L | Valore]┐
│ barre per mese impilate per servizio (colori dei servizi) + linea del cumulato │
│ tratteggio = stimato · marker ↓ prelievo ↑ versamento                          │
└────────────────────────────────────────────────────────────────────────────────┘
┌Servizi (2/3) ────────────────────────────────────┐┌Composizione oggi (1/3) ──┐
│ Servizio │ Valore oggi │ P&L 2026 │ Rend. │ Contributo │ Quota ││ [Servizio|Classe|Valuta] │
│ ● eToro  dal 10 giu │ 1.240,50 USD ≈1.061 € │ +441,84 € │ … ││ ▬▬▬▬▬▬▬▬▬▬▬▬▬           │
│ ● Directa │ …                                     ││ ● Directa 2.412 € 69 %   │
│ ● Binance Stimato │ …                             ││ …                        │
│ Totale   │ 3.473,36 € │ +498,44 € │ +16,8 % │ 100 % ││                        │
└──────────────────────────────────────────────────┘└──────────────────────────┘
```

Mobile: titolo; controllo del periodo su due righe; hero; KPI 2×2; grafico a tutta larghezza; lista
dei servizi a righe (nome e badge, sotto "valore · quota"; a destra P&L e %); riga Totale;
Composizione.

Regole:

- **Hero** (H1, H2): P&L del periodo nella valuta di visualizzazione, colorato con `toneOfSign`, e il
  rendimento % (§4.3). Sotto, il valore di oggi e il numero dei servizi.
- **KPI**: le 4 parti del P&L. La somma dei 4 KPI è uguale all'hero (§4.6). "Commissioni e cambio" è
  un KPI unico con le due parti nella nota: tiene la riga a 4 tessere come Overview.
- **Avvisi**: un solo link a destra dell'hero, con il contatore, solo se c'è un'azione da fare o un
  dato stimato (P9, regola Carbon). Il link apre il tab Collegamento del servizio interessato. Se gli
  avvisi sono più di uno, apre un `Popover` con la lista.
- **Fondi** (H9): la riga sotto l'hero dice quanto vale la sezione Funds e porta lì. Il totale di
  Investments resta "solo servizi"; l'etichetta lo dice. Decisione per Mattia (§9, scelta 4).
- **Grafico** (H5, P5): vista P&L = barre del P&L di ogni intervallo impilate per servizio, sopra e
  sotto lo zero, e la linea del P&L cumulato che parte da 0 a inizio periodo. Vista Valore =
  `StackedArea` per servizio (come Overview), con il valore a fine intervallo. Il tooltip dà, per
  l'intervallo, il P&L di ogni servizio e i flussi.
- **Servizi** (H8, P6): una riga per servizio, ordinata per contributo al P&L (valore assoluto, il più
  grande in alto). Colonne: Servizio (pallino colore, nome, tipo, badge di stato), Valore oggi (valuta
  del conto e controvalore se diversa; niente doppia riga se il valore è zero, H12), P&L del periodo,
  Rendimento, Contributo (barra con il segno e la % del totale), Quota. Category, Origin, Last update,
  30 days spariscono. La riga intera apre il servizio con lo stesso `period`.
- **Legame grafico ↔ lista**: hover o focus su una riga = la serie di quel servizio resta piena nel
  grafico, le altre al 30 %; e viceversa, hover su una serie evidenzia la riga. La legenda del grafico
  è la lista stessa: nessuna legenda doppia con numeri diversi.
- **Composizione** (H6): una sola card, `CompositionBar` + lista, con `Segmented` Servizio | Classe |
  Valuta. Sempre "oggi" (§2.3).
- **Azioni** (H10): un solo "Aggiungi servizio", nell'header.

### 3.2 Servizio · testata comune

```text
Online broker · Sincronizzato oggi 07:30 · Apri eToro ↗                       [⟳ Sincronizza] [⋯]
eToro
Panoramica  Posizioni  Movimenti  Collegamento (1)        [Anno|Tutto|Personalizzato] ‹ 2026 ›
```

- Meta (S12): tipo del servizio, stato della sincronizzazione in parole ("Sincronizzato oggi 07:30",
  "Sincronizzazione in corso", "Errore: chiave revocata"), link al sito. "Per asset" e "Managed since"
  spariscono (vanno in Collegamento → Impostazioni).
- **Azioni** (S8, A4): su un conto sincronizzato, "Sincronizza" (cooldown 60 s come oggi) e il menu
  `⋯`: Aggiungi movimento manuale, Aggiungi correzione, Sostituisci chiave, Disconnetti. Su un conto
  manuale: "Aggiungi operazione" (primario: Acquisto, Vendita, Versamento, Prelievo, Valutazione) e il
  menu `⋯` con Aggiungi correzione. Nell'ordine del DOM le azioni vengono dopo l'hero (A4).
- Il badge sul tab Collegamento conta gli avvisi con un'azione (stesso conteggio della home).
- Mobile: titolo, azioni sotto il titolo, tab su una riga (4 etichette corte entrano in 390 px:
  verificato nel mockup), selettore del periodo sotto i tab.

### 3.3 Tab Panoramica (mockup `04-service-overview`)

```text
Profitto e perdita · 2026 da inizio anno
+516,30 USD  +16,9 %
≈ +441,84 € al cambio di oggi · Valore oggi 1.240,50 USD ≈ 1.061,32 €
[dal 10 giu] Il P&L parte dal 10 giu 2026: prima di quella data eToro non fornisce i versamenti. Cosa manca →
┌Realizzato┐┌Non realizzato┐┌Proventi┐┌Commissioni┐
┌Andamento [P&L | Valore] ── banda grigia "dati non disponibili" prima del 10 giu ─┐
┌Posizioni principali (5) · Tutte →┐┌Ultimi movimenti (5) · Tutti →┐
```

- Hero nella **valuta del conto**; il controvalore nella valuta di visualizzazione è sotto, con "al
  cambio di oggi". Il P&L in EUR della home comprende l'effetto cambio e può essere diverso (V1): il
  tooltip dell'importo in EUR lo spiega.
- KPI (S2, S14): Realizzato, Non realizzato, Proventi, Commissioni. "Net invested", "XIRR" e "30 days"
  spariscono dalla Panoramica. Un KPI che il provider non può dare dice perché, in parole: eToro
  Proventi = "inclusi · eToro li somma al valore".
- **Parziale** (S1, V3): la striscia `info` dice da quale giorno il dato vale e porta al tab
  Collegamento. Il grafico mostra la parte non coperta come banda grigia con testo, non come zero.
- Grafico: come la home, con una sola serie. Marker sui versamenti (↑) e prelievi (↓) (S13).
- Posizioni principali: le prime 5 per valore, con P&L del periodo. Ultimi movimenti: i 5 più recenti
  nel periodo, con le descrizioni leggibili di §3.5.

### 3.4 Tab Posizioni (mockup `05-service-positions`)

```text
[Aperte · 3 | Chiuse nel 2026 · 2 | Tutte le chiuse · 12]                Raggruppa per [Asset | Classe]
┌Posizioni aperte ──────────────────────────────────────────────────────────────────────┐
│ Asset │ Quantità │ Prezzo medio │ Prezzo │ Valore │ P&L 2026 │ % │ Quota               │
│ NVIDIA · NVDA · Azioni · Trading │ 4,2000 │ 131,10 $ │ 145,81 $ │ 612,40 USD │ +38,40 USD │ │
│ Cassa · USD disponibili │ │ │ │ 130,00 USD │ — │ │ 10,5 %                              │
│ Totale non realizzato │ … │ 1.240,50 USD │ +58,11 USD │ 100 %                          │
└───────────────────────────────────────────────────────────────────────────────────────┘
┌Chiuse nel 2026 ───────────────────────────────────────────────────────────────────────┐
│ Asset │ Aperta → chiusa │ Investito │ Incassato │ Realizzato │ %                         │
│ Totale realizzato │ +476,59 USD                                                        │
└───────────────────────────────────────────────────────────────────────────────────────┘
Somma: non realizzato + realizzato − commissioni fuori dalle chiusure = P&L del periodo (= Panoramica)
```

- Aperte: P&L del periodo = valore oggi − valore a inizio periodo (o costo, se acquistata dopo) (§4.2).
  "Prezzo medio" e "%" sul costo restano per chi li cerca.
- Chiuse: una riga per asset con le chiusure del periodo; eToro unisce apertura e chiusura dello stesso
  `positionId` (§4.4). Il pannello "Tutte le chiuse" mostra lo storico intero (S10).
- Colonne Class / Product / Origin (S9): la classe e il prodotto vanno nella seconda riga del nome; la
  colonna Origin sparisce; una posizione manuale su un conto sincronizzato ha il badge "Manuale".
- **Dust** (V4, S9): le posizioni sotto la soglia di `isUnpricedDust` non sono in lista. Una riga
  finale "N residui senza mercato" le mostra in un `<details>`.
- Una riga apre Movimenti filtrati sull'asset.
- Azioni per riga (solo conti manuali o posizioni manuali): `⋯` → Valuta, Vendi, Chiudi.
- Mobile: righe con nome, "quantità × prezzo · medio", a destra valore e P&L.

### 3.5 Tab Movimenti (mockup `06-service-activity`)

```text
┌Versamenti 2026 ┬ Prelievi 2026 ┬ Versamenti netti ┬ Commissioni┐
│ +2.307,80 USD  │ −2.784,39 USD │ −476,59 USD      │ −18,40 USD │
│                │               │ "hai ritirato più di quanto hai versato"     │
└──────────────────────────────────────────────────────────────┘
(Tutti · 9) (Acquisti e vendite · 4) (Versamenti e prelievi · 2) (Proventi · 0) (Commissioni · 3)   [⌕ Cerca]
┌ Data │ Tipo │ Descrizione │ P&L │ Importo ┐
│ Giugno 2026 · 6 movimenti · P&L realizzato +476,59 USD │
│ 16 giu │ Vendita │ 6,87 SpaceX a 202,94 $ │ +241,44 USD │ +1.372,68 USD │
│ 16 giu │ Prelievo │ Verso eToro Money · Collega al movimento bancario │ │ −2.784,39 USD │
│ 1–50 di 934 · ‹ › │
└──────────────────────────────────────────┘
```

- **Paginazione lato server** (S3, M1): 50 righe per pagina, `ORDER BY occurred_at DESC, id DESC`,
  conteggio nel periodo e "da sempre". La pagina eToro passa da ≈ 32.000 px a ≈ 2.000 px.
- Gruppi per mese con il conteggio e il P&L realizzato del mese.
- Filtri: chip per famiglia di tipo con il conteggio; ricerca per asset o testo; periodo dal selettore.
- **Descrizioni leggibili** (S4, A3): una frase per evento, mai le gambe `base` / `quote` / `fee`.
  Quantità con al massimo 4 decimali (8 per le crypto sotto 1 unità), prezzo con la valuta, importo
  una volta sola. Modelli in §5.2.
- **P&L sulla riga** (S5): una vendita o chiusura mostra il realizzato.
- **Versamenti netti** (H2): il "Net invested" di oggi vive solo qui, con una frase che spiega il
  segno.
- "Bank movement: not linked" (S16) diventa un link "Collega al movimento bancario" solo su versamenti
  e prelievi senza collegamento, e solo dove esistono movimenti candidati (stesso importo ± 3 giorni).
  Il dialog del collegamento (D3) mostra solo i candidati, con ricerca.
- Mobile: lista a righe, "Tipo · descrizione", sotto data e P&L, a destra importo.

### 3.6 Tab Collegamento (mockup `07-service-connection`)

Due colonne (2/3 + 1/3); in mobile una colonna.

| Card                         | Contenuto                                                                                  | Problema |
| ---------------------------- | ------------------------------------------------------------------------------------------ | -------- |
| Cosa riceviamo da <servizio> | Una riga per tipo di dato: Saldi e posizioni, Movimenti, Storico del valore, Costo di carico. Icona + badge + testo + azione (Carbon). Il dettaglio per prodotto (le 16 righe di oggi) è in un `<details>` chiuso | S11, A1, V3 |
| Storico sincronizzazioni     | Ex "Readings". Ultime letture; le letture consecutive uguali si uniscono in una riga ("20 letture uguali, 18–27 ott · mostra"); le stimate in una riga sola | S6 |
| Correzioni manuali           | Ex "Open adjustments". Visibile solo se ce ne sono; altrimenti una riga che spiega cosa sono e dove aggiungerle (menu `⋯`) | S7, D4 |
| Chiave API                   | Permessi ("Solo lettura · verificata oggi"), Restrizione IP con il consiglio in parole, orari di sync, Sostituisci chiave, Disconnetti | S11 |
| Impostazioni                 | "Cosa tiene Ledgerly": Posizioni / Solo valore (ex Per asset / Total), gestito dal, link al conto in Accounts | S15, D6 |

Un conto manuale ha al posto di questo tab "Impostazioni" (solo le ultime due card e le correzioni).

### 3.7 Dialog e catalogo

- **Aggiungi asset** (D1, D2): la ricerca parte filtrata sulla classe e sulla valuta del conto (crypto
  ed EUR per Binance); nessun asset preselezionato; il prodotto è vuoto. Su un conto sincronizzato il
  dialog si apre da `⋯` → "Aggiungi movimento manuale" e una nota in parole dice: "Binance legge già
  Spot, Earn e Funding. Aggiungi qui solo quello che Binance non vede, per esempio un wallet esterno."
  I prodotti già coperti sono disabilitati nella `select`, con la stessa nota.
- **Correzione** (D4): titolo "Correggi il valore", esempio nel testo ("eToro non ha letto 120 USD
  di cassa dal 3 al 10 marzo"), campi Importo, Dal, Al (facoltativo, "senza fine" spiegato), Motivo.
- **Crea conto manuale** (D6): scelta "Posizioni (una riga per asset, P&L per asset)" / "Solo valore
  (aggiorni il totale a mano)", con un esempio per ognuna.
- **Selettore del periodo** (D5): §2.1.
- **Catalogo** (C1, C2): sottotitolo "eToro e Binance si collegano con una chiave di sola lettura";
  Kraken esce da "In arrivo"; la sezione "In arrivo" è chiusa di default con il conteggio.

## 4. Regole di calcolo del P&L

Tutte le formule sono per servizio, nella valuta del conto, salvo §4.5. Periodo `[s, e]`: `s` = primo
giorno, `e` = ultimo giorno (oggi per il periodo in corso). `V(d)` = valore a fine giorno `d` (saldi
`portfolio`, come il grafico di oggi). `V(s⁻)` = valore a fine del giorno prima di `s`.

### 4.1 P&L del periodo

```text
Flussi(s, e) = Σ deposit − Σ withdrawal   (eventi in [s, e]; apertura del servizio = flusso in entrata)
P&L(s, e)    = V(e) − V(s⁻) − Flussi(s, e)
```

È la formula del "Gain" di oggi (`investments.md` §2.4) applicata a un intervallo: il caso "da sempre"
dà lo stesso numero di oggi. Usa solo dati che esistono (saldi giornalieri e flussi), quindi vale per
ogni servizio, anche senza posizioni (modo "Solo valore") e anche per Binance con la quantità che non
torna. I trasferimenti tra servizi (`transfer_group_id`) contano come flusso per il servizio e non per
il portafoglio, come oggi.

### 4.2 Scomposizione

| Parte          | Regola                                                                                                                              | Dati                                    |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Realizzato     | Σ sulle `sell` / `close` in `[s, e]` di (incasso − costo uscito). Costo uscito = quantità × costo medio al momento della vendita (§4.4) | eventi; costo medio di `rules.ts`       |
| Non realizzato | Σ sulle posizioni aperte a `e` di (valore a `e` − base). Base = valore a `s⁻` se la posizione era aperta, altrimenti il costo        | posizioni, prezzi della lettura         |
| Proventi       | Σ `income` in `[s, e]`                                                                                                              | eventi `income` (Binance)               |
| Commissioni    | − Σ gambe `fee` in `[s, e]` non già dentro un realizzato                                                                           | gambe `fee`                             |
| Cambio         | Solo portafoglio (§4.5)                                                                                                             | `fx_rates`                              |
| Non attribuito | P&L(s, e) − (somma delle righe sopra)                                                                                               | residuo                                 |

- **Non attribuito** chiude sempre la somma (principio 2). Se è zero non si vede. Se è diverso da zero
  la UI lo mostra come riga "Altro (dati incompleti)" in Posizioni e come nota del KPI. Esempio:
  Binance con `quantity_mismatch` ha il P&L del periodo corretto (§4.1) ma il non realizzato non
  calcolabile: tutto il non realizzato cade in "Altro" con il link a "Costo di carico" in
  Collegamento.
- Una posizione aperta e chiusa nel periodo conta solo nel realizzato.
- La cassa nel conto non ha P&L (se non il cambio, §4.5).

### 4.3 Rendimento %

**Modified Dietz** sul periodo (decisione per Mattia, §9 scelta 2):

```text
Capitale medio = V(s⁻) + Σ flusso_i × (giorni da flusso_i a e) / (giorni del periodo)
Rendimento     = P&L(s, e) / Capitale medio
```

- Si calcola con gli stessi dati di §4.1, senza serie di rendimenti giornalieri. Con versamenti
  frequenti è più vicino al TWR del rendimento semplice di oggi.
- Mai annualizzato sotto un anno (P10). Per "Tutto" e per un anno intero il tooltip aggiunge
  "Rendimento annuo (XIRR): x %", con l'XIRR di oggi (`xirr.ts`) sui flussi del periodo.
- Capitale medio ≤ 0 (es. tutto ritirato prima del periodo): "non calcolabile", il P&L in valore
  resta.

### 4.4 Costo medio e realizzato

- **Costo medio ponderato**, come `rules.ts` oggi (`:364-413`): un acquisto aumenta quantità e costo;
  una vendita toglie la quantità al costo medio corrente. Alternativa FIFO: §9 scelta 3.
- Oggi il costo uscito è scartato (`rules.ts:390, 408`). Il calcolo nuovo lo tiene: la funzione pura
  che ripercorre gli eventi restituisce anche, per ogni `sell` / `close`, il costo uscito e il
  realizzato. Nessuna migrazione: si ricalcola dagli eventi, come il costo medio di oggi.
- **eToro**: apertura e chiusura sono due eventi con `externalId` `trade:<positionId>:open` e
  `:close` (`etoro/mapping.ts`). Il realizzato di una posizione = incasso della chiusura − investito
  dell'apertura (= `netProfit` di eToro, commissioni incluse). L'abbinamento usa `positionId`, non il
  costo medio.
- **Binance**: i trade hanno gambe base / quote / fee. Il costo di un acquisto = gamba quote (in EUR o
  convertita al cambio del giorno) + fee nella stessa moneta. Una fee in BNB è una commissione al
  valore di BNB del giorno.

### 4.5 Valuta e cambio

Per il portafoglio, nella valuta di visualizzazione `D`, con `fx(d)` = cambio del conto verso `D` al
giorno `d` (`fx_rates`):

```text
P&L_D(s, e)  = V(e)·fx(e) − V(s⁻)·fx(s⁻) − Σ flusso_i·fx(d_i)
P&L locale_D = P&L(s, e)·fx(e)                (P&L del servizio, convertito al cambio di fine periodo)
Cambio       = P&L_D − P&L locale_D
```

- Il KPI "Commissioni e cambio" della home ha il cambio in importo (V1), non più solo
  "incl. exchange effect".
- La riga del servizio nella home dà il P&L in `D` (con cambio); la Panoramica del servizio lo dà nella
  valuta del conto. Il tooltip dice la differenza.
- Cambio mancante per un giorno: l'ultimo cambio precedente, come oggi (§1.8 di `investments.md`).

### 4.6 Affidabilità e somme

- `reliableFrom` di un servizio = primo giorno da cui la copertura dei flussi è `complete`
  (`investment_sync_coverage`, `sync.ts:1868-1909`). Per un conto manuale = apertura.
- Se `s < reliableFrom ≤ e`: il P&L del servizio si calcola su `[reliableFrom, e]` e la UI mostra il
  badge "dal <data>". Il portafoglio somma i servizi, ognuno dal suo `reliableFrom`, e l'hero ha la
  nota "eToro dal 10 giu" (mai "—" per tutto, H1).
- Se `reliableFrom > e`: il servizio ha P&L "non disponibile" con il motivo; il portafoglio lo esclude
  e lo dice nella nota ("1 servizio escluso").
- **Stimato** (Binance, storico ricostruito): il P&L si calcola, ha il badge "Stimato" e il tratto è
  tratteggiato. Un periodo che usa anche solo un giorno stimato è stimato.
- Invarianti, coperti dai test (§7): Σ righe servizi = hero; Σ KPI = hero; Σ (realizzato + non
  realizzato + proventi + commissioni + non attribuito) = P&L del servizio; P&L "Tutto" = Gain di oggi
  quando la copertura è completa.

### 4.7 Cosa manca nei dati e come si riempie

| Dato                                 | Oggi                                                     | Come                                                                                     | Fase |
| ------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---- |
| P&L per periodo                      | no (`window.ts`)                                         | §4.1 su saldi `portfolio` e flussi: funzione pura, nessuna migrazione                    | U1   |
| Realizzato                           | costo uscito scartato                                    | §4.4: il replay degli eventi tiene il costo uscito; eToro per `positionId`               | U1   |
| Proventi, commissioni per periodo    | salvati, non sommati                                     | Somme per periodo e per asset nella stessa funzione                                      | U1   |
| Effetto cambio in importo            | solo flag                                                | §4.5 con `fx_rates`                                                                       | U1   |
| Non realizzato su eToro              | `amount` e `unrealizedPnL` sommati in un valore          | Migrazione additiva: `cost_cents` su `investment_reading_positions`, riempito da `amount` | U4   |
| Non realizzato su Binance            | nessun costo di carico                                   | Costo dai trade (§4.4); con `quantity_mismatch` resta "Altro (dati incompleti)"          | U4   |
| P&L per periodo in API e MCP         | solo "da sempre"                                         | `investments:read` con `from`/`to`; annotare in `docs/api-changelog.md`                  | U5   |

## 5. Terminologia

### 5.1 Etichette

| Oggi (en)             | Nuovo en                    | Nuovo it                         | Dove                                   |
| --------------------- | --------------------------- | -------------------------------- | -------------------------------------- |
| Gain                  | Profit & loss               | Profitto e perdita (P&L)         | Hero, colonne                          |
| —                     | Realized                    | Realizzato                       | KPI, Posizioni                         |
| —                     | Unrealized                  | Non realizzato                   | KPI, Posizioni                         |
| Income                | Income                      | Proventi                         | KPI, filtro Movimenti                  |
| Fees                  | Fees and FX                 | Commissioni e cambio             | KPI home                               |
| Net invested          | Net deposits                | Versamenti netti                 | Solo tab Movimenti                     |
| XIRR                  | Return                      | Rendimento                       | Colonna; XIRR solo nel tooltip         |
| 30 days               | —                           | —                                | Tolto                                  |
| Assets                | Positions                   | Posizioni                        | Tab                                    |
| Operations            | Activity                    | Movimenti                        | Tab                                    |
| Connection / Settings | Connection                  | Collegamento                     | Tab (conto manuale: Settings / Impostazioni) |
| Readings              | Sync history                | Storico sincronizzazioni         | Collegamento                           |
| Scope                 | (testo della riga)          | (testo della riga)               | Mai come etichetta                     |
| Open adjustments      | Manual corrections          | Correzioni manuali               | Collegamento                           |
| Add adjustment        | Correct the value           | Correggi il valore               | Menu `⋯`                               |
| What the history covers | What we get from {name}   | Cosa riceviamo da {name}         | Collegamento                           |
| Per asset / Total     | Positions / Value only      | Posizioni / Solo valore          | Impostazioni, dialog                   |
| Origin: Provider      | (nessuna; badge "Manual" per le manuali) | (badge "Manuale")    | Posizioni                              |
| dust, no market       | Leftover, no market         | Residuo senza mercato            | `<details>` in Posizioni               |
| reliable from {date}  | from {date}                 | dal {date}                       | Badge                                  |
| history incomplete    | Partial data                | Dati parziali                    | Badge, con link                        |
| Estimated             | Estimated                   | Stimato                          | Badge, tooltip                         |
| base / quote / fee    | —                           | —                                | Mai mostrati                           |

### 5.2 Descrizioni dei movimenti

| Evento                 | Modello it                                         | Modello en                                   |
| ---------------------- | -------------------------------------------------- | -------------------------------------------- |
| `buy`                  | Acquisto {qty} {asset} a {price}                   | Bought {qty} {asset} at {price}              |
| `sell`, `close`        | Vendita {qty} {asset} a {price} · P&L {pnl}        | Sold {qty} {asset} at {price} · P&L {pnl}    |
| `deposit`              | Versamento [da {source}]                           | Deposit [from {source}]                      |
| `withdrawal`           | Prelievo [verso {dest}]                            | Withdrawal [to {dest}]                       |
| `income`               | {kind} {qty} {asset} (Staking, Reward, Dividendo)  | {kind} {qty} {asset}                         |
| `fee`                  | Commissione {reason} [{asset}]                     | Fee {reason} [{asset}]                       |
| `adjustment`           | Correzione: {reason}                               | Correction: {reason}                         |
| Copy trading eToro     | aggiunge "(copy {trader})"                         | adds "(copy {trader})"                       |

## 6. Stati

| Stato                           | Home                                                                 | Servizio                                                                 |
| ------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Nessun servizio                 | `EmptyState`: "Collega eToro o Binance, o crea un conto manuale" + "Apri il catalogo" | —                                                       |
| Servizio appena collegato       | Riga con badge "Sincronizzazione in corso", P&L "—" con il motivo     | Hero "Prima sincronizzazione in corso"; tab Collegamento con l'avanzamento |
| Periodo senza dati (anno prima del primo dato) | Lo stepper non ci arriva; con un URL a mano: "Nessun dato nel 2023. Il primo è del 28 ott 2024" | Uguale                       |
| Parziale (`reliableFrom` nel periodo) | Badge "dal 10 giu" sulla riga, nota sotto l'hero              | Striscia `info` + banda grigia nel grafico (mockup `04`)                 |
| Non disponibile nel periodo     | Riga con P&L "non disponibile", esclusa dal totale, nota "1 servizio escluso" | Hero "Nessun dato affidabile nel 2025" + motivo + link        |
| Stimato                         | Badge "Stimato" sulla riga e nel tooltip; tratteggio nel grafico     | Badge sull'hero, tratteggio, riga "Storico del valore · Stimato"         |
| Tutto chiuso (valore 0)         | Riga con valore "0" su una riga sola e il P&L realizzato del periodo  | Posizioni: "Nessuna posizione aperta · 12 chiuse" con link a "Tutte le chiuse" (S10) |
| Prezzo o cambio mancante        | Link avvisi "da controllare" con il conteggio                       | Riga in "Cosa riceviamo", posizione con badge "Prezzo del 12 ott"        |
| Quantità che non torna          | —                                                                    | "Costo di carico · Da controllare" con "Vedi le differenze"; "Altro (dati incompleti)" in Posizioni |
| Chiave revocata o errore di sync | Riga con badge rosso "Errore" e link                                 | Meta in rosso, striscia in Panoramica, azione "Sostituisci chiave"       |
| Caricamento                     | `Skeleton` di hero, KPI, grafico e 3 righe                           | Uguale, per tab                                                          |

## 7. Accessibilità e mobile

- Tutti i tab e il popover del periodo entrano in `tests/e2e/a11y.spec.ts` (1440 e 400 px, due temi)
  e `keyboard.spec.ts` nello stesso commit che li aggiunge; il seed dell'utente `layout` ha un
  servizio sincronizzato con posizioni aperte e chiuse, un servizio stimato e uno parziale.
- Stato mai solo con il colore (A1): icona + badge con testo.
- Alternativa testuale del grafico (A2): "P&L 2026: +498,44 €. Mese migliore giugno (+433 €), peggiore
  maggio (−40 €). eToro +441,84 €, Directa +96,30 €, Binance −39,70 €." E la tabella dei dati del
  grafico in un `<details>` sotto il grafico.
- Descrizioni dei movimenti intere, senza `truncate` (A3); su mobile vanno a capo.
- Ordine del DOM: testata, hero, KPI, grafico, liste; le azioni dopo il titolo (A4).
- Target ≥ 24 px su chip, tab, righe cliccabili (`inline-flex min-h-6`).

## 8. Coerenza con il resto dell'app

- Accounts mostra "Last synced" dei conti di Investments dall'ultima lettura del provider, non
  "Manual" (audit §3).
- Overview e Accounts tratteggiano i mesi stimati di Binance, come Investments (V2): `MultiLine` e
  `StackedArea` ricevono `estimated` dallo stesso campo.
- Overview: la tessera "Investments" porta a `/investments` e dice "di cui servizi 3.473 €, fondi
  7.884 €" se la scelta 4 (§9) resta "solo servizi".

## 9. Scelte per Mattia

| # | Scelta                                     | Raccomandazione                                                                                                        | Alternativa                                                         |
| - | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1 | Forma del controllo del periodo            | `Anno · Tutto · Personalizzato` + stepper ‹ 2026 ›, come Accounts. L'anno in corso è "2026 · da inizio anno": un solo controllo per YTD e 2026 | Chip `YTD · 2025 · 2024 · … · Tutto · Personalizzato` (Ghostfolio): più diretto, ma la riga cresce ogni anno e su mobile va a capo |
| 2 | Rendimento %                               | Modified Dietz sul periodo, XIRR solo nel tooltip per periodi ≥ 1 anno                                                 | Rendimento semplice (P&L / (valore iniziale + versamenti)): più facile, falsato dai versamenti a metà periodo |
| 3 | Metodo del realizzato                      | Costo medio ponderato (come oggi; eToro per `positionId`)                                                              | FIFO per lotti: standard fiscale italiano per i titoli, richiede una tabella dei lotti e una migrazione |
| 4 | Totale di Investments e fondi              | Totale "solo servizi", con la riga "i fondi (7.884,79 €) sono in Funds"                                                | Fondi dentro Investments come servizi in sola lettura: un totale uguale a Overview, ma due pagine per gli stessi fondi |
| 5 | Ordine delle fasi                          | U1 motore P&L → U2 home → U3 servizio a tab → U4 posizioni → U5 coerenza e API                                         | Prima U3 (pagina del servizio, il problema più visibile), con i KPI vecchi fino a U1 |

## 10. Piano di sviluppo

Ogni fase: una PR, gate `npm run format && npm run lint && npm run typecheck && npm run format:check &&
npm test`, `npm run test:integration`, `npm run e2e`; tag `ledgerly:pre-ux-<n>` e dump prima del deploy;
verifica su `https://dash.longobardo.me`.

| Fase | Contenuto                                                                                                                                                                                       | Test                                                                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| U1   | `modules/investments/pnl.ts` (puro): `periodOf(params, today)`, `pnlOf(service, s, e)` con la scomposizione di §4.2, Modified Dietz, cambio §4.5, `reliableFrom`. Replay degli eventi con costo uscito. `investmentsPnl(ctx, period)` in `queries.ts`. Nessuna UI, nessuna migrazione | Unit: casi a mano (acquisto/vendita parziale, apertura nel periodo, flusso a metà, cambio, dust, mismatch → "Altro"); invarianti §4.6 su property test; "Tutto" = Gain di oggi. Integration: eToro realizzato per `positionId` su fixture, Binance con fee in BNB |
| U2   | Periodo nuovo (`period`, `from`/`to` a giorni, redirect dei parametri vecchi), home `/investments` di §3.1, colori di Overview, legame hover lista ↔ grafico, Composizione unica                | Unit: parsing e redirect dei parametri. E2E: il periodo cambia hero, KPI, grafico e righe; somma righe = hero; a11y e keyboard della home e del popover                                               |
| U3   | `[accountId]/layout.tsx` con testata, tab e periodo; Panoramica; Movimenti paginati con filtri, gruppi e descrizioni §5.2; Collegamento di §3.6; azioni con menu `⋯`                          | Unit: descrizioni di ogni tipo di evento in en e it. Integration: paginazione stabile (`ORDER BY`), conteggi per filtro. E2E: 4 tab in a11y/keyboard; pagina eToro < 3.000 px; Indietro tra i tab |
| U4   | Posizioni aperte e chiuse con P&L del periodo; migrazione additiva `cost_cents` su `investment_reading_positions` riempita da eToro; costo dai trade per Binance; dust in `<details>`              | Unit: non realizzato con base a `s⁻`. Integration: migrazione su `ledgerly_test`, sync eToro con costo. E2E: somma Posizioni = Panoramica                                                         |
| U5   | Dialog (D1–D6), catalogo (C1–C2), Accounts "Last synced", tratteggio in Overview, `investments:read` con `from`/`to` + `docs/api-changelog.md`, MCP                                              | Unit: default del dialog per classe e valuta. Integration: API con periodo. E2E: Overview tratteggiata, catalogo                                                                                 |

Stima: U1 ~1 giorno, U2 ~1 giorno, U3 ~1,5 giorni, U4 ~1 giorno, U5 ~1 giorno.

## 11. Problemi dell'audit e dove si risolvono

| Problemi                       | Soluzione                                                         |
| ------------------------------ | ----------------------------------------------------------------- |
| H1, H2, S2                     | Hero P&L e KPI di scomposizione (§3.1, §3.3); versamenti netti in Movimenti (§3.5) |
| H3, H4, D5                     | Periodo unico per anno solare nell'URL (§2)                       |
| H5, S13, A2                    | Grafico P&L \| Valore per servizio, marker, testo alternativo (§3.1, §3.3, §7) |
| H6, H7                         | Composizione unica, colori di Overview (§0.6, §3.1)               |
| H8, H12, M2                    | Lista dei servizi con P&L, contributo, quota (§3.1)               |
| H9                             | Riga dei fondi sotto l'hero, scelta 4 (§9)                        |
| H10, S8, A4                    | Un'azione primaria per pagina, menu `⋯` (§3.1, §3.2)             |
| H11                            | "Rendimento" con XIRR nel tooltip (§4.3, §5.1)                    |
| S1, V3                         | `reliableFrom` per periodo, striscia e banda (§4.6, §3.3)         |
| S3, S4, S5, S16, A3, M1, D3    | Tab Movimenti paginato e leggibile (§3.5)                         |
| S6, S7, S11, S15, A1, D4, D6   | Tab Collegamento (§3.6), dialog (§3.7)                            |
| S9, S10, V4                    | Tab Posizioni, aperte/chiuse, dust (§3.4)                         |
| S12                            | Meta in parole (§3.2)                                             |
| S14                            | "30 days" tolto (§5.1)                                            |
| D1, D2                         | Dialog "Aggiungi asset" (§3.7)                                    |
| C1, C2                         | Catalogo (§3.7)                                                   |
| M3                             | Granularità automatica (§2.2)                                     |
| V1                             | Cambio in importo (§4.5)                                          |
| V2                             | Tratteggio anche in Overview e Accounts (§8)                      |

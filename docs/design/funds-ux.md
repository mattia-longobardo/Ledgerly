# Funds · audit UX e proposta di redesign

PERS-208 (01/11/2026), issue madre PERS-207. **Solo design**: nessun codice dell'app, nessuna migrazione,
nessun deploy. **Approvato da Mattia il 01/11/2026**: direzione A e tutti i default di §9.

Input: `src/modules/funds`, `src/app/(app)/funds`, `src/ui`, `docs/design/investments-ux.md`. Versione
esaminata: `main` @ `1fd3580`, stessa versione dell'immagine in produzione.

Mockup: `docs/design/funds-ux/mockups/*.html`, con dati inventati. Questo documento non contiene importi
reali: gli importi e gli screenshot reali sono solo nel commento finale di PERS-208.

**Metodo.** I dati vengono da una copia in sola lettura della produzione, senza tabelle di credenziali,
in container temporanei isolati, con l'immagine `ledgerly:latest`. La produzione non ha ricevuto
scritture. La copia è stata eliminata alla fine.

## 1. Risposta breve

- **Perché «un anno prima».** Non è un difetto dei dati. La home non ha un periodo: mostra sempre gli
  ultimi 12 mesi, quindi oggi parte da dicembre 2025. Il fondo pensione parte da ottobre 2025 (§2).
- **Perché i KPI confondono.** I quattro KPI della home sono totali "da sempre", con date diverse, e
  nessuno risponde a "come è andato quest'anno". Su una stessa pagina compaiono due rendimenti diversi
  senza spiegazione. Alcune etichette sono sbagliate (§3).
- **Raccomandazione.** Direzione A: stessa struttura di Investments (periodo, hero, grafico Guadagno |
  Valore, lista, dettaglio a tab), con KPI propri dei fondi: versato per origine, andamento del mercato,
  commissioni, in arrivo, deducibile, piano (§5, §6).
- **Schema.** Nessuna migrazione richiesta (§8).

## 2. Causa di «un anno prima»

Né default sbagliato di un anno, né dati assenti: **finestra mobile senza selettore**.

| Dove                 | Evidenza                                                                                  | Effetto al 01/11/2026                                     |
| -------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Home, nessun periodo | `src/app/(app)/funds/page.tsx:30` non legge `searchParams`                                | Nessun modo di cambiare il periodo                        |
| Home, finestra fissa | `src/modules/funds/queries.ts:272` (`months: 12`)                                         | 12 mesi chiesti ad Accounts                               |
| Calcolo dei mesi     | `src/modules/accounts/queries.ts:285` (`addMonths(end, -(span - 1))`)                     | La finestra parte da **dicembre 2025**                    |
| Dettaglio PAC        | `src/app/(app)/funds/[id]/page.tsx:46-50`, `:282` (6M, 1Y, 2Y; default 12)                | Parte da **dicembre 2025**; il PAC comincia a gennaio 2026 |
| Dettaglio pensione   | `src/app/(app)/funds/[id]/page.tsx:90` (default 24) e `pension/queries.ts:281-287`        | Parte da **ottobre 2025**: prima busta paga, non il primo denaro |
| Etichetta            | `chart.title` in `messages/*.json` («12 mesi» scritto nel testo)                          | Il titolo non dice le date                                |

Dati: il primo versamento è del 01/01/2026, il primo valore del 30/01/2026. Il 2025 contiene solo le buste
paga del IV trimestre, accreditate a gennaio 2026. Quindi il primo tratto dei grafici è un periodo senza
denaro: la vista sembra "indietro di un anno".

**Assunzione**: leggo «un anno prima» come questo comportamento. È l'unica vista che mostra il 2025. Se
Mattia intende un'altra cosa, la decisione 1 di §9 lo fa emergere.

## 3. KPI attuali

### 3.1 Home

| KPI                | Significato                       | Formula e codice                                   | Problema                                                                                                                                  |
| ------------------ | --------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Valore attuale     | Somma dei valori                  | Σ valori, `queries.ts:358-360`                     | "Attuale" è falso: ogni fondo ha una data diversa. Ripetuto nel sottotitolo (`page.tsx:130`). Il PAC è a oggi, la pensione all'ultimo saldo |
| Versato            | Tutto il denaro entrato           | Σ fino a oggi, `queries.ts:361`                    | Da sempre. Comprende i versamenti dopo l'ultimo valore: con un versamento nuovo, Valore − Versato ≠ Guadagno. Mischia tu, azienda e TFR      |
| Guadagno totale    | Valore − versato alla data valore | Σ colonna, `queries.ts:384-391`                    | Da sempre. Il dato più utile non è la prima informazione. Due date di misura diverse nella stessa somma, senza dirlo                       |
| Versamenti mensili | Importo dei piani                 | Σ `monthlyCents`, `queries.ts:392`                 | Esclude il fondo pensione, che versa ogni trimestre e di più. Un numero di configurazione, non un risultato                                |

### 3.2 Dettaglio PAC

| KPI                 | Formula e codice                                    | Problema                                                                                                     |
| ------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Investito           | Versato − commissioni, `rules.ts:60-91`             | Da sempre. Il versato, che è la base del guadagno, è solo nella riga sotto l'hero                             |
| Commissioni         | Σ `feeCents`                                        | Corretto, ma da sempre                                                                                        |
| Guadagno            | Valore − versato alla data, `rules.ts:79`           | Ripete l'hero                                                                                                 |
| **Ultimi 12 mesi**  | `stats.compounded`, `[id]/page.tsx:486-487`         | **Etichetta falsa**: `periodStats` compone tutti i tratti (`rules.ts:347`), non 12 mesi. Oggi sono 273 giorni |

### 3.3 Dettaglio pensione

| KPI             | Formula e codice                                    | Problema                                                                                                 |
| --------------- | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Valore posizione | Ultima voce di saldo, `pension/queries.ts:228`     | Ripete l'hero. **Data falsa**: legge la copia di sistema di fine mese, non la valutazione (§4, n. 1)      |
| Versato         | Σ lordo operazioni, `metrics.ts:168-169`            | Da sempre; niente tu, azienda, TFR                                                                        |
| Guadagno        | Valore − base − trasferimenti + uscite, `metrics.ts:203` | Ripete l'hero. Formula diversa dalla home (`queries.ts:342`): differisce con un trasferimento o un'uscita |
| Da accreditare  | Trimestri non accreditati, `metrics.ts:218-226`     | Utile. La nota cita solo il primo trimestre (§4, n. 3)                                                    |

### 3.4 Due rendimenti sulla stessa pagina

L'hero mostra guadagno / versato; la card accanto mostra il composto tra valutazioni. Sul fondo pensione il
secondo è quasi il triplo del primo. Entrambi sono corretti, ma misurano cose diverse e la pagina non lo dice.

## 4. Audit: problemi per impatto

Screenshot desktop (1440) e mobile (390) delle schermate: allegati a PERS-208.

### Alto

| #  | Schermata             | Problema                                                                                                                                                             | Causa                                                               | Euristica          |
| -- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------ |
| 1  | Home, pensione        | **Difetto.** "Valore al 31 ott" è una copia di sistema: l'ultima valutazione è del 30 set. La data dice che il valore è più recente di quanto sia                     | `queries.ts:296`, `pension/queries.ts:228`: non escludono `system`  | Stato del sistema  |
| 2  | Pensione, rendimento  | **Difetto.** I punti comprendono le copie di sistema, e nello stesso giorno la copia vince sulla valutazione. La perdita di settembre appare in ottobre. I punti calcolati da quote × prezzo creano anche tratti di 1 giorno a 0,0 % | `pension/queries.ts:277-280`, `metrics.ts:379`                      | Corrispondenza     |
| 3  | Pensione, avviso      | **Difetto.** "X maturati nelle buste del III trimestre", ma X comprende anche il IV. Una sola scadenza per due trimestri                                              | `pension-view.tsx:193-198`                                          | Prevenzione errori |
| 4  | PAC e pensione        | **Difetto.** "Se entrano X al mese": X è la media di 12 mesi del denaro versato, una tantum compresa. Sul PAC è quasi il doppio del piano, che la home mostra a parte | `rules.ts:225-233`                                                  | Coerenza           |
| 5  | PAC                   | **Difetto.** "Ultimi 12 mesi" non sono 12 mesi (§3.2)                                                                                                                 | `[id]/page.tsx:486`                                                 | Corrispondenza     |
| 6  | Home                  | Nessun periodo, nessun anno (§2)                                                                                                                                      | `page.tsx:30`                                                       | Controllo          |
| 7  | Home                  | Nessun KPI risponde a "come è andato quest'anno" (§3.1)                                                                                                               | `page.tsx:134-147`                                                  | Riconoscimento     |
| 8  | Tutti i grafici       | Valore e versato sono quasi sovrapposti: la scala è dominata dal denaro versato e il guadagno non si vede. Il grafico mostra i versamenti, non il risultato            | `page.tsx:161-170`, `pension-view.tsx:221-237`                      | Estetica minimale  |

### Medio

| #  | Schermata       | Problema                                                                                                                                       | Causa                                       |
| -- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 9  | Home mobile     | Mancano Modifica, Registra valore, stato del mese e totale, presenti su desktop. `AGENTS.md` chiede gli stessi controlli                        | `page.tsx:278-298`                          |
| 10 | PAC, pensione   | Versamenti, valutazioni e mesi sono tabelle a scorrimento su mobile, senza la seconda vista che `AGENTS.md` chiede                              | `[id]/page.tsx:568`, `:639`; `pension-view.tsx:487` |
| 11 | Pensione        | Panoramica troppo lunga (1.717 px desktop, 3.068 px mobile): operazioni e ponte sono dati di dettaglio, ma stanno nel primo tab                 | `pension-view.tsx:256-473`                  |
| 12 | Tre controlli   | Periodi diversi per pagina: niente in home, 6M/1Y/2Y sul PAC, 1Y/2Y/All più intervallo sulla pensione. "All" vale 60 mesi                        | `[id]/page.tsx:46`, `pension-view.tsx:58`   |
| 13 | Pensione        | Costo di gestione "—": cerca il comparto in `funds.compartment`, vuoto, mentre le quote dicono il comparto. La tariffa esiste                   | `pension-view.tsx:442-444`                  |
| 14 | Pensione        | Riga totale delle operazioni: 10 celle su 8 colonne. Il totale delle quote cade sotto una colonna senza titolo                                  | `pension-view.tsx:327-339`                  |
| 15 | Rendimento      | Pagina separata dal tab Valutazioni, con gli stessi dati in un'altra forma                                                                     | `[id]/returns/page.tsx`                     |
| 16 | Home            | Nessun tooltip sul grafico (la pensione lo ha); solo 5 etichette dei mesi                                                                       | `page.tsx:161-170`                          |

### Basso

| #  | Problema                                                                                                                  | Causa                                  |
| -- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 17 | Termini tecnici in vista: «Simple Dietz», «non annualizzato», «Cumulato», «Competenza», stato grezzo «QUOTATO», «TER»       | `messages/*.json`, `pension-view.tsx:298` |
| 18 | Stesso concetto, nomi diversi: «Valore attuale», «Valore posizione»; tab «Panoramica» e «Riepilogo»; «Valorizzazione» e «Valutazione» | `messages/it.json`                     |
| 19 | «Fai clic su un fondo per la sua pagina» e il sottotitolo della home non aggiungono informazioni                           | `page.tsx:129-131`, `:176`             |
| 20 | «Modifica» porta alle Impostazioni, con due azioni testuali per riga                                                       | `page.tsx:239-253`                     |

**Accessibilità e responsive.** Nessuno scorrimento orizzontale della pagina a 390 px sulle 11 schermate.
`tests/e2e/a11y.spec.ts` copre già le pagine. Restano i punti 9, 10 e 16 e il grafico della home senza
tabella dei dati.

Fuori perimetro: le decisioni di Investments restano. Il valore dei fondi nella riga di Investments dipende
dalla stessa regola del n. 1 e migliora senza modifiche a Investments.

## 5. Modello dei dati e KPI proposti

### 5.1 Logiche proprie dei fondi

Dal codice e dai dati, quello che distingue i fondi dai servizi di Investments:

1. **Il valore è un dato raro e datato.** Non c'è un prezzo giornaliero: il valore esiste solo quando una
   persona o un documento lo dice. Mattia lo registra circa una volta al mese, spesso il giorno 1.
2. **Il denaro arriva da chi non sei tu.** Fondo pensione: lavoratore, azienda, TFR. PAC: dal conto.
3. **Il denaro ha tre stadi.** Maturato in busta → versato al fondo → compreso in un valore.
4. **Le commissioni sono esplicite e sui versamenti.** Il costo di gestione è già dentro il valore.
5. **Il limite è fiscale e annuale.** Deducibile: tu + azienda, senza TFR, con un limite per anno.
6. **Un PAC ha un piano**: importo, giorno, stato del mese. Niente posizioni, niente realizzato: quindi
   Realizzato, Non realizzato e Proventi di Investments qui **non** hanno senso.

### 5.2 Regola del periodo (base di ogni numero)

Investments usa `V(s⁻)` e `V(e)` giornalieri. Qui darebbero guadagni falsi, perché un valore può essere vecchio
di settimane: un versamento dopo l'ultimo valore sembrerebbe una perdita (lo stesso difetto corretto il
20/09/2026). La regola quindi lega i flussi alle **date dei valori**:

```text
Valore documentato = voce di saldo manual/import, oppure quote × valore quota. Mai system/derived.
                     Un punto da quote a meno di 3 giorni da una voce di saldo non conta.
a(p)      = ultimo valore documentato con data ≤ fine di p
s         = data di a(periodo precedente); senza un valore prima, il giorno prima del primo flusso e V = 0
Flussi    = Σ versamenti lordi in (s, a(p)]
Guadagno  = V(a(p)) − V(s) − Flussi
```

- **Le somme tornano**: i guadagni degli anni sommano al guadagno "Tutto", al centesimo, in ogni caso. È un
  invariante da coprire con un test.
- **Lettura del 1° gennaio**: chiude l'anno prima (decisione 3). Con il valore registrato il giorno 1, senza
  questa regola il mese di dicembre finirebbe nell'anno dopo.
- **Lettura del giorno 1 (F1)**: la regola vale per ogni periodo che finisce l'ultimo giorno di un mese, non
  solo per l'anno. Il grafico di F2 la riusa per i mesi.
- **Primo valore senza denaro prima (F1)**: è una posizione, non un guadagno. Il punto di partenza è quel valore,
  non `V = 0`. Il modulo fa già così dal 20/09/2026.
- **Valuta**: tutti i fondi sono in EUR oggi. La conversione resta quella del saldo; un fondo in altra valuta
  è un'estensione futura, con le regole di Investments §4.5.

### 5.3 KPI

Tutti seguono il periodo, salvo dove è scritto. Disponibilità: **sì** = il dato esiste, con il modulo indicato.

| KPI                                   | Definizione                                                     | Formula                                                                                            | Dati                                              |
| ------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Guadagno** (hero)                   | Quanto il fondo ha reso, dopo le commissioni                    | §5.2. Portafoglio = Σ fondi                                                                        | Sì: `balance_entries`, `fund_deposits`, `fund_operations` |
| **Rendimento** (hero)                 | Guadagno rispetto al denaro al lavoro nel tempo                 | Modified Dietz: Guadagno / (V(s) + Σ flusso × (a − d) / N); XIRR nel tooltip se N ≥ 365 giorni      | Sì: `pnl.ts` e `xirr.ts` da riusare come logica    |
| **Versato**                           | Denaro entrato nel periodo, lordo                               | Σ `chargedCents` + Σ lordo operazioni (contributo, iscrizione, volontario, trasferimento in entrata) | Sì. Senza export: i trimestri scaduti, come oggi  |
| Versato: **tu · azienda · TFR**       | Di chi è il denaro                                              | PAC e `workerCents` = tu; `employerCents` = azienda; `tfrCents` = TFR; `otherCents` = riga propria  | Sì. Gap: un fondo senza export ha i dati dalle buste (`pension_competences`), per competenza e non per data di accredito |
| **Andamento del mercato**             | Variazione del valore, senza versamenti e commissioni           | Guadagno + Commissioni assolute                                                                    | Sì                                                |
| **Commissioni**                       | Costi espliciti sui versamenti                                  | Σ `feeCents` nel periodo. Andamento − Commissioni = Guadagno, al centesimo                          | Sì. Gap: `feeCents` nullo su un versamento → nota «una commissione è sconosciuta». Il costo di gestione non è qui: è già nel valore |
| **In arrivo** (sempre a oggi)         | Maturato in busta, non ancora nel fondo                         | `pendingCents`, `metrics.ts:218-226`, per trimestre con scadenza                                   | Sì. Solo fondo pensione                            |
| **Non ancora nel valore** (nota)      | Versato dopo l'ultimo valore                                    | Flussi con data > `a(p)`                                                                           | Sì                                                |
| **Deducibile usato** (per anno)       | Quota fiscale consumata                                         | (tu + azienda) nell'anno / `deductibilityLimit(anno)`. Senza periodo: non si mostra                  | Sì: `pension/rules.ts:165`. Per data operazione: l'anno certificato può differire, la nota lo dice |
| **Piano** (sempre a oggi, PAC)        | Cosa deve entrare                                               | `monthlyCents`, `debitDay`, `monthStatus`                                                          | Sì                                                |
| **Quote, valore quota** (riga, pensione) | Posizione in quote                                           | Σ `unit_movements.units`; ultimo `unit_price` con data                                             | Sì per il fondo pensione. **Gap PAC**: `fund_valuations.units` è sempre vuoto e il modulo non lo chiede; nessun valore quota. Si mostra solo dove esiste (decisione 6) |
| **Proiezione** (sempre a oggi)        | Dove arriva il fondo, per ipotesi                               | `forecast()` con il **piano** se esiste, altrimenti la media dei soli versamenti ricorrenti. Una tantum escluso | Sì, dopo la correzione del n. 4                    |

**Aggregato home.** Investments §4.8 toglie la % se i periodi sono diversi. Sui fondi i valori hanno quasi
sempre date diverse, quindi la % non comparirebbe mai. Regola proposta: % aggregata con numeratore Σ Guadagno e
denominatore Σ capitale medio sullo stesso intervallo `[inizio, ultima data]`, solo se tutte le date dei valori
sono entro 45 giorni l'una dall'altra. Altrimenti solo gli importi. L'hero scrive sempre le date ("valori
aggiornati tra il 30 set e il 1 nov").

**Tolti dalla vista**: "Versamenti mensili" (diventa Piano del singolo PAC), "Investito" come KPI (resta nel
ponte), "Ultimi 12 mesi", il KPI che ripete l'hero, "Mese migliore / peggiore" (nel tab Valutazioni).

## 6. Direzioni

### Direzione A (raccomandata): come Investments, con i contenuti dei fondi

Mockup: `a-01-home`, `a-02-home-value`, `a-03-home-2025`, `a-04-home-all`, `a-05-pension`, `a-06-pac`.

```text
Funds                     [Anno|Tutto|Personalizzato] ‹ 2026 · da inizio anno › [Aggiungi fondo]
Guadagno · 2026 da inizio anno
+400,00 €  +6,3 %                                   (1) da aggiornare: Pensione Alfa, ultimo valore 30 set
Valore 9.000,00 € · 2 fondi · valori aggiornati tra il 30 set e il 1 nov
┌Versato nel 2026┐┌Andamento del mercato┐┌Commissioni┐┌In arrivo┐
┌Andamento ────────────────────────────── [Guadagno | Valore]┐
┌Fondi (2/3)─────────────────────────────┐┌Chi ha versato (1/3)─┐
│ Fondo│Versato│Guadagno│Rend.│Valore│Agg.││ Tu·Azienda·TFR       │
│ Totale                                 ││ Deducibile usato     │
```

**Home.** Hero, KPI, grafico, lista, come Investments. "Chi ha versato" prende il posto della Composizione:
per i fondi la domanda utile è l'origine del denaro. Su **Tutto**, sotto il grafico c'è la tabella **Anno per
anno**: confronta gli anni e porta all'anno (`a-04`).

**Grafico.** Vista **Guadagno** (default): barre per mese impilate per fondo, linea del cumulato. Risolve il
problema n. 8. Vista **Valore**: valore e versato, con la banda del guadagno tra le due. Solo punti
documentati, nessuna interpolazione. Un tratto con il valore del giorno 1 appartiene al mese prima; un tratto
più lungo di un mese resta una barra sola, con le date nel tooltip. Granularità: Anno = mesi; Tutto = anni;
Personalizzato ≤ 92 giorni = tratti tra valutazioni.

**Dettaglio.** Testata comune: meta, nome, tab, stesso periodo nell'URL. **Fondo pensione**: Panoramica ·
Contributi · Valutazioni · Impostazioni. **PAC**: Panoramica · Versamenti · Valutazioni · Impostazioni.

| Tab                        | Contenuto                                                                                                   |
| -------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Panoramica pensione        | Hero, avviso In arrivo per trimestre, KPI (Versato, Mercato, Commissioni, Deducibile), grafico, ultimi versamenti, "Dal maturato al valore", proiezione chiusa in `<details>` |
| Panoramica PAC             | Hero, KPI (Versato, Mercato, Commissioni, Piano), grafico, ultimi versamenti, proiezione breve              |
| Contributi / Versamenti    | Filtrati per periodo. Pensione: buste, trimestri, operazioni, deducibile per anno. PAC: lista, regola        |
| Valutazioni                | Una riga per valore: data, valore, versato nel tratto, guadagno e rendimento del tratto. Assorbe `/returns`, che passa a un redirect |
| Impostazioni               | Come oggi. Non segue il periodo                                                                              |

**Trade-off.** A favore: un solo modello mentale con Investments, stessi componenti (`Segmented`,
`period-control`, `StackedBars`, `CompositionBar`, `TabLinks`), riuso del comportamento già approvato. Contro:
con un solo anno di dati lo stepper resta quasi fermo; un anno alla volta non mostra il confronto, che compare
solo su Tutto.

### Direzione B: registro anno per anno

Mockup: `b-01-home`, `b-02-pension`.

Niente periodo: la home è una tabella degli anni. Ogni riga si apre sui fondi; la riga aperta è l'anno in
corso. Hero = valore oggi. Il dettaglio è la stessa tabella con le colonne tu, azienda, TFR, deducibile.

**Trade-off.** A favore: confronto tra anni immediato, adatto a un orizzonte di decenni, con la dichiarazione
dei redditi a portata di mano; meno controlli. Contro: si allontana da Investments, che è la richiesta; oggi c'è
un solo anno, quindi la tabella ha una riga; su mobile perde colonne; niente intervalli personalizzati; il
guadagno passa in secondo piano; servono componenti nuovi.

### Raccomandazione

**Direzione A**, con da B la tabella Anno per anno su Tutto. È ciò che Mattia ha chiesto e costa meno. La
tabella copre il valore di B quando gli anni saranno più di uno.

### Elementi comuni

**Navigazione per anni.** Parametri come Investments §1.2: `period=2026|…|all`, `from`/`to`, `view`.
Default: anno in corso. Il parametro resta tra home, fondo e tab. `span` e `from`/`to` a mesi passano a un
redirect verso il parametro nuovo.

Lo stepper va dal primo anno con un dato (versamento, valore, operazione o busta) all'anno in corso.

| Caso                                          | Comportamento                                                                                                           |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Anno in corso                                 | "2026 · da inizio anno". `›` disattivato                                                                                |
| Primo anno                                    | `‹` disattivato                                                                                                         |
| Anno con sole buste paga (oggi: 2025)         | Guadagno "Non determinabile", mai zero. KPI "Maturato in busta". Azioni "Vai al 2026" e "Apri i contributi del 2025" (`a-03`). Tab Contributi con le buste |
| Anno con versamenti e nessun valore           | Guadagno "Non determinabile". Versato e commissioni restano. "Registra un valore per misurare il {anno}"                 |
| Anno senza movimenti, con un valore precedente | Guadagno 0 solo se esiste un valore nell'anno; altrimenti "Nessun valore nel {anno}". Valore: l'ultimo noto, con la data |
| Anno in corso senza valori (es. gennaio)      | "Nessun valore ancora nel 2027", ultimo valore e versato. Azione "Registra valore"                                      |
| Un fondo senza valore nell'anno, altri con    | Il fondo resta in lista con "non determinabile", fuori dalla somma. Hero "Guadagno disponibile nel {anno}", con la nota |
| Anno prima del primo dato (URL a mano)        | "Nessun dato nel 2023. Il primo è del …", con il link                                                                   |
| Anno dopo oggi (URL a mano)                   | Redirect all'anno in corso                                                                                              |
| Fondo archiviato                              | Nei periodi passati conta se ha dati nel periodo, con il badge. Oggi la home lo esclude del tutto (decisione 5)         |

**Cosa segue il periodo.** Guadagno, rendimento, versato, mercato, commissioni, chi ha versato, deducibile,
grafico, liste. **Sempre a oggi**: In arrivo, Piano, stato del mese, proiezione, Impostazioni. Periodo passato:
l'hero mostra "Valore a fine anno" con la data e, accanto, il valore di oggi.

**Stati.**

| Stato                       | Home                                                         | Dettaglio                                                      |
| --------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------- |
| Nessun fondo                | `EmptyState` di oggi                                         | —                                                              |
| Fondo senza valore          | Riga "Registra il primo valore", guadagno "—", versato visibile | Hero "Ancora nessun valore", azione primaria. Pensione: maturato come oggi |
| Un solo valore              | Guadagno sì; rendimento sì                                   | Valutazioni: «Serve un secondo valore per il rendimento del tratto» |
| Versamento non trovato      | Avviso di oggi (`fund-alert`), azione verso Expenses         | Uguale                                                         |
| Valore vecchio (> 31 giorni) | Link "da aggiornare" (uno solo, con il conteggio, come Investments) | Azione primaria già in testata                         |
| Versato dopo l'ultimo valore | Nota sotto l'hero                                           | Nota sotto l'hero                                              |
| Caricamento                 | `Skeleton` di hero, KPI, grafico, 2 righe                    | Uguale, per tab                                                |

**Responsive.** Come Investments: controllo del periodo su due righe, KPI 2×2, grafico a tutta larghezza, ogni
tabella in doppia vista con **gli stessi controlli** (correggi i n. 9 e 10). Verifica a 375, 768, 1440 px, in
dark e light. I mockup non hanno overflow a 390, 768 e 1440 px; la verifica a 375 px e in dark è per lo sviluppo,
con `a11y.spec.ts`.

**Accessibilità.** Target ≥ 24 px; stato mai solo con il colore; testo alternativo del grafico con il mese
migliore e peggiore; tabella dei dati in `<details>`; focus visibile sulla riga; tutti i tab in `a11y.spec.ts` e
`keyboard.spec.ts`, nello stesso commit.

**Microcopy.** Ogni testo in `messages/en.json` e `messages/it.json`.

| Oggi (it)                                   | Nuovo it                  | Nuovo en              |
| ------------------------------------------- | ------------------------- | --------------------- |
| Guadagno totale, Guadagno                   | Guadagno                  | Gain                  |
| Valore attuale, Valore posizione            | Valore                    | Value                 |
| Cumulato                                    | Rendimento                | Return                |
| Valorizzazione, Registra valorizzazione     | Valutazione, Registra valore | Valuation, Record value |
| Ultimi 12 mesi                              | (tolto)                   | —                     |
| Da accreditare, Still to be credited        | In arrivo                 | On the way            |
| Competenza                                  | Trimestre                 | Quarter               |
| Riepilogo                                   | Panoramica                | Overview              |
| Investito (al netto delle commissioni)      | (solo nel ponte) Investito | Invested             |
| «gain / paid in, not annualised»            | (tolto, nel tooltip)      | —                     |
| «Simple Dietz» nel testo                    | (tolto, nel tooltip)      | —                     |
| Stato grezzo «QUOTATO»                      | (tolto dalla riga)        | —                     |
| —                                           | Andamento del mercato     | Market movement       |
| —                                           | Chi ha versato            | Who paid in           |
| —                                           | Tu · Azienda · TFR        | You · Employer · TFR  |
| —                                           | Deducibile usato          | Deductible used       |

## 7. Correzioni indipendenti dal redesign

I problemi 1–5, 13 e 14 sono difetti sulla UI di oggi. Valgono anche se Mattia rifiuta il redesign: per questo
stanno nella fase F1. La fase ricalcola numeri visibili: il valore datato 31 ott torna al 30 set; i tratti del
fondo pensione cambiano.

## 8. Fasi, schema e dati

**Schema: nessuna migrazione.** Tutti i KPI si calcolano dai dati che esistono. **Dati: nessuna modifica**:
`funds.compartment` vuoto si risolve leggendo il comparto da `unit_movements`. Le voci `system` restano per
Overview e Accounts: Funds smette di leggerle come valutazioni.

| Fase | Contenuto                                                                                                                                  | Test                                                                                                                                       | Stima |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| F1   | Correzioni §7. `modules/funds/period.ts` puro: periodo, valore documentato, §5.2, Modified Dietz, origine, In arrivo. Niente UI nuova       | Unit: invariante Σ anni = Tutto, Andamento − Commissioni = Guadagno, lettura del 1° gennaio, versamento dopo il valore, fondo senza valore, trasferimento, uscita. Integration: `fundsView`, `pensionDetail` | ~1,5 g |
| F2   | Riuso di `period-control` da Investments, senza cambiare il suo comportamento. Home: periodo, hero, KPI, grafico Guadagno \| Valore, lista, Chi ha versato, Anno per anno, stati                                           | Unit: parametri e redirect. E2E: il periodo cambia tutto; righe = hero; anno senza valori; a11y, keyboard                                  | ~1,5 g |
| F3   | Dettaglio: testata, periodo, Panoramica pensione e PAC, proiezione sul piano                                                                 | E2E: stesso guadagno tra home e fondo; Indietro tra i tab; a11y, keyboard                                                                  | ~1,5 g |
| F4   | Contributi, Versamenti, Valutazioni con il rendimento del tratto, redirect di `/returns`, doppia vista mobile, microcopy en e it             | E2E: filtri per periodo; stessi controlli a 400 px; redirect; a11y                                                                         | ~1,5 g |
| F5   | Coerenza: export e riga dei fondi in Investments con il valore documentato, seed `layout` con 2 anni e un anno senza valori, documentazione | Integration: export. E2E completo                                                                                                          | ~0,5 g |

Totale: **~6 giorni**. API e MCP non hanno endpoint dei fondi: nessuna modifica. Investments ed export leggono
`fundsView`, quindi F1 e F5 controllano anche loro.

**Rilascio.** Mai due grafiche, come ha deciso Mattia su Investments, ma senza ramo di integrazione: `git-policy`
§1 e §2 lo escludono perché il diff non tocca un criterio §6. F1 va su `main` con un suo deploy. F2–F4 vanno su
`main` come componenti nuovi non collegati, senza cambiare la produzione. L'ultimo commit collega le pagine e
toglie la UI vecchia, con un solo deploy.

## 9. Decisioni di Mattia (01/11/2026)

Mattia ha approvato la colonna «Default raccomandato» per tutte le 8 scelte. Le alternative sono scartate.

| # | Scelta                                  | Default raccomandato                                                                             | Alternativa                                                                     |
| - | --------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| 1 | Direzione e significato di «un anno prima» | **Direzione A**, con default sull'anno in corso; §2 è la causa                                 | Direzione B. Se la causa è un'altra, dirlo prima dello sviluppo                 |
| 2 | Rendimento                              | **Modified Dietz sul periodo, XIRR nel tooltip** (come Investments). Il composto resta solo tratto per tratto, in Valutazioni | Composto tra valutazioni: più preciso con valori mensili, diverso da Investments |
| 3 | Lettura del 1° gennaio                  | **Chiude l'anno prima**: il valore registrato il giorno 1 descrive il mese passato                | Anno rigoroso: dicembre finisce nell'anno dopo                                  |
| 4 | Il 2025 nello stepper                   | **Sì**, con lo stato "solo buste paga" (`a-03`): lo stepper dice tutto ciò che esiste             | No: stepper dal primo denaro (2026), buste 2025 solo nel tab Contributi         |
| 5 | Fondi archiviati                        | **Nei periodi passati contano**, con un badge: la somma degli anni resta vera                     | Esclusi sempre, come oggi: il passato cambia quando archivi un fondo            |
| 6 | Quote del PAC                           | **Non ora**: quote solo dove i documenti le danno. Nessun campo in più da compilare ogni mese     | Campo facoltativo nel dialog del valore: nessuna migrazione, `units` esiste     |
| 7 | Soglia "da aggiornare"                  | **31 giorni**: Mattia registra circa una volta al mese                                            | 45 giorni, o nessun avviso                                                      |
| 8 | Proiezione                              | **Piano del PAC; media dei ricorrenti per il fondo pensione**; chiusa di default sul fondo pensione | Media di 12 mesi con le una tantum, come oggi: è il difetto n. 4                |

# N6 · Fondo pensione standard — specifica UX

Indice del piano: [`../../rewrite-plan.md`](../../rewrite-plan.md). Rilascio: [`../03-releases.md`](../03-releases.md) «N6».
Modello e regole: [`../11-standardization.md`](../11-standardization.md) §11.2. Decisioni: H12, H14-H16, H18, H19, H24 e
ST-1, ST-10, ST-11, ST-12, ST-16, ST-17, ST-26 in [`../01-decisions.md`](../01-decisions.md) e
[`../09-risks.md`](../09-risks.md) §9.6. Audit: UI-FND-1, UI-FND-2 in [`../audit-ui.md`](../audit-ui.md).
Stile approvato delle pagine dei fondi: [`../../funds-ux.md`](../../funds-ux.md) e `../../funds-ux/mockups/`.

Questa specifica descrive solo le schermate e l'interazione. Non cambia i calcoli approvati dei fondi
(`funds-ux.md` §5.2, §5.3, §9: periodo, valore documentato, Modified Dietz, XIRR, lettura del 1° gennaio, soglia di
31 giorni, proiezione). Non descrive la home di Investments a 2 gruppi e il redirect di `/funds`: sono di R5b. Se
questa specifica e il piano sono in conflitto, vale il piano.

Tutti i nomi e gli importi di questo documento sono dati di esempio: «Fondo Alfa» (contributi dalla busta paga),
«Fondo Beta» (addebito periodico), «Fondo Gamma» (fondo nuovo senza sorgenti).

Le decisioni di prodotto che il piano non scrive sono nella §15. Mattia ha risposto il 14/11/2026: le risposte sono
nella tabella «Decisioni prese» in testa alla §15 e **valgono sul testo delle altre sezioni**, scritto con l'opzione A
di ogni domanda. Le scelte di sola interfaccia prese senza conferma sono nella §14.

## 1. Cosa cambia, in breve

| Oggi | Con N6 |
|---|---|
| «Nuovo fondo» chiede il tipo (PAC o fondo pensione) | «Aggiungi fondo pensione»: 4 passi, nessun tipo, nessun file |
| Due serie di tab: `overview · deposits · valuations · settings` (PAC) e `overview · contributions · valuations · settings` (pensione) | Una serie: Panoramica · Contributi · Valori · Impostazioni |
| Il tipo decide le sezioni | La configurazione decide le sezioni (sorgenti, scadenze, quote) |
| Commissioni: 2 campi fissi e un tariffario in sola lettura | Lista modificabile, una riga per commissione |
| Scadenze: una regola del fondo, con un calendario di ripiego | Campi della sorgente «Busta paga». Nessun ripiego |
| Riquadro «Deducibile» in home, dettaglio e tab Contributi | Non esiste più (H18) |
| Import, lista e pagine dei documenti | Non esistono più (H19). Contributi e valori: dalle sorgenti o a mano |
| Form e tab del PAC, la parola «PAC» | Non esistono più. Il piano di addebito è una sorgente «Addebito periodico» |
| Il conto del valore si sceglie alla creazione | Il conto nasce da solo, di tipo `pension` |

I numeri dei 2 fondi di oggi non cambiano (§9).

## 2. Pagine e indirizzi

| Indirizzo | Pagina |
|---|---|
| `/funds` | Home (§4). Struttura invariata |
| `/funds/new?step=fund\|sources\|fees\|review` | Procedura «Aggiungi fondo pensione» (§3) |
| `/funds/<id>` | Dettaglio, tab Panoramica (§5.2) |
| `/funds/<id>?tab=contributions` | Tab Contributi (§5.3) |
| `/funds/<id>?tab=valuations` | Tab Valori (§5.4). Il parametro resta `valuations`: i link salvati funzionano |
| `/funds/<id>?tab=settings` | Tab Impostazioni (§6). Sezioni con àncora: `#general`, `#sources`, `#fees`, `#danger` |

Redirect e pagine tolte:

- `?tab=deposits` → redirect a `?tab=contributions`, con il periodo.
- `/funds/<id>/documents/<docId>` e `…/original`: le rotte non esistono più. Rispondono 404.
- `/funds/<id>/returns`: resta il redirect di oggi al tab Valori.
- Il periodo (`period`, `from`, `to`) e `view` seguono le regole di oggi (`funds-ux.md` §6, §11, §12).

## 3. Procedura «Aggiungi fondo pensione»

### 3.1 Ingresso e contenitore

- Ingresso: pulsante «Aggiungi fondo» della home (`Page.actions`, `Button variant="primary"`, icona `Plus`) e
  pulsante dello stato vuoto. Sono `ButtonLink` verso `/funds/new`. Il dialogo `NewFundButton` di oggi non esiste più.
- Pagina dedicata, non un dialogo: 4 passi con liste non entrano in un `Modal` a 400 px. Stesso schema della
  procedura della banca ([`n1-plugin-bank.md`](n1-plugin-bank.md) §6.1).
- `Page` con `title` «Aggiungi fondo pensione» e `parent` «Fondi» → `/funds`.
- Una colonna `max-w-[560px]`, allineata a sinistra. Una `Card` per passo.
- Sopra la card, indicatore del passo: `<ol>` in riga, `text-sm`, quattro voci «1 Il fondo», «2 Come versi»,
  «3 Commissioni», «4 Riepilogo». Voce corrente: `aria-current="step"`, `font-medium text-fg`. Altre voci:
  `text-muted`. Voci fatte: icona `Check` di lucide (`aria-hidden`), testo nascosto «completato», e sono link al
  passo. Sotto 480 px le voci non correnti mostrano solo il numero.
- Il passo è nell'URL (`?step=`). I dati stanno in un solo `<form>` nel client: i 4 passi sono sezioni dello stesso
  form, una sola visibile. «Indietro» del browser torna al passo prima senza perdere i dati.
- Un `?step=` oltre il primo passo non valido porta a `?step=fund`.
- A ogni cambio di passo il focus va all'`h2` del passo (`tabIndex={-1}`).
- Uscita con dati scritti: `useUnsavedForm` chiede la conferma, come nei form di Settings.
- Nessuna scrittura nel database prima di «Crea fondo».

Piede di ogni card: a sinistra «Indietro» (`Button variant="ghost"`, non nel passo 1; nel passo 1 «Annulla» →
`/funds`), a destra il pulsante primario del passo. Sotto 480 px i pulsanti sono a tutta larghezza, il primario sopra.

### 3.2 Passo 1 · Il fondo

Titolo «Il fondo». Testo: «Scrivi i dati che conosci. Puoi cambiare tutto dopo, nelle impostazioni del fondo.»

| Campo | Controllo | Obbligatorio | Regole e default |
|---|---|---|---|
| Nome | `Input`, max 80 | Sì | Errore se esiste già un fondo con lo stesso nome |
| Gestore | `Input`, max 80 | No | Testo libero. Non sceglie regole |
| Data di adesione | `Input type="date"` | Sì | Non dopo oggi |
| Linea o comparto | `Input`, max 80 | No | — |
| Valore di oggi | `Input numeric`, `inputMode="decimal"` | No | ≥ 0. Vuoto = nessun valore |
| Data del valore | `Input type="date"` | Solo con un valore | Default oggi. Non dopo oggi, non prima dell'adesione. Compare quando «Valore di oggi» non è vuoto |
| Modello | `Select` | No | Default «Nessun modello». Il campo compare solo se il file dei modelli ha almeno una voce |
| Avanzate | `<details>` chiuso | — | Contiene Valuta e Codice |
| Valuta | `Select` | No | Default: valuta di visualizzazione. Non si cambia dopo la creazione |
| Codice | `Input`, max 40 | No | Identificativo del fondo o della posizione. Testo libero |

- Suggerimento sotto «Modello»: «Un modello copia scadenze e commissioni di un fondo noto. Puoi cambiarle.»
  I nomi dei modelli vengono dal file di dati, non dai file dei testi.
- Con un modello scelto, i passi 2 e 3 partono con le righe del modello. Una riga in alto in quei passi lo dice:
  «Dal modello «{model}». Controlla e cambia quello che non vale per te.»
- Cambio del modello dopo una modifica ai passi 2 o 3: conferma in linea «Il modello sostituisce le scelte dei
  passi 2 e 3.» con «Sostituisci» e «Tieni le mie scelte».
- Pulsante primario: «Continua». Il passo 1 è il solo obbligatorio: i passi 2 e 3 si possono lasciare vuoti.
- Il campo «Il valore sta su» e la scelta di un conto esistente non esistono più: il conto nasce da solo.

### 3.3 Passo 2 · Come versi

Titolo «Come versi». Testo: «Scegli da dove arriva il denaro. Nessuna scelta è obbligatoria.»

Tre righe con interruttore (`Switch`, §13.2). Ogni riga: etichetta (la domanda), una riga di aiuto, l'interruttore a
destra. Con l'interruttore acceso i campi compaiono sotto la riga, dentro la stessa riga (`aria-expanded` sul
contenitore dei campi, `aria-controls` sull'interruttore).

**A. «Versi dalla busta paga?»** — sorgente `payroll`.

- La riga compare solo con il modulo Payroll attivo. Senza Payroll la riga non esiste e una nota prende il suo
  posto: «Senza il modulo Payroll registri a mano anche i contributi della busta paga.»
- Aiuto: «I contributi trattenuti in busta paga arrivano da soli nel fondo.»

| Campo | Controllo | Default | Note |
|---|---|---|---|
| Voci | 3 `Checkbox`: «Il mio contributo», «Datore di lavoro», «TFR» | Tutte attive | Almeno una. Una voce già assegnata a un altro fondo è disattivata, con la nota «Già assegnata a «{fund}»» |
| Periodo di competenza | `Segmented`: «Mese» · «Trimestre» | «Mese» | — |
| Datore di lavoro | `Input`, max 120 | Vuoto | Facoltativo. Testo dell'utente |
| Il versamento ha una scadenza | `Switch` | Spento | Acceso: compaiono i 3 campi sotto |
| Giorno di scadenza | `Input type="number"` 1-31 | — | Obbligatorio con la scadenza accesa |
| Mesi dopo la fine del periodo | `Select` 0-3 | 1 | «0» = nello stesso mese |
| Tolleranza (giorni) | `Input type="number"` 0-120 | 15 | Aiuto: «Per quanti giorni dopo la scadenza un versamento mancante resta "in arrivo".» |

Sotto i campi della scadenza, una riga di anteprima con le prossime scadenze: «Prossime scadenze: 20 gen · 20 apr ·
20 lug · 20 ott». Senza scadenza: «Senza scadenza un contributo conta nel giorno in cui lo registri.»

**B. «Hai un addebito periodico su un conto?»** — sorgente `bank_debit`.

Aiuto: «Ledgerly trova l'addebito tra i movimenti del conto e crea il contributo.»

| Campo | Controllo | Obbligatorio | Default e note |
|---|---|---|---|
| Importo previsto | `Input numeric` | Sì | > 0 |
| Frequenza | `Select`: «Ogni mese» · «Ogni 3 mesi» · «Ogni anno» | Sì | «Ogni mese» (domanda 7) |
| Giorno di addebito | `Input type="number"` 1-31 | No | — |
| Conto di addebito | `Select` dei conti aperti, con «Qualunque conto» | No | «Qualunque conto» |
| Il beneficiario contiene | `Input`, max 80 | Sì | Default: il testo di «Gestore», se scritto. Aiuto: «Una parte del nome che compare nel movimento.» |

**C. «Fai versamenti liberi?»** — sorgente `manual`.

- Nessun campo. Aiuto: «Aggiunge il pulsante «Registra contributo» in testa alla pagina del fondo.»

Tutti gli interruttori spenti è una scelta valida: il fondo nasce senza sorgenti (§10.4). Pulsante primario: «Continua».

### 3.4 Passo 3 · Commissioni

Titolo «Commissioni». Testo: «Le commissioni servono a spiegare e a stimare i costi. Conta sempre la commissione
che scrivi sul singolo contributo.»

- Lista delle commissioni (§7.1), vuota senza modello. Sotto la lista: «Aggiungi commissione»
  (`Button variant="secondary"`, icona `Plus`), che apre il dialogo della commissione (§7.2).
- Lista vuota: testo `text-muted` «Nessuna commissione. Puoi aggiungerle dopo, nelle impostazioni.» Pulsante primario:
  «Salta per ora».
- Lista con almeno una riga: pulsante primario «Continua».
- «Si applica a» del dialogo offre le sorgenti scelte nel passo 2.

### 3.5 Passo 4 · Riepilogo

Titolo «Riepilogo». Un `<dl>` con una riga per scelta. Ogni gruppo ha il link «Modifica», che torna al suo passo.

| Gruppo | Righe (esempio) |
|---|---|
| Il fondo | «Fondo Gamma» · Gestore «Esempio Previdenza» · Linea «Bilanciata» · Adesione 1 mar 2026 · Valore 1.200,00 € al 14 nov 2026 |
| Come versi | «Busta paga: il mio contributo, datore di lavoro, TFR · per trimestre · scadenza il 20 del mese dopo» · «Addebito periodico: 100,00 € ogni mese, il giorno 5, da Conto corrente» · «Versamenti liberi» |
| Commissioni | «Quota associativa · 12,00 € all'anno» · «Gestione · 0,45 % all'anno sul patrimonio» |

- Gruppo senza scelte: «Nessuna sorgente: registri contributi e valori a mano.» · «Nessuna commissione.»
- Pulsante primario: «Crea fondo». Durante il salvataggio: `disabled`, testo «Creo il fondo…».
- Riuscito: redirect a `/funds/<id>` e toast «Fondo creato».

### 3.6 Stati della procedura

| Stato | Dove | Testo e comportamento |
|---|---|---|
| Campo obbligatorio vuoto | Sotto il campo (`Field` con `error`) | «Scrivi un nome.» · «Scegli la data di adesione.» · «Scrivi l'importo previsto.» · «Scrivi una parte del nome del beneficiario.» · «Scegli almeno una voce.» · «Scrivi il giorno di scadenza.» Il focus va al primo campo sbagliato |
| Data non valida | Sotto il campo | «La data non può essere nel futuro.» · «Il valore non può avere una data prima dell'adesione.» |
| Nome doppio (risposta del server) | Ritorno al passo 1, sotto «Nome» | «Esiste già un fondo con quel nome.» |
| Voce di busta paga già presa (risposta del server) | Ritorno al passo 2, sotto «Voci» | «Una voce è già assegnata a «{fund}». Toglila qui o dal fondo «{fund}».» |
| Errore del server | Avviso `role="alert"` sopra il piede della card | «Fondo non creato. Riprova.» I dati restano |
| Nessun conto aperto | Passo 2, campo «Conto di addebito» | Il `Select` ha solo «Qualunque conto» |
| Caricamento della pagina | — | `Skeleton`: indicatore dei passi e card con 4 righe |

## 4. Home `/funds`

La struttura approvata non cambia: periodo, hero, KPI, grafico «Guadagno | Valore», lista dei fondi, «Chi ha versato»,
«Anno per anno» su «Tutto» (`funds-ux.md` §6, §10). Cambia solo quello che dipendeva dal tipo o che H18 toglie.

| Parte | Oggi | Con N6 |
|---|---|---|
| Pulsante «Aggiungi fondo» | Apre un dialogo | Link a `/funds/new` |
| Riga del fondo, seconda riga | PAC: «Piano {amount} al mese · {stato}» o «Nessun piano». Pensione: «In arrivo {amount} · {n} trimestri» | Dalla configurazione: «In arrivo {amount} · {n} periodi» con una sorgente `payroll` con scadenze; «Addebito {amount} {frequenza} · {stato}» con una sorgente `bank_debit` attiva. Tutte e due se esistono, separate da « · ». Nessuna sorgente: nessuna seconda riga |
| Riga del fondo, etichetta del tipo | Dove compare («PAC», «Fondo pensione») | Non esiste |
| KPI «In arrivo» | Sempre | Solo se almeno un fondo ha una sorgente `payroll` con scadenze. Altrimenti la riga ha 3 KPI (`@4xl:grid-cols-3`) |
| Nota del KPI «Versato» | «tu · azienda · TFR» | «tu {you} · datore {employer} · TFR {tfr} · volontari {voluntary}». Una voce a zero non compare |
| Card «Chi ha versato» | Tu · Azienda · TFR · Altro, più la barra «Deducibile usato» | Il mio contributo · Datore di lavoro · TFR · Volontario · Altro (solo se ≠ 0). La barra «Deducibile» non esiste |
| Avviso «versamento non trovato» | Solo PAC | Ogni fondo con una sorgente `bank_debit` attiva |
| Stato vuoto | «Nessun fondo» | Stesso `EmptyState`. Testi in §12.1 |

Senza la barra «Deducibile» la card «Chi ha versato» è più bassa: resta nella colonna da 1/3, allineata in alto.

## 5. Dettaglio del fondo

### 5.1 Testata

- Riga meta (`data-testid="fund-meta"`): `{gestore} · {linea} · dal {mese anno}`. Il tipo non compare. Le voci
  vuote non compaiono.
- `h1`: nome, con `Badge tone="neutral"` «Archiviato» se serve.
- `Page.actions` (non per un fondo archiviato): «Aggiorna valore» (`variant="primary"`) e, con una sorgente
  `manual`, «Registra contributo» (`variant="secondary"`). Il pulsante dell'import non esiste più.
- `TabLinks`: Panoramica · Contributi · Valori · Impostazioni. `PeriodControl` a destra, non sul tab Impostazioni.
- Un solo elenco di tab nel codice: `PAC_TABS` e `PENSION_TABS` diventano un elenco.

### 5.2 Tab Panoramica

Ordine fisso. Una sezione compare solo se la sua condizione è vera.

| # | Sezione | Compare se | Contenuto |
|---|---|---|---|
| 1 | Hero: guadagno, rendimento, riga del valore, note | Sempre | Come oggi. La parte «{units} quote · ultimo valore quota» compare solo se esistono movimenti di quote |
| 2 | Avviso «versamento non trovato» | Sorgente `bank_debit` attiva e addebito del periodo non trovato dopo il giorno previsto | Come oggi (`fund-alert`), con il link «Controlla le spese» |
| 3 | Avviso «In arrivo» | Sorgente `payroll` con scadenze e importi maturati non ancora nel fondo | Come oggi (`fund-on-the-way`). «trimestre» diventa il periodo della sorgente |
| 4 | KPI «Versato», «Andamento del mercato», «Commissioni» | Sempre | Come oggi. Nota di «Versato»: origine come in §4. Nota di «Commissioni»: §10.6 |
| 5 | KPI «Addebito periodico» | Sorgente `bank_debit` attiva | Valore: importo previsto. Nota: «{frequenza}, il giorno {day} · {stato}». Sostituisce il KPI «Piano» |
| 6 | KPI «Maturato in busta» | Stato «solo buste paga» nel periodo | Come oggi |
| 7 | Grafico `FundChart` | Sempre | Come oggi |
| 8 | «Ultimi contributi» | Sempre | Le ultime 5 operazioni del periodo, con l'origine (§5.3). Link «Tutti i contributi» |
| 9 | «Dal maturato al valore» | Sorgente `payroll` | Come oggi |
| 10 | Proiezione | Sempre | Solo sorgente `bank_debit` attiva: card breve, sull'importo previsto. Altri casi: `<details>` chiuso, sulla media dei contributi ricorrenti. Regole di `funds-ux.md` §9 decisione 8 |

- La riga dei KPI ha 3 colonne con 3 KPI e 4 colonne con 4 (`grid-cols-2`, poi `@4xl:grid-cols-3` o
  `@4xl:grid-cols-4`). Con 5 KPI (righe 5 e 6 insieme) la riga va a capo: 2 + 3.
- Il KPI «Deducibile usato» non esiste.

### 5.3 Tab Contributi

| # | Sezione | Compare se | Contenuto |
|---|---|---|---|
| 1 | «Contributi» (registro) | Sempre | Una tabella per tutte le operazioni del periodo. Sotto |
| 2 | «Buste paga» | Sorgente `payroll` | Come oggi (`fund-payslips`) |
| 3 | «Periodi» | Sorgente `payroll` con scadenze | La riconciliazione di oggi (`fund-quarters`): maturato, nel fondo, differenza, stato, «Accetta differenza». Una riga per periodo della sorgente: «3° trim. 2026» oppure «ott 2026» |
| 4 | «Addebito periodico» | Sorgente `bank_debit` | Card di oggi «La regola» (`fund-deposit-rule`): testo della regola, `Badge` «Attiva» o «In pausa», link «Modifica» → `?tab=settings#sources` |

**Registro «Contributi».** `Card padded={false}`, `CardHeader` con il titolo, il conteggio («{n} contributi») e,
a destra, «Registra contributo» (`Button size="sm"`; non per un fondo archiviato).

| Colonna | Compare se | Note |
|---|---|---|
| Data | Sempre | — |
| Origine | Sempre | `Badge tone="neutral"`: «Busta paga» · «Addebito» · «A mano» · «Importato». «Importato» è solo storia: righe lette da un documento prima di N6 |
| Periodo | Almeno una riga ha un periodo di competenza | «3° trim. 2026» |
| Il mio contributo · Datore di lavoro · TFR | Almeno una riga del periodo ha una di queste voci | Importi |
| Volontario | Almeno una riga volontaria | Importo addebitato |
| Altro | Almeno una riga con «altro» ≠ 0 | — |
| Commissioni | Sempre | «—» con `title` «Commissione sconosciuta» se `fees_unknown` |
| Investito | Sempre | Netto |
| Azioni | Sempre | «Modifica», «Elimina» per le righe «A mano». Una riga «Addebito» si toglie da Spese (regola di oggi). Una riga «Importato» o «Busta paga» non ha azioni |

- Fondo con sola sorgente `bank_debit` o `manual`: le colonne sono Data · Origine · Volontario (intestazione
  «Addebitato») · Commissioni · Investito. Sono le colonne del tab «Versamenti» di oggi.
- Riga del totale (`TotalRow`) come oggi. Con una commissione sconosciuta, nota sotto la tabella: «Una commissione
  è sconosciuta: i totali la contano come 0.»
- Sotto `@5xl` la tabella diventa una lista: riga 1 data e investito, riga 2 origine e voci («Il mio contributo
  80,00 € · Datore 60,00 € · TFR 210,00 € · Commissioni 3,00 €»), riga 3 le azioni. Stessi controlli della tabella.
- La scheda «Deducibile per anno» e la card «Versamento volontario» non esistono più.

### 5.4 Tab Valori

| # | Sezione | Compare se | Contenuto |
|---|---|---|---|
| 1 | «Valori» | Sempre | Come oggi (`fund-valuations`): una riga per valore, con versato, guadagno e rendimento del tratto; «Modifica», «Elimina» |
| 2 | «Estratti già letti» | Esistono righe lette da un documento prima di N6 | La tabella «Estratti del fondo» di oggi (`fund-statements`), in sola lettura. Nessun link a un file. Nota: «Dati letti dai documenti prima che l'import fosse tolto. Restano parte del fondo.» |

La lista «Documenti del fondo» (`fund-documents`) non esiste più. Un valore nuovo entra solo con «Aggiorna valore».

## 6. Tab Impostazioni

`SettingsGrid` con 4 `SettingsSection`, in quest'ordine. Non segue il periodo.

### 6.1 Generale (`#general`)

Un form (`FundSettingsForm`, un solo form per ogni fondo): Nome, Gestore, Linea o comparto, Data di adesione, e in
«Avanzate» Codice e Valuta (sola lettura). Pulsante «Salva». Sotto il form, una riga: «Il valore sta sul conto
«{account}».» con il link «Apri {account}» (`/accounts/<id>?tab=settings`). Sostituisce la sezione «Conto del valore».

Il campo «Tipo di fondo» e i testi `kindHelp` e `kindFixed` non esistono più.

### 6.2 Contributi (`#sources`)

Descrizione: «Da dove arriva il denaro. Una sorgente descrive il piano: il versato viene sempre dai contributi
registrati.»

Lista delle sorgenti: una riga per sorgente, dentro la sezione, separate da `border-t border-border`.

| Parte della riga | Contenuto |
|---|---|
| Titolo | «Busta paga» · «Addebito periodico» · «Versamenti liberi», con `Badge` «In pausa» se non attiva |
| Riepilogo (`text-sm text-muted`) | `payroll`: «Il mio contributo, datore di lavoro, TFR · per trimestre · scadenza il 20 del mese dopo · tolleranza 15 giorni». `bank_debit`: «100,00 € ogni mese, il giorno 5 · da Conto corrente · beneficiario contiene «esempio»». `manual`: «Contributi inseriti a mano.» |
| Scadenze (`payroll` con scadenza) | «Prossime scadenze: 20 gen · 20 apr · 20 lug · 20 ott» |
| Nota (`payroll`, se scritta) | Testo dell'utente. Le percentuali della vecchia «regola contributiva» stanno qui |
| Azioni | «Modifica» (`Button size="xs" variant="ghost"`) e `ActionMenu`: «Metti in pausa» / «Riattiva», «Rimuovi». `manual`: solo «Rimuovi» |

- Sotto la lista: «Aggiungi sorgente» (`ButtonMenu`): «Busta paga», «Addebito periodico», «Versamenti liberi».
  «Busta paga» non compare senza il modulo Payroll. «Versamenti liberi» è disattivata se esiste già.
- «Modifica» e «Aggiungi» aprono il dialogo della sorgente (`Modal width={520}`), con i campi del passo 2 (§3.3)
  più, per `payroll`, il campo «Nota» (`Textarea`, max 300).
- Sorgente `payroll`, parte in più sotto il riepilogo: «Codici della busta paga» (le righe di oggi, in sola lettura),
  il link «Apri Payroll › Impostazioni» e il pulsante «Ricostruisci dalle buste paga». Le sezioni «Origine:
  cedolini», «Versamenti aziendali» e «Regole contributive» di oggi confluiscono in questa riga.
- Sorgente `bank_debit`: nel dialogo resta «Trova dai movimenti» (`DetectRuleButton` di oggi), che propone
  la regola da un movimento scelto.
- Scadenze di un fondo migrato che i 3 campi non descrivono: il riepilogo le elenca («Scadenze: 20/4 · 20/7 ·
  20/10 · 20/1») e il dialogo mostra «Scadenze personalizzate» in sola lettura, con «Sostituisci con una regola».
- **Rimuovi** (domanda 3): una sorgente senza contributi si toglie subito, con un toast «Sorgente rimossa» e
  «Annulla». Una sorgente con contributi non ha «Rimuovi»: ha solo «Metti in pausa». Il menu lo spiega con una voce
  disattivata: «Rimuovi · ha {n} contributi».
- Lista vuota: §10.4.

### 6.3 Commissioni (`#fees`)

Descrizione: «Le commissioni spiegano e stimano i costi. Conta sempre la commissione scritta sul singolo contributo.»
Contenuto: lista delle commissioni (§7.1), «Aggiungi commissione», riga del costo stimato (§7.3).

### 6.4 Zona pericolosa (`#danger`)

Come oggi: testo, «Archivia fondo» o «Ripristina fondo». Testo: «Archivia {name}. Contributi e valori restano leggibili.»

## 7. Commissioni

### 7.1 Lista

Una sola componente, usata nel passo 3 della procedura e in Impostazioni.

| Colonna | Contenuto (esempi) |
|---|---|
| Nome | «Quota associativa» (testo dell'utente) |
| Tipo | «All'ingresso» · «Su ogni contributo» · «Periodica» · «Sul patrimonio» · «A richiesta» |
| Importo | «12,00 € all'anno» · «1,50 € a contributo» · «0,45 % all'anno» · «10,00 € una volta» |
| Si applica a | «Tutto» · «Busta paga» · «Busta paga · TFR» · «Addebito periodico» |
| Validità | «dal 1 gen 2026» · «fino al 31 dic 2025» · vuoto |
| Azioni | «Modifica», «Rimuovi» (`Button size="xs" variant="ghost"`) |

- Ordine: prima le commissioni valide oggi, per tipo nell'ordine della colonna «Tipo», poi per nome.
- Commissioni non più valide (`valid_to` prima di oggi): dentro un `<details>` chiuso «Non più valide ({n})», in
  fondo alla lista.
- Una riga con nota o fonte ha sotto il nome la nota in `text-muted`. Un indirizzo web è un link (`rel="noreferrer"`).
- Sotto `@5xl` la tabella diventa una lista: riga 1 nome e importo, riga 2 tipo · si applica a · validità, riga 3
  le azioni.
- **Rimuovi**: subito, con un toast «Commissione rimossa» e «Annulla» (stesso schema di N5). Nessun
  `window.confirm`. Nella procedura la riga sparisce senza toast.
- La lista non cambia i contributi già registrati: ogni contributo tiene la sua commissione.

### 7.2 Dialogo «Aggiungi commissione» / «Modifica commissione»

`Modal width={520}`. Form in una colonna.

| Campo | Controllo | Obbligatorio | Regole |
|---|---|---|---|
| Nome | `Input`, max 80 | Sì | — |
| Tipo | `Select` | Sì | 5 valori di §7.1. Sotto il campo, una riga di aiuto che cambia con il valore (§12.2, `fees.basisHelp.*`) |
| Importo o percentuale | `Segmented`: «Importo» · «Percentuale» | Sì | «Sul patrimonio»: solo «Percentuale» (il controllo non compare). «All'ingresso» e «A richiesta»: solo «Importo» |
| Valore | `Input numeric` | Sì | Importo > 0, oppure percentuale tra 0 e 100, fino a 4 decimali |
| Ogni | `Select`: «mese» · «trimestre» · «anno» | Sì per «Periodica» e «Sul patrimonio» | Default «anno». Non compare per gli altri tipi |
| Si applica a | `Select`: «Tutto», una voce per sorgente, una voce per componente della busta paga | No | Default «Tutto». Non compare se il fondo non ha sorgenti e per «Sul patrimonio» |
| Valida dal · Valida fino al | 2 `Input type="date"` dentro «Avanzate» (`<details>`) | No | «fino al» non prima di «dal» |
| Nota o fonte | `Input`, max 300 | No | Testo o indirizzo web |

Piede: «Annulla», «Salva commissione». Errori sotto i campi. Errore del server: `role="alert"` sopra il piede.

### 7.3 Costo stimato e commissioni sconosciute

- Con almeno una commissione «Sul patrimonio» e un valore del fondo, sotto la lista: «Costo annuo stimato sul
  patrimonio: circa {amount} ({rate} di {value}, valore del {date}). È già dentro il valore: Ledgerly non lo
  sottrae.»
- Senza un valore: «Serve un valore per stimare il costo sul patrimonio.»
- Lista vuota (commissioni sconosciute): §10.6.

## 8. Dialoghi dei dati

### 8.1 «Registra contributo»

Un solo dialogo (`Modal width={520}`) sostituisce «Aggiungi versamento» del PAC e «Versamento volontario» della
pensione. Si apre da: testata (con sorgente `manual`), intestazione del registro, stati vuoti.

| Campo | Controllo | Obbligatorio | Regole |
|---|---|---|---|
| Tipo di contributo | `Segmented`: «Volontario» · «Dalla busta paga» | Sì | Default «Volontario». Default «Dalla busta paga» se il fondo ha una sorgente `payroll` e nessuna sorgente `bank_debit` o `manual` |
| Data | `Input type="date"` | Sì | Default oggi. Non dopo oggi |
| Importo | `Input numeric` | Sì («Volontario») | > 0. Importo addebitato, lordo |
| Il mio contributo · Datore di lavoro · TFR | 3 `Input numeric` | Almeno uno > 0 («Dalla busta paga») | — |
| Periodo | `Select` dei periodi della sorgente | No («Dalla busta paga», con sorgente `payroll`) | Default: il periodo più vecchio ancora «in arrivo». Senza sorgente `payroll` il campo non compare |
| Commissione | `Input numeric` | No | Default: somma delle commissioni «Su ogni contributo» e «Periodica» che si applicano. Non oltre l'importo |
| Non conosco la commissione | `Checkbox` | No | Attiva: il campo «Commissione» è disattivato e vuoto; l'operazione ha `fees_unknown` |
| Investito | Riga calcolata, `aria-live="polite"` | — | Importo − commissione. «—» con la commissione sconosciuta |
| Movimento collegato | `Select` degli ultimi 60 movimenti candidati | No («Volontario») | Come oggi |
| Nota | `Input`, max 200 | No | — |

- Titolo: «Registra contributo · {name}». In modifica: «Modifica contributo».
- Aiuto sotto «Tipo di contributo», per «Dalla busta paga»: «Scrivi quanto è arrivato nel fondo, come lo dice il
  fondo. Ledgerly lo confronta con le buste paga.»
- Piede: «Annulla», «Salva contributo». Toast: «Contributo salvato».
- Altri tipi di operazione (iscrizione, trasferimento, uscita): domanda 4.

### 8.2 «Aggiorna valore»

Il dialogo di oggi (`ValuationButton`: data, valore, nota, riga «Ultimo registrato»). Cambiano solo i testi:
«Registra valore» diventa «Aggiorna valore»; la descrizione non cita più l'estratto (§12.1).

## 9. I 2 fondi di oggi dopo la migrazione

La migrazione (strada A) non cambia righe e numeri. Cambiano etichette e posizione di alcune parti. Nel piano i 2
fondi sono descritti in `11-standardization.md` §11.2.3. Qui: fondo A = il fondo con i contributi dalla busta paga
(oggi tipo `pension`); fondo B = il fondo con l'addebito mensile (oggi tipo `pac`).

| Parte | Fondo A, dopo N6 | Fondo B, dopo N6 |
|---|---|---|
| Home, riga | Stessi importi. Seconda riga «In arrivo …» | Stessi importi. Seconda riga «Addebito {amount} ogni mese · {stato}» al posto di «Piano …» |
| Riga meta | `{gestore} · {linea} · dal …`, senza «Fondo pensione» | `{gestore} · dal …`, senza «Piano di accumulo (PAC)» |
| Tab | Panoramica · Contributi · Valori · Impostazioni | Gli stessi 4. «Versamenti» diventa «Contributi» |
| Hero, KPI «Versato», «Andamento del mercato», «Commissioni» | Uguali | Uguali |
| KPI «Deducibile usato» | Non esiste (X1) | Non c'era |
| KPI «Piano» | Non c'era | Diventa «Addebito periodico», stesso importo, stesso stato del mese |
| Registro del tab Contributi | Le stesse operazioni importate, origine «Importato», stesse colonne e stessi totali | Le stesse 10 righe dei versamenti: 9 «Addebito», 1 «A mano». Stessi addebitato, commissione, investito e totale |
| «Buste paga», «Periodi» | Uguali. «Trimestri» si chiama «Periodi» | Non compaiono |
| «Deducibile per anno» | Non esiste (X1) | Non c'era |
| Tab Valori | Stessi valori e stessi tratti. «Estratti già letti» in sola lettura. Nessuna lista di documenti | Stessi valori e stessi tratti |
| Impostazioni › Contributi | 1 sorgente «Busta paga»: 3 voci, per trimestre, scadenza il 20 del mese dopo, tolleranza di oggi. Le percentuali della regola stanno nella nota | 1 sorgente «Addebito periodico»: importo, giorno, conto e beneficiario di oggi; stato «Attiva» |
| Impostazioni › Commissioni | Le righe della regola e del tariffario (decisione ST-10): «All'ingresso», «Periodica» per trimestre, «Sul patrimonio», «A richiesta» | 2 righe: «Su ogni contributo» e «Sul patrimonio» all'anno |
| Pulsanti in testata | «Aggiorna valore». Nessun «Importa» | «Aggiorna valore» |
| Proiezione | `<details>` chiuso, media dei ricorrenti: uguale | Card breve sull'importo previsto: uguale |

- Le etichette delle righe create dalla migrazione (nomi delle commissioni, nota della sorgente) sono dati del
  fondo, scritti nella lingua dell'utente. Non sono chiavi di traduzione e l'utente le può cambiare.
- Il conto del fondo B passa al gruppo pensione in Accounts e Overview (X2). Questa specifica non cambia quelle pagine.
- E2E: i 2 fondi a 400 e 1440 px, nei due temi; il confronto dei numeri è delle prove SN1-SN7.

## 10. Stati

### 10.1 Vuoto: nessun fondo

`EmptyState` di oggi nella home: titolo «Nessun fondo pensione», testo «Aggiungi un fondo pensione per seguire
contributi, valore e rendimento.», azione «Aggiungi fondo» (`ButtonLink variant="primary"` → `/funds/new`).

### 10.2 Caricamento

| Dove | Scheletro |
|---|---|
| Home | `home-skeleton.tsx` di oggi |
| Dettaglio | `fund-skeleton.tsx` di oggi: hero, KPI, grafico, 2 righe |
| Tab Impostazioni | 4 card con titolo e 3 righe `Skeleton` |
| Procedura | Indicatore dei passi e card con 4 righe |
| Dialoghi | Nessuno scheletro: i dati arrivano con la pagina. Durante il salvataggio il pulsante primario è `disabled` |

Gli scheletri restano dentro `Suspense` nella pagina, senza `loading.tsx` (`funds-ux.md` §13).

### 10.3 Errore

| Caso | Dove | Testo |
|---|---|---|
| Pagina non caricata | `ErrorState` al posto del contenuto | «Fondi non caricati. Riprova.» con «Riprova» |
| Fondo non trovato | 404 dell'app | — |
| Salvataggio non riuscito | `role="alert"` nel dialogo o nel form, sopra i pulsanti | «Salvataggio non riuscito. Riprova.» |
| Fondo archiviato | Stesso punto | «Un fondo archiviato non cambia. Ripristinalo prima.» |
| Voce di busta paga già presa | Dialogo della sorgente, sotto «Voci» | «Una voce è già assegnata a «{fund}».» |
| Movimento già collegato | Dialogo del contributo, sotto il campo | «Quel movimento è già collegato a un altro contributo.» |
| Annulla del toast non riuscito | Toast `tone="error"` | «Non ripristinato. Ricarica la pagina.» |

Un errore non svuota mai i campi scritti.

### 10.4 Fondo senza sorgenti

- Panoramica: tutte le sezioni «sempre» restano. Nessun avviso, nessun KPI in più.
- Contributi: il registro con il suo stato vuoto o con le righe a mano. Nessun'altra sezione.
- Impostazioni › Contributi: `EmptyState` compatto dentro la sezione. Titolo «Nessuna sorgente». Testo «Registri
  contributi e valori a mano. Aggiungi una sorgente se il denaro arriva dalla busta paga o da un addebito.»
  Azione «Aggiungi sorgente».
- Testata: solo «Aggiorna valore». «Registra contributo» è nel registro del tab Contributi (domanda 1).

### 10.5 Fondo senza valori e fondo senza contributi

| Caso | Panoramica | Contributi | Valori |
|---|---|---|---|
| Nessun valore, mai | Hero «Ancora nessun valore» (`funds-ux.md` §6). Sotto, azione primaria «Aggiorna valore». KPI «Andamento del mercato»: «—», nota «serve un valore». Il grafico mostra lo stato vuoto di oggi | — | `EmptyState`: «Ancora nessun valore. Scrivi il primo per misurare il fondo.» Azione «Aggiorna valore» |
| Nessun valore nel periodo | Stati di oggi («Nessun valore nel {anno}», «Non determinabile») | — | «Nessun valore {when}.» con l'ultimo valore noto |
| Un solo valore | Come oggi | — | «Serve un secondo valore per il rendimento del tratto.» |
| Nessun contributo, mai | KPI «Versato» 0,00 €, nota «nessun contributo». «Ultimi contributi»: testo vuoto e «Registra contributo» | `EmptyState` nel registro: «Ancora nessun contributo.» Azione primaria «Registra contributo». Con una sorgente `payroll` o `bank_debit`, una riga sotto: «I contributi delle sorgenti arrivano da soli.» | — |
| Nessun contributo nel periodo | Come oggi | «Nessun contributo {when}.» | — |
| Fondo appena creato (nessun valore, nessun contributo) | Sotto l'hero, una card `data-testid="fund-first-steps"` con 2 azioni: «Registra contributo» (primaria) e «Aggiorna valore». La card sparisce al primo dato | Come sopra | Come sopra |

In ogni stato vuoto l'azione manuale viene per prima (piano §11.2.2).

### 10.6 Commissioni sconosciute

Due casi diversi, con testi diversi.

| Caso | Dove | Testo |
|---|---|---|
| Il fondo non ha commissioni configurate | Impostazioni › Commissioni | `EmptyState` compatto: «Commissioni non indicate». «Ledgerly non stima i costi di questo fondo. I numeri non cambiano: conta la commissione di ogni contributo.» Azione «Aggiungi commissione» |
| Stesso caso | KPI «Commissioni» | Valore: somma delle commissioni dei contributi, come oggi. Nota: «sui contributi, già nel guadagno». Nessun avviso: non è un errore |
| Un contributo ha la commissione sconosciuta (`fees_unknown`) | KPI «Commissioni» | Nota «una commissione è sconosciuta» (testo di oggi) |
| Stesso caso | Registro | «—» nella cella, nota sotto la tabella (§5.3) |
| Stesso caso | Dialogo del contributo | `Checkbox` «Non conosco la commissione» attiva |

Una commissione sconosciuta non è mai mostrata come 0,00 € nella riga.

### 10.7 Altri stati

| Stato | Comportamento |
|---|---|
| Fondo archiviato | Nessun pulsante di scrittura in testata, nei tab e nelle liste. In Impostazioni resta solo «Ripristina fondo»; sorgenti e commissioni sono in sola lettura |
| Modulo Payroll non attivo, fondo con sorgente `payroll` | La sorgente resta, con la nota «Il modulo Payroll non è attivo: registra a mano i contributi della busta paga.» |
| Sorgente in pausa | `Badge` «In pausa». Nessun avviso «versamento non trovato», nessun KPI «Addebito periodico» |
| Valore vecchio (> 31 giorni) | Come oggi: link «da aggiornare» nella home |
| Versato dopo l'ultimo valore | Come oggi: nota sotto l'hero |

## 11. Layout di riferimento

Verifica a 400 px e a 1440 px, in tema chiaro e scuro. Nessun colore fisso: solo token (§13.3). Nessuno scorrimento
orizzontale della pagina a 400 px.

### 11.1 400 px

```text
Procedura, passo 2                       Dettaglio, tab Contributi (fondo con busta paga)
┌──────────────────────────────────┐     ┌──────────────────────────────────┐
│ ‹ Fondi   Aggiungi fondo pensione│     │ ‹ Fondi   Fondo Alfa   [Aggiorna]│
├──────────────────────────────────┤     ├──────────────────────────────────┤
│ 1 ✓  2 Come versi  3  4          │     │ Esempio Previdenza · Bilanciata  │
│ ┌──────────────────────────────┐ │     │ Fondo Alfa                       │
│ │ Come versi                   │ │     │ Panoramica Contributi Valori Imp.│
│ │ Scegli da dove arriva …      │ │     │ [Anno|Tutto|Pers.]   ‹ 2026 ›    │
│ │ Versi dalla busta paga? [●━] │ │     │ ┌ Contributi · 4   [Registra c.]┐│
│ │  ☑ Il mio contributo         │ │     │ │ 20 ott 2026          347,00 € ││
│ │  ☑ Datore di lavoro          │ │     │ │ Importato · 3° trim. 2026     ││
│ │  ☑ TFR                       │ │     │ │ Il mio 80 · Datore 60 · TFR…  ││
│ │  Periodo [Mese|Trimestre]    │ │     │ ├───────────────────────────────┤│
│ │  Scadenza            [━○]    │ │     │ │ Totale             1.388,00 € ││
│ │ ──────────────────────────── │ │     │ └───────────────────────────────┘│
│ │ Addebito periodico?    [━○]  │ │     │ ┌ Buste paga ───────────────────┐│
│ │ ──────────────────────────── │ │     │ ┌ Periodi ──────────────────────┐│
│ │ Versamenti liberi?     [━○]  │ │     └──────────────────────────────────┘
│ │ [        Continua          ] │ │
│ │ [        Indietro          ] │ │
│ └──────────────────────────────┘ │
└──────────────────────────────────┘
```

- Testata del dettaglio: «Aggiorna valore» resta nella barra in alto. «Registra contributo» (con sorgente `manual`)
  sta nella riga del titolo, a destra, alto 36 px.
- `TabLinks`: 4 tab su una riga con scorrimento orizzontale del solo elenco dei tab, come oggi.
- KPI 2×2. Con 3 KPI il terzo è a tutta larghezza (`col-span-2`).
- Impostazioni: le 4 sezioni in una colonna. Azioni della riga di una sorgente sotto il riepilogo, allineate a sinistra.
- Dialoghi: a tutta larghezza, piede fisso in basso (comportamento di `Modal`).
- Target di tocco: righe con interruttore alte almeno 44 px; pulsanti `xs` con area di 24 px almeno.

### 11.2 1440 px

```text
Dettaglio, tab Impostazioni
┌ sidebar ┬─────────────────────────────────────────────────────────────────────────────┐
│         │ Fondi › Fondo Beta                              [Registra contributo] [Aggiorna valore]
│         │ Esempio Previdenza · dal gen 2026
│         │ Fondo Beta
│         │ Panoramica  Contributi  Valori  Impostazioni
│         │ ┌ Generale ───────────────────────┐ ┌ Contributi ──────────────────────────┐
│         │ │ Nome [Fondo Beta            ]   │ │ Addebito periodico         [Modifica]⋯│
│         │ │ Gestore [                   ]   │ │ 100,00 € ogni mese, il giorno 5 · …   │
│         │ │ Linea [        ] Adesione [  ]  │ │ ───────────────────────────────────── │
│         │ │ ▸ Avanzate              [Salva] │ │ Versamenti liberi                    ⋯│
│         │ │ Il valore sta su «Fondo Beta» → │ │ [+ Aggiungi sorgente ▾]               │
│         │ └─────────────────────────────────┘ └───────────────────────────────────────┘
│         │ ┌ Commissioni ────────────────────────────────────────────────────────────────┐
│         │ │ Nome            Tipo               Importo          Si applica a   Validità │
│         │ │ Per versamento  Su ogni contributo 1,50 € a contr.  Addebito per.  —    ✎ ✕ │
│         │ │ Gestione        Sul patrimonio     0,45 % all'anno  Tutto          —    ✎ ✕ │
│         │ │ [+ Aggiungi commissione]   Costo annuo stimato sul patrimonio: circa 40,50 € │
│         │ └─────────────────────────────────────────────────────────────────────────────┘
│         │ ┌ Zona pericolosa ────────────────┐
└─────────┴─────────────────────────────────────────────────────────────────────────────┘
```

- `SettingsGrid`: Generale e Contributi affiancate; Commissioni a tutta larghezza (ha una tabella); Zona pericolosa
  da sola.
- Procedura: colonna da 560 px a sinistra; il resto della pagina è vuoto, come nella procedura della banca.
- Panoramica e Contributi: griglie di oggi (`funds-ux.md` §6, mockup `a-05`, `a-06`).

### 11.3 Temi

- Chiaro e scuro usano gli stessi token; nessuna regola `dark:` nuova.
- `Badge` di origine: `tone="neutral"` nei due temi. Lo stato non passa mai solo dal colore: ogni badge ha il testo.
- Interruttore acceso: `bg-primary`; spento: `bg-track`; pallino `bg-card`. Contrasto del bordo ≥ 3:1 nei due temi:
  l'interruttore spento ha `border border-border` e il pallino ha `shadow` di 1 px.

## 12. Testi

Ogni testo sta in `messages/it.json` e `messages/en.json`, namespace `funds`. Nessuna chiave contiene un tipo di
fondo, la parola «PAC», un nome di gestore o un nome di datore di lavoro.

### 12.1 Chiavi da cambiare

| Chiave | it | en |
|---|---|---|
| `funds.empty.title` | Nessun fondo pensione | No pension funds |
| `funds.empty.description` | Aggiungi un fondo pensione per seguire contributi, valore e rendimento. | Add a pension fund to track contributions, value and return. |
| `funds.fund.tabs.valuations` | Valori | Values |
| `funds.fund.recordValue` | Aggiorna valore | Update value |
| `funds.valuations.form.title` | Aggiorna valore · {name} | Update value · {name} |
| `funds.valuations.form.description` | Scrivi il valore che il fondo ti comunica. Si salva come saldo del conto del fondo. | Enter the value the fund reports. It is saved as the balance of the fund's account. |
| `funds.fund.recent.title` | Ultimi contributi | Latest contributions |
| `funds.fund.recent.empty` | Nessun contributo in questo periodo. | No contribution in this period. |
| `funds.home.kpis.origin` | tu {you} · datore {employer} · TFR {tfr} · volontari {voluntary} | you {you} · employer {employer} · TFR {tfr} · voluntary {voluntary} |
| `funds.home.kpis.nothingPaid` | nessun contributo | no contribution |
| `funds.home.kpis.paidInFirst` | il primo contributo è del {date} | the first contribution is of {date} |
| `funds.home.kpis.feesNote` | sui contributi, già nel guadagno | on contributions, already in the gain |
| `funds.home.kpis.marketNote` | variazione del valore, senza i contributi | change in value, contributions excluded |
| `funds.home.who.you` | Il mio contributo | My contribution |
| `funds.home.who.employer` | Datore di lavoro | Employer |
| `funds.home.who.empty` | Nessun contributo in questo periodo. | No contribution in this period. |
| `funds.home.list.onTheWay` | In arrivo {amount} · {count, plural, one {# periodo} other {# periodi}} | On the way {amount} · {count, plural, one {# period} other {# periods}} |
| `funds.fund.contributions.quarters.title` | Periodi | Periods |
| `funds.fund.contributions.quarters.empty` | Nessun periodo {when}. | No period {when}. |
| `funds.fund.contributions.components.worker` | Il mio contributo | My contribution |
| `funds.fund.contributions.components.employer` | Datore di lavoro | Employer |
| `funds.alert.missing` | nessun addebito trovato entro il {date} ({amount} attesi). | no debit found by {date} ({amount} expected). |
| `funds.settings.danger.text` | Archivia {name}. Contributi e valori restano leggibili. | Archive {name}. Contributions and values stay readable. |
| `funds.errors.linked` | Questo contributo viene da un movimento: nascondi il movimento in Spese per toglierlo. | This contribution comes from a movement: hide the movement in Expenses to remove it. |
| `funds.errors.movement_taken` | Quel movimento è già collegato a un altro contributo. | That movement is already tied to another contribution. |
| `funds.toasts.deposit` | Contributo salvato | Contribution saved |
| `funds.toasts.depositDeleted` | Contributo eliminato | Contribution deleted |
| `investments.funds.description` | I fondi pensione restano in Fondi; qui sono in sola lettura. | Pension funds stay in Funds; they are shown here read only. |
| `settings.tokens.scopeHints.imports` | caricare buste paga | upload payslips |

Le chiavi doppie di `funds.pension.*` che ripetono `funds.fund.*` e `funds.settings.*` confluiscono nelle chiavi
di `funds.fund.*`, `funds.settings.*`, `funds.sources.*` e `funds.fees.*`. Dopo N6 il gruppo `funds.pension` tiene
solo quello che nessun altro gruppo ha: `classes`, `bridge`, `payslipTypes`, `statuses`, `reasons`,
`reconciliation`, `notice`. In `notice.pendingQuarter` «versamento aziendale previsto il» diventa «versamento
previsto il» / «transfer due».

### 12.2 Chiavi nuove

**Procedura** (`funds.wizard.*`)

| Chiave | it | en |
|---|---|---|
| `title` | Aggiungi fondo pensione | Add pension fund |
| `steps.label` | Passi | Steps |
| `steps.fund` | Il fondo | The fund |
| `steps.sources` | Come versi | How you pay in |
| `steps.fees` | Commissioni | Fees |
| `steps.review` | Riepilogo | Summary |
| `steps.done` | completato | done |
| `fund.intro` | Scrivi i dati che conosci. Puoi cambiare tutto dopo, nelle impostazioni del fondo. | Enter what you know. You can change everything later, in the fund's settings. |
| `fund.name` | Nome | Name |
| `fund.provider` | Gestore | Provider |
| `fund.memberSince` | Data di adesione | Member since |
| `fund.line` | Linea o comparto | Line or compartment |
| `fund.value` | Valore di oggi | Value today |
| `fund.valueOn` | Data del valore | Date of the value |
| `fund.template` | Modello | Template |
| `fund.templateNone` | Nessun modello | No template |
| `fund.templateHint` | Un modello copia scadenze e commissioni di un fondo noto. Puoi cambiarle. | A template copies the due dates and fees of a known fund. You can change them. |
| `fund.templateReplace` | Il modello sostituisce le scelte dei passi 2 e 3. | The template replaces the choices of steps 2 and 3. |
| `fund.templateReplaceYes` | Sostituisci | Replace |
| `fund.templateReplaceNo` | Tieni le mie scelte | Keep my choices |
| `fund.advanced` | Avanzate | Advanced |
| `fund.currency` | Valuta | Currency |
| `fund.currencyFixed` | La valuta non si cambia dopo la creazione. | The currency cannot change after the fund is created. |
| `fund.code` | Codice | Code |
| `fund.codeHint` | Identificativo del fondo o della tua posizione. | Identifier of the fund or of your position. |
| `fromTemplate` | Dal modello «{model}». Controlla e cambia quello che non vale per te. | From the template “{model}”. Check it and change what does not apply to you. |
| `sources.intro` | Scegli da dove arriva il denaro. Nessuna scelta è obbligatoria. | Choose where the money comes from. No choice is required. |
| `sources.payrollQuestion` | Versi dalla busta paga? | Do you pay in from your payslip? |
| `sources.payrollHelp` | I contributi trattenuti in busta paga arrivano da soli nel fondo. | Contributions withheld from your payslip reach the fund automatically. |
| `sources.payrollOff` | Senza il modulo Payroll registri a mano anche i contributi della busta paga. | Without the Payroll module you also record payslip contributions by hand. |
| `sources.debitQuestion` | Hai un addebito periodico su un conto? | Do you have a recurring debit on an account? |
| `sources.debitHelp` | Ledgerly trova l'addebito tra i movimenti del conto e crea il contributo. | Ledgerly finds the debit among the account's movements and creates the contribution. |
| `sources.manualQuestion` | Fai versamenti liberi? | Do you make one-off payments? |
| `sources.manualHelp` | Aggiunge il pulsante «Registra contributo» in testa alla pagina del fondo. | Adds the “Record contribution” button at the top of the fund's page. |
| `fees.intro` | Le commissioni servono a spiegare e a stimare i costi. Conta sempre la commissione che scrivi sul singolo contributo. | Fees explain and estimate the costs. The fee you enter on each contribution is the one that counts. |
| `fees.empty` | Nessuna commissione. Puoi aggiungerle dopo, nelle impostazioni. | No fees. You can add them later, in the settings. |
| `review.fund` | Il fondo | The fund |
| `review.sources` | Come versi | How you pay in |
| `review.fees` | Commissioni | Fees |
| `review.edit` | Modifica | Edit |
| `review.noSources` | Nessuna sorgente: registri contributi e valori a mano. | No source: you record contributions and values by hand. |
| `review.noFees` | Nessuna commissione. | No fees. |
| `review.valueLine` | Valore {value} al {date} | Value {value} on {date} |
| `continue` | Continua | Continue |
| `back` | Indietro | Back |
| `cancel` | Annulla | Cancel |
| `skip` | Salta per ora | Skip for now |
| `create` | Crea fondo | Create fund |
| `creating` | Creo il fondo… | Creating the fund… |
| `created` | Fondo creato | Fund created |
| `errors.name` | Scrivi un nome. | Enter a name. |
| `errors.memberSince` | Scegli la data di adesione. | Choose the membership date. |
| `errors.valueBeforeStart` | Il valore non può avere una data prima dell'adesione. | The value cannot be dated before the membership date. |
| `errors.failed` | Fondo non creato. Riprova. | Fund not created. Try again. |

**Sorgenti** (`funds.sources.*`)

| Chiave | it | en |
|---|---|---|
| `title` | Contributi | Contributions |
| `description` | Da dove arriva il denaro. Una sorgente descrive il piano: il versato viene sempre dai contributi registrati. | Where the money comes from. A source describes the plan: the paid-in amount always comes from the recorded contributions. |
| `kinds.payroll` | Busta paga | Payslip |
| `kinds.bank_debit` | Addebito periodico | Recurring debit |
| `kinds.manual` | Versamenti liberi | One-off payments |
| `add` | Aggiungi sorgente | Add source |
| `edit` | Modifica | Edit |
| `pause` | Metti in pausa | Pause |
| `resume` | Riattiva | Resume |
| `remove` | Rimuovi | Remove |
| `removeBlocked` | Rimuovi · ha {count, plural, one {# contributo} other {# contributi}} | Remove · it has {count, plural, one {# contribution} other {# contributions}} |
| `paused` | In pausa | Paused |
| `active` | Attiva | Active |
| `empty.title` | Nessuna sorgente | No source |
| `empty.text` | Registri contributi e valori a mano. Aggiungi una sorgente se il denaro arriva dalla busta paga o da un addebito. | You record contributions and values by hand. Add a source if the money comes from your payslip or from a debit. |
| `components.label` | Voci | Components |
| `components.worker` | Il mio contributo | My contribution |
| `components.employer` | Datore di lavoro | Employer |
| `components.tfr` | TFR | TFR |
| `components.taken` | Già assegnata a «{fund}» | Already assigned to “{fund}” |
| `period.label` | Periodo di competenza | Accrual period |
| `period.month` | Mese | Month |
| `period.quarter` | Trimestre | Quarter |
| `employer` | Datore di lavoro (facoltativo) | Employer (optional) |
| `due.switch` | Il versamento ha una scadenza | The transfer has a due date |
| `due.day` | Giorno di scadenza | Due day |
| `due.offset` | Mesi dopo la fine del periodo | Months after the period ends |
| `due.sameMonth` | Nello stesso mese | In the same month |
| `due.tolerance` | Tolleranza (giorni) | Tolerance (days) |
| `due.toleranceHint` | Per quanti giorni dopo la scadenza un versamento mancante resta "in arrivo". | How many days after the due date a missing transfer is still “on the way”. |
| `due.next` | Prossime scadenze: {dates} | Next due dates: {dates} |
| `due.none` | Senza scadenza un contributo conta nel giorno in cui lo registri. | With no due date a contribution counts on the day you record it. |
| `due.custom` | Scadenze personalizzate: {dates} | Custom due dates: {dates} |
| `due.replace` | Sostituisci con una regola | Replace with a rule |
| `note` | Nota | Note |
| `debit.amount` | Importo previsto | Expected amount |
| `debit.frequency` | Frequenza | Frequency |
| `debit.frequencies.month` | Ogni mese | Every month |
| `debit.frequencies.quarter` | Ogni 3 mesi | Every 3 months |
| `debit.frequencies.year` | Ogni anno | Every year |
| `debit.day` | Giorno di addebito | Debit day |
| `debit.account` | Conto di addebito | Paying account |
| `debit.anyAccount` | Qualunque conto | Any account |
| `debit.match` | Il beneficiario contiene | Payee contains |
| `debit.matchHint` | Una parte del nome che compare nel movimento. | A part of the name shown on the movement. |
| `debit.kpi` | Addebito periodico | Recurring debit |
| `debit.kpiNote` | {frequency}, il giorno {day} · {status} | {frequency}, on day {day} · {status} |
| `debit.listLine` | Addebito {amount} {frequency} · {status} | Debit {amount} {frequency} · {status} |
| `summary.payroll` | {components} · per {period} | {components} · by {period} |
| `summary.due` | scadenza il {day} del mese dopo · tolleranza {days} giorni | due on day {day} of the next month · tolerance {days} days |
| `summary.debit` | {amount} {frequency}, il giorno {day} · da {account} · beneficiario contiene «{match}» | {amount} {frequency}, on day {day} · from {account} · payee contains “{match}” |
| `summary.manual` | Contributi inseriti a mano. | Contributions entered by hand. |
| `payrollInactive` | Il modulo Payroll non è attivo: registra a mano i contributi della busta paga. | The Payroll module is not active: record payslip contributions by hand. |
| `codes.title` | Codici della busta paga | Payslip codes |
| `codes.open` | Apri Payroll › Impostazioni | Open Payroll › Settings |
| `rebuild` | Ricostruisci dalle buste paga | Rebuild from payslips |
| `saved` | Sorgente salvata | Source saved |
| `removed` | Sorgente rimossa | Source removed |
| `undo` | Annulla | Undo |
| `errors.component` | Scegli almeno una voce. | Choose at least one component. |
| `errors.componentTaken` | Una voce è già assegnata a «{fund}». Toglila qui o dal fondo «{fund}». | A component is already assigned to “{fund}”. Remove it here or from the fund “{fund}”. |
| `errors.amount` | Scrivi l'importo previsto. | Enter the expected amount. |
| `errors.match` | Scrivi una parte del nome del beneficiario. | Enter a part of the payee's name. |
| `errors.dueDay` | Scrivi il giorno di scadenza. | Enter the due day. |

**Commissioni** (`funds.fees.*`)

| Chiave | it | en |
|---|---|---|
| `title` | Commissioni | Fees |
| `description` | Le commissioni spiegano e stimano i costi. Conta sempre la commissione scritta sul singolo contributo. | Fees explain and estimate the costs. The fee entered on each contribution is the one that counts. |
| `add` | Aggiungi commissione | Add fee |
| `editTitle` | Modifica commissione | Edit fee |
| `columns.label` | Nome | Name |
| `columns.basis` | Tipo | Type |
| `columns.amount` | Importo | Amount |
| `columns.scope` | Si applica a | Applies to |
| `columns.validity` | Validità | Validity |
| `basis.one_off` | All'ingresso | On joining |
| `basis.per_contribution` | Su ogni contributo | On each contribution |
| `basis.periodic` | Periodica | Recurring |
| `basis.on_assets` | Sul patrimonio | On assets |
| `basis.per_request` | A richiesta | On request |
| `basisHelp.one_off` | Si paga una volta, all'adesione. | Paid once, when you join. |
| `basisHelp.per_contribution` | Si toglie da ogni contributo. | Taken from each contribution. |
| `basisHelp.periodic` | Si paga a intervalli fissi, dai contributi. | Paid at fixed intervals, from the contributions. |
| `basisHelp.on_assets` | Percentuale annua sul valore. È già dentro il valore del fondo. | Yearly percentage of the value. It is already inside the fund's value. |
| `basisHelp.per_request` | Si paga solo per un'operazione che chiedi tu. | Paid only for an operation you ask for. |
| `mode.amount` | Importo | Amount |
| `mode.rate` | Percentuale | Percentage |
| `value` | Valore | Value |
| `every` | Ogni | Every |
| `periods.month` | mese | month |
| `periods.quarter` | trimestre | quarter |
| `periods.year` | anno | year |
| `amountOnce` | {amount} una volta | {amount} once |
| `amountEach` | {amount} a contributo | {amount} per contribution |
| `amountPer` | {amount} al {period} | {amount} per {period} |
| `rateEach` | {rate} di ogni contributo | {rate} of each contribution |
| `ratePer` | {rate} all'{period} | {rate} per {period} |
| `amountOnRequest` | {amount} a richiesta | {amount} on request |
| `scope.all` | Tutto | Everything |
| `scope.component` | {source} · {component} | {source} · {component} |
| `validFrom` | Valida dal | Valid from |
| `validTo` | Valida fino al | Valid to |
| `from` | dal {date} | from {date} |
| `to` | fino al {date} | to {date} |
| `note` | Nota o fonte | Note or source |
| `expired` | Non più valide ({count}) | No longer valid ({count}) |
| `save` | Salva commissione | Save fee |
| `saved` | Commissione salvata | Fee saved |
| `remove` | Rimuovi | Remove |
| `removed` | Commissione rimossa | Fee removed |
| `estimate` | Costo annuo stimato sul patrimonio: circa {amount} ({rate} di {value}, valore del {date}). È già dentro il valore: Ledgerly non lo sottrae. | Estimated yearly cost on assets: about {amount} ({rate} of {value}, value of {date}). It is already inside the value: Ledgerly does not subtract it. |
| `estimateNeedsValue` | Serve un valore per stimare il costo sul patrimonio. | A value is needed to estimate the cost on assets. |
| `empty.title` | Commissioni non indicate | Fees not set |
| `empty.text` | Ledgerly non stima i costi di questo fondo. I numeri non cambiano: conta la commissione di ogni contributo. | Ledgerly does not estimate the costs of this fund. The figures do not change: the fee of each contribution counts. |
| `errors.label` | Scrivi un nome. | Enter a name. |
| `errors.value` | Scrivi un valore maggiore di zero. | Enter a value above zero. |
| `errors.rate` | Scrivi una percentuale tra 0 e 100. | Enter a percentage between 0 and 100. |
| `errors.validity` | «Valida fino al» non può essere prima di «Valida dal». | “Valid to” cannot be before “Valid from”. |

**Contributi** (`funds.contribution.*` e `funds.fund.contributions.register.*`)

| Chiave | it | en |
|---|---|---|
| `contribution.record` | Registra contributo | Record contribution |
| `contribution.title` | Registra contributo · {name} | Record contribution · {name} |
| `contribution.editTitle` | Modifica contributo | Edit contribution |
| `contribution.kind` | Tipo di contributo | Contribution type |
| `contribution.kinds.voluntary` | Volontario | Voluntary |
| `contribution.kinds.payroll` | Dalla busta paga | From the payslip |
| `contribution.payrollHelp` | Scrivi quanto è arrivato nel fondo, come lo dice il fondo. Ledgerly lo confronta con le buste paga. | Enter what reached the fund, as the fund reports it. Ledgerly compares it with your payslips. |
| `contribution.date` | Data | Date |
| `contribution.amount` | Importo | Amount |
| `contribution.period` | Periodo | Period |
| `contribution.noPeriod` | Nessun periodo | No period |
| `contribution.fee` | Commissione | Fee |
| `contribution.feeUnknown` | Non conosco la commissione | I do not know the fee |
| `contribution.invested` | Investito: {amount} | Invested: {amount} |
| `contribution.movement` | Movimento collegato | Linked movement |
| `contribution.noMovement` | Nessun movimento | No movement |
| `contribution.note` | Nota | Note |
| `contribution.save` | Salva contributo | Save contribution |
| `contribution.errors.amount` | Scrivi un importo maggiore di zero. | Enter an amount above zero. |
| `contribution.errors.components` | Scrivi almeno un importo. | Enter at least one amount. |
| `contribution.errors.fee` | La commissione non può superare l'importo. | The fee cannot be above the amount. |
| `fund.contributions.register.title` | Contributi | Contributions |
| `fund.contributions.register.count` | {count, plural, one {# contributo} other {# contributi}} | {count, plural, one {# contribution} other {# contributions}} |
| `fund.contributions.register.origin` | Origine | Origin |
| `fund.contributions.register.origins.payroll` | Busta paga | Payslip |
| `fund.contributions.register.origins.rule` | Addebito | Debit |
| `fund.contributions.register.origins.manual` | A mano | By hand |
| `fund.contributions.register.origins.import` | Importato | Imported |
| `fund.contributions.register.period` | Periodo | Period |
| `fund.contributions.register.voluntary` | Volontario | Voluntary |
| `fund.contributions.register.charged` | Addebitato | Charged |
| `fund.contributions.register.fees` | Commissioni | Fees |
| `fund.contributions.register.invested` | Investito | Invested |
| `fund.contributions.register.feeUnknownCell` | Commissione sconosciuta | Unknown fee |
| `fund.contributions.register.feeUnknown` | Una commissione è sconosciuta: i totali la contano come 0. | A fee is unknown: the totals count it as 0. |
| `fund.contributions.register.empty` | Nessun contributo {when}. | No contribution {when}. |
| `fund.contributions.register.emptyEver` | Ancora nessun contributo. | No contribution yet. |
| `fund.contributions.register.fromSources` | I contributi delle sorgenti arrivano da soli. | Contributions from the sources arrive automatically. |
| `fund.firstSteps.title` | Primi passi | First steps |
| `fund.firstSteps.text` | Registra un contributo o scrivi il valore di oggi per vedere il fondo. | Record a contribution or enter today's value to see the fund. |
| `fund.valuations.read.title` | Estratti già letti | Statements already read |
| `fund.valuations.read.note` | Dati letti dai documenti prima che l'import fosse tolto. Restano parte del fondo. | Data read from documents before the import was removed. It stays part of the fund. |
| `home.who.voluntary` | Volontario | Voluntary |
| `settings.general.valueAccount` | Il valore sta sul conto «{account}». | The value is kept on the account “{account}”. |
| `errors.load` | Fondi non caricati. Riprova. | Funds not loaded. Try again. |
| `errors.undo` | Non ripristinato. Ricarica la pagina. | Not restored. Reload the page. |

### 12.3 Chiavi da togliere

| Gruppo | Chiavi | Motivo |
|---|---|---|
| Tipo e PAC | `funds.types.*`, `funds.detail.kind`, `funds.pension.kind`, `funds.settings.general.kind`, `kindPac`, `kindPension`, `kindHelp`, `kindFixed`, `funds.settings.general.isin`, `funds.form.*`, `funds.settings.plan.*`, `funds.settings.rule.*`, `funds.fund.tabs.deposits`, `funds.fund.deposits.*`, `funds.deposits.*`, `funds.fund.kpis.plan`, `planDay`, `planStatus`, `planMonth`, `noPlan`, `perDeposit`, `deposits`, `funds.home.list.plan`, `planOff`, `noPlan`, `funds.fund.recent.allDeposits`, `sourceRule`, `sourceHand`, `investments.funds.types.pac` | Tipo PAC, criterio 9 |
| «Deducibile» | `funds.home.who.deductible`, `deductibleOf`, `deductibleNote`, `deductibleOver`, `funds.fund.kpis.deductible`, `deductibleNote`, `deductibleOver`, `funds.fund.contributions.deductible.*` | H18, criterio 12 |
| Documenti | `funds.pension.documents.*`, `documentStates.*`, `import.*`, `review.*`, `statements.*`, `operations.empty`, `funds.fund.valuations.documents.*`, `funds.fund.valuations.statements.title` e `empty`, gli errori di file in `funds.pension.errors` (`empty`, `too_large`, `too_many`, `unsupported_format`, `invalid_state`, `no_table`, `missing_columns`, `bad_value`, `binary_xls`, `storage_failed`, `not_an_export`, `extraction_failed`, `parse_failed`, `original_missing`, `unreadable_pdf`) | H19, criterio 13 |
| Regole del gestore | `funds.pension.settings.*` (confluite in `funds.sources.*` e `funds.fees.*`), `funds.pension.voluntary.*`, `funds.fund.contributions.voluntary.*`, `funds.pension.quarters.*` (doppie di `fund.contributions.quarters.*`), `funds.pension.tabs.*` | Una sola serie di schermate |

Controlli attesi sui file dei testi dopo N6: 0 risultati per `PAC`, per `deductib` e per un nome di gestore, in
`messages/` (maiuscole e minuscole).

### 12.4 Etichette per i lettori di schermo

| Elemento | it | en |
|---|---|---|
| Indicatore dei passi (`<ol aria-label>`) | Passi | Steps |
| Interruttore | L'etichetta è la domanda della riga | — |
| Riga del registro, pulsanti | «Modifica il contributo del {date}» · «Elimina il contributo del {date}» | “Edit the contribution of {date}” · “Delete the contribution of {date}” |
| Riga di una commissione, pulsanti | «Modifica {label}» · «Rimuovi {label}» | “Edit {label}” · “Remove {label}” |
| Menu di una sorgente (`ActionMenu`) | «Azioni per {kind}» | “Actions for {kind}” |
| Cella della commissione sconosciuta | «Commissione sconosciuta» | “Unknown fee” |

## 13. Componenti e token

### 13.1 Da riusare, senza modifiche

| Componente | Uso |
|---|---|
| `Page`, `TabLinks`, `PeriodControl` | Guscio, tab e periodo, come oggi |
| `Card`, `CardHeader`, `SettingsGrid`, `SettingsSection` | Card della procedura, sezioni delle impostazioni |
| `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `Segmented` | Tutti i form |
| `Button`, `ButtonLink`, `ActionMenu`, `ButtonMenu` | Azioni |
| `Modal` (`width={520}`) | Dialoghi di contributo, valore, sorgente, commissione |
| `Table`, `THead`, `Th`, `TBody`, `Tr`, `Td`, `TotalRow` | Registro, valori, commissioni |
| `Badge` | Origine, «In pausa», «Archiviato» |
| `EmptyState`, `ErrorState`, `Skeleton` | Stati |
| `notify` con azione | Toast «Annulla» |
| `useUnsavedForm` | Uscita dalla procedura e dai form |
| `Kpi` di Funds (`fund-kpi.tsx`), `FundChart`, `ClosedProjection`, `ShortProjection` | Panoramica |
| `ValuationButton`, `EditValuationButton`, `DeleteValuation`, `FundStateButton`, `DetectRuleButton`, `AcceptDifferenceButton`, `ClearDecisionButton` | Azioni di oggi che restano |
| Icone lucide: `Plus`, `Check`, `Pencil`, `Trash2`, `MoreHorizontal` | Pulsanti e indicatore |

### 13.2 Nuovo o modificato, con il motivo

| Componente | Cosa | Motivo |
|---|---|---|
| `Switch` (`src/ui/switch.tsx`) | Interruttore sopra la primitiva `Switch` di `@base-ui/react`, già nel progetto. 36 × 20 px, area di tocco 44 × 24 px, `focus-ring` | Il piano chiede «tre domande con interruttore». Il progetto non ha un interruttore. Nessun pacchetto nuovo |
| `StepIndicator` (`src/ui/step-indicator.tsx`) | `<ol>` dei passi | Stesso elemento della procedura della banca (N1): un solo componente per le due procedure |
| `FundWizard` | La procedura di §3 | Sostituisce `NewFundButton` e `KindField` |
| `SourceList`, `SourceDialog`, `SourceFields` | Sorgenti: lista, dialogo, campi. `SourceFields` serve anche al passo 2 | Sostituiscono `DepositRuleForm`, `ToleranceForm`, `ContributionRuleForm`, `ReceivesPayrollButton` |
| `FeeList`, `FeeDialog` | Commissioni: lista e dialogo, usati nella procedura e nelle impostazioni | Sostituiscono `FeesForm` e le righe del tariffario |
| `ContributionDialog` | «Registra contributo» e la modifica | Sostituisce `AddVoluntaryButton` e il form dei versamenti |
| `FundContributions` | Tab Contributi unico, con le sezioni di §5.3 | Sostituisce `PacDeposits` e `PensionContributions` |
| `FundSettings` | Tab Impostazioni unico | Sostituisce `PacSettings` e `PensionSettings` |
| `FundSettingsForm` | Un form per ogni fondo | Sostituisce il form del PAC e `PensionSettingsForm` |

File che spariscono dall'interfaccia: `pac-deposits.tsx`, `pac-settings.tsx`, `pension-settings.tsx`,
`pension-contributions.tsx`, `pension-forms.tsx` (restano solo i pulsanti della riconciliazione, in un file loro),
`funds/pension-buttons.tsx` per la parte dei documenti, le pagine `funds/[id]/documents/`.

### 13.3 Token

Solo token esistenti di `globals.css`. Nessun token nuovo.

| Uso | Token |
|---|---|
| Superfici | `bg`, `card`, `border`, `hover` |
| Testo | `fg`, `muted`, `faint` |
| Azione primaria, interruttore acceso, link | `primary`, `primary-fg`, `accent` |
| Interruttore spento, barre | `track` |
| Guadagno e perdita, avvisi | `pos`, `neg`, `warn` e i loro `-bg` |
| Raggi | `radius-ctl` (controlli), `radius-card` (card), `radius-modal` (dialoghi) |
| Testo | `text-sm` (aiuti, note), `text-base` (corpo), `text-lg` (titolo di card), `text-title` (`h1`), `text-hero` (hero), `text-kpi` (KPI) |

## 14. Decisioni di design prese senza conferma

Scelte di sola interfaccia. Non cambiano dati o calcoli.

| # | Scelta | Motivo |
|---|---|---|
| D1 | La procedura è una pagina (`/funds/new`), non un dialogo | 4 passi con liste; coerenza con la procedura della banca di N1 |
| D2 | Il parametro del tab resta `valuations`; l'etichetta diventa «Valori» | Il piano scrive «Valori»; i link salvati funzionano |
| D3 | «Registra valore» diventa «Aggiorna valore» | Il piano usa «Aggiorna valore» |
| D4 | «Trimestri» diventa «Periodi»; «Azienda» diventa «Datore di lavoro»; «Tu» diventa «Il mio contributo» nelle liste | Il periodo segue la sorgente; le etichette sono quelle di ST-1 |
| D5 | «Rimuovi» una commissione o una sorgente senza contributi: subito, con toast «Annulla» | Schema approvato in N5; nessun `window.confirm` |
| D6 | La sezione «Conto del valore» diventa una riga in «Generale» | Il piano elenca 4 sezioni in Impostazioni |
| D7 | Scadenza scritta con 3 campi (giorno, mesi dopo il periodo, tolleranza) e anteprima delle date | Descrive le scadenze di oggi senza un calendario fisso |
| D8 | Default del periodo di competenza di una sorgente nuova: «Mese» | Un fondo nuovo non nasce con il ritmo di un altro fondo |
| D9 | Proiezione: card breve con la sola sorgente `bank_debit` attiva; `<details>` chiuso negli altri casi | Stessa vista di oggi per i 2 fondi, senza il tipo |
| D10 | Le righe lette dai documenti restano visibili in «Estratti già letti», in sola lettura | H19: i dati già letti restano dati del fondo |
| D11 | Le percentuali della vecchia «regola contributiva» stanno nella nota della sorgente | Piano §11.2.3: «componenti della sorgente, con nota» |

## 15. Decisioni prese e domande

### Decisioni prese (Mattia, 14/11/2026)

| # | Domanda | Decisione | Cosa cambia nel testo sopra |
|---|---|---|---|
| 1 | «Registra contributo» senza «Versamenti liberi» | **A** | Nulla: il pulsante c'è sempre nel tab Contributi e negli stati vuoti |
| 2 | Più sorgenti dello stesso tipo | **A** | Nulla. Limite tecnico di N6, scritto nel piano ([`../11-standardization.md`](../11-standardization.md) §11.2.7, punto 7): una sola sorgente «Busta paga» **attiva** per fondo, e la busta paga alimenta un fondo per volta |
| 3 | Rimozione di una sorgente con contributi | **A** | Nulla: pausa; «Rimuovi» solo senza contributi |
| 4 | Operazioni diverse da un contributo | **B** | §8.1: il controllo «Tipo di contributo» ha una terza voce, «Altra operazione», con il campo «Operazione»: iscrizione, trasferimento in ingresso, cambio di comparto, uscita. Campi: data, importo (non per il cambio di comparto), commissione, nota. Un'uscita non conta come perdita. Le righe compaiono nel registro del tab Contributi con il nome dell'operazione |
| 5 | Quote scritte a mano | **A** | Nulla: nessun campo per le quote |
| 6 | Modelli di fondo | **Aperta** | Il meccanismo dei modelli esiste come file di dati (`src/modules/funds/templates.json`). Il file è **vuoto** finché Mattia non risponde: con il file vuoto il campo «Modello» del passo 1 non compare (§3.2) |
| 7 | Frequenze di un addebito periodico | **Più libertà possibile** (diversa da A e da B) | §3.3 B, §6.2: al posto del `Select` a 3 valori, «Ogni» + numero (1-120) + unità (settimane, mesi, anni); «Giorno di addebito» (non per le settimane); «Data di inizio» (vuota = adesione al fondo) e «Data di fine» facoltativa. Lo stato «atteso / trovato / non trovato», l'avviso e il job lavorano per periodo. È la stessa forma di frequenza di Subscriptions in R5a: una sola primitiva. Le chiavi `debit.frequencies.*` di §12.2 non esistono: al loro posto `debit.every`, `debit.units.*`, `debit.frequencyText`, `debit.from`, `debit.to` |
| 8 | Valuta del fondo | **A** | Nulla: «Valuta» in «Avanzate», fissa dopo la creazione |

### Le domande, come erano

Decisioni di prodotto che il piano non scrive. La specifica usa l'opzione A. Con una risposta B cambia solo la
parte indicata.

### 1. «Registra contributo» senza la sorgente «Versamenti liberi»

- **Esempio.** «Fondo Beta» ha solo l'addebito mensile. Un mese la banca cambia il testo del movimento e Ledgerly non
  trova l'addebito. Vuoi scrivere quel contributo a mano.
- **A (default).** Il pulsante «Registra contributo» c'è sempre nel tab Contributi e negli stati vuoti. La sorgente
  «Versamenti liberi» lo aggiunge anche in testa alla pagina.
- **B.** Il pulsante c'è solo con la sorgente «Versamenti liberi». Senza, devi prima aggiungere la sorgente.
- **Effetto.** A: un contributo si può sempre scrivere a mano; l'interruttore del passo 2 decide solo la posizione
  del pulsante. B: regola più rigida, ma un fondo senza sorgenti non ha un modo diretto per scrivere un contributo
  (contro il criterio 3 di N6).

### 2. Più sorgenti dello stesso tipo in un fondo

- **Esempio.** Versi nello stesso fondo 100 € al mese dal conto corrente e 500 € all'anno da un altro conto. Oppure
  cambi datore di lavoro e il fondo resta lo stesso.
- **A (default).** La procedura crea al massimo una sorgente per tipo. In Impostazioni puoi aggiungere più
  «Addebito periodico» e più «Busta paga». «Versamenti liberi» è una sola.
- **B.** Al massimo una sorgente per tipo, sempre.
- **Effetto.** A: copre i casi dell'esempio; con 2 addebiti la pagina mostra 2 righe di stato. B: schermate più
  semplici; il secondo addebito si scrive a mano.

### 3. Rimozione di una sorgente che ha contributi

- **Esempio.** Chiudi l'addebito mensile di «Fondo Beta» dopo 10 contributi e vuoi togliere la sorgente.
- **A (default).** Una sorgente con contributi non si rimuove: si mette in pausa. I 10 contributi restano con
  l'origine «Addebito». Si rimuove solo una sorgente senza contributi.
- **B.** La sorgente si rimuove sempre. I contributi restano, senza sorgente.
- **Effetto.** A: la storia resta leggibile e la lista può avere sorgenti in pausa. B: lista più pulita, ma i
  contributi vecchi perdono il legame con la sorgente e le commissioni «solo per questa sorgente» non li spiegano più.

### 4. Operazioni diverse da un contributo, scritte a mano

- **Esempio.** Chiedi un'anticipazione di 5.000 € al fondo. Oppure trasferisci la posizione da un altro fondo. Senza
  l'import dei documenti, queste operazioni non entrano più da sole.
- **A (default).** «Registra contributo» offre solo «Volontario» e «Dalla busta paga», come scrive il piano.
- **B.** Il dialogo ha una terza voce «Altra operazione» con: iscrizione, trasferimento in ingresso, cambio di
  comparto, uscita.
- **Effetto.** A: meno campi, ma un'uscita non si può scrivere: il valore scende e il fondo mostra una perdita di
  5.000 €. B: i numeri restano corretti dopo un'uscita o un trasferimento; il dialogo ha una voce in più. Nessuno dei
  2 fondi di oggi ha un caso aperto.

### 5. Quote scritte a mano

- **Esempio.** «Fondo Alfa» mostra «1.234,567 quote · ultimo valore quota 12,34 € del 30 set», lette dai documenti
  prima di N6. Dopo N6 i contributi nuovi non portano quote.
- **A (default).** Le quote non si scrivono a mano. La riga delle quote resta, con la sua data, finché esistono
  movimenti di quote. Il valore del fondo viene da «Aggiorna valore».
- **B.** «Registra contributo» e «Aggiorna valore» hanno 2 campi facoltativi in «Avanzate»: quote e valore quota.
- **Effetto.** A: nessun campo in più; la riga delle quote diventa vecchia e la pagina lo dice con la data. B: le
  quote restano aggiornate, ma sono 2 campi da copiare dal sito del fondo a ogni operazione.

### 6. Modelli di fondo in N6

- **Esempio.** Nel passo 1 scegli un modello e i passi 2 e 3 partono con scadenze e commissioni già scritte.
- **A (default).** N6 ha un solo modello: scadenze e commissioni pubbliche del fondo negoziale che usi oggi. Il campo
  «Modello» compare nel passo 1. Altri modelli si aggiungono dopo, come file di dati.
- **B.** N6 non ha modelli. Il campo «Modello» non compare finché il file è vuoto.
- **Effetto.** A: prova in produzione che un modello funziona; il nome del modello contiene il nome di un fondo (è un
  dato, non un testo dell'interfaccia). B: nessun nome di fondo in tutta l'app; il meccanismo resta senza una prova
  reale.

### 7. Frequenze di un addebito periodico

- **Esempio.** Un versamento di 1.000 € ogni dicembre, oppure 300 € ogni 3 mesi.
- **A (default).** 3 frequenze: ogni mese, ogni 3 mesi, ogni anno. Lo stato «atteso / trovato / non trovato» segue
  la frequenza.
- **B.** Solo «ogni mese», come oggi. Gli altri casi si scrivono a mano.
- **Effetto.** A: il job degli addebiti e l'avviso «non trovato» lavorano per periodo, non solo per mese. B: nessun
  cambio al job; il campo «Frequenza» non compare.

### 8. Valuta del fondo

- **Esempio.** Un fondo estero in CHF.
- **A (default).** Il campo «Valuta» c'è in «Avanzate», con la valuta di visualizzazione come default, e non si cambia
  dopo la creazione. Lo scrive il piano (§11.2.1).
- **B.** N6 non mostra il campo: ogni fondo nasce nella valuta di visualizzazione.
- **Effetto.** A: un fondo in un'altra valuta usa la conversione del saldo; i calcoli approvati dei fondi sono stati
  verificati solo in EUR (`funds-ux.md` §5.2). B: nessun fondo in valuta finché i calcoli non sono verificati.

## 16. Passaggio allo sviluppo

### 16.1 Punti del piano da chiarire prima del codice

Non sono decisioni di prodotto. Il piano non dà il dettaglio che l'interfaccia chiede. **Chiariti nel piano con lo
sviluppo di N6:** [`../11-standardization.md`](../11-standardization.md) §11.2.7, punti 1-5.

1. **«Codice» del fondo.** Il piano lo mette nell'anagrafica (§11.2.1), ma il passo A1 non aggiunge una colonna e il
   passo A3 toglie `funds.isin`. La specifica mostra nel campo «Codice» il valore di oggi di `isin`.
2. **Riconciliazione senza scadenze.** Il testo di §11.2.1 dice che la riconciliazione compare con una sorgente
   `payroll`; la tabella delle sezioni dice «con scadenze». La specifica segue la tabella (§5.3, riga 3).
3. **Origine «Busta paga» nel registro.** `fund_operations.source` ha i valori `import`, `manual`, `rule`. Una riga
   scritta a mano con il tipo «Dalla busta paga» ha `source = manual` e `source_id` della sorgente `payroll`:
   il badge legge il tipo della sorgente, non `source`.
4. **Stato «in pausa» e frequenza** della sorgente: campi della configurazione della sorgente (domande 3 e 7).
5. **Modulo Payroll attivo.** Fino a R5a (moduli per utente) il modulo è attivo per ogni utente.

### 16.2 Attributi per i test

Restano i `data-testid` di oggi: `fund-meta`, `fund-alert`, `fund-on-the-way`, `kpi-paid`, `kpi-market`, `kpi-fees`,
`kpi-accrued`, `fund-payslips`, `fund-quarters`, `fund-valuations`, `fund-statements`, `fund-projection`.
Nuovi: `fund-wizard`, `wizard-step-<fund|sources|fees|review>`, `source-switch-<kind>`, `source-row`, `fee-row`,
`fund-contributions` (registro), `contribution-row`, `kpi-debit`, `fund-first-steps`, `fund-sources`, `fund-fees`.
Tolti: `kpi-deductible`, `fund-deductible`, `fund-documents`, `fund-voluntary`, `fund-deposits`, `kpi-plan`.

### 16.3 Test dell'interfaccia attesi

| Test | Cosa verifica |
|---|---|
| E2E, procedura | 4 passi con la sola tastiera; solo il passo 1 compilato → fondo creato, dettaglio aperto; con le 3 sorgenti e 2 commissioni → riepilogo con una riga per scelta |
| E2E, fondo senza sorgenti | Nessuna sezione di busta paga e di addebito; «Registra contributo» e «Aggiorna valore» negli stati vuoti |
| E2E, dettaglio dei 2 fondi | 400 e 1440 px, tema chiaro e scuro; nessuno scorrimento orizzontale; nessun `kpi-deductible`; nessun pulsante di import |
| E2E, commissioni | Aggiungi, modifica, rimuovi con «Annulla»; riga del costo stimato |
| E2E, sorgenti | Aggiungi e metti in pausa; una voce di busta paga già presa è disattivata |
| E2E, rotte tolte | `/funds/<id>/documents/<x>` risponde 404; `?tab=deposits` porta a `?tab=contributions` |
| `a11y.spec.ts`, `keyboard.spec.ts` | Procedura, i 4 tab, i 4 dialoghi, nello stesso commit delle pagine |
| Unit, testi | 0 risultati per `PAC` e `deductib` in `messages/`; ogni chiave nuova esiste in `it` e in `en` |
| Component | `FeeDialog`: campi visibili per tipo. `ContributionDialog`: «Non conosco la commissione» disattiva il campo. `SourceFields`: anteprima delle scadenze |

## 17. Tastiera e accessibilità (WCAG 2.2 AA)

### 17.1 Tastiera

| Tasto | Dove | Effetto |
|---|---|---|
| Tab / Maiusc+Tab | Ovunque | Ordine del DOM: indicatore dei passi, campi, piede. Nessun `tabindex` positivo |
| Invio | Dentro un passo o un dialogo | Invia il form: passo seguente, oppure salva |
| Spazio | `Switch`, `Checkbox` | Cambia lo stato |
| Frecce | `Segmented`, `TabLinks`, voci di un menu | Cambia la voce |
| Esc | Dialogo, menu | Chiude. Nella procedura Esc non fa nulla: si esce con «Annulla» o con il link «Fondi» |
| Invio o Spazio | `<summary>` di «Avanzate», «Non più valide», proiezione | Apre e chiude |

Focus dopo un'azione:

- Cambio di passo: `h2` del passo. Errore di un campo: primo campo sbagliato. Errore del server: l'avviso.
- Dialogo chiuso: il pulsante che lo ha aperto (`finalFocus` per le voci di `ActionMenu` e `ButtonMenu`).
- Riga rimossa: la riga seguente della lista; se la lista è vuota, il pulsante «Aggiungi».
- Interruttore acceso: il focus resta sull'interruttore; i campi nuovi sono i seguenti nell'ordine di tabulazione.

### 17.2 Requisiti

- **Nome, ruolo, valore.** `Switch` con `role="switch"` e `aria-checked`. Indicatore dei passi: `<ol>` con
  `aria-current="step"`. Ogni pulsante con sola icona ha `aria-label` (§12.4).
- **Etichette.** Ogni campo ha un `Field` con `label` e `htmlFor`. Aiuti ed errori sono legati con
  `aria-describedby`; un campo sbagliato ha `aria-invalid`.
- **Messaggi di stato.** Errori del server: `role="alert"`. Riga «Investito» e anteprima delle scadenze:
  `aria-live="polite"`. Toast: la regione viva di `Toaster`.
- **Contrasto.** Testo ≥ 4,5:1 e bordi dei controlli ≥ 3:1 nei due temi, con i soli token. `muted` su `card` e
  `faint` su `card` rispettano 4,5:1 nei due temi.
- **Colore.** Origine, stato della sorgente e guadagno o perdita hanno sempre un testo o un segno, non solo il colore.
- **Target.** ≥ 24 × 24 px per ogni controllo; ≥ 44 px di altezza per le righe con interruttore a 400 px.
- **Focus.** `focus-ring` visibile su ogni controllo; il piede fisso dei dialoghi non copre il campo con il focus.
- **Reflow.** Nessuno scorrimento orizzontale a 320 px di larghezza CSS; le tabelle passano a lista sotto `@5xl`,
  con gli stessi controlli.
- **Movimento.** Solo `animate-in` di oggi; nessuna animazione con `prefers-reduced-motion: reduce`.
- **Inserimento.** `inputMode="decimal"` sugli importi; `autocomplete="off"` sui campi del fondo. Nessun limite di tempo.
- **Titoli.** Un `h1` per pagina; `h2` per passo e per sezione; nessun salto di livello.

## 18. Criteri di accettazione di N6 coperti da questa specifica

| Criterio di N6 (`03-releases.md`) | Dove |
|---|---|
| 2 · Un fondo nuovo si crea dall'interfaccia, con sorgenti e commissioni, senza codice e senza una pagina nuova | §3: una procedura per ogni fondo. §5, §6: una serie di schermate guidata dalla configurazione |
| 3 · Fondo senza Payroll: contributi e valori a mano | §3.3 (nota senza Payroll), §8.1 («Dalla busta paga» a mano), §10.4, §10.5 |
| 9 · La parola «PAC» non compare nei testi di Funds | §12.1, §12.3, controllo di §16.3 |
| 12 · Nessun riquadro e nessun calcolo «Deducibile» | §4, §5.2, §5.3, §12.3 |
| 13 · Nessun caricamento e nessun lettore di documenti nei fondi; i dati già letti restano | §2 (rotte tolte), §5.1, §5.4, §12.3, §13.2 |

Voci di interfaccia del «Contenuto» di N6 e loro sezione: procedura in 4 passi → §3; home e dettaglio unici con 4
tab → §4, §5; sezioni guidate dalla configurazione → §5.2-§5.4; commissioni come lista → §6.3, §7; scadenze nella
sorgente → §3.3, §6.2; nessun «Deducibile» → §4, §5; nessun documento → §2, §5.4; modelli di fondo → §3.2, domanda 6;
migrazione dei 2 fondi → §9; testi senza «PAC» → §12.

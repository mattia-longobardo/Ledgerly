# N3 · Specifica UX: categorie automatiche, «Da rivedere» e movimento manuale

Indice del piano: [`../../rewrite-plan.md`](../../rewrite-plan.md). Rilascio: [`../03-releases.md`](../03-releases.md) «N3».
Regole tecniche: [`../04-now.md`](../04-now.md) §4.4 e §4.5. Decisioni: [`../01-decisions.md`](../01-decisions.md) K1, K2, K3, K4, S2, S2b, G10, P2.

Questa specifica descrive solo l'interfaccia. Il piano ha priorità: se un punto è in conflitto con il piano, vale il piano.
La soglia, il modello e la regola che decide «automatica» o «suggerita» sono del dominio: qui non sono descritti.

Le decisioni di prodotto che il piano non scrive sono in §17 «Domande per Mattia». Il testo applica sempre l'opzione A
(default). Una risposta B cambia solo le sezioni indicate nella domanda.

## 0. Riepilogo

| Voce del «Contenuto» di N3 | Dove | Sezione |
|---|---|---|
| Segno «automatica» con il motivo | Cella della categoria in `Expenses`, in «Da rivedere», nel dettaglio | §2 |
| «Da categorizzare» e suggerimento non confermato | Cella della categoria; filtro, grafico e card di `Expenses` | §3, §10 |
| Vista «Da rivedere» a gruppi: conferma, correzione, azioni di gruppo | Pagina `/expenses/review` | §4 |
| Dopo una correzione: «Applico a N movimenti simili?» | Dialogo, da ogni punto dove si sceglie una categoria | §5 |
| Proposta di unione delle categorie doppie | `Settings › Categories`, con un rimando da «Da rivedere» | §6 |
| Circa 12 gruppi predefiniti | Primo passo della revisione guidata; stato vuoto di `Settings › Categories` | §7 |
| Revisione guidata alla prima sync | Esito di «Collega una banca», poi `/expenses/review?guide=<id>` | §8 |
| Movimento manuale: crea, modifica, cancella; avviso sul conto collegato a una banca; doppio invio | Dialogo in `Expenses` | §9 |
| Categoria automatica e suggerimento in Expenses e Budgets | `Expenses`, `Budgets` | §10 |
| Stati: vuoto, caricamento, errore, nessun suggerimento | Tabella unica | §11 |
| Layout a 400 e 1440 px, due temi | — | §12 |
| Tastiera e accessibilità | — | §13 |
| Testi (it, en) e chiavi | — | §14 |

Fuori da questa specifica: la cascata, la soglia e l'addestramento (dominio, `04-now.md` §4.4); il passaggio di un conto
da Wallet a Enable Banking (N4); il primo avvio guidato dell'app (R5a).

## 1. Regole generali

### 1.1 Parole

Una parola per un significato, uguale in pulsante, titolo e toast.

| Parola nell'interfaccia | Significato | Parola del dominio (mai nell'interfaccia) |
|---|---|---|
| **Automatica** | Ledgerly ha scelto la categoria. Il movimento conta subito | `category_origin = auto` |
| **Suggerimento** | Ledgerly propone una categoria. Il movimento non conta in quella categoria finché una persona non conferma | «suggerita», tra le soglie |
| **Da categorizzare** | Il movimento non ha una categoria che conta. Comprende i movimenti con un suggerimento | categoria assente |
| **Da rivedere** | Nome della vista che raccoglie i movimenti «Da categorizzare» | — |
| **Conferma** | La persona accetta la categoria di Ledgerly. Da quel momento la categoria è una scelta della persona | etichetta confermata |
| **Movimenti simili** | Movimenti con lo stesso testo, senza le cifre | stessa chiave di memoria |
| **A mano** | Movimento scritto dalla persona in Ledgerly | origine `manual` |
| **Proposta di unione** | Ledgerly propone di unire due categorie doppie | — |

Parole vietate nella vista normale: «modello», «confidenza», «soglia», «classificatore», «addestramento», «precisione»,
«MCC», «regola», «cascata», «origine», «provider», «sync». Nessuna percentuale di sicurezza, in nessun punto.

«Da categorizzare» sostituisce «Senza categoria» in tutta l'app (§10.1): oggi le due parole direbbero la stessa cosa.

### 1.2 Stati della categoria di un movimento

Ogni movimento è in uno solo di questi stati. Lo stato decide il disegno della cella e il conteggio.

| # | Stato | Cella della categoria | Conta in Expenses e Budgets come | Sezione |
|---|---|---|---|---|
| 1 | Scelta dalla persona | Chip normale, nessun segno | La sua categoria | — (come oggi) |
| 2 | Data dalla sorgente (Wallet) | Chip normale, nessun segno | La sua categoria | — (come oggi) |
| 3 | Automatica | Chip normale + segno «automatica» | La sua categoria (criterio 2 di N3) | §2 |
| 4 | Suggerimento non confermato | Chip tratteggiato «Suggerimento: {categoria}» | «Da categorizzare» (criterio 2 di N3) | §3 |
| 5 | Da categorizzare, senza suggerimento | Chip «Da categorizzare» | «Da categorizzare» | §3 |

Passaggi di stato che l'interfaccia permette:

- 3 → 1: «Conferma» oppure scelta di un'altra categoria.
- 4 → 1: «Conferma» oppure scelta di un'altra categoria.
- 5 → 1: scelta di una categoria.
- 1 → 5: scelta di «Da categorizzare» nel selettore (come oggi con «Senza categoria»). Ledgerly non sovrascrive mai una
  scelta della persona, quindi il movimento resta nello stato 5 senza un suggerimento nuovo.
- Nessun passaggio dell'interfaccia porta a 3 o a 4: li crea solo Ledgerly.

Un giroconto non ha bisogno di una categoria: non è mai «Da categorizzare» e non compare in «Da rivedere». Un movimento
nascosto non compare in «Da rivedere».

### 1.3 Dove vale (criterio 1 di N3)

- Gli stati 3 e 4 esistono solo sui conti la cui sorgente non dà categorie: conti collegati a una banca e movimenti a mano.
- Sui conti Wallet le categorie restano quelle di Wallet. Nessun segno, nessun suggerimento, nessuna azione di N3 scrive
  la categoria di un movimento Wallet al posto della persona.
- «Da rivedere» non mostra i movimenti dei conti Wallet (domanda 1).
- «Applico a N movimenti simili?» non conta e non tocca i movimenti dei conti Wallet.

### 1.4 Componenti e token esistenti

Nessun componente nuovo in `src/ui`, nessun token nuovo, nessuna libreria nuova. I componenti nuovi stanno in
`src/modules/transactions/ui/` e sono client senza lettura dati propria (piano §4, tabella iniziale).

| Bisogno | Componente esistente |
|---|---|
| Pagina, titolo, azione in alto | `Page` con `parent` e `actions` (`src/ui/shell/page.tsx`) |
| Periodo | `PeriodBar` (`src/modules/accounts/ui/period-bar.tsx`): lo stesso controllo di Conti e Spese, con il preset «Tutto» |
| Filtro dei conti | Il menu `DismissableDetails` di `filter-bar.tsx`, senza modifiche |
| Scelta della categoria | `CategoryPicker` (`src/ui/category-picker.tsx`) |
| Chip della categoria | La classe `CHIP` di `transactions-table.tsx` (24 px) |
| Segno e motivo | `Popover` (`src/ui/popover.tsx`), icona `Sparkles` di `lucide-react` (già nel progetto) |
| Etichette sulla riga | `Badge` (`neutral`, `accent`, `warn`), `Tag` |
| Card e intestazioni | `Card`, `CardHeader`, `CardFooter` |
| Tabella e lista | `Table`, `THead`, `Th`, `TBody`, `Tr`, `Td`; lista `<ul>` sotto 768 px, come `transactions-table.tsx` |
| Dialoghi | `Modal` (`width` 420 / 460 / 520) |
| Campi | `Field`, `Input` (`numeric`), `Select`, `Textarea`, `Checkbox`, `Segmented` |
| Pulsanti | `Button` (`primary`, `secondary`, `danger`, `ghost`; `xs`, `sm`, `md`), `ButtonLink`, `LinkButton`, `ActionMenu` |
| Passi della revisione guidata | `StepIndicator` (`src/ui/step-indicator.tsx`) |
| Avanzamento | `ProgressBar` (con `dashed` per un'attesa senza fine) |
| Vuoto, errore, attesa | `EmptyState`, `ErrorState`, `Skeleton` |
| Avviso dentro una card | `rounded-ctl bg-warn-bg px-3 py-2 text-sm text-warn` (`consent-form.tsx:58`) |
| Nota informativa | `rounded-ctl bg-hover px-3 py-2 text-sm` (come il `<dl>` di `details-modal.tsx`) |
| Errore di un'azione | `<p role="alert" className="text-sm text-neg">` |
| Conferma | `notify()` con `action` (`src/ui/toast.tsx`) |
| Sezione di Settings | `SettingsSection` (`src/ui/section.tsx`) |

Componenti nuovi del modulo (nomi proposti):

| Componente | Cosa fa | Sezione |
|---|---|---|
| `CategoryCell` | Disegna la cella nei 5 stati di §1.2. Sostituisce `categoryTrigger` di `transactions-table.tsx` | §2, §3 |
| `AutoMark` | Pulsante del segno + `Popover` con il motivo | §2 |
| `ReviewGroupCard` | Un gruppo di «Da rivedere» | §4.3 |
| `SimilarDialog` | «Applico a N movimenti simili?» | §5 |
| `ManualTransactionDialog` | Crea e modifica un movimento a mano | §9 |
| `MergeProposalCard`, `MergeDialog` | Proposta di unione (in `settings/categories/`) | §6 |
| `DefaultGroupsForm` | Scelta dei gruppi predefiniti | §7 |

Token: solo quelli esistenti (`bg`, `card`, `border`, `border2`, `fg`, `muted`, `faint`, `accent`, `soft`, `primary`,
`pos`, `neg`, `warn` e i loro fondi; `rounded-ctl`, `rounded-card`, `rounded-modal`; `text-sm`, `text-base`, `text-lg`,
`text-xl`, `text-title`). I due temi arrivano dai token: nessun colore fisso. `text-faint` non si usa per un testo che
serve a capire uno stato.

## 2. Segno «automatica»

### 2.1 Disegno

La cella di una categoria automatica ha due controlli vicini:

```text
[■ Spesa alimentare] [✦]
```

- **Chip della categoria:** uguale a oggi. Apre il `CategoryPicker` (correzione).
- **Segno:** pulsante di 24 × 24 px subito a destra del chip, icona `Sparkles` `size-3.5 text-accent`, senza bordo,
  `hover:bg-hover`, `focus-ring`, `rounded-[4px]`. Nome accessibile: «Categoria automatica: mostra il motivo». `title` uguale.
- Sotto 768 px (lista) il segno mostra anche la parola: `✦ Automatica` (`text-sm text-accent`), perché c'è spazio e
  l'icona da sola è meno chiara.
- Nella tabella il chip si accorcia (`truncate`) per lasciare posto al segno: il segno non va mai a capo e non sparisce.
- Il segno non usa solo il colore: è un'icona con un nome e, su telefono, una parola.

Il segno compare in ogni punto che mostra la categoria di un movimento: tabella e lista di `Expenses`, righe di «Da
rivedere», dialogo «Applico a N movimenti simili?».

### 2.2 Motivo

Il clic sul segno apre un `Popover` (larghezza 280 px, ancorato al segno, `role="dialog"` con `aria-label` «Categoria automatica»):

```text
┌────────────────────────────────────────┐
│ Categoria automatica                   │
│ ■ Spesa alimentare                     │
│                                        │
│ Le ultime 3 volte hai scelto questa    │
│ categoria per «ESSELUNGA».             │
│                                        │
│      [Cambia categoria]  [Conferma]    │
└────────────────────────────────────────┘
```

- Titolo `text-sm font-semibold`. Categoria con il suo colore. Motivo `text-sm text-muted`.
- «Conferma» (`Button` `primary` `sm`): stato 3 → 1. Il segno sparisce. Toast «Categoria confermata».
- «Cambia categoria» (`Button` `sm`): chiude il popover e apre il `CategoryPicker` della stessa riga.
- Esc o un clic fuori chiude il popover senza modifiche. Il focus torna al segno.
- La conferma è facoltativa: una categoria automatica conta anche senza conferma (K2).

Motivi: una lista chiusa, un testo fisso tradotto per voce. Il dominio dà il codice e i parametri; mai un testo libero.

| Codice | Livello della cascata | Testo (it) |
|---|---|---|
| `memory` | Memoria | Le ultime 3 volte hai scelto questa categoria per «{text}». |
| `similar` | Classificatore dell'utente | Somiglia ad altri movimenti che hai messo in questa categoria. |
| `merchant_type` | Tabella dei tipi di esercizio | La banca indica un tipo di esercizio che corrisponde a questa categoria. |
| `brand` | Tabella dei marchi | «{brand}» è un marchio noto di questa categoria. |
| `salary` | Struttura | La banca indica questo movimento come stipendio. |
| `fee` | Struttura | La banca indica questo movimento come commissione. |

- `{text}` è il testo mostrato del movimento, non la chiave normalizzata.
- Un codice che l'interfaccia non conosce usa il testo di riserva: «Ledgerly ha scelto questa categoria dai dati del movimento.»

### 2.3 Dopo una correzione

- La persona sceglie un'altra categoria: stato 3 → 1, il segno sparisce, toast «1 movimento aggiornato» (testo esistente).
- Poi vale §5 («Applico a N movimenti simili?»).
- Il badge «Modificato qui» non compare per una correzione su un conto senza categorie della sorgente: lì non esiste
  una categoria della sorgente da cui il movimento si è allontanato.

## 3. Suggerimento non confermato e «Da categorizzare»

### 3.1 Cella con un suggerimento (stato 4)

```text
[◻ Suggerimento: Spesa alimentare]
```

- Un solo chip, con bordo tratteggiato `border border-dashed border-border2`, testo `text-muted`, quadratino con il
  colore della categoria al 100% (serve a riconoscerla) ma con bordo e senza riempimento.
- Il testo comincia sempre con la parola «Suggerimento:». Se la colonna è stretta si accorcia il nome della categoria,
  non la parola. `title` con il testo intero.
- Il movimento conta come «Da categorizzare»: il chip non usa il disegno pieno di una categoria che conta.

Il clic sul chip (o il tasto `E` sulla riga) apre un `Popover` uguale a quello di §2.2, con questi testi:

```text
┌────────────────────────────────────────┐
│ Suggerimento                           │
│ ■ Spesa alimentare                     │
│                                        │
│ Somiglia ad altri movimenti che hai    │
│ messo in questa categoria.             │
│ Non conta in questa categoria finché   │
│ non confermi.                          │
│                                        │
│   [Scegli un'altra]  [Conferma]        │
└────────────────────────────────────────┘
```

- Il focus iniziale è su «Conferma»: `E`, poi Invio, conferma un suggerimento dalla tastiera.
- «Conferma»: stato 4 → 1. Toast «Categoria confermata».
- «Scegli un'altra»: apre il `CategoryPicker`. La scelta è una correzione: poi vale §5.
- I motivi sono quelli di §2.2.

### 3.2 Cella senza suggerimento (stato 5)

```text
[▫ Da categorizzare]
```

- Il chip di oggi per «Senza categoria» (`bg-faint` sul quadratino), con il testo nuovo.
- Il clic apre il `CategoryPicker`, come oggi.

### 3.3 Selezione multipla in `Expenses`

- «Imposta categoria» della barra di selezione resta com'è: scrive la categoria scelta su tutte le righe selezionate
  (non sui movimenti Wallet se oggi non lo fa: nessun cambio).
- Azione nuova nella barra, visibile solo se almeno una riga selezionata ha un suggerimento: «Conferma i suggerimenti
  ({count})» (`Button` `xs`). Conferma solo le righe nello stato 4; le altre restano come sono.
- Dopo «Imposta categoria» su più righe non compare «Applico a N movimenti simili?» (§5.1).

## 4. Vista «Da rivedere»

### 4.1 Pagina e ingressi

- Rotta `/expenses/review`. `Page` con `title` «Da rivedere» e `parent` «Spese».
- Stato nell'URL, come `Expenses`: `preset`, `from`, `to`, `off` (periodo), `acc` (conti), `guide` (§8).
- Periodo: `PeriodBar` con i preset `thisMonth`, `lastMonth`, `last3Months`, `ytd`, `all`. Default **«Tutto»**: la vista
  serve a svuotare la coda, non a leggere un mese.
- Conti: il menu dei conti di `Expenses`. Elenca solo i conti che possono avere movimenti da rivedere (§1.3).

Ingressi:

| Da | Elemento | Quando |
|---|---|---|
| `Expenses` | Riga di avviso sotto i filtri (§10.1) | C'è almeno un movimento «Da categorizzare» nell'intervallo |
| `Budgets` | Riga di avviso sotto il totale (§10.2) | C'è almeno un movimento «Da categorizzare» nel mese |
| Esito di «Collega una banca» | Pulsante «Rivedi le categorie» (§8.1) | Dopo la prima sync |
| Palette `⌘K` | Comando «Da rivedere» | Sempre |

Nessuna voce nuova nel menu laterale e nei tab mobili: il menu cambia in R5a (D2).

### 4.2 Struttura

```text
Da rivedere
132 movimenti · 23 gruppi · −4.310,20 €

[‹ Tutto ›] [Questo mese][Mese scorso][Ultimi 3 mesi][Da inizio anno][Tutto]   [Tutti i conti ▾]

┌ colonna principale ──────────────────────────────────┐ ┌ colonna laterale ────────┐
│ Con un suggerimento · 9 gruppi · 96 movimenti        │ │ Riepilogo                │
│   [gruppo] [gruppo] …                                │ │ Con un suggerimento   96 │
│ Senza suggerimento · 14 gruppi · 30 movimenti        │ │ Senza suggerimento    30 │
│   [gruppo] [gruppo] …                                │ │ Movimenti singoli      6 │
│ Movimenti singoli · 6                                │ │──────────────────────────│
│   [tabella]                                          │ │ Proposta di unione (§6.1)│
└──────────────────────────────────────────────────────┘ └──────────────────────────┘
```

- Riga di riepilogo sotto il titolo: numero di movimenti, numero di gruppi, somma con segno. Importi con il formatter
  esistente; «Nascondi importi» vale anche qui.
- Tre sezioni, in quest'ordine, ognuna con `h2` `text-lg font-semibold` e il suo conteggio. Una sezione vuota non si disegna.
- **Gruppo:** movimenti con lo stesso testo (senza le cifre) e, se c'è, lo stesso suggerimento. Almeno 2 movimenti.
- **Movimenti singoli:** i movimenti che non hanno un simile nella vista.
- Ordine dei gruppi: numero di movimenti, dal più grande. A parità, il più recente prima.
- Ogni sezione mostra i primi 20 gruppi. Sotto: `Button` «Mostra altri {count}». Il focus va sul primo gruppo nuovo.
- Colonna laterale: card «Riepilogo» (i tre conteggi, ognuno un link all'ancora della sezione) e, se c'è, il rimando
  alla proposta di unione (§6.1). Nella revisione guidata la card mostra anche l'avanzamento (§8.3).

### 4.3 Gruppo

Chiuso, con un suggerimento:

```text
┌────────────────────────────────────────────────────────────────────────────┐
│ ESSELUNGA                                    24 movimenti · −1.240,50 €    │
│ Suggerimento: ■ Spesa alimentare                                           │
│ Somiglia ad altri movimenti che hai messo in questa categoria.             │
│                                                                            │
│ 12 nov 2026 · BBVA Conto corrente                              −54,20 €    │
│ 5 nov 2026 · BBVA Conto corrente                               −38,90 €    │
│ 29 ott 2026 · BBVA Conto corrente                              −71,15 €    │
│ ▸ Mostra tutti i 24                                                        │
│                                                                            │
│                                  [Cambia categoria ▾]  [Conferma per 24]   │
└────────────────────────────────────────────────────────────────────────────┘
```

Senza suggerimento: la riga «Suggerimento» e il motivo mancano; c'è un solo pulsante, «Scegli categoria ▾» (`primary`).

- `Card` con `<article aria-labelledby>`; titolo del gruppo `h3` `font-semibold` (il testo mostrato del movimento più
  recente); a destra conteggio e somma, `text-sm text-muted tabular-nums`.
- Tre esempi, i più recenti: data, conto, importo. `text-sm`.
- «Mostra tutti i {count}» (pulsante con `aria-expanded`): apre l'elenco completo dentro la card. Ogni riga ha un
  `Checkbox`, tutti selezionati. Una riga non selezionata resta fuori dall'azione del gruppo. Il pulsante dell'azione
  mostra sempre il numero vero: «Conferma per 22».
- Elenco aperto con più di 50 righe: altezza massima 320 px con scorrimento interno; le azioni restano visibili sotto.
- «Conferma per {count}» (`primary`): stato 4 → 1 per le righe selezionate.
- «Cambia categoria ▾» / «Scegli categoria ▾»: apre il `CategoryPicker`. La scelta vale per le righe selezionate.
- Nessuna azione «conferma tutti i gruppi»: un suggerimento è meno sicuro di una categoria automatica, quindi la
  conferma è per gruppo (§16).

Dopo un'azione riuscita la card diventa una riga di esito, senza toast:

```text
✓ ESSELUNGA · 24 movimenti in «Spesa alimentare»                    [Annulla]
```

- `role="status"`. Icona `Check` `text-pos`, testo `text-sm`. «Annulla» (`LinkButton`) riporta le righe allo stato di
  prima (domanda 8). La riga di esito resta fino al prossimo caricamento della pagina.
- Il focus va al primo pulsante del gruppo successivo. Se non c'è, al titolo della sezione successiva.
- I conteggi di titolo, sezione e «Riepilogo» si aggiornano.
- Se alcune righe sono rimaste fuori dalla selezione, la card resta, con le sole righe rimaste.

Durante il salvataggio: i pulsanti della card sono `disabled`, il primario mostra «Salvataggio…», `aria-busy="true"`
sulla card. Le altre card restano attive.

Errore: la card resta com'è; sotto le azioni `<p role="alert" class="text-sm text-neg">` «Non è stato possibile
salvare. Riprova.» L'azione di gruppo è tutto o niente: mai «salvati 20 di 24» (§18, punto 6).

### 4.4 Movimenti singoli

- Tabella con le colonne Data, Beneficiario, Conto, Categoria, Importo e una colonna di selezione. Sotto 768 px è una
  lista, con lo stesso disegno della lista di `Expenses`.
- La cella «Categoria» è `CategoryCell` (§3): chip «Suggerimento: …» o «Da categorizzare».
- Barra di selezione, come `Expenses`: «{count} selezionati», «Imposta categoria», «Conferma i suggerimenti ({count})», «Deseleziona».
- Una riga risolta esce dalla tabella dopo l'azione; toast «{count} movimenti aggiornati» con l'azione «Annulla».
- Nessun ordinamento per colonna: l'ordine è la data, dal più recente.

### 4.5 «Nessun suggerimento»

Se la vista ha movimenti ma nessun suggerimento, la sezione «Con un suggerimento» manca e sopra le sezioni c'è una nota
(`bg-hover`, `text-sm`):

> Ledgerly non ha ancora suggerimenti per questi movimenti. Impara dalle categorie che scegli: più ne scegli, più
> suggerimenti arrivano.

La nota non cita numeri del dominio (quante categorie servono).

## 5. «Applico a N movimenti simili?»

### 5.1 Quando compare

Dopo che una persona **sceglie** una categoria per **un** movimento (correzione di un'automatica, scelta al posto di un
suggerimento, scelta su «Da categorizzare»), se esistono altri movimenti simili che Ledgerly può toccare.

| Regola | Dettaglio |
|---|---|
| N | Movimenti con lo stesso testo (senza le cifre), in ogni periodo, nello stato 3, 4 o 5, con una categoria diversa da quella scelta. Mai i movimenti con una categoria scelta dalla persona o data dalla sorgente (piano: «solo su movimenti automatici o senza categoria») |
| N = 0 | Il dialogo non compare |
| «Conferma» senza cambio | Il dialogo non compare: la persona non ha corretto niente |
| Azione su più righe (barra di selezione, gruppo di «Da rivedere») | Il dialogo non compare: la persona ha già scelto l'insieme |
| Scelta di «Da categorizzare» | Il dialogo non compare |
| Da dove | `Expenses`, «Movimenti singoli» di «Da rivedere», dialogo di modifica di un movimento a mano |

### 5.2 Dialogo

`Modal` `width={460}`. Si apre dopo il salvataggio della prima scelta: quella è già fatta e non dipende dalla risposta.

```text
┌──────────────────────────────────────────────────────┐
│ Applicare a 14 movimenti simili?                     │
│                                                      │
│ Hai messo «ESSELUNGA» in ■ Spesa alimentare.         │
│ Altri 14 movimenti hanno lo stesso testo e non hanno │
│ una categoria scelta da te.                          │
│                                                      │
│ 5 nov 2026    −38,90 €   ■ Casa ✦                    │
│ 29 ott 2026   −71,15 €   Da categorizzare            │
│ 21 ott 2026   −12,40 €   Suggerimento: Ristoranti    │
│ ▸ Mostra tutti i 14                                  │
│                                                      │
│              [No, solo questo]  [Applica a 14]       │
└──────────────────────────────────────────────────────┘
```

- Titolo con il numero. Testo con il nome mostrato e la categoria scelta.
- Tre esempi, i più recenti: data, importo, categoria di adesso (con il segno, se automatica). «Mostra tutti i {count}»
  apre l'elenco completo (altezza massima 240 px, scorrimento interno).
- «Applica a {count}» (`primary`): i movimenti passano alla categoria scelta, nello stato 1. Toast «{count} movimenti
  aggiornati» con l'azione «Annulla» (domanda 8).
- «No, solo questo», Esc, clic fuori: nessun altro cambio. Nessun toast.
- Focus iniziale su «Applica a {count}»: Invio applica. Alla chiusura il focus torna alla riga corretta.
- Durante il salvataggio: pulsanti `disabled`, primario «Salvataggio…».
- Errore: `role="alert"` nel dialogo, «Non è stato possibile applicare la categoria. Il primo movimento è salvato.
  Riprova.» Il dialogo resta aperto.
- Il dialogo non ha «non chiedere più»: la domanda è la regola K3.

## 6. Proposta di unione delle categorie doppie

### 6.1 Dove

- **`Settings › Categories`:** una `SettingsSection` nuova, «Categorie doppie», **sopra** l'albero. Si disegna solo se
  c'è almeno una proposta. Una riga per proposta.
- **«Da rivedere»:** nella colonna laterale, una riga `text-sm`: «{count} proposte di unione delle categorie» con il link
  «Vedi» a `Settings › Categories`. Categorie doppie producono suggerimenti peggiori: per questo il rimando è qui.
- Nessun avviso in altre pagine, nessuna notifica.

### 6.2 Riga della proposta

```text
┌──────────────────────────────────────────────────────────────────────────┐
│ ■ Tobacco · 12 movimenti      e      ■ Alcohol, tobacco · 48 movimenti   │
│ Sembrano la stessa categoria.                                            │
│                                          [Non sono uguali]  [Unisci…]    │
└──────────────────────────────────────────────────────────────────────────┘
```

- I due nomi con il loro colore e il numero di movimenti.
- «Unisci…» (`Button` `sm` `primary`): apre il dialogo di §6.3.
- «Non sono uguali» (`Button` `sm`): la proposta sparisce e non torna per quella coppia. Toast «Proposta ignorata» con
  l'azione «Annulla».
- Il motivo della proposta non si mostra: è un calcolo del dominio.

### 6.3 Dialogo «Unisci le categorie»

`Modal` `width={460}`.

```text
┌──────────────────────────────────────────────────────┐
│ Unisci le categorie                                  │
│                                                      │
│ Quale nome resta?                                    │
│ (•) ■ Alcohol, tobacco · 48 movimenti                │
│ ( ) ■ Tobacco · 12 movimenti                         │
│                                                      │
│ I 12 movimenti di «Tobacco» passano a «Alcohol,      │
│ tobacco». «Tobacco» viene archiviata.                │
│ I limiti dei budget delle due categorie si sommano.  │
│                                                      │
│                          [Annulla]  [Unisci]         │
└──────────────────────────────────────────────────────┘
```

- `fieldset` con `legend` «Quale nome resta?» e due radio nativi. Default: la categoria con più movimenti.
- Il testo sotto cambia con la scelta e usa i numeri veri. Righe che compaiono solo se servono:
  - budget: «I limiti dei budget delle due categorie si sommano.» (domanda 7);
  - sottocategorie: «Le sottocategorie di «{name}» passano a «{kept}».» (solo per un gruppo);
  - Wallet: «I movimenti dei conti Wallet restano in «{name}»: lì decide Wallet.» (domanda 6). In questo caso la riga
    «viene archiviata» diventa ««{name}» resta per i movimenti di Wallet e non viene più suggerita.»
- «Unisci» (`primary`): toast «Categorie unite: {count} movimenti spostati». La proposta sparisce. L'albero si aggiorna.
- L'unione non crea il dialogo di §5 e non cambia lo stato dei movimenti: un movimento automatico resta automatico, con la categoria nuova.
- Errore: `role="alert"` nel dialogo, «Non è stato possibile unire le categorie. Riprova.» Nessun cambio parziale.
- L'unione non ha «Annulla» nel toast: tocca categorie, budget e movimenti insieme. Per questo il dialogo dice prima
  ogni effetto.

## 7. Gruppi predefiniti

### 7.1 A chi

Solo a un utente **senza nessuna categoria attiva** (K4: «utente nuovo»). Un utente con categorie (per esempio da
Wallet) non vede mai questa scelta e non riceve gruppi nuovi.

Due ingressi:

1. Primo passo della revisione guidata (§8.2).
2. Stato vuoto di `Settings › Categories`: sotto il testo esistente, `Button` «Usa i gruppi predefiniti». Serve a chi
   scrive solo movimenti a mano e non collega una banca.

### 7.2 Elenco proposto

12 gruppi: 11 di spesa e 1 di entrata. I nomi si creano nella lingua dell'utente al momento della creazione; poi sono
categorie normali. L'elenco è la domanda 5.

| # | Italiano | English | Tipo | Esempi (testo di aiuto) |
|---|---|---|---|---|
| 1 | Casa | Home | Spesa | Affitto, mutuo, bollette, manutenzione |
| 2 | Spesa alimentare | Groceries | Spesa | Supermercato, alimentari |
| 3 | Ristoranti e bar | Restaurants and bars | Spesa | Pranzi, cene, caffè, consegne |
| 4 | Trasporti | Transport | Spesa | Carburante, treni, mezzi pubblici, pedaggi |
| 5 | Salute | Health | Spesa | Farmacia, visite, assicurazione sanitaria |
| 6 | Shopping | Shopping | Spesa | Abbigliamento, elettronica, casa |
| 7 | Tempo libero | Leisure | Spesa | Sport, cinema, libri, hobby |
| 8 | Viaggi | Travel | Spesa | Voli, alberghi, vacanze |
| 9 | Abbonamenti e servizi | Subscriptions and services | Spesa | Telefono, internet, streaming |
| 10 | Tasse e commissioni | Taxes and fees | Spesa | Imposte, bolli, commissioni della banca |
| 11 | Altro | Other | Spesa | Tutto il resto |
| 12 | Entrate | Income | Entrata | Stipendio, rimborsi, altre entrate |

### 7.3 Modulo

```text
┌──────────────────────────────────────────────────────┐
│ Scegli i gruppi delle tue spese                      │
│ Ledgerly usa questi gruppi per dare una categoria ai │
│ movimenti. Puoi cambiarli quando vuoi in             │
│ Impostazioni › Categorie.                            │
│                                                      │
│ [x] ■ Casa                                           │
│       Affitto, mutuo, bollette, manutenzione         │
│ [x] ■ Spesa alimentare                               │
│       Supermercato, alimentari                       │
│ …                                                    │
│                                                      │
│        [Non ora]  [Crea 12 gruppi]                   │
└──────────────────────────────────────────────────────┘
```

- `fieldset` con `legend`; un `Checkbox` per gruppo, tutti selezionati; esempi `text-sm text-muted` legati con `aria-describedby`.
- Il colore è quello automatico delle categorie (`autoCategoryColor`).
- «Crea {count} gruppi» (`primary`): il numero segue la selezione. Con 0 selezionati il pulsante è `disabled`.
- «Non ora»: nessun gruppo. Nella revisione guidata si passa al passo successivo; i movimenti restano «Da categorizzare».
- In `Settings › Categories` il modulo si apre in un `Modal` `width={520}`. Toast «{count} gruppi creati».
- Errore: `role="alert"`, «Non è stato possibile creare i gruppi. Riprova.»
- «Modificabili» (K4): dopo la creazione i gruppi si rinominano, si archiviano e ricevono sottocategorie in
  `Settings › Categories`, con le funzioni di oggi. Nessun editor nuovo.

## 8. Revisione guidata alla prima sync

### 8.1 Ingresso: esito di «Collega una banca»

L'esito riuscito della procedura di N1 ([`n1-plugin-bank.md`](n1-plugin-bank.md) §6.6) riceve un blocco in più, sotto
l'elenco dei conti:

```text
│ Categorie                                              │
│ 180 movimenti hanno già una categoria. 96 hanno un     │
│ suggerimento e 36 sono da categorizzare.               │
│                                                        │
│      [Torna alle impostazioni]  [Vai ai conti]         │
│                            [Rivedi le categorie]       │
```

- «Rivedi le categorie» diventa il pulsante `primary`; «Vai ai conti» diventa `secondary`. Porta a
  `/expenses/review?guide=<id del collegamento>`.
- Il blocco compare solo se almeno un movimento è «Da categorizzare». Se tutti hanno una categoria: «Tutti i {count}
  movimenti hanno già una categoria.» e i pulsanti restano quelli di N1.
- Utente senza categorie: «Per dare una categoria ai {count} movimenti scegli prima i tuoi gruppi.» con lo stesso pulsante.
- La revisione è sempre facoltativa. Chi esce la ritrova: la vista «Da rivedere» normale mostra gli stessi movimenti.
- Rinnovo dell'accesso e sync successive: nessun blocco, nessuna revisione guidata. I movimenti nuovi arrivano in «Da rivedere».

### 8.2 Passi

`/expenses/review?guide=<id>` è la pagina di §4 con tre differenze: un `StepIndicator` in alto, il filtro dei conti
fissato ai conti di quella banca (periodo «Tutto»), un avanzamento nella colonna laterale.

| Passo | Quando | Contenuto |
|---|---|---|
| 1 · Gruppi | Solo utente senza categorie | Modulo di §7.3 dentro una `Card` larga 560 px. «Crea {count} gruppi» porta al passo 2 dopo l'attesa di §8.4 |
| 2 · Categorie | Sempre | Le sezioni di §4.2, con una card di introduzione sopra |
| 3 · Fatto | Quando non resta niente, o con «Finisci dopo» | Card di chiusura |

Per un utente con categorie i passi sono due: «Categorie» e «Fatto».

Card di introduzione del passo «Categorie» (`Card`, `bg-card`):

> **Prima lettura di {bank}**
> Ledgerly ha raggruppato i movimenti con lo stesso testo. Conferma o scegli una categoria per gruppo: vale per tutti i
> movimenti del gruppo. Puoi finire dopo: li ritrovi in Spese › Da rivedere.

A destra della card: `Button` «Finisci dopo» (porta al passo 3).

### 8.3 Avanzamento

Nella card «Riepilogo» della colonna laterale (a 400 px: sotto la card di introduzione):

```text
Fatti 9 gruppi di 23
[███████░░░░░░░░░░░]
96 movimenti con una categoria · 36 da fare
```

- `ProgressBar` con `label` «Gruppi fatti»; il testo sopra dice gli stessi numeri (l'avanzamento non è solo una barra).
- Si aggiorna dopo ogni azione su un gruppo. `aria-live="polite"` sul testo.

### 8.4 Attese

| Attesa | Vista |
|---|---|
| Dopo «Crea {count} gruppi» Ledgerly calcola le categorie | Card con `role="status"`: «Ledgerly sta cercando una categoria per {count} movimenti…», `ProgressBar` `dashed`, «Può servire qualche secondo.» La pagina si rilegge ogni 5 secondi, al massimo per 2 minuti |
| Le categorie non sono pronte all'arrivo sulla pagina | La stessa card |
| Dopo 2 minuti | «Serve più tempo del previsto. Puoi continuare dopo: i movimenti ti aspettano in Spese › Da rivedere.» + `Button` «Riprova» e `ButtonLink` «Vai a Spese» |

### 8.5 Chiusura

```text
┌──────────────────────────────────────────────────────┐
│ ✓ Revisione finita                                   │
│ 276 movimenti di BBVA hanno una categoria.           │
│ 36 sono ancora da categorizzare: li trovi in         │
│ Spese › Da rivedere.                                 │
│                                                      │
│              [Vai ai conti]  [Vai a Spese]           │
└──────────────────────────────────────────────────────┘
```

- Senza movimenti rimasti la seconda frase manca.
- «Vai a Spese» (`primary`) porta a `/expenses`; «Vai ai conti» a `/accounts`.
- Il focus va sul titolo della card (`h2`, `tabIndex={-1}`).

## 9. Movimento manuale

### 9.1 Ingressi

| Da | Elemento |
|---|---|
| `Expenses` | `Button` `primary` «Aggiungi movimento» in `Page` `actions` (in alto a destra; a 400 px resta nella barra in alto, con il solo testo «Aggiungi») |
| `Expenses`, stato «nessun movimento» | Pulsante primario dello stato vuoto (§11) |
| Palette `⌘K` | Comando «Aggiungi movimento» |

Un solo dialogo per creare e per modificare: `ManualTransactionDialog`.

### 9.2 Riconoscere un movimento a mano

- Sulla riga, vicino al beneficiario: `Badge` `neutral` «A mano». Sta con gli altri badge della riga.
- Menu della riga di un movimento a mano: «Modifica categoria», «Modifica movimento», «Nascondi» / «Ripristina», «Elimina».
- Doppio clic e «Modifica movimento» aprono il dialogo di §9.3 in modifica, non il pannello «Modifica dettagli».
- Il badge «Modificato qui» non compare mai su un movimento a mano.

### 9.3 Dialogo

`Modal` `width={460}`. Titolo «Aggiungi movimento» oppure «Modifica movimento».

```text
┌──────────────────────────────────────────────────────┐
│ Aggiungi movimento                                   │
│                                                      │
│ Tipo                                                 │
│ [ Uscita | Entrata ]                                 │
│                                                      │
│ Importo                    Data                      │
│ [          12,50 ] €       [ 15/11/2026 ]            │
│ Senza segno: lo decide il tipo.                      │
│                                                      │
│ Conto                                                │
│ [ Contanti                                      ▾ ]  │
│                                                      │
│ Beneficiario (facoltativo)                           │
│ [ Bar Centrale                                    ]  │
│                                                      │
│ Categoria                                            │
│ [◻ Suggerimento: Ristoranti e bar               ▾ ]  │
│ Suggerimento di Ledgerly. Cambialo se non va bene.   │
│                                                      │
│ Nota (facoltativa)                                   │
│ [                                                 ]  │
│                                                      │
│                  [Annulla]  [Aggiungi movimento]     │
└──────────────────────────────────────────────────────┘
```

| Campo | Controllo | Regole |
|---|---|---|
| Tipo | `Segmented` «Uscita» · «Entrata» | Default «Uscita». Nessun «Giroconto»: il piano scrive «uscita o entrata» |
| Importo | `Input` `numeric`, `inputMode="decimal"`, obbligatorio | Senza segno, maggiore di zero, nel formato numerico dell'utente. Focus iniziale qui. Valuta del conto a destra del campo |
| Data | `Input type="date"`, obbligatorio | Default oggi (fuso dell'utente). `max` = oggi: nessuna data futura |
| Conto | `Select`, obbligatorio | Solo i conti permessi (domanda 2). Due `optgroup`: «Conti tenuti a mano», «Conti collegati a una banca». Default: l'ultimo conto usato in questo dialogo (preferenza del browser); altrimenti il primo conto tenuto a mano |
| Beneficiario | `Input`, facoltativo, `maxLength={255}` | Domanda 4 |
| Categoria | `CategoryPicker` con un trigger largo come il campo | Elenca le categorie del tipo scelto. Vuota = «Da categorizzare» |
| Nota | `Textarea` `rows={2}`, facoltativa | — |
| Etichette | Il `fieldset` di `details-modal.tsx` | Solo in modifica |

**Suggerimento della categoria** («La categoria proposta arriva dalla cascata»):

- Quando beneficiario, nota, importo o conto cambiano e la persona non ha ancora scelto una categoria, il dialogo chiede
  un suggerimento (attesa di 400 ms dopo l'ultimo tasto; nessuna richiesta con importo vuoto).
- Con un suggerimento il campo mostra il chip tratteggiato «Suggerimento: {categoria}» e sotto il testo di aiuto.
- Se la persona salva con il suggerimento nel campo, la categoria si salva come **scelta della persona** (stato 1): la
  persona l'ha vista nel modulo che ha inviato (§16).
- Se la persona sceglie una categoria, il dialogo non chiede più suggerimenti.
- Senza suggerimento il campo mostra «Da categorizzare» e nessun testo di aiuto. Nessun errore se la richiesta fallisce.
- Cambio di tipo: se la categoria scelta non è del tipo nuovo, il campo torna vuoto.

**Avviso sul conto collegato a una banca** (G10). Subito sotto «Conto», quando il conto scelto riceve i movimenti da una banca:

> Questo conto riceve i movimenti dalla banca. Un movimento a mano può risultare doppio.

- Classi dell'avviso dentro una card (§1.4), dentro una regione `aria-live="polite"`: un lettore di schermo lo sente
  quando cambia il conto.
- L'avviso non blocca: il pulsante primario resta attivo e non serve una conferma in più.
- L'avviso compare anche in modifica.

**Pulsanti.** «Annulla» chiude senza salvare. Con campi cambiati vale il comportamento di `unsaved-changes.tsx`, se il
progetto lo usa già nei dialoghi; altrimenti nessuna conferma. Il primario è «Aggiungi movimento» o «Salva».

### 9.4 Doppio invio (criterio 5 di N3)

| Regola | Dettaglio |
|---|---|
| Chiave | Il dialogo crea una chiave di idempotenza (`crypto.randomUUID()`) quando si apre per creare. La manda a ogni invio |
| Durante l'invio | Primario `disabled`, testo «Salvataggio…», `aria-busy` sul form. Invio e doppio clic non mandano una seconda richiesta |
| Errore di rete, poi «Riprova» | Stessa chiave: il server risponde con la riga già creata. Per la persona è un salvataggio riuscito |
| Dopo la riuscita | Il dialogo si chiude. La chiave si butta. Una nuova apertura crea una chiave nuova |
| Chiusura senza salvare | La chiave si butta |
| Modifica ed eliminazione | Nessuna chiave: ripetere la stessa modifica dà lo stesso risultato |

### 9.5 Esiti

| Azione | Esito |
|---|---|
| Creato, dentro l'intervallo e i filtri di `Expenses` | Toast «Movimento aggiunto». La riga compare al suo posto per data. Il focus torna su «Aggiungi movimento» |
| Creato, fuori dall'intervallo o dai filtri | Toast «Movimento aggiunto il {date}, fuori da quello che vedi ora» con l'azione «Mostra» (porta al mese del movimento, senza filtri) |
| Modificato | Toast «Movimento salvato». Poi vale §5 se la categoria è cambiata |
| Errore di salvataggio | `role="alert"` in alto nel form: «Non è stato possibile salvare. Riprova.» I campi restano come sono |
| Importo vuoto, zero o non valido | Sotto il campo: «Scrivi un importo maggiore di zero.» Focus sul campo |
| Data futura o non valida | Sotto il campo: «Scegli una data fino a oggi.» |
| Conto non più disponibile | In alto: «Questo conto non esiste più. Scegline un altro.» |
| Nessun conto permesso | Al posto del form: «Serve un conto. Crea un conto per scrivere movimenti a mano.» + `ButtonLink` «Crea un conto» (`/accounts/new`) |

### 9.6 Eliminazione

- Solo dal menu della riga: «Elimina» (`danger`). Un movimento a mano si elimina subito; non deve prima essere nascosto.
- `Modal` di conferma: titolo «Eliminare questo movimento?», testo «Lo hai scritto a mano il {date}. Viene rimosso
  definitivamente.», pulsanti «Annulla» e «Elimina» (`danger`).
- Toast «1 movimento eliminato» (testo esistente). Il focus va alla riga successiva.
- La barra di selezione non cambia: «Nascondi» e «Ripristina» valgono per ogni riga. Nessuna eliminazione di gruppo.
- «Nascondi» resta disponibile anche per un movimento a mano.

### 9.7 Cosa non cambia

- La sync non tocca un movimento a mano: l'interfaccia non mostra mai «Sparito dal provider» su queste righe.
- Un movimento a mano non cambia il saldo del conto (domanda 3).
- Il pannello «Modifica dettagli» dei movimenti sincronizzati resta com'è.

## 10. Expenses e Budgets

### 10.1 Expenses

| Punto | Oggi | Con N3 |
|---|---|---|
| Azione in alto | — | «Aggiungi movimento» (§9.1) |
| Riga di avviso | — | Sotto `FilterBar`, se l'intervallo ha movimenti «Da categorizzare»: nota `bg-hover` «{count} movimenti da categorizzare in questo intervallo ({amount}). {suggested} hanno un suggerimento.» + `ButtonLink` `sm` «Rivedi» (porta a `/expenses/review` con lo stesso periodo e gli stessi conti). La seconda frase manca con 0 suggerimenti |
| Cella «Categoria» | Chip | `CategoryCell` nei 5 stati (§1.2) |
| Filtro «Categorie», ultima voce | «Senza categoria» | «Da categorizzare». Conta gli stati 4 e 5 |
| Card «Per categoria» e grafico «Spese nel tempo» | Fetta «Senza categoria» (`var(--faint)`) | Fetta «Da categorizzare», stesso colore. Comprende gli stati 4 e 5 |
| Totali di una categoria | — | Comprendono le automatiche (stato 3); non comprendono i suggerimenti (stato 4) |
| Ordinamento per «Categoria» | Per nome | Un suggerimento si ordina come «Da categorizzare», non con il nome suggerito |
| Badge della riga | — | «A mano» (§9.2) |
| Tasto `E` | Apre il selettore | Stati 1, 2, 3, 5: apre il selettore. Stato 4: apre il popover del suggerimento |
| Stato «niente di sincronizzato» | «Collega Budget Makers Wallet…» | Titolo «Ancora nessun movimento», testo «Collega una sorgente oppure scrivi il primo movimento a mano.», azioni «Aggiungi movimento» (`primary`) e «Apri le integrazioni» |

Il numero dei movimenti e i totali di entrate, spese e netto non cambiano: N3 cambia solo la categoria in cui un
movimento conta (criterio 6 di N3).

### 10.2 Budgets

| Punto | Con N3 |
|---|---|
| «Speso» di un budget di categoria | Comprende le automatiche (stato 3), senza segno e senza nota: contano come le altre (K2) |
| Suggerimenti (stato 4) e stato 5 | Non entrano in nessun budget di categoria. Entrano in un budget «Tutte le categorie» (per conto) e in «Fuori budget questo mese», come oggi i movimenti senza categoria |
| Riga di avviso | Nella card «Totale del mese», sotto «Fuori budget questo mese»: «{count} movimenti di {month} sono da categorizzare ({amount}): non sono in nessun budget di categoria.» + `LinkButton` «Rivedi» (porta a `/expenses/review` con il mese). Solo se `count > 0` |
| Pagina senza budget | La riga non compare |
| Card dei budget in Overview | Nessun cambio |
| Avvisi per email dei budget | Nessun cambio di testo. Un'automatica può far scattare una soglia: è l'effetto voluto di K2 |
| Dettaglio di un budget | Nessun cambio: non elenca movimenti |

### 10.3 Altri punti dell'app

- `Settings › Categories`: sezione «Categorie doppie» (§6) e pulsante dei gruppi predefiniti (§7). Il conteggio «{count}
  movimenti» di una categoria comprende le automatiche e non i suggerimenti.
- Selettori di categoria di Budgets, Subscriptions e Interests: nessun cambio.
- Overview, Accounts, Pockets: nessun cambio.

## 11. Stati: tabella unica

| Vista | Stato | Cosa si vede |
|---|---|---|
| «Da rivedere» | Caricamento | `loading.tsx`: titolo, riga dei controlli, 3 `Skeleton` alti come una card di gruppo, 1 nella colonna laterale |
| «Da rivedere» | Vuoto, niente da rivedere in assoluto | `EmptyState`, icona `Check`: «Tutto a posto» · «Nessun movimento da categorizzare.» · `ButtonLink` «Torna a Spese» |
| «Da rivedere» | Vuoto per periodo o conti | `EmptyState`: «Niente da rivedere in questo periodo» · «Prova con un altro periodo o con tutti i conti.» · «Azzera i filtri» |
| «Da rivedere» | Solo conti Wallet | `EmptyState`: «Le categorie arrivano da Wallet» · «Qui compaiono i movimenti delle banche collegate e quelli scritti a mano.» · «Torna a Spese» |
| «Da rivedere» | Nessun suggerimento | Nota di §4.5 |
| «Da rivedere» | Categorie in preparazione | Card di §8.4 |
| «Da rivedere» | Errore di lettura | `ErrorState` (`error.tsx` dell'app) con «Riprova» |
| Gruppo | Salvataggio | Pulsanti `disabled`, «Salvataggio…», `aria-busy` |
| Gruppo | Errore | `role="alert"` nella card (§4.3) |
| Gruppo | Riuscito | Riga di esito con «Annulla» |
| Gruppo | Un movimento è cambiato altrove nel frattempo | L'azione vale per i movimenti ancora da rivedere. Riga di esito con il numero vero |
| Segno / suggerimento | Conferma in corso | Pulsanti del popover `disabled` |
| Segno / suggerimento | Errore | Toast di errore «Non è stato possibile salvare. Riprova.» Il popover resta aperto |
| Segno / suggerimento | Il movimento non esiste più | Toast di errore «Questo movimento non esiste più.» (testo esistente) |
| «Applico a N simili?» | Salvataggio, errore | §5.2 |
| Proposta di unione | Nessuna proposta | La sezione non si disegna |
| Proposta di unione | Una categoria della coppia è stata archiviata o eliminata | La proposta sparisce da sola |
| Proposta di unione | Errore | `role="alert"` nel dialogo (§6.3) |
| Gruppi predefiniti | Errore | `role="alert"` (§7.3) |
| Movimento manuale | Salvataggio, errori, nessun conto | §9.4, §9.5 |
| Movimento manuale | Nessuna categoria | Il campo «Categoria» mostra «Da categorizzare» e sotto il link «Crea le categorie in Impostazioni» |
| Expenses | Nessun movimento | §10.1, ultima riga |
| Expenses, Budgets | Nessun movimento «Da categorizzare» | La riga di avviso non compare |

## 12. Layout

Soglie del progetto: lista al posto della tabella sotto 768 px (`md`); due colonne da `@4xl` (larghezza della colonna
del contenuto, non della finestra).

### 12.1 1440 px

- **«Da rivedere»:** griglia di `Expenses` (`@4xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]`). A sinistra le sezioni;
  a destra «Riepilogo» e il rimando alle proposte di unione. La colonna laterale resta in vista durante lo scorrimento
  (`sticky top-16`).
- **Gruppo:** titolo a sinistra, conteggio e somma a destra, sulla stessa riga. Azioni allineate a destra, primario per ultimo.
- **Movimenti singoli:** tabella a larghezza fissa, come `Expenses`: selezione 40 px, data 104 px, beneficiario il resto,
  conto 15%, categoria 28%, importo 120 px. La categoria è più larga che in `Expenses` perché «Suggerimento: …» è lungo.
- **`Expenses`:** colonna «Categoria» da 20% a 22%; il segno occupa 24 px + 4 px di spazio.
- **Revisione guidata, passo «Gruppi»:** card di 560 px a sinistra, come la procedura di N1.
- **Dialoghi:** `Modal` centrato, larghezze di §5, §6, §9.

### 12.2 400 px

- **«Da rivedere»:** una colonna. Ordine: titolo e riepilogo, periodo (lo stepper e i preset vanno a capo come in
  `Expenses`), conti, card «Riepilogo» compatta (i tre conteggi su una riga, `text-sm`), sezioni.
- **Gruppo:** tutto in colonna. Conteggio e somma sotto il titolo. Esempi su due righe: «data · conto» e sotto l'importo
  a destra. Pulsanti a tutta larghezza, `flex-col-reverse`: il primario sopra.
- **Movimenti singoli:** lista. Riga: beneficiario e importo; sotto data e conto; sotto il chip della categoria (a
  tutta larghezza, il testo va a capo e non si tronca) e il menu.
- **`Expenses`:** il segno mostra «✦ Automatica» accanto al chip, nella riga del chip. La riga di avviso va su più righe;
  «Rivedi» a tutta larghezza sotto il testo.
- **Dialoghi:** `Modal` a tutta larghezza con 16 px di margine. Nel dialogo del movimento «Importo» e «Data» stanno in
  colonna. Pulsanti del piede in colonna, primario sopra.
- **Popover del motivo:** larghezza `min(280px, 100vw − 32px)`; resta dentro lo schermo.
- Nessuno scorrimento orizzontale: nomi lunghi di beneficiari e categorie vanno a capo (`break-words`) nelle card e si
  troncano con `title` solo nelle tabelle.
- La barra dei tab in basso copre 64 px: l'ultima card ha lo spazio che `Page` dà già (`max-md:pb-24`).

### 12.3 Temi

Solo token. Controlli da fare nei due temi: bordo tratteggiato del suggerimento (`border-border2` su `card` e su `sel`),
icona del segno (`text-accent` su `card`, su `hover` e su `sel`), nota `bg-hover`, avviso `bg-warn-bg text-warn`, riga
di esito (`text-pos`).

## 13. Tastiera e accessibilità (WCAG 2.2 AA)

| Tema | Regola |
|---|---|
| Ordine di tabulazione | Segue l'ordine visivo. Nella cella: chip, poi segno. Nel gruppo: «Mostra tutti», righe (se aperte), azioni |
| Focus visibile | `focus-ring` su ogni controllo. La card di un gruppo con il focus usa lo stesso contorno delle righe di `Expenses` |
| Scorciatoie in «Da rivedere» | `J` / `K`: gruppo o riga successiva / precedente (come `Expenses`). Con il focus su un gruppo: Invio = azione primaria, `E` = scegli categoria, Spazio = apre o chiude l'elenco. Nessuna scorciatoia nuova a livello di pagina |
| Scorciatoie in `Expenses` | `E`, Spazio, `J` / `K` come oggi. `E` su un suggerimento apre il popover con il focus su «Conferma» |
| Popover | Focus dentro all'apertura; Tab resta dentro; Esc chiude; il focus torna al controllo che lo ha aperto |
| Dialoghi | Comportamento di `Modal`: focus chiuso dentro, Esc chiude, Invio invia il form. Alla chiusura il focus torna al controllo o alla riga di partenza |
| Focus dopo un'azione | Gruppo fatto: primo pulsante del gruppo successivo. Movimento eliminato: riga successiva. Movimento creato: pulsante «Aggiungi movimento» |
| Annunci | Errori `role="alert"`. Esiti, attese, avanzamento e avviso del conto `role="status"` o `aria-live="polite"`. Toast esistenti |
| Nomi accessibili | Segno: «Categoria automatica: mostra il motivo». Chip del suggerimento: «Suggerimento: {categoria}. Non confermato». `Checkbox` di una riga: il beneficiario, come oggi. Pulsante del gruppo: «Conferma «{categoria}» per {count} movimenti di {text}» |
| Struttura | «Da rivedere»: `h1` pagina, `h2` sezione, `h3` gruppo. Gruppo `<article>`. Esempi e righe `<ul>` |
| Stato non solo con il colore | Automatica = icona con nome (e parola su telefono). Suggerimento = parola «Suggerimento:» + bordo tratteggiato. «A mano» = badge con testo |
| Bersagli | Segno 24 × 24 px; chip 24 px; pulsanti `xs` 24 px, `sm` 28 px, `md` 32 px; righe della lista ≥ 44 px. A 400 px i pulsanti dei gruppi e dei dialoghi sono a tutta larghezza |
| Contrasto | `text-muted` su `card`, `text-accent` su `card` e su `soft`, `text-warn` su `warn-bg`, `text-pos` su `card`: ≥ 4,5:1 nei due temi. Bordo tratteggiato `border2` su `card`: ≥ 3:1 (da verificare nei due temi; se non passa, usare `text-muted` come colore del bordo) |
| Zoom e riflusso | Nessuno scorrimento orizzontale a 400 px e con testo al 200% |
| Movimento | Nessuna animazione nuova. L'attesa usa `ProgressBar` `dashed`, che è ferma. La rilettura ogni 5 secondi non sposta il focus |
| Tempo | Toast con un'azione: 8 secondi, fermati da puntatore e focus (comportamento esistente). «Annulla» di un gruppo è nella riga di esito, senza limite di tempo |
| Campi | `Field` con `label` visibile. «(facoltativo)» nell'etichetta. Errore legato al campo con `aria-describedby` e `invalid` |
| Lingua | Testi dei movimenti e nomi delle categorie non si traducono |

Problema aperto, già nel codice: le scorciatoie `E`, `J`, `K` di `Expenses` sono a un solo carattere e valgono su tutta
la pagina, senza un modo per spegnerle (WCAG 2.1.4). N3 non aggiunge scorciatoie di questo tipo; la correzione è una
voce a parte.

Test da aggiungere (G6): `a11y.spec.ts` e `keyboard.spec.ts` su `/expenses/review` (con gruppi, vuota, senza
suggerimenti), sul popover del motivo, sui dialoghi di §5, §6, §9, a 400 e 1440 px, nei due temi.

## 14. Testi e chiavi di traduzione

File `messages/it.json` e `messages/en.json`. «Annulla», «Salva», «Riprova», «Chiudi» usano `common.cancel`,
`common.save`, `common.retry`, `common.close`. Inglese britannico, come il resto del file («Uncategorised»).

### 14.1 Chiavi esistenti che cambiano valore

| Chiave | Italiano | English |
|---|---|---|
| `expenses.row.uncategorised` | Da categorizzare | To categorise |
| `expenses.filters.categories.none` | Da categorizzare | To categorise |
| `expenses.unsynced.title` | Ancora nessun movimento | No transactions yet |
| `expenses.unsynced.description` | Collega una sorgente oppure scrivi il primo movimento a mano. | Connect a source or add your first transaction by hand. |

### 14.2 `expenses.auto` (segno e suggerimento)

| Chiave | Italiano | English |
|---|---|---|
| `mark` | Automatica | Automatic |
| `markLabel` | Categoria automatica: mostra il motivo | Automatic category: show the reason |
| `title` | Categoria automatica | Automatic category |
| `confirm` | Conferma | Confirm |
| `change` | Cambia categoria | Change category |
| `confirmed` | Categoria confermata | Category confirmed |
| `suggestion.chip` | Suggerimento: {category} | Suggestion: {category} |
| `suggestion.chipLabel` | Suggerimento: {category}. Non confermato | Suggestion: {category}. Not confirmed |
| `suggestion.title` | Suggerimento | Suggestion |
| `suggestion.notCounted` | Non conta in questa categoria finché non confermi. | It does not count in this category until you confirm. |
| `suggestion.other` | Scegli un'altra | Choose another |
| `reason.memory` | Le ultime 3 volte hai scelto questa categoria per «{text}». | The last 3 times you chose this category for “{text}”. |
| `reason.similar` | Somiglia ad altri movimenti che hai messo in questa categoria. | It is similar to other transactions you put in this category. |
| `reason.merchant_type` | La banca indica un tipo di esercizio che corrisponde a questa categoria. | The bank gives a merchant type that matches this category. |
| `reason.brand` | «{brand}» è un marchio noto di questa categoria. | “{brand}” is a known brand in this category. |
| `reason.salary` | La banca indica questo movimento come stipendio. | The bank marks this transaction as a salary. |
| `reason.fee` | La banca indica questo movimento come commissione. | The bank marks this transaction as a fee. |
| `reason.other` | Ledgerly ha scelto questa categoria dai dati del movimento. | Ledgerly chose this category from the transaction data. |
| `selection.confirm` | Conferma i suggerimenti ({count}) | Confirm suggestions ({count}) |

### 14.3 `expenses.review`

| Chiave | Italiano | English |
|---|---|---|
| `title` | Da rivedere | To review |
| `summary` | {count, plural, one {# movimento} other {# movimenti}} · {groups, plural, one {# gruppo} other {# gruppi}} · {total} | {count, plural, one {# transaction} other {# transactions}} · {groups, plural, one {# group} other {# groups}} · {total} |
| `sections.suggested` | Con un suggerimento | With a suggestion |
| `sections.unsuggested` | Senza suggerimento | Without a suggestion |
| `sections.singles` | Movimenti singoli | Single transactions |
| `sections.count` | {groups, plural, one {# gruppo} other {# gruppi}} · {count, plural, one {# movimento} other {# movimenti}} | {groups, plural, one {# group} other {# groups}} · {count, plural, one {# transaction} other {# transactions}} |
| `sections.more` | Mostra altri {count} | Show {count} more |
| `aside.title` | Riepilogo | Summary |
| `aside.merge` | {count, plural, one {# proposta di unione delle categorie} other {# proposte di unione delle categorie}} | {count, plural, one {# category merge proposal} other {# category merge proposals}} |
| `aside.mergeLink` | Vedi | View |
| `group.summary` | {count, plural, one {# movimento} other {# movimenti}} · {total} | {count, plural, one {# transaction} other {# transactions}} · {total} |
| `group.showAll` | Mostra tutti i {count} | Show all {count} |
| `group.hide` | Mostra meno | Show fewer |
| `group.confirm` | Conferma per {count} | Confirm for {count} |
| `group.confirmLabel` | Conferma «{category}» per {count, plural, one {# movimento} other {# movimenti}} di {text} | Confirm “{category}” for {count, plural, one {# transaction} other {# transactions}} of {text} |
| `group.change` | Cambia categoria | Change category |
| `group.choose` | Scegli categoria | Choose category |
| `group.saving` | Salvataggio… | Saving… |
| `group.done` | {text} · {count, plural, one {# movimento} other {# movimenti}} in «{category}» | {text} · {count, plural, one {# transaction} other {# transactions}} in “{category}” |
| `group.undo` | Annulla | Undo |
| `group.failed` | Non è stato possibile salvare. Riprova. | Couldn't save. Try again. |
| `noSuggestions` | Ledgerly non ha ancora suggerimenti per questi movimenti. Impara dalle categorie che scegli: più ne scegli, più suggerimenti arrivano. | Ledgerly has no suggestions for these transactions yet. It learns from the categories you choose: the more you choose, the more suggestions you get. |
| `empty.done.title` | Tutto a posto | All done |
| `empty.done.description` | Nessun movimento da categorizzare. | No transactions to categorise. |
| `empty.done.action` | Torna a Spese | Back to Expenses |
| `empty.filtered.title` | Niente da rivedere in questo periodo | Nothing to review in this period |
| `empty.filtered.description` | Prova con un altro periodo o con tutti i conti. | Try another period or all accounts. |
| `empty.filtered.action` | Azzera i filtri | Clear filters |
| `empty.wallet.title` | Le categorie arrivano da Wallet | Categories come from Wallet |
| `empty.wallet.description` | Qui compaiono i movimenti delle banche collegate e quelli scritti a mano. | Transactions from connected banks and those you add by hand appear here. |
| `notice.expenses` | {count, plural, one {# movimento da categorizzare} other {# movimenti da categorizzare}} in questo intervallo ({amount}). | {count, plural, one {# transaction to categorise} other {# transactions to categorise}} in this range ({amount}). |
| `notice.suggested` | {count, plural, one {# ha un suggerimento.} other {# hanno un suggerimento.}} | {count, plural, one {# has a suggestion.} other {# have a suggestion.}} |
| `notice.action` | Rivedi | Review |
| `palette` | Da rivedere | To review |

### 14.4 `expenses.review.guide`

| Chiave | Italiano | English |
|---|---|---|
| `steps.groups` | Gruppi | Groups |
| `steps.categories` | Categorie | Categories |
| `steps.done` | Fatto | Done |
| `intro.title` | Prima lettura di {bank} | First reading of {bank} |
| `intro.body` | Ledgerly ha raggruppato i movimenti con lo stesso testo. Conferma o scegli una categoria per gruppo: vale per tutti i movimenti del gruppo. Puoi finire dopo: li ritrovi in Spese › Da rivedere. | Ledgerly grouped the transactions with the same text. Confirm or choose a category for each group: it applies to all the transactions in the group. You can finish later: you find them in Expenses › To review. |
| `later` | Finisci dopo | Finish later |
| `progress.label` | Gruppi fatti | Groups done |
| `progress.text` | Fatti {done} gruppi di {total} | {done} of {total} groups done |
| `progress.detail` | {done, plural, one {# movimento con una categoria} other {# movimenti con una categoria}} · {left} da fare | {done, plural, one {# transaction with a category} other {# transactions with a category}} · {left} to do |
| `preparing.title` | Ledgerly sta cercando una categoria per {count, plural, one {# movimento} other {# movimenti}}… | Ledgerly is looking for a category for {count, plural, one {# transaction} other {# transactions}}… |
| `preparing.hint` | Può servire qualche secondo. | This can take a few seconds. |
| `preparing.slow` | Serve più tempo del previsto. Puoi continuare dopo: i movimenti ti aspettano in Spese › Da rivedere. | This takes longer than expected. You can continue later: the transactions wait for you in Expenses › To review. |
| `done.title` | Revisione finita | Review finished |
| `done.categorised` | {count, plural, one {# movimento di {bank} ha una categoria.} other {# movimenti di {bank} hanno una categoria.}} | {count, plural, one {# transaction from {bank} has a category.} other {# transactions from {bank} have a category.}} |
| `done.left` | {count, plural, one {# è ancora da categorizzare: lo trovi} other {# sono ancora da categorizzare: li trovi}} in Spese › Da rivedere. | {count, plural, one {# is still to categorise: you find it} other {# are still to categorise: you find them}} in Expenses › To review. |
| `done.expenses` | Vai a Spese | Go to Expenses |
| `done.accounts` | Vai ai conti | Go to accounts |

Blocco nell'esito di «Collega una banca» (gruppo `banks.connect.done` di N1):

| Chiave | Italiano | English |
|---|---|---|
| `categories.title` | Categorie | Categories |
| `categories.summary` | {done, plural, one {# movimento ha} other {# movimenti hanno}} già una categoria. {suggested} hanno un suggerimento e {open} sono da categorizzare. | {done, plural, one {# transaction already has} other {# transactions already have}} a category. {suggested} have a suggestion and {open} are to categorise. |
| `categories.all` | Tutti i {count} movimenti hanno già una categoria. | All {count} transactions already have a category. |
| `categories.noGroups` | Per dare una categoria ai {count} movimenti scegli prima i tuoi gruppi. | To give a category to the {count} transactions, choose your groups first. |
| `categories.action` | Rivedi le categorie | Review categories |

### 14.5 `expenses.similar`

| Chiave | Italiano | English |
|---|---|---|
| `title` | Applicare a {count, plural, one {# movimento simile} other {# movimenti simili}}? | Apply to {count, plural, one {# similar transaction} other {# similar transactions}}? |
| `chosen` | Hai messo «{text}» in {category}. | You put “{text}” in {category}. |
| `body` | {count, plural, one {Un altro movimento ha lo stesso testo e non ha} other {Altri # movimenti hanno lo stesso testo e non hanno}} una categoria scelta da te. | {count, plural, one {One other transaction has the same text and has} other {# other transactions have the same text and have}} no category chosen by you. |
| `showAll` | Mostra tutti i {count} | Show all {count} |
| `apply` | Applica a {count} | Apply to {count} |
| `skip` | No, solo questo | No, only this one |
| `applied` | {count, plural, one {# movimento aggiornato} other {# movimenti aggiornati}} | {count, plural, one {# transaction updated} other {# transactions updated}} |
| `undo` | Annulla | Undo |
| `failed` | Non è stato possibile applicare la categoria. Il primo movimento è salvato. Riprova. | Couldn't apply the category. The first transaction is saved. Try again. |

### 14.6 `expenses.manual`

| Chiave | Italiano | English |
|---|---|---|
| `add` | Aggiungi movimento | Add transaction |
| `addShort` | Aggiungi | Add |
| `editTitle` | Modifica movimento | Edit transaction |
| `badge` | A mano | Manual |
| `type` | Tipo | Type |
| `types.expense` | Uscita | Money out |
| `types.income` | Entrata | Money in |
| `amount` | Importo | Amount |
| `amountHint` | Senza segno: lo decide il tipo. | No sign: the type decides it. |
| `date` | Data | Date |
| `account` | Conto | Account |
| `accounts.manual` | Conti tenuti a mano | Accounts kept by hand |
| `accounts.bank` | Conti collegati a una banca | Accounts connected to a bank |
| `payee` | Beneficiario (facoltativo) | Payee (optional) |
| `category` | Categoria | Category |
| `categoryHint` | Suggerimento di Ledgerly. Cambialo se non va bene. | Ledgerly's suggestion. Change it if it is not right. |
| `noCategories` | Crea le categorie in Impostazioni | Create categories in Settings |
| `note` | Nota (facoltativa) | Note (optional) |
| `bankWarning` | Questo conto riceve i movimenti dalla banca. Un movimento a mano può risultare doppio. | This account gets its transactions from the bank. A transaction added by hand can appear twice. |
| `saving` | Salvataggio… | Saving… |
| `toasts.added` | Movimento aggiunto | Transaction added |
| `toasts.addedElsewhere` | Movimento aggiunto il {date}, fuori da quello che vedi ora | Transaction added on {date}, outside what you see now |
| `toasts.show` | Mostra | Show |
| `toasts.saved` | Movimento salvato | Transaction saved |
| `delete.title` | Eliminare questo movimento? | Delete this transaction? |
| `delete.description` | Lo hai scritto a mano il {date}. Viene rimosso definitivamente. | You added it by hand on {date}. It is removed permanently. |
| `noAccount.title` | Serve un conto | You need an account |
| `noAccount.description` | Crea un conto per scrivere movimenti a mano. | Create an account to add transactions by hand. |
| `noAccount.action` | Crea un conto | Create an account |
| `errors.amount` | Scrivi un importo maggiore di zero. | Enter an amount greater than zero. |
| `errors.date` | Scegli una data fino a oggi. | Choose a date up to today. |
| `errors.account` | Questo conto non esiste più. Scegline un altro. | This account no longer exists. Choose another. |
| `errors.failed` | Non è stato possibile salvare. Riprova. | Couldn't save. Try again. |
| `row.edit` | Modifica movimento | Edit transaction |
| `palette` | Aggiungi movimento | Add transaction |

### 14.7 `settings.categories.merge` e `settings.categories.defaults`

| Chiave | Italiano | English |
|---|---|---|
| `merge.title` | Categorie doppie | Duplicate categories |
| `merge.description` | Ledgerly propone di unire le categorie che sembrano uguali. Decidi tu. | Ledgerly proposes to merge categories that look the same. You decide. |
| `merge.pair` | {name} · {count, plural, =0 {non usata} one {# movimento} other {# movimenti}} | {name} · {count, plural, =0 {not used} one {# transaction} other {# transactions}} |
| `merge.and` | e | and |
| `merge.same` | Sembrano la stessa categoria. | They look like the same category. |
| `merge.open` | Unisci… | Merge… |
| `merge.dismiss` | Non sono uguali | They are different |
| `merge.dismissed` | Proposta ignorata | Proposal dismissed |
| `merge.dialog.title` | Unisci le categorie | Merge categories |
| `merge.dialog.keep` | Quale nome resta? | Which name stays? |
| `merge.dialog.moves` | {count, plural, =0 {Nessun movimento da spostare.} one {Il movimento di «{from}» passa a «{to}».} other {I # movimenti di «{from}» passano a «{to}».}} | {count, plural, =0 {No transactions to move.} one {The transaction in “{from}” moves to “{to}”.} other {The # transactions in “{from}” move to “{to}”.}} |
| `merge.dialog.archived` | «{from}» viene archiviata. | “{from}” is archived. |
| `merge.dialog.budgets` | I limiti dei budget delle due categorie si sommano. | The budget limits of the two categories are added together. |
| `merge.dialog.children` | Le sottocategorie di «{from}» passano a «{to}». | The sub-categories of “{from}” move to “{to}”. |
| `merge.dialog.wallet` | I movimenti dei conti Wallet restano in «{from}»: lì decide Wallet. | The transactions of Wallet accounts stay in “{from}”: Wallet decides there. |
| `merge.dialog.walletKept` | «{from}» resta per i movimenti di Wallet e non viene più suggerita. | “{from}” stays for Wallet transactions and is no longer suggested. |
| `merge.dialog.confirm` | Unisci | Merge |
| `merge.done` | Categorie unite: {count, plural, one {# movimento spostato} other {# movimenti spostati}} | Categories merged: {count, plural, one {# transaction moved} other {# transactions moved}} |
| `merge.failed` | Non è stato possibile unire le categorie. Riprova. | Couldn't merge the categories. Try again. |
| `defaults.open` | Usa i gruppi predefiniti | Use the default groups |
| `defaults.title` | Scegli i gruppi delle tue spese | Choose the groups for your spending |
| `defaults.description` | Ledgerly usa questi gruppi per dare una categoria ai movimenti. Puoi cambiarli quando vuoi in Impostazioni › Categorie. | Ledgerly uses these groups to give a category to transactions. You can change them at any time in Settings › Categories. |
| `defaults.create` | {count, plural, one {Crea # gruppo} other {Crea # gruppi}} | {count, plural, one {Create # group} other {Create # groups}} |
| `defaults.later` | Non ora | Not now |
| `defaults.created` | {count, plural, one {# gruppo creato} other {# gruppi creati}} | {count, plural, one {# group created} other {# groups created}} |
| `defaults.failed` | Non è stato possibile creare i gruppi. Riprova. | Couldn't create the groups. Try again. |
| `defaults.groups.<id>.name`, `.examples` | Tabella di §7.2 | Tabella di §7.2 |

### 14.8 `budgets`

| Chiave | Italiano | English |
|---|---|---|
| `total.toCategorise` | {count, plural, one {# movimento di {month} è da categorizzare} other {# movimenti di {month} sono da categorizzare}} ({amount}): non {count, plural, one {è} other {sono}} in nessun budget di categoria. | {count, plural, one {# transaction in {month} is to categorise} other {# transactions in {month} are to categorise}} ({amount}): {count, plural, one {it is} other {they are}} not in any category budget. |
| `total.review` | Rivedi | Review |

## 15. Verifica dei criteri di accettazione

| Criterio dell'issue | Dove è coperto |
|---|---|
| 1 · Ogni voce di interfaccia del «Contenuto» di N3 ha la sua sezione, con stati e testi | §0 (mappa), §2-§10, §11, §14 |
| 2 · La specifica rispetta i criteri 1, 2 e 5 di N3 | Tabella sotto |
| 3 · Il documento è su `main` | Commit `docs` |

| Criterio di N3 (`03-releases.md`) | Dove è coperto |
|---|---|
| 1 · Sui conti Wallet le categorie restano quelle di Wallet | §1.3; §5.1 (N non conta Wallet); §6.3 (unione); §9.3 (conti del movimento manuale); domande 1, 2, 6 |
| 2 · Un'automatica conta in Budgets ed Expenses; un suggerimento non confermato conta come «Da categorizzare» | §1.2; §3.1; §10.1; §10.2 |
| 5 · Un doppio invio dello stesso movimento manuale crea una sola riga | §9.4 |
| 6 · Fotografia dei numeri invariata (per la parte dell'interfaccia) | §10.1, ultima frase; domanda 3 |

Altri vincoli del piano rispettati: nessuna parola tecnica nella vista normale (§1.1, P2); il modello e la confidenza non
arrivano mai al browser (§18, punto 2); «solo su movimenti automatici o senza categoria» (§5.1).

## 16. Decisioni di design prese senza conferma

Scelte di interazione, non di prodotto. Si cambiano senza toccare il piano.

| # | Decisione | Motivo |
|---|---|---|
| 1 | «Da categorizzare» sostituisce «Senza categoria» in tutta l'app | Una parola per un significato; è la parola del piano |
| 2 | La parola è «Suggerimento», non «Proposta». «Proposta» è solo la proposta di unione | Sono due cose diverse |
| 3 | Il segno è un'icona con nome accanto al chip; su telefono ha anche la parola | In tabella la colonna è stretta; il motivo è a un clic |
| 4 | «Conferma» di un'automatica è facoltativa, nel popover del motivo | K2: conta subito. La conferma dà a Ledgerly un esempio in più |
| 5 | «Da rivedere» è una pagina propria (`/expenses/review`), non un filtro di `Expenses` | I gruppi hanno bisogno di un disegno diverso dalla tabella |
| 6 | Tre sezioni: con un suggerimento, senza, movimenti singoli | Prima il lavoro più rapido |
| 7 | Nessuna azione «conferma tutti i gruppi» | Un suggerimento è sotto il livello di sicurezza di un'automatica: la conferma di massa abbasserebbe la qualità degli esempi |
| 8 | La revisione guidata è la stessa pagina con passi, introduzione e avanzamento | Una sola interazione da imparare e da scrivere |
| 9 | «Applico a N simili?» è un dialogo, dopo il salvataggio della prima scelta, solo per una correzione su un movimento | È una domanda del piano (K3); una risposta mancata non perde la prima scelta |
| 10 | Dopo l'azione di un gruppo: riga di esito con «Annulla», senza toast | Nessun limite di tempo; il focus resta nel flusso |
| 11 | Movimento manuale: un solo ingresso in `Expenses` + palette; nessuna scorciatoia a un carattere | Non peggiora il problema WCAG 2.1.4 già presente |
| 12 | Nel dialogo del movimento, un suggerimento lasciato nel campo si salva come scelta della persona | La persona lo vede nel modulo che invia |
| 13 | Nessuna data futura per un movimento a mano | Come i saldi scritti a mano (`accounts/rules.ts`) |
| 14 | Un movimento a mano si elimina dal menu della riga, con una conferma, senza passare da «Nascondi» | È un dato della persona, non della sorgente |
| 15 | Nessun «Giroconto» nel movimento a mano | Il piano scrive «uscita o entrata» |
| 16 | Gruppi predefiniti offerti anche nello stato vuoto di `Settings › Categories` | Serve a chi non collega una banca; il primo avvio guidato arriva solo in R5a |
| 17 | Nessuna voce di menu e nessun contatore nel menu per «Da rivedere» | Il menu cambia in R5a |

## 17. Domande per Mattia

Decisioni di prodotto che il piano non scrive. A è il default: la specifica lo applica. «ok default» basta.

| # | Domanda | Esempio | A (default) | B | Effetto |
|---|---|---|---|---|---|
| 1 | I movimenti dei conti Wallet senza categoria entrano in «Da rivedere»? | Un prelievo su un conto Wallet arriva senza categoria | No. «Da rivedere» mostra solo i conti dove Ledgerly dà le categorie (banche, movimenti a mano). Il prelievo resta visibile in Spese con il filtro «Da categorizzare» | Sì, senza suggerimenti. La categoria scelta lì è una modifica locale, come oggi da Spese | A: la vista è vuota finché non colleghi una banca; criterio 1 senza eccezioni. B: una coda unica; più lavoro a mano su dati che Wallet può riscrivere. Tocca §1.3, §4.1, §11 |
| 2 | Su quali conti si scrive un movimento a mano? | Paghi 12,50 € in contanti e hai «Contanti» (a mano), «BBVA» (banca), «Revolut» (Wallet) | Conti tenuti a mano e conti collegati a una banca (con l'avviso). Non i conti Wallet, non i conti di investimento | Anche i conti Wallet, con un avviso: «Wallet non riceve questo movimento» | A: un movimento Wallet si scrive su Wallet, come oggi. B: Ledgerly e Wallet mostrano spese diverse per lo stesso conto. Tocca §9.3 |
| 3 | Un movimento a mano cambia il saldo del conto? | «Contanti» ha saldo 80 €. Scrivi una spesa di 12,50 € | No. Il saldo resta 80 € finché non lo aggiorni. Il movimento conta solo in Spese e Budget | Sì, solo sui conti tenuti a mano: il saldo diventa 67,50 € dalla data del movimento | A: patrimonio e saldi invariati (criterio 6), ma «Contanti» si aggiorna a mano. B: il saldo segue le spese; cambia la regola dei saldi dei conti a mano e serve una decisione sui saldi già scritti. Tocca §9.7 |
| 4 | Il movimento a mano ha il campo «Beneficiario»? | Scrivi «Bar Centrale · 4,20 €» | Sì, facoltativo. La riga in Spese mostra «Bar Centrale» e Ledgerly lo usa per il suggerimento | No: solo i campi del piano (importo, tipo, conto, categoria, data, nota). La riga mostra «Senza beneficiario»; il suggerimento usa solo la nota | A: un campo in più; righe leggibili e suggerimenti migliori. B: dialogo più corto; tutte le spese a mano hanno lo stesso titolo. Tocca §9.3 |
| 5 | Quali sono i gruppi predefiniti? | Un familiare nuovo collega la sua banca e non ha categorie | I 12 gruppi di §7.2 (11 di spesa, 1 di entrata), senza sottocategorie | Un elenco tuo: dimmi i nomi | A: si parte subito. B: l'elenco segue le tue abitudini; le tabelle del dominio (tipo di esercizio → gruppo) seguono l'elenco scelto. Tocca §7.2 |
| 6 | Unione di due categorie quando una ha movimenti dei conti Wallet | «Tobacco» e «Alcohol, tobacco» arrivano tutte e due da Wallet | L'unione sposta solo i movimenti dove decide Ledgerly e gli esempi. I movimenti Wallet restano in «Tobacco», che resta visibile per loro e non viene più suggerita | L'unione sposta anche i movimenti Wallet, come modifica locale («Modificato qui»). Wallet tiene le sue due categorie | A: criterio 1 rispettato; finché usi Wallet vedi ancora i due nomi. B: un solo nome in Ledgerly; Ledgerly e Wallet non sono più uguali. Tocca §6.3 |
| 7 | Unione di due categorie che hanno tutte e due un budget | «Tobacco» ha 30 € al mese, «Alcohol, tobacco» ha 100 € | I limiti si sommano: 130 € | Resta solo il limite della categoria che tieni: 100 € | A: «Totale del mese» non cambia. B: il limite totale scende di 30 € senza un'azione tua. Tocca §6.3 |
| 8 | «Annulla» dopo un'azione di gruppo | Confermi 24 movimenti di «ESSELUNGA» nella categoria sbagliata | Sì: «Annulla» nella riga di esito (gruppi) e nel toast per 8 secondi («Applica a N», selezione). Riporta i movimenti allo stato di prima | No: correggi con una nuova scelta di categoria sul gruppo | A: un errore si ripara con un clic; serve una funzione in più nel server. B: meno codice; i movimenti corretti a mano diventano «scelti da te» e non tornano automatici. Tocca §4.3, §4.4, §5.2 |
| 9 | Le categorie automatiche compaiono in «Da rivedere»? | Ledgerly mette da sola 40 movimenti in «Spesa alimentare» | No. Le vedi in Spese con il segno; la conferma è facoltativa | Sì: una quarta sezione «Automatiche degli ultimi 30 giorni», con «Conferma» per gruppo | A: «Da rivedere» è solo lavoro da fare e si svuota. B: controlli le scelte di Ledgerly in un posto, ma la vista non è mai vuota. Tocca §4.2 |

## 18. Passaggi per lo sviluppo

Non sono decisioni di prodotto: sono dati e regole che l'interfaccia richiede e che il piano non elenca.

1. **Motivo.** Il piano salva origine, confidenza e versione del modello. L'interfaccia ha bisogno anche del **codice del
   motivo** (§2.2) e dei suoi parametri (`text`, `brand`). Va salvato sul movimento o ricavato dal livello della cascata.
2. **Niente numeri del modello nel browser.** Le pagine ricevono solo: stato (§1.2), categoria, codice del motivo e
   parametri. Mai confidenza, soglia o versione del modello: né in prop, né in risposta di un'azione.
3. **Suggerimento.** Il piano non elenca dove si salva la categoria suggerita (stato 4). Serve un dato «categoria
   suggerita + motivo» distinto dalla categoria che conta. Va aggiunto a `06-data.md` e alle migrazioni di N3.
4. **Gruppi di «Da rivedere».** Chiave del gruppo: testo normalizzato (la chiave della memoria) + categoria suggerita.
   La lettura dà per gruppo: testo mostrato, conteggio, somma, 3 esempi, suggerimento e motivo. L'elenco completo si
   legge quando il gruppo si apre.
5. **Conteggi.** Una sola lettura dà i conteggi «Da categorizzare» e «con un suggerimento» per un intervallo e un
   insieme di conti. La usano `Expenses`, `Budgets`, «Da rivedere» e l'esito di «Collega una banca». Gate G9: va contata
   tra le query di `Expenses` e `Budgets`.
6. **Azioni di gruppo: tutto o niente.** Conferma e scelta su un gruppo, «Applica a N», unione: una transazione.
   La risposta dà il numero vero di righe toccate.
7. **N di «simili».** Dopo la scelta su un movimento l'azione risponde con N e con i primi 3 esempi, così il dialogo
   si apre senza una seconda lettura.
8. **«Annulla»** (domanda 8, opzione A). Il server riporta categoria, stato e motivo di prima. I movimenti riportati a
   «automatica» o a «suggerimento» escono dagli esempi di addestramento.
9. **Categorie in preparazione.** Se la cascata non gira nella stessa richiesta della sync o della creazione dei gruppi,
   serve un dato «in preparazione sì o no» per l'utente (§8.4).
10. **Tabelle statiche e categorie dell'utente.** Le tabelle (tipo di esercizio, marchio) puntano a una categoria. Per un
    utente nuovo puntano ai gruppi di §7.2. Per un utente con categorie proprie (per esempio da Wallet) serve una
    corrispondenza: senza, il livello 3 della cascata non dà mai una categoria. È una regola del dominio da scrivere.
11. **Chiave di idempotenza.** Il caso d'uso la accetta già (`04-now.md` §4.5). L'azione del server la riceve dal
    dialogo e, con una chiave già vista, risponde con la riga esistente come una riuscita.
12. **Movimento manuale e `Expenses`.** `RowView` riceve `manual: boolean`, lo stato della categoria e il motivo.
    `transactions-table.tsx` è già a 596 righe (UI-EXP-4): `CategoryCell` e il menu della riga vanno in file propri,
    non dentro la tabella.
13. **Unione e categorie Wallet** (domanda 6). Serve sapere, per una categoria, quanti movimenti dei conti Wallet la usano.
14. **«Senza categoria» oggi.** Da verificare che il conteggio di oggi di «Senza categoria» non comprenda i giroconti.
    Se li comprende, la fetta «Da categorizzare» li tiene come oggi (criterio 6) e solo «Da rivedere» li esclude.
15. **Scorciatoie a un carattere** (§13). Voce a parte, fuori da N3.
16. **Attributi per i test.** `data-testid` proposti: `review-group`, `review-group-confirm`, `review-done-row`,
    `auto-mark`, `suggestion-chip`, `similar-dialog`, `manual-dialog`, `manual-bank-warning`, `merge-proposal`.

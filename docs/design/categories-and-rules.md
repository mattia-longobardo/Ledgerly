# Categorie a tre livelli, regole automatiche e pagina delle categorie

Specifica di prodotto e di interfaccia. Richiesta di Mattia del 17/11/2026 (tre punti, §0.1).
Indice del piano: [`rewrite-plan.md`](rewrite-plan.md). Specifiche collegate: [`ux/n3-categories-manual.md`](rewrite-plan/ux/n3-categories-manual.md)
(N3, N3.1), [`ux/n4-account-switch.md`](rewrite-plan/ux/n4-account-switch.md) §9.3 (giroconti), [`12-account-modes.md`](rewrite-plan/12-account-modes.md).

Il piano ha priorità. Dove questa specifica lo cambia, il punto è una **decisione proposta** (`CR1`-`CR9`, §0.3), con
il segno **[PROPOSTA]** finché Mattia non la conferma. Le scelte di prodotto aperte sono in §11 (`QC1`-`QC2`, `QC4`-`QC8`): il
documento è scritto con l'opzione A (default) di ognuna. Le stime con **[DEV]** le conferma lo sviluppatore.

Revisione del 18/11/2026: i dati veri di Mattia sono cancellati; in produzione ci sono solo dati artificiali (PERS-424).
Senza storico vero, «Allinea» e la domanda QC3 non servono più: al rilascio di N3.3 una migrazione ricalcola il tipo
di ogni movimento una volta (§3.4). L'eccezione sui numeri (§3.7) e il rilascio N3.3 (§10) sono riscritti per questo caso.

## 0. Riepilogo

### 0.1 Richiesta

| # | Parole di Mattia (17/11/2026) | Sezione |
|---|---|---|
| 1 | «Tre macro categorie: income, expenses e transfer. Income ed expenses hanno delle sotto categorie. Queste sotto categorie hanno delle categorie singole.» | §2, §3 |
| 2 | «Regole impostabili dall'utente per selezionare se una è un income, expense o transfer […] come le automatic rules su Wallet. All'interno di Settings.» | §4 |
| 3 | «La pagina di navigazione delle categorie è poco chiara: fa in modo che siano raggruppabili e che poi uno possa andare a vedere le singole categorie.» | §5 |

### 0.2 Cosa esiste già nel codice (`main`, `v0.29.1`)

La struttura a tre livelli esiste quasi tutta. Manca il modo di vederla e la regola che lega la macro al conteggio.

| Fatto | Dove |
|---|---|
| Ogni categoria ha un tipo `income` · `expense` · `transfer`. Una sottocategoria ha il tipo del suo gruppo (bloccato nel modulo) | `categories.type`, `src/modules/transactions/rules.ts:13`, `category-tree.tsx:319-335` |
| Due livelli: gruppo (senza `parent_id`) → categoria. Il database rifiuta un terzo livello | `categories.parent_id`, `is_root`, `parent_is_root` (`schema.ts:37-110`) |
| Anche il movimento ha un tipo `income` · `expense` · `transfer`, **indipendente** dalla categoria | `transactions.type` (`schema.ts:239`) |
| Entrate e uscite si sommano dal **tipo del movimento**, non dal segno e non dalla categoria. Un `transfer` non entra mai in entrate, uscite, «Per categoria», Budgets | `transactionsSummary`, `categoryTotals`, `spendingOverTime`, `monthSpending` (`queries.ts`) |
| Un movimento della banca ha il tipo dal segno: accredito → `income`, addebito → `expense` | `src/app/(app)/banks/sink.ts:54` |
| Diventa `transfer` solo: da Wallet (giroconto di Wallet), dal passaggio di N4 (coppie tra conti della stessa banca), o da Wallet con il dialogo del dettaglio | `wallet/records.ts:98`, `switching.ts` |
| Il tipo di una categoria si allinea da solo ai suoi movimenti (maggioranza), salvo un tipo scelto a mano | `alignCategoryTypesToMovements` (`taxonomy.ts:240`) |
| La cascata di N3 dà solo una categoria dello stesso tipo del movimento | `categorize/cascade.ts:60` |
| Il «net» del mese somma **tutti** i movimenti, giroconti compresi | `transactionsSummary.netCents`, `monthlyTotals` |
| K1 del piano prevede già «regole» come primo livello della cascata; N3 non le ha fatte | `01-decisions.md` K1, `03-releases.md` N3 |

Conseguenza: «macro» = tipo della categoria. Il lavoro vero è (a) una vista che mostra macro → gruppo → categoria,
(b) la regola «la macro della categoria decide come conta il movimento» (§3), (c) le regole dell'utente (§4).

### 0.3 Decisioni proposte [PROPOSTA]

| # | Decisione | Cambia |
|---|---|---|
| CR1 | Tre macro fisse, non modificabili: **Entrate**, **Uscite**, **Trasferimenti**. Sono il tipo della categoria (`categories.type`), con un nome nuovo nell'interfaccia | Nessuna parte del piano: dà un nome a un dato che c'è |
| CR2 | Entrate e Uscite: gruppo → categoria (come oggi). Trasferimenti: solo categorie, senza gruppi (QC1) | La regola F2.5 «due livelli ovunque», solo per Trasferimenti |
| CR3 | **La macro della categoria decide come conta il movimento.** Una categoria di Trasferimenti fa del movimento un giroconto: esce da entrate, uscite e budget. Tra Entrate e Uscite decide il segno (QC2) | Il tipo del movimento della banca non è più solo il segno. Cambia numeri: eccezione dichiarata (§3.7) |
| CR4 | Al rilascio di N3.3 una migrazione ricalcola una volta il tipo di ogni movimento con la regola di CR3. In produzione ci sono solo dati artificiali: nessun numero vero cambia. Dopo il rilascio i numeri cambiano solo con un'azione della persona | Nessuna: sostituisce «Allinea» della prima versione |
| CR5 | Regole automatiche dell'utente in `Settings › Regole`, primo livello della cascata (K1). Una regola non cambia mai una scelta della persona né un movimento di una sorgente che dà le categorie (QC4) | Aggiunge il livello «regole» che N3 non ha fatto |
| CR6 | Nuova origine della categoria `rule`: conta subito, ha il segno «automatica» con il motivo «Regola «{name}»», non addestra il modello | `CATEGORY_ORIGINS` |
| CR7 | Nuova pagina **Spese › Categorie** (`/expenses/categories`) con macro, gruppi richiudibili, totali del periodo e il dettaglio di ogni categoria. L'albero di `Settings › Categories` si sposta qui (QC6) | R5a: `Settings › Finance › Categorie ed etichette` tiene etichette, proposte di unione, gruppi predefiniti |
| CR8 | Il tipo di una categoria non si allinea più da solo ai movimenti: la macro è una scelta della persona. L'allineamento automatico resta solo per una categoria nuova arrivata da una sorgente, alla creazione | `alignCategoryTypesToMovements` |
| CR9 | Tre rilasci in fase A: N3.2 (pagina), N3.3 (macro e conteggio), N3.4 (regole) (§10) | `03-releases.md` |

Fuori da questa specifica: le impostazioni dei plugin e la sezione «Categorie di {provider}» dentro il plugin
(specifica separata, impostazioni dei plugin); la cascata e la soglia di N3 (dominio).

## 1. Parole

Una parola per un significato, uguale in titolo, pulsante e toast. Si aggiungono alla tabella di N3 §1.1.

| Interfaccia (it) | Interfaccia (en) | Significato | Dominio (mai nell'interfaccia) |
|---|---|---|---|
| **Macro** | Section | Uno dei tre insiemi fissi: Entrate, Uscite, Trasferimenti. Nei testi si usa il nome della macro, raramente la parola «macro» | `categories.type` |
| **Entrate** · **Uscite** · **Trasferimenti** | Income · Expenses · Transfers | Le tre macro | `income` · `expense` · `transfer` |
| **Gruppo** | Group | Primo livello sotto Entrate o Uscite | categoria radice |
| **Categoria** | Category | Livello sotto un gruppo; sotto Trasferimenti, primo livello | categoria figlia, o radice di tipo `transfer` |
| **Giroconto** | Transfer | Un movimento che sposta denaro: non è un'entrata né un'uscita. Parola di oggi, invariata | `type = transfer` |
| **Tra i tuoi conti** | Between your accounts | Giroconti senza categoria (coppie di N4, giroconti di Wallet) | `transfer` con `category_id` nullo |
| **Regola** | Rule | Una regola automatica dell'utente: condizioni → azioni | `category_rules` |

Correzione a N3 §1.1: la parola «regola» era vietata nella vista normale. Da N3.4 «Regola» è una parola
dell'interfaccia, solo per le regole dell'utente. «Cascata», «modello», «soglia», «origine» restano vietate.

## 2. Struttura a tre livelli

### 2.1 Modello

```text
Entrate                         Uscite                          Trasferimenti
├─ Lavoro          (gruppo)     ├─ Casa            (gruppo)     ├─ Risparmio        (categoria)
│  ├─ Stipendio    (categoria)  │  ├─ Affitto      (categoria)  ├─ Carta di credito (categoria)
│  └─ Rimborsi spese            │  └─ Bollette                  ├─ Investimenti     (categoria)
└─ Altre entrate                └─ Spesa alimentare             └─ Tra i tuoi conti (riga fissa, §2.3)
   └─ Regali ricevuti              └─ Supermercato
```

| Regola | Dettaglio |
|---|---|
| Macro | Tre, fisse, sempre in quest'ordine: Entrate, Uscite, Trasferimenti. Non si rinominano, non si archiviano, non si creano |
| Gruppo | Solo sotto Entrate e Uscite. Ha nome, colore, macro. La macro si sceglie alla creazione e si cambia con «Sposta in un'altra macro» (§5.6) |
| Categoria | Sotto un gruppo (Entrate, Uscite) o direttamente sotto Trasferimenti. Ha nome e colore; la macro è quella del gruppo |
| Movimento sul gruppo | Un movimento può avere come categoria un gruppo (oggi succede con Wallet e con i 12 gruppi predefiniti). Nella pagina si vede come riga «Solo «{group}»» in cima al gruppo. Nessuna migrazione |
| Trasferimenti senza gruppi | Il modulo di creazione non offre «Gruppo» sotto Trasferimenti. Una categoria di Trasferimenti non riceve sottocategorie (`Button` «Aggiungi» assente) |
| Database | Nessuna colonna nuova per la struttura. Sotto Trasferimenti le categorie sono radici senza figli: lo schema lo permette già. Il servizio rifiuta un figlio sotto una radice `transfer` (codice `invalid`) |

### 2.2 Dove vanno le categorie e i gruppi di oggi

Nessun dato cambia al rilascio. Ogni riga di `categories` va nella macro del suo `type`.

| Oggi | Dopo | Nota |
|---|---|---|
| Gruppo `expense` con figli | Uscite › gruppo › categorie | Invariato |
| Gruppo `income` con figli | Entrate › gruppo › categorie | Invariato |
| Gruppo `transfer` **senza** figli | Trasferimenti › categoria | Invariato |
| Gruppo `transfer` **con** figli (esempio: un gruppo di Wallet) | Trasferimenti › una categoria per ogni figlio; il gruppo resta come categoria, con la riga «Solo «{group}»» se ha movimenti | La vista appiattisce, il dato resta. Nessuna migrazione. Il modulo non permette figli nuovi |
| Categoria `expense` senza gruppo (radice senza figli) | Uscite › gruppo con lo stesso nome e nessuna categoria | Si vede come gruppo; la riga «Solo «{group}»» porta i movimenti |
| I 12 gruppi predefiniti di N3 §7 | 11 gruppi in Uscite; «Entrate» in Entrate | Per un utente nuovo da N3.3: QC7 (elenco aggiornato con Trasferimenti) |
| Categoria archiviata | Nella sua macro, nascosta; visibile con «Mostra archiviate» | Come oggi |

### 2.3 Dove vanno i giroconti

| Caso | Macro | Riga nella pagina |
|---|---|---|
| Coppia di N4 o giroconto di Wallet, senza categoria | Trasferimenti | **Tra i tuoi conti** (riga fissa, ultima). Non è una categoria: non si rinomina, non si archivia |
| Movimento con una categoria di Trasferimenti (scelta, regola, associazione di una sorgente) | Trasferimenti | La sua categoria |
| Coppia di N4 con una categoria di Entrate o Uscite (caso raro, dati vecchi) | Trasferimenti | La categoria resta sul movimento; il movimento conta in «Tra i tuoi conti». Una coppia vince sempre sulla categoria (CR3, eccezione) |

Un giroconto resta fuori da «Da categorizzare» e da «Da rivedere» (N3 §1.2), con o senza categoria.

### 2.4 Categorie delle sorgenti associate (N3.1)

- L'associazione «categoria di {provider} → categoria di Ledgerly» non cambia. La macro del movimento è la macro della
  categoria di Ledgerly associata.
- Il selettore della colonna «In Ledgerly» (N3 §6.4) mostra le categorie raggruppate per macro (`optgroup`/titoli):
  Entrate, Uscite, Trasferimenti. Oggi mostra solo «le categorie del tipo giusto»: da N3.3 mostra anche Trasferimenti,
  perché associare una categoria di Wallet a un giroconto è il caso d'uso (esempio: «Transfer», «Savings»).
- Un'associazione che cambia la macro (esempio: «Savings» di Wallet da «Aggiunta» a «Trasferimenti › Risparmio»)
  cambia numeri: il toast dice l'effetto e ha «Annulla», come oggi. Testo: «{name} ora corrisponde a {category}:
  {count} movimenti non contano più come uscite.»
- **I movimenti della sorgente non si ricategorizzano mai** (H34): cambia solo come contano, attraverso la macro.
- La sezione «Categorie di {provider}» si sposta nella pagina del plugin (specifica delle impostazioni dei plugin). Il
  selettore resta quello descritto qui.

## 3. Effetto sui numeri

### 3.1 Oggi

Entrate e uscite **non** si calcolano dal segno: si calcolano dal tipo del movimento (§0.2). Il segno decide il tipo
solo quando il movimento arriva dalla banca. Un giroconto tra un conto collegato e un conto non collegato (esempio:
ricarica di una carta prepagata, versamento sul conto deposito di un'altra banca) arriva come `expense` e conta in
uscite e budget.

### 3.2 Regola nuova (CR3) [PROPOSTA]

Il tipo del movimento si calcola così, in quest'ordine:

1. Il movimento è in una coppia di giroconto (`transfer_group_id` non nullo) → `transfer`.
2. Ha una categoria di **Trasferimenti** → `transfer`.
3. Ha una categoria di Entrate o Uscite, oppure nessuna categoria → dal segno: `amount ≥ 0` → `income`, altrimenti
   `expense` (QC2, opzione A). Per un movimento di Wallet senza categoria di Trasferimenti: il tipo di Wallet, come oggi.

Conseguenze per l'interfaccia:

- Il selettore della categoria (`CategoryPicker`) di un movimento negativo mostra Uscite e Trasferimenti; di un
  movimento positivo, Entrate e Trasferimenti. Titoli di sezione con il nome della macro. Oggi il selettore di
  Expenses mostra tutte le categorie: con QC2-A non permette più «Uscite» su un accredito.
- Scegliere una categoria di Trasferimenti su un movimento è il modo di dire «questo è un giroconto». Nessun
  pulsante nuovo «Segna come giroconto».
- Scegliere una categoria di Entrate o Uscite su un giroconto senza coppia lo fa tornare entrata o uscita.
- Su un movimento in coppia il selettore mostra solo Trasferimenti, con la nota `text-sm text-muted` «È un giroconto
  tra i tuoi conti.»
- La cascata di N3 (`decide`) dà solo una categoria di Entrate o Uscite, come oggi: Trasferimenti arriva solo da una
  persona, da una regola o da un'associazione.

Realizzazione [DEV]: il servizio scrive `transactions.type` secondo la regola, nella stessa transazione della
categoria. Le query di somma restano uguali (filtrano già per `type`). Per i movimenti della banca `type` entra in
`locally_edited` solo quando la regola lo cambia rispetto al segno, così la lettura successiva non lo riscrive.

### 3.3 Quando cambiano i numeri

| Momento | Effetto | Conferma |
|---|---|---|
| Rilascio di N3.3 | La migrazione ricalcola il tipo dei movimenti in disaccordo con la loro macro (§3.4). Solo dati artificiali | Numero dei movimenti cambiati nel commento del rilascio |
| La persona sceglie una categoria su un movimento (Expenses, dettaglio, «Da rivedere», selezione multipla) | Il movimento conta secondo §3.2. Per una categoria di Trasferimenti la riga mostra subito il chip «Giroconto» | Toast di oggi + riga «Non conta più come uscita.» se il tipo cambia |
| Una regola si applica a un movimento nuovo | Come sopra | Nessuna (segno «automatica») |
| «Applica ai movimenti esistenti» di una regola | Solo i movimenti dell'anteprima (§4.6) | Anteprima + «Annulla» |
| «Sposta in un'altra macro» di un gruppo o di una categoria (§5.6) | Tutti i movimenti della categoria | Dialogo con i numeri + «Annulla» |
| Associazione di una categoria di una sorgente a Trasferimenti (§2.4) | I movimenti della sorgente con quella categoria | Toast con «Annulla» |

### 3.4 Movimenti in disaccordo al rilascio

Un movimento è in disaccordo quando il suo tipo non è quello che la regola di §3.2 dà (esempio: un accredito in una
categoria di Trasferimenti che conta come entrata). I dati artificiali di PERS-424 ne possono avere.

- La migrazione di N3.3 ricalcola il tipo di **ogni** movimento con la regola di §3.2, una volta, nella stessa
  transazione dello schema. Nessuna anteprima e nessun «Annulla» nell'interfaccia: il recupero è il dump del rilascio.
- Prima del rilascio lo sviluppatore conta i movimenti che cambiano (query di sola lettura) e lo scrive nella richiesta
  di OK, come numero, senza valori.
- **Condizione [DEV]:** la migrazione parte solo se in produzione nessun utente ha dati veri. Lo sviluppatore lo
  verifica prima del rilascio. Se un utente ha dati veri, il rilascio si ferma e torna la domanda a Mattia.
- Nessuna nota «Da allineare» nella pagina delle categorie: dopo il rilascio ogni scrittura della categoria scrive
  anche il tipo, quindi un disaccordo non si crea più.

### 3.5 Righe della fotografia dei numeri che cambiano

Nomi delle chiavi di `scripts/numbers-snapshot.ts`. Nessun valore. Cambiano con la migrazione di N3.3 (§3.4) e dopo
un'azione della persona di §3.3.

| Chiave | Cambia? | Perché |
|---|---|---|
| `months.<m>.summary.incomeCents` | Sì | Un accredito che diventa giroconto esce dalle entrate; un giroconto senza coppia che torna entrata entra |
| `months.<m>.summary.expenseCents` | Sì | Come sopra, per gli addebiti |
| `months.<m>.summary.transferCount`, `unpairedTransferCount` | Sì | I giroconti nuovi sono senza coppia |
| `months.<m>.summary.count`, `netCents` | **No** | Il net somma già tutti i movimenti, giroconti compresi |
| `months.<m>.breakdown` («Per categoria») | Sì | Le categorie di Trasferimenti escono dalla torta; quote ricalcolate |
| `months.<m>.budgets.rows`, `totals`, `unbudgetedCents` | Sì | Lo speso conta solo `expense` |
| `summary.incomeCents`, `summary.expenseCents` (`monthlyFigures`) | Sì | Leggono `transactionsSummary` |
| `summary.netCents`, `netWorthCents`, `cashCents` | No | Saldi e net non dipendono dal tipo |
| `subscriptions` (addebiti trovati, prossimo addebito, totale annuo) | Sì, se un addebito di un abbonamento diventa giroconto | `chargeCandidates` cerca solo `expense` |
| `pockets` (spese collegate a un pocket) | Sì, se un addebito collegato diventa giroconto | `chargeCandidates` |
| `interests.details` (interessi pagati dalla banca) | Sì, se un accredito di interessi diventa giroconto | `incomeCandidates` cerca solo `income` |
| `accounts.*` (saldi, serie, patrimonio, riquadri) | No | — |
| `investments.*`, `funds.*` | No | I candidati includono già i giroconti (`linkCandidates`, `types: ["expense", "transfer"]`) |
| `timeOff.*`, `payroll.*` | No | — |

Protezione per abbonamenti, pocket e interessi [DEV]: il dialogo di «Sposta in un'altra macro» e l'anteprima di una
regola elenca a parte i movimenti collegati a un abbonamento, a un pocket o a una regola di interessi, con la riga
«{count} movimenti sono collegati a {Abbonamenti|Pocket|Interessi}: lì non conteranno più.» Nessun blocco.

### 3.6 API e MCP

- Nessuna forma di risposta cambia. `type` del movimento resta `income` · `expense` · `transfer`; la categoria ha già `type`.
- I valori di `GET /api/v1/summary` (`incomeCents`, `expenseCents`), `GET /transactions` (filtro per tipo), degli
  strumenti MCP `get_summary` e `list_transactions` cambiano come la fotografia (§3.5), dopo le stesse azioni.
- Aggiunta additiva [DEV]: `GET /categories` e lo strumento MCP che elenca le categorie danno anche `macro` (uguale a
  `type`) e `groupId`. Facoltativa: si può rimandare a R2.
- G5 «stessi numeri»: la parità Overview = conti = API = MCP resta vera, perché tutte leggono lo stesso `type`.

### 3.7 Eccezione dichiarata (da approvare)

- **Rilascio di N3.3:** la fotografia «dopo» può essere diversa dalla fotografia «prima» per le sole righe di §3.5 e
  per i soli movimenti contati prima del rilascio (§3.4). In produzione sono dati artificiali: nessun numero vero di
  Mattia cambia. La differenza è attesa; il commento del rilascio dice il numero dei movimenti e i nomi delle righe.
- **Dopo il rilascio:** una scelta della categoria, «Sposta in un'altra macro», «Applica ai movimenti esistenti» di una
  regola e un'associazione verso Trasferimenti cambiano i numeri. Sono modifiche della persona, come oggi la scelta
  di una categoria: non sono un'eccezione al gate G5. Le tre azioni di gruppo hanno «Annulla».
- Rilasci N3.2 e N3.4: fotografia uguale.

## 4. Regole automatiche

### 4.1 Posto

- `Settings › Regole` (`/settings/rules`), tab nuovo accanto a Categories. Con R5a: `Settings › Finance › Regole`.
- Ingressi secondari: menu della riga in Expenses «Crea una regola…» (§4.7); dettaglio di una categoria, card «Regole» (§5.4).
- Ispirazione: le regole automatiche di Wallet (BudgetBakers), solo per le funzioni: condizioni sul testo e
  sull'importo, azioni su tipo e categoria, ordine, applicazione ai movimenti esistenti. Nome, disegno e testi sono di Ledgerly.

### 4.2 Elenco

```text
Regole                                                     [＋ Nuova regola]
Ledgerly applica le regole ai movimenti nuovi, dall'alto in basso.
La prima regola che corrisponde decide. Le tue scelte a mano vincono sempre.

┌──────────────────────────────────────────────────────────────────────────┐
│ ⠿ 1  Ricarica carta prepagata                       [●] Attiva   [⋯]      │
│      Testo contiene «ricarica» · Conto: Conto corrente                    │
│      → Trasferimenti › Carta di credito · 23 movimenti                    │
├──────────────────────────────────────────────────────────────────────────┤
│ ⠿ 2  Stipendio                                      [●] Attiva   [⋯]      │
│      Controparte contiene «ACME» · Importo > 0                            │
│      → Entrate › Lavoro › Stipendio · 14 movimenti                        │
└──────────────────────────────────────────────────────────────────────────┘
```

- Lista ordinata (`<ol>`). Ogni riga: numero, nome, riassunto delle condizioni (una riga, `text-sm text-muted`),
  azione con il percorso macro › gruppo › categoria, numero di movimenti che oggi portano la categoria da questa regola.
- Interruttore «Attiva» (`Checkbox` con ruolo `switch`). Una regola spenta resta nell'elenco con `opacity` normale e
  il `Badge` `neutral` «Spenta».
- Ordine: maniglia per trascinare **e** due voci del menu «Sposta su», «Sposta giù» (la tastiera non trascina).
- Menu `⋯` (`ActionMenu`): Modifica, Applica ai movimenti esistenti…, Duplica, Sposta su, Sposta giù, Elimina.
- «Elimina»: dialogo `width={420}` «Eliminare la regola «{name}»? I {count} movimenti tengono la loro categoria.»
  Toast «Regola eliminata» con «Annulla».

### 4.3 Condizioni

Tutte devono essere vere (E logico). Da 1 a 8 condizioni per regola.

| Campo | Operatori | Valore | Dato [DEV] |
|---|---|---|---|
| Testo | contiene · non contiene · è uguale a · inizia con | testo, senza differenza tra maiuscole e minuscole, senza accenti | `payee` + `note` + testo grezzo della banca |
| Controparte | contiene · è uguale a | testo | `counterparty_name`, altrimenti `payee` |
| Controparte è un tuo conto | — (sì) | — | IBAN nel testo uguale all'IBAN di un conto dell'utente (`planIbanTransfers`) |
| Importo | è maggiore di · è minore di · è tra · è uguale a | importo positivo, nella valuta del conto | valore assoluto di `amount_cents` |
| Direzione | entrata · uscita | — | segno |
| Conto | è uno di | più conti (`DismissableDetails` del filtro dei conti) | `account_id` |
| Sorgente | è | Banca · A mano · {plugin} | origine e collegamento del conto |
| Valuta | è | codice | `currency` |

- Un campo compare una volta sola, salvo «Testo» (fino a 3 volte, per «contiene X» e «non contiene Y»).
- Esempio: «Testo contiene «ricarica» E Conto è Conto corrente E Direzione è uscita».

### 4.4 Azioni

| Azione | Valore | Effetto |
|---|---|---|
| Categoria | `CategoryPicker` per macro | Scrive la categoria; il tipo segue §3.2. **Obbligatoria**, salvo la voce seguente |
| Solo giroconto | — | Il movimento diventa giroconto senza categoria: compare in «Tra i tuoi conti». Alternativa a «Categoria» |
| Etichette | aggiungi una o più etichette | Aggiunge, non toglie |
| Nota | testo, max 200 caratteri | Scrive la nota solo se il movimento non ne ha una |

La macro non è un'azione separata: si sceglie con la categoria, perché ogni categoria ha una sola macro. Il selettore
mostra le tre macro come titoli. Questo risponde a «selezionare se è un income, expense o transfer» senza un campo che
possa contraddire la categoria.

### 4.5 Ordine, priorità e cascata (CR5, CR6)

Per ogni movimento nuovo, prima della cascata di N3:

1. Movimento di una sorgente che dà le categorie (Wallet), movimento in coppia di giroconto, movimento con una scelta
   della persona (`category_origin = user`): **nessuna regola**. (QC4)
2. Regole attive, dall'alto in basso. **La prima che corrisponde decide** (QC5): scrive la categoria con origine
   `rule` e il riferimento alla regola. Le regole dopo non si guardano.
3. Nessuna regola corrisponde → cascata di N3 come oggi (struttura → memoria → modello → tabelle → «Da categorizzare»).

| Domanda | Risposta |
|---|---|
| Una regola vince sulla memoria e sul modello di N3? | Sì: è una scelta esplicita della persona |
| Una categoria da regola addestra il modello? | No (come le automatiche, `04-now.md` §4.4) |
| Come si vede sulla riga? | Segno «automatica» di N3 §2. Motivo nel popover: «Regola «{name}»» con il link «Apri la regola» |
| La persona corregge un movimento con categoria da regola | Diventa `user`. Dialogo «Applico a N movimenti simili?» di N3 §5 come oggi, più la riga: «La regola «{name}» resta uguale. [Modifica la regola]» |
| La regola cambia o si spegne | I movimenti già categorizzati restano. Il dialogo di salvataggio offre «Applica ai movimenti esistenti» (§4.6) |
| La regola si elimina | I movimenti restano con la loro categoria; il motivo diventa «Regola eliminata» |
| La categoria della regola si archivia | La regola si spegne da sola; `Badge` `warn` «Categoria archiviata» sulla riga |

### 4.6 Editor e anteprima

`Modal` `width={520}`. Su 400 px occupa lo schermo intero (comportamento di `Modal` di oggi).

```text
┌────────────────────────────────────────────────────────────┐
│ Nuova regola                                               │
│                                                            │
│ Nome  [Ricarica carta prepagata                         ]  │
│                                                            │
│ Se                                                         │
│ [Testo        ▾] [contiene     ▾] [ricarica           ] ✕  │
│ [Conto        ▾] [è uno di     ▾] [Conto corrente  ▾  ] ✕  │
│ ＋ Aggiungi una condizione                                  │
│                                                            │
│ Allora                                                     │
│ Categoria  [■ Trasferimenti › Carta di credito        ▾]  │
│ Etichette  [＋]                                            │
│ Nota       [                                          ]   │
│                                                            │
│ Anteprima: 23 movimenti corrispondono. 3 hanno una tua     │
│ scelta e non cambiano.   Vedi ⌄                            │
│                                                            │
│                       [Annulla]  [Salva]                   │
└────────────────────────────────────────────────────────────┘
```

- Ogni condizione è una riga di tre campi (`Select`, `Select`, valore) e un `Button` `ghost` `xs` «Togli» con
  `aria-label` «Togli la condizione {n}». Su 400 px i tre campi vanno uno sotto l'altro.
- **Anteprima dal vivo** (debounce 400 ms, solo quando la regola è valida): quanti movimenti esistenti corrispondono,
  quanti sono esclusi (scelta della persona, Wallet, coppia), «Vedi» apre l'elenco dei primi 50. `aria-live="polite"`.
- «Salva» crea la regola **solo per i movimenti nuovi**. Se l'anteprima ha movimenti che cambierebbero, il toast è
  «Regola salvata» con l'azione «Applica a {count} movimenti esistenti…».

**«Applica ai movimenti esistenti…»** (dal toast o dal menu della regola), `Modal` `width={460}`:

```text
┌──────────────────────────────────────────────────────┐
│ Applica «Ricarica carta prepagata»                   │
│                                                      │
│ 20 movimenti passano a Trasferimenti › Carta di      │
│ credito. Non contano più come uscite: −1.240,00 €    │
│ dal 2025 a oggi.                                     │
│ 3 movimenti hanno una tua scelta e non cambiano.     │
│ 1 movimento è collegato a un abbonamento.            │
│                                                      │
│ Mostra i 20 movimenti ⌄                              │
│                                                      │
│                       [Annulla]  [Applica]           │
└──────────────────────────────────────────────────────┘
```

- Le righe sui numeri compaiono solo se la macro cambia. Righe di §3.5 su abbonamenti, pocket, interessi solo se servono.
- «Applica»: toast «{count} movimenti aggiornati» con «Annulla». «Annulla» rimette categoria, tipo, origine,
  etichette e nota di prima (tabella di annullamento, come `category_undos` di N3).
- Tocca solo movimenti senza scelta della persona (origine nulla da cascata, `memory`, `model`, `table`, `rule`) e
  senza categoria. Mai `user`, mai `provider` (QC4).

### 4.7 Regola da un movimento

Menu della riga in Expenses e dettaglio del movimento: «Crea una regola…». Apre l'editor con:

- condizione «Controparte è uguale a {counterparty}» (o «Testo contiene {testo senza cifre}» se manca la controparte);
- condizione «Conto è {account}»;
- azione «Categoria» = categoria del movimento, se c'è.

Dopo una correzione della categoria, il dialogo di N3 §5 «Applico a N movimenti simili?» ha un terzo pulsante
`LinkButton` «Crea una regola» che apre lo stesso editor.

### 4.8 Limiti

- Max 200 regole per utente. Oltre: «Hai raggiunto 200 regole. Elimina una regola per aggiungerne un'altra.»
- Le regole sono dell'utente: export (JSON con nome, condizioni, azioni, ordine), cancellazione dell'utente,
  nessuna condivisione. Mai in API/MCP in scrittura in N3.4; lettura in R2.
- Nessun linguaggio di espressioni, nessuna regex nell'interfaccia.

## 5. Pagina delle categorie

### 5.1 Posto e URL

- **Spese › Categorie**: `/expenses/categories`, figlio di Expenses (`Page` con `parent`). In menu: seconda voce
  sotto Expenses, come «Da rivedere». Su 400 px: tab interni di Expenses «Movimenti · Categorie · Da rivedere».
- Dettaglio: `/expenses/categories/[id]`.
- Periodo: **`PeriodBar`** (`src/modules/accounts/ui/period-bar.tsx`), lo stesso controllo di Conti e Spese, con gli
  stessi parametri nell'URL (`from`, `to`). Passando da Expenses a Categorie il periodo resta.
- Filtro dei conti: lo stesso menu di `filter-bar.tsx`. Nessun altro filtro.

### 5.2 Struttura (1440 px)

```text
Spese › Categorie                                          [＋ Nuovo gruppo]
[‹ Novembre 2026 ›] [Mese|Anno|Tutto|Personalizzato]   [Conti: tutti ▾]

┌ Entrate ───────────────────── 3.200,00 € ─┐ ┌ Uscite ──── 2.140,00 € ─┐ ┌ Trasferimenti ── 900,00 € ─┐
│ 4 movimenti                               │ │ 96 movimenti            │ │ 12 movimenti               │
└───────────────────────────────────────────┘ └─────────────────────────┘ └────────────────────────────┘

[ Entrate | Uscite | Trasferimenti ]            [Espandi tutto] [Mostra archiviate ☐]

Uscite                                                   2.140,00 €   100%
▾ ■ Casa                                    1.050,00 €   49%   ▓▓▓▓▓▓▓░░░   [⋯]
    Solo «Casa»                               100,00 €    5%
    ■ Affitto                                 800,00 €   37%   Budget 800 € ●
    ■ Bollette                                150,00 €    7%   Budget 120 € ▲
▸ ■ Spesa alimentare                          420,00 €   20%   ▓▓░░░░░░░░   [⋯]
▸ ■ Ristoranti e bar                          310,00 €   14%   ▓░░░░░░░░░   [⋯]
  …
  Da categorizzare (9)                         60,00 €    3%   [Rivedi]
```

- **Tre card di sintesi** (`Card`), una per macro: totale del periodo, numero di movimenti. Clic → scorre alla macro e
  la seleziona. Trasferimenti mostra la somma degli usciti; sotto, `text-sm text-muted` «Entrati {in} · Usciti {out}».
- **`Segmented`** «Entrate · Uscite · Trasferimenti»: mostra una macro alla volta. Default: Uscite. Nell'URL: `macro=`.
- **Gruppo** (riga richiudibile): freccia, colore, nome, totale, quota sul totale della macro, barra della quota
  (`ProgressBar`), menu `⋯`. Chiuso per default; «Espandi tutto» li apre. Lo stato aperto resta in `localStorage`
  (con `try/catch`; senza memoria tutti chiusi).
- **Categoria** (riga figlia, rientrata): colore, nome, totale, quota, budget se esiste (limite e pallino
  `pos` / `warn` / `neg` come Budgets). Clic sulla riga → dettaglio (§5.4).
- **«Solo «{group}»»**: movimenti con il gruppo come categoria. Clic → Expenses filtrato sul gruppo.
- **«Da categorizzare ({count})»**: ultima riga di Entrate e di Uscite, con `ButtonLink` «Rivedi» → `/expenses/review`.
- **Trasferimenti**: elenco piatto delle categorie + riga fissa «Tra i tuoi conti». Colonne: «Usciti», «Entrati».
  Nessuna quota (un giroconto non è una parte di un totale).
- Righe con totale 0 nel periodo: visibili, in `text-muted`, in fondo al gruppo. Un gruppo senza movimenti nel
  periodo resta visibile (serve per gestire la struttura).
- Ordine: per totale decrescente; a parità, per nome. Nessun ordine a mano in N3.2.

### 5.3 Somme

- Le somme usano il **tipo del movimento** (§3.2), come Expenses: totale di Uscite = testata «Uscite» di Expenses nello
  stesso periodo e per gli stessi conti. Criterio di accettazione (§10).
- Il totale di un gruppo = movimenti sul gruppo + movimenti delle sue categorie, solo di quella macro.
- Fino a N3.3 un movimento in disaccordo conta nella macro del suo tipo: la sua categoria compare anche nella macro
  del tipo, senza segni. Così i totali delle card sono sempre uguali a Expenses. Da N3.3 il disaccordo non esiste più.

### 5.4 Dettaglio di una categoria

`/expenses/categories/[id]`, `Page` con `parent` = Categorie. Lo stesso `PeriodBar`.

```text
Spese › Categorie › Uscite › Casa › Bollette                         [⋯]
[‹ 2026 ›] [Mese|Anno|Tutto|Personalizzato]

┌ Speso ──────────┐ ┌ Movimenti ─┐ ┌ Media al mese ─┐ ┌ Budget ─────────────────┐
│ 1.480,00 €      │ │ 22         │ │ 134,55 €       │ │ 120 € al mese · 3 mesi  │
│ +12% sul 2025   │ │            │ │                │ │ sopra il limite · Apri  │
└─────────────────┘ └────────────┘ └────────────────┘ └─────────────────────────┘

┌ Andamento ───────────────────────────────────────────────────────────────┐
│ barre per mese (per giorno con «Mese»), linea del limite del budget       │
└──────────────────────────────────────────────────────────────────────────┘

┌ Movimenti ─────────────────────────────── [Apri in Spese →] ─┐ ┌ Regole ─────────────────┐
│ tabella di Expenses filtrata sulla categoria, 50 righe       │ │ «Enel» → questa          │
│                                                              │ │ ＋ Nuova regola           │
└──────────────────────────────────────────────────────────────┘ │ Da Wallet: Energy, Gas   │
                                                                 └──────────────────────────┘
```

- Briciole: macro › gruppo › categoria; ogni pezzo è un link alla pagina con la macro selezionata e il gruppo aperto.
- KPI (`Card`): Speso (o «Ricevuto» in Entrate, «Spostato» in Trasferimenti), confronto con il periodo precedente
  della stessa durata (solo se ha dati), Movimenti, Media al mese (solo con periodo ≥ 2 mesi), Budget (solo se
  esiste: limite, mesi sopra il limite, link a Budgets).
- Andamento: lo stesso grafico a barre di Expenses (`spendingOverTime` filtrato sulla categoria). Linea tratteggiata
  del limite del budget. Tabella nascosta con gli stessi dati per lo screen reader.
- Movimenti: la tabella di Expenses (`transactions-table.tsx`) con il filtro della categoria, 50 righe, stesse azioni
  della riga. «Apri in Spese» → `/expenses?category={id}&from=…&to=…`.
- Card «Regole»: regole la cui azione dà questa categoria, con link; «Nuova regola» apre l'editor con l'azione già
  scelta. Riga «Da {provider}: {names}» (N3 §6.4) se la categoria è associata a categorie di una sorgente.
- Dettaglio di un **gruppo**: stessa pagina; la tabella dei movimenti diventa l'elenco delle sue categorie con i totali
  (come §5.2), e sotto i movimenti del gruppo.
- Menu `⋯`: le azioni di §5.6.

### 5.5 Categoria nuova e gruppo nuovo

- «Nuovo gruppo» in alto: dialogo `width={420}` con Nome, Macro (`Segmented` «Entrate · Uscite»; default: la macro
  selezionata), Colore. Trasferimenti non c'è: lì si crea una categoria.
- Nel menu di un gruppo e in fondo a ogni gruppo: `LinkButton` «Aggiungi una categoria» → dialogo con Nome e Colore;
  gruppo e macro già scelti e mostrati come testo.
- Sotto Trasferimenti: `LinkButton` «Aggiungi una categoria di Trasferimenti».
- Validazione: nome obbligatorio, max `NAME_MAX`, unico tra i fratelli (errore «Esiste già «{name}» in {group}»).

### 5.6 Spostare, unire, archiviare

Menu `⋯` di gruppo e categoria (`ActionMenu`):

| Voce | Per | Dialogo | Effetto sui numeri |
|---|---|---|---|
| Rinomina | gruppo, categoria | in riga: il nome diventa un `Input`; `Enter` salva, `Esc` annulla | No |
| Colore | gruppo, categoria | `ColorSwatch` di oggi | No |
| Sposta in un altro gruppo… | categoria di Entrate/Uscite | `Select` dei gruppi **della stessa macro** | No |
| Sposta in un'altra macro… | gruppo; categoria di Trasferimenti | `Modal` `width={460}`: macro di arrivo; per una categoria di Trasferimenti anche il gruppo. Testo con i numeri come §3.4 («{count} movimenti non contano più come uscite: −{amount} dal {year}») | **Sì**: eccezione §3.7. Toast con «Annulla». Non disponibile prima di N3.3 |
| Unisci con… | gruppo, categoria | Dialogo «Unisci le categorie» di N3 §6.3, con un selettore della categoria che resta (stessa macro; un'altra macro aggiunge la riga sui numeri) | Solo se la macro cambia |
| Archivia | gruppo, categoria | `width={420}`: «I {count} movimenti restano in «{name}». La categoria non compare più nei selettori. {rules} regole si spengono.» Per un gruppo: «Anche le sue {n} categorie vengono archiviate.» | No |
| Ripristina | archiviata | Nessun dialogo; toast | No |

- Una categoria con un budget che passa a Trasferimenti: il budget si ferma dal mese in corso (QC8); il dialogo lo dice.
- Una categoria associata a una sorgente: lo spostamento vale anche per i movimenti della sorgente; il dialogo lo dice
  con la riga di N3 §6.3 «I movimenti di {provider}…».
- Nessuna cancellazione: una categoria si archivia (spec §7.2 di oggi).

### 5.7 Cosa resta in `Settings › Categories`

Con QC6-A l'albero passa alla pagina nuova. `Settings › Categories` (poi `Settings › Finance › Categorie ed etichette`)
tiene: proposte di unione (N3 §6), gruppi predefiniti (N3 §7), etichette. In cima, una nota con il link «Gruppi e
categorie sono in Spese › Categorie». La sezione «Categorie di {provider}» va nella pagina del plugin (specifica
delle impostazioni dei plugin).

## 6. Stati

| Superficie | Vuoto | Caricamento | Errore | Altro |
|---|---|---|---|---|
| Pagina Categorie | Nessuna categoria: `EmptyState` «Ancora nessuna categoria» + `Button` «Usa i gruppi predefiniti» (N3 §7) + «Nuovo gruppo». Macro senza movimenti nel periodo: le righe con 0 | `Skeleton` di 3 card + 6 righe | `ErrorState` «Non è stato possibile caricare le categorie.» + «Riprova» | — |
| Dettaglio | Nessun movimento nel periodo: KPI a 0, grafico vuoto con «Nessun movimento in questo periodo», tabella vuota | `Skeleton` | `ErrorState`; id sconosciuto → `notFound()` | Categoria archiviata: `Badge` «Archiviata» + «Ripristina» |
| Regole | `EmptyState` «Ancora nessuna regola» + testo «Una regola dà da sola categoria e macro ai movimenti nuovi. Esempio: ogni movimento con «ricarica» va in Trasferimenti.» + «Nuova regola» | `Skeleton` di 3 righe | `ErrorState` | Regola spenta, categoria archiviata (§4.5) |
| Anteprima dell'editor | «Nessun movimento corrisponde oggi.» | «Calcolo…» `aria-busy` | «Anteprima non disponibile. Puoi salvare lo stesso.» | Regola non valida: nessuna anteprima |
| Salvataggi | — | Pulsante `disabled` con `aria-busy` | `role="alert"` nel dialogo, nessun cambio parziale | Toast con «Annulla» |

## 7. Layout

### 7.1 1440 px

- Pagina Categorie: colonna unica larga come Expenses. Card delle macro in griglia a 3. Righe con 5 colonne: nome
  (flessibile), totale (`tabular-nums`, a destra), quota, barra (160 px), budget/menu.
- Dettaglio: KPI in griglia a 4; Andamento a tutta larghezza; Movimenti (2/3) + Regole (1/3).
- Regole: lista a tutta larghezza, max 960 px.

### 7.2 400 px

- Gutter 16 px, nessuno scorrimento orizzontale.
- Le card delle macro non si disegnano: il `Segmented` delle macro le sostituisce. Il totale della macro selezionata
  è sotto il `Segmented`, `text-xl`.
- Riga di gruppo: freccia, colore, nome (si tronca con `…`, nome completo in `title` e nel nome accessibile), totale.
  Quota e barra vanno su una seconda riga, `text-sm`. Menu `⋯` sempre visibile, area di tocco 44 × 44 px.
- Dettaglio: KPI 2 × 2; Regole sotto Movimenti; la tabella diventa la lista `<ul>` di Expenses.
- Editor delle regole: schermo intero; condizioni in colonna; pulsanti in basso fissi.

### 7.3 Temi

Solo token esistenti (N3 §1.4). Il colore della categoria è solo un pallino o una barra, mai il colore del testo.
Pallini del budget: `pos`, `warn`, `neg` con il testo «nel limite» / «vicino al limite» / «sopra il limite» per lo
screen reader (il colore non è l'unico segnale). Verificare il contrasto della barra (`ProgressBar`) su `card` nei due temi (≥ 3:1).

## 8. Tastiera e accessibilità (WCAG 2.2 AA)

| Punto | Regola |
|---|---|
| Gruppo richiudibile | `button` con `aria-expanded` e `aria-controls`; il nome del gruppo è il testo del pulsante. `Enter`/`Space` apre e chiude |
| Struttura | Ogni macro è una `section` con `h2`; i gruppi sono una lista `<ul>` con righe `li`. Nessun `role="tree"` (meno tasti da imparare) |
| Riga di categoria | Un solo link (il nome) porta al dettaglio; totale e quota sono testo. Il menu `⋯` ha `aria-label` «Azioni per {name}» |
| Rinomina in riga | `Input` con `aria-label` «Nome di {name}»; `Esc` torna al valore di prima e il focus torna al link |
| Ordine delle regole | «Sposta su/giù» nel menu; dopo lo spostamento il focus resta sulla regola e `aria-live` dice «{name} ora è la regola {n}» |
| Interruttore «Attiva» | `role="switch"` con `aria-checked`; nome «Attiva {name}» |
| Editor | `fieldset` «Se» e «Allora» con `legend`; ogni condizione ha i tre campi etichettati «Campo della condizione {n}», «Operatore», «Valore» |
| Anteprima | `aria-live="polite"`, aggiornata al massimo ogni 400 ms |
| Dialoghi | `Modal` di oggi: focus nel dialogo, `Esc` chiude, focus torna all'origine |
| Grafico | Tabella nascosta con mese e importo; il grafico ha `aria-hidden` |
| Bersagli | ≥ 24 × 24 px (2.5.8); 44 px su 400 px per freccia e menu |
| Movimento ridotto | Apertura dei gruppi senza animazione con `prefers-reduced-motion` |
| Focus visibile | Anello di oggi (`focus-visible`) su righe, frecce, maniglie |

## 9. Testi e chiavi

Chiavi nuove in `messages/{it,en}.json`. ICU per i plurali.

### 9.1 `categories` (pagina e dettaglio)

| Chiave | it | en |
|---|---|---|
| `title` | Categorie | Categories |
| `macro.income` | Entrate | Income |
| `macro.expense` | Uscite | Expenses |
| `macro.transfer` | Trasferimenti | Transfers |
| `card.count` | {count, plural, one {# movimento} other {# movimenti}} | {count, plural, one {# transaction} other {# transactions}} |
| `card.transferSplit` | Entrati {in} · Usciti {out} | In {in} · Out {out} |
| `expandAll` / `collapseAll` | Espandi tutto / Richiudi tutto | Expand all / Collapse all |
| `showArchived` | Mostra archiviate | Show archived |
| `onlyGroup` | Solo «{group}» | Only “{group}” |
| `betweenAccounts` | Tra i tuoi conti | Between your accounts |
| `toCategorize` | Da categorizzare ({count}) | To categorize ({count}) |
| `review` | Rivedi | Review |
| `newGroup` | Nuovo gruppo | New group |
| `addCategory` | Aggiungi una categoria | Add a category |
| `addTransferCategory` | Aggiungi una categoria di Trasferimenti | Add a transfer category |
| `actions` | Azioni per {name} | Actions for {name} |
| `move.group` | Sposta in un altro gruppo… | Move to another group… |
| `move.macro` | Sposta in un'altra macro… | Move to another section… |
| `move.effect` | {count, plural, one {# movimento non conta} other {# movimenti non contano}} più come {from}: {amount} dal {year}. | {count, plural, one {# transaction no longer counts} other {# transactions no longer count}} as {from}: {amount} since {year}. |
| `merge` | Unisci con… | Merge with… |
| `archive.title` | Archiviare «{name}»? | Archive “{name}”? |
| `archive.body` | {count, plural, one {Il movimento resta} other {I # movimenti restano}} in «{name}». La categoria non compare più nei selettori. | {count, plural, one {The transaction stays} other {The # transactions stay}} in “{name}”. The category no longer appears in pickers. |
| `archive.rules` | {count, plural, one {# regola si spegne} other {# regole si spengono}}. | {count, plural, one {# rule is turned off} other {# rules are turned off}}. |
| `budget.ok` / `near` / `over` | nel limite / vicino al limite / sopra il limite | within limit / near limit / over limit |
| `empty.title` | Ancora nessuna categoria | No categories yet |
| `error` | Non è stato possibile caricare le categorie. | Categories could not be loaded. |
| `detail.spent` / `received` / `moved` | Speso / Ricevuto / Spostato | Spent / Received / Moved |
| `detail.vsPrevious` | {delta} sul periodo precedente | {delta} vs previous period |
| `detail.perMonth` | Media al mese | Monthly average |
| `detail.openInExpenses` | Apri in Spese | Open in Expenses |
| `detail.rules` | Regole | Rules |
| `detail.noMovements` | Nessun movimento in questo periodo | No transactions in this period |
| `paired` | È un giroconto tra i tuoi conti. | It is a transfer between your accounts. |

### 9.2 `settings.rules`

| Chiave | it | en |
|---|---|---|
| `title` | Regole | Rules |
| `intro` | Ledgerly applica le regole ai movimenti nuovi, dall'alto in basso. La prima regola che corrisponde decide. Le tue scelte a mano vincono sempre. | Ledgerly applies rules to new transactions, from top to bottom. The first rule that matches decides. Your manual choices always win. |
| `new` | Nuova regola | New rule |
| `edit` | Modifica la regola | Edit rule |
| `name` | Nome | Name |
| `if` / `then` | Se / Allora | If / Then |
| `addCondition` | Aggiungi una condizione | Add a condition |
| `removeCondition` | Togli la condizione {n} | Remove condition {n} |
| `field.text` / `counterparty` / `ownAccount` / `amount` / `direction` / `account` / `source` / `currency` | Testo / Controparte / Controparte è un tuo conto / Importo / Direzione / Conto / Sorgente / Valuta | Text / Counterparty / Counterparty is one of your accounts / Amount / Direction / Account / Source / Currency |
| `op.contains` / `notContains` / `equals` / `startsWith` / `gt` / `lt` / `between` / `oneOf` | contiene / non contiene / è uguale a / inizia con / è maggiore di / è minore di / è tra / è uno di | contains / does not contain / is / starts with / is more than / is less than / is between / is one of |
| `direction.in` / `out` | entrata / uscita | money in / money out |
| `action.category` / `transferOnly` / `labels` / `note` | Categoria / Solo giroconto / Etichette / Nota | Category / Transfer only / Labels / Note |
| `active` | Attiva | Active |
| `off` | Spenta | Off |
| `archivedCategory` | Categoria archiviata | Archived category |
| `count` | {count, plural, one {# movimento} other {# movimenti}} | {count, plural, one {# transaction} other {# transactions}} |
| `preview.match` | {count, plural, =0 {Nessun movimento corrisponde oggi.} one {# movimento corrisponde.} other {# movimenti corrispondono.}} | {count, plural, =0 {No transaction matches today.} one {# transaction matches.} other {# transactions match.}} |
| `preview.kept` | {count, plural, one {# ha una tua scelta e non cambia.} other {# hanno una tua scelta e non cambiano.}} | {count, plural, one {# has your own choice and does not change.} other {# have your own choice and do not change.}} |
| `preview.busy` | Calcolo… | Calculating… |
| `preview.error` | Anteprima non disponibile. Puoi salvare lo stesso. | Preview not available. You can still save. |
| `saved` | Regola salvata | Rule saved |
| `applyExisting` | Applica a {count, plural, one {# movimento esistente} other {# movimenti esistenti}}… | Apply to {count, plural, one {# existing transaction} other {# existing transactions}}… |
| `apply.title` | Applica «{name}» | Apply “{name}” |
| `apply.body` | {count, plural, one {# movimento passa} other {# movimenti passano}} a {category}. | {count, plural, one {# transaction moves} other {# transactions move}} to {category}. |
| `apply.done` | {count, plural, one {# movimento aggiornato} other {# movimenti aggiornati}} | {count, plural, one {# transaction updated} other {# transactions updated}} |
| `moveUp` / `moveDown` | Sposta su / Sposta giù | Move up / Move down |
| `moved` | {name} ora è la regola {n} | {name} is now rule {n} |
| `duplicate` | Duplica | Duplicate |
| `delete.title` | Eliminare la regola «{name}»? | Delete rule “{name}”? |
| `delete.body` | {count, plural, one {Il movimento tiene} other {I # movimenti tengono}} la sua categoria. | {count, plural, one {The transaction keeps} other {The # transactions keep}} its category. |
| `deleted` | Regola eliminata | Rule deleted |
| `limit` | Hai raggiunto 200 regole. Elimina una regola per aggiungerne un'altra. | You have reached 200 rules. Delete a rule to add another one. |
| `empty.title` | Ancora nessuna regola | No rules yet |
| `empty.body` | Una regola dà da sola categoria e macro ai movimenti nuovi. Esempio: ogni movimento con «ricarica» va in Trasferimenti. | A rule gives new transactions their category and section by itself. Example: every transaction with “top-up” goes to Transfers. |
| `fromTransaction` | Crea una regola… | Create a rule… |
| `reason` | Regola «{name}» | Rule “{name}” |
| `reasonDeleted` | Regola eliminata | Deleted rule |
| `openRule` | Apri la regola | Open rule |
| `error` | Non è stato possibile salvare la regola. Riprova. | The rule could not be saved. Try again. |

## 10. Proposta di rilasci [PROPOSTA]

Tre rilasci in fase A, dopo le correzioni di N4 aperte e prima della chiusura della fase. Ordine obbligato: la pagina
non cambia numeri; la macro serve alle regole (azione «Trasferimenti»). Ognuno ha le regole comuni di `03-releases.md` §3.1.

| | N3.2 · Pagina delle categorie | N3.3 · La macro decide il conteggio | N3.4 · Regole automatiche |
|---|---|---|---|
| Obiettivo | Vedere entrate, uscite e trasferimenti per gruppo e per categoria; gestire la struttura | Un giroconto con una categoria non conta come entrata o uscita | La persona decide categoria e macro dei movimenti nuovi con regole |
| Contenuto | §5 senza «Sposta in un'altra macro»; nomi delle macro nell'interfaccia (§1); `CategoryPicker` con titoli di macro; albero tolto da Settings (QC6) | §3: regola del tipo (CR3), selettore per segno (QC2), Trasferimenti senza gruppi (CR2), riga «Tra i tuoi conti», ricalcolo una tantum del tipo (§3.4), «Sposta in un'altra macro» con «Annulla», associazione delle sorgenti verso Trasferimenti, fine dell'allineamento automatico del tipo (CR8), gruppi predefiniti aggiornati (QC7) | §4: `Settings › Regole`, editor, anteprima, «Applica ai movimenti esistenti» con «Annulla», origine `rule` e segno «automatica», «Crea una regola…» da Expenses e dal dialogo dei simili, card «Regole» nel dettaglio, export |
| Git | `main` · `feat(transactions)` · nessun criterio §6 atteso **[DEV]** | Branch + PR · criterio #1 (la migrazione scrive `transactions.type` sui dati esistenti) | Branch + PR · criterio #1 |
| Migrazioni | Nessuna | Schema: nessuna. «Annulla» di «Sposta in un'altra macro» usa `category_undos` di N3: il campo `type` si aggiunge a `CategoryUndoRow` (JSON, nessuna colonna). Dati: ricalcolo una tantum di `transactions.type` (§3.4) | Additive: `category_rules` (utente, nome, ordine, attiva, condizioni JSON validate con zod, azioni), `transactions.category_rule_id` (nullable, `on delete set null`), valore `rule` nel check di `category_origin`, tabella di annullamento di «Applica» |
| Rollback | Immagine `pre-n3-2` | Immagine `pre-n3-3`; dump `n3-3.dump` (obbligatorio: è l'unico recupero del ricalcolo). L'immagine precedente legge `type` come oggi. Sui dati artificiali il ripristino del dump basta; nessun `n3-3-rollback.sql` | Immagine `pre-n3-4`; dump `n3-4.dump`. L'immagine precedente ignora tabella e colonna; il check di `category_origin` va ristretto solo dopo aver portato `rule` a `table` (`n3-4-rollback.sql`) |
| Test e gate | G1-G9. Unit: somme di gruppo e macro. Integration: totale di Uscite della pagina = testata di Expenses, stesso periodo e conti; archiviazione di un gruppo archivia i figli. E2E: pagina e dettaglio a 400 e 1440 px, due temi, tastiera | G1-G9. Unit: regola del tipo (coppia, Trasferimenti, segno, Wallet). Integration: il ricalcolo cambia solo i movimenti in disaccordo; uno spostamento tra macro cambia solo le righe di §3.5 e «Annulla» torna alla fotografia di prima; una lettura della banca non riscrive il tipo; G5 parità Overview = API = MCP dopo il ricalcolo | G1-G9. Unit: corrispondenza di ogni condizione; prima regola vince. Integration: una regola non tocca `user` né `provider`; «Applica» poi «Annulla» = fotografia uguale; una categoria da regola non addestra il modello; isolamento per utente. E2E: crea, ordina, applica, annulla con la tastiera |
| Criteri di accettazione | 1) Fotografia uguale. 2) Totale di ogni macro = testata di Expenses. 3) Ogni categoria si apre in un dettaglio con movimenti, andamento e budget. 4) Stesso `PeriodBar` di Conti e Spese. 5) Spostare tra gruppi, unire, archiviare senza perdere movimenti | 1) Al rilascio cambiano solo le righe di §3.5, per il numero di movimenti contato prima. 2) Nessun movimento in disaccordo dopo il rilascio. 3) «Annulla» di uno spostamento tra macro torna alla fotografia di prima. 4) Net e patrimonio mai cambiati. 5) Nessun movimento di una sorgente ricategorizzato | 1) Fotografia uguale al rilascio. 2) Una regola dà categoria e macro ai movimenti nuovi, con il segno «automatica». 3) Nessuna regola cambia una scelta della persona o un movimento di Wallet. 4) «Applica» ha l'anteprima e «Annulla» |
| OK di Mattia | Solo se la valutazione sul diff trova un criterio | Sì, sul SHA; eccezione §3.7 e numero dei movimenti ricalcolati | Sì, sul SHA |
| Dipende da | N3.1 | N3.2, N4 | N3.3 |
| Dimensione | M **[DEV]** | S **[DEV]** (prima M: senza «Allinea», anteprima per anno e tabella di annullamento) | L **[DEV]** |

**Rispetto al piano:**

- Fase A resta aperta finché N3.2-N3.4 non sono in produzione (se Mattia preferisce chiudere prima la fase A, i tre rilasci passano in fase B, dopo R2).
- **R2** (API completa): rotte `GET/POST/PATCH/DELETE /rules` e lettura MCP `list_rules` entrano nel passo del modulo
  `transactions`; `GET /categories` con `macro` e `groupId`.
- **R5a** (Navigazione): `Settings › Finance` ha «Categorie ed etichette» e «Regole»; «Spese › Categorie» è parte del
  modulo di base Expenses (H52). Il menu a 3 gruppi tiene «Categorie» sotto Spese.
- **R5c** (Wallet plugin): la sezione «Categorie di Wallet» va nella pagina del plugin; il selettore di §2.4 resta.
- **R5g**: nessun effetto.

## 11. Domande per Mattia

Il documento è scritto con l'opzione A di ognuna. QC3 (allineamento dello storico) è chiusa: senza dati veri non serve (§3.4).

| # | Domanda | Esempio | A (default) | B | Effetto |
|---|---|---|---|---|---|
| QC1 | Trasferimenti ha categorie? | Sposti 300 € dal conto corrente al conto deposito di un'altra banca, e 50 € sulla carta prepagata | Sì, categorie senza gruppi: «Risparmio», «Carta prepagata», più la riga fissa «Tra i tuoi conti». Vedi quanto è andato dove | Nessuna categoria: Trasferimenti è un solo insieme; un movimento si segna «giroconto» senza scegliere dove | A: più dettaglio, una scelta in più per movimento. B: più semplice; serve un pulsante «È un giroconto» e la regola ha l'azione «Solo giroconto» e basta |
| QC2 | Tra Entrate e Uscite decide il segno o la categoria? | Ricevi 40 € di rimborso da Amazon per un acquisto in «Shopping» | Il segno: il rimborso è un'entrata (esempio: Entrate › Rimborsi). Un accredito non può avere una categoria di Uscite | La categoria: il rimborso va in «Shopping» e abbassa le uscite di Shopping e il suo budget | A: numeri semplici, ma lo speso di Shopping resta 40 € più alto. B: budget più veri; cambia anche il tipo dei movimenti di Wallet e altre righe della fotografia (lista più lunga in §3.5) |
| QC4 | Le regole valgono anche per i movimenti di Wallet? | Una regola «Testo contiene ricarica → Trasferimenti» e una ricarica registrata su Wallet in «Others» | No: i movimenti di una sorgente che dà le categorie non si ricategorizzano mai (H34). Per Wallet si usa l'associazione delle categorie | Sì: la regola vince sulla categoria di Wallet, e la categoria si scrive anche su Wallet | A: H34 resta vero, nessuna scrittura su Wallet. B: cambia H34 e aggiunge scritture verso Wallet (criterio #8) |
| QC5 | Più regole corrispondono: chi decide? | «Testo contiene Amazon → Shopping» (1ª) e «Importo > 500 € → Casa» (2ª), movimento Amazon da 600 € | La prima che corrisponde, nell'ordine dell'elenco: Shopping | Tutte, in ordine: ogni regola dopo la prima riempie solo i campi ancora vuoti (etichette, nota) | A: prevedibile, si spiega in una frase. B: più potente, più difficile da capire |
| QC6 | Dove si modifica la struttura delle categorie? | Vuoi rinominare «Bollette» e spostarla da «Casa» a «Abbonamenti e servizi» | Nella pagina nuova Spese › Categorie, con il menu della riga; Settings tiene etichette, proposte di unione e gruppi predefiniti | La pagina nuova è solo da leggere; la modifica resta in Settings › Categories | A: un posto solo, vedi i numeri mentre sposti. B: meno lavoro in N3.2, ma due pagine con lo stesso albero |
| QC7 | Gruppi predefiniti per un utente nuovo con Trasferimenti | Un utente nuovo collega la banca | 11 gruppi di Uscite, 2 gruppi di Entrate («Lavoro», «Altre entrate»), 2 categorie di Trasferimenti («Risparmio», «Carta di credito») | Elenco di N3 §7 invariato (12 gruppi), Trasferimenti vuoto | A: struttura a tre livelli pronta. B: nessun cambio a N3; l'utente crea i trasferimenti a mano |
| QC8 | Una categoria con un budget passa a Trasferimenti | «Risparmio» è in Uscite con un budget di 200 € al mese | Il budget si ferma dal mese in corso; i mesi passati restano nello storico di Budgets | Lo spostamento è bloccato finché non togli il budget | A: un passo solo, il dialogo lo dice. B: più sicuro, un passo in più |

## 12. Decisioni di design prese senza conferma

| # | Decisione | Motivo |
|---|---|---|
| 1 | La macro non è un'azione separata della regola: si sceglie con la categoria | Una categoria ha una sola macro: due campi potrebbero contraddirsi |
| 2 | Condizioni solo in E logico, senza «almeno una» | Due regole sostituiscono un O; l'editor resta semplice |
| 3 | Gruppi chiusi per default, stato in `localStorage` | Con 12 gruppi e ~60 categorie la pagina aperta è troppo lunga su 400 px |
| 4 | Una macro alla volta (`Segmented`), default Uscite | La domanda più comune è «dove spendo»; le tre macro insieme su 400 px non si leggono |
| 5 | Nessun `role="tree"` | Una lista di `section` e pulsanti richiudibili si usa con Tab e Invio, senza tasti freccia da imparare |
| 6 | Righe a 0 visibili in fondo al gruppo | La pagina serve anche a gestire la struttura |
| 7 | Nessun ordine a mano delle categorie in N3.2 | Ordine per totale = la risposta a «dove va il denaro». Si aggiunge se serve |
| 8 | Max 200 regole, nessuna regex | Limite di prestazioni della cascata e dell'anteprima; la regex non è leggibile |

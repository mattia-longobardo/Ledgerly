# Impostazioni dei plugin e disattivazione di una sorgente

Specifica UX. Stato: **decisa** il 18/11/2026: Mattia ha risposto «ok default» (opzione A di Q1-Q6, decisione H55). Base: `main` a `v0.29.1`.
Piano: [`rewrite-plan.md`](rewrite-plan.md); regole dei plugin H25-H30, H51 ([`rewrite-plan/01-decisions.md`](rewrite-plan/01-decisions.md));
addon H50-H52 ([`rewrite-plan/13-plugins-addons.md`](rewrite-plan/13-plugins-addons.md)); modalità dei conti H32-H34
([`rewrite-plan/12-account-modes.md`](rewrite-plan/12-account-modes.md)).

Fuori da questo file: macro-categorie, regole automatiche e pagina delle categorie (specifica separata, stessa issue madre).

Segni: **[DEV]** = scelta tecnica da confermare con lo sviluppo. **[NUOVA]** = regola che cambia il piano, decisa con H55 (18/11/2026)
(risposte in §8).

## 0. Riepilogo

Richiesta di Mattia (17/11/2026):

> «Una volta disattivata un'integration, che in futuro diventerà un plugin, si devono cancellare e togliere tutte le
> impostazioni legate a quel plugin, e convertire le impostazioni in modo tale che all'utente non cambi niente, però non
> veda più le impostazioni legate a quel plugin.»
> «Le impostazioni legate a quel plugin devono essere trasferite all'interno del plugin: ci deve essere una pagina
> dedicata all'interno del plugin per le impostazioni, come ad esempio l'associazione di categoria di Wallet Manager.»

Proposta in 4 punti:

1. **Una pagina per sorgente** («pagina del plugin»): tutte le impostazioni di quella sorgente in un posto solo (§2).
2. **Tre azioni, tre effetti diversi**: «Scollega» chiude un collegamento e tiene le sue impostazioni; «Disattiva»
   cancella le impostazioni della sorgente e converte i dati; «Elimina il conto» cancella un conto (§3, §4).
3. **Conversione senza cambi di numeri**: alla disattivazione ogni conto diventa «a mano» con lo stesso saldo, ogni
   movimento tiene la sua categoria di Ledgerly, ogni regola resta e smette solo di scrivere sulla sorgente (§3).
4. **Correzione subito** di un difetto di oggi: «Scollega» cancella la scelta dei conti di Wallet, la pianificazione e
   la profondità dello storico. Al ricollegamento tornano anche i conti esclusi o eliminati (§1.3, rilascio N7.1).

## 1. Inventario

Fonte: codice di `main` a `v0.29.1`. Percorsi relativi alla radice del repo.

### 1.1 Impostazioni legate a una sorgente

Colonna «Va in»: **P** = pagina del plugin (impostazione della sorgente); **C** = core (dato o regola di Ledgerly, resta
alla disattivazione); **C+P** = la regola è del core, un'opzione è della sorgente.

| # | Sorgente | Impostazione (it) | Dove sta oggi | Dato | A cosa serve | Va in |
|---|---|---|---|---|---|---|
| 1 | Wallet | Token API | Settings › Integrations, `source-card.tsx` | `integration_connections.credentials` | Legge Wallet | P |
| 2 | Wallet | Scegli i conti | `source-card.tsx` (dialogo) | `sync_jobs.cursor.skipped` (`kind=accounts`) | Conti Wallet che non entrano in Ledgerly | P |
| 3 | Wallet | Storico · Scarica di nuovo (12-120 mesi) | Settings › Integrations › Avanzate, `advanced/history-depth.tsx` | `sync_jobs.cursor.backfillMonths` | Quanto storico legge | P |
| 4 | Wallet | Pianificazione | Avanzate, `ScheduleControl` | `integration_connections.schedule` | Quando legge da solo | P |
| 5 | Wallet | Categorie di Wallet (associa / aggiungi, «Nuova») | Settings › Categories, `source-categories.tsx` | `source_categories`, `source_category_undos` | Categoria di Wallet → categoria di Ledgerly (H34) | P |
| 6 | Wallet | Nomi delle categorie e delle etichette sincronizzati con Wallet | Nessuna schermata: regola della sync | `categories.provider_name`, `provider_links` (`category`) | Un nome cambiato in Ledgerly arriva su Wallet e il contrario | P (regola), C (le categorie) |
| 7 | Wallet | Regola di interessi «Pubblica ogni liquidazione su Wallet» | Interests, modulo della regola | `interest_rules.mode = post_to_provider`, `posting_category_id` | Scrive l'accredito su Wallet (fino a R5c: ST-14) | C+P |
| 8 | Wallet | Movimenti a mano «Da inviare» | Expenses, riga del movimento | `transactions.send_state` | Movimento scritto in Ledgerly che aspetta l'invio (N3.1) | C (il movimento), P (l'invio) |
| 9 | Trek | Indirizzo, ID del client, segreto | Settings › Integrations, `source-card.tsx`; anche Time Off › Impostazioni | `credentials` | Legge e scrive le ferie | P |
| 10 | Trek | Pianificazione | Avanzate; Time Off › Impostazioni | `schedule` | Quando legge da solo | P |
| 11 | Trek | Saldi di Trek (usati, residui) | Time Off | `sync_jobs.cursor` (`kind=leave`) | Cifre di Trek | P |
| 12 | Trek | Modifiche da inviare | `source-card.tsx` («{count} in attesa») | `leave_days.pending` | Giorni da scrivere o togliere su Trek | C (il giorno), P (l'invio) |
| 13 | Enable Banking | Attiva / Disattiva | Settings › Integrations, `plugin-row.tsx` | `plugin_activations` | Interruttore per utente (H25) | P |
| 14 | Enable Banking | Credenziali (ID applicazione, chiave) | `banks-card.tsx` | `plugin_user_credentials` | Applicazione dell'utente (C1c) | P |
| 15 | Enable Banking | Banche collegate e conti scelti per banca | `banks-card.tsx`, `/banks/connect` | `credentials` del collegamento (`chosen`, `skipped`, cifrati) | Quali conti della banca entrano | P |
| 16 | Enable Banking | Pianificazione (fissa: 3 al giorno) | Avanzate, sola lettura | `schedule` | — | P (sola lettura) |
| 17 | eToro, Binance | Chiavi API, pianificazione | `/investments/[id]/connection` | `credentials`, `schedule`, `investment_key_checks` | Legge il portafoglio | C (servizi collegati: restano nel core, R5c) |
| 18 | Tutte | Registro delle letture | Avanzate | `sync_runs` | Diagnosi | C (pagina Avanzate), filtrato per sorgente |
| 19 | Tutte | Origine del conto, «Sincronizzato con» / «Scollegato da» | `/accounts/[id]` | `accounts.origin`, `provider`, `provider_account_id` | Dice da dove arriva il conto | C |
| 20 | Tutte | IBAN del conto | `/accounts/[id]`, Impostazioni | `accounts.iban`, `iban_from_source` | Un IBAN, un conto (H39) | C |
| 21 | Tutte | Conto eliminato in Ledgerly: non torna alla lettura dopo | Nessuna schermata | `sync_jobs.cursor.skipped` (solo Wallet, solo con collegamento) | PERS-419 punto 3 | C **[NUOVA]**: memoria del core, non impostazione |
| 22 | Tutte | Id della sorgente per conti, movimenti, categorie | Nessuna schermata | `provider_links` | Nessun doppione a ogni lettura e al ricollegamento | C (dato tecnico, mai visibile) |

eToro e Binance restano nel core anche dopo R5c (riga R5c: «nessuna sorgente compilata nel core, salvo eToro e
Binance»). Il loro «Scollega» converte già il conto in «manuale» con lo stesso valore: è il modello che questa
specifica estende alle altre sorgenti (§3). Non hanno una pagina del plugin.

### 1.2 Cosa non è un'impostazione della sorgente

Restano nel core, senza cambi: categorie di Ledgerly, etichette, budget, salvadanai, abbonamenti, regole di interessi
(salvo l'opzione «Pubblica su {sorgente}»), fondi, giorni di Time Off, conti, saldi, movimenti. Le regole automatiche
di Ledgerly (specifica parallela) sono del core: Ledgerly non importa le regole automatiche di Wallet.

### 1.3 Difetti di oggi

| Difetto | Causa | Effetto per l'utente |
|---|---|---|
| «Scollega» Wallet cancella la scelta dei conti | `sync_jobs` si cancella a cascata con il collegamento | Al ricollegamento tornano i conti esclusi **e quelli eliminati**, con 12 mesi di movimenti |
| «Scollega» cancella pianificazione e profondità dello storico | `schedule` è sulla riga del collegamento cancellata | Al ricollegamento: pianificazione di default, storico a 12 mesi |
| «Elimina il conto» con Wallet scollegato non ricorda il conto | `skipSourceAccount` scrive solo se il collegamento esiste | Il conto torna al ricollegamento |
| «Scollega» Enable Banking perde la scelta dei conti | `chosen`/`skipped` stanno dentro le credenziali cancellate | Al ricollegamento la procedura chiede di nuovo ogni conto |
| Il dialogo di «Scollega» Wallet non dice cosa succede ai conti | Testo: «Conti e movimenti sincronizzati restano» | Non dice che al ricollegamento i conti tornano, né quali |

## 2. Pagina del plugin

### 2.1 Dove

| Periodo | Elenco | Pagina del plugin |
|---|---|---|
| Da N7.2 a R5a | Settings › Integrations, sezione «Sorgenti dei dati»: una riga per sorgente | `/settings/integrations/[source]` (`wallet`, `trek`, `enablebanking`) |
| Da R5a | Settings › Plugin (D3, H27) | `/settings/plugins/[id]`; il vecchio URL fa redirect |

- La riga dell'elenco ha: nome, stato (pallino e parola di N1 §2.2), riepilogo in una riga, freccia. Tutta la riga è un
  link alla pagina. Il pulsante «Attiva» resta sulla riga di un plugin non attivo.
- Una sorgente non attiva non ha pagina: l'URL diretto porta all'elenco, con la riga in evidenza.
- `Page` con `parent` = Integrazioni (poi Plugin). Titolo = nome della sorgente dal manifest.
- Ingressi in più: dettaglio del conto («Impostazioni di {provider}» accanto al badge dell'origine); riga del
  collegamento di N2 (voce di menu «Impostazioni»); avviso «Nuove categorie» in Expenses.

### 2.2 Sezioni

Ogni sezione è una `SettingsSection` e compare solo se la sorgente la dichiara (capacità del manifest; per Wallet e Trek
fino a R5c, una tabella nel core) **[DEV]**. Ordine fisso:

| Sezione | Contenuto | Wallet | Trek | Enable Banking | Da dove arriva |
|---|---|---|---|---|---|
| Collegamento | Righe dei collegamenti di N2 (stato, azione, menu). Credenziali: «Sostituisci» | Token | Indirizzo, client | Credenziali + una riga per banca, «Collega una banca» | Settings › Integrations |
| Conti | Elenco dei conti della sorgente con casella «In Ledgerly»; conti eliminati in fondo, «Eliminato in Ledgerly · Riprendi» | Sì | — | Sì, per banca | Dialogo «Scegli i conti», passo 2 di `/banks/connect` |
| Categorie di {provider} | La sezione di N3 §6.4, senza cambi di comportamento | Sì | — | — | Settings › Categories |
| Pianificazione | `ScheduleControl` per collegamento; testo fisso dove la sorgente lo impone | Sì | Sì | Sola lettura | Avanzate |
| Storico | «Scarica di nuovo», profondità | Sì | — | — | Avanzate |
| Scrittura sulla sorgente | Elenco in sola lettura di ciò che Ledgerly scrive: regole di interessi che pubblicano (link alla regola), movimenti «Da inviare» (link a Expenses filtrato) | Sì (fino a R5c per gli interessi) | Giorni in attesa | — | Interests, Expenses, Time Off |
| Avanzate | Link al registro filtrato `?c=<id>` | Sì | Sì | Sì | Avanzate (resta nel core) |
| Disattiva | Zona in fondo: testo dell'effetto (§3) e pulsante `danger` «Disattiva {provider}» | Sì | Sì | Sì | Menu della riga del plugin |

- Settings › Categories non mostra più «Categorie di {provider}». Al suo posto, sotto l'albero, una riga
  `text-sm text-muted`: «Le categorie di Wallet si associano nella pagina di Wallet.» + link. La riga «Da {provider}:
  {names}» sotto una categoria dell'albero resta (è una lettura, non un'impostazione) e diventa un link.
- Time Off › Impostazioni non mostra più le credenziali di Trek: link «Impostazioni di Trek».
- Il modulo della regola di interessi mostra l'opzione «Pubblica su {provider}» solo se la sorgente del conto è attiva e
  dichiara la scrittura. Senza: l'opzione non si disegna (nessun controllo disattivato).

### 2.3 Stati della pagina

| Stato | Vista |
|---|---|
| Attiva, nessun collegamento | Solo «Collegamento» con l'invito («Collega Wallet», «Collega una banca») e «Disattiva». Le altre sezioni non si disegnano |
| Attiva, collegata | Tutte le sezioni dichiarate |
| Attiva, collegamento scollegato (§4.1) | «Collegamento» con «Ricollega». «Conti», «Categorie», «Pianificazione» restano leggibili e modificabili: valgono al ricollegamento. Riga sopra: «Scollegato dal {date}. Le impostazioni restano per quando ricolleghi.» |
| Caricamento | Rende il server; nessuno scheletro. Azioni con `useTransition` |
| Errore di una sezione | `role="alert"` sotto la sezione: «Non è stato possibile caricare questa parte. Riprova.» Le altre sezioni restano |
| Plugin che non risponde | Le sezioni con dati salvati nel core si disegnano. «Conti» (elenco dal vivo) mostra `plugin_down` di N1 §7 |

### 2.4 Layout

1440 px, tema chiaro e scuro con i token di oggi (`bg-surface`, `border-border`, `text-muted`, `bg-pos`, `bg-faint`,
`danger`): nessun colore nuovo. Colonna sinistra con titolo e descrizione, card a destra, come Settings di oggi.

```text
← Integrazioni
Wallet                                                        ● Collegato
──────────────────────────────────────────────────────────────────────────────
Collegamento          ┌──────────────────────────────────────────────────────┐
Token di Wallet e     │ ● Wallet  Aggiornato · 10 min fa         [Aggiorna]⋯ │
stato della lettura.  └──────────────────────────────────────────────────────┘
Conti                 ┌──────────────────────────────────────────────────────┐
Quali conti di Wallet │ [x] Conto corrente        → Conto corrente           │
entrano in Ledgerly.  │ [ ] Carta prepagata         Non in Ledgerly          │
                      │ Eliminati in Ledgerly                                │
                      │     Revolut Savings         [Riprendi]               │
                      └──────────────────────────────────────────────────────┘
Categorie di Wallet   ┌──────────────────────────────────────────────────────┐
                      │ (sezione di N3 §6.4)                                  │
                      └──────────────────────────────────────────────────────┘
Pianificazione · Storico · Scrittura su Wallet · Avanzate
Disattiva Wallet      ┌──────────────────────────────────────────────────────┐
                      │ I conti diventano «a mano», con lo stesso saldo…     │
                      │                                 [Disattiva Wallet]   │
                      └──────────────────────────────────────────────────────┘
```

400 px: una colonna; titolo della sezione sopra la card; righe dei conti a scheda (casella e nome sopra, conto di
Ledgerly sotto); pulsanti a tutta larghezza; nessuno scorrimento orizzontale; margine laterale 16 px.

```text
┌──────────────────────────────┐
│ ← Integrazioni               │
│ Wallet          ● Collegato  │
│ Collegamento                 │
│ ┌──────────────────────────┐ │
│ │ ● Wallet  Aggiornato     │ │
│ │ [Aggiorna]           [⋯] │ │
│ └──────────────────────────┘ │
│ Conti                        │
│ ┌──────────────────────────┐ │
│ │ [x] Conto corrente       │ │
│ │     → Conto corrente     │ │
│ └──────────────────────────┘ │
│ [   Disattiva Wallet     ]   │
└──────────────────────────────┘
```

## 3. Disattivazione **[NUOVA]**

Sostituisce (H55) H30 («alla disattivazione le credenziali e l'accesso alle banche restano cifrati nel core») e lo stato
«In pausa» di un plugin disattivato (N2 §3.4).

### 3.1 Regola

**Disattiva = scollega tutto + cancella le impostazioni della sorgente + converte i dati nel core.** Dopo, nessuna
schermata mostra la sorgente, salvo la sua riga «Non attivo» nell'elenco. Nessun numero cambia: la fotografia dei
numeri (Overview, Accounts, Expenses, Budgets, patrimonio, API, MCP) è uguale prima e dopo.

Resta nel core, nascosto e mai visibile, solo `provider_links` con gli id della sorgente (riga 22): serve a non creare
doppioni se la persona riattiva. Non è un'impostazione: nessuna schermata lo mostra (Q2).

### 3.2 Un caso per ogni tipo di impostazione

| Tipo | Si cancella | Si converte in | Esempio | Numeri |
|---|---|---|---|---|
| Credenziali (righe 1, 9, 14) | Token, client, chiave Enable Banking. Per una banca: l'accesso si chiude anche sulla banca, come «Scollega» | — | Disattivi Enable Banking: la chiave sparisce; per riattivare la reinserisci | Nessun effetto |
| Collegamenti e registro (righe 15, 18) | Righe dei collegamenti, `sync_jobs`, registro | — | Il registro di Wallet sparisce da Avanzate | Nessun effetto |
| Pianificazione, storico (3, 4, 10, 16) | Sì | — | — | Nessun effetto |
| Conti della sorgente (19) | Il legame «sincronizzato» | **Conto «a mano»** (H32): saldo di oggi = ultimo saldo letto. Nome, tipo, gruppo, IBAN, movimenti restano | «Conto corrente» da Wallet, 1.240,50 €: dopo è un conto «a mano» con 1.240,50 €. Puoi scrivere movimenti a mano e il saldo cambia (H33) | Saldo uguale |
| Conti esclusi (2, 15) | La scelta | — (un conto escluso non è in Ledgerly) | «Carta prepagata» esclusa: non esiste in Ledgerly prima né dopo | Nessun effetto |
| Conti eliminati in Ledgerly (21) | — | Resta una memoria del core: «conto della sorgente eliminato». Alla riattivazione il conto non torna | Hai eliminato «Revolut Savings»: anche dopo una riattivazione non torna da solo | Nessun effetto |
| Categorie di {provider} (5) | La sezione e la corrispondenza | Ogni movimento tiene la sua categoria di Ledgerly (`transactions.category_id` è già scritto). Una categoria «aggiunta» è già una categoria di Ledgerly e resta. Il segno «Nuova» sparisce. La riga «Da Wallet: …» sparisce dall'albero | «Groceries» (310 movimenti) associata a «Spesa alimentare»: i 310 movimenti restano in «Spesa alimentare». «Pets» aggiunta resta la categoria «Pets» | Expenses e Budgets uguali |
| Nomi sincronizzati (6) | La sync dei nomi | Le categorie e le etichette restano con il nome di oggi. Da qui un cambio di nome resta solo in Ledgerly | — | Nessun effetto |
| Regola di interessi che pubblica (7) | L'opzione «Pubblica su Wallet» | La regola passa a «solo calcolo» (`analyze_only`). Calcoli e storico restano. Le liquidazioni non ancora pubblicate restano con lo stato «Non pubblicata» | Regola 2,5% sul conto deposito: continua a calcolare; l'accredito lo scrivi a mano o arriva dalla banca | Interessi calcolati uguali |
| Movimenti «Da inviare» (8) | Lo stato dell'invio | Movimento a mano del conto «a mano» (H33): il saldo li contiene già | 2 spese scritte in Ledgerly e non ancora su Wallet: restano 2 movimenti a mano; non arrivano su Wallet | Saldo uguale |
| Giorni di Trek (12) | Credenziali, pianificazione, saldi di Trek, modifiche in attesa | I giorni restano giorni di Time Off di Ledgerly. Le modifiche in attesa non arrivano su Trek: il dialogo le conta prima | 3 giorni di ferie prenotati da Trek: restano nel calendario e nel residuo | Residuo di Ledgerly uguale; i saldi di Trek non si mostrano più |
| Plugin (13) | Attivazione | Riga «Non attivo» con «Attiva» | — | — |

Ordine dei passi **[DEV]**: 1) una lettura finale e l'invio dei movimenti «Da inviare», se il collegamento risponde
(massimo 30 s; se fallisce, si continua); 2) conversione dei dati in una transazione; 3) chiusura degli accessi
esterni; 4) cancellazione delle impostazioni. Un errore nel passo 2 annulla tutto: la sorgente resta attiva.

### 3.3 Dialogo «Disattiva {provider}»

`Modal` 480. Il dialogo legge i conteggi dal server prima di aprirsi.

- Titolo: «Disattivare {provider}?»
- Testo: «{provider} smette di aggiornare Ledgerly e le sue impostazioni si cancellano. I tuoi numeri non cambiano.»
- Elenco «Cosa succede» (solo le righe con un conteggio > 0):
  - «{count} conti diventano “a mano”, con lo stesso saldo.»
  - «{count} categorie di {provider} restano come categorie di Ledgerly.»
  - «{count} regole di interessi smettono di pubblicare su {provider}.»
  - «{count} movimenti non ancora inviati restano solo in Ledgerly.»
  - «{count} modifiche ai giorni non arrivano su {provider}.»
  - «Le credenziali si cancellano: per riattivare le inserisci di nuovo.»
- Pulsanti: «Annulla», «Disattiva {provider}» (`danger`). Nessun campo da scrivere: l'azione non cancella dati di
  Ledgerly.
- Durante l'azione: pulsanti `disabled`, `aria-busy="true"`, testo «Disattivazione in corso…».
- Esito: redirect all'elenco; toast «{provider} disattivato: {count} conti ora sono “a mano”».
- Errore: `role="alert"` nel dialogo, «Non è stato possibile disattivare. Non è cambiato niente. Riprova.»

### 3.4 Riattivazione

| Cosa | Comportamento (con Q2 = A) |
|---|---|
| Plugin | «Attiva» come oggi. La pagina parte vuota: «Collegamento» chiede le credenziali |
| Conti | Al primo collegamento il core riconosce i conti dagli id di `provider_links`. Un conto «a mano» che era della sorgente torna «sincronizzato». Dalla prima lettura vale il saldo della sorgente; i movimenti a mano scritti nel frattempo restano, come su un conto «sola lettura» (H33). Esito: «{count} conti tornano da {provider}» |
| Conti eliminati | Non tornano. Sono nella sezione «Conti», in fondo, con «Riprendi» |
| Scelta dei conti | Si sceglie di nuovo: i conti già in Ledgerly sono selezionati, i conti nuovi no |
| Categorie | La corrispondenza riparte: ogni categoria della sorgente già vista torna con la categoria di Ledgerly dei suoi movimenti; le categorie mai viste entrano come «aggiunta», segno «Nuova» (H35, punto 11) |
| Regole di interessi | Restano «solo calcolo». La persona riattiva la pubblicazione nella regola |
| Pianificazione | Quella consigliata dal fornitore (H31, Q5) |

## 4. Legame con le altre azioni

### 4.1 Tre azioni

| | Scollega | Disattiva | Elimina il conto |
|---|---|---|---|
| Su cosa | Un collegamento (un token Wallet, una banca) | Una sorgente intera | Un conto |
| Dove | Riga del collegamento (pagina del plugin, N2) | Fondo della pagina del plugin | Dettaglio del conto, Zona pericolosa |
| Accesso alla sorgente | Chiuso | Chiuso, per tutti i collegamenti | Il conto esce dai conti scelti |
| Impostazioni del collegamento (conti scelti, pianificazione, storico) | **Restano [NUOVA]**: valgono al ricollegamento | Cancellate | La scelta toglie il conto |
| Conti | Restano «Scollegati», legati alla sorgente (N1 §5.4) | Diventano «a mano» | Cancellato con i movimenti |
| Categorie della sorgente | Restano, visibili | Convertite (§3.2) | Nessun effetto |
| Numeri | Uguali | Uguali | Cambiano: il conto non c'è più (il dialogo lo dice) |
| Ricollegare / riattivare | Ogni conto torna al suo posto, con la stessa scelta | §3.4 | Il conto non torna; «Riprendi» nella pagina del plugin |

### 4.2 Testo di «Scollega» (correzione del difetto di oggi)

Wallet, oggi: «Il token viene eliminato. Conti e movimenti sincronizzati restano, e non vengono più aggiornati.»
Proposta, uguale per ogni sorgente con conti:

- Titolo: «Scollegare {name}?»
- Testo: «L'accesso a {name} si chiude. I {count} conti restano in Ledgerly come “Scollegati”, con saldi e movimenti, e
  non si aggiornano più. La scelta dei conti e la pianificazione restano: se ricolleghi, ogni conto torna al suo posto.»
- Con conti esclusi, riga in più: «{count} conti esclusi restano esclusi.»
- Righe di N4 sul passaggio: restano.
- Per smettere del tutto, sotto: link «Vuoi smettere di usare {provider}? Disattivalo» (porta alla zona «Disattiva»).

### 4.3 «Elimina il conto»

Comportamento di PERS-419 e PERS-421, con una correzione: la memoria «conto della sorgente eliminato» è del core e non
dipende dal collegamento (riga 21). Un conto eliminato con la sorgente scollegata, disattivata o riattivata non torna.
Il dialogo di oggi resta; la riga sulla sorgente diventa: «{provider} non lo legge più. Per riprenderlo: Impostazioni di
{provider} › Conti.»

## 5. Tastiera e accessibilità (WCAG 2.2 AA)

- Ordine del focus = ordine delle sezioni. Ogni sezione ha un titolo `h2`; la pagina ha un `h1`.
- Riga dell'elenco: un solo elemento focalizzabile (il link); «Attiva» è un pulsante a parte, dopo il link.
- Casella «In Ledgerly»: `label` con il nome del conto; il conto di Ledgerly è nella descrizione (`aria-describedby`).
- Dialogo «Disattiva»: focus iniziale su «Annulla»; Esc chiude; il focus torna al pulsante che lo ha aperto. L'elenco
  «Cosa succede» è una `ul` letta dentro `aria-describedby` del dialogo.
- Esiti: toast con `role="status"`; errori con `role="alert"`.
- Bersagli ≥ 24 px (pulsanti `sm` di oggi: 32 px). Contrasto dei token esistenti già verificato nei due temi (N1 §8).
- Nessuna animazione nuova; `prefers-reduced-motion` come oggi.

## 6. Testi e chiavi di traduzione

Spazio `settings.plugin` (nuovo). Solo le chiavi nuove; le altre restano.

| Chiave | it | en |
|---|---|---|
| `page.back` | Integrazioni | Integrations |
| `sections.connection` | Collegamento | Connection |
| `sections.accounts` | Conti | Accounts |
| `sections.accountsHint` | Quali conti di {provider} entrano in Ledgerly. | Which {provider} accounts come into Ledgerly. |
| `sections.schedule` | Pianificazione | Schedule |
| `sections.history` | Storico | History |
| `sections.writes` | Scrittura su {provider} | Writing to {provider} |
| `sections.advanced` | Avanzate | Advanced |
| `accounts.deleted` | Eliminati in Ledgerly | Deleted in Ledgerly |
| `accounts.resume` | Riprendi | Bring back |
| `disconnected.note` | Scollegato dal {date}. Le impostazioni restano per quando ricolleghi. | Disconnected since {date}. The settings stay for when you connect again. |
| `deactivate.title` | Disattivare {provider}? | Turn off {provider}? |
| `deactivate.body` | {provider} smette di aggiornare Ledgerly e le sue impostazioni si cancellano. I tuoi numeri non cambiano. | {provider} stops updating Ledgerly and its settings are deleted. Your numbers do not change. |
| `deactivate.accounts` | {count, plural, one {# conto diventa “a mano”, con lo stesso saldo.} other {# conti diventano “a mano”, con lo stesso saldo.}} | {count, plural, one {# account becomes “manual”, with the same balance.} other {# accounts become “manual”, with the same balance.}} |
| `deactivate.categories` | {count, plural, one {# categoria di {provider} resta come categoria di Ledgerly.} other {# categorie di {provider} restano come categorie di Ledgerly.}} | {count, plural, one {# {provider} category stays as a Ledgerly category.} other {# {provider} categories stay as Ledgerly categories.}} |
| `deactivate.rules` | {count, plural, one {# regola di interessi smette di pubblicare su {provider}.} other {# regole di interessi smettono di pubblicare su {provider}.}} | {count, plural, one {# interest rule stops posting to {provider}.} other {# interest rules stop posting to {provider}.}} |
| `deactivate.unsent` | {count, plural, one {# movimento non ancora inviato resta solo in Ledgerly.} other {# movimenti non ancora inviati restano solo in Ledgerly.}} | {count, plural, one {# transaction not sent yet stays only in Ledgerly.} other {# transactions not sent yet stay only in Ledgerly.}} |
| `deactivate.pendingDays` | {count, plural, one {# modifica ai giorni non arriva su {provider}.} other {# modifiche ai giorni non arrivano su {provider}.}} | {count, plural, one {# change to your days does not reach {provider}.} other {# changes to your days do not reach {provider}.}} |
| `deactivate.credentials` | Le credenziali si cancellano: per riattivare le inserisci di nuovo. | The credentials are deleted: to turn it on again, enter them again. |
| `deactivate.confirm` | Disattiva {provider} | Turn off {provider} |
| `deactivate.cancel` | Annulla | Cancel |
| `deactivate.busy` | Disattivazione in corso… | Turning off… |
| `deactivate.done` | {provider} disattivato: {count, plural, one {# conto ora è “a mano”} other {# conti ora sono “a mano”}} | {provider} turned off: {count, plural, one {# account is now “manual”} other {# accounts are now “manual”}} |
| `deactivate.failed` | Non è stato possibile disattivare. Non è cambiato niente. Riprova. | Could not turn it off. Nothing changed. Try again. |
| `reactivate.back` | {count, plural, one {# conto torna da {provider}} other {# conti tornano da {provider}}} | {count, plural, one {# account comes back from {provider}} other {# accounts come back from {provider}}} |
| `categories.movedHint` | Le categorie di {provider} si associano nella pagina di {provider}. | {provider} categories are matched on the {provider} page. |
| `disconnect.body` | L'accesso a {name} si chiude. {count, plural, one {Il conto resta} other {I # conti restano}} in Ledgerly come “Scollegati”, con saldi e movimenti, e non si aggiornano più. La scelta dei conti e la pianificazione restano: se ricolleghi, ogni conto torna al suo posto. | Access to {name} is closed. {count, plural, one {The account stays} other {The # accounts stay}} in Ledgerly as “Disconnected”, with balances and transactions, and stop updating. The account choice and the schedule stay: if you connect again, each account goes back to its place. |
| `disconnect.excluded` | {count, plural, one {# conto escluso resta escluso.} other {# conti esclusi restano esclusi.}} | {count, plural, one {# excluded account stays excluded.} other {# excluded accounts stay excluded.}} |
| `disconnect.toDeactivate` | Vuoi smettere di usare {provider}? Disattivalo | Want to stop using {provider}? Turn it off |

Glossario: «Disattiva» (sorgente) e «Scollega» (collegamento) sono due parole diverse e non si scambiano.

## 7. Rilasci (H55)

Le dimensioni e le migrazioni sono stime **[DEV]**. Rilascio **N7**, nella fase A, in tre parti con un OK ognuna (Q5 A).

| Parte | Contenuto | Migrazioni | Criteri §6 attesi | Git | Dimensione |
|---|---|---|---|---|---|
| **N7.1 · «Scollega» tiene le impostazioni** (correzione, subito dopo PERS-421) | Conti scelti, pianificazione, profondità dello storico e memoria dei conti eliminati fuori dalla cascata del collegamento: un collegamento «scollegato» resta come riga senza credenziali **[DEV]: riga con stato `disconnected` oppure tabella delle impostazioni per `(user, provider, instance_key)`**. Memoria «conto della sorgente eliminato» nel core, per ogni sorgente. Testi nuovi di «Scollega» (§4.2) | Additiva + copia dei dati (`skipped` → posto nuovo) | #1 | Branch + PR | S |
| **N7.2 · Pagina del plugin** | `/settings/integrations/[source]` con le sezioni di §2.2; elenco a righe; «Categorie di {provider}» spostata; credenziali di Trek tolte da Time Off; opzione di pubblicazione condizionata. Nessun cambio di comportamento | Nessuna | Nessuno atteso | `main` | M |
| **N7.3 · «Disattiva» con conversione** | §3 per Wallet, Trek, Enable Banking: dialogo con conteggi, conversione in una transazione, riattivazione con riconoscimento dei conti (§3.4). Wallet e Trek ricevono «Disattiva» come Enable Banking (oggi hanno solo «Scollega») | Possibile colonna di stato del plugin per le sorgenti del core; nessuna rimozione | #1 (job che scrive dati), #8 (chiude accessi su servizi esterni) | Branch + PR | M |

Scelte di sviluppo di N7.3 (le voci **[DEV]** di §3):

- Ordine: 1) lettura finale di ogni collegamento (30 s; un errore non ferma, una lettura ancora in corso dopo 30 s
  sì: «Non è cambiato niente», perché scriverebbe conti e movimenti durante la conversione); 2) e 4) in una sola
  transazione (conversione e cancellazione delle impostazioni); 3) chiusura degli accessi alla banca dopo la
  transazione, con le credenziali lette prima. Un errore nella transazione annulla tutto.
- Nessuna colonna di stato per Wallet e Trek: «attiva» = ha un collegamento. Dopo «Disattiva» la pagina parte vuota
  («Collega Wallet»), come §2.3 «Attiva, nessun collegamento».
- Conto convertito: `origin = manual`, `provider` e `provider_account_id` vuoti; l'id della sorgente resta in
  `provider_links` (`entity_type = account`). Il primo collegamento dopo la riattivazione (`connectWalletAction`,
  ritorno della banca) rilega i conti (`restoreSourceAccounts`).
- `source_skipped_accounts.reason`: `excluded` (si cancella alla disattivazione) o `deleted` (resta, con il nome del
  conto, per «Riprendi»).

Test attesi (per `test-policy`): integration «scollega → ricollega = stessi conti, stessa scelta, stessa pianificazione»;
«elimina con sorgente scollegata → ricollega: il conto non torna»; «disattiva → fotografia dei numeri uguale» per ogni
sorgente; «disattiva → riattiva: nessun doppione di conti e movimenti»; conversione annullata se un passo fallisce;
e2e della pagina del plugin a 400 e 1440 px nei due temi.

Posto nel piano:

```text
N4 (in produzione) ─► N7.1 ─► N7.2 ─► N7.3 ─► R0
```

- N7.1 può partire subito: corregge un difetto in produzione e non dipende da N7.2.
- **R5a**: il tab Plugin (D3) riusa la pagina di N7.2 e cambia solo l'URL. «Categorie di {sorgente}» non va nel tab
  Finance (riga R5a di `12-account-modes.md` §12.5): resta nella pagina del plugin.
- **R5c**: Wallet e Trek diventano plugin con pagina e «Disattiva» già pronti. Da R5c: la regola H30 «attivi
  da subito per chi ha già un collegamento» resta; il resto di H30 è sostituito da §3 (H55). R5c diventa più
  piccolo: le schermate esistono già.
- **N2** (in produzione): lo stato «In pausa» di un plugin disattivato non serve più (H55): dopo la disattivazione
  non esistono collegamenti da mostrare.

## 8. Domande: decise (H55, «ok default» del 18/11/2026)

| # | Domanda | Esempio | A (scelta) | B (scartata) | Effetto |
|---|---|---|---|---|---|
| Q1 | «Disattiva» cancella le impostazioni, come hai chiesto? Questo sostituisce H30 | Disattivi Enable Banking con 2 banche collegate | Sì: chiude gli accessi, cancella chiave e impostazioni, converte i conti in «a mano». Per riattivare reinserisci la chiave e ricolleghi le banche | No: «Disattiva» resta una pausa (H30, tutto salvato e nascosto); serve un'azione in più «Disattiva e cancella» | A: un'azione sola, niente di nascosto che resta. B: riattivi con un clic, ma restano dati che non vedi e due pulsanti da capire |
| Q2 | Alla riattivazione i vecchi conti tornano da soli? | Riattivi Wallet dopo 2 mesi; nel frattempo hai scritto 5 movimenti a mano sul «Conto corrente» | Sì: Ledgerly tiene solo gli id tecnici (mai visibili) e lega di nuovo ogni conto; i 5 movimenti restano a mano, il saldo dalla prima lettura è quello di Wallet | No: si cancella anche questo; al ricollegamento i conti arrivano nuovi e li unisci con «È lo stesso conto di…» (N4) | A: nessun doppione, nessun lavoro. B: pulizia totale, ma doppioni da unire a mano |
| Q3 | Dopo la disattivazione i conti diventano «a mano»? | Disattivi Wallet; vuoi segnare una spesa in contanti sul «Conto corrente» | Sì: conto «a mano», puoi scrivere movimenti e il saldo cambia (H33) | No: restano «Scollegati», fermi, come dopo «Scollega» | A: il conto resta utile. B: il conto è fermo finché non riattivi o lo converti tu |
| Q4 | «Scollega» tiene la scelta dei conti e la pianificazione? | Scolleghi Wallet per cambiare il token e ricolleghi | Sì: al ricollegamento tutto è come prima (N7.1) | No: come oggi, si ricomincia; i conti esclusi tornano | A: corregge il difetto di PERS-413. B: nessuna migrazione, ma il difetto resta |
| Q5 | La pagina del plugin arriva prima di R5a? | Vuoi associare le categorie di Wallet da un posto solo | Sì: N7.2 nella fase A, dopo N4; R5a cambia solo l'URL | No: solo N7.1 ora; pagina e «Disattiva» entrano in R5a e R5c | A: lo vedi subito; R5c più piccolo. B: la fase A non si allunga; il difetto delle impostazioni sparse resta fino a R5 |
| Q6 | Le regole di interessi che pubblicano su Wallet tornano a pubblicare alla riattivazione? | Regola 2,5% con «Pubblica su Wallet»; disattivi e riattivi | No: restano «solo calcolo»; le riattivi tu nella regola | Sì: tornano a pubblicare da sole | A: niente scrive su Wallet senza una tua scelta. B: un passo in meno. Con R5c la pubblicazione finisce comunque (ST-14) |

Mattia ha risposto «ok default» il 18/11/2026: vale la colonna A di ogni riga.

# N4 · Specifica UX: passaggio di un conto da una sorgente alla banca

Indice del piano: [`../../rewrite-plan.md`](../../rewrite-plan.md). Rilascio: [`../03-releases.md`](../03-releases.md) «N4» e «N3.1».
Regole tecniche: [`../04-now.md`](../04-now.md) §4.6. Modalità dei conti: [`../12-account-modes.md`](../12-account-modes.md) §12.1 e §12.5.
Decisioni: [`../01-decisions.md`](../01-decisions.md) C2, S1, H32, H37, H38. Specifiche precedenti:
[`n1-plugin-bank.md`](n1-plugin-bank.md) §6.4 e §11, [`n2-connection-status.md`](n2-connection-status.md) §3, [`n3-categories-manual.md`](n3-categories-manual.md) §9.8.

Questa specifica descrive solo l'interfaccia. Il piano ha priorità: se un punto è in conflitto con il piano, vale il piano.
La regola che decide quali movimenti sono gli stessi, i suoi numeri e la tolleranza del saldo sono del dominio: qui non sono descritti e non cambiano.

Versione del 16/11/2026. Le decisioni di prodotto che il piano non scrive sono in §17, «Domande per Mattia»: **6 domande aperte**.
Il testo applica l'opzione A (default) di ogni domanda. I dati negli esempi sono inventati.

## 0. Riepilogo

| Voce del «Contenuto» di N4 | Dove | Sezione |
|---|---|---|
| Scelta «È lo stesso conto di…» nella procedura della banca | `/banks/connect`, passo «Conti» ed esito | §2.1 |
| Ingresso da un conto che esiste già | `/accounts/[id]`, scheda Impostazioni, «Origine dei dati» | §2.2 |
| Un conto per volta | Pagina `/accounts/[id]/switch` | §3 |
| Movimenti a mano non inviati (H38) | Passo «Prova», blocco in alto | §5 |
| Prova obbligatoria e rapporto | Passo «Prova» | §6 |
| Controllo del saldo bloccante, tipo di saldo per banca | Passo «Prova», card «Saldo» | §7 |
| «Applica» | Dialogo di conferma, attesa, esito | §8 |
| Dopo il passaggio: conto, riga del collegamento, giroconti, interessi | Conto, `Settings › Integrations`, `Expenses`, `Interests` | §9 |
| La sorgente di partenza salta i conti passati | Nessuna schermata propria: effetto in §9.2 | §9.2 |
| «Annulla passaggio» | `/accounts/[id]`, «Origine dei dati»; esito del passaggio | §10 |
| Stati: vuoto, caricamento, errore, rapporto lungo | Tabella unica | §11 |
| Layout a 400 e 1440 px, due temi | — | §12 |
| Tastiera e accessibilità | — | §13 |
| Testi (it, en) e chiavi | — | §14 |

Fuori da questa specifica: la regola di abbinamento e i suoi numeri (dominio, `04-now.md` §4.6); l'invio dei movimenti a mano (N3.1);
il plugin della sorgente di partenza (R5c).

## 1. Regole generali

### 1.1 Parole

Una parola per un significato, uguale in pulsante, titolo e toast.

| Parola nell'interfaccia | Significato | Parola del piano (mai nell'interfaccia) |
|---|---|---|
| **Passare un conto alla banca** | Da ora saldo e movimenti del conto arrivano dalla banca, non più dalla sorgente di prima | passaggio, cambio di `provider` |
| **Prova** | Ledgerly confronta le due sorgenti e mostra il risultato. Non cambia niente | prova a secco |
| **Rapporto** | Il risultato della prova | rapporto della prova a secco |
| **Trovati in tutte e due** | Movimenti che Ledgerly riconosce come gli stessi nelle due sorgenti | abbinati |
| **Da controllare** | Movimenti con lo stesso importo, in numero diverso nelle due sorgenti. Ledgerly non ne collega nessuno | gruppo con conteggi diversi |
| **Solo su {source}** | Movimenti della sorgente di partenza che la banca non ha | solo Wallet |
| **Solo in banca** | Movimenti della banca, nel periodo del confronto, che la sorgente di partenza non ha | — |
| **Nuovi dalla banca** | Movimenti della banca dopo l'ultimo giorno letto dalla sorgente di partenza | nuovi dopo il taglio |
| **Applica** | Fa il passaggio | — |
| **Annulla passaggio** | Riporta il conto alla sorgente di prima | annullamento |

Parole vietate nella vista normale: «abbinamento», «abbinamento per gruppi», «gruppo», «conteggio», «M1», «prova a secco», «data di taglio»,
«taglio», «link esterno», «provider», «sorgente» come nome di campo, «sync», «plugin», «CLBD», «XPCD», «OPBD», «hash». Valgono anche le liste di
`n2-connection-status.md` §1.2 e `n3-categories-manual.md` §1.1.

Parametri dei testi. Nessun testo del core contiene un nome di fornitore (regola M14):

| Parametro | Valore | Esempio in questo documento |
|---|---|---|
| `{account}` | Nome del conto in Ledgerly | «Conto corrente» |
| `{source}` | Nome della sorgente di partenza, dal descrittore del fornitore | «Wallet» |
| `{bank}` | Nome della banca del collegamento | «Banca Esempio» |
| `{provider}` | Nome del fornitore del collegamento della banca, dal manifest | «Enable Banking» |

### 1.2 Regole che l'interfaccia rispetta

| Regola | Fonte | Effetto sull'interfaccia |
|---|---|---|
| La prova non scrive nulla | Criterio 1 di N4 | La scelta del conto, la prova e il rapporto non si salvano. Stanno nell'URL e nella risposta della richiesta (§3, §6.6) |
| Con conteggi diversi nessun movimento si collega | Criterio 2 | Sezione «Da controllare», senza azioni di collegamento (§6.4) |
| Una differenza di saldo blocca | Criterio 3 | Nessun pulsante «Applica» e nessuna forzatura (§7) |
| Dopo il passaggio il saldo della banca è uguale al saldo locale | Criterio 4 | Controllo nell'esito (§8.3) |
| Dopo «Annulla passaggio» i numeri sono quelli di prima | Criterio 5 | Testo del dialogo e effetti di §10 |
| Prima l'invio dei movimenti a mano, poi il passaggio | H38 | Blocco di §5 |
| Un conto per volta | Contenuto di N4 | Una pagina per un conto. Una sola applicazione in corso per utente (§3.3) |
| Nessuna riga di movimento cancellata | `04-now.md` §4.6, «Rollback» di N4 | Nessun testo promette o minaccia una cancellazione |

### 1.3 Componenti e token esistenti

Nessun componente nuovo in `src/ui`, nessun token nuovo, nessuna libreria nuova. Valgono le tabelle di `n1-plugin-bank.md` §1.4,
`n2-connection-status.md` §1.3 e `n3-categories-manual.md` §1.4. Per N4:

| Bisogno | Componente esistente |
|---|---|
| Pagina del passaggio | `Page` con `parent` (`src/ui/shell/page.tsx`) |
| Passi | `StepIndicator` (`src/ui/step-indicator.tsx`) |
| Scelta nella procedura della banca | `Select` con `<optgroup>` in `accounts-step.tsx` |
| Card del rapporto e del saldo | `Card`, `CardHeader`, `CardFooter` |
| Righe dei movimenti | `Table`, `THead`, `Th`, `TBody`, `Tr`, `Td`; lista `<ul>` sotto 768 px, come `transactions-table.tsx` |
| Apri e chiudi una sezione | `<button aria-expanded aria-controls>` con le classi di `LinkButton` e `ChevronDown` (come la cronologia di N2 §4) |
| Conteggi e stati | `Badge` (`pos`, `warn`, `neg`, `neutral`) |
| Avviso e blocco | `rounded-ctl bg-warn-bg px-3 py-2 text-sm text-warn`; blocco: `rounded-ctl bg-neg-bg px-3 py-2 text-sm text-neg` (`accounts-step.tsx`) |
| Nota informativa | `rounded-ctl bg-hover px-3 py-2 text-sm` |
| Attesa | `ProgressBar` con `dashed`; `Skeleton` |
| Vuoto, errore | `EmptyState`, `ErrorState` |
| Dialoghi | `Modal` (`width` 460) |
| Pulsanti | `Button` (`primary`, `secondary`, `danger`), `ButtonLink`, `LinkButton` |
| Sezione «Origine dei dati» del conto | `SettingsSection` in `settings-form.tsx` (esiste già) |
| Stato del collegamento sul conto | Forma compatta di `ConnectionRow` (N2 §3.3) |
| Conferma | `notify()` |
| Importi e date | `formatMoney`, `formatDate`; rispettano «Nascondi importi» |

Componenti nuovi, nel modulo `accounts` (`src/modules/accounts/ui/switch/`), client senza lettura dati propria:

| Componente | Cosa fa | Sezione |
|---|---|---|
| `SwitchAccountStep` | Scelta del conto della banca | §4 |
| `SwitchReport` | Rapporto: riepilogo e sezioni | §6 |
| `SwitchBalanceCard` | Confronto dei saldi e blocco | §7 |
| `SwitchUnsentCard` | Movimenti a mano non inviati | §5 |
| `SwitchOutcome` | Esito | §8.3 |
| `UndoSwitchDialog` | Conferma di «Annulla passaggio» | §10 |

## 2. Ingressi

### 2.1 «È lo stesso conto di…» nella procedura della banca

Punto di aggancio: `n1-plugin-bank.md` §6.4 e §11. Il `Select` «In Ledgerly» di ogni conto della banca ha un gruppo in più.

```text
In Ledgerly
[Crea un conto nuovo                              ▾]
   Crea un conto nuovo
   ── Usa un conto esistente ──
   Usa «Contanti»
   ── È lo stesso conto di… ──
   Conto corrente · Wallet
   Non importare
```

| Tema | Regola |
|---|---|
| Gruppo | `<optgroup label="È lo stesso conto di…">`, dopo «Usa un conto esistente» e prima di «Non importare» |
| Conti nel gruppo | Conti dell'utente che ricevono saldo e movimenti da una sorgente diversa da quella di questo collegamento; non archiviati; non di investimento; stessa valuta del conto della banca. La regola non contiene nomi di fornitore |
| Testo dell'opzione | «{account} · {source}» |
| Gruppo vuoto | Non compare |
| Default | Resta «Crea un conto nuovo». Ledgerly non propone da solo un conto uguale |
| Nota sotto il `Select` | `text-sm text-muted`: «Questo conto non viene importato ora. Dopo questo passo Ledgerly confronta {source} e la banca e ti mostra il risultato. Niente cambia finché non scegli «Applica».» |
| Stesso conto scelto due volte | Errore esistente `accounts.duplicate` |
| Più conti con questa scelta | Permesso. Ogni conto ha la sua prova e la sua applicazione, una per volta (§3.3) |
| Pulsante «Importa {count}» | Conta solo i conti che si importano ora. Con solo conti «È lo stesso conto di…» il testo è «Continua» |
| Tempo | L'avviso «Conferma subito» resta. Il passaggio non ha fretta: usa solo gli ultimi giorni della banca |

Cosa succede al clic: gli altri conti si importano come in N1. Per un conto «È lo stesso conto di…» **non si scrive niente**:
il conto della banca resta non importato, come con «Non importare». La scelta passa all'esito nell'URL.

Esito (`?step=done`), in fondo all'elenco dei conti importati:

```text
┌────────────────────────────────────────────────────────┐
│ Banca Esempio è collegata                              │
│                                                        │
│ Risparmi                                               │
│ 18 movimenti dal 3 gen 2025 · saldo 9.000,00 €         │
│ ──────────────────────────────────────────────────     │
│ Conto corrente · IT60 •••• 4821                        │
│ Da completare: è lo stesso conto di «Conto corrente»   │
│ su Wallet.                       [Controlla e passa]   │
│                                                        │
│                        [Torna alle impostazioni]       │
└────────────────────────────────────────────────────────┘
```

- Riga del conto da passare: nome dato dalla banca e IBAN mascherato `font-medium`; sotto, `text-sm text-muted`, il testo «Da completare…»; `ButtonLink` `primary` `sm` «Controlla e passa» verso `/accounts/<id>/switch?c=<collegamento>&b=<conto della banca>&step=check`.
- Con un conto da passare, «Vai ai conti» diventa `secondary`: l'azione primaria della pagina è «Controlla e passa» del primo conto.
- Con più conti da passare: una riga per conto, ognuna con il suo pulsante. L'utente li fa uno dopo l'altro.
- Se l'utente lascia la pagina, niente è perso e niente è salvato: riparte da §2.2.
- Lo stesso `Select` vale nel rinnovo con un conto nuovo (N1 §6.7) e in «Scegli i conti».

### 2.2 Da un conto che esiste già

Scheda Impostazioni del conto (`/accounts/[id]?tab=settings`), sezione «Origine dei dati» (`accounts.settings.source`, esiste già).
Sotto la nota «Collegato tramite {provider}…» compare un blocco nuovo, solo per i conti ammessi di §2.1.

```text
Origine dei dati             ┌──────────────────────────────────────────────────────────┐
Da dove arriva il saldo e    │ Collegato tramite Wallet. Le credenziali stanno in       │
come si comporta tra una     │ Impostazioni › Integrazioni.                             │
lettura e l'altra.           │                                                          │
                             │ Questo conto è anche in una tua banca? Puoi farlo        │
                             │ arrivare dalla banca. Prima vedi una prova: niente       │
                             │ cambia finché non scegli «Applica».                      │
                             │                                 [Passa alla banca]       │
                             │ ──────────────────────────────────────────────────────   │
                             │ Promemoria di aggiornamento …                            │
                             └──────────────────────────────────────────────────────────┘
```

| Condizione | Vista del blocco |
|---|---|
| Conto ammesso, almeno una banca collegata | Testo + `ButtonLink` `secondary` `sm` «Passa alla banca» → `/accounts/<id>/switch` |
| Conto ammesso, nessuna banca collegata, fornitore delle banche attivo | Testo «Per far arrivare questo conto dalla banca, collega prima la banca.» + `ButtonLink` «Collega una banca» → `/banks/connect` |
| Fornitore delle banche non attivo per l'utente | Nessun blocco (N1 §1.1: nessun elemento nuovo senza attivazione) |
| Conto a mano | Nessun blocco: per un conto a mano vale «Usa un conto esistente» di N1 |
| Conto già passato | Blocco di §9.1 con «Annulla passaggio» |
| Conto archiviato o di investimento | Nessun blocco |

Un solo ingresso dal conto. Nessuna voce in Accounts (elenco), in Overview o nel menu: stessa scelta di N1 (decisione Q5).

### 2.3 Guardie della pagina (sul server)

| Condizione | Risposta |
|---|---|
| Conto non trovato o di un altro utente | 404 |
| Fornitore delle banche non attivo per l'utente | 404 |
| Conto non ammesso (a mano, investimento, archiviato) | Redirect a `/accounts/<id>?tab=settings` |
| Conto già passato | Redirect a `/accounts/<id>?tab=settings` |
| `c` o `b` non validi o di un altro utente | La pagina apre il passo «Conto» senza selezione |
| Conto della banca già importato come conto di Ledgerly | Passo «Conto», con il conto non selezionabile (§4, domanda Q1) |

## 3. Pagina del passaggio

### 3.1 Forma

Pagina propria, non un dialogo: `/accounts/[id]/switch`. Motivi: la prova dura fino a un minuto; il rapporto può essere lungo;
la pagina si ricarica senza perdere il punto.

- `Page` con `title` «Passa «{account}» alla banca» e `parent={{ href: "/accounts/<id>?tab=settings", label: "{account}" }}`.
- `StepIndicator` con tre passi: «1 Conto», «2 Prova», «3 Fatto».
- Il passo è nell'URL: `?step=account` (default), `?step=check&c=<collegamento>&b=<conto della banca>`, `?step=done`.
- Passo «Conto» e passo «Fatto»: una colonna `max-w-[560px]`, come `/banks/connect`. Passo «Prova»: `max-w-[880px]`, per le tabelle.
- A ogni cambio di passo il focus va all'`h1` del passo (`tabIndex={-1}`).
- Dall'esito della procedura della banca (§2.1) la pagina apre subito il passo «Prova»: il passo «Conto» è già fatto e resta un link per tornare indietro.

### 3.2 Uscita

- «Annulla» è presente nei passi «Conto» e «Prova»: `ButtonLink` `secondary` verso il conto. Nessun dialogo di conferma: niente è stato scritto.
- Il tasto Indietro del browser e la chiusura della pagina non lasciano stati a metà.
- Sotto «Annulla», nel passo «Prova», `text-sm text-muted`: «Se esci, il conto resta su {source}. Niente è cambiato.»

### 3.3 Un conto per volta

- La pagina tratta un solo conto. Non esiste una prova o un'applicazione di gruppo.
- Una sola applicazione in corso per utente. Se un'altra è in corso (altra scheda), «Applica» risponde con l'errore `busy` (§11).
- Due schede con la prova dello stesso conto: vale la regola di §6.6 (il rapporto non è più valido dopo un cambio dei dati).

## 4. Passo 1 · Conto della banca

```text
1 Conto   2 Prova   3 Fatto

┌────────────────────────────────────────────────────────┐
│ Quale conto della banca è «Conto corrente»?            │
│ Ledgerly mostra i conti delle tue banche che non sono  │
│ ancora in Ledgerly, in EUR.                            │
│                                                        │
│ Banca Esempio                                          │
│ (•) Conto corrente · IT60 •••• 4821 · EUR              │
│ ( ) Conto deposito · IT60 •••• 7710 · EUR              │
│                                                        │
│ Banca Seconda                                          │
│ ( ) Conto · IT12 •••• 0093 · EUR                       │
│                                                        │
│                          [Annulla] [Avvia la prova]    │
└────────────────────────────────────────────────────────┘
```

| Tema | Regola |
|---|---|
| Controllo | Gruppo di radio (`<fieldset>` con `<legend>` = titolo). Una `<fieldset>` interna per banca, in ordine alfabetico |
| Conti elencati | Conti che la banca condivide, non ancora importati, con la stessa valuta di «{account}» |
| Testo della riga | Nome dato dalla banca · IBAN mascherato (N1 §6.4) · valuta |
| Default | Nessuna selezione. Se c'è un solo conto, è già scelto |
| Pulsante | `primary` «Avvia la prova», disattivato senza selezione, con il testo «Scegli un conto.» sotto |
| Conto della banca già in Ledgerly | In elenco, `aria-disabled`, con il testo «Già in Ledgerly come «{other}».» (domanda Q1) |
| Banca con accesso scaduto o «Serve un'azione» | Titolo della banca + «L'accesso a {bank} è scaduto.» + `LinkButton` «Rinnova accesso». I suoi conti non sono selezionabili |
| Banca «In pausa» (fornitore non attivo) | Non raggiungibile: la pagina è 404 (§2.3) |

Stati vuoti del passo (§11): nessuna banca collegata; nessun conto libero nella valuta del conto.

## 5. Movimenti a mano non inviati (H38)

Vale da quando N3.1 è in produzione. Se N4 esce prima di N3.1, questi movimenti non esistono e il blocco non compare mai.

Ordine fisso all'avvio della prova:

1. Ledgerly aggiorna «{source}». L'aggiornamento invia i movimenti a mano «Da inviare» (N3 §9.8).
2. Se dopo l'aggiornamento un movimento a mano del conto è ancora «Da inviare» o «Non inviato a {source}», la prova **si ferma qui**: nessuna lettura della banca, nessun rapporto.
3. Altrimenti la prova continua (§6).

```text
┌──────────────────────────────────────────────────────────────────────┐
│ Prima del passaggio: 2 movimenti a mano non sono su Wallet           │
│ Ledgerly ha provato a inviarli ora. Finché non sono su Wallet, il    │
│ passaggio non parte: lo storico e il saldo non sarebbero completi.   │
│                                                                      │
│ 12 nov   Bar Centrale        −4,50 €   [Non inviato a Wallet]   ⋯   │
│ 13 nov   Edicola             −2,00 €   [Non inviato a Wallet]   ⋯   │
│                                                                      │
│ Invia di nuovo ogni movimento, oppure eliminalo. Poi rifai la prova. │
│                                    [Annulla]  [Rifai la prova]       │
└──────────────────────────────────────────────────────────────────────┘
```

| Tema | Regola |
|---|---|
| Card | `SwitchUnsentCard`, al posto del rapporto. Titolo `text-lg font-semibold`; il blocco ha `role="alert"` |
| Elenco | Data, beneficiario (o «Senza beneficiario»), importo, `Badge` dello stato (`warn` «Non inviato a {source}», `neutral` «Da inviare») |
| Menu della riga | Le azioni di N3 §9.8: «Riprova l'invio», «Modifica movimento», «Elimina» (con la conferma di N3 §9.6) |
| Dopo un'azione | La riga inviata o eliminata esce dall'elenco. Con l'elenco vuoto il testo diventa «Tutti i movimenti sono su {source}.» e il focus va su «Rifai la prova» |
| «Rifai la prova» | Riparte dal punto 1 |
| «{source}» non aggiornabile (in pausa, accesso scaduto, chiave non valida) | Errore `source_unavailable` (§11) con l'azione dello stato di N2 («Riattiva», «Rinnova accesso», «Sostituisci chiave») |

Le azioni sulle righe sono azioni dell'utente sui suoi movimenti: non sono scritture della prova (criterio 1).

## 6. Passo 2 · Prova e rapporto

### 6.1 Attesa

La prova parte da sola all'apertura del passo e a ogni «Rifai la prova». Non esiste un «Applica» senza una prova appena fatta.

```text
┌────────────────────────────────────────────────────────┐
│ Prova in corso…                                        │
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒   │
│ ✓ Wallet aggiornato                                    │
│ • Lettura degli ultimi giorni da Banca Esempio         │
│ ○ Confronto dei movimenti e del saldo                  │
│ Può servire fino a un minuto. Niente viene cambiato.   │
└────────────────────────────────────────────────────────┘
```

- `role="status"`; `ProgressBar` `dashed` con `label` «Prova in corso»; elenco `<ol>` dei tre passaggi con lo stato come testo nascosto («fatto», «in corso», «da fare»).
- Se l'elenco a tre passaggi non è disponibile dal server, resta la sola barra con la frase finale. **[DEV]**
- La lettura della banca usa la lettura con l'utente presente (N1 §5.2).

### 6.2 Struttura del rapporto

Ordine dall'alto: ciò che blocca, poi ciò che chiede attenzione, poi il resto.

```text
1 Conto ✓   2 Prova   3 Fatto

Prova del passaggio di «Conto corrente»
Wallet → Banca Esempio · Conto corrente · IT60 •••• 4821
Movimenti confrontati dal 4 nov al 14 nov 2026. Niente è stato cambiato.

┌ Saldo ───────────────────────────────────────────────────────────────┐
│ ✓ I saldi sono uguali                                                │
│ In Ledgerly (da Wallet), 14 nov 2026                    2.150,00 €   │
│ In Banca Esempio, saldo contabile, 14 nov 2026          2.150,00 €   │
└──────────────────────────────────────────────────────────────────────┘

┌ Movimenti ───────────────────────────────────────────────────────────┐
│ Trovati in tutte e due                                    41    ⌄    │
│ Da controllare                                    2 importi    ⌃    │
│ Solo su Wallet                                             2    ⌄    │
│ Solo in banca                                              1    ⌄    │
│ Nuovi dalla banca                                          3    ⌄    │
└──────────────────────────────────────────────────────────────────────┘

┌ Cosa cambia con «Applica» ───────────────────────────────────────────┐
│ • Saldo e movimenti di «Conto corrente» arrivano da Banca Esempio.   │
│ • Lo storico resta quello di Wallet. Nessun movimento viene tolto.   │
│ • 3 movimenti nuovi entrano dalla banca.                             │
│ • Wallet non aggiorna più questo conto. Gli altri conti restano.     │
│ • Scrivi i movimenti a mano con l'avviso dei conti di una banca.     │
│ • Le liquidazioni degli interessi non si pubblicano più su Wallet.   │
│ • Puoi tornare indietro con «Annulla passaggio».                     │
└──────────────────────────────────────────────────────────────────────┘

                          [Annulla]  [Rifai la prova]  [Applica]
```

- Intestazione: `h1` `text-xl font-semibold`; riga «{source} → {bank} · conto della banca» `text-muted`; riga del periodo `text-sm text-muted`.
- Tre card, sempre in questo ordine. La card «Saldo» è la prima: decide se «Applica» esiste.
- «Cosa cambia con «Applica»»: elenco `<ul>`. La riga degli interessi compare solo se il conto ha una regola di interessi che pubblica. La riga dei movimenti nuovi compare solo con almeno un movimento nuovo.
- Pulsanti in fondo, a destra, primario per ultimo. «Applica» esiste solo se niente blocca (§7.3).

### 6.3 Righe del riepilogo «Movimenti»

Cinque righe, sempre presenti, anche con zero. Ogni riga con un numero maggiore di zero è un pulsante che apre il dettaglio sotto di sé.

| Riga | Numero | Aperta all'inizio | Frase sotto il titolo, nel dettaglio | A «Applica» |
|---|---|---|---|---|
| Trovati in tutte e due | Movimenti | No | «Ledgerly li riconosce come gli stessi. Restano una riga sola, con la categoria che hanno ora.» | Si collegano alla banca |
| Da controllare | Importi | Sì | «Per questi importi il numero dei movimenti è diverso tra {source} e la banca. Ledgerly non sa quali sono gli stessi: non ne collega nessuno.» | I movimenti di {source} restano come sono. Quelli della banca non entrano |
| Solo su {source} | Movimenti | Sì, se il saldo è diverso | «{source} ha questi movimenti, la banca no. Restano in Ledgerly come sono.» | Restano |
| Solo in banca | Movimenti | Sì, se il saldo è diverso | «La banca ha questi movimenti nel periodo del confronto, {source} no. Non entrano in Ledgerly: lo storico fino al {cutDate} resta quello di {source}.» | Non entrano |
| Nuovi dalla banca | Movimenti | No | «Movimenti dopo il {cutDate}, l'ultimo giorno letto da {source}. Entrano in Ledgerly con «Applica».» | Entrano |

- Numero zero: la riga è testo `text-muted`, senza pulsante.
- `Badge` accanto al numero: `warn` per «Da controllare» maggiore di zero; nessun badge per le altre righe. Con saldo diverso, `warn` anche su «Solo su {source}» e «Solo in banca» maggiori di zero.
- Tutto a zero tranne «Trovati in tutte e due»: sotto la card, nota `bg-hover`: «{source} e la banca dicono le stesse cose.»

### 6.4 Dettaglio delle sezioni

Tabella a 1440 px, lista a 400 px (§12). Colonne per sezione:

| Sezione | Colonne |
|---|---|
| Trovati in tutte e due | Data su {source} · Data in banca (solo se diversa, altrimenti una colonna «Data») · Testo su {source} · Testo in banca · Categoria · Importo |
| Solo su {source} | Data · Testo · Categoria · Importo |
| Solo in banca | Data · Testo · Importo |
| Nuovi dalla banca | Data · Testo · Importo |

«Da controllare»: una card interna per importo, senza tabella unica.

```text
┌ 12,00 € in uscita ───────────────────────────────────────────────────┐
│ Su Wallet: 3 movimenti            In banca: 2 movimenti              │
│ 6 nov   Mensa                     6 nov   POS MENSA AZIENDALE        │
│ 7 nov   Mensa                     10 nov  POS MENSA AZIENDALE        │
│ 10 nov  Mensa                                                        │
└──────────────────────────────────────────────────────────────────────┘
```

- Titolo della card interna: «{amount} in uscita» o «{amount} in entrata».
- Due colonne affiancate, ognuna con il conteggio e l'elenco per data. A 400 px le colonne vanno una sotto l'altra.
- Nessuna azione nella card: nessun collegamento a mano (domanda Q6).
- L'ordine delle card interne: per importo assoluto, dal più grande.

Regole comuni:

- Ordine delle righe: data, dalla più recente.
- I testi lunghi vanno a capo (`break-words`). Il testo della banca non si traduce e non si accorcia.
- La categoria è il chip di `transactions-table.tsx`, in sola lettura.
- Gli importi usano `tabular-nums`, allineati a destra, con il segno. Rispettano «Nascondi importi»: in quel caso anche i saldi e la differenza sono nascosti, e la frase del blocco resta leggibile senza numeri.
- Nessuna riga è modificabile dal rapporto.

### 6.5 Rapporto lungo

| Tema | Regola |
|---|---|
| Sezioni chiuse | Una sezione chiusa non disegna le sue righe |
| Righe per sezione | Le prime 20. Sotto: `LinkButton` «Mostra altri {count}» (20 per volta) e il testo «{shown} di {total}» |
| «Da controllare» | Le prime 5 card interne, poi «Mostra altri {count} importi» |
| Dati | Tutte le righe arrivano con la risposta della prova. «Mostra altri» non chiama il server: il rapporto non può cambiare a metà lettura |
| Pulsanti in fondo | A 1440 px e a 400 px la barra dei pulsanti resta in vista in fondo alla finestra (`sticky bottom-0`, fondo `bg-bg`, bordo `border-t`). Così «Applica» non richiede di scorrere tutto il rapporto |
| Focus dopo «Mostra altri» | Va alla prima riga nuova |
| Oltre 500 righe in una sezione | Dopo 500 righe: «Il rapporto mostra le prime 500 righe di {total}.» Il numero totale resta giusto. **[DEV]** la soglia è tecnica |

### 6.6 Validità del rapporto

- Il rapporto vale per i dati letti in quel momento. Il server gli dà un'impronta; «Applica» la rimanda.
- Se i dati del conto sono cambiati dopo la prova (un aggiornamento automatico, un movimento a mano), «Applica» non scrive e risponde con l'errore `stale` (§11): «I dati sono cambiati dopo la prova. Rifai la prova.»
- Il rapporto non si salva e non ha un indirizzo proprio: un ricaricamento della pagina rifà la prova.
- Nessun export del rapporto in N4.

## 7. Controllo del saldo

### 7.1 Cosa si confronta

| Riga | Valore | Testo |
|---|---|---|
| Saldo locale | Saldo del conto dalla sorgente di partenza, all'ultimo giorno letto. Senza i movimenti a mano non inviati (`12-account-modes.md` §12.5) | «In Ledgerly (da {source}), {date}» |
| Saldo della banca | Saldo del tipo scelto per quella banca, alla stessa data | «In {bank}, {balanceKind}, {date}» |

Il tipo di saldo si sceglie per banca (`04-now.md` §4.6). Lo sceglie Ledgerly (domanda Q5). L'interfaccia non mostra codici: mostra il nome in parole.

| Tipo (dominio) | `{balanceKind}` in italiano | In inglese |
|---|---|---|
| `CLBD` | saldo contabile di fine giornata | closing booked balance |
| `XPCD` | saldo previsto | expected balance |
| `OPBD` | saldo di inizio giornata | opening booked balance |

### 7.2 Saldi uguali

Card «Saldo» con il titolo «I saldi sono uguali», icona `Check` (`aria-hidden`) e tono `pos`. Le due righe sotto. Nessun'altra frase.

### 7.3 Saldi diversi: blocco

```text
┌ Saldo ───────────────────────────────────────────────────────────────┐
│ ✕ I saldi sono diversi: il passaggio non si può applicare            │
│ In Ledgerly (da Wallet), 14 nov 2026                    2.138,00 €   │
│ In Banca Esempio, saldo contabile, 14 nov 2026          2.150,00 €   │
│ Differenza                                                 12,00 €   │
│                                                                      │
│ Con due saldi diversi Ledgerly non può dire che i conti sono lo      │
│ stesso conto con gli stessi movimenti. Niente è stato cambiato.      │
│                                                                      │
│ Cosa puoi fare                                                       │
│ 1. Guarda «Da controllare», «Solo su Wallet» e «Solo in banca» qui   │
│    sotto: di solito la differenza è lì.                              │
│ 2. Correggi su Wallet il movimento che manca o che è doppio.         │
│ 3. Se un movimento è di oggi, aspetta che la banca lo registri.      │
│ 4. Rifai la prova.                                                   │
│                                                                      │
│ Un indizio: la differenza è uguale a un movimento di «Da             │
│ controllare» (12,00 € in uscita).                                    │
└──────────────────────────────────────────────────────────────────────┘

                                      [Lascia il conto su Wallet]  [Rifai la prova]
```

| Tema | Regola |
|---|---|
| Titolo | «I saldi sono diversi: il passaggio non si può applicare». Icona `X`, tono `neg`. La card ha `role="alert"` alla fine della prova |
| Riga «Differenza» | Valore assoluto, `font-medium`. Sotto, in parole, il verso: «Su {source} ci sono {amount} in meno.» / «…in più.» |
| «Applica» | **Non esiste** in questo stato. Nessun pulsante disattivato, nessuna casella «applica lo stesso», nessuna forzatura (criterio 3) |
| Primario | «Rifai la prova» |
| Secondario | «Lascia il conto su {source}»: torna al conto. Niente è cambiato |
| «Cosa puoi fare» | Elenco `<ol>` fisso di 4 voci. La voce 2 nomina la sorgente di partenza |
| Indizio | Una sola frase, solo se la differenza è uguale all'importo di un solo movimento tra «Da controllare», «Solo su {source}» e «Solo in banca». Altrimenti assente. È un aiuto di lettura: non cambia la regola. **[DEV]** |
| Sezioni aperte | «Da controllare», «Solo su {source}» e «Solo in banca» si aprono da sole |
| «Cosa cambia con «Applica»» | La card non si disegna |

### 7.4 Saldo non confrontabile

| Caso | Vista |
|---|---|
| La banca non dà nessun saldo del tipo scelto | Blocco con il titolo «La banca non ha dato un saldo da confrontare». Testo: «Senza il saldo della banca il passaggio non si può applicare. Riprova più tardi.» Primario «Rifai la prova» |
| Il conto non ha un saldo dalla sorgente di partenza | Blocco con il titolo «{source} non ha ancora letto il saldo di questo conto». Azione: «Rifai la prova» |
| Valute diverse | Non raggiungibile: il passo «Conto» elenca solo conti nella stessa valuta |

Blocchi insieme: se il saldo è diverso **e** ci sono movimenti a mano non inviati, vale prima §5 (la prova si ferma prima del confronto).

## 8. «Applica»

### 8.1 Conferma

`Modal` 460, aperto da «Applica».

- Titolo: «Passare «{account}» a {bank}?»
- Testo: «Da ora saldo e movimenti arrivano dalla banca. Lo storico resta quello di {source}. Puoi tornare indietro con «Annulla passaggio» nelle impostazioni del conto.»
- Con una regola di interessi che pubblica: riga in più «Le liquidazioni degli interessi di questo conto non si pubblicano più su {source}.»
- Pulsanti: «Torna al rapporto» (`secondary`), «Applica passaggio» (`primary`). Il focus iniziale è su «Torna al rapporto».

### 8.2 Attesa

- Il dialogo si chiude. La pagina mostra una card `role="status"`: titolo «Passaggio in corso…», `ProgressBar` `dashed`, testo «Non chiudere questa pagina.»
- I pulsanti del rapporto sono disattivati. Un doppio clic non manda una seconda richiesta (stessa regola di N3 §9.4: una chiave per apertura della pagina).
- Alla fine: redirect a `?step=done`.

### 8.3 Esito

```text
1 Conto ✓   2 Prova ✓   3 Fatto

┌────────────────────────────────────────────────────────┐
│ «Conto corrente» ora arriva da Banca Esempio           │
│                                                        │
│ ✓ Saldo della banca e saldo in Ledgerly sono uguali:   │
│   2.150,00 € al 14 nov 2026.                           │
│ 41 movimenti collegati alla banca.                     │
│ 3 movimenti nuovi entrati dalla banca.                 │
│                                                        │
│ Ledgerly legge la banca 3 volte al giorno.             │
│ Wallet non aggiorna più questo conto.                  │
│                                                        │
│ Per tornare indietro: Impostazioni del conto ›         │
│ «Annulla passaggio».                                   │
│                                                        │
│                [Annulla passaggio]  [Vai al conto]     │
└────────────────────────────────────────────────────────┘
```

| Variante | Titolo | Testo | Azioni |
|---|---|---|---|
| Riuscito | ««{account}» ora arriva da {bank}» | Come sopra. Con movimenti nuovi senza categoria: «{count} movimenti nuovi aspettano una categoria.» + `LinkButton` «Apri «Da rivedere»» | «Vai al conto» (`primary`), «Annulla passaggio» (`secondary`) |
| Altri conti da passare (arrivo da §2.1) | Come «Riuscito» | In più: «Resta da passare: {bankAccount}.» | «Controlla e passa il prossimo» (`primary`), «Vai al conto» |
| Controllo dopo il passaggio non riuscito (saldi diversi dopo l'applicazione) | «Il passaggio è fatto, ma i saldi non tornano» | Avviso `warn`: «Saldo della banca {bankBalance}, saldo in Ledgerly {localBalance}. Annulla il passaggio: il conto torna com'era.» | «Annulla passaggio» (`primary`), «Vai al conto» |
| Applicazione non riuscita | Resta il passo «Prova» | `role="alert"` in alto: «Il passaggio non è riuscito. Il conto è rimasto su {source}: niente è cambiato.» | «Rifai la prova» |

Toast alla riuscita: «Conto passato a {bank}».

## 9. Dopo il passaggio

### 9.1 Il conto

| Punto | Prima | Dopo |
|---|---|---|
| Intestazione del conto (`/accounts/[id]`), forma compatta di N2 §3.3 | Stato del collegamento «{source}» | Stato del collegamento della banca: «Aggiornato 2 ore fa», «Serve un'azione · Rinnova accesso»… |
| Origine (`accounts.origins.syncedWith`) | «Sincronizzato con {source}» | «Sincronizzato con {provider}» |
| Modalità (H32) | Lettura e scrittura | Sola lettura. Nel dialogo del movimento a mano il conto passa nel gruppo «Conti collegati a una banca», con l'avviso di N3 §9.8 |
| Scheda Movimenti | Storico di {source} | Lo stesso storico, una riga sola per ogni movimento trovato in tutte e due. I movimenti nuovi seguono per data |
| Categorie | Categoria di {source} | I movimenti di prima tengono la loro categoria. I movimenti nuovi ricevono la categoria da Ledgerly (N3): segno «automatica», suggerimento o «Da categorizzare» |
| Scheda Saldi | Saldi letti da {source} | I saldi di prima restano. Dal giorno dopo l'ultimo giorno letto da {source} i saldi sono della banca |

Scheda Impostazioni, «Origine dei dati», al posto del blocco di §2.2:

```text
│ Collegato tramite Enable Banking. Le credenziali stanno in           │
│ Impostazioni › Integrazioni.                                         │
│                                                                      │
│ Passato da Wallet a Banca Esempio il 16 nov 2026. Lo storico fino    │
│ al 14 nov 2026 è quello di Wallet.            [Annulla passaggio]    │
```

- Riga `text-sm text-muted`; `Button` `secondary` `sm` «Annulla passaggio».
- Il blocco resta finché il passaggio si può annullare (domanda Q4: sempre).

### 9.2 Righe dei collegamenti (`Settings › Integrations`)

| Riga | Effetto |
|---|---|
| Banca | Il dettaglio conta un conto in più: «2 conti · accesso valido fino al …». Stato e azioni come N2. La cronologia mostra la lettura fatta dal passaggio, con origine «manuale» |
| Sorgente di partenza («{source}») | La riga non cambia: stato, azioni e cronologia come N2. La sorgente resta collegata per gli altri conti e salta il conto passato. Nessun avviso e nessun errore per il conto saltato |
| Sorgente di partenza senza altri conti | La riga resta. Nessuna proposta automatica di «Scollega» |

- Il conto passato non compare più nei conteggi «nuovi» e «aggiornati» della cronologia di «{source}».
- «Scollega» della banca dopo un passaggio: vale N1 §5.4, senza regole nuove. Il conto resta in Ledgerly e non viene più aggiornato. Il dialogo di «Scollega» aggiunge una riga se la banca ha conti passati: ««{account}» non torna da solo a {source}. Per riportarlo, usa prima «Annulla passaggio».»
- «Scollega» della sorgente di partenza dopo un passaggio: il dialogo aggiunge la riga «Dopo, il passaggio di «{account}» non si può più annullare.» (§10.4).

### 9.3 Giroconti tra i conti della stessa banca

Caso d'uso del rilascio: il conto corrente arrivava da {source}, i conti di risparmio dalla banca. I giroconti tra loro contavano come un'uscita e un'entrata.

| Tema | Regola dell'interfaccia |
|---|---|
| Dopo il passaggio | Un giroconto tra «{account}» e un altro conto della stessa banca è una riga «Giroconto» sui due conti, come ogni giroconto di oggi. Non conta in entrate, uscite e budget. Non entra in «Da rivedere» (N3 §1.2) |
| Da quando | Dai movimenti che la banca conosce: il periodo del confronto e i giorni seguenti (domanda Q2, opzione A) |
| Nel rapporto | Riga in più in «Cosa cambia con «Applica»», solo se la prova ne trova: «{count} movimenti tra questo conto e gli altri conti di {bank} diventano giroconti: non contano più come entrate e uscite.» Il pulsante «Mostra» apre l'elenco (data, conto di arrivo o di partenza, importo) |
| Nell'esito | «{count} giroconti riconosciuti tra i conti di {bank}.» |
| Numeri che cambiano | Entrate e uscite del periodo scendono dello stesso importo. Il patrimonio non cambia. La frase nel rapporto lo dice: «Entrate e uscite del periodo scendono di {amount}. Il patrimonio non cambia.» |
| Dopo «Annulla passaggio» | I giroconti riconosciuti dal passaggio tornano com'erano (criterio 5) |

Come si riconosce un giroconto è una regola del dominio (§18, punto 6). L'interfaccia riceve solo l'elenco.

### 9.4 Interessi

Regola del piano: la pubblicazione degli interessi sulla sorgente di partenza finisce per i conti passati. L'accredito arriva dalla banca.

| Punto (`Interests`) | Dopo il passaggio |
|---|---|
| Regola del conto, modo | Da «Pubblicata su {source}» a «Solo analisi». Il calcolo e le liquidazioni continuano |
| Modulo della regola, casella «Pubblica ogni liquidazione su {source}» | Non selezionata e disattivata. Sotto, `text-sm text-muted`: «Questo conto arriva dalla banca: le liquidazioni non si pubblicano. L'accredito arriva dalla banca.» Il campo «Categoria su {source}» non si disegna |
| Liquidazioni già «Pubblicata» | Restano «Pubblicata» |
| Liquidazioni «Non pubblicata» | Restano. L'azione «Pubblica ora» non c'è più |
| Liquidazioni «In pubblicazione…» o «Incerta» | Restano con il loro stato. «Riprova» non c'è più; «Segna come pubblicata» resta |
| Colonna della pubblicazione nella tabella delle liquidazioni | Resta finché il conto ha almeno una liquidazione pubblicata |
| Avviso di maturazione in pausa | Usa il nome del collegamento della banca: «…l'ultima lettura del saldo è del {when}. Riprende appena {name} si aggiorna.» |

- Il rapporto e la conferma dicono la fine della pubblicazione prima di «Applica» (§6.2, §8.1).
- Nessun avviso nuovo, nessuna mail.
- I testi di oggi di `interests` contengono il nome «Wallet»: in N4 i testi toccati ricevono il parametro `{source}` (§14.4).

## 10. «Annulla passaggio»

### 10.1 Dove sta

| Punto | Elemento |
|---|---|
| `/accounts/[id]`, scheda Impostazioni, «Origine dei dati» | `Button` `secondary` `sm` «Annulla passaggio» (§9.1). È il punto fisso |
| Esito del passaggio (§8.3) | `secondary`; `primary` se il controllo dopo il passaggio non è riuscito |

Non sta nel menu della riga del collegamento: il passaggio è di un conto, non di una banca. Non sta nella «Zona pericolosa» del conto: non elimina niente.

### 10.2 Cosa dice prima

`Modal` 460 (`UndoSwitchDialog`). Nessuna prova: l'annullamento riporta lo stato di prima.

- Titolo: «Annullare il passaggio di «{account}»?»
- Testo: «Il conto torna ad arrivare da {source}, come prima del {date}.»
- Elenco «Torna com'era» (`<ul>`):
  - «Saldo e movimenti arrivano di nuovo da {source}.»
  - «I movimenti collegati alla banca tornano movimenti di {source}. Nessuno viene tolto.»
  - Con giroconti riconosciuti: «{count} giroconti tornano un'entrata e un'uscita.»
  - Con una regola di interessi che pubblicava: «Le liquidazioni degli interessi tornano a pubblicarsi su {source}. Quelle chiuse nel frattempo non si pubblicano da sole.»
- Elenco «Cosa sapere» (`<ul>`):
  - Con movimenti entrati dalla banca dopo il passaggio: «{count} movimenti arrivati dalla banca dopo il {date} non contano più. {source} li porta di nuovo, se li ha.» (domanda Q3)
  - Con movimenti a mano scritti dopo il passaggio: «{count} movimenti a mano restano sul conto.»
  - «{bank} resta collegata. Gli altri conti non cambiano.»
- Pulsanti: «Lascia il conto su {bank}» (`secondary`, focus iniziale), «Annulla passaggio» (`danger`).

### 10.3 Cosa riporta com'era

| Dato | Dopo l'annullamento |
|---|---|
| Sorgente del conto | «{source}», modalità «lettura e scrittura» |
| Movimenti trovati in tutte e due | Tornano movimenti di {source}. Categoria, note ed etichette restano quelle di ora |
| Movimenti entrati dalla banca dopo il passaggio | Non contano più in saldo, entrate, uscite e budget; nessuna riga cancellata (domanda Q3) |
| Giroconti riconosciuti dal passaggio | Tornano un'entrata e un'uscita |
| Regola di interessi | Torna al modo di prima |
| Riga della banca | Un conto in meno nel dettaglio. Il conto della banca torna «non importato» e si può scegliere di nuovo |
| Riga di {source} | Riprende il conto dall'aggiornamento seguente. L'annullamento avvia subito un aggiornamento |
| Numeri | Uguali a prima del passaggio (criterio 5), a parte i movimenti che {source} ha letto nel frattempo |
| Blocco in «Origine dei dati» | Torna quello di §2.2 |

Esito: toast «Passaggio annullato». Il focus resta nella scheda Impostazioni, sul pulsante «Passa alla banca». Durante l'attesa il pulsante del dialogo dice «Annullamento…».

### 10.4 Quando non si può annullare

| Condizione | Vista |
|---|---|
| «{source}» non è più collegata | Pulsante disattivato. Sotto: «{source} non è più collegata. Collegala di nuovo in Impostazioni › Integrazioni per annullare il passaggio.» + link |
| «{source}» «Serve un'azione» o «In pausa» | L'annullamento è permesso. Dopo, il conto mostra lo stato di {source} con la sua azione (N2) |
| Un'applicazione o un annullamento in corso | Errore `busy` (§11) |
| Annullamento non riuscito | `role="alert"` nel dialogo: «L'annullamento non è riuscito. Il conto è rimasto su {bank}: niente è cambiato.» |
| Conto archiviato | L'annullamento resta possibile dalla scheda Impostazioni |

## 11. Stati: tabella unica

| Vista | Stato | Cosa si vede |
|---|---|---|
| Blocco in «Origine dei dati» | Nessuna banca collegata | Testo + «Collega una banca» (§2.2) |
| Passo «Conto» | Caricamento | Rende il server: nessuno scheletro |
| Passo «Conto» | Vuoto: nessuna banca collegata | `EmptyState`: «Nessuna banca collegata» · «Per passare questo conto, collega prima la banca.» · «Collega una banca» |
| Passo «Conto» | Vuoto: nessun conto libero | `EmptyState`: «Nessun conto da scegliere» · «Le tue banche non condividono un conto in {currency} che non sia già in Ledgerly. Se il conto manca, rinnova l'accesso alla banca e condividilo.» · «Vai alle integrazioni» |
| Passo «Conto» | Errore di lettura dell'elenco | `ErrorState` con «Riprova» |
| Passo «Prova» | Caricamento | Card di attesa (§6.1) |
| Passo «Prova» | Vuoto: nessun movimento nel periodo | Rapporto con cinque zeri e la nota «Nessun movimento nel periodo del confronto. Ledgerly controlla solo il saldo.» «Applica» esiste se i saldi sono uguali |
| Passo «Prova» | Blocco: movimenti non inviati | §5 |
| Passo «Prova» | Blocco: saldi diversi | §7.3 |
| Passo «Prova» | Blocco: saldo non confrontabile | §7.4 |
| Passo «Prova» | Rapporto lungo | §6.5 |
| Passo «Prova» | Errore `source_unavailable` | «Non è stato possibile aggiornare {source}. Il passaggio parte solo con {source} aggiornata.» + azione dello stato di N2 + «Rifai la prova» |
| Passo «Prova» | Errore `bank_unavailable` | «{bank} non risponde ora. Riprova tra poco.» + «Rifai la prova» |
| Passo «Prova» | Errore `consent_expired` | «L'accesso a {bank} è scaduto.» + «Rinnova accesso» |
| Passo «Prova» | Errore `rate_limited` | «La banca ha raggiunto il limite di letture. Riprova dopo le {time}.» Senza pulsante attivo fino a quell'ora |
| Passo «Prova» | Errore `account_gone` | «La banca non condivide più questo conto.» + «Scegli un altro conto» |
| «Applica» | Errore `stale` | «I dati sono cambiati dopo la prova. Rifai la prova.» + «Rifai la prova» |
| «Applica» | Errore `busy` | «Un altro passaggio è in corso. Attendi la fine e riprova.» |
| «Applica» | Errore generico | «Il passaggio non è riuscito. Il conto è rimasto su {source}: niente è cambiato.» |
| Esito | Riuscito, con avviso, non riuscito | §8.3 |
| «Annulla passaggio» | Attesa, errore, non disponibile | §10.3, §10.4 |

Ogni errore è un codice di una lista chiusa con un testo fisso. Mai il messaggio grezzo della banca o della sorgente.
Gli errori del passo «Prova» stanno in una card con `role="alert"`, al posto del rapporto. In tutti gli stati di errore la frase «Niente è stato cambiato.» chiude il testo.

## 12. Layout

### 12.1 1440 px

- Passo «Conto» e passo «Fatto»: colonna di 560 px a sinistra. Pulsanti a destra nella card.
- Passo «Prova»: colonna di 880 px. Tre card in colonna. Le tabelle usano tutta la larghezza della card; «Testo su {source}» e «Testo in banca» hanno la stessa larghezza.
- Card «Saldo»: etichetta a sinistra, importo a destra (`tabular-nums`), una riga per saldo.
- «Da controllare»: due colonne affiancate dentro la card interna.
- Barra dei pulsanti in fondo, `sticky`, allineata a destra dentro la colonna.

### 12.2 400 px

```text
┌──────────────────────────────────┐
│ Saldo                            │
│ ✕ I saldi sono diversi: il       │
│ passaggio non si può applicare   │
│ In Ledgerly (da Wallet)          │
│ 14 nov 2026          2.138,00 €  │
│ In Banca Esempio, saldo contabile│
│ 14 nov 2026          2.150,00 €  │
│ Differenza              12,00 €  │
│ …                                │
├──────────────────────────────────┤
│ Movimenti                        │
│ Trovati in tutte e due    41  ⌄  │
│ Da controllare     2 importi  ⌃  │
│  ┌ 12,00 € in uscita ─────────┐  │
│  │ Su Wallet: 3 movimenti     │  │
│  │ 6 nov   Mensa              │  │
│  │ 7 nov   Mensa              │  │
│  │ 10 nov  Mensa              │  │
│  │ In banca: 2 movimenti      │  │
│  │ 6 nov   POS MENSA AZIENDALE│  │
│  │ 10 nov  POS MENSA AZIENDALE│  │
│  └────────────────────────────┘  │
│ Solo su Wallet             2  ⌃  │
│  12 nov · Edicola       −2,00 €  │
│  …                               │
├──────────────────────────────────┤
│ [Rifai la prova               ]  │
│ [Lascia il conto su Wallet    ]  │
└──────────────────────────────────┘
```

- Le tabelle diventano liste `<ul>`: prima riga data e importo, seconda riga il testo; per «Trovati in tutte e due» una terza riga con il testo della banca, con l'etichetta «In banca:».
- Le righe del saldo vanno su due righe: etichetta sopra, data e importo sotto.
- Pulsanti in colonna a tutta larghezza (`flex-col-reverse`: primario sopra), nella barra `sticky`.
- `StepIndicator`: i passi non correnti mostrano solo il numero (comportamento esistente).
- Nessuno scorrimento orizzontale: testi della banca e IBAN vanno a capo.
- Dialoghi: `Modal` esistente, a tutta larghezza con il margine della pagina.
- Blocco in «Origine dei dati»: testo sopra, pulsante sotto a tutta larghezza.

### 12.3 Temi

Solo token: `card`, `border`, `fg`, `muted`, `pos`, `neg`, `warn` e i loro fondi, `hover`. Nessun colore fisso.
I due temi usano le stesse classi. Il blocco usa `bg-neg-bg` e `text-neg`; l'avviso `bg-warn-bg` e `text-warn`.
`text-faint` non si usa per un testo che serve a capire uno stato.

## 13. Tastiera e accessibilità (WCAG 2.2 AA)

| Tema | Regola |
|---|---|
| Ordine di tabulazione | Passo «Prova»: card «Saldo» → righe del riepilogo → dettaglio aperto → «Cosa cambia» → «Annulla» → «Rifai la prova» → «Applica». Segue l'ordine visivo |
| Focus al cambio di passo | Sull'`h1` del passo. Alla fine della prova il focus va all'`h1` del rapporto; con un blocco, al titolo del blocco |
| Annunci | Attesa: `role="status"`. Blocco del saldo, movimenti non inviati ed errori: `role="alert"`, una volta sola alla fine della prova. «Mostra altri»: nessun annuncio, il focus va alla prima riga nuova |
| Stato non solo con il colore | Saldi uguali e diversi hanno un titolo in parole e un'icona `aria-hidden`. I `Badge` hanno sempre il testo |
| Righe del riepilogo | `<button aria-expanded aria-controls>`; Invio e Spazio aprono e chiudono. Il nome accessibile comprende il numero: «Da controllare, 2 importi» |
| Tabelle | `<table>` con `<caption>` nascosta = nome della sezione; `<th scope="col">`. Sotto 768 px `<ul>` con etichette di testo per ogni valore |
| «Da controllare» | Ogni card interna è un `<section aria-labelledby>`; le due colonne sono due `<ul>` con `aria-label` «Su {source}» e «In banca» |
| Scelta del conto | Radio nativi in `<fieldset>`; frecce tra i conti; un conto non selezionabile ha `disabled` e il motivo in `aria-describedby` |
| Dialoghi | `Modal` esistente: focus dentro, Esc chiude, il focus torna al pulsante che ha aperto. Focus iniziale sull'azione che non cambia niente |
| Barra `sticky` | Non copre l'elemento con il focus: `scroll-padding-bottom` pari all'altezza della barra (2.4.11) |
| Bersagli | Pulsanti `md` nella pagina, `sm` nelle righe (28 px), `LinkButton` 24 px. A 400 px pulsanti a tutta larghezza |
| Contrasto | `fg`, `muted`, `pos`, `neg`, `warn` su `card` e sui loro fondi: 4,5:1 nei due temi |
| Riflusso | Nessuno scorrimento orizzontale a 400 px e con testo al 200% |
| Movimento | Nessuna animazione nuova. `ProgressBar` `dashed` è senza animazione |
| Tempo | Nessun limite di tempo nella pagina. Le date hanno `<time dateTime>` |
| Lingua | Il testo della banca non si traduce. Nomi di banche e fornitori non si traducono |
| Importi nascosti | Con «Nascondi importi» i valori hanno il testo nascosto esistente; titoli e frasi restano completi |

Test da aggiungere (G6, E2E del rilascio): `a11y.spec.ts` e `keyboard.spec.ts` sul passo «Conto», sul rapporto con saldi uguali, sul blocco del saldo,
sui movimenti non inviati, sull'esito e sul dialogo di «Annulla passaggio», a 400 e 1440 px, nei due temi. Un test sui testi: nessuna parola vietata di §1.1 nella pagina.
Un test con due utenti: il secondo non raggiunge `/accounts/<id>/switch` del primo.

## 14. Testi e chiavi di traduzione

Chiavi proposte. I nomi di banche e fornitori sono sempre parametri.

### 14.1 `banks.connect` (aggiunte)

| Chiave | Italiano | English |
|---|---|---|
| `accounts.sameAsGroup` | È lo stesso conto di… | It is the same account as… |
| `accounts.sameAs` | {account} · {source} | {account} · {source} |
| `accounts.sameAsNote` | Questo conto non viene importato ora. Dopo questo passo Ledgerly confronta {source} e la banca e ti mostra il risultato. Niente cambia finché non scegli «Applica». | This account is not imported now. After this step Ledgerly compares {source} and the bank and shows you the result. Nothing changes until you choose “Apply”. |
| `accounts.continue` | Continua | Continue |
| `done.toSwitch` | Da completare: è lo stesso conto di «{account}» su {source}. | To complete: it is the same account as “{account}” on {source}. |
| `done.switchAction` | Controlla e passa | Check and switch |

### 14.2 `accounts.settings.source` (aggiunte)

| Chiave | Italiano | English |
|---|---|---|
| `switch.offer` | Questo conto è anche in una tua banca? Puoi farlo arrivare dalla banca. Prima vedi una prova: niente cambia finché non scegli «Applica». | Is this account also at one of your banks? You can get it from the bank. First you see a trial: nothing changes until you choose “Apply”. |
| `switch.action` | Passa alla banca | Switch to the bank |
| `switch.needsBank` | Per far arrivare questo conto dalla banca, collega prima la banca. | To get this account from the bank, connect the bank first. |
| `switch.connectBank` | Collega una banca | Connect a bank |
| `switch.done` | Passato da {source} a {bank} il {date}. Lo storico fino al {cutDate} è quello di {source}. | Switched from {source} to {bank} on {date}. The history up to {cutDate} is the one from {source}. |
| `switch.undo` | Annulla passaggio | Undo switch |
| `switch.undoUnavailable` | {source} non è più collegata. Collegala di nuovo in Impostazioni › Integrazioni per annullare il passaggio. | {source} is no longer connected. Connect it again in Settings › Integrations to undo the switch. |

### 14.3 `accounts.switch`

| Chiave | Italiano | English |
|---|---|---|
| `title` | Passa «{account}» alla banca | Switch “{account}” to the bank |
| `steps.label` | Passi | Steps |
| `steps.account` | Conto | Account |
| `steps.check` | Prova | Trial |
| `steps.done` | Fatto | Done |
| `steps.completed` | completato | completed |
| `cancel` | Annulla | Cancel |
| `leaveNote` | Se esci, il conto resta su {source}. Niente è cambiato. | If you leave, the account stays on {source}. Nothing changed. |
| `nothingChanged` | Niente è stato cambiato. | Nothing was changed. |
| `account.heading` | Quale conto della banca è «{account}»? | Which bank account is “{account}”? |
| `account.intro` | Ledgerly mostra i conti delle tue banche che non sono ancora in Ledgerly, in {currency}. | Ledgerly shows the accounts of your banks that are not in Ledgerly yet, in {currency}. |
| `account.start` | Avvia la prova | Start the trial |
| `account.choose` | Scegli un conto. | Choose an account. |
| `account.alreadyHere` | Già in Ledgerly come «{other}». | Already in Ledgerly as “{other}”. |
| `account.expired` | L'accesso a {bank} è scaduto. | The access to {bank} has expired. |
| `account.renew` | Rinnova accesso | Renew access |
| `account.empty.noBank.title` | Nessuna banca collegata | No bank connected |
| `account.empty.noBank.text` | Per passare questo conto, collega prima la banca. | To switch this account, connect the bank first. |
| `account.empty.none.title` | Nessun conto da scegliere | No account to choose |
| `account.empty.none.text` | Le tue banche non condividono un conto in {currency} che non sia già in Ledgerly. Se il conto manca, rinnova l'accesso alla banca e condividilo. | Your banks do not share an account in {currency} that is not in Ledgerly already. If the account is missing, renew the access to the bank and share it. |
| `account.empty.none.action` | Vai alle integrazioni | Go to integrations |
| `wait.heading` | Prova in corso… | Trial in progress… |
| `wait.progress` | Prova in corso | Trial in progress |
| `wait.source` | {source} aggiornato | {source} updated |
| `wait.bank` | Lettura degli ultimi giorni da {bank} | Reading the last days from {bank} |
| `wait.compare` | Confronto dei movimenti e del saldo | Comparing transactions and balance |
| `wait.note` | Può servire fino a un minuto. Niente viene cambiato. | It can take up to a minute. Nothing is changed. |
| `wait.states.done` | fatto | done |
| `wait.states.running` | in corso | in progress |
| `wait.states.todo` | da fare | to do |
| `report.heading` | Prova del passaggio di «{account}» | Trial of the switch of “{account}” |
| `report.route` | {source} → {bank} · {bankAccount} | {source} → {bank} · {bankAccount} |
| `report.period` | Movimenti confrontati dal {from} al {to}. Niente è stato cambiato. | Transactions compared from {from} to {to}. Nothing was changed. |
| `report.retry` | Rifai la prova | Run the trial again |
| `report.apply` | Applica | Apply |
| `report.same` | {source} e la banca dicono le stesse cose. | {source} and the bank say the same things. |
| `report.noMovements` | Nessun movimento nel periodo del confronto. Ledgerly controlla solo il saldo. | No transactions in the compared period. Ledgerly checks the balance only. |
| `report.movements.title` | Movimenti | Transactions |
| `report.movements.matched` | Trovati in tutte e due | Found in both |
| `report.movements.matchedHint` | Ledgerly li riconosce come gli stessi. Restano una riga sola, con la categoria che hanno ora. | Ledgerly recognizes them as the same. They stay one row, with the category they have now. |
| `report.movements.toCheck` | Da controllare | To check |
| `report.movements.toCheckCount` | {count, plural, one {# importo} other {# importi}} | {count, plural, one {# amount} other {# amounts}} |
| `report.movements.toCheckHint` | Per questi importi il numero dei movimenti è diverso tra {source} e la banca. Ledgerly non sa quali sono gli stessi: non ne collega nessuno. | For these amounts the number of transactions is different between {source} and the bank. Ledgerly cannot tell which are the same: it links none of them. |
| `report.movements.groupOut` | {amount} in uscita | {amount} out |
| `report.movements.groupIn` | {amount} in entrata | {amount} in |
| `report.movements.onSource` | Su {source}: {count, plural, one {# movimento} other {# movimenti}} | On {source}: {count, plural, one {# transaction} other {# transactions}} |
| `report.movements.atBank` | In banca: {count, plural, one {# movimento} other {# movimenti}} | At the bank: {count, plural, one {# transaction} other {# transactions}} |
| `report.movements.sourceOnly` | Solo su {source} | Only on {source} |
| `report.movements.sourceOnlyHint` | {source} ha questi movimenti, la banca no. Restano in Ledgerly come sono. | {source} has these transactions, the bank does not. They stay in Ledgerly as they are. |
| `report.movements.bankOnly` | Solo in banca | Only at the bank |
| `report.movements.bankOnlyHint` | La banca ha questi movimenti nel periodo del confronto, {source} no. Non entrano in Ledgerly: lo storico fino al {cutDate} resta quello di {source}. | The bank has these transactions in the compared period, {source} does not. They do not enter Ledgerly: the history up to {cutDate} stays the one from {source}. |
| `report.movements.new` | Nuovi dalla banca | New from the bank |
| `report.movements.newHint` | Movimenti dopo il {cutDate}, l'ultimo giorno letto da {source}. Entrano in Ledgerly con «Applica». | Transactions after {cutDate}, the last day read from {source}. They enter Ledgerly with “Apply”. |
| `report.movements.more` | Mostra altri {count} | Show {count} more |
| `report.movements.moreAmounts` | Mostra altri {count, plural, one {# importo} other {# importi}} | Show {count, plural, one {# more amount} other {# more amounts}} |
| `report.movements.shown` | {shown} di {total} | {shown} of {total} |
| `report.movements.capped` | Il rapporto mostra le prime {shown} righe di {total}. | The report shows the first {shown} rows of {total}. |
| `report.columns.date` | Data | Date |
| `report.columns.sourceDate` | Data su {source} | Date on {source} |
| `report.columns.bankDate` | Data in banca | Date at the bank |
| `report.columns.sourceText` | Testo su {source} | Text on {source} |
| `report.columns.bankText` | Testo in banca | Text at the bank |
| `report.columns.text` | Testo | Text |
| `report.columns.category` | Categoria | Category |
| `report.columns.amount` | Importo | Amount |
| `report.bankTextLabel` | In banca: | At the bank: |
| `report.noPayee` | Senza beneficiario | No payee |
| `changes.title` | Cosa cambia con «Applica» | What changes with “Apply” |
| `changes.source` | Saldo e movimenti di «{account}» arrivano da {bank}. | Balance and transactions of “{account}” come from {bank}. |
| `changes.history` | Lo storico resta quello di {source}. Nessun movimento viene tolto. | The history stays the one from {source}. No transaction is removed. |
| `changes.new` | {count, plural, one {# movimento nuovo entra} other {# movimenti nuovi entrano}} dalla banca. | {count, plural, one {# new transaction enters} other {# new transactions enter}} from the bank. |
| `changes.skip` | {source} non aggiorna più questo conto. Gli altri conti restano. | {source} no longer updates this account. The other accounts stay. |
| `changes.manual` | Scrivi i movimenti a mano con l'avviso dei conti di una banca. | You add transactions by hand with the notice of bank accounts. |
| `changes.interests` | Le liquidazioni degli interessi non si pubblicano più su {source}. | Interest settlements are no longer published on {source}. |
| `changes.transfers` | {count, plural, one {# movimento} other {# movimenti}} tra questo conto e gli altri conti di {bank} diventano giroconti: non contano più come entrate e uscite. | {count, plural, one {# transaction} other {# transactions}} between this account and the other accounts of {bank} become transfers: they no longer count as income and expenses. |
| `changes.transfersEffect` | Entrate e uscite del periodo scendono di {amount}. Il patrimonio non cambia. | Income and expenses of the period go down by {amount}. Net worth does not change. |
| `changes.show` | Mostra | Show |
| `changes.learn` | Ledgerly usa le categorie di {count, plural, one {# movimento} other {# movimenti}} per riconoscere i prossimi movimenti della banca. | Ledgerly uses the categories of {count, plural, one {# transaction} other {# transactions}} to recognize the next bank transactions. |
| `changes.undo` | Puoi tornare indietro con «Annulla passaggio». | You can go back with “Undo switch”. |
| `balance.title` | Saldo | Balance |
| `balance.equal` | I saldi sono uguali | The balances are equal |
| `balance.different` | I saldi sono diversi: il passaggio non si può applicare | The balances are different: the switch cannot be applied |
| `balance.local` | In Ledgerly (da {source}), {date} | In Ledgerly (from {source}), {date} |
| `balance.bank` | In {bank}, {balanceKind}, {date} | At {bank}, {balanceKind}, {date} |
| `balance.kinds.closing` | saldo contabile di fine giornata | closing booked balance |
| `balance.kinds.expected` | saldo previsto | expected balance |
| `balance.kinds.opening` | saldo di inizio giornata | opening booked balance |
| `balance.difference` | Differenza | Difference |
| `balance.less` | Su {source} ci sono {amount} in meno. | {source} has {amount} less. |
| `balance.more` | Su {source} ci sono {amount} in più. | {source} has {amount} more. |
| `balance.why` | Con due saldi diversi Ledgerly non può dire che i conti sono lo stesso conto con gli stessi movimenti. Niente è stato cambiato. | With two different balances Ledgerly cannot say that the accounts are the same account with the same transactions. Nothing was changed. |
| `balance.todo.title` | Cosa puoi fare | What you can do |
| `balance.todo.look` | Guarda «Da controllare», «Solo su {source}» e «Solo in banca» qui sotto: di solito la differenza è lì. | Look at “To check”, “Only on {source}” and “Only at the bank” below: the difference is usually there. |
| `balance.todo.fix` | Correggi su {source} il movimento che manca o che è doppio. | On {source}, correct the transaction that is missing or double. |
| `balance.todo.wait` | Se un movimento è di oggi, aspetta che la banca lo registri. | If a transaction is from today, wait until the bank books it. |
| `balance.todo.retry` | Rifai la prova. | Run the trial again. |
| `balance.hint` | Un indizio: la differenza è uguale a un movimento di «{section}» ({amount}). | A hint: the difference is equal to one transaction in “{section}” ({amount}). |
| `balance.stay` | Lascia il conto su {source} | Leave the account on {source} |
| `balance.noBank.title` | La banca non ha dato un saldo da confrontare | The bank gave no balance to compare |
| `balance.noBank.text` | Senza il saldo della banca il passaggio non si può applicare. Riprova più tardi. | Without the bank's balance the switch cannot be applied. Try again later. |
| `balance.noLocal.title` | {source} non ha ancora letto il saldo di questo conto | {source} has not read the balance of this account yet |
| `unsent.title` | Prima del passaggio: {count, plural, one {# movimento a mano non è} other {# movimenti a mano non sono}} su {source} | Before the switch: {count, plural, one {# manual transaction is} other {# manual transactions are}} not on {source} |
| `unsent.text` | Ledgerly ha provato a inviarli ora. Finché non sono su {source}, il passaggio non parte: lo storico e il saldo non sarebbero completi. | Ledgerly tried to send them now. Until they are on {source}, the switch does not start: the history and the balance would not be complete. |
| `unsent.todo` | Invia di nuovo ogni movimento, oppure eliminalo. Poi rifai la prova. | Send each transaction again, or delete it. Then run the trial again. |
| `unsent.clear` | Tutti i movimenti sono su {source}. | All the transactions are on {source}. |
| `confirm.title` | Passare «{account}» a {bank}? | Switch “{account}” to {bank}? |
| `confirm.text` | Da ora saldo e movimenti arrivano dalla banca. Lo storico resta quello di {source}. Puoi tornare indietro con «Annulla passaggio» nelle impostazioni del conto. | From now on balance and transactions come from the bank. The history stays the one from {source}. You can go back with “Undo switch” in the account settings. |
| `confirm.back` | Torna al rapporto | Back to the report |
| `confirm.apply` | Applica passaggio | Apply switch |
| `applying.heading` | Passaggio in corso… | Switch in progress… |
| `applying.note` | Non chiudere questa pagina. | Do not close this page. |
| `done.heading` | «{account}» ora arriva da {bank} | “{account}” now comes from {bank} |
| `done.balance` | Saldo della banca e saldo in Ledgerly sono uguali: {amount} al {date}. | The bank's balance and the balance in Ledgerly are equal: {amount} on {date}. |
| `done.linked` | {count, plural, one {# movimento collegato} other {# movimenti collegati}} alla banca. | {count, plural, one {# transaction linked} other {# transactions linked}} to the bank. |
| `done.new` | {count, plural, one {# movimento nuovo entrato} other {# movimenti nuovi entrati}} dalla banca. | {count, plural, one {# new transaction came} other {# new transactions came}} from the bank. |
| `done.transfers` | {count, plural, one {# giroconto riconosciuto} other {# giroconti riconosciuti}} tra i conti di {bank}. | {count, plural, one {# transfer recognized} other {# transfers recognized}} between the accounts of {bank}. |
| `done.toReview` | {count, plural, one {# movimento nuovo aspetta} other {# movimenti nuovi aspettano}} una categoria. | {count, plural, one {# new transaction waits} other {# new transactions wait}} for a category. |
| `done.openReview` | Apri «Da rivedere» | Open “To review” |
| `done.schedule` | Ledgerly legge la banca 3 volte al giorno. | Ledgerly reads the bank 3 times a day. |
| `done.sourceStops` | {source} non aggiorna più questo conto. | {source} no longer updates this account. |
| `done.undoHint` | Per tornare indietro: Impostazioni del conto › «Annulla passaggio». | To go back: Account settings › “Undo switch”. |
| `done.next` | Resta da passare: {bankAccount}. | Still to switch: {bankAccount}. |
| `done.nextAction` | Controlla e passa il prossimo | Check and switch the next one |
| `done.toAccount` | Vai al conto | Go to the account |
| `done.mismatch.heading` | Il passaggio è fatto, ma i saldi non tornano | The switch is done, but the balances do not agree |
| `done.mismatch.text` | Saldo della banca {bankBalance}, saldo in Ledgerly {localBalance}. Annulla il passaggio: il conto torna com'era. | The bank's balance is {bankBalance}, the balance in Ledgerly is {localBalance}. Undo the switch: the account goes back to how it was. |
| `toasts.done` | Conto passato a {bank} | Account switched to {bank} |
| `toasts.undone` | Passaggio annullato | Switch undone |
| `undo.title` | Annullare il passaggio di «{account}»? | Undo the switch of “{account}”? |
| `undo.text` | Il conto torna ad arrivare da {source}, come prima del {date}. | The account comes from {source} again, as before {date}. |
| `undo.backTitle` | Torna com'era | Goes back to how it was |
| `undo.back.source` | Saldo e movimenti arrivano di nuovo da {source}. | Balance and transactions come from {source} again. |
| `undo.back.linked` | I movimenti collegati alla banca tornano movimenti di {source}. Nessuno viene tolto. | The transactions linked to the bank become {source} transactions again. None is removed. |
| `undo.back.transfers` | {count, plural, one {# giroconto torna} other {# giroconti tornano}} un'entrata e un'uscita. | {count, plural, one {# transfer becomes} other {# transfers become}} an income and an expense again. |
| `undo.back.interests` | Le liquidazioni degli interessi tornano a pubblicarsi su {source}. Quelle chiuse nel frattempo non si pubblicano da sole. | Interest settlements are published on {source} again. The ones closed in the meantime are not published automatically. |
| `undo.knowTitle` | Cosa sapere | Good to know |
| `undo.know.bankRows` | {count, plural, one {# movimento arrivato} other {# movimenti arrivati}} dalla banca dopo il {date} non {count, plural, one {conta} other {contano}} più. {source} li porta di nuovo, se li ha. | {count, plural, one {# transaction that came} other {# transactions that came}} from the bank after {date} no longer {count, plural, one {counts} other {count}}. {source} brings them again, if it has them. |
| `undo.know.manual` | {count, plural, one {# movimento a mano resta} other {# movimenti a mano restano}} sul conto. | {count, plural, one {# manual transaction stays} other {# manual transactions stay}} on the account. |
| `undo.know.bank` | {bank} resta collegata. Gli altri conti non cambiano. | {bank} stays connected. The other accounts do not change. |
| `undo.keep` | Lascia il conto su {bank} | Leave the account on {bank} |
| `undo.confirm` | Annulla passaggio | Undo switch |
| `undo.pending` | Annullamento… | Undoing… |
| `undo.failed` | L'annullamento non è riuscito. Il conto è rimasto su {bank}: niente è cambiato. | The undo failed. The account stayed on {bank}: nothing changed. |
| `errors.sourceUnavailable` | Non è stato possibile aggiornare {source}. Il passaggio parte solo con {source} aggiornata. | {source} could not be updated. The switch starts only with {source} up to date. |
| `errors.bankUnavailable` | {bank} non risponde ora. Riprova tra poco. | {bank} does not answer now. Try again in a moment. |
| `errors.consentExpired` | L'accesso a {bank} è scaduto. | The access to {bank} has expired. |
| `errors.rateLimited` | La banca ha raggiunto il limite di letture. Riprova dopo le {time}. | The bank reached its reading limit. Try again after {time}. |
| `errors.accountGone` | La banca non condivide più questo conto. | The bank no longer shares this account. |
| `errors.chooseOther` | Scegli un altro conto | Choose another account |
| `errors.stale` | I dati sono cambiati dopo la prova. Rifai la prova. | The data changed after the trial. Run the trial again. |
| `errors.busy` | Un altro passaggio è in corso. Attendi la fine e riprova. | Another switch is in progress. Wait until it ends and try again. |
| `errors.applyFailed` | Il passaggio non è riuscito. Il conto è rimasto su {source}: niente è cambiato. | The switch failed. The account stayed on {source}: nothing changed. |

### 14.4 Altre chiavi toccate

| Chiave | Italiano | English | Nota |
|---|---|---|---|
| `interests.form.switched` | Questo conto arriva dalla banca: le liquidazioni non si pubblicano. L'accredito arriva dalla banca. | This account comes from the bank: settlements are not published. The credit comes from the bank. | Nuova |
| `interests.form.publish` | Pubblica ogni liquidazione su {source} | Publish each settlement on {source} | Oggi contiene il nome del fornitore |
| `interests.detail.modes.post_to_provider` | Pubblicata su {source} | Published on {source} | Come sopra |
| `interests.detail.balance.stale` | Maturazione in pausa: l'ultima lettura del saldo è del {when}. Riprende appena {name} si aggiorna — nessun interesse viene calcolato su un saldo vecchio. | Accrual paused: the last balance reading is from {when}. It resumes as soon as {name} updates — no interest is calculated on an old balance. | `{name}` = collegamento che legge il conto |
| `settings.banks.disconnect.switched` | «{account}» non torna da solo a {source}. Per riportarlo, usa prima «Annulla passaggio». | “{account}” does not go back to {source} automatically. To bring it back, use “Undo switch” first. | Riga in più nel dialogo «Scollega» della banca |
| `settings.connections.disconnect.switchedFrom` | Dopo, il passaggio di «{account}» non si può più annullare. | After this, the switch of “{account}” can no longer be undone. | Riga in più nel dialogo «Scollega» della sorgente di partenza |

Le altre chiavi di `interests` con il nome del fornitore non cambiano in N4: le chiude R5c.

## 15. Verifica dei criteri di accettazione

| Criterio | Dove è coperto |
|---|---|
| Issue 1 · Ogni voce di interfaccia del «Contenuto» di N4 ha una sezione, con stati e testi | §0 (mappa), §2-§11, §14 |
| Issue 2 · Rispetto dei 5 criteri di N4 e di H38 | Righe sotto |
| N4 1 · La prova non scrive nulla | §1.2, §2.1 (la scelta non si salva), §3.2, §6.6 |
| N4 2 · Con conteggi diversi nessun movimento della banca si lega: va nel rapporto | §6.3, §6.4 («Da controllare», senza azioni) |
| N4 3 · Una differenza di saldo blocca l'applicazione | §7.3 (nessun «Applica», nessuna forzatura) |
| N4 4 · Dopo il passaggio: saldo della banca = saldo locale alla stessa data | §8.3 (riga dell'esito e variante «i saldi non tornano») |
| N4 5 · Dopo «Annulla passaggio» la fotografia dei numeri è uguale a prima | §10.2, §10.3; dipende dalla domanda Q3 |
| H38 · Prima l'invio dei movimenti a mano; se uno resta non inviato, il passaggio si ferma e dice perché | §5 |
| Un conto per volta | §3.3 |
| Fine della pubblicazione degli interessi per i conti passati | §9.4 |
| Nessuna parola tecnica, nessun nome di fornitore nei testi | §1.1, §14; test di §13 |

## 16. Decisioni di design prese senza conferma

Scelte di interazione, non di prodotto. Si cambiano senza toccare il piano.

| # | Decisione | Motivo |
|---|---|---|
| 1 | Pagina propria `/accounts/[id]/switch`, non un dialogo e non un passo in più di `/banks/connect` | La prova è lunga; i due ingressi arrivano alla stessa pagina; il passo «Conti» della banca ha poco tempo |
| 2 | Nella procedura della banca la scelta «È lo stesso conto di…» non importa il conto e non salva la scelta | Criterio 1: niente si scrive prima di «Applica» |
| 3 | Più conti «È lo stesso conto di…» nello stesso passo sono permessi; ognuno si passa da solo | «Un conto per volta» riguarda prova e applicazione, non la scelta |
| 4 | La parola per l'utente è «Prova», non «prova a secco»; «Da controllare» al posto di «gruppi con conteggi diversi» | Parole semplici (issue) |
| 5 | La card «Saldo» è la prima del rapporto | È l'unico dato che blocca |
| 6 | Con saldi diversi «Applica» non esiste, invece di un pulsante disattivato | Un pulsante disattivato invita a cercare come attivarlo; qui non esiste un modo |
| 7 | L'indizio «la differenza è uguale a un movimento» | Riduce il tempo per trovare la causa; non cambia nessuna regola |
| 8 | Una conferma dopo «Applica» | Il passaggio cambia modalità del conto e interessi: l'utente lo legge una volta in forma corta |
| 9 | «Annulla passaggio» sta nelle impostazioni del conto, non nella riga del collegamento | Il passaggio è di un conto |
| 10 | Nessuna prova prima di «Annulla passaggio»: solo una conferma con gli effetti | L'annullamento riporta uno stato già conosciuto |
| 11 | Barra dei pulsanti `sticky` nel passo «Prova» | Rapporto lungo |
| 12 | Nessun export del rapporto | Il piano non lo chiede; il rapporto si rifà in un minuto |
| 13 | Dopo il passaggio la regola di interessi passa a «Solo analisi»; dopo l'annullamento torna al modo di prima, senza pubblicare da sola le liquidazioni chiuse nel frattempo | Il piano dice solo «la pubblicazione finisce». Pubblicare dopo creerebbe un doppione dell'accredito già arrivato dalla banca |
| 14 | Gli esempi usano «Banca Esempio» e importi inventati | Nessun valore personale nel repo |

## 17. Domande per Mattia

Decisioni di prodotto che il piano non scrive. Il testo applica l'opzione A. Una risposta B cambia le sezioni indicate.

| # | Domanda | Esempio | A (default) | B | Effetto |
|---|---|---|---|---|---|
| Q1 | Il conto della banca è già in Ledgerly come conto separato: si può unire al conto di {source}? | Alla prima connessione hai importato «Banca Esempio Conto corrente» come conto nuovo. Ora in Ledgerly hai due conti per lo stesso conto vero: quello di Wallet e quello della banca | No, non in N4. Il passo «Conto» mostra il conto come non selezionabile: «Già in Ledgerly come…». Il passaggio vale solo per un conto della banca non ancora importato | Sì: il passaggio unisce i due conti. Il conto creato dalla banca sparisce e i suoi movimenti passano nel conto di Wallet, dopo la stessa prova | A: nessuna unione di conti da scrivere; chi ha già importato il conto resta con due conti (il tuo conto corrente non è importato: il caso non ti tocca). B: copre ogni caso; aggiunge l'unione di due conti con saldi, budget e regole, e un annullamento più difficile. N4 passa da M a L **[DEV]**. Tocca §2.3, §4 |
| Q2 | Da quale data i movimenti tra il conto passato e gli altri conti della stessa banca diventano giroconti? | Il 5 marzo hai spostato 500 € dal conto corrente al conto di risparmio. Oggi Ledgerly conta 500 € di uscite e 500 € di entrate. Lo stesso per uno spostamento del 10 novembre | Dal periodo del confronto in poi: il giroconto del 10 novembre e tutti i prossimi. Il 5 marzo resta un'uscita e un'entrata | Su tutto lo storico: anche il 5 marzo diventa un giroconto. La prova elenca ogni coppia prima di «Applica» | A: i numeri dei mesi passati non cambiano; la regola usa solo movimenti che la banca conosce. B: entrate e uscite dei mesi passati scendono; serve una regola nuova per importo e data sui movimenti vecchi, non scritta nel piano, con il rischio di coppie sbagliate. In tutti e due i casi cambiano numeri esistenti: serve la tua decisione scritta. Tocca §9.3 |
| Q3 | «Annulla passaggio»: cosa succede ai movimenti arrivati dalla banca dopo il passaggio? | Passi il conto il 16 novembre. Il 20 la banca porta 6 movimenti nuovi. Il 21 annulli | I 6 movimenti non contano più e non si vedono (restano in archivio, nessuna riga cancellata). Wallet li porta di nuovo se li ha. I numeri sono quelli di Wallet | I 6 movimenti restano sul conto come movimenti a mano | A: i numeri tornano quelli della sorgente (criterio 5); un movimento che Wallet non ha sparisce dai conti. B: niente sparisce; se Wallet ha gli stessi movimenti, risultano doppi e li devi eliminare a mano. Tocca §10.2, §10.3 |
| Q4 | «Annulla passaggio» ha un limite di tempo? | Passi il conto a novembre. A marzo vuoi tornare a Wallet | No: resta disponibile finché Wallet è collegato | Sì: 30 giorni. Dopo, il pulsante sparisce | A: sempre reversibile; dopo mesi l'annullamento tocca molti movimenti arrivati dalla banca (Q3). B: effetti piccoli e chiari; dopo 30 giorni non si torna indietro dall'interfaccia. Tocca §9.1, §10.4 |
| Q5 | Chi sceglie il saldo della banca da confrontare? | La banca dà due saldi per il 14 novembre: 2.150,00 € «contabile» e 2.138,00 € «previsto» (con un pagamento non ancora registrato). Wallet dice 2.138,00 € | Ledgerly: un tipo per banca, deciso dal dominio. La pagina mostra quale: «saldo contabile di fine giornata». Nell'esempio il passaggio è bloccato finché la banca registra il pagamento | Tu: nel blocco compare «Confronta con un altro saldo» con i saldi che la banca dà. Nell'esempio scegli «previsto» e il passaggio parte | A: una regola sola, nessuna scelta che può nascondere una differenza vera; a volte devi aspettare un giorno. B: meno attese; l'utente può scegliere il saldo che torna anche quando i movimenti non tornano. Tocca §7.1, §7.3 |
| Q6 | «Da controllare»: puoi dire tu quali movimenti sono gli stessi? | Wallet ha 3 «Mensa» da 12,00 €, la banca 2. Tu sai quale manca | No: la sezione è solo da leggere. I 3 movimenti di Wallet restano; quelli della banca non entrano. Se il saldo torna, il passaggio parte | Sì: nella card scegli le coppie a mano; i movimenti scelti si collegano | A: nessun collegamento sbagliato fatto a mano; rispetta alla lettera il criterio 2. B: un rapporto più pulito; una schermata in più e una scelta a mano che il criterio 2 oggi esclude. Tocca §6.4 |

## 18. Passaggi per lo sviluppo

Non sono decisioni di prodotto: sono dati e regole tecniche che l'interfaccia richiede. I punti con **[DEV]** vanno confermati dallo sviluppatore.

1. **Spike.** L'issue cita uno spike sull'abbinamento in `docs/design/`. Il file non è nel repo al commit `1e235ab`. Questa specifica usa i tre scenari di `03-releases.md` «N4». Se lo spike contiene altri casi del rapporto, questa specifica va riletta.
2. **Risposta della prova.** Un oggetto solo: periodo (`from`, `cutDate`), saldi (locale, banca, tipo, date, differenza), cinque elenchi di §6.3, elenco dei giroconti (§9.3), movimenti a mano non inviati (§5), impronta (§6.6). L'interfaccia non calcola niente, tranne l'indizio di §7.3 (o lo calcola il server).
3. **Prova senza scritture.** La lettura dalla banca per un conto non importato non deve salvare movimenti, saldi o righe di cronologia. L'aggiornamento della sorgente di partenza è un aggiornamento normale: scrive come sempre, prima della prova. **[DEV]** Da confermare che questo rispetta il test «prova a secco senza scritture».
4. **Conti della banca non importati.** Il passo «Conto» ha bisogno dell'elenco dei conti che ogni banca condivide e che non sono in Ledgerly, anche giorni dopo il collegamento. **[DEV]** Da dove si legge (ultima lettura o una chiamata nuova).
5. **Movimenti della banca fino all'ultimo giorno letto dalla sorgente.** Dopo il passaggio le letture della banca non devono inserire i movimenti «Solo in banca» e quelli di «Da controllare» con data fino a quel giorno: altrimenti nascono doppioni. **[DEV]**
6. **Giroconti.** Oggi `pairTransfers` abbina solo sul riferimento della controparte dato dal fornitore (`src/modules/transactions/rules.ts`). La banca non dà questo riferimento. Serve una regola del dominio per i due lati di un giroconto tra conti dello stesso collegamento. Dipende dalla domanda Q2. **[DEV]**
7. **Tipo di saldo per banca.** `pickBalance` (`src/platform/plugins/rules.ts`) ha già un ordine di preferenza. Serve il tipo usato, per collegamento, nella risposta della prova (§7.1). **[DEV]** `12-account-modes.md` §12.5: quale saldo locale legge il controllo.
8. **Impronta del rapporto.** «Applica» riceve l'impronta e rifà il confronto dentro la transazione. Se l'esito è diverso, risponde `stale`.
9. **Una applicazione per volta.** Un blocco per utente durante «Applica» e «Annulla passaggio» (`busy`).
10. **Dati del passaggio fatto.** Per §9.1 e §10 servono: data del passaggio, sorgente di partenza, ultimo giorno letto dalla sorgente, numero dei movimenti collegati, entrati e a mano dopo il passaggio, giroconti riconosciuti, modo di prima della regola di interessi. Il piano dice «nessuna migrazione di schema»: **[DEV]** dove stanno questi dati (per esempio nei dati del collegamento o in `provider_links`).
11. **Annullamento e righe della banca (Q3, opzione A).** «Non contano più, nessuna riga cancellata»: **[DEV]** con quale stato (per esempio lo stato «nascosto» di oggi, con un motivo che l'utente non può togliere).
12. **Interessi.** `posting.ts` pubblica solo con il modo `post_to_provider`. Il passaggio cambia il modo e salva quello di prima (punto 10). Il modulo `interests` chiede «il conto ha una sorgente che riceve scritture?», non il nome del fornitore.
13. **Descrittore del fornitore.** `{source}` e `{provider}` arrivano dal registro (`platform/integrations/registry.ts`) e dal manifest. Nessun file nuovo contiene un nome di fornitore (lista nota di M12).
14. **N1.** `accounts-step.tsx`: gruppo nuovo nel `Select`, decisione nuova `{ kind: "sameAs", accountId }` trattata come `skip` nell'importazione, e riga nuova nell'esito. La specifica di N1 non cambia: §6.4 e §11 di N1 rimandano a questo documento.
15. **Movimento.** Vale la nota di N1 §13, punto 6, su `prefers-reduced-motion`.

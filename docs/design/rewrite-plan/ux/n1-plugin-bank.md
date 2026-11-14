# N1 · Specifica UX: tab Plugin e «Collega una banca»

Indice del piano: [`../../rewrite-plan.md`](../../rewrite-plan.md). Rilascio: [`../03-releases.md`](../03-releases.md) «N1».
Regole tecniche: [`../04-now.md`](../04-now.md) §4.1 e §4.2. Decisioni: [`../01-decisions.md`](../01-decisions.md) C1, C1c, C1d, C4, P2.

Questa specifica descrive solo l'interfaccia. Il piano ha priorità: se un punto è in conflitto con il piano, vale il piano.

I punti marcati **[Q1]**…**[Q7]** dipendono da una decisione di prodotto aperta (§12). Il testo dà la proposta. Lo
sviluppo di quei punti parte dopo la risposta di Mattia.

## 0. Riepilogo

| Voce del «Contenuto» di N1 | Dove | Sezione |
|---|---|---|
| Tab Plugin essenziale (admin) | `Settings › Plugin`, `/settings/plugins` | §2 |
| Credenziali Enable Banking per utente | `Settings › Integrations`, sezione «Banche» | §3, §4 |
| Elenco delle banche collegate, «Sincronizza ora», letture automatiche | La stessa sezione «Banche» | §5 |
| Procedura guidata «Collega una banca» | Pagina `/banks/connect` | §6 |
| Flusso di consenso con ritorno | Rotta `/api/v1/plugins/enablebanking/callback`, poi `/banks/connect` | §6.3 |
| Prima sync subito dopo il consenso | Passo «Conti» e passo «Esito» della procedura | §6.4-§6.6 |
| Stati di errore | Tabella unica | §7 |

Fuori da questa specifica: stato a 5 valori, cronologia, registro dell'admin (N2); «È lo stesso conto di…» (N4).
I punti di aggancio sono in §11.

## 1. Regole generali

### 1.1 Visibilità (criterio di accettazione 2)

| Condizione | Admin | Utente |
|---|---|---|
| Nessun plugin registrato, o plugin spento | Vede il tab «Plugin» | **Nessun elemento nuovo**: nessuna sezione «Banche», nessuna voce, nessun avviso. `/banks/connect` risponde 404 |
| Plugin attivo | Tab «Plugin» + sezione «Banche» (anche l'admin è un utente) | Sezione «Banche» in `Settings › Integrations` |

- Il tab «Plugin» compare solo con `ctx.role === "admin"`. La pagina risponde 404 a ogni altro utente (`requireAdmin`), come Users e Server.
- La sezione «Banche» si disegna solo se il plugin è attivo. Il controllo è sul server: la pagina non manda al browser nessun dato del plugin se è spento.
- **[Q1]** Plugin spento dopo l'uso: la sezione «Banche» sparisce anche per chi ha già una banca collegata. Credenziali e collegamenti restano salvati e tornano alla riattivazione. I conti restano visibili con la loro ultima lettura.

### 1.2 Parole

- Vista normale: nessuna parola tecnica. Vietate: «plugin», «sync», «token», «sessione», «API», «JWT», «PEM», «callback», «redirect», «429», «ASPSP», «AIS». Si usano: «banca», «accesso alla banca», «lettura», «credenziali», «chiave privata».
- «Enable Banking», «ID applicazione» e «chiave privata» sono i nomi che l'utente trova sul sito di Enable Banking: restano.
- La parola «plugin» è ammessa solo nel tab «Plugin» (admin).
- Un'azione ha lo stesso nome in pulsante, titolo del dialogo e toast: «Sincronizza ora» → «Sincronizzazione completata».
- Mai il messaggio grezzo della banca o del plugin. Ogni errore ha un codice da una lista chiusa (§7) e un testo fisso tradotto.

### 1.3 Segreti (criterio di accettazione 3)

- ID applicazione e chiave privata sono **di sola scrittura**. Dopo il salvataggio l'interfaccia non mostra nessun valore: né intero, né parziale, né l'impronta, né le ultime cifre.
- Le pagine ricevono solo `{ saved: boolean, savedAt: Date }`. Nessuna prop, nessuno stato React e nessuna risposta di azione contiene i valori.
- I campi seguono il modello di `wallet-card.tsx`: nessun `value`, nessun `defaultValue`, lettura da `FormData` al submit, form smontato alla chiusura del dialogo. Dopo un errore di salvataggio i campi tornano vuoti.
- I segreti non entrano in URL, toast, messaggi di errore, `title`, `aria-label`.

### 1.4 Componenti e token esistenti

Nessun componente nuovo in `src/ui`, nessun token nuovo, nessuna libreria nuova.

| Bisogno | Componente esistente |
|---|---|
| Sezione con titolo a sinistra e card | `SettingsGrid`, `SettingsSection` (`src/ui/section.tsx`), `padded={false}` per le righe |
| Riga di un collegamento | `ConnectionRow` (`settings/integrations/connection-row.tsx`) |
| Tab di Settings | `TabLinks` + elenco in `settings/layout.tsx` |
| Dialogo | `Modal` (`width` 420 / 460 / 520) |
| Campi | `Field`, `Input`, `Textarea`, `Select`, `Checkbox` (`src/ui/input.tsx`, `field.tsx`) |
| Pulsanti | `Button` (`primary`, `secondary`, `danger`; `sm` nelle righe, `md` nella procedura), `ButtonLink`, `LinkButton`, `ActionMenu` |
| Stato | Pallino `size-[7px] rounded-full` + parola di `ConnectionRow`; `Badge` (`pos`, `warn`, `neg`, `neutral`) |
| Vuoto, errore | `EmptyState`, `ErrorState` (`src/ui/states.tsx`); paragrafo `p-4 text-muted` dentro una card |
| Attesa | `Skeleton`; `ProgressBar` con `dashed` (senza fine, senza animazione) |
| Avviso dentro una card | Classi già usate: `rounded-ctl bg-warn-bg px-3 py-2 text-sm text-warn` (`consent-form.tsx:58`) |
| Errore dentro una riga | `<p role="alert" className="border-t border-border px-4 py-2.5 text-sm text-neg">` (`wallet-card.tsx`) |
| Conferma | `notify()` (`src/ui/toast.tsx`) |
| Pagina | `Page` (`src/ui/shell/page.tsx`) con `parent` |
| Data e ora | `formatInstant` (`settings/integrations/format-instant.ts`) |

Token: colori `bg`, `card`, `border`, `fg`, `muted`, `accent`, `primary`, `pos`, `neg`, `warn` e i loro fondi; raggi
`rounded-ctl`, `rounded-card`, `rounded-modal`; testo `text-sm` (12), `text-base` (13), `text-lg` (15), `text-xl` (17),
`text-title` (24). I due temi arrivano dai token: nessun colore fisso nel codice. `text-faint` non si usa per testo che serve a capire uno stato.

Regola di codice (piano §4, tabella iniziale): componenti client senza lettura dati propria; le Server Actions sono un involucro sottile.

## 2. Tab «Plugin» (solo admin)

Rotta `/settings/plugins`. Voce «Plugin» in `settings/layout.tsx`, dopo «Server». Titolo del documento: «Plugin · Impostazioni».

Una sola `SettingsSection`: titolo «Plugin», descrizione «Servizi separati che portano dati in Ledgerly. Un plugin
attivo è disponibile a tutte le persone di questa istanza.». `padded={false}`. Azione sotto la descrizione: «Registra plugin».

### 2.1 Registrazione

Il piano: l'admin aggiunge il servizio al compose e registra l'indirizzo nel tab. In N1 esiste un solo plugin, senza catalogo.

`Modal` 460, titolo «Registra plugin», descrizione «Inserisci l'indirizzo interno del servizio. Ledgerly legge da lì nome e versione.».

| Campo | Tipo | Regole |
|---|---|---|
| Indirizzo | `Input` `type="url"`, `font-mono`, `autoFocus`, segnaposto `http://ledgerly-plugin-enablebanking:8080` | Obbligatorio. Hint: «L'indirizzo del container sulla rete dei plugin. Non è raggiungibile da internet.» |

Pulsanti: «Annulla», «Controlla e registra» (primario). In attesa: «Controllo…», pulsante disattivato.

Esito: il core chiama `GET /manifest`. Se va bene, il dialogo si chiude, la riga compare con stato «Spento» e il toast dice «Plugin registrato». La registrazione **non** attiva il plugin.

| Codice | Testo nel dialogo (`role="alert"`, sopra il campo) |
|---|---|
| `unreachable` | «Nessuna risposta da questo indirizzo. Controlla che il container sia avviato e sulla rete dei plugin.» |
| `invalid_manifest` | «Il servizio ha risposto, ma non è un plugin di Ledgerly.» |
| `unsupported_contract` | «Questo plugin usa una versione del contratto che questa versione di Ledgerly non conosce.» |
| `duplicate` | «Questo plugin è già registrato.» |
| `unauthorized` | «Il plugin ha rifiutato la richiesta. Controlla il segreto condiviso nella configurazione del server.» |

Il segreto condiviso core-plugin non si inserisce dall'interfaccia: sta nella configurazione del server (§13, passaggio 2).

### 2.2 Riga del plugin

Una riga per plugin, griglia come `ConnectionRow` (stesse classi di contenitore; un componente `PluginRow` nella cartella della rotta, non in `src/ui`).

| Colonna | Contenuto |
|---|---|
| Nome e stato | Pallino + nome dal manifest («Enable Banking») + parola di stato. Sotto, `text-sm text-muted`: descrizione dal manifest nella lingua dell'utente |
| Versione | Etichetta «Versione», valore `1.0.0` |
| Ultimo controllo | Etichetta «Ultimo controllo», valore `formatInstant` oppure «Mai» |
| Azioni | Vedi §2.3 |

Sotto la riga, solo con plugin attivo, una riga `border-t px-4 py-2.5 text-sm text-muted`: «{count, plural, =0 {Nessuna persona lo usa ancora.} one {# persona ha collegato una banca.} other {# persone hanno collegato una banca.}}».

| Stato | Pallino | Parola | Tono | Quando |
|---|---|---|---|---|
| `disabled` | `bg-faint` | «Spento» | `muted` | Registrato, non attivo |
| `enabled` | `bg-pos` | «Attivo» | `pos` | Attivo e ultimo controllo riuscito |
| `unreachable` | `bg-neg` | «Non risponde» | `neg` | Attivo, ultimo controllo fallito |
| `incompatible` | `bg-neg` | «Non compatibile» | `neg` | Versione del contratto non accettata |

Con `unreachable` o `incompatible` compare la riga di errore sotto (`role="alert"`):
«Il plugin non risponde dalle {time}. Le letture delle banche sono ferme. Controlla il container.» /
«Il plugin usa una versione del contratto non accettata. Aggiorna il plugin o Ledgerly.»

### 2.3 Azioni

| Stato | Pulsanti | Menu `ActionMenu` |
|---|---|---|
| `disabled` | «Attiva» (primario, `sm`) | «Controlla ora», «Cambia indirizzo» |
| `enabled` | «Disattiva» (`secondary`, `sm`) | «Controlla ora» |
| `unreachable` | «Controlla ora» (`secondary`, `sm`), «Disattiva» | — |
| `incompatible` | «Controlla ora» | «Cambia indirizzo» |

- **Attiva:** nessuna conferma. Il core rilegge il manifest. Riuscito: stato «Attivo», toast «Enable Banking attivato». Fallito: stato invariato, errore nella riga con i codici di §2.1.
- **Disattiva:** `Modal` 420. Titolo «Disattivare Enable Banking?». Testo: «La sezione Banche sparisce per tutti e le letture si fermano. Credenziali, collegamenti, conti e movimenti restano salvati. Alla riattivazione tutto riparte.» Se `count > 0`, in più: «{count, plural, one {# persona ha una banca collegata.} other {# persone hanno una banca collegata.}}». Pulsanti: «Resta attivo», «Disattiva» (`danger`). Toast: «Enable Banking disattivato».
- **Controlla ora:** rilegge il manifest. In attesa il pulsante dice «Controllo…». Toast: «Il plugin risponde» oppure errore nella riga.
- **Cambia indirizzo:** lo stesso dialogo di §2.1 con titolo «Cambia indirizzo» e pulsante «Controlla e salva». Solo a plugin spento.
- Rimozione e aggiornamento dall'interfaccia: non in N1 (piano §4.1).

### 2.4 Stati della pagina

| Stato | Vista |
|---|---|
| Vuoto | Dentro la card: `p-4 text-muted` «Nessun plugin registrato. Aggiungi il servizio al compose, poi registra qui il suo indirizzo.» Il pulsante «Registra plugin» resta sotto la descrizione |
| Caricamento | Rende il server: nessuno scheletro. Le azioni usano `useTransition` e disattivano i pulsanti della riga |
| Errore di lettura | `error.tsx` esistente della rotta |
| Un plugin registrato | Il pulsante «Registra plugin» sparisce (N1 ha un solo plugin). Torna in R5c |

### 2.5 Layout

1440 px (sezione ≥ 672 px: titolo a sinistra, 240 px):

```text
Impostazioni
Profilo  Sicurezza  Integrazioni  Categorie  Dati  Utenti  Server  [Plugin]
──────────────────────────────────────────────────────────────────────────────────────────────
Plugin                     ┌──────────────────────────────────────────────────────────────────┐
Servizi separati che       │ ● Enable Banking  Attivo    Versione   Ultimo controllo          │
portano dati in Ledgerly…  │ Conti e movimenti dalle     1.0.0      oggi 08:10   [Disattiva] ⋯ │
                           │ banche europee                                                   │
                           ├──────────────────────────────────────────────────────────────────┤
                           │ 2 persone hanno collegato una banca.                             │
                           └──────────────────────────────────────────────────────────────────┘
```

400 px (tutto in colonna; le tab vanno a capo su due righe):

```text
Plugin
Servizi separati che portano dati…
[Registra plugin]            ← solo se l'elenco è vuoto
┌──────────────────────────────────┐
│ ● Enable Banking  Attivo         │
│ Conti e movimenti dalle banche…  │
│ Versione            1.0.0        │
│ Ultimo controllo    oggi 08:10   │
│ [Disattiva] [⋯]                  │
├──────────────────────────────────┤
│ 2 persone hanno collegato…       │
└──────────────────────────────────┘
```

## 3. Sezione «Banche» in Settings › Integrations

Posizione: seconda `SettingsSection` della pagina, dopo «Sorgenti dei dati», prima di «Investimenti».
Motivo: in N1 il tab Plugin è solo dell'admin; il tab Finance arriva in R5a (D3). Integrations è il posto dove l'utente trova già le altre sorgenti.

- Titolo: «Banche».
- Descrizione: «Collega i tuoi conti bancari. Ledgerly legge saldi e movimenti e non può fare pagamenti.»
- `padded={false}`. Componente client `BanksCard` nella cartella della rotta, con le props di §3.1.

### 3.1 Dati che la sezione riceve

```ts
type BanksCardProps = {
  credentials: { saved: boolean; savedAt: string | null; invalid: boolean }; // mai i valori
  returnAddress: string; // https://<istanza>/api/v1/plugins/enablebanking/callback
  banks: {
    id: string;            // id del collegamento
    name: string;          // nome della banca
    state: "pending" | "active" | "error" | "expired";
    errorCode: ErrorCode | null;   // §7
    accounts: number;
    lastSync: string | null;       // già formattato
    nextSync: string | null;       // già formattato
    validUntil: string | null;     // già formattato, da expires_at
    retryAt: string | null;        // già formattato, per rate_limited
  }[];
};
```

### 3.2 Le quattro viste della sezione

| Vista | Condizione | Contenuto |
|---|---|---|
| A · Da configurare | `credentials.saved === false` | Guida in 3 passi + «Inserisci credenziali» (§4.1) |
| B · Pronta | Credenziali salvate, nessuna banca | Riga delle credenziali (§4.3) + vuoto con «Collega una banca» |
| C · Con banca | Almeno una banca | Riga delle credenziali + una riga per banca (§5) |
| D · Credenziali non valide | `credentials.invalid === true` | Come B o C, con l'avviso di §4.4 sopra le righe |

Vista A:

```text
┌────────────────────────────────────────────────────────────────────┐
│ Per collegare una banca serve una tua applicazione Enable Banking. │
│ È gratuita per uso personale e si crea una volta sola.             │
│                                                                    │
│ 1. Apri enablebanking.com e crea un account.                       │
│ 2. Registra un'applicazione di tipo Production con questo          │
│    indirizzo di ritorno:                                           │
│    ┌──────────────────────────────────────────────────┐ [Copia]    │
│    │ https://dash.example/api/v1/plugins/…/callback   │            │
│    └──────────────────────────────────────────────────┘            │
│ 3. Copia l'ID applicazione e scarica la chiave privata.            │
│                                                                    │
│ [Inserisci credenziali]                                            │
└────────────────────────────────────────────────────────────────────┘
```

- I tre passi sono una lista `<ol>` vera: è una sequenza.
- L'indirizzo di ritorno è un `Input` `readOnly`, `font-mono`, con `aria-label` «Indirizzo di ritorno». «Copia» è un `Button` `sm`; dopo il clic dice «Copiato» per 2 secondi e annuncia con `aria-live="polite"`.
- «enablebanking.com» è un link esterno (`target="_blank" rel="noopener noreferrer"`), con testo per lettori di schermo «(si apre in una nuova scheda)».
- «È gratuita per uso personale»: da verificare al passo 1 di N1; se non è vero, la frase si toglie.
- Padding della card: `p-4`, colonna `gap-3.5`.

Vista B, vuoto sotto la riga delle credenziali (`border-t`):

```text
│ Nessuna banca collegata.                          [Collega una banca] │
```

`px-4 py-3.5`, testo `text-muted`, pulsante `primary` `sm` a destra; a 400 px il pulsante va sotto il testo.

## 4. Credenziali Enable Banking (per utente)

### 4.1 Dialogo «Credenziali Enable Banking»

`Modal` 520. Titolo «Credenziali Enable Banking». Descrizione: «Sono cifrate e salvate solo per il tuo account. Dopo il salvataggio non vengono più mostrate.»

| Campo | Controllo | Regole |
|---|---|---|
| ID applicazione | `Input` `type="password"`, `font-mono`, `autoComplete="off"`, `spellCheck={false}`, `autoFocus`, `required` | Hint: «Lo trovi nella pagina della tua applicazione su Enable Banking.» |
| Chiave privata | `Textarea` `rows={6}`, `font-mono text-sm`, `autoComplete="off"`, `spellCheck={false}`, `autoCapitalize="off"` | Hint: «Incolla tutto il contenuto del file, dalla prima all'ultima riga.» |
| oppure file | `<input type="file" accept=".pem,.key,.txt">` con etichetta «Oppure scegli il file della chiave» | Se ci sono testo e file, vale il file. Almeno uno dei due è obbligatorio |

- Il file si manda con il form e lo legge il server. Il browser non lo legge e non lo mostra.
- Il campo ID è `type="password"`: il valore non resta leggibile sullo schermo.
- Pulsanti: «Annulla», «Verifica e salva» (primario, `type="submit"`). In attesa: «Verifica…», tutti i controlli disattivati.
- Sotto i campi, `text-sm text-muted`: «Ledgerly usa la chiave solo per leggere i tuoi conti. L'applicazione non permette pagamenti.»

Esito: il core chiama `POST /verify`. Se va bene: salva cifrato, chiude il dialogo, toast «Credenziali salvate», la sezione passa alla vista B.

Errori (in alto nel dialogo, `role="alert"`, `text-sm text-neg`; i campi si svuotano; il focus va al primo campo):

| Codice | Testo |
|---|---|
| `missing` | «Inserisci l'ID applicazione e la chiave privata.» |
| `key_format` | «Questo non sembra il file della chiave privata. Usa il file scaricato da Enable Banking, senza modifiche.» |
| `credentials_invalid` | «Enable Banking non riconosce queste credenziali. Controlla che ID e chiave siano della stessa applicazione e che l'applicazione sia attiva.» |
| `write_not_allowed` | «Questa applicazione permette anche i pagamenti. Ledgerly accetta solo applicazioni di sola lettura.» |
| `unreachable` | «Enable Banking non risponde. Niente è stato salvato. Riprova tra un minuto.» |
| `plugin_down` | «Il collegamento con le banche non è disponibile ora. Riprova più tardi o avvisa l'amministratore.» |
| `failed` | «Non è stato possibile salvare. Riprova.» |

### 4.2 «Sostituisci chiave»

Lo stesso dialogo, con queste differenze:

- Titolo «Sostituisci chiave». Pulsante «Verifica e sostituisci». Toast «Chiave sostituita».
- «ID applicazione» non è obbligatorio. Hint: «Lascia vuoto per tenere l'ID salvato.» Il campo è vuoto: il valore salvato non torna mai al browser.
- Descrizione: «La chiave nuova sostituisce quella salvata. Le banche collegate restano collegate.»
- Se la verifica fallisce, la chiave salvata resta invariata. Il testo lo dice: gli errori di §4.1 finiscono con «La chiave salvata non è cambiata.»

### 4.3 Riga delle credenziali

Prima riga della card nelle viste B, C, D. Griglia semplice, non `ConnectionRow` (non ha sync):

```text
│ Applicazione Enable Banking                 [Sostituisci chiave] [⋯] │
│ Credenziali salvate il 14 nov 2026                                    │
```

- Nome `font-semibold`; sotto `text-sm text-muted` «Credenziali salvate il {date}». Nessun valore, nessuna impronta.
- «Sostituisci chiave»: `Button` `secondary` `sm`.
- Menu: «Rimuovi credenziali» (`danger`). Disattivata se esiste una banca collegata; sotto la voce, o come `title`, «Scollega prima le banche.»
- Conferma di rimozione: `Modal` 420, titolo «Rimuovere le credenziali?», testo «ID applicazione e chiave privata vengono eliminati da Ledgerly. L'applicazione su Enable Banking resta: puoi eliminarla dal loro sito.», pulsanti «Tieni», «Rimuovi» (`danger`). Toast «Credenziali rimosse». La sezione torna alla vista A.

### 4.4 Credenziali non più valide

Quando una lettura fallisce con `auth` (chiave revocata o applicazione disattivata):

- Sopra le righe, avviso `m-4 mb-0 rounded-ctl bg-warn-bg px-3 py-2 text-sm text-warn`, `role="status"`: «La chiave non è più valida. Le letture delle banche sono ferme.» + `LinkButton` «Sostituisci chiave» (apre §4.2).
- Le righe delle banche mostrano lo stato «Errore» senza un secondo messaggio.
- «Sincronizza ora» e «Collega una banca» sono disattivati finché la chiave non è sostituita.
- Dopo una sostituzione riuscita l'avviso sparisce e parte una lettura.

## 5. Banche collegate, «Sincronizza ora», letture automatiche

### 5.1 Riga della banca

Una `ConnectionRow` per banca, sotto la riga delle credenziali (`border-t`).

| Prop | Valore |
|---|---|
| `name` | Nome della banca («BBVA») |
| `role` | «{count, plural, one {# conto} other {# conti}} · accesso valido fino al {date}»; senza data: solo i conti |
| `state` | Vedi tabella sotto |
| `lastSync` | Ultima lettura riuscita, oppure «Mai» |
| `schedule` | Testo fisso, non `ScheduleControl`: riga 1 `font-medium` «3 volte al giorno»; riga 2 `text-muted` «Prossima: {time}» |
| `actions` | «Sincronizza ora» (`secondary`, `sm`) + `ActionMenu`: «Rinnova accesso», «Scollega» (`danger`) |

`ConnectionRow` riceve due modifiche compatibili: le etichette delle colonne diventano props facoltative
(`lastSyncLabel`, `scheduleLabel`), così la riga della banca dice «Ultima lettura» e «Letture automatiche» senza cambiare Wallet e Trek; lo stato accetta una parola e un tono dati dal chiamante.

Stati di N1 (pallino + parola; il modello a 5 valori è di N2, §11):

| `state` | Pallino | Parola | Tono | Riga di dettaglio sotto | Azione in evidenza |
|---|---|---|---|---|---|
| `pending` | `bg-warn` | «Da completare» | `warn` | «Hai dato l'accesso, ma non hai ancora scelto i conti.» | «Scegli i conti» (primario) al posto di «Sincronizza ora» |
| `active` | `bg-pos` | «Collegata» | `pos` | — | «Sincronizza ora» |
| `active` + `rate_limited` | `bg-pos` | «Collegata» | `pos` | «La banca ha raggiunto il limite di letture automatiche. Prossima lettura alle {time}.» (`text-muted`, non è un errore) | «Sincronizza ora» |
| `error` | `bg-neg` | «Errore» | `neg` | Testo del codice, §7 (`role="alert"`) | «Sincronizza ora» come «Riprova» |
| `expired` | `bg-neg` | «Accesso scaduto» | `neg` | «L'accesso alla banca è scaduto.» | «Rinnova accesso» (primario) al posto di «Sincronizza ora» |

### 5.2 «Sincronizza ora»

- Clic: il pulsante dice «Sincronizzazione…» ed è disattivato, come gli altri pulsanti della riga (`useTransition`). `aria-busy="true"` sulla riga.
- La richiesta parte dal browser dell'utente: il core manda gli header `Psu-*` (C1d). L'interfaccia non mostra niente di questo.
- Riuscita: toast «Sincronizzazione completata». «Ultima lettura» si aggiorna. Con movimenti nuovi il toast dice «Sincronizzazione completata: {count, plural, one {# movimento nuovo} other {# movimenti nuovi}}».
- Fallita: nessun toast. Riga di errore sotto la banca con il testo di §7. Il focus resta sul pulsante.
- Già in corso (`busy`): «Una lettura è già in corso. Riprova tra poco.»
- Durante l'attesa di 6 ore il pulsante resta attivo: la lettura con l'utente presente ha un limite separato (misura dello spike). Se anche questa è rifiutata: «La banca non accetta altre letture per ora. Riprova dopo le {time}.» Da confermare sulla banca vera (passo 1 di N1).

### 5.3 Letture automatiche

- Testo fisso nella colonna: «3 volte al giorno». Nessun controllo di pianificazione in N1 (in N2 va sotto «Avanzate»).
- «Prossima: oggi alle 14:00» da `nextSyncAt`. Durante l'attesa di 6 ore mostra l'ora di fine attesa.
- Nella pagina di esito della procedura la stessa informazione è scritta in una frase (§6.6).

### 5.4 «Rinnova accesso» e «Scollega»

- **Rinnova accesso:** apre `/banks/connect?renew=<id>`. La procedura salta la scelta della banca (§6.7).
- **Scollega:** `Modal` 420. Titolo «Scollegare {bank}?». Testo: «L'accesso alla banca viene chiuso. Conti e movimenti restano in Ledgerly e non vengono più aggiornati.» Pulsanti: «Resta collegata», «Scollega» (`danger`). Toast «{bank} scollegata». I conti diventano conti tenuti a mano.

### 5.5 Una sola banca in N1

La chiave unica vecchia resta fino a N2: in N1 un utente collega una sola banca. Con una banca presente il pulsante
«Collega una banca» non c'è. In fondo alla card, `border-t px-4 py-2.5 text-sm text-muted`: «Per ora puoi collegare una sola banca.» N2 toglie la frase e rimette il pulsante (§11).

### 5.6 Layout

1440 px:

```text
Banche                     ┌───────────────────────────────────────────────────────────────────────────┐
Collega i tuoi conti       │ Applicazione Enable Banking                    [Sostituisci chiave]  ⋯   │
bancari. Ledgerly legge    │ Credenziali salvate il 14 nov 2026                                        │
saldi e movimenti e non    ├───────────────────────────────────────────────────────────────────────────┤
può fare pagamenti.        │ ● BBVA  Collegata   Ultima lettura  Letture automatiche                   │
                           │ 2 conti · accesso   oggi 08:02      3 volte al giorno  [Sincronizza ora] ⋯│
                           │ valido fino al                      Prossima: 14:00                       │
                           │ 13 mag 2027                                                               │
                           ├───────────────────────────────────────────────────────────────────────────┤
                           │ Per ora puoi collegare una sola banca.                                    │
                           └───────────────────────────────────────────────────────────────────────────┘
```

400 px: la `ConnectionRow` va in colonna (comportamento esistente sotto 560 px del contenitore):

```text
Banche
Collega i tuoi conti bancari…
┌──────────────────────────────────┐
│ Applicazione Enable Banking      │
│ Credenziali salvate il 14 nov 26 │
│ [Sostituisci chiave] [⋯]         │
├──────────────────────────────────┤
│ ● BBVA  Collegata                │
│ 2 conti · accesso valido fino al │
│ 13 mag 2027                      │
│ Ultima lettura                   │
│ oggi 08:02                       │
│ Letture automatiche              │
│ 3 volte al giorno                │
│ Prossima: 14:00                  │
│ [Sincronizza ora] [⋯]            │
└──────────────────────────────────┘
```

## 6. Procedura guidata «Collega una banca»

### 6.1 Forma

Pagina propria, non un dialogo: `/banks/connect`. Motivi: il flusso esce verso il sito della banca e torna; la pagina
si ricarica senza perdere il punto; un Esc non chiude per errore un passo che ha poco tempo (§6.4).

- `Page` con `title` «Collega una banca» e `parent={{ href: "/settings/integrations", label: "Integrazioni" }}`.
- Una colonna `max-w-[560px]`, allineata a sinistra come il resto dell'app. Una `Card` per passo.
- Il passo è nell'URL: `?step=bank` (default), `?step=accounts&c=<id>`, `?step=done&c=<id>`.
- Sopra la card, indicatore del passo: lista `<ol>` in riga, `text-sm`, tre voci «1 Banca», «2 Conti», «3 Fatto». La voce corrente ha `aria-current="step"` e `font-medium text-fg`; le altre `text-muted`; le fatte hanno l'icona `Check` di lucide (`aria-hidden`) e il testo nascosto «completato».
- A ogni cambio di passo il focus va all'`h1` del passo (`tabIndex={-1}`).
- Ingressi: «Collega una banca» (§3.2 vista B), «Scegli i conti» (§5.1), «Rinnova accesso» (§5.4).

Guardie all'apertura (sul server):

| Condizione | Risposta |
|---|---|
| Plugin non attivo | 404 |
| Credenziali mancanti | Card con «Prima servono le tue credenziali Enable Banking.» + `ButtonLink` primario «Vai alle impostazioni» |
| Credenziali non valide | Card con «La chiave non è più valida.» + `ButtonLink` «Sostituisci chiave» (porta a Integrations e apre §4.2 con `?replace=1`) |
| Una banca già collegata (solo N1) e nessun `renew` o `c` | Redirect a `/settings/integrations` |

### 6.2 Passo 1 · Scelta della banca

```text
1 Banca   2 Conti   3 Fatto

┌────────────────────────────────────────────────────────┐
│ Scegli la tua banca                                    │
│                                                        │
│ Paese            Cerca                                 │
│ [Italia      ▾]  [ Nome della banca              ]     │
│                                                        │
│ ┌────────────────────────────────────────────────────┐ │
│ │ ○ BBVA                                             │ │
│ │ ● Intesa Sanpaolo                                  │ │
│ │ ○ UniCredit                                        │ │
│ │ …                                    (scorre)      │ │
│ └────────────────────────────────────────────────────┘ │
│                                                        │
│ Ti portiamo sul sito della banca per l'accesso.        │
│ Ledgerly non vede il tuo nome utente e la tua          │
│ password. L'accesso vale fino a 180 giorni.            │
│                                                        │
│                  [Annulla] [Continua sul sito di …]    │
└────────────────────────────────────────────────────────┘
```

| Elemento | Regole |
|---|---|
| Paese | `Select`. Default: il paese della lingua dell'utente (`it` → Italia), altrimenti il primo dell'elenco. Al cambio l'elenco si ricarica e la scelta si azzera |
| Cerca | `Input` `type="search"`. Filtra per nome, senza maiuscole e accenti, nel browser. Nessuna richiesta per tasto |
| Elenco | `role="radiogroup"` con `aria-label` «Banche». Ogni banca è un `<label>` con `<input type="radio">` nativo, riga `min-h-11` (44 px), `px-3`, `hover:bg-hover`; la scelta ha `bg-sel`. Altezza massima `max-h-[320px]`, scorrimento interno. Ordine alfabetico |
| Loghi | Nessuno in N1: un'immagine da un sito esterno direbbe a terzi che l'utente apre questa pagina |
| Durata | «L'accesso vale fino a {days} giorni.» con il valore della banca scelta; senza valore la frase non compare |
| Continua | `Button` `primary` `md`. Disattivato senza scelta. Testo «Continua sul sito di {bank}»; senza scelta «Continua» |
| Annulla | `ButtonLink` a `/settings/integrations` |

Stati del passo 1:

| Stato | Vista |
|---|---|
| Caricamento dell'elenco | 6 righe `Skeleton` `h-11`; `role="status"` con testo nascosto «Caricamento delle banche…» |
| Elenco non letto (`unreachable`, `plugin_down`) | Al posto dell'elenco: «Non è stato possibile leggere l'elenco delle banche.» + `Button` «Riprova» |
| Nessuna banca per il paese | «Nessuna banca disponibile per questo paese.» |
| Ricerca senza risultati | «Nessuna banca con "{query}". Controlla il nome o cambia paese.» |
| Invio | Pulsante «Apertura della banca…», tutto disattivato. Poi `window.location.assign(url)` |
| Avvio fallito | Avviso `role="alert"` sopra l'elenco con il testo di §7 (`credentials_invalid`, `bank_unavailable`, `unreachable`, `plugin_down`). La scelta resta |
| Ritorno con errore | Avviso `role="alert"` sopra l'elenco (§6.3). La banca di prima è già scelta |

### 6.3 Ritorno dal consenso

La banca rimanda il browser a `/api/v1/plugins/enablebanking/callback?code&state`. La rotta non disegna niente: fa
`auth/complete` e risponde con un redirect. L'utente non copia nessun codice.

| Esito | Redirect | Cosa vede l'utente |
|---|---|---|
| Riuscito, conti da scegliere | `/banks/connect?step=accounts&c=<id>` | Passo 2 |
| Riuscito, rinnovo senza conti nuovi | `/banks/connect?step=done&c=<id>` dopo la lettura | Esito (§6.7) |
| Consenso rifiutato o annullato | `?step=bank&error=denied&bank=<nome>` | «Non hai dato l'accesso a {bank}. Nessun dato è stato letto. Puoi riprovare.» |
| Tempo scaduto (`state` scaduto) | `?step=bank&error=expired&bank=…` | «È passato troppo tempo. Riparti dalla scelta della banca.» |
| `state` non legato alla sessione | `?step=bank&error=session` | «Questa richiesta non è partita da questa sessione. Riparti dalla scelta della banca.» |
| Sessione di Ledgerly assente | Login, poi `?step=bank&error=session` | Come sopra |
| Nessun conto esposto | `?step=bank&error=no_accounts&bank=…` | §6.5 |
| Errore di rete o del plugin | `?step=bank&error=unreachable&bank=…` | «La banca non ha risposto. Riprova tra un minuto.» |

L'URL di ritorno non contiene `code`, `state` o altri valori della banca: solo il codice di errore e il nome della banca.
Il parametro `error` accetta solo i codici della lista; un valore diverso si ignora.

### 6.4 Passo 2 · Scelta per ogni conto

La banca concede lo storico completo solo nei primi minuti dopo l'accesso (R-8). Il passo è fatto per chiudersi con un
solo clic: ogni conto ha già una scelta valida.

```text
1 Banca ✓   2 Conti   3 Fatto

┌────────────────────────────────────────────────────────┐
│ Scegli i conti di BBVA                                 │
│ La banca ha condiviso 2 conti.                         │
│                                                        │
│ ┌ Conto corrente · IT60 •••• 4821 · EUR ─────────────┐ │
│ │ In Ledgerly                                        │ │
│ │ [Crea un conto nuovo                           ▾]  │ │
│ │ Nome                        Tipo                   │ │
│ │ [BBVA Conto corrente    ]   [Conto corrente   ▾]   │ │
│ └────────────────────────────────────────────────────┘ │
│ ┌ Deposito · IT60 •••• 9930 · EUR ───────────────────┐ │
│ │ In Ledgerly                                        │ │
│ │ [Usa «Risparmi»                                ▾]  │ │
│ │ Da ora saldo e movimenti di «Risparmi» arrivano    │ │
│ │ dalla banca. I saldi già inseriti restano.         │ │
│ └────────────────────────────────────────────────────┘ │
│                                                        │
│ ⚠ Conferma entro pochi minuti: la banca dà lo storico  │
│   completo solo subito dopo l'accesso.                 │
│                                                        │
│                          [Annulla] [Importa 2 conti]   │
└────────────────────────────────────────────────────────┘
```

Ogni conto della banca è un `<fieldset>` con `<legend>` = nome dato dalla banca · IBAN mascherato · valuta.
L'IBAN mostra il paese, le prime due cifre e le ultime quattro: «IT60 •••• 4821». Bordo `border border-border rounded-card p-3`.

| Campo | Controllo | Regole |
|---|---|---|
| In Ledgerly | `Select` | Opzioni: «Crea un conto nuovo» (default); `<optgroup label="Usa un conto esistente">` con i conti ammessi; **[Q3]** «Non importare» |
| Nome | `Input`, `maxLength` come in «Nuovo conto» | Solo con «Crea un conto nuovo». Precompilato: «{bank} {nome dato dalla banca}». Obbligatorio |
| Tipo | `Select` con `accounts.types` | Solo con «Crea un conto nuovo». Default «Conto corrente»; «Deposito» se la banca lo dichiara |

Conti ammessi in «Usa un conto esistente» (stessa regola di `investments.connect.existingHint`): tenuti a mano, non
archiviati, senza un'altra sorgente che li scrive, stessa valuta del conto della banca. Se non ce ne sono, il gruppo non compare.

- Con un conto esistente scelto, sotto il `Select`: `text-sm text-muted` «Da ora saldo e movimenti di «{account}» arrivano dalla banca. I saldi già inseriti restano.»
- **[Q4]** Regola sui saldi inseriti a mano con data dentro lo storico letto dalla banca: il testo sopra vale se restano.
- Lo stesso conto esistente non si sceglie due volte. Errore sul secondo `Select` (`Field` `error`): «Questo conto è già scelto per un altro conto della banca.»
- Con tutti i conti su «Non importare» il pulsante è disattivato e sotto compare «Scegli almeno un conto.»
- Avviso del tempo: classi dell'avviso di §1.4, sempre visibile sopra i pulsanti.
- Pulsante primario: «Importa {count, plural, one {# conto} other {# conti}}» con il numero dei conti non esclusi.
- «Annulla»: `Modal` 420. Titolo «Annullare il collegamento?». Testo: «L'accesso a {bank} viene chiuso e nessun conto viene creato.» Pulsanti: «Continua a scegliere», «Annulla collegamento» (`danger`). Poi `/settings/integrations`.
- Uscita dalla pagina senza conferma: il collegamento resta «Da completare» (§5.1) e si riprende da «Scegli i conti».
- «È lo stesso conto di un conto Wallet»: non c'è in N1. I conti Wallet non compaiono nell'elenco (§11).

Stati del passo 2:

| Stato | Vista |
|---|---|
| Collegamento non trovato o di un altro utente | 404 |
| Collegamento già completato | Redirect a `?step=done&c=<id>` |
| Accesso chiuso prima della scelta (`expired`) | Card: «L'accesso a {bank} è scaduto prima della scelta dei conti.» + `Button` primario «Rinnova accesso» |
| Errore di validazione | Errori sui campi; il focus va al primo campo sbagliato |

### 6.5 Nessun conto esposto

La banca ha dato l'accesso ma non ha condiviso conti. Il collegamento non si salva.

Vista: passo 1 con, al posto dell'elenco, `EmptyState`:

- Titolo: «{bank} non ha condiviso nessun conto».
- Testo: «Durante l'accesso la banca chiede quali conti condividere. Riprova e scegli almeno un conto. Alcuni conti, per esempio i salvadanai, non sono condivisi dalla banca.»
- Azioni: «Riprova con {bank}» (primario, riparte da `auth/start`), «Scegli un'altra banca».

### 6.6 Passo 2 → 3 · Prima sync ed esito

Al clic su «Importa»:

1. Il form si disattiva. La card mostra lo stato di attesa:
   `role="status"`, titolo «Lettura dei movimenti da {bank}…», `ProgressBar` `dashed` con `label` «Lettura in corso», testo
   «Può servire fino a un minuto. Non chiudere questa pagina.»
2. La prima sync gira nella stessa richiesta (piano §4.2). Alla fine: redirect a `?step=done&c=<id>`.

Esito riuscito:

```text
1 Banca ✓   2 Conti ✓   3 Fatto

┌────────────────────────────────────────────────────────┐
│ BBVA è collegata                                       │
│                                                        │
│ BBVA Conto corrente                                    │
│ 312 movimenti dal 3 gen 2025 · saldo 2.481,20 €        │
│ ──────────────────────────────────────────────────     │
│ Risparmi                                               │
│ 18 movimenti dal 3 gen 2025 · saldo 9.000,00 €         │
│                                                        │
│ Ledgerly legge la banca 3 volte al giorno. Per una     │
│ lettura subito usa «Sincronizza ora» in Impostazioni.  │
│ L'accesso vale fino al 13 mag 2027, poi va rinnovato.  │
│                                                        │
│                        [Torna alle impostazioni]       │
│                                    [Vai ai conti]      │
└────────────────────────────────────────────────────────┘
```

- Titolo `text-xl font-semibold`. Elenco `<ul>` dei conti importati: nome `font-medium`, sotto `text-sm text-muted`.
- Gli importi usano il formatter esistente e rispettano «Nascondi importi» se attivo.
- «Vai ai conti»: `ButtonLink` `primary` a `/accounts`. «Torna alle impostazioni»: `ButtonLink` a `/settings/integrations`.
- Un conto senza movimenti: «Nessun movimento · saldo …».

Varianti dell'esito:

| Variante | Titolo | Testo | Azioni |
|---|---|---|---|
| Storico corto (la banca ha dato solo 90 giorni) | «{bank} è collegata» | Avviso `warn` sotto l'elenco: «La banca ha dato solo gli ultimi 90 giorni. Per lo storico completo rinnova l'accesso e conferma i conti subito.» | Come sopra + `LinkButton` «Rinnova accesso» |
| Prima lettura non riuscita (rete, plugin) | «{bank} è collegata, ma la prima lettura non è riuscita» | «I conti sono stati creati senza movimenti. Riprova ora: lo storico completo è disponibile solo per pochi minuti.» | «Riprova ora» (primario), «Torna alle impostazioni» |
| Limite di letture alla prima lettura | «{bank} è collegata» | «La banca ha raggiunto il limite di letture. La prima lettura parte da sola alle {time}. Lo storico può fermarsi agli ultimi 90 giorni.» | «Torna alle impostazioni» |
| Lettura riuscita in parte | «{bank} è collegata» | Sotto il conto senza dati: `text-neg` «Lettura non riuscita. Riparte alla prossima lettura automatica.» | Come l'esito riuscito |

«Riprova ora» mostra di nuovo lo stato di attesa del punto 1.

### 6.7 Rinnovo dell'accesso

`/banks/connect?renew=<id>`: nessuna scelta della banca. La pagina mostra una card:

- Titolo «Rinnova l'accesso a {bank}».
- Testo: «Ti portiamo sul sito della banca. I conti restano gli stessi: non devi sceglierli di nuovo.»
- Pulsanti: «Annulla», «Continua sul sito di {bank}» (primario).

Al ritorno i conti si abbinano da soli (`identification_hash`). L'accesso vecchio si chiude dopo la riuscita del nuovo.

| Caso | Vista |
|---|---|
| Stessi conti | Esito (§6.6) con titolo «Accesso a {bank} rinnovato» e una lettura subito |
| La banca espone un conto nuovo | Passo 2 solo con i conti nuovi; i conti già collegati sono elencati sopra in sola lettura: «Già collegato a «{account}»» |
| Un conto collegato non è più esposto | Nell'esito, sotto quel conto: «La banca non condivide più questo conto. Resta in Ledgerly e non viene più aggiornato.» |
| Rinnovo rifiutato o fallito | Errori di §6.3. Il collegamento vecchio resta com'era |

### 6.8 Layout

- **1440 px:** colonna di 560 px a sinistra dell'area del contenuto; il resto è vuoto. Pulsanti allineati a destra dentro la card, primario per ultimo.
- **400 px:** card a tutta larghezza (`Page` dà il margine). «Paese» e «Cerca» in colonna. «Nome» e «Tipo» in colonna. I pulsanti della card vanno in colonna a tutta larghezza (`flex-col-reverse`: primario sopra). L'indicatore dei passi resta su una riga.
- L'elenco delle banche scorre dentro la card: i pulsanti restano raggiungibili senza scorrere tutto l'elenco.
- Niente scorrimento orizzontale a 400 px: l'IBAN mascherato e i nomi lunghi vanno a capo (`break-words`).

## 7. Stati di errore: tabella unica

Ogni errore ha un codice da questa lista. Il testo è fisso e tradotto. Chiavi in §9.

| Stato richiesto | Codice | Dove compare | Testo | Azione |
|---|---|---|---|---|
| Plugin spento | — | Utente: niente. Admin: tab Plugin | «Spento» | «Attiva» |
| Plugin attivo ma non risponde | `plugin_down` | Riga della banca, dialoghi, procedura | «Il collegamento con le banche non è disponibile ora. Riprova più tardi o avvisa l'amministratore.» | «Riprova» |
| Credenziali mancanti | — | Sezione «Banche» vista A; guardia della procedura | Guida in 3 passi | «Inserisci credenziali» |
| Credenziali non valide all'inserimento | `credentials_invalid`, `key_format`, `write_not_allowed` | Dialogo §4.1 | §4.1 | Correggi e riprova |
| Credenziali non più valide | `auth` | Avviso §4.4; guardia della procedura | «La chiave non è più valida. Le letture delle banche sono ferme.» | «Sostituisci chiave» |
| Consenso rifiutato | `denied` | Passo 1, avviso | «Non hai dato l'accesso a {bank}. Nessun dato è stato letto. Puoi riprovare.» | «Continua sul sito di {bank}» |
| Consenso scaduto | `consent_expired` | Riga della banca, stato «Accesso scaduto» | «L'accesso alla banca è scaduto.» | «Rinnova accesso» |
| Limite di chiamate | `rate_limited` | Riga della banca (dettaglio, non errore); esito | «La banca ha raggiunto il limite di letture automatiche. Prossima lettura alle {time}.» | Nessuna; «Sincronizza ora» resta |
| Errore di rete verso la banca | `provider_down` | Riga della banca; procedura | «La banca non risponde. Ledgerly riprova alla prossima lettura automatica.» | «Sincronizza ora» |
| Errore di rete del browser | `network` | Dove è partita l'azione | «Connessione assente. Controlla la rete e riprova.» | «Riprova» |
| Dati non leggibili | `invalid_data` | Riga della banca | «La banca ha risposto con dati che Ledgerly non sa leggere. Niente è stato cambiato.» | «Sincronizza ora» |
| Nessun conto esposto | `no_accounts` | Procedura §6.5 | «{bank} non ha condiviso nessun conto» | «Riprova con {bank}» |
| Banca non disponibile | `bank_unavailable` | Passo 1 | «{bank} non è disponibile ora. Riprova più tardi o scegli un'altra banca.» | — |
| Lettura già in corso | `busy` | Riga della banca | «Una lettura è già in corso. Riprova tra poco.» | — |
| Altro | `failed` | Ovunque | «Qualcosa non ha funzionato. Riprova.» | «Riprova» |

`auth`, `consent_expired`, `rate_limited`, `provider_down`, `invalid_data` sono i codici di N2 (piano §4.3): N1 li usa già
con gli stessi nomi e gli stessi testi, così N2 non li cambia.

## 8. Tastiera e accessibilità (WCAG 2.2 AA)

| Tema | Regola |
|---|---|
| Ordine di tabulazione | Segue l'ordine visivo. Nella riga: nome → azioni → menu |
| Focus visibile | `focus-ring` su ogni controllo; `focus-ring-inset` nelle righe dell'elenco delle banche |
| Elenco delle banche | Radio nativi: Tab entra nel gruppo, frecce su e giù cambiano la scelta, Spazio sceglie. Invio nel campo «Cerca» non invia il form |
| Invio | Invio dentro un dialogo o un passo invia il form (pulsante primario `type="submit"`) |
| Esc | Chiude i dialoghi (comportamento di `Modal`). Nella procedura Esc non fa niente |
| Focus dopo un'azione | Dialogo chiuso: torna al pulsante che lo ha aperto (`finalFocus` per le voci di `ActionMenu`). Cambio di passo: `h1` del passo. Errore: primo campo sbagliato o avviso |
| Annunci | Errori `role="alert"`. Attese e conferme `role="status"` / `aria-live="polite"` (toast esistenti, «Copiato», stato di lettura) |
| Etichette | Ogni campo ha `Field` con `label` visibile. Il campo file ha un'etichetta propria. I `fieldset` dei conti hanno `legend` |
| Stato non solo con il colore | Ogni pallino ha la parola di stato accanto. Le icone sono `aria-hidden` |
| Bersagli | Pulsanti `sm` 28 px, `md` 32 px, righe dell'elenco 44 px, `LinkButton` 24 px: tutti ≥ 24 px. A 400 px i pulsanti della procedura sono a tutta larghezza |
| Contrasto | Solo token esistenti: `fg`, `muted`, `pos`, `neg`, `warn` su `card` e sui fondi `*-bg` passano 4,5:1 nei due temi. Niente `text-faint` per testo informativo |
| Zoom e riflusso | Nessuno scorrimento orizzontale a 400 px e con testo al 200% |
| Movimento | Nessuna animazione nuova. L'attesa usa `ProgressBar` `dashed`, che è ferma |
| Tempo | Il limite dei minuti è della banca, non dell'app: l'avviso lo dice prima, e l'esito «storico corto» offre il rimedio. Nessun conto alla rovescia |
| Lingua | Nomi delle banche e dei conti non si traducono |
| Campi segreti | `autoComplete="off"`; nessun gestore di password li propone come login (`data-1p-ignore`, `data-lpignore="true"`) |

Test da aggiungere alle specifiche esistenti (G6): `a11y.spec.ts` e `keyboard.spec.ts` su `/settings/plugins`, sulla
sezione «Banche» nelle viste A, B, C e sui tre passi della procedura, a 400 e 1440 px, nei due temi.

## 9. Testi e chiavi di traduzione

File `messages/it.json` e `messages/en.json`. Tre gruppi nuovi: `settings.plugins` (admin), `settings.banks` (sezione e
dialoghi), `banks.connect` (procedura). Voce nuova `settings.tabs.plugins`. «Annulla», «Riprova», «Chiudi» usano
`common.cancel`, `common.retry`, `common.close`. Il nome e la descrizione del plugin arrivano dal manifest (it, en).

### 9.1 `settings.tabs`, `settings.plugins`

| Chiave | Italiano | English |
|---|---|---|
| `settings.tabs.plugins` | Plugin | Plugins |
| `title` | Plugin | Plugins |
| `description` | Servizi separati che portano dati in Ledgerly. Un plugin attivo è disponibile a tutte le persone di questa istanza. | Separate services that bring data into Ledgerly. An active plugin is available to everyone on this instance. |
| `empty` | Nessun plugin registrato. Aggiungi il servizio al compose, poi registra qui il suo indirizzo. | No plugin registered. Add the service to the compose file, then register its address here. |
| `register.open` | Registra plugin | Register plugin |
| `register.title` | Registra plugin | Register plugin |
| `register.description` | Inserisci l'indirizzo interno del servizio. Ledgerly legge da lì nome e versione. | Enter the internal address of the service. Ledgerly reads its name and version from there. |
| `register.address` | Indirizzo | Address |
| `register.addressHint` | L'indirizzo del container sulla rete dei plugin. Non è raggiungibile da internet. | The container's address on the plugin network. It is not reachable from the internet. |
| `register.submit` | Controlla e registra | Check and register |
| `register.checking` | Controllo… | Checking… |
| `address.title` | Cambia indirizzo | Change address |
| `address.submit` | Controlla e salva | Check and save |
| `fields.version` | Versione | Version |
| `fields.lastCheck` | Ultimo controllo | Last check |
| `fields.never` | Mai | Never |
| `states.disabled` | Spento | Off |
| `states.enabled` | Attivo | Active |
| `states.unreachable` | Non risponde | Not responding |
| `states.incompatible` | Non compatibile | Not compatible |
| `detail.unreachable` | Il plugin non risponde dalle {time}. Le letture delle banche sono ferme. Controlla il container. | The plugin has not responded since {time}. Bank readings are stopped. Check the container. |
| `detail.incompatible` | Il plugin usa una versione del contratto non accettata. Aggiorna il plugin o Ledgerly. | The plugin uses a contract version that is not accepted. Update the plugin or Ledgerly. |
| `users` | {count, plural, =0 {Nessuna persona lo usa ancora.} one {# persona ha collegato una banca.} other {# persone hanno collegato una banca.}} | {count, plural, =0 {Nobody uses it yet.} one {# person has connected a bank.} other {# people have connected a bank.}} |
| `actions.enable` | Attiva | Turn on |
| `actions.disable` | Disattiva | Turn off |
| `actions.check` | Controlla ora | Check now |
| `actions.changeAddress` | Cambia indirizzo | Change address |
| `disable.title` | Disattivare {name}? | Turn off {name}? |
| `disable.description` | La sezione Banche sparisce per tutti e le letture si fermano. Credenziali, collegamenti, conti e movimenti restano salvati. Alla riattivazione tutto riparte. | The Banks section disappears for everyone and readings stop. Credentials, connections, accounts and transactions stay saved. Everything resumes when you turn it on again. |
| `disable.users` | {count, plural, one {# persona ha una banca collegata.} other {# persone hanno una banca collegata.}} | {count, plural, one {# person has a bank connected.} other {# people have a bank connected.}} |
| `disable.cancel` | Resta attivo | Keep it on |
| `disable.confirm` | Disattiva | Turn off |
| `toasts.registered` | Plugin registrato | Plugin registered |
| `toasts.enabled` | {name} attivato | {name} turned on |
| `toasts.disabled` | {name} disattivato | {name} turned off |
| `toasts.checked` | Il plugin risponde | The plugin responds |
| `toasts.addressSaved` | Indirizzo salvato | Address saved |
| `errors.unreachable` | Nessuna risposta da questo indirizzo. Controlla che il container sia avviato e sulla rete dei plugin. | No response from this address. Check that the container is running and on the plugin network. |
| `errors.invalidManifest` | Il servizio ha risposto, ma non è un plugin di Ledgerly. | The service responded, but it is not a Ledgerly plugin. |
| `errors.unsupportedContract` | Questo plugin usa una versione del contratto che questa versione di Ledgerly non conosce. | This plugin uses a contract version that this version of Ledgerly does not know. |
| `errors.duplicate` | Questo plugin è già registrato. | This plugin is already registered. |
| `errors.unauthorized` | Il plugin ha rifiutato la richiesta. Controlla il segreto condiviso nella configurazione del server. | The plugin refused the request. Check the shared secret in the server configuration. |
| `errors.failed` | Non è stato possibile salvare. Riprova. | Couldn't save. Try again. |

### 9.2 `settings.banks`

| Chiave | Italiano | English |
|---|---|---|
| `title` | Banche | Banks |
| `description` | Collega i tuoi conti bancari. Ledgerly legge saldi e movimenti e non può fare pagamenti. | Connect your bank accounts. Ledgerly reads balances and transactions and cannot make payments. |
| `setup.intro` | Per collegare una banca serve una tua applicazione Enable Banking. È gratuita per uso personale e si crea una volta sola. | To connect a bank you need your own Enable Banking application. It is free for personal use and you create it once. |
| `setup.step1` | Apri <link>enablebanking.com</link> e crea un account. | Open <link>enablebanking.com</link> and create an account. |
| `setup.step2` | Registra un'applicazione di tipo Production con questo indirizzo di ritorno: | Register a Production application with this return address: |
| `setup.step3` | Copia l'ID applicazione e scarica la chiave privata. | Copy the application ID and download the private key. |
| `setup.returnAddress` | Indirizzo di ritorno | Return address |
| `setup.copy` | Copia | Copy |
| `setup.copied` | Copiato | Copied |
| `setup.newTab` | (si apre in una nuova scheda) | (opens in a new tab) |
| `setup.open` | Inserisci credenziali | Enter credentials |
| `credentials.title` | Credenziali Enable Banking | Enable Banking credentials |
| `credentials.description` | Sono cifrate e salvate solo per il tuo account. Dopo il salvataggio non vengono più mostrate. | They are encrypted and saved for your account only. They are never shown again after saving. |
| `credentials.appId` | ID applicazione | Application ID |
| `credentials.appIdHint` | Lo trovi nella pagina della tua applicazione su Enable Banking. | You find it on your application's page on Enable Banking. |
| `credentials.appIdKeep` | Lascia vuoto per tenere l'ID salvato. | Leave empty to keep the saved ID. |
| `credentials.key` | Chiave privata | Private key |
| `credentials.keyHint` | Incolla tutto il contenuto del file, dalla prima all'ultima riga. | Paste the whole content of the file, from the first line to the last. |
| `credentials.keyFile` | Oppure scegli il file della chiave | Or choose the key file |
| `credentials.readOnlyNote` | Ledgerly usa la chiave solo per leggere i tuoi conti. L'applicazione non permette pagamenti. | Ledgerly uses the key only to read your accounts. The application does not allow payments. |
| `credentials.submit` | Verifica e salva | Verify and save |
| `credentials.checking` | Verifica… | Verifying… |
| `replace.title` | Sostituisci chiave | Replace key |
| `replace.description` | La chiave nuova sostituisce quella salvata. Le banche collegate restano collegate. | The new key replaces the saved one. Connected banks stay connected. |
| `replace.submit` | Verifica e sostituisci | Verify and replace |
| `replace.unchanged` | La chiave salvata non è cambiata. | The saved key has not changed. |
| `application.name` | Applicazione Enable Banking | Enable Banking application |
| `application.savedOn` | Credenziali salvate il {date} | Credentials saved on {date} |
| `application.remove` | Rimuovi credenziali | Remove credentials |
| `application.removeBlocked` | Scollega prima le banche. | Disconnect the banks first. |
| `remove.title` | Rimuovere le credenziali? | Remove the credentials? |
| `remove.description` | ID applicazione e chiave privata vengono eliminati da Ledgerly. L'applicazione su Enable Banking resta: puoi eliminarla dal loro sito. | The application ID and the private key are deleted from Ledgerly. The application on Enable Banking stays: you can delete it on their site. |
| `remove.cancel` | Tieni | Keep |
| `remove.confirm` | Rimuovi | Remove |
| `invalidKey` | La chiave non è più valida. Le letture delle banche sono ferme. | The key is no longer valid. Bank readings are stopped. |
| `empty` | Nessuna banca collegata. | No bank connected. |
| `connect` | Collega una banca | Connect a bank |
| `oneBank` | Per ora puoi collegare una sola banca. | For now you can connect one bank only. |
| `row.role` | {count, plural, one {# conto} other {# conti}} | {count, plural, one {# account} other {# accounts}} |
| `row.validUntil` | accesso valido fino al {date} | access valid until {date} |
| `row.lastSync` | Ultima lettura | Last reading |
| `row.schedule` | Letture automatiche | Automatic readings |
| `row.scheduleValue` | 3 volte al giorno | 3 times a day |
| `row.next` | Prossima: {time} | Next: {time} |
| `states.pending` | Da completare | To complete |
| `states.active` | Collegata | Connected |
| `states.error` | Errore | Error |
| `states.expired` | Accesso scaduto | Access expired |
| `detail.pending` | Hai dato l'accesso, ma non hai ancora scelto i conti. | You gave access, but you have not chosen the accounts yet. |
| `detail.expired` | L'accesso alla banca è scaduto. | Access to the bank has expired. |
| `detail.rateLimited` | La banca ha raggiunto il limite di letture automatiche. Prossima lettura alle {time}. | The bank reached its limit of automatic readings. Next reading at {time}. |
| `actions.sync` | Sincronizza ora | Sync now |
| `actions.syncing` | Sincronizzazione… | Syncing… |
| `actions.renew` | Rinnova accesso | Renew access |
| `actions.chooseAccounts` | Scegli i conti | Choose accounts |
| `actions.disconnect` | Scollega | Disconnect |
| `actions.replaceKey` | Sostituisci chiave | Replace key |
| `disconnect.title` | Scollegare {bank}? | Disconnect {bank}? |
| `disconnect.description` | L'accesso alla banca viene chiuso. Conti e movimenti restano in Ledgerly e non vengono più aggiornati. | Access to the bank is closed. Accounts and transactions stay in Ledgerly and are no longer updated. |
| `disconnect.cancel` | Resta collegata | Stay connected |
| `disconnect.confirm` | Scollega | Disconnect |
| `toasts.saved` | Credenziali salvate | Credentials saved |
| `toasts.replaced` | Chiave sostituita | Key replaced |
| `toasts.removed` | Credenziali rimosse | Credentials removed |
| `toasts.synced` | Sincronizzazione completata | Sync completed |
| `toasts.syncedNew` | Sincronizzazione completata: {count, plural, one {# movimento nuovo} other {# movimenti nuovi}} | Sync completed: {count, plural, one {# new transaction} other {# new transactions}} |
| `toasts.disconnected` | {bank} scollegata | {bank} disconnected |
| `errors.missing` | Inserisci l'ID applicazione e la chiave privata. | Enter the application ID and the private key. |
| `errors.keyFormat` | Questo non sembra il file della chiave privata. Usa il file scaricato da Enable Banking, senza modifiche. | This does not look like the private key file. Use the file downloaded from Enable Banking, unchanged. |
| `errors.credentialsInvalid` | Enable Banking non riconosce queste credenziali. Controlla che ID e chiave siano della stessa applicazione e che l'applicazione sia attiva. | Enable Banking does not recognise these credentials. Check that the ID and the key belong to the same application and that the application is active. |
| `errors.writeNotAllowed` | Questa applicazione permette anche i pagamenti. Ledgerly accetta solo applicazioni di sola lettura. | This application also allows payments. Ledgerly accepts read-only applications only. |
| `errors.unreachable` | Enable Banking non risponde. Niente è stato salvato. Riprova tra un minuto. | Enable Banking is not responding. Nothing was saved. Try again in a minute. |
| `errors.pluginDown` | Il collegamento con le banche non è disponibile ora. Riprova più tardi o avvisa l'amministratore. | The connection to banks is not available now. Try again later or tell the administrator. |
| `errors.providerDown` | La banca non risponde. Ledgerly riprova alla prossima lettura automatica. | The bank is not responding. Ledgerly tries again at the next automatic reading. |
| `errors.rateLimitedNow` | La banca non accetta altre letture per ora. Riprova dopo le {time}. | The bank accepts no more readings for now. Try again after {time}. |
| `errors.invalidData` | La banca ha risposto con dati che Ledgerly non sa leggere. Niente è stato cambiato. | The bank answered with data that Ledgerly cannot read. Nothing was changed. |
| `errors.busy` | Una lettura è già in corso. Riprova tra poco. | A reading is already running. Try again shortly. |
| `errors.network` | Connessione assente. Controlla la rete e riprova. | No connection. Check the network and try again. |
| `errors.failed` | Qualcosa non ha funzionato. Riprova. | Something went wrong. Try again. |

### 9.3 `banks.connect`

| Chiave | Italiano | English |
|---|---|---|
| `title` | Collega una banca | Connect a bank |
| `steps.label` | Passi | Steps |
| `steps.bank` | Banca | Bank |
| `steps.accounts` | Conti | Accounts |
| `steps.done` | Fatto | Done |
| `steps.completed` | completato | completed |
| `guard.noCredentials` | Prima servono le tue credenziali Enable Banking. | First you need your Enable Banking credentials. |
| `guard.openSettings` | Vai alle impostazioni | Go to settings |
| `guard.invalidKey` | La chiave non è più valida. | The key is no longer valid. |
| `bank.heading` | Scegli la tua banca | Choose your bank |
| `bank.country` | Paese | Country |
| `bank.search` | Cerca | Search |
| `bank.searchPlaceholder` | Nome della banca | Bank name |
| `bank.list` | Banche | Banks |
| `bank.loading` | Caricamento delle banche… | Loading banks… |
| `bank.loadFailed` | Non è stato possibile leggere l'elenco delle banche. | Couldn't read the list of banks. |
| `bank.noneForCountry` | Nessuna banca disponibile per questo paese. | No bank available for this country. |
| `bank.noMatch` | Nessuna banca con "{query}". Controlla il nome o cambia paese. | No bank matching "{query}". Check the name or change the country. |
| `bank.privacy` | Ti portiamo sul sito della banca per l'accesso. Ledgerly non vede il tuo nome utente e la tua password. | We take you to the bank's site to sign in. Ledgerly does not see your username and password. |
| `bank.duration` | L'accesso vale fino a {days} giorni. | Access lasts up to {days} days. |
| `bank.continue` | Continua | Continue |
| `bank.continueTo` | Continua sul sito di {bank} | Continue on the {bank} site |
| `bank.opening` | Apertura della banca… | Opening the bank… |
| `return.denied` | Non hai dato l'accesso a {bank}. Nessun dato è stato letto. Puoi riprovare. | You did not give access to {bank}. No data was read. You can try again. |
| `return.expired` | È passato troppo tempo. Riparti dalla scelta della banca. | Too much time has passed. Start again from the choice of the bank. |
| `return.session` | Questa richiesta non è partita da questa sessione. Riparti dalla scelta della banca. | This request did not start from this session. Start again from the choice of the bank. |
| `return.unreachable` | La banca non ha risposto. Riprova tra un minuto. | The bank did not respond. Try again in a minute. |
| `return.bankUnavailable` | {bank} non è disponibile ora. Riprova più tardi o scegli un'altra banca. | {bank} is not available now. Try again later or choose another bank. |
| `noAccounts.title` | {bank} non ha condiviso nessun conto | {bank} shared no accounts |
| `noAccounts.description` | Durante l'accesso la banca chiede quali conti condividere. Riprova e scegli almeno un conto. Alcuni conti, per esempio i salvadanai, non sono condivisi dalla banca. | During sign-in the bank asks which accounts to share. Try again and choose at least one account. Some accounts, for example savings pots, are not shared by the bank. |
| `noAccounts.retry` | Riprova con {bank} | Try again with {bank} |
| `noAccounts.other` | Scegli un'altra banca | Choose another bank |
| `accounts.heading` | Scegli i conti di {bank} | Choose the accounts of {bank} |
| `accounts.count` | {count, plural, one {La banca ha condiviso # conto.} other {La banca ha condiviso # conti.}} | {count, plural, one {The bank shared # account.} other {The bank shared # accounts.}} |
| `accounts.target` | In Ledgerly | In Ledgerly |
| `accounts.new` | Crea un conto nuovo | Create a new account |
| `accounts.existingGroup` | Usa un conto esistente | Use an existing account |
| `accounts.existing` | Usa «{account}» | Use "{account}" |
| `accounts.skip` | Non importare | Do not import |
| `accounts.name` | Nome | Name |
| `accounts.type` | Tipo | Type |
| `accounts.defaultName` | {bank} {name} | {bank} {name} |
| `accounts.existingNote` | Da ora saldo e movimenti di «{account}» arrivano dalla banca. I saldi già inseriti restano. | From now on the balance and the transactions of "{account}" come from the bank. The balances already entered stay. |
| `accounts.duplicate` | Questo conto è già scelto per un altro conto della banca. | This account is already chosen for another account of the bank. |
| `accounts.none` | Scegli almeno un conto. | Choose at least one account. |
| `accounts.hurry` | Conferma entro pochi minuti: la banca dà lo storico completo solo subito dopo l'accesso. | Confirm within a few minutes: the bank gives the full history only right after sign-in. |
| `accounts.submit` | {count, plural, one {Importa # conto} other {Importa # conti}} | {count, plural, one {Import # account} other {Import # accounts}} |
| `accounts.expired` | L'accesso a {bank} è scaduto prima della scelta dei conti. | Access to {bank} expired before the accounts were chosen. |
| `accounts.linked` | Già collegato a «{account}» | Already linked to "{account}" |
| `cancel.title` | Annullare il collegamento? | Cancel the connection? |
| `cancel.description` | L'accesso a {bank} viene chiuso e nessun conto viene creato. | Access to {bank} is closed and no account is created. |
| `cancel.back` | Continua a scegliere | Keep choosing |
| `cancel.confirm` | Annulla collegamento | Cancel connection |
| `sync.heading` | Lettura dei movimenti da {bank}… | Reading transactions from {bank}… |
| `sync.progress` | Lettura in corso | Reading in progress |
| `sync.wait` | Può servire fino a un minuto. Non chiudere questa pagina. | It can take up to a minute. Do not close this page. |
| `done.heading` | {bank} è collegata | {bank} is connected |
| `done.renewed` | Accesso a {bank} rinnovato | Access to {bank} renewed |
| `done.account` | {count, plural, =0 {Nessun movimento} one {# movimento dal {date}} other {# movimenti dal {date}}} · saldo {balance} | {count, plural, =0 {No transactions} one {# transaction since {date}} other {# transactions since {date}}} · balance {balance} |
| `done.schedule` | Ledgerly legge la banca 3 volte al giorno. Per una lettura subito usa «Sincronizza ora» in Impostazioni. | Ledgerly reads the bank 3 times a day. For a reading right now use "Sync now" in Settings. |
| `done.validUntil` | L'accesso vale fino al {date}, poi va rinnovato. | Access is valid until {date}, then you renew it. |
| `done.toAccounts` | Vai ai conti | Go to accounts |
| `done.toSettings` | Torna alle impostazioni | Back to settings |
| `done.shortHistory` | La banca ha dato solo gli ultimi 90 giorni. Per lo storico completo rinnova l'accesso e conferma i conti subito. | The bank gave only the last 90 days. For the full history renew access and confirm the accounts at once. |
| `done.syncFailedHeading` | {bank} è collegata, ma la prima lettura non è riuscita | {bank} is connected, but the first reading failed |
| `done.syncFailed` | I conti sono stati creati senza movimenti. Riprova ora: lo storico completo è disponibile solo per pochi minuti. | The accounts were created without transactions. Try again now: the full history is available for a few minutes only. |
| `done.retryNow` | Riprova ora | Try again now |
| `done.rateLimited` | La banca ha raggiunto il limite di letture. La prima lettura parte da sola alle {time}. Lo storico può fermarsi agli ultimi 90 giorni. | The bank reached its reading limit. The first reading starts by itself at {time}. The history may stop at the last 90 days. |
| `done.accountFailed` | Lettura non riuscita. Riparte alla prossima lettura automatica. | Reading failed. It starts again at the next automatic reading. |
| `done.accountGone` | La banca non condivide più questo conto. Resta in Ledgerly e non viene più aggiornato. | The bank no longer shares this account. It stays in Ledgerly and is no longer updated. |
| `renew.heading` | Rinnova l'accesso a {bank} | Renew access to {bank} |
| `renew.description` | Ti portiamo sul sito della banca. I conti restano gli stessi: non devi sceglierli di nuovo. | We take you to the bank's site. The accounts stay the same: you do not choose them again. |

## 10. Verifica dei criteri di accettazione

| Criterio dell'issue | Dove è coperto |
|---|---|
| 1 · Ogni voce di interfaccia del «Contenuto» di N1 ha una sezione, con stati e testi | §0 (mappa), §2-§7, §9 |
| 2 · Senza plugin attivo l'utente non vede nessun elemento nuovo | §1.1, guardie di §6.1 |
| 3 · Le credenziali non compaiono mai in chiaro dopo il salvataggio | §1.3, §4.1-§4.3 |

Criteri di N1 in `03-releases.md` che l'interfaccia deve rispettare: 1 (nessun codice copiato a mano: §6.3), 2 (storico
oltre 90 giorni: §6.4, §6.6), 5 e 6 (credenziali: §1.3; ogni utente vede solo la sua sezione), 7 (§1.1).

## 11. Punti di aggancio per N2 e N4

| Rilascio | Punto | Cosa cambia |
|---|---|---|
| N2 | Cella di stato della riga della banca (§5.1) | Il pallino e la parola diventano lo stato a 5 valori (`SyncStatus`). Codici e testi di §7 restano |
| N2 | Sotto la riga della banca | Posto della cronologia semplice (10 righe). In N1 è vuoto |
| N2 | Colonna «Letture automatiche» (§5.3) | La pianificazione va sotto «Avanzate» |
| N2 | §5.5 | La frase «una sola banca» sparisce; «Collega una banca» torna sempre visibile; la guardia di §6.1 cade |
| N2 | Avvisi di scadenza a 14 e 3 giorni | Usano la data «accesso valido fino al» già presente nella riga |
| N2 | Tab Plugin | Nessun registro in N1. Il registro grezzo va in Server › Diagnostica |
| N4 | `Select` «In Ledgerly» (§6.4) | Si aggiunge il gruppo «È lo stesso conto di…» con i conti Wallet |

## 12. Domande per Mattia

Decisioni di prodotto che il piano non scrive. Ogni voce ha la proposta usata nel testo.

| # | Domanda | Proposta | Alternativa |
|---|---|---|---|
| Q1 | Plugin disattivato dopo l'uso: cosa vede chi ha già una banca collegata? | Niente: la sezione «Banche» sparisce; i dati restano e tornano alla riattivazione | La sezione resta in sola lettura con l'avviso «Le letture sono in pausa» |
| Q2 | «Scollega» una banca e «Rimuovi credenziali» sono in N1? | Sì, tutti e due. «Rimuovi credenziali» solo senza banche collegate | Solo «Sostituisci chiave»; scollegamento e rimozione in N2 |
| Q3 | Nella scelta dei conti esiste «Non importare» per un conto esposto dalla banca? | Sì | No: ogni conto esposto diventa un conto nuovo o un conto esistente |
| Q4 | Conto manuale esistente collegato alla banca: cosa succede ai saldi inseriti a mano nelle date coperte dalla banca? | Restano; da quella data vale la banca | La procedura chiede una data di taglio |
| Q5 | Un ingresso alla procedura anche da Accounts («Aggiungi conto» › «Collega una banca»)? | No in N1: un solo ingresso, in Settings › Integrations | Sì, visibile solo con plugin attivo |
| Q6 | Applicazione Enable Banking che permette anche i pagamenti: si rifiuta? | Sì, si rifiuta, come le chiavi di eToro e Binance | Si accetta con una conferma esplicita |
| Q7 | La sezione «Banche» sta in Settings › Integrations fino a R5a? | Sì | Il tab «Plugin» diventa visibile a tutti già in N1, con la sezione dentro |

## 13. Passaggi per lo sviluppo

Non sono decisioni di prodotto: sono dati che l'interfaccia richiede e che il piano non elenca.

1. **Elenco delle banche.** Il passo 1 ha bisogno di «banche per paese» (nome, paese, durata massima dell'accesso). Il contratto v1 di `04-now.md` §4.1 non ha una chiamata per questo: va aggiunta al contratto o ai campi del collegamento nel manifest.
2. **Segreto condiviso core-plugin.** L'interfaccia non lo chiede: resta nella configurazione del server.
3. **Collegamento «Da completare».** Tra `auth/complete` e la scelta dei conti il collegamento esiste senza conti: serve uno stato per questo (§5.1, §6.4).
4. **Dati dell'esito.** Per ogni conto: numero di movimenti, data del più vecchio, saldo, esito della lettura; per il collegamento: «storico corto sì o no» (§6.6).
5. **`ConnectionRow`.** Due props facoltative per le etichette e stato con parola e tono dati dal chiamante (§5.1). Wallet e Trek non cambiano.
6. **Movimento.** `globals.css` non ha una regola `prefers-reduced-motion` per `animate-shimmer` e `animate-in`. Non è di N1; va aperta una voce a parte.
7. **Da misurare al passo 1 di N1:** minuti reali della finestra dello storico; limite separato per le letture con l'utente presente; costo dell'applicazione per uso personale. Tre testi dipendono da queste misure (`accounts.hurry`, `errors.rateLimitedNow`, `setup.intro`).

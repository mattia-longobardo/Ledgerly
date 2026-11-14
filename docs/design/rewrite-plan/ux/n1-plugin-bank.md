# N1 · Specifica UX: plugin Enable Banking per utente e «Collega una banca»

Indice del piano: [`../../rewrite-plan.md`](../../rewrite-plan.md). Rilascio: [`../03-releases.md`](../03-releases.md) «N1».
Regole tecniche: [`../04-now.md`](../04-now.md) §4.1 e §4.2. Decisioni: [`../01-decisions.md`](../01-decisions.md) C1, C1c, C1d, C4, P2, H25, H26.

Questa specifica descrive solo l'interfaccia. Il piano ha priorità: se un punto è in conflitto con il piano, vale il piano.

Revisione del 14/11/2026: applica le decisioni di Mattia sulle domande Q1-Q7 (§12). La regola nuova è H25: nessun passo
dell'admin, ogni utente attiva il plugin per sé. Le domande nate da H25 sono decise: punti di N1 in §14, effetti sugli altri
rilasci in §15 (decisioni H27-H30). Nessuna domanda è aperta.

## 0. Riepilogo

| Voce del «Contenuto» di N1 | Dove | Sezione |
|---|---|---|
| Voce del plugin per utente: «Attiva», «Disattiva» (H25; sostituisce il «tab Plugin essenziale (admin)») | `Settings › Integrations`, sezione «Sorgenti dei dati» | §2 |
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

Nessun elemento di N1 è riservato all'admin. L'admin è un utente come gli altri: attiva il plugin per sé, se lo vuole.

| Stato per l'utente | Voce «Enable Banking» | Sezione «Banche» | `/banks/connect` |
|---|---|---|---|
| Plugin non presente nell'istanza | Assente | Assente | 404 |
| Disponibile (mai attivato) | Presente, «Non attivo» | Assente | 404 |
| Attivo | Presente, «Attivo» | Presente | Aperta |
| Disattivato dopo l'uso | Presente, «Non attivo», con riga di dettaglio | Assente | 404 |

- Un utente che non attiva il plugin vede un solo elemento nuovo: la voce «Enable Banking · Non attivo» in `Settings › Integrations`. Il resto dell'app è come prima.
- La sezione «Banche» si disegna solo se il plugin è attivo per quell'utente. Il controllo è sul server: la pagina non manda al browser nessun dato del plugin se non è attivo.
- L'attivazione di un utente non cambia niente per gli altri utenti.
- Disattivato dopo l'uso: la sezione «Banche» sparisce e le letture si fermano. Conti e movimenti restano visibili con la loro ultima lettura e tornano aggiornati alla riattivazione (§2.4).

### 1.2 Parole

- Vista normale: nessuna parola tecnica. Vietate: «plugin», «sync», «token», «sessione», «API», «JWT», «PEM», «callback», «redirect», «429», «ASPSP», «AIS». Si usano: «banca», «accesso alla banca», «lettura», «credenziali», «chiave privata».
- «Enable Banking», «ID applicazione» e «chiave privata» sono i nomi che l'utente trova sul sito di Enable Banking: restano.
- La parola «plugin» non compare nelle schermate di N1: la voce porta il nome del fornitore («Enable Banking») e la descrizione del manifest.
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

## 2. Voce «Enable Banking» in Settings › Integrations (per utente)

Decisione H25: l'admin non fa niente nell'interfaccia. Il plugin è già nell'istanza e non è attivo. Ogni utente lo
attiva per sé e lo gestisce da solo, come fa oggi con Trek. Non esiste un tab «Plugin» in N1 e non esiste la rotta `/settings/plugins`.

Posizione: una riga nella sezione esistente «Sorgenti dei dati», dopo Wallet e Trek. Componente client `PluginRow`
nella cartella della rotta, non in `src/ui`. Nome e descrizione arrivano dal manifest, nella lingua dell'utente.

### 2.1 Da dove arriva il plugin

- Il container del plugin fa parte dell'installazione standard dell'istanza (compose dello stack).
- Il core conosce il plugin dalla configurazione del server e ne legge il manifest da solo. L'interfaccia non chiede indirizzi e non chiede il segreto condiviso (§13, passaggi 2 e 8).
- La voce compare a ogni utente quando il core ha letto il manifest almeno una volta. Senza manifest la voce non compare: l'app è come prima.
- Nessun utente installa, registra, aggiorna o rimuove un plugin dall'interfaccia. L'aggiornamento arriva con l'aggiornamento dell'istanza.

### 2.2 Stati per utente

Lo stato è dell'utente, non dell'istanza: due utenti della stessa istanza hanno stati diversi.

| Stato | Condizione | Pallino | Parola | Tono | Riga di dettaglio | Sezione «Banche» |
|---|---|---|---|---|---|---|
| `available` · Disponibile | L'utente non lo ha mai attivato, oppure lo ha disattivato senza credenziali salvate | `bg-faint` | «Non attivo» | `muted` | — | Assente |
| `active` · Attivo senza credenziali | Attivo, nessuna credenziale salvata | `bg-pos` | «Attivo» | `pos` | — | Vista A (§3.2) |
| `active` · Attivo | Attivo, credenziali salvate | `bg-pos` | «Attivo» | `pos` | — | Viste B, C, D (§3.2) |
| `paused` · Disattivato dopo l'uso | Non attivo, con credenziali o banche salvate | `bg-faint` | «Non attivo» | `muted` | «Le letture sono ferme dal {date}. Credenziali e collegamenti sono salvati.» | Assente |

- La riga di dettaglio usa `border-t border-border px-4 py-2.5 text-sm text-muted`. Non è un errore: nessun `role="alert"`.
- Un plugin che non risponde non cambia lo stato della riga. L'utente attivo vede l'errore `plugin_down` dove fa un'azione (§7). Nessuna schermata di N1 mostra lo stato del plugin a chi gestisce l'istanza (decisione A2).

### 2.3 Azioni

| Stato | Pulsante | Menu `ActionMenu` |
|---|---|---|
| `available` | «Attiva» (`primary`, `sm`) | — |
| `active` | — | «Disattiva» |
| `paused` | «Attiva» (`primary`, `sm`) | — |

- **Attiva:** nessuna conferma e nessuna chiamata al plugin: è una preferenza dell'utente. Toast «{name} attivato». La sezione «Banche» compare sotto, il focus va al suo titolo.
  - Da `available`: la sezione apre nella vista A (guida in 3 passi).
  - Da `paused`: la sezione torna com'era. Parte una lettura per ogni banca collegata. Un accesso scaduto nel frattempo mostra «Accesso scaduto» e «Rinnova accesso» (§5.1).
- **Disattiva senza credenziali salvate:** nessuna conferma. La riga torna a `available`. Toast «{name} disattivato».
- **Disattiva con credenziali salvate:** `Modal` 420. Titolo «Disattivare {name}?». Testo: «Le letture di {name} si fermano e la sua sezione sparisce dalle impostazioni. Credenziali, collegamenti, conti e movimenti restano salvati. Alla riattivazione tutto riparte.» Con banche collegate, in più: «{count, plural, one {Hai # collegamento attivo.} other {Hai # collegamenti attivi.}}». Pulsanti: «Resta attivo», «Disattiva» (`danger`). Toast «{name} disattivato».
- Una lettura già in corso al momento della disattivazione finisce. Non ne partono altre.
- Per eliminare tutto, l'utente usa prima «Scollega» (§5.4) e «Rimuovi credenziali» (§4.3), poi «Disattiva».

### 2.4 Effetto della disattivazione sul resto dell'app

| Elemento | Con plugin disattivato dall'utente |
|---|---|
| Sezione «Banche» | Non si disegna. La pagina non manda al browser nessun dato del plugin |
| Letture automatiche e «Sincronizza ora» | Ferme per quell'utente. Gli altri utenti non cambiano |
| Conti e movimenti | Restano visibili, con l'ultima lettura. Non diventano conti tenuti a mano |
| Credenziali e collegamenti | Restano cifrati nel core. Non sono leggibili dall'interfaccia (decisione A1) |
| `/banks/connect` | 404 |
| Scadenza dell'accesso alla banca | Continua a scorrere: è una data della banca |

### 2.5 Stati della pagina

| Stato | Vista |
|---|---|
| Plugin non presente nell'istanza | Nessuna riga, nessuna sezione nuova |
| Caricamento | Rende il server: nessuno scheletro. Le azioni usano `useTransition` e disattivano i controlli della riga |
| Azione fallita | Riga di errore sotto la voce (`role="alert"`, classi di §1.4): «Non è stato possibile salvare. Riprova.» Lo stato non cambia |
| Errore di lettura | `error.tsx` esistente della rotta |

### 2.6 Layout

1440 px (dentro la card di «Sorgenti dei dati», sotto Trek):

```text
Sorgenti dei dati          ┌──────────────────────────────────────────────────────────────────┐
Da dove arrivano saldi     │ ● Budget Makers Wallet  Collegato   …                            │
e movimenti…               ├──────────────────────────────────────────────────────────────────┤
                           │ ● Trek  Collegato   …                                            │
                           ├──────────────────────────────────────────────────────────────────┤
                           │ ● Enable Banking  Non attivo                           [Attiva]  │
                           │ Conti e movimenti dalle banche europee                           │
                           └──────────────────────────────────────────────────────────────────┘
```

Stato `paused`:

```text
                           │ ● Enable Banking  Non attivo                           [Attiva]  │
                           │ Conti e movimenti dalle banche europee                           │
                           ├──────────────────────────────────────────────────────────────────┤
                           │ Le letture sono ferme dal 2 mar 2027. Credenziali e collegamenti │
                           │ sono salvati.                                                    │
```

400 px (tutto in colonna):

```text
┌──────────────────────────────────┐
│ ● Enable Banking  Attivo         │
│ Conti e movimenti dalle banche…  │
│ [⋯]                              │
└──────────────────────────────────┘
```

## 3. Sezione «Banche» in Settings › Integrations

Posizione: seconda `SettingsSection` della pagina, dopo «Sorgenti dei dati», prima di «Investimenti».
Motivo: il tab Finance arriva in R5a (D3). Integrations è il posto dove l'utente trova già le altre sorgenti (decisione Q7).
La sezione esiste solo con il plugin attivo per l'utente (§1.1, §2.2).

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
| Plugin non attivo per l'utente (mai attivato o disattivato) | 404 |
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
| In Ledgerly | `Select` | Opzioni: «Crea un conto nuovo» (default); `<optgroup label="Usa un conto esistente">` con i conti ammessi; «Non importare» (decisione Q3) |
| Nome | `Input`, `maxLength` come in «Nuovo conto» | Solo con «Crea un conto nuovo». Precompilato: «{bank} {nome dato dalla banca}». Obbligatorio |
| Tipo | `Select` con `accounts.types` | Solo con «Crea un conto nuovo». Default «Conto corrente»; «Deposito» se la banca lo dichiara |

Conti ammessi in «Usa un conto esistente» (stessa regola di `investments.connect.existingHint`): tenuti a mano, non
archiviati, senza un'altra sorgente che li scrive, stessa valuta del conto della banca. Se non ce ne sono, il gruppo non compare.

- Con un conto esistente scelto, sotto il `Select`: `text-sm text-muted` «Da ora saldo e movimenti di «{account}» arrivano dalla banca. I saldi già inseriti restano.»
- Saldi inseriti a mano con data dentro lo storico letto dalla banca: restano. Dalla prima data letta dalla banca vale la banca (decisione Q4).
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
| Plugin non attivo per l'utente | — | Voce «Enable Banking» in «Sorgenti dei dati» (§2) | «Non attivo»; dopo l'uso, in più: «Le letture sono ferme dal {date}. Credenziali e collegamenti sono salvati.» | «Attiva» |
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

Test da aggiungere alle specifiche esistenti (G6): `a11y.spec.ts` e `keyboard.spec.ts` sulla voce «Enable Banking»
nei 4 stati di §2.2, sulla sezione «Banche» nelle viste A, B, C e sui tre passi della procedura, a 400 e 1440 px, nei
due temi. Un test con due utenti: l'attivazione del primo non cambia la pagina del secondo.

## 9. Testi e chiavi di traduzione

File `messages/it.json` e `messages/en.json`. Tre gruppi nuovi: `settings.plugins` (voce del plugin, per utente),
`settings.banks` (sezione e dialoghi), `banks.connect` (procedura). «Annulla», «Riprova», «Chiudi» usano
`common.cancel`, `common.retry`, `common.close`. Il nome e la descrizione del plugin arrivano dal manifest (it, en).

### 9.1 `settings.plugins`

Testi generici: valgono per ogni plugin. `{name}` è il nome dal manifest. Nessuna voce nuova in `settings.tabs`.

| Chiave | Italiano | English |
|---|---|---|
| `states.inactive` | Non attivo | Not active |
| `states.active` | Attivo | Active |
| `detail.paused` | Le letture sono ferme dal {date}. Credenziali e collegamenti sono salvati. | Readings have been stopped since {date}. Credentials and connections are saved. |
| `actions.enable` | Attiva | Turn on |
| `actions.disable` | Disattiva | Turn off |
| `disable.title` | Disattivare {name}? | Turn off {name}? |
| `disable.description` | Le letture di {name} si fermano e la sua sezione sparisce dalle impostazioni. Credenziali, collegamenti, conti e movimenti restano salvati. Alla riattivazione tutto riparte. | {name} readings stop and its section disappears from the settings. Credentials, connections, accounts and transactions stay saved. Everything resumes when you turn it on again. |
| `disable.links` | {count, plural, one {Hai # collegamento attivo.} other {Hai # collegamenti attivi.}} | {count, plural, one {You have # active connection.} other {You have # active connections.}} |
| `disable.cancel` | Resta attivo | Keep it on |
| `disable.confirm` | Disattiva | Turn off |
| `toasts.enabled` | {name} attivato | {name} turned on |
| `toasts.disabled` | {name} disattivato | {name} turned off |
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
| 2 · Senza plugin attivo l'utente non vede nessun elemento nuovo. **Cambiato da H25:** vede la sola voce «Enable Banking · Non attivo»; nessun altro elemento | §1.1, §2.2, guardie di §6.1 |
| 3 · Le credenziali non compaiono mai in chiaro dopo il salvataggio | §1.3, §4.1-§4.3 |

Criteri di N1 in `03-releases.md` che l'interfaccia deve rispettare: 1 (nessun codice copiato a mano: §6.3), 2 (storico
oltre 90 giorni: §6.4, §6.6), 5 e 6 (credenziali: §1.3; ogni utente vede solo la sua sezione), 7 (§1.1), 9 (nessun passo dell'admin: §2).

## 11. Punti di aggancio per N2 e N4

| Rilascio | Punto | Cosa cambia |
|---|---|---|
| N2 | Cella di stato della riga della banca (§5.1) | Il pallino e la parola diventano lo stato a 5 valori (`SyncStatus`). Codici e testi di §7 restano |
| N2 | Sotto la riga della banca | Posto della cronologia semplice (10 righe). In N1 è vuoto |
| N2 | Colonna «Letture automatiche» (§5.3) | La pianificazione va sotto «Avanzate» |
| N2 | §5.5 | La frase «una sola banca» sparisce; «Collega una banca» torna sempre visibile; la guardia di §6.1 cade |
| N2 | Avvisi di scadenza a 14 e 3 giorni | Usano la data «accesso valido fino al» già presente nella riga |
| N2 | Registro | Nessun registro in N1. Il registro grezzo è per utente, sotto «Avanzate»; l'admin vede solo lo stato dei plugin in Server › Diagnostica (H29) |
| N2 | Collegamento di un plugin disattivato dall'utente (§2.4) | In N1 il conto mostra solo l'ultima lettura. In N2 lo stato è «In pausa», con il testo «Enable Banking non è attivo» e l'azione «Attiva» (H30) |
| R5a, R5c | Voce del plugin (§2) | La voce passa nel tab Plugin, che è di ogni utente: elenco, «Attiva», «Disattiva». I plugin arrivano e si aggiornano con l'istanza (H27) |
| N4 | `Select` «In Ledgerly» (§6.4) | Si aggiunge il gruppo «È lo stesso conto di…» con i conti Wallet |

## 12. Decisioni prese

Decisioni di Mattia del 14/11/2026 sulle 7 domande della prima versione di questa specifica. Registro: [`../01-decisions.md`](../01-decisions.md) H25 e H26. Le decisioni sui punti nati da Q1 sono in §14 e §15.

| # | Domanda | Decisione | Dove è applicata |
|---|---|---|---|
| Q1 | Chi attiva il plugin, e cosa succede quando si disattiva? | **Regola nuova, diversa dal piano (H25).** L'admin non fa niente. I plugin sono già disponibili nell'istanza, non attivi. Ogni utente attiva per sé i plugin che vuole e gestisce i suoi, come fa oggi con Trek. Alla disattivazione la sezione «Banche» sparisce, le letture si fermano, conti e movimenti restano e tornano alla riattivazione | §1.1, §2, §6.1, §7 |
| Q2 | «Scollega» una banca e «Rimuovi credenziali» sono in N1? | Sì, tutti e due. «Rimuovi credenziali» solo senza banche collegate | §4.3, §5.4 |
| Q3 | Nella scelta dei conti esiste «Non importare» per un conto esposto dalla banca? | Sì | §6.4 |
| Q4 | Conto manuale esistente collegato alla banca: cosa succede ai saldi inseriti a mano? | Restano. Dalla prima data letta dalla banca vale la banca | §6.4 |
| Q5 | Un ingresso alla procedura anche da Accounts? | No: un solo ingresso, in Settings › Integrations | §6.1 |
| Q6 | Applicazione Enable Banking che permette anche i pagamenti: si rifiuta? | Sì, si rifiuta | §4.1 (`write_not_allowed`) |
| Q7 | La sezione «Banche» sta in Settings › Integrations fino a R5a? | Sì | §3 |

Regola sostituita da Q1: «L'admin attiva il plugin» e «tab Plugin essenziale (admin)» del rilascio N1; «Installa solo
l'admin» di C4, per la parte che riguarda l'interfaccia di N1.

## 13. Passaggi per lo sviluppo

Non sono decisioni di prodotto: sono dati che l'interfaccia richiede e che il piano non elenca.

1. **Elenco delle banche.** Il passo 1 ha bisogno di «banche per paese» (nome, paese, durata massima dell'accesso). Il contratto v1 di `04-now.md` §4.1 non ha una chiamata per questo: va aggiunta al contratto o ai campi del collegamento nel manifest.
2. **Segreto condiviso core-plugin.** L'interfaccia non lo chiede: resta nella configurazione del server.
3. **Collegamento «Da completare».** Tra `auth/complete` e la scelta dei conti il collegamento esiste senza conti: serve uno stato per questo (§5.1, §6.4).
4. **Dati dell'esito.** Per ogni conto: numero di movimenti, data del più vecchio, saldo, esito della lettura; per il collegamento: «storico corto sì o no» (§6.6).
5. **`ConnectionRow`.** Due props facoltative per le etichette e stato con parola e tono dati dal chiamante (§5.1). Wallet e Trek non cambiano.
6. **Movimento.** `globals.css` non ha una regola `prefers-reduced-motion` per `animate-shimmer` e `animate-in`. Non è di N1; va aperta una voce a parte.
7. **Da misurare al passo 1 di N1:** minuti reali della finestra dello storico; limite separato per le letture con l'utente presente; costo dell'applicazione per uso personale. Tre testi dipendono da queste misure (`accounts.hurry`, `errors.rateLimitedNow`, `setup.intro`).
8. **Plugin dalla configurazione del server (H25).** Il core conosce il plugin senza un passo nell'interfaccia: indirizzo e segreto stanno nella configurazione del server, il manifest si legge da solo (all'avvio e a intervalli). La voce compare agli utenti solo dopo una lettura riuscita del manifest (§2.1).
9. **Attivazione per utente (H25).** Serve un dato «utente, plugin, attivo sì o no, data dell'ultima disattivazione». Le letture automatiche saltano gli utenti con il plugin non attivo. Le azioni del server controllano l'attivazione dell'utente, non solo la sessione. La forma (tabella o colonna) è una scelta dello sviluppo.
10. **`06-data.md` §6.1.** La riga della tabella `plugins` (indirizzo, stato) e l'elenco delle migrazioni di N1 vanno allineati ai punti 8 e 9. Il file non è cambiato da questa revisione.

## 14. Punti di N1 nati da H25: decisi

Punti di prodotto che le decisioni di §12 lasciavano aperti. Mattia ha scelto il default (A) per tutti e due, il
14/11/2026. Il testo della specifica applica l'opzione A.

| # | Domanda | Esempio | A (default) | B | Effetto | Decisione |
|---|---|---|---|---|---|---|
| A1 | Alla disattivazione, credenziali Enable Banking e accesso alle banche restano salvati? | Mattia disattiva Enable Banking a marzo e lo riattiva a maggio | Restano cifrati nel core. A maggio BBVA riparte senza un nuovo accesso, se l'accesso non è scaduto | La disattivazione elimina le credenziali e chiude l'accesso alle banche. A maggio Mattia inserisce di nuovo la chiave e rifà l'accesso a ogni banca. Nel frattempo i conti sono conti tenuti a mano | A: riattivazione con un clic; i segreti restano nel database anche a plugin non attivo. B: nessun segreto salvato a plugin non attivo; riattivazione di circa 5 minuti per banca. Con A l'utente elimina tutto con «Scollega» e «Rimuovi credenziali» | **A** |
| A2 | Il plugin non risponde: dove lo vede chi gestisce l'istanza, in N1? | Il container si ferma dopo un aggiornamento. Ogni utente attivo vede «Il collegamento con le banche non è disponibile ora» | In nessuna schermata di N1. Il container ha healthcheck e riavvio automatico; il motivo è nei log del container. Da N2 lo stato è in Server › Diagnostica | Una riga di sola lettura in Settings › Server già in N1: «Enable Banking: risponde» o «non risponde dalle {time}». L'admin legge, non agisce | A: nessuna schermata per l'admin, coerente con H25; il guasto si nota dagli errori degli utenti. B: una vista piccola in più in N1; il guasto si vede subito | **A** |

## 15. Effetti sugli altri rilasci

Punti del piano in conflitto con H25. Mattia li ha decisi il 14/11/2026: E2 e E3 con l'opzione B, gli altri con il
default. Le righe del piano toccate sono aggiornate: `03-releases.md` (N2, R5c), `04-now.md` §4.1 e §4.3,
`01-decisions.md` (H27-H30, C4, C5), `07-apps.md`, `11-standardization.md` §11.1, `rewrite-plan.md`.

| # | Punto del piano | Esempio | A (default) | B | Effetto | Decisione |
|---|---|---|---|---|---|---|
| E1 | **R5c, tab Plugin completo dell'admin:** «installa, attiva, aggiorna, rimuovi» (`03-releases.md` R5c; C4 «Installa solo l'admin»; D3 «tab Plugin»; `07-apps.md` «Admin: … installazione dei plugin»; `11-standardization.md` «Chi lo usa lo installa»; `rewrite-plan.md` «Wallet e Trek si installano») | In R5c arriva il plugin Trek | I plugin del catalogo ufficiale fanno parte dell'installazione standard: arrivano e si aggiornano con l'istanza. Il tab Plugin è di ogni utente: elenco, «Attiva», «Disattiva». Nessun «installa, aggiorna, rimuovi» nell'interfaccia | L'admin ha una pagina tecnica in Settings › Server: installa, aggiorna, rimuovi. Il tab Plugin dell'utente ha solo «Attiva» e «Disattiva» | A: nessun compito dell'admin nell'interfaccia; ogni plugin del catalogo gira sempre, anche senza utenti. B: l'admin sceglie quali plugin girano; torna un passo dell'admin prima dell'utente | **A** (H27) |
| E2 | **R5c, plugin fuori catalogo:** «solo admin, etichetta "non verificato"» (C4) | Un amico scrive un plugin per la sua banca | Si aggiunge solo dalla configurazione del server, mai dall'interfaccia. Compare a ogni utente con l'etichetta «non verificato»; l'attivazione chiede una conferma | Fuori dal piano: esistono solo i plugin del catalogo ufficiale | A: resta possibile, con un lavoro sul server e un rischio dichiarato all'utente. B: meno superficie; nessun plugin di terzi | **B** (H28) |
| E3 | **N2, registro grezzo solo per l'admin** in Server › Diagnostica (`03-releases.md` N2, criterio 2; `04-now.md` §4.3) | La lettura di una banca di un altro utente fallisce | Resta com'è: è diagnosi dell'istanza, non gestione dei plugin. L'admin legge righe tecniche senza segreti, per tutti i collegamenti | Ogni utente vede il registro grezzo dei suoi collegamenti sotto «Avanzate». L'admin vede solo lo stato dei plugin | A: nessun cambio a N2; l'admin vede l'attività tecnica degli altri utenti. B: ogni utente risolve da solo; più lavoro in N2 (una vista per utente) | **B** (H29) |
| E4 | **N2, stato a 5 valori:** non ha un caso per «plugin disattivato dall'utente» (`04-now.md` §4.3) | Mattia disattiva Enable Banking. In Accounts resta il conto BBVA | Il collegamento è «In pausa», con il testo «Enable Banking non è attivo» e l'azione «Attiva». Nessun avviso di ritardo o di scadenza mentre il plugin non è attivo | Il conto mostra solo la data dell'ultima lettura, senza stato e senza azione | A: l'utente capisce perché il conto è fermo; un testo e un'azione in più in N2. B: nessun lavoro in N2; il conto sembra fermo senza motivo | **A** (H30) |
| E5 | **R5c, passaggio di Wallet e Trek a plugin:** «Wallet e Trek si installano; chi non li usa non li vede» | Dopo R5c Mattia ha Wallet e Trek collegati; un secondo utente non ha niente | I due plugin sono attivi da subito per chi ha già un collegamento. Per gli altri utenti sono disponibili e non attivi: vedono due voci in più | I due plugin sono non attivi per tutti. Chi li usa li riattiva a mano; fino ad allora le letture sono ferme | A: nessuna interruzione per chi li usa; «chi non li usa non li vede» diventa «li vede non attivi». B: una regola sola, ma le letture di Mattia si fermano al deploy di R5c | **A** (H30): è la conseguenza di H25. Ogni utente ha attivi solo i plugin che usa |

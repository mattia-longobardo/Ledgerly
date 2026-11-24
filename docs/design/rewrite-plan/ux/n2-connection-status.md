# N2 · Specifica UX: stato dei collegamenti

Indice del piano: [`../../rewrite-plan.md`](../../rewrite-plan.md). Rilascio: [`../03-releases.md`](../03-releases.md) «N2».
Regole tecniche: [`../04-now.md`](../04-now.md) §4.3. Decisioni: [`../01-decisions.md`](../01-decisions.md) C5, H25-H30.
Anticipo AN3: [`../11-standardization.md`](../11-standardization.md). Specifica precedente: [`n1-plugin-bank.md`](n1-plugin-bank.md) §11.

Questa specifica descrive solo l'interfaccia. Il piano ha priorità: se un punto è in conflitto con il piano, vale il piano.
Le decisioni di prodotto che il piano non scrive sono in §14. Mattia ha scelto il default (A) per tutte le 5 domande il 15/11/2026:
il testo applica l'opzione A. Nessuna domanda è aperta.

## 0. Riepilogo

| Voce del «Contenuto» di N2 | Dove | Sezione |
|---|---|---|
| Stato a 5 valori per collegamento | Riga unica del collegamento, in `Settings › Integrations` e dove la riga è già usata | §2, §3 |
| Cronologia semplice (10 righe) | Sotto la riga del collegamento | §4 |
| Codice di errore da una lista chiusa | Testo dello stato, cronologia, registro | §5 |
| Avviso dopo 3 fallimenti, subito se serve un'azione | Mail + stato della riga | §6 |
| Avviso di scadenza a 14 e 3 giorni, «Rinnova accesso» | Mail + riga di avviso sotto il collegamento | §6.3 |
| Chiavi di notifica generiche (AN3) | Modello unico di mail | §6.4 |
| Più banche per utente | Sezione «Banche» | §7 |
| Pianificazione sotto «Avanzate» | Pagina `/settings/integrations/advanced` | §8.2 |
| Registro grezzo per utente, 30 giorni, «Copia rapporto» | La stessa pagina | §8.3, §8.4 |
| Stato dei plugin per l'admin (H29) | `Settings › Server`, sezione «Diagnostica» | §9 |
| Plugin disattivato: «In pausa» + «Attiva» (H30) | Riga del collegamento | §2.3, §3.4 |

Fuori da questa specifica: passaggio da Wallet (N4); tab Plugin completo (R5c). La chiusura delle righe `running` orfane non ha interfaccia.

## 1. Regole generali

### 1.1 Una sola riga per tutti i fornitori

- Esiste un solo componente di riga, `ConnectionRow`, e un solo modello di stato, `SyncStatus`. Valgono per banche, Wallet, Trek, eToro, Binance e per ogni fornitore futuro.
- La riga non contiene il nome di un fornitore e non contiene `if (provider === …)`. Riceve dati già pronti: nome, riga di dettaglio, stato, azione, cronologia, voci del menu.
- Ogni fornitore dichiara in un descrittore cosa sa fare e come: `{ update, renew, replaceKey, chooseAccounts, settingsHref, disconnect }`. Una voce assente non compare nella riga. Dopo R5c il descrittore arriva dal manifest.
- I testi usano due parametri: `{name}` = nome del collegamento («BBVA», «Trek»); `{provider}` = nome del fornitore dal manifest o dal catalogo («Enable Banking»). Nessun testo del core contiene un nome di fornitore (AN3, regola M14).

### 1.2 Parole

- Vista normale: nessuna parola tecnica (criterio 1 di N2). Vietate: «plugin», «sync», «sincronizzazione», «token», «sessione», «job», «run», «API», «HTTP», «429», «cron», «log», nomi di codici di errore.
- Parole di N2 (piano §4.3): «aggiornato», «aggiornamento», «Aggiorna ora». Sostituiscono «sincronizzazione» e «Sincronizza ora» nelle righe dei collegamenti. Chiavi di N1 da rinominare: §10.4.
- Le parole tecniche sono permesse solo nella pagina «Avanzate» (§8) e in `Server › Diagnostica` (§9).
- Mai il messaggio grezzo del fornitore: ogni errore è un codice della lista chiusa con un testo fisso (§5, criterio 4).
- Un'azione ha lo stesso nome in pulsante, menu e toast.

### 1.3 Componenti e token esistenti

Nessun componente nuovo in `src/ui`, nessun token nuovo, nessuna libreria nuova. Valgono la tabella e i token di `n1-plugin-bank.md` §1.4. In più:

| Bisogno | Componente esistente |
|---|---|
| Riga del collegamento | `ConnectionRow` (`settings/integrations/connection-row.tsx`), con le props nuove di §3.1 |
| Pianificazione | `ScheduleControl` (`settings/integrations/schedule-control.tsx`), senza modifiche |
| Registro | `Table`, `THead`, `Th`, `TBody`, `Tr`, `Td` (`src/ui/table.tsx`); `Badge` per l'esito |
| Apri e chiudi | `<button aria-expanded>` con le classi di `LinkButton`; icona `ChevronDown` di lucide |
| Stato dei plugin | Lista con le classi di `jobs-card.tsx` |

Regola di codice (piano §4): `SyncStatus` è una funzione pura del dominio. I componenti sono client senza lettura dati propria. Le Server Actions sono un involucro sottile.

## 2. Stato a 5 valori

### 2.1 Valori

| Valore | Parola | Pallino | Tono | Testo | Azione in evidenza |
|---|---|---|---|---|---|
| `ok` | «Aggiornato» | `bg-pos` | `pos` | «Aggiornato {when}» | — |
| `running` | «In corso» | `bg-accent` | `accent` | «Aggiornamento in corso…» | — |
| `late` | «In ritardo» | `bg-warn` | `warn` | §2.3 | «Aggiorna ora» |
| `action` | «Serve un'azione» | `bg-neg` | `neg` | §2.3 | Una sola, secondo il motivo |
| `manual` | «Solo manuale» | anello `border-faint` | `muted` | «Aggiornamento automatico spento.» | «Attiva aggiornamento automatico» |
| `paused` | «In pausa» | `bg-faint` | `muted` | §2.3 | «Attiva» |

Revisione UX delle schede dei plugin (punto 2): un collegamento senza pianificazione è «Solo manuale», non «In pausa». «In pausa» resta solo per il plugin spento. Il server dà `paused` per tutti e due; il client li separa dal testo (`pausedSchedule`).

Un collegamento che non esiste (Wallet o Trek mai collegati) non ha uno stato: la riga dice «Non collegato» (`bg-faint`, `muted`) e ha il pulsante «Collega», come oggi.

### 2.2 Ordine delle regole

La funzione applica la prima regola vera. Ingressi: `state`, `error_code`, `consecutive_failures`, `last_ok_at`, `next_sync_at`, «una lettura è in corso», «il fornitore è attivo per l'utente», «esiste una regola di pianificazione».

| # | Condizione | Valore |
|---|---|---|
| 1 | Il fornitore è un plugin disattivato dall'utente (H30) | `paused` |
| 2 | Una lettura è in corso | `running` |
| 3 | `error_code` è `auth` o `consent_expired`; `state = revoked`; collegamento senza conti scelti | `action` |
| 4 | Nessuna regola di pianificazione | `paused` |
| 5 | `consecutive_failures ≥ 1`, oppure ultimo aggiornamento riuscito oltre l'intervallo | `late` |
| 6 | Altro | `ok` |

La regola 3 include il collegamento «Da completare» di N1 (`n1-plugin-bank.md` §5.1): è il solo caso nuovo, e rientra nei 5 valori.

### 2.3 Testo e azione per ogni caso

| Valore | Caso | Testo | Azione |
|---|---|---|---|
| `ok` | — | «Aggiornato {when}» | — |
| `running` | — | «Aggiornamento in corso…» | — |
| `late` | Fallimento, con prossimo tentativo | «Ultimo aggiornamento {when}. Nuovo tentativo {next}.» | «Aggiorna ora» |
| `late` | Mai aggiornato | «Nessun aggiornamento riuscito finora. Nuovo tentativo {next}.» | «Aggiorna ora» |
| `late` | `rate_limited` | «{name} ha raggiunto il limite di letture automatiche. Nuovo tentativo {next}.» | «Aggiorna ora» |
| `action` | `consent_expired` | «L'accesso a {name} è scaduto.» | «Rinnova accesso» |
| `action` | `auth` o `state = revoked` | «La chiave di {provider} non è più valida.» | «Sostituisci chiave» |
| `action` | Conti non scelti | «Hai dato l'accesso, ma non hai ancora scelto i conti.» | «Scegli i conti» |
| `paused` | Nessuna pianificazione | «Aggiornamento automatico spento.» | «Riattiva» |
| `paused` | Plugin disattivato | «{provider} non è attivo.» | «Attiva» |

Formato di `{when}` e `{next}` (calcolati sul server, nel fuso dell'utente):

| Distanza | `{when}` | `{next}` |
|---|---|---|
| Meno di 1 minuto | «ora» | «tra poco» |
| Meno di 1 ora | «{n} minuti fa» | «alle 14:00» |
| Oggi | «{n} ore fa» | «alle 14:00» |
| Ieri / domani | «ieri alle 08:00» | «domani alle 08:00» |
| Oltre | «il 12 nov alle 08:00» | «il 16 nov alle 08:00» |

Il testo è dentro un `<time dateTime>` con `title` = data e ora complete (`formatInstant`).

### 2.4 Effetto di ogni azione

| Azione | Effetto | Conferma | Toast |
|---|---|---|---|
| «Aggiorna ora» | Parte una lettura con l'utente presente. La riga passa a «In corso» | No | «Aggiornamento completato» / «Aggiornamento completato: {count} movimenti nuovi» |
| «Rinnova accesso» | Apre la procedura del fornitore (banche: `/banks/connect?renew=<id>`, N1 §6.7) | No | Quello della procedura |
| «Sostituisci chiave» | Apre il dialogo o la pagina del fornitore (banche: N1 §4.2; Wallet e Trek: dialogo della chiave; investimenti: tab Connessione) | No | «Chiave sostituita» |
| «Scegli i conti» | Apre `/banks/connect?step=accounts&c=<id>` | No | — |
| «Riattiva» | Rimette la pianificazione consigliata del fornitore (decisione Q5) | No | «Aggiornamento automatico riattivato» |
| «Attiva» | Attiva il fornitore per l'utente, come N1 §2.3. Parte una lettura per ogni suo collegamento | No | «{provider} attivato» |

- Azione fallita: nessun toast. Riga di errore sotto il collegamento (`role="alert"`, classi di N1 §1.4) con il testo di §5. Il focus resta sul pulsante.
- Durante un'azione i controlli della riga sono disattivati (`useTransition`) e la riga ha `aria-busy="true"`.
- «In corso»: mentre almeno una riga è `running`, la pagina si aggiorna da sola ogni 5 secondi (`router.refresh()`), per un massimo di 2 minuti e solo con la scheda visibile. Nessuna animazione.

## 3. Riga del collegamento

### 3.1 Dati che la riga riceve

```ts
type ConnectionRowProps = {
  id: string;
  name: string;                       // «BBVA», «Trek»
  detail: string | null;              // riga di dettaglio, già formattata
  status: {
    value: "ok" | "running" | "late" | "action" | "paused" | "absent";
    text: string;                     // testo di §2.3, già tradotto
    at: string | null;                // ISO, per <time>
    action: { kind: ActionKind; label: string } | null;
  };
  notice: { text: string; action: { kind: ActionKind; label: string } | null } | null; // §6.3
  history: HistoryItem[];             // massimo 10, §4
  menu: { kind: ActionKind; label: string; danger?: boolean }[];
};
type ActionKind =
  | "update" | "renew" | "replaceKey" | "chooseAccounts" | "resume" | "enable"
  | "connect" | "test" | "settings" | "advanced" | "disconnect";
```

La pagina costruisce le props sul server. La riga non riceve codici di errore, credenziali o valori del fornitore.

### 3.2 Parti della riga

| Parte | Contenuto | Classi |
|---|---|---|
| Nome e stato | Pallino `size-[7px]` (`aria-hidden`), nome `font-semibold`, parola dello stato `text-sm font-medium` con il tono | Come oggi |
| Dettaglio | Banche: «{count} conti · accesso valido fino al {date}». Wallet e Trek: il ruolo di oggi. Investimenti: «Chiave in sola lettura» | `text-sm text-muted` |
| Testo dello stato | Testo di §2.3 | `text-sm`; tono `fg` per `ok` e `running`, `muted` per `paused`, `fg` per `late` e `action` |
| Azione | Un solo pulsante: `primary` `sm` per `action` e per «Attiva»; `secondary` `sm` per `late` e «Riattiva». Nessun pulsante per `ok` e `running` | — |
| Menu | `ActionMenu` con `label` = nome del collegamento | — |
| Cronologia | Pulsante «Cronologia» + elenco (§4) | — |

Le colonne «Ultima sincronizzazione» e «Pianificazione» spariscono dalla riga: l'ultima lettura è nel testo dello stato, la pianificazione è in «Avanzate» (§8.2).

Voci del menu, in questo ordine; compaiono solo quelle che il fornitore dichiara e che non sono già il pulsante in evidenza:

1. «Aggiorna ora» (assente per `running`, `paused` con plugin disattivato, `action`).
2. «Rinnova accesso».
3. «Sostituisci chiave».
4. «Prova il collegamento» (oggi solo Wallet).
5. «Impostazioni del collegamento» (investimenti: apre il tab Connessione del servizio).
6. «Avanzate» (apre `/settings/integrations/advanced?c=<id>`).
7. «Scollega» (`danger`).

### 3.3 Dove si usa

| Punto | In N2 |
|---|---|
| `Settings › Integrations`: «Sorgenti dei dati» (Wallet, Trek) | Riga nuova. Le card `WalletCard` e `TrekCard` tengono i loro dialoghi |
| `Settings › Integrations`: «Banche» | Riga nuova per ogni banca (§7) |
| `Settings › Integrations`: «Investimenti» | Riga nuova |
| `Time Off › Impostazioni`: Trek | Riga nuova, la stessa di Integrations |
| `/accounts/[id]`: intestazione di un conto che arriva da un collegamento | Forma compatta: pallino, parola, testo, azione come link (decisione Q3) |
| Elenco di Accounts, intestazione di un servizio di Investments | Non cambiano: si chiudono in R3 (UI-ACC-1) |

Elementi che lasciano la riga di Wallet: il blocco «Storico · Scarica di nuovo» passa nella pagina «Avanzate» (§8.2). La frase «prima lettura» resta come testo dello stato «Nessun aggiornamento riuscito finora».

### 3.4 Plugin disattivato dall'utente (H30)

- I collegamenti del plugin restano in elenco come sola lettura, nella sezione «Sorgenti dei dati», sotto la voce del plugin (N1 §2): la sezione «Banche» non si disegna (N1 §1.1).
- Ogni riga: «In pausa», «{provider} non è attivo.», pulsante «Attiva». Menu: solo «Avanzate».
- Nessuna riga di avviso, nessuna mail di ritardo o di scadenza (§6.5). La cronologia resta leggibile.
- La forma compatta su `/accounts/[id]` mostra lo stesso stato e la stessa azione.
- La riga di dettaglio di N1 §2.2 («Le letture sono ferme dal {date}…») resta sulla voce del plugin.

### 3.5 Layout

1440 px (griglia `minmax(0,1fr) minmax(0,1.4fr) auto` da 820 px di contenitore):

```text
Banche                     ┌────────────────────────────────────────────────────────────────────────────┐
Collega i tuoi conti       │ Applicazione Enable Banking                       [Sostituisci chiave]  ⋯ │
bancari. Ledgerly legge    │ Credenziali salvate il 14 nov 2026                                         │
saldi e movimenti e non    ├────────────────────────────────────────────────────────────────────────────┤
può fare pagamenti.        │ ● BBVA  Aggiornato            Aggiornato 2 ore fa                        ⋯ │
                           │ 2 conti · accesso valido      Cronologia ⌄                                 │
                           │ fino al 13 mag 2027                                                        │
                           ├────────────────────────────────────────────────────────────────────────────┤
                           │ ● Intesa  In ritardo          Ultimo aggiornamento ieri    [Aggiorna ora] ⋯│
                           │ 1 conto · accesso valido      alle 08:00. Nuovo tentativo                  │
                           │ fino al 2 feb 2027            alle 14:00.   Cronologia ⌄                   │
                           ├────────────────────────────────────────────────────────────────────────────┤
                           │ ● Fineco  Serve un'azione     L'accesso a Fineco è       [Rinnova accesso]⋯│
                           │ 1 conto                       scaduto.      Cronologia ⌄                   │
                           ├────────────────────────────────────────────────────────────────────────────┤
                           │                                                     [Collega una banca]    │
                           └────────────────────────────────────────────────────────────────────────────┘
                                                                                        Avanzate →
```

400 px (una colonna; il pulsante in evidenza a tutta larghezza, il menu accanto):

```text
┌──────────────────────────────────┐
│ ● Intesa  In ritardo             │
│ 1 conto · accesso valido fino al │
│ 2 feb 2027                       │
│ Ultimo aggiornamento ieri alle   │
│ 08:00. Nuovo tentativo alle      │
│ 14:00.                           │
│ [Aggiorna ora            ] [⋯]   │
│ Cronologia ⌄                     │
└──────────────────────────────────┘
```

- Tra 560 e 819 px: due colonne (nome | testo), azioni su una riga propria.
- Nessuno scorrimento orizzontale a 400 px: nomi e testi vanno a capo (`break-words`).
- Temi: solo token. Il pallino non è il solo segnale: la parola dello stato è sempre accanto.

## 4. Cronologia semplice

Posizione: sotto la riga, dentro la stessa voce di elenco. Chiusa all'apertura della pagina.

- Pulsante «Cronologia» (`aria-expanded`, `aria-controls`), classi di `LinkButton`, bersaglio 24 px. L'icona ruota di 180° senza transizione.
- Elenco `<ol>` con le ultime 10 letture del collegamento, dalla più recente. Arriva con la pagina: nessun caricamento.
- Classi dell'elenco: `border-t border-border px-4 py-2.5 text-sm`, righe `py-1.5`.

Una riga:

```text
oggi 08:02      Riuscito        12 movimenti nuovi
ieri 20:01      Non riuscito    BBVA non risponde.
ieri 14:00      Riuscito        Nessuna novità
```

| Parte | Contenuto |
|---|---|
| Quando | Data e ora brevi, in `<time>` |
| Esito | «Riuscito» (`pos`), «Non riuscito» (`neg`), «In corso» (`accent`), «Saltato» (`muted`). Parola con il tono, senza `Badge` |
| Cosa | Riuscito: «{count} novità» per tipo di dato («12 movimenti nuovi», «2 saldi aggiornati», «3 giorni inviati»), oppure «Nessuna novità». Non riuscito: testo del codice (§5). Saltato: «Niente da leggere.» |
| Origine | Solo se avviato dall'utente: «avviato da te» (`text-muted`) |

- Vuoto: «Nessun aggiornamento finora.» (`text-muted`).
- A 400 px ogni riga va su due righe: quando + esito, poi il testo.
- In fondo, se le letture sono più di 10: `LinkButton` «Tutte le letture in Avanzate» (`/settings/integrations/advanced?c=<id>`).
- Nessun codice, nessuna durata, nessun conteggio tecnico: sono nel registro (§8.3).

## 5. Codici di errore: lista chiusa

Lista del piano (§4.3). Un testo fisso per codice, uguale in riga, cronologia e mail. Chiavi in §10.

| Codice | Testo | Stato della riga | Conta come fallimento |
|---|---|---|---|
| `auth` | «La chiave di {provider} non è più valida.» | `action` | Avviso subito |
| `consent_expired` | «L'accesso a {name} è scaduto.» | `action` | Avviso subito |
| `rate_limited` | «{name} ha raggiunto il limite di letture automatiche.» | `late` | No (decisione Q2) |
| `provider_down` | «{name} non risponde.» | `late` | Sì |
| `invalid_data` | «{name} ha risposto con dati che Ledgerly non sa leggere. Niente è stato cambiato.» | `late` | Sì |

Codici che esistono solo come risposta a un'azione dell'utente (N1 §7), non salvati sul collegamento: `busy` («Un aggiornamento è già in corso. Riprova tra poco.»), `network`, `plugin_down`, `failed`. I loro testi restano quelli di N1, con «aggiornamento» al posto di «lettura» dove la riga li mostra.

- Una riga vecchia di `sync_runs` senza codice mostra «Non riuscito» senza testo. Il campo `error` vecchio non si mostra e non si copia (criterio 4).
- Un codice che l'interfaccia non conosce si mostra come `failed`: «Qualcosa non ha funzionato.»

## 6. Avvisi

### 6.1 Regole

| Avviso | Quando parte | Chiave | Ripetizione |
|---|---|---|---|
| Non aggiornato | Al terzo fallimento consecutivo (`consecutive_failures = 3`) | `sync_failed` | Come oggi: al massimo uno ogni 7 giorni finché dura |
| Serve un'azione | Subito, alla prima lettura con `auth`, `consent_expired` o `state = revoked` | `sync_failed` | Come sopra |
| Fermo | Come oggi: nessuna lettura riuscita oltre la soglia esistente | `sync_stale` | Come sopra |
| Scadenza dell'accesso | 14 giorni e 3 giorni prima di `expires_at` | `consent_expiring` | Una volta per soglia e per scadenza |

- Canale: mail, come oggi (`notifyOnce`), più lo stato della riga. Nessun altro punto dell'app mostra l'avviso (decisione Q1).
- L'interruttore esistente degli avvisi di sincronizzazione in `Settings › Server` vale per tutte e tre le chiavi.
- Un collegamento che torna «Aggiornato» azzera gli avvisi: il prossimo problema avvisa subito. Nessuna mail «tutto a posto».
- Un rinnovo riuscito azzera `consent_expiring`: la scadenza nuova avvisa di nuovo a 14 e 3 giorni.

### 6.2 Nella riga

Lo stato della riga è già l'avviso: `late` dal primo fallimento, `action` subito. Non esiste un secondo banner.

### 6.3 Scadenza dell'accesso nella riga

Da 14 giorni prima della scadenza, sotto la riga (sopra la cronologia), riga di avviso con le classi
`border-t border-border px-4 py-2.5 text-sm text-warn`, `role="status"`:

```text
│ L'accesso a BBVA scade tra 12 giorni.                              Rinnova accesso │
```

- Testo: «L'accesso a {name} scade tra {days} giorni.»; con 1 giorno «scade domani»; nel giorno stesso «scade oggi».
- Azione: `LinkButton` «Rinnova accesso». Lo stato della riga non cambia: resta quello di §2.
- Dopo la scadenza la riga di avviso sparisce e lo stato diventa `action` con «Rinnova accesso» in evidenza.
- A 400 px l'azione va sotto il testo.

### 6.4 Mail (AN3)

Un solo modello per `sync_failed` e `sync_stale`. Il fornitore e il collegamento sono parametri.

| Parte | Italiano |
|---|---|
| Oggetto | «{name} non sincronizzato» |
| Corpo, `sync_failed` | «L'ultimo aggiornamento di {name} non è riuscito. {reason} {todo} Apri Impostazioni › Integrazioni: {url}» |
| Corpo, `sync_stale` | «{name} non si aggiorna dal {since}. Apri Impostazioni › Integrazioni: {url}» |
| Oggetto, `consent_expiring` | «L'accesso a {name} scade tra {days} giorni» |
| Corpo, `consent_expiring` | «Dopo il {date} Ledgerly non può più leggere {name}. Rinnova l'accesso: serve circa un minuto. {url}» |

- `{reason}` è il testo del codice (§5). `{todo}` è la frase dell'azione: «Rinnova l'accesso.», «Sostituisci la chiave.», oppure vuoto.
- La mail non contiene il messaggio del fornitore, il tipo di lettura o un codice (oggi contiene `{kind}` e `{error}`).
- Per Wallet il testo resta quello di oggi nella sostanza: «Budget Makers Wallet non sincronizzato».

### 6.5 Quando non parte nessun avviso

| Caso | Motivo |
|---|---|
| Plugin disattivato dall'utente | H30: nessun avviso di ritardo o di scadenza. La scadenza continua a scorrere; alla riattivazione la riga mostra lo stato vero |
| «Solo manuale» | L'utente ha spento l'aggiornamento automatico |
| `rate_limited` | Non conta nei 3 fallimenti (decisione Q2) |
| Collegamento «Da completare» | L'utente è già nella procedura; la riga mostra «Scegli i conti» |

## 7. Più banche

N2 toglie la chiave unica vecchia: un utente collega più banche. Un collegamento per banca (piano §4.2).

| Tema | Regola |
|---|---|
| Elenco | Una riga per banca nella sezione «Banche», sotto la riga delle credenziali |
| Ordine | Per gravità: «Serve un'azione», «In ritardo», «Solo lettura», «In corso», «In pausa», «Solo manuale», «Aggiornato». A pari stato, alfabetico per nome della banca, senza maiuscole e accenti (revisione UX delle schede dei plugin, punto 7) |
| Aggiunta | Pulsante «Collega una banca» sempre presente in fondo alla card (`border-t px-4 py-3`, allineato a destra): `primary` senza banche, `secondary` con almeno una banca |
| Frase «una sola banca» | Sparisce (N1 §5.5). La guardia «una banca già collegata» di N1 §6.1 cade |
| Banca già collegata | Nel passo 1 della procedura la banca è in elenco, non selezionabile (`aria-disabled`), con il testo «Già collegata. Per aggiungere un conto usa «Rinnova accesso».» |
| Chiave non valida (`auth`) | Ogni banca mostra `action` con «Sostituisci chiave». L'avviso sopra le righe di N1 §4.4 sparisce: la riga dice già tutto. «Collega una banca» è disattivato |
| Scollega | Come N1 §5.4, per una banca sola. Le altre non cambiano. I conti restano legati, «Scollegati», e tornano da soli quando la stessa banca si ricollega |
| «Rimuovi credenziali» | Disattivata finché esiste almeno una banca (N1 §4.3) |
| Vuoto | «Nessuna banca collegata.» + «Collega una banca» (N1 §3.2, vista B) |
| Molte banche | Nessun limite e nessuna paginazione: la card cresce |

Criterio 5 di N2: con una banca collegata, «Collega una banca» apre la procedura e la seconda banca compare come riga nuova.

## 8. «Avanzate»

### 8.1 Pagina

- Rotta `/settings/integrations/advanced`. Stesso layout di Settings; `Page` con `parent` = Integrazioni.
- Ingressi: link «Avanzate» in fondo a `Settings › Integrations` (a destra, `LinkButton`); voce «Avanzate» del menu di ogni riga (con `?c=<id>`).
- La sezione «Registro delle sincronizzazioni» di oggi sparisce da `Settings › Integrations`.
- In alto, `text-sm text-muted`: «Questa pagina mostra dati tecnici dei tuoi collegamenti. Servono per capire un problema o per chiedere aiuto.»
- Qui le parole tecniche sono permesse. La pagina non mostra mai credenziali, chiavi, accessi o messaggi del fornitore.
- Senza collegamenti: `EmptyState` «Nessun collegamento» + `ButtonLink` «Torna a Integrazioni».

### 8.2 Pianificazione

`SettingsSection` «Pianificazione», descrizione «Quando Ledgerly aggiorna ogni collegamento da solo.», `padded={false}`.

- Una riga per collegamento: nome a sinistra; a destra `ScheduleControl` di oggi, con «Prossimo: {time}».
- Collegamento con pianificazione fissa del fornitore (banche: 3 volte al giorno): testo fisso «3 volte al giorno · Prossimo: {time}», senza controllo.
- Senza regole: «Aggiornamento automatico spento» + il controllo per aggiungere una regola. È lo stato `paused` della riga.
- Plugin disattivato: «{provider} non è attivo», senza controllo.
- Wallet: sotto la sua riga, il blocco «Storico · Scarica di nuovo» di oggi, senza modifiche.
- 400 px: nome sopra, controllo sotto.

### 8.3 Registro

`SettingsSection` «Registro», descrizione «Ogni lettura degli ultimi 30 giorni, dalla più recente.», `padded={false}`.

Filtro: form `GET` con `Select` «Collegamento» («Tutti i collegamenti» + uno per collegamento, in ordine alfabetico) e `Button` «Filtra». Funziona senza JavaScript. Il filtro è nell'URL (`?c=<id>`).

| Colonna | Contenuto |
|---|---|
| Avvio | Data e ora con i secondi |
| Collegamento | Nome |
| Dati | Tipo di lettura (etichette di oggi: «Movimenti», «Conti e saldi»…) |
| Origine | «Automatica» / «Manuale» |
| Esito | `Badge`: «OK», «Fallita», «Saltata», «In corso» + durata in secondi |
| Codice | `error_code` in `font-mono`, oppure «—» |
| HTTP | `http_status`, oppure «—» |
| Conteggi | Come oggi |
| Versione | `app_version` |

- 50 righe; in fondo `ButtonLink` «Mostra altre 50» (`?n=100`).
- Sotto `md` la tabella diventa un elenco: una voce per lettura, due righe (avvio + esito; il resto come coppie «etichetta: valore»). Nessuno scorrimento orizzontale.
- Vuoto: «Nessuna lettura negli ultimi 30 giorni.» Vuoto con filtro: «Nessuna lettura per {name} negli ultimi 30 giorni.»
- Accesso (criterio 2): la pagina legge solo le righe dell'utente della sessione. Un `?c=` di un altro utente o che non esiste risponde 404. L'admin non ha una vista sugli altri utenti.

### 8.4 «Copia rapporto»

`Button` `secondary` `sm` nell'intestazione della sezione «Registro». Copia negli appunti un testo semplice del filtro corrente.

Contenuto, in righe `chiave: valore`, non tradotte:

```text
Ledgerly 0.14.0 · 2026-11-15T15:20:00Z
connection: BBVA (enablebanking)
status: late · code: provider_down · failures: 2
last_ok: 2026-11-14T07:02:11Z · next: 2026-11-15T13:00:00Z
schedule: 3 per day
runs (last 50):
2026-11-15T07:00:03Z transactions auto failed 4s provider_down http=503 v0.14.0
…
```

| Entra | Non entra mai |
|---|---|
| Versione, data, nome del collegamento, id del fornitore, stato, codice, numero di fallimenti, date, pianificazione, righe del registro | Credenziali, chiavi, accessi, id di sessione, IBAN, nomi e saldi dei conti, importi, nome e mail dell'utente, messaggi del fornitore, il campo `error` vecchio |

- Il testo si costruisce sul server con un elenco chiuso di campi: un campo nuovo non entra da solo.
- Dopo il clic il pulsante dice «Copiato» per 2 secondi, con `aria-live="polite"`.
- Se gli appunti non sono disponibili: sotto il pulsante compare una `Textarea` `readOnly` con il rapporto e il testo «Copia non riuscita. Seleziona il testo e copialo.»

## 9. Server › Diagnostica (admin)

`SettingsSection` nuova in `/settings/server`, tra «Job» e «Manutenzione». Solo admin (la pagina risponde già 404 agli altri).

- Titolo «Diagnostica». Descrizione: «Stato dei plugin di questa istanza. Nessun dato degli utenti.»
- Una riga per plugin della configurazione del server. Sola lettura: nessun pulsante (decisione A2 di N1, H29).

```text
┌───────────────────────────────────────────────────────────────────────┐
│ ● Enable Banking   Risponde            v1.0.2 · contratto v1          │
│                    Ultimo controllo oggi 15:18                        │
├───────────────────────────────────────────────────────────────────────┤
│ ● Altro plugin     Non risponde        v0.9.0 · contratto v1          │
│                    dalle 14:02 di oggi                                │
└───────────────────────────────────────────────────────────────────────┘
```

| Stato | Pallino | Parola | Tono | Seconda riga |
|---|---|---|---|---|
| Risponde | `bg-pos` | «Risponde» | `pos` | «Ultimo controllo {time}» |
| Non risponde | `bg-neg` | «Non risponde» | `neg` | «dalle {time}» |
| Mai raggiunto | `bg-faint` | «Mai raggiunto» | `muted` | «Il manifest non è mai stato letto.» |
| Versione non accettata | `bg-warn` | «Contratto non compatibile» | `warn` | «Il plugin usa il contratto {version}.» |

- La sezione non mostra utenti, collegamenti, conteggi, letture o errori dei collegamenti: l'admin non raggiunge il registro di un altro utente (criterio 2).
- Nessun plugin nella configurazione: «Nessun plugin in questa istanza.» (`p-4 text-muted`).
- Stato non leggibile: «Stato non disponibile. Ricarica la pagina.» (`role="alert"`).
- 400 px: nome e stato sulla prima riga, versione e seconda riga sotto.
- Nessun avviso all'admin quando un plugin non risponde (decisione Q4).

## 10. Testi e chiavi di traduzione

File `messages/it.json` e `messages/en.json`. Gruppo nuovo `settings.connections`, generico per ogni fornitore.
`{name}` = collegamento, `{provider}` = fornitore. «Annulla», «Riprova», «Chiudi» usano `common.*`.

### 10.1 `settings.connections`

| Chiave | Italiano | English |
|---|---|---|
| `status.ok` | Aggiornato | Up to date |
| `status.running` | In corso | In progress |
| `status.late` | In ritardo | Delayed |
| `status.action` | Serve un'azione | Action needed |
| `status.manual` | Solo manuale | Manual only |
| `status.paused` | In pausa | Paused |
| `status.absent` | Non collegato | Not connected |
| `text.ok` | Aggiornato {when} | Updated {when} |
| `text.running` | Aggiornamento in corso… | Update in progress… |
| `text.late` | Ultimo aggiornamento {when}. Nuovo tentativo {next}. | Last update {when}. Next attempt {next}. |
| `text.lateNever` | Nessun aggiornamento riuscito finora. Nuovo tentativo {next}. | No successful update so far. Next attempt {next}. |
| `text.lateLimit` | {name} ha raggiunto il limite di letture automatiche. Nuovo tentativo {next}. | {name} reached its limit of automatic readings. Next attempt {next}. |
| `text.consentExpired` | L'accesso a {name} è scaduto. | Access to {name} has expired. |
| `text.keyInvalid` | La chiave di {provider} non è più valida. | The {provider} key is no longer valid. |
| `text.pending` | Hai dato l'accesso, ma non hai ancora scelto i conti. | You gave access, but you have not chosen the accounts yet. |
| `text.pausedSchedule` | Aggiornamento automatico spento. | Automatic update is off. |
| `text.pausedProvider` | {provider} non è attivo. | {provider} is not active. |
| `when.now` | ora | just now |
| `when.minutes` | {count, plural, one {# minuto fa} other {# minuti fa}} | {count, plural, one {# minute ago} other {# minutes ago}} |
| `when.hours` | {count, plural, one {# ora fa} other {# ore fa}} | {count, plural, one {# hour ago} other {# hours ago}} |
| `when.yesterday` | ieri alle {time} | yesterday at {time} |
| `when.date` | il {date} alle {time} | on {date} at {time} |
| `next.soon` | tra poco | shortly |
| `next.today` | alle {time} | at {time} |
| `next.tomorrow` | domani alle {time} | tomorrow at {time} |
| `next.date` | il {date} alle {time} | on {date} at {time} |
| `actions.update` | Aggiorna ora | Update now |
| `actions.updating` | Aggiornamento… | Updating… |
| `actions.renew` | Rinnova accesso | Renew access |
| `actions.replaceKey` | Sostituisci chiave | Replace key |
| `actions.chooseAccounts` | Scegli i conti | Choose accounts |
| `actions.resume` | Riattiva | Turn on again |
| `actions.enable` | Attiva | Turn on |
| `actions.connect` | Collega | Connect |
| `actions.test` | Prova il collegamento | Test the connection |
| `actions.settings` | Impostazioni del collegamento | Connection settings |
| `actions.advanced` | Avanzate | Advanced |
| `actions.disconnect` | Scollega | Disconnect |
| `toasts.updated` | Aggiornamento completato | Update completed |
| `toasts.updatedNew` | Aggiornamento completato: {count, plural, one {# movimento nuovo} other {# movimenti nuovi}} | Update completed: {count, plural, one {# new transaction} other {# new transactions}} |
| `toasts.resumed` | Aggiornamento automatico riattivato | Automatic update turned on again |
| `codes.auth` | La chiave di {provider} non è più valida. | The {provider} key is no longer valid. |
| `codes.consentExpired` | L'accesso a {name} è scaduto. | Access to {name} has expired. |
| `codes.rateLimited` | {name} ha raggiunto il limite di letture automatiche. | {name} reached its limit of automatic readings. |
| `codes.providerDown` | {name} non risponde. | {name} is not responding. |
| `codes.invalidData` | {name} ha risposto con dati che Ledgerly non sa leggere. Niente è stato cambiato. | {name} answered with data that Ledgerly cannot read. Nothing was changed. |
| `codes.busy` | Un aggiornamento è già in corso. Riprova tra poco. | An update is already running. Try again shortly. |
| `codes.failed` | Qualcosa non ha funzionato. | Something went wrong. |
| `expiry.days` | {days, plural, =0 {L'accesso a {name} scade oggi.} one {L'accesso a {name} scade domani.} other {L'accesso a {name} scade tra # giorni.}} | {days, plural, =0 {Access to {name} expires today.} one {Access to {name} expires tomorrow.} other {Access to {name} expires in # days.}} |
| `history.toggle` | Cronologia | History |
| `history.empty` | Nessun aggiornamento finora. | No updates so far. |
| `history.ok` | Riuscito | Successful |
| `history.failed` | Non riuscito | Failed |
| `history.running` | In corso | In progress |
| `history.skipped` | Saltato | Skipped |
| `history.nothing` | Nessuna novità | Nothing new |
| `history.nothingToRead` | Niente da leggere. | Nothing to read. |
| `history.byYou` | avviato da te | started by you |
| `history.all` | Tutte le letture in Avanzate | All readings in Advanced |
| `banks.alreadyConnected` | Già collegata. Per aggiungere un conto usa «Rinnova accesso». | Already connected. To add an account use "Renew access". |

I testi «{count} novità» della cronologia riusano le chiavi `settings.integrations.counts.*` di oggi, ridotte a «nuovi» e «aggiornati».

### 10.2 `settings.connections.advanced` e `settings.diagnostics`

| Chiave | Italiano | English |
|---|---|---|
| `advanced.title` | Avanzate | Advanced |
| `advanced.intro` | Questa pagina mostra dati tecnici dei tuoi collegamenti. Servono per capire un problema o per chiedere aiuto. | This page shows technical data of your connections. Use it to understand a problem or to ask for help. |
| `advanced.empty` | Nessun collegamento | No connections |
| `advanced.back` | Torna a Integrazioni | Back to Integrations |
| `advanced.schedule.title` | Pianificazione | Schedule |
| `advanced.schedule.description` | Quando Ledgerly aggiorna ogni collegamento da solo. | When Ledgerly updates each connection by itself. |
| `advanced.schedule.fixed` | {count, plural, one {# volta al giorno} other {# volte al giorno}} · Prossimo: {time} | {count, plural, one {# time a day} other {# times a day}} · Next: {time} |
| `advanced.schedule.off` | Aggiornamento automatico spento | Automatic update is off |
| `advanced.log.title` | Registro | Log |
| `advanced.log.description` | Ogni lettura degli ultimi 30 giorni, dalla più recente. | Every reading of the last 30 days, newest first. |
| `advanced.log.filter` | Collegamento | Connection |
| `advanced.log.all` | Tutti i collegamenti | All connections |
| `advanced.log.apply` | Filtra | Filter |
| `advanced.log.columns.started` | Avvio | Started |
| `advanced.log.columns.data` | Dati | Data |
| `advanced.log.columns.origin` | Origine | Origin |
| `advanced.log.columns.result` | Esito | Result |
| `advanced.log.columns.code` | Codice | Code |
| `advanced.log.columns.http` | HTTP | HTTP |
| `advanced.log.columns.counts` | Conteggi | Counts |
| `advanced.log.columns.version` | Versione | Version |
| `advanced.log.origin.auto` | Automatica | Automatic |
| `advanced.log.origin.manual` | Manuale | Manual |
| `advanced.log.more` | Mostra altre 50 | Show 50 more |
| `advanced.log.empty` | Nessuna lettura negli ultimi 30 giorni. | No readings in the last 30 days. |
| `advanced.log.emptyFor` | Nessuna lettura per {name} negli ultimi 30 giorni. | No readings for {name} in the last 30 days. |
| `advanced.report.copy` | Copia rapporto | Copy report |
| `advanced.report.copied` | Copiato | Copied |
| `advanced.report.failed` | Copia non riuscita. Seleziona il testo e copialo. | Copy failed. Select the text and copy it. |
| `diagnostics.title` | Diagnostica | Diagnostics |
| `diagnostics.description` | Stato dei plugin di questa istanza. Nessun dato degli utenti. | State of the plugins of this instance. No user data. |
| `diagnostics.up` | Risponde | Responding |
| `diagnostics.down` | Non risponde | Not responding |
| `diagnostics.never` | Mai raggiunto | Never reached |
| `diagnostics.incompatible` | Contratto non compatibile | Incompatible contract |
| `diagnostics.checked` | Ultimo controllo {time} | Last check {time} |
| `diagnostics.since` | dalle {time} | since {time} |
| `diagnostics.neverDetail` | Il manifest non è mai stato letto. | The manifest was never read. |
| `diagnostics.incompatibleDetail` | Il plugin usa il contratto {version}. | The plugin uses contract {version}. |
| `diagnostics.version` | v{version} · contratto v{contract} | v{version} · contract v{contract} |
| `diagnostics.empty` | Nessun plugin in questa istanza. | No plugins in this instance. |
| `diagnostics.unavailable` | Stato non disponibile. Ricarica la pagina. | State not available. Reload the page. |

### 10.3 `emails.connection`

| Chiave | Italiano | English |
|---|---|---|
| `subject` | {name} non sincronizzato | {name} not synced |
| `failedBody` | L'ultimo aggiornamento di {name} non è riuscito. {reason} {todo} Apri Impostazioni › Integrazioni: {url} | The last update of {name} failed. {reason} {todo} Open Settings › Integrations: {url} |
| `staleBody` | {name} non si aggiorna dal {since}. Apri Impostazioni › Integrazioni: {url} | {name} has not updated since {since}. Open Settings › Integrations: {url} |
| `todo.renew` | Rinnova l'accesso. | Renew the access. |
| `todo.replaceKey` | Sostituisci la chiave. | Replace the key. |
| `expiringSubject` | {days, plural, one {L'accesso a {name} scade domani} other {L'accesso a {name} scade tra # giorni}} | {days, plural, one {Access to {name} expires tomorrow} other {Access to {name} expires in # days}} |
| `expiringBody` | Dopo il {date} Ledgerly non può più leggere {name}. Rinnova l'accesso: serve circa un minuto. {url} | After {date} Ledgerly can no longer read {name}. Renew the access: it takes about a minute. {url} |

### 10.4 Chiavi che spariscono o cambiano

| Chiave di oggi | In N2 |
|---|---|
| `settings.integrations.states.*`, `fields.*`, `schedule` | Sostituite da `settings.connections.status.*` e `text.*` |
| `settings.integrations.runs.*`, `runStates.*` | Passano a `settings.connections.advanced.log.*` |
| `settings.integrations.notifications.*` | Sostituite da `emails.connection.*` |
| `settings.integrations.errors.rejected`, `errors.unreachable`, `errors.provider` | Sostituite da `settings.connections.codes.*` |
| `settings.banks.states.*`, `detail.*`, `row.lastSync`, `row.schedule`, `row.scheduleValue`, `row.next`, `oneBank`, `invalidKey` (N1) | Spariscono: la riga usa `settings.connections.*` |
| `settings.banks.actions.sync`, `actions.syncing`, `toasts.synced`, `toasts.syncedNew` (N1) | Sostituite da `settings.connections.actions.update`, `actions.updating`, `toasts.updated`, `toasts.updatedNew` |
| `settings.banks.errors.providerDown`, `errors.invalidData`, `errors.busy`, `detail.rateLimited` (N1) | Sostituite da `settings.connections.codes.*` |
| `banks.connect.done.schedule` (N1) | «Sincronizza ora» diventa «Aggiorna ora» nel testo |

## 11. Stati della pagina

| Vista | Vuoto | Caricamento | Errore |
|---|---|---|---|
| `Settings › Integrations` | Wallet e Trek «Non collegato»; «Banche» come N1 §3.2; «Investimenti» assente senza servizi | Rende il server: nessuno scheletro. Azioni con `useTransition` | `error.tsx` della rotta. Azione fallita: riga `role="alert"` sotto il collegamento |
| Riga `running` | — | Stato «In corso», testo «Aggiornamento in corso…», controlli disattivati, aggiornamento ogni 5 s | Alla fine la riga mostra `late` o `action` con il testo del codice |
| Cronologia | «Nessun aggiornamento finora.» | Nessuno: arriva con la pagina | — |
| «Avanzate» | `EmptyState` senza collegamenti; testi di §8.3 senza letture | Rende il server; il filtro è una navigazione | `error.tsx`; `?c=` non valido: 404 |
| «Copia rapporto» | — | Pulsante disattivato durante la copia | `Textarea` con il rapporto (§8.4) |
| `Server › Diagnostica` | «Nessun plugin in questa istanza.» | Rende il server | «Stato non disponibile. Ricarica la pagina.» |

## 12. Tastiera e accessibilità (WCAG 2.2 AA)

| Tema | Regola |
|---|---|
| Ordine di tabulazione | Nella riga: azione in evidenza → menu → «Cronologia» → link dell'avviso di scadenza. Segue l'ordine visivo |
| Stato non solo con il colore | Pallino `aria-hidden`; la parola dello stato è sempre testo. `Badge` del registro con testo |
| Annunci | La cella dello stato ha `aria-live="polite"`: annuncia solo quando il testo cambia (fine di «In corso»). Errori `role="alert"`. Avviso di scadenza `role="status"` |
| Aggiornamento ogni 5 s | Non sposta il focus e non chiude un menu o una cronologia aperti |
| Cronologia | `<button aria-expanded aria-controls>`; Invio e Spazio aprono e chiudono; l'elenco è un `<ol>` con `aria-label` «Cronologia di {name}» |
| Menu | `ActionMenu` esistente: frecce, Invio, Esc; dopo un dialogo il focus torna al pulsante del menu |
| Registro | `<table>` con `<caption>` nascosta «Registro delle letture», `<th scope="col">`. Sotto `md` elenco `<ul>` con coppie etichetta e valore |
| Filtro | `Select` con `label` visibile e pulsante «Filtra»: nessun cambio di pagina al solo cambio del valore (3.2.2) |
| Focus | `focus-ring` su ogni controllo. Dopo «Filtra» il focus va al titolo «Registro» |
| Bersagli | Pulsanti `sm` 28 px, `LinkButton` e «Cronologia» 24 px. A 400 px il pulsante in evidenza è a tutta larghezza |
| Contrasto | `fg`, `muted`, `pos`, `neg`, `warn`, `accent` su `card`: 4,5:1 nei due temi. Niente `text-faint` per un testo di stato |
| Riflusso | Nessuno scorrimento orizzontale a 400 px e con testo al 200% |
| Movimento | Nessuna animazione nuova |
| Tempo | Date relative con `<time dateTime>` e `title` assoluto |
| Lingua | Nomi di banche e fornitori non si traducono. Il rapporto copiato non si traduce |

Test da aggiungere (G6, E2E del rilascio): `a11y.spec.ts` e `keyboard.spec.ts` su `Settings › Integrations` con una riga per
ognuno dei 5 valori, sulla cronologia aperta, su «Avanzate» e su `Server › Diagnostica`, a 400 e 1440 px, nei due temi.
Un test con due utenti: il secondo non raggiunge `?c=` del primo; l'admin non raggiunge il registro di un altro utente.
Un test sui testi: nessuna parola vietata di §1.2 nella vista normale.

## 13. Verifica dei criteri e passaggi per lo sviluppo

| Criterio | Dove è coperto |
|---|---|
| Issue 1 · Ogni voce di interfaccia del «Contenuto» di N2 ha una sezione, con stati e testi | §0 (mappa), §2-§11 |
| N2 1 · Nessuna parola tecnica nella vista normale | §1.2, §4, §5, §10.1; test di §12 |
| N2 2 · Un utente raggiunge solo il suo registro; l'admin non raggiunge quello di un altro | §8.3, §9; test di §12 |
| N2 5 · Una seconda banca si collega | §7 |

Dati che l'interfaccia richiede e che il piano non elenca. Non sono decisioni di prodotto.

1. **`SyncStatus`.** Funzione pura nel dominio con gli ingressi di §2.2. Restituisce valore, caso del testo e tipo di azione. La pagina traduce e formatta.
2. **«L'intervallo» della regola 5.** Il piano dice «oltre l'intervallo». Serve una definizione sola, dalla pianificazione del collegamento. La soglia dell'avviso `sync_stale` resta quella di oggi (AN3: stessi avvisi).
3. **Descrittore del fornitore.** Un oggetto per fornitore con le azioni di §1.1; per Wallet, Trek, eToro e Binance vive nel core fino a R5c. Nessun confronto sul nome del fornitore nella riga.
4. **«Lettura in corso».** La riga deve sapere se esiste una lettura `running` non orfana per il collegamento.
5. **`plugin_down` in una lettura automatica.** La lista chiusa ha 5 codici: una lettura fallita perché il plugin non risponde si salva come `provider_down`.
6. **Cronologia.** Per ogni lettura: quando, esito, origine, conteggi «nuovi» e «aggiornati» per tipo di dato, codice.
7. **Scadenza.** `expires_at` per collegamento, già usato da N1 nella riga di dettaglio.
8. **Diagnostica.** Per ogni plugin: nome, versione, versione del contratto, ora dell'ultimo controllo riuscito, ora del primo controllo fallito della serie corrente.
9. **Rapporto.** Costruito sul server da un elenco chiuso di campi (§8.4), con un test che fallisce se un campo fuori elenco entra.
10. **Chiavi di notifica.** Migrazione delle righe salvate con `wallet_sync_failed` e `wallet_sync_stale` (piano §4.3, AN3).
11. **N1.** La specifica di N1 non cambia: §5.1, §5.3, §5.5 e §4.4 di N1 sono sostituite da §2, §3, §7 e §8.2 di questo documento al rilascio di N2.

## 13.1 Note dello sviluppo (15/11/2026)

Scelte fatte nello sviluppo di N2, dentro i punti di §13. Non cambiano le decisioni di §14.

- **«L'intervallo» (punto 2).** Un collegamento è in ritardo quando la lettura dovuta dalla sua pianificazione manca
  da oltre 15 minuti, oppure l'ultima lettura è fallita. La soglia dell'avviso `sync_stale` resta 36 ore.
- **Cronologia (punto 6).** Un fornitore legge più tipi di dato in un passaggio (conti e movimenti): le letture di
  un passaggio sono una riga sola, con l'esito peggiore e la somma delle novità.
- **Fallimento senza codice.** Un errore che non rientra nei 5 codici si salva senza codice: la riga è «In ritardo»
  e la cronologia dice «Non riuscito» senza testo. Non si salva un codice inventato.
- **Collegamento assente.** La riga dice «Non collegato» una volta sola, accanto al nome: nessuna frase sotto.
- **Mail di scadenza.** L'oggetto ha anche il caso «scade oggi», per il giorno stesso.
- **Descrittore del fornitore (punto 3).** Il nome di un collegamento e la capacità «rileggi lo storico» stanno nel
  registro dei passaggi (`platform/integrations/registry.ts`); le azioni della riga sono una sola Server Action
  (`connection-actions.ts`). Nessun file nuovo contiene un nome di fornitore.
- **«Attiva» dalla riga.** Rende dovuti subito i collegamenti pianificati del plugin: li legge il dispatcher entro
  un minuto.
- **Filtro del registro.** Il modulo porta all'ancora `#log`: il lettore riparte dal registro.

## 14. Decisioni prese

Decisioni di Mattia del 15/11/2026 sulle 5 domande di questa specifica: default (A) per tutte. Il testo applica l'opzione A.

| # | Domanda | Esempio | A (default) | B | Effetto | Decisione |
|---|---|---|---|---|---|---|
| Q1 | Dove arriva un avviso, oltre alla mail? | BBVA fallisce 3 volte di seguito. Mattia non apre le impostazioni | Mail (come oggi) + stato sulla riga del collegamento | In più, un avviso in Overview: «BBVA non si aggiorna da ieri» con il link alle impostazioni | A: nessuna schermata nuova; chi non legge la mail lo scopre in Impostazioni o nel conto. B: il problema si vede all'apertura dell'app; una vista in più in N2 | **A** |
| Q2 | Il limite di letture della banca conta nei «3 fallimenti»? | BBVA risponde «limite raggiunto» a 3 letture automatiche di seguito; la quarta riesce | No: la riga dice «In ritardo» con il motivo e l'ora del nuovo tentativo; nessuna mail | Sì: alla terza parte la mail «BBVA non sincronizzato» | A: nessuna mail per un problema che si risolve da solo; un limite che dura giorni si vede solo sulla riga (e con l'avviso «fermo»). B: più mail, alcune senza un'azione possibile | **A** |
| Q3 | Lo stato del collegamento si vede anche fuori da Impostazioni? | Mattia disattiva Enable Banking e apre il conto BBVA in Accounts | Sì, nel dettaglio del conto: «In pausa · Enable Banking non è attivo · Attiva». Elenco di Accounts e Investments restano come oggi fino a R3 | No: solo in `Settings › Integrations`. Il conto mostra la data dell'ultima lettura | A: l'utente capisce perché il conto è fermo (esempio di H30); una vista in più in N2. B: meno lavoro; il conto sembra fermo senza motivo | **A** |
| Q4 | Un plugin non risponde: l'admin riceve un avviso? | Il container di Enable Banking si ferma alle 14:02 | No: lo stato è solo in `Server › Diagnostica` (testo del piano) | Sì: un avviso all'admin dopo 15 minuti senza risposta, sul canale degli avvisi dell'admin | A: il guasto si nota dagli errori degli utenti o aprendo Diagnostica. B: l'admin lo sa subito; una regola di avviso in più | **A** |
| Q5 | «Riattiva» su un collegamento «In pausa»: quale pianificazione torna? | Mattia ha tolto ogni orario a Trek. Poi preme «Riattiva» | La pianificazione consigliata del fornitore, con un clic | Si apre il dialogo della pianificazione: l'utente sceglie gli orari | A: un clic; per orari diversi l'utente va in «Avanzate». B: un passo in più; nessuna sorpresa sugli orari | **A** |

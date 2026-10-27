# Pianificazione della sync delle integrazioni

PERS-60 (27/10/2026). Sostituisce D7 di `docs/auth-design.md`: là ogni connessione aveva una sola
modalità (`interval` 15–1440 min allineato alla mezzanotte, da 1 a 6 orari a quarti d'ora, oppure
`manual`) e il cron batteva ai minuti `:07`, `:22`, `:37`, `:52`.

## Requisiti

- Orari **al minuto** (es. 06:43), con ritardo massimo di 1–2 minuti.
- **Più regole per connessione**, combinate: intervallo in una fascia oraria, orari specifici,
  giorni della settimana, giorni del mese, cron come opzione avanzata.
- **Anteprima** delle prossime esecuzioni nella timezone dell'utente e validazione chiara.
- **Preset** rapidi modificabili.
- Migrazione degli schedule D7 senza perdere scelte; default invariato: ogni 60 minuti.
- DST e cambio di timezone gestiti come in D7.

## Modello dati

`integration_connections.schedule` (jsonb) è `{ "rules": Rule[] }`. Le esecuzioni sono
l'**unione** dei minuti di tutte le regole; un minuto comune a due regole parte una volta sola.
`rules: []` è "solo manuale" (`next_sync_at = null`).

| `kind` | Campi | Esempio |
|---|---|---|
| `interval` | `everyMinutes` (15–1440), `from`, `until` (`HH:MM`, `until ≥ from`), `days` | ogni 30 min dalle 08:00 alle 19:00, lun–ven |
| `times` | `times` (1–96 orari `HH:MM`), `days` | 06:43 e 21:05, tutti i giorni |
| `cron` | `expression` (5 campi: minuto ora giorno-mese mese giorno-settimana) | `30 18 * * 6,0` |

`days`: `{kind: "every"}`, `{kind: "weekdays", weekdays: [1..7]}` (ISO, 1 = lunedì) oppure
`{kind: "monthDays", monthDays: [1..31, -1]}` (`-1` = ultimo giorno del mese). Un giorno 31 in un
mese di 30 giorni non parte, come in cron: per "fine mese" si usa `-1`.

Il cron accetta `*`, liste, intervalli, passi (`*/20`, `8-18/2`, `5/20`) e i nomi inglesi di mesi
e giorni; 0 e 7 sono domenica. Se giorno-mese e giorno-settimana sono entrambi ristretti basta uno
dei due (semantica Vixie cron). Niente `@daily`, `L`, `W`, `#`: parser proprio, nessuna dipendenza.

Massimo 8 regole per connessione. Lo schema zod (`syncScheduleSchema`) e le funzioni pure stanno in
`src/platform/integrations/schedule.ts`, senza `server-only`: l'editor le usa nel browser per
l'anteprima, il dispatcher sul server per il prossimo run. Un `check` SQL verifica solo che
`rules` sia un array.

### Limite anti-abuso: 15 minuti

Tra due esecuzioni della stessa connessione passano **almeno 15 minuti**, su tutte le regole
insieme e a cavallo della mezzanotte (max 96 esecuzioni al giorno).

- Ogni sync fa più chiamate al provider (Wallet: conti, poi i movimenti a pagine). L'API di Wallet
  non è ufficiale e non pubblica quote; 15 minuti è il minimo con cui D7 ha già girato senza 429.
- Il limite vale per tutti i provider: Trek e Paperless sono self-hosted, ma una regola uniforme è
  più semplice da spiegare e da verificare.
- Scartato un minimo più basso (5 min): guadagno reale nullo per dati finanziari che cambiano poche
  volte al giorno, rischio di blocco del token Wallet.

`scheduleProblems(schedule, today)` controlla l'unione dei minuti per i prossimi 400 giorni (copre
ogni combinazione di giorno della settimana e del mese) e rifiuta:

- `tooFrequent`: due esecuzioni a meno di 15 minuti, con i due orari nel messaggio;
- `neverRuns`: una regola che non parte mai in 4 anni (es. `0 7 30 2 *`).

Il server ripete la stessa validazione in `saveSchedule` (`invalid_schedule`). A runtime
`nextSyncAfterPass` non torna mai prima di 15 minuti dallo slot appena eseguito: copre i casi che
la validazione sul wall clock non vede (due slot che il cambio d'ora autunnale schiaccia nella
stessa ora).

## Calcolo delle esecuzioni

`nextSyncTimes(schedule, timeZone, after, n)` scorre i giorni civili nella timezone dell'utente
(dal giorno prima, per sicurezza sugli offset, fino a 4 anni avanti), calcola i minuti del giorno
di ogni regola, li converte in istanti con `wallClockIn` e restituisce i primi `n` strettamente
dopo `after`.

- **DST**: "07:00" resta 07:00 locale. Un orario nel buco primaverile (02:30 a Roma il 29/03)
  parte un'ora dopo (03:30); un orario dell'ora ripetuta in autunno parte una volta, alla prima
  occorrenza (risoluzione "compatible" di Temporal, come in D7).
- **Cambio timezone**: salvare le preferenze ricalcola `next_sync_at` di tutte le connessioni
  (`rescheduleConnections`), come in D7.
- I formatter `Intl.DateTimeFormat` di `src/platform/dates.ts` sono ora memorizzati per zona:
  l'anteprima risolve centinaia di orari a ogni modifica.

## Scheduler

- Nuovo tier **`minute`**: `cron/crontab` chiama `/api/jobs/tick?tier=minute` ogni minuto
  (supercronic, secondo 0). Il tier contiene solo `integrations-sync`. Sostituisce il tier
  `quarter`, che resta ammesso in `job_runs.tier` solo per le righe storiche.
- `JobDefinition.hasWork()`: prima di prendere il lock il tick chiede se c'è una connessione
  dovuta (`anyConnectionDue`, una lettura sull'indice `next_sync_at`). Se no, nessun lock e nessuna
  riga in `job_runs`: altrimenti 1.440 righe al giorno senza contenuto. "Run now" non lo chiede.
- `integrations-sync` resta anche **primo** nel tier `hourly` (`:07`), prima dei job che leggono i
  movimenti sincronizzati. Al minuto `:07` minute e hourly scattano insieme: il lock
  `job:integrations-sync` fa passare le connessioni una volta sola.
- Ritardo: una connessione dovuta alle 06:43 parte al tick delle 06:43:00, salvo una sync più
  lunga di un minuto ancora in corso (il lock fa saltare i tick fino alla sua fine). L'heartbeat
  viene toccato ogni minuto.
- Dopo il run `next_sync_at = nextSyncAfterPass(schedule, tz, slot, now)`: il primo slot dopo
  `now`, mai entro 15 minuti dallo slot eseguito. Dopo un fermo dell'app parte un run, poi il
  prossimo slot futuro: nessun recupero a raffica.

## Interfaccia

Settings › Integrazioni, card di ogni provider: riassunto della prima regola (`+N` se ce ne sono
altre, tutte nel tooltip) e "Prossima: …". "Cambia" apre il dialog:

1. **Scelte rapide**: Ogni ora, Ogni 30 min in orario d'ufficio, Due volte al giorno, Giorni
   feriali alle 8:00, Il 1° del mese, Solo manuale. Riempiono l'editor; nulla è salvato finché
   non si preme Salva.
2. **Regole**: per ognuna il tipo (Ogni… / Agli orari… / Cron), i campi del tipo e i giorni (tutti,
   giorni della settimana come chip, giorni del mese come griglia 1–31 + "Ultimo giorno"). Gli
   orari si aggiungono con un campo `time` e si tolgono dal chip. "Aggiungi una regola" fino a 8.
3. **Anteprima** delle prossime 5 esecuzioni nella timezone dell'utente, aggiornata a ogni
   modifica (`aria-live`). Con un errore mostra il motivo e Salva resta disabilitato.

i18n in `messages/{en,it}.json` (`settings.integrations.scheduleControl`). Il dialog entra in
`tests/e2e/a11y.spec.ts` due volte: vuoto (manuale) e con tre regole.

## Migrazione `0034_sync_scheduler_v2`

Converte gli schedule D7 nelle regole equivalenti, senza toccare `next_sync_at` (gli istanti non
cambiano):

| D7 | Regole |
|---|---|
| `{"mode":"interval","everyMinutes":N}` | `interval` ogni N dalle 00:00 alle 23:59, tutti i giorni |
| `{"mode":"times","times":[…]}` | `times` con gli stessi orari, tutti i giorni |
| `{"mode":"manual"}` | `[]` |

Poi cambia il default della colonna, sostituisce il `check` sulla modalità con quello su `rules`
e aggiunge `minute` ai tier di `job_runs`. `parseSyncSchedule` legge ancora la forma D7, quindi
anche un valore scritto da un'immagine precedente resta leggibile.

## Rollback

1. `docker tag ledgerly:pre-sync-scheduler-v2 ledgerly:latest` e
   `docker tag ledgerly-cron:pre-sync-scheduler-v2 ledgerly-cron:latest`, poi
   `docker compose up -d --no-build`. Le due immagini vanno insieme: la vecchia app non conosce il
   tier `minute`, il vecchio cron chiama `quarter`.
2. Ripristina gli schedule nel formato D7 (la vecchia immagine legge un valore sconosciuto come il
   default orario e il vecchio `check` rifiuterebbe le scritture):

   ```sql
   ALTER TABLE integration_connections DROP CONSTRAINT integration_connections_schedule_rules_ck;
   UPDATE integration_connections SET schedule = CASE
     WHEN schedule->'rules' = '[]'::jsonb THEN '{"mode":"manual"}'::jsonb
     WHEN schedule->'rules'->0->>'kind' = 'times' THEN jsonb_build_object('mode','times','times',schedule->'rules'->0->'times')
     ELSE '{"mode":"interval","everyMinutes":60}'::jsonb END;
   ALTER TABLE integration_connections ALTER COLUMN schedule SET DEFAULT '{"mode":"interval","everyMinutes":60}'::jsonb;
   ALTER TABLE integration_connections ADD CONSTRAINT integration_connections_schedule_mode_ck CHECK (schedule->>'mode' in ('interval','times','manual'));
   ```

   Orari non a quarti d'ora o più di 6 orari non sono validi in D7: vanno sistemati a mano dopo.
   In alternativa ripristina il dump `backups/ledgerly/pre-sync-scheduler-v2.dump`.
3. Cancella la riga di 0034 da `drizzle.__drizzle_migrations` (la più recente): la vecchia immagine
   la ignora, ma senza cancellarla un nuovo deploy non riapplicherebbe la migrazione.

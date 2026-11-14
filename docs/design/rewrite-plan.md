# Ledgerly · piano di riorganizzazione, riscrittura modulare e app multipiattaforma

Stato: **approvato il 14/11/2026; revisione sulla standardizzazione approvata da Mattia il 14/11/2026.** L'OK del
14/11/2026 sblocca N0: ogni rilascio parte da un'issue nuova. La revisione ([`11-standardization.md`](rewrite-plan/11-standardization.md))
aggiunge N6, R5g, il secondo passo di R5d e tre anticipi in N1, N2 e N5; non cambia l'ordine dei rilasci esistenti.
Base del codice e dell'audit: `main` a `5fbbdbc` (13/11/2026), tag `v0.10.1`. Dopo l'audit: `v0.10.2` (`86e3d43`), solo la
correzione del difetto BUD-1.
Decisioni: approvate da Mattia il 13/11/2026, dopo il brainstorming delle tre fasi (prodotto, architettura, app).
Revisione del 14/11/2026: la modularità è l'obiettivo principale del refactor; nessuna review del codice fino alla fine.
Seconda revisione del 14/11/2026 (standardizzazione): un solo fondo pensione; il PAC è un piano di acquisto del
Portafoglio manuale; nessuna funzione su misura per un fornitore, una banca, un fondo o un datore di lavoro.

## Obiettivo e priorità del refactor

Il refactor non è generico. L'obiettivo è l'ottimizzazione del codice, intesa soprattutto come qualità della sua
organizzazione. Le priorità, in ordine:

1. **Modularità:** moduli con responsabilità singole e ben definite, interfacce chiare, basso accoppiamento, nessuna
   duplicazione.
2. **Pulizia e chiarezza:** codice leggibile, nomi espliciti, struttura coerente, niente codice morto o complessità
   superflua.
3. **Prestazioni:** esecuzione più veloce, solo dopo i due punti precedenti.

**Regola di conflitto:** vince la priorità più alta. Non si sacrifica modularità o leggibilità per la velocità, a meno
che il guadagno sia significativo e misurato. In quel caso lo sviluppatore lo segnala in modo esplicito a Mattia prima
del commit, e decide Mattia.

**Vincolo: il comportamento funzionale del codice resta invariato.** Prova: test esistenti verdi senza asserzioni
adattate, test «stessi numeri», e2e. N6 e R5g sono cambi voluti, con i loro criteri; le eccezioni sui numeri sono
dichiarate una per una (X1-X3).

Architettura modulare di arrivo, regole con il loro controllo automatico, misure e procedura di eccezione:
[`10-modularity.md`](rewrite-plan/10-modularity.md).

Questo piano non modifica i documenti di design esistenti. Il [registro delle decisioni](rewrite-plan/01-decisions.md)
dice quali punti di `investments.md`, `investments-ux.md` e `funds-ux.md` sono sostituiti.

## File del piano

| # | File | Contenuto |
|---|---|---|
| 1 | [`01-decisions.md`](rewrite-plan/01-decisions.md) | Registro delle decisioni: decisione, data, cosa sostituisce, rilascio che la realizza |
| 2 | [`02-audit.md`](rewrite-plan/02-audit.md) | Audit del codice per modulo: sintesi, con la priorità di ogni voce. Dettaglio con `percorso:riga` in [`audit-domain.md`](rewrite-plan/audit-domain.md), [`audit-platform.md`](rewrite-plan/audit-platform.md), [`audit-ui.md`](rewrite-plan/audit-ui.md) |
| 3 | [`03-releases.md`](rewrite-plan/03-releases.md) | Fasi e rilasci in ordine: obiettivo, contenuto, git, migrazioni, rollback, test, criteri di accettazione, OK richiesto, dimensione |
| 4 | [`04-now.md`](rewrite-plan/04-now.md) | Lavoro «ora» sul codice attuale: runtime dei plugin, Enable Banking, stato dei collegamenti, categorizzazione, movimento manuale, Time Off |
| 5 | [`05-refactor.md`](rewrite-plan/05-refactor.md) | Refactor modulo per modulo, con il criterio di uscita nell'ordine delle tre priorità |
| 6 | [`06-data.md`](rewrite-plan/06-data.md) | Migrazioni previste, regola di compatibilità, dump, test «stessi numeri» |
| 7 | [`07-apps.md`](rewrite-plan/07-apps.md) | App Android e Windows, senza distribuzione |
| 8 | [`08-agents.md`](rewrite-plan/08-agents.md) | Agenti: ruoli, confini dei pacchetti, ordine, verifica dei rilasci senza review del codice, secondo agente, secondo database di test |
| 9 | [`09-risks.md`](rewrite-plan/09-risks.md) | Rischi, ipotesi aperte, ipotesi confermate e punti decisi il 14/11/2026 |
| 10 | [`10-modularity.md`](rewrite-plan/10-modularity.md) | Obiettivo e priorità, pacchetti e moduli di arrivo (responsabilità, interfaccia, dipendenze), mappa delle dipendenze, accoppiamenti da sciogliere, regole con controllo automatico, duplicazione, pulizia, prestazioni, prova di comportamento invariato, punti di estensione comuni E1-E8 |
| 11 | [`11-standardization.md`](rewrite-plan/11-standardization.md) | Standardizzazione (approvata da Mattia il 14/11/2026): regola, fondo pensione standard, piano di acquisto (PAC), Investments a 2 gruppi, elenco delle funzioni su misura con meccanismo standard e rilascio, anticipi alla fase A |

## Premesse

1. Ogni host gestisce la sua istanza. Poi aggiunge amici e familiari, ognuno con il suo account.
2. Gli utenti non sono tecnici. Le impostazioni tecniche sono nascoste o sotto «Avanzate».
3. L'istanza è pubblica su internet (tunnel Cloudflare → Traefik). Le app la raggiungono senza altri strumenti di rete.
4. La review è una sola, alla fine, quando Mattia dichiara tutto completo: codice e sicurezza. Prima, nessuna review
   del codice in nessun rilascio. Il gate di ogni rilascio è: test, controlli automatici, verifica dell'orchestratore.
5. Vincoli di sempre: nessuna perdita di dati; ogni rilascio ha rollback (immagine `pre-*` + dump); Overview e
   conti singoli mostrano gli stessi numeri; le chiavi dei provider sono in sola lettura (eccezione dichiarata: Trek).
6. I calcoli approvati (P&L, Modified Dietz, XIRR, interessi, Cometa) non cambiano risultato.

## Architettura di arrivo

```mermaid
flowchart TB
  WEB[Web · browser] --> TR
  AND[Android · Capacitor] --> TR
  WIN[Windows · Tauri 2] --> TR
  EXT[Client esterni · MCP] --> TR
  TR[Cloudflare e Traefik] -->|/| WEBSRV[apps/web · solo interfaccia]
  TR -->|/api| API[apps/api · REST /api/v1 · MCP · login]
  API --> DOM[[packages/domain · regole e totali, un solo calcolo]]
  WRK[apps/worker · sync e job, coda su PostgreSQL] --> DOM
  DOM --> PG[(PostgreSQL · dati, coda, segreti cifrati)]
  API --> S3[(Silo S3 · documenti)]
  WRK -->|verify · sync · push| PL[Plugin · Enable Banking, Wallet, Trek · senza stato]
  PL --> PROV[Provider]
  WRK -->|eToro, Binance, prezzi| PROV
```

```text
apps/      api · worker · web · android · windows
packages/  domain · api-contract · api-client · design-tokens · ui · plugin-contract · plugin-host
plugins/   enablebanking · wallet · trek · catalog.json
```

## Ordine dei rilasci

```mermaid
flowchart LR
  subgraph A[Fase A · ora, sul codice attuale]
    N0[N0 preparazione] --> N1[N1 plugin + Enable Banking]
    N1 --> N2[N2 stato dei collegamenti]
    N2 --> N3[N3 categorie automatiche + movimento manuale]
    N3 --> N4[N4 passaggio da Wallet]
    N0 --> N5[N5 Time Off]
    N5 --> N6[N6 fondo pensione standard]
  end
  subgraph B[Fase B · riscrittura]
    R0[R0 monorepo] --> R1[R1 worker]
    R1 --> R2[R2 API completa]
    R2 --> R3[R3 web sull'API]
    R3 --> R4[R4 container separati]
    R4 --> R5[R5 prodotto nuovo a-e]
    R5 --> R5G[R5g lavoro standard]
    R5G --> R5F[R5f pulizia dello schema]
  end
  subgraph C[Fase C · app]
    C0[C0 prove tecniche] --> C1[C1 Android: involucro]
    C1 --> C2[C2 Android: funzioni native]
    C2 --> C3[C3 Android: widget]
    C2 --> C4[C4 Windows]
  end
  N4 --> R0
  N6 --> R0
  R1 --> C0
  R3 --> C1
  R4 --> C2
  R5F --> Z[Z review finale unica]
  C4 --> Z
```

| Rilascio | Obiettivo | Cosa cambia per l'utente | Git | Migrazioni | OK di Mattia | Dim. |
|---|---|---|---|---|---|---|
| N0 | Cartella dei dump, icona installabile, correzioni di servizio, misure di partenza | Ledgerly si installa dal browser | `main` | No | Solo percorso dei dump | S |
| N1 | Runtime minimo dei plugin, plugin Enable Banking, prima banca | Collega una banca | branch + PR | Sì, additive | Sì (#1, #3, #4, #5) | L |
| N2 | Stato semplice per collegamento, registro per l'admin, più banche | Una riga chiara per collegamento | branch + PR | Sì | Sì (#1) | S |
| N3 | Categorie automatiche, «Da categorizzare», movimento manuale | Categorie senza Wallet, spese a mano | branch + PR | Sì, additive | Sì (#1) | L |
| N4 | Passaggio di un conto da Wallet a Enable Banking | Un conto cambia sorgente senza doppioni | branch + PR | Dati | Sì (#1) | M |
| N5 | Time Off: primo e ultimo giorno + pannello | Nessun gesto nascosto | `main` | No | No | M |
| N6 | Fondo pensione standard: un modello, sorgenti di contributo, commissioni generiche, migrazione dei 2 fondi; via il «Deducibile» e i documenti dei fondi | «Aggiungi fondo» senza tipo; un fondo nuovo si configura | branch + PR | Sì, additive + dati | Sì (#1) | L |
| R0 | Monorepo npm workspaces, confini e regole di modularità nel gate, codice morto tolto | Nulla | `main` | No | No | M |
| R1 | Worker dedicato, coda su PostgreSQL, fine del container cron | Nulla | branch + PR | Sì, additive | Sì (#1) | M |
| R2 | API completa, chiamate dagli involucri, refactor del dominio modulo per modulo | Nulla | `main`; PR per auth e schema | Sì, additive | Sì per le parti #1 e #4 | L |
| R3 | Web sull'API, schermate solo client, refactor dell'interfaccia | Nulla di visibile | `main` | No | No | L |
| R4 | `api` e `web` in container separati | Nulla | branch + PR | No | Sì (#3) | S |
| R5a | Menu a 3 gruppi, moduli attivabili, primo avvio, Settings | Navigazione nuova | branch + PR | Sì, additive | Sì (#1) | M |
| R5b | Investments unificata, Overview a gruppi | Una home con 2 gruppi | `main`; PR se cambia l'API | No | Solo se #4 | L |
| R5c | Wallet e Trek come plugin, tab Plugin completo | Wallet e Trek si installano | branch + PR | Sì | Sì (#1, #3, #5) | L |
| R5d | Portafoglio manuale, prezzi per ISIN; secondo passo: piano di acquisto (PAC) | «Registra operazione»; acquisti periodici | branch + PR | Sì, additive | Sì (#1, #5) | L |
| R5e | Avvisi, blocco «Da fare», «Nascondi importi» | Avvisi solo quando serve un'azione | branch + PR | Sì, additive | Sì (#1) | M |
| R5g | Lavoro standard: tipi di assenza come dati, profili delle buste paga, configurazione del datore | Payroll e Time Off senza codice per un altro datore o contratto | branch + PR | Sì, additive + dati | Sì (#1) | L |
| R5f | Pulizia dello schema | Nulla | branch + PR | Sì, rimozioni | Sì (#1) | S |
| C0 | Prove tecniche degli involucri | Nulla | fuori da `main` | No | Gate Security Gatekeeper | S |
| C1 | Android: involucro, login, cache cifrata | App Android installata a mano | `main` | No | No | M |
| C2 | Android: biometria, avvisi periodici, condivisione PDF, azioni rapide | App «compagno» completa | `main` | No | No | M |
| C3 | Android: widget | Widget «Da fare» e «Questo mese» | `main` | No | No | S |
| C4 | Windows: guscio con la stessa interfaccia | App Windows da build locale | `main` | No | Gate Security Gatekeeper | M |
| Z | Review finale unica: codice e sicurezza | Nulla | — | — | La chiede Mattia | — |

N6, R5g e il secondo passo di R5d sono della revisione sulla standardizzazione: approvata da Mattia il 14/11/2026.
I numeri `#n` sono i criteri di `git-policy` §6. Dettaglio di ogni rilascio: [`03-releases.md`](rewrite-plan/03-releases.md).

## OK richiesti a Mattia

1. **Questo piano.** Sblocca N0. Dato il 14/11/2026.
2. **Un OK per ogni rilascio con un criterio §6**, sul singolo SHA, prima del deploy (colonna «OK di Mattia»).
3. **Le ipotesi da confermare** di [`09-risks.md`](rewrite-plan/09-risks.md) §9.3. Confermate il 14/11/2026 con il default
   scritto lì: ora sono decisioni ([`01-decisions.md`](rewrite-plan/01-decisions.md) §1.0, H7-H11).
4. **Passi che solo Mattia può fare:** applicazione Enable Banking di tipo Production e accesso alla banca (N1); chiave
   gratuita EODHD (R5d); installazione dell'APK sul telefono (C1); build su un PC Windows (C4).
5. **La revisione sulla standardizzazione:** OK al contenuto di [`11-standardization.md`](rewrite-plan/11-standardization.md)
   e risposta alle ipotesi ST-1…ST-24 ([`09-risks.md`](rewrite-plan/09-risks.md) §9.6). Basta «ok default» più le eccezioni.
   Risposta del 14/11/2026: eccezioni su ST-4, ST-6 e ST-7, ora decisioni H18-H20; le altre sono decisioni, con il
   default. OK alla revisione dato il 14/11/2026 (decisione H21). ST-26 e ST-27: decisioni, con il default.
   ST-25: default scartato, scelta in attesa di precisazione ([`09-risks.md`](rewrite-plan/09-risks.md) §9.6).
6. **Ogni eccezione alle priorità:** un guadagno di velocità che costa modularità o leggibilità, prima del commit
   ([`10-modularity.md`](rewrite-plan/10-modularity.md) §10.9.3).

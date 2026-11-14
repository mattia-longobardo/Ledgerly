# 8. Agenti

Indice del piano: [`../rewrite-plan.md`](../rewrite-plan.md).

## 8.1 Ruoli

| Ruolo | Agente | Cosa fa | Cosa non fa |
|---|---|---|---|
| Orchestratore | Homelab Orchestrator | Ordine dei rilasci, sotto-issue, conferma di perimetro delle rotte del contratto, verifica dei gate di ogni rilascio (§8.5), domande a Mattia | Non scrive codice. Non fa review del codice |
| Filone server | Homelab Homeserver Dev | `packages/domain`, `packages/api-contract`, `apps/api`, `apps/worker`, `packages/plugin-contract`, `packages/plugin-host`, `plugins/`, migrazioni, compose, **tutti i deploy** | Da R2 non cambia `apps/web`, `packages/ui`, `packages/design-tokens`, `packages/api-client`, `apps/android`, `apps/windows` |
| Filone client | **Ledgerly Client Dev** (nuovo, §8.4) | `apps/web`, `packages/ui`, `packages/design-tokens`, `packages/api-client`, `apps/android`, `apps/windows`, traduzioni | Non cambia schema, migrazioni, regole di dominio, contratto, compose. Non fa deploy |
| Design | UX/UI Designer | Specifica di ogni schermata nuova prima dello sviluppo (N1, N2, N3, N5, R5), token, controllo delle schermate fatte | Non scrive codice di prodotto, non fa deploy |
| Pacchetti di terzi | Security Gatekeeper | Via libera a ogni strumento o pacchetto nuovo, prima dell'installazione | — |
| Immagini | Image Studio | Icona dell'app e delle notifiche | — |
| Review finale unica | Security Reviewer per la sicurezza; un agente di review scelto dall'orchestratore per il codice (decisione I17) | Una sola review, finale, quando Mattia dichiara tutto completo: codice e sicurezza | Nessuna review prima della fine |

## 8.2 Confini dei pacchetti

```mermaid
flowchart TB
  subgraph Server[Filone server]
    DOM[packages/domain]
    CON[packages/api-contract]
    API[apps/api]
    WRK[apps/worker]
    PH[packages/plugin-host]
    PC[packages/plugin-contract]
    PL[plugins/*]
  end
  subgraph Client[Filone client]
    CLI[packages/api-client]
    TOK[packages/design-tokens]
    UI[packages/ui]
    WEB[apps/web]
    AND[apps/android]
    WIN[apps/windows]
  end
  API --> DOM
  API --> CON
  WRK --> DOM
  WRK --> PH
  PH --> PC
  PL --> PC
  CLI --> CON
  UI --> TOK
  UI --> CLI
  WEB --> UI
  AND --> UI
  WIN --> UI
```

| Regola | Come si impone |
|---|---|
| Un proprietario per pacchetto | Tabella di §8.1. Un filone che deve cambiare un pacchetto dell'altro apre una richiesta all'orchestratore |
| Il contratto viene prima | Una rotta nasce in `api-contract` (schema zod + esempio). I controlli automatici del contratto passano (OpenAPI solo additivo, primitive comuni, nomi del glossario). L'orchestratore conferma che la rotta è nel perimetro del rilascio: non legge il codice. Poi i due filoni lavorano in parallelo |
| `api-contract` è il solo punto di contatto | `api-client` e `ui` non importano `domain`. Un test delle dipendenze fallisce se lo fanno (regole M1 e M6 di [`10-modularity.md`](10-modularity.md) §10.6) |
| Dipendenze ammesse e vietate di ogni pacchetto e di ogni modulo | [`10-modularity.md`](10-modularity.md) §10.2 e §10.3. Il gate G4 le impone |
| Un plugin importa solo `plugin-contract` | Stesso test |
| File comuni | `package.json` di radice, `package-lock.json`, `messages/*.json`: modifiche piccole, un commit dedicato, rebase prima del push. Le chiavi di traduzione sono del filone client; il filone server chiede le chiavi che gli servono |
| Un solo scrittore per branch | `git-policy` §3. Il filone client lavora su `main`; le PR sono solo del filone server, una per volta |
| Deploy uno per volta | Lock `/var/lock/deploy-ledgerly.lock`. Lo fa solo il filone server, anche per i commit del filone client |

## 8.3 Ordine del lavoro

| Fase | Filone server | Filone client | Parallelo |
|---|---|---|---|
| N0-N5 | Tutto, in serie | — (UX/UI Designer per le schermate) | No |
| R0, R1 | Tutto, in serie | — | No |
| Inizio di R2 | Primo modulo: contratto e rotte | Nasce l'agente. C0 (prove tecniche, dopo il gate). `design-tokens`. Componenti condivisi dell'audit in `packages/ui`, sul web attuale, senza toccare la lettura dei dati | Sì |
| R2 + R3 | Modulo N: contratto → rotte → refactor del dominio | Modulo N-1: hook dati → schermate solo client → cancellazione delle azioni. Involucro Android (C1) dal primo modulo | Sì, un modulo di distanza |
| R4 | Separazione dei container | Verifica del web e dell'app dopo la separazione | No (un deploy) |
| R5a-R5f | Dominio, migrazioni, plugin, prezzi, avvisi | Schermate nuove; C2, C3, C4 | Sì |
| Fine | Correzioni della review finale unica | Correzioni della review finale unica; poi l'agente si elimina | — |

Regole di sincronizzazione:

1. Ogni filone fa `git fetch` e `rebase origin/main` prima di ogni push (`git-policy` §2).
2. Il filone client non parte su un modulo prima che il suo passo R2 sia in produzione.
3. Una modifica al contratto dopo l'approvazione è additiva. Se non può esserlo, il filone server avvisa l'orchestratore, che ferma il filone client su quel modulo.
4. Il filone client consegna in `in_review`; il deploy è una sotto-issue del filone server, con l'elenco dei commit da portare in produzione.

## 8.4 Secondo agente: definizione

Mattia ha approvato un secondo agente di sviluppo. Si crea quando parte il filone client (inizio di R2). Si elimina a fine
sviluppo, dopo le correzioni della review finale. **Questo piano non lo crea.**

| Campo | Valore |
|---|---|
| Nome | `Ledgerly Client Dev` |
| Descrizione | Agente esecutore temporaneo per il filone client di Ledgerly: interfaccia web, pacchetti condivisi dell'interfaccia, client API, app Android e Windows. Non tocca schema, dominio, contratto e deploy |
| Runtime | Lo stesso server di Homelab Homeserver Dev |
| Skill | `concise-direct`, `git-policy`, `test-policy`, `multica-platform` |
| Repo | `mattia-longobardo/Ledgerly` |
| Memoria | Hindsight, bank `Personal`, tag `progetto:ledgerly`, `agente:ledgerly-client-dev` |
| Creazione | Dall'orchestratore, su una sotto-issue dedicata, con l'OK di Mattia già dato |
| Eliminazione | Dall'orchestratore, quando Mattia dichiara chiuso lo sviluppo. Prima: nessuna issue aperta assegnata, nessun commit non pubblicato, memorie salvate in Hindsight, database `ledgerly_test_2` rimosso (§8.6) |

Istruzioni (in inglese, come le istruzioni degli altri agenti del workspace):

```text
# Role
You are the temporary executor agent for the client stream of Ledgerly
(repo mattia-longobardo/Ledgerly, folder /home/mattia/docker/projects/Ledgerly).
You write the web interface, the shared interface packages, the API client and
the Android and Windows apps. You receive tasks as Multica issues from the
Homelab Orchestrator. Write for Mattia in Italian.

# What you own
- apps/web, apps/android, apps/windows
- packages/ui, packages/design-tokens, packages/api-client
- messages/*.json (translation keys)
- tests of these packages, and the e2e specs of the screens you change

# What you must not change
- packages/domain, packages/api-contract, apps/api, apps/worker
- packages/plugin-contract, packages/plugin-host, plugins/
- database schema and migrations, docker-compose.yml, Dockerfile, entrypoint
- other homelab stacks, and /home/mattia/docker/work in any case
If a task needs a change there, write the exact request on the issue, set the
issue to blocked, and stop. The Homelab Homeserver Dev makes that change.

# Rules of the client code
- Read docs/design/rewrite-plan.md and its files before you start. They take
  priority over these instructions.
- A screen is client-only React in a shared package: no Server Components, no
  Server Actions, no next/headers, no next/navigation and no next/link inside
  packages/ui.
- A client uses only /api/v1 through packages/api-client. A client never
  computes totals, P&L, returns or currency conversions. It formats only.
- Native code (Kotlin, Rust) holds device capabilities only: sign-in, secure
  storage, share target, widget, background work. No product screen and no
  domain rule in native code.
- Every user-facing string is a translation key in en and it.
- Every screen passes the a11y and keyboard specs at 400 and 1440 px, in both
  themes.
- Close the audit items (UI-*) of the module you work on. List each item as
  closed or deferred in the delivery comment.

# Priorities of the refactor
- Read docs/design/rewrite-plan/10-modularity.md. The order is: 1 modularity,
  2 clean and clear code, 3 performance. If two priorities are in conflict,
  the higher priority wins. The functional behavior does not change.
- Never add an entry to a known-violations list. Never change an existing
  test assertion to make a refactor pass.
- If a speed gain needs a rule violation, do not commit. Measure it, write the
  request on the issue and stop: Mattia decides (section 10.9.3).

# Git
- Follow the git-policy skill. Commit on main in small commits; each commit
  keeps the tests green and production behavior unchanged.
- Never open a branch or a PR without a git-policy §6 criterion. If your diff
  touches a §6 criterion, stop and report it: that work belongs to the server
  stream.
- Rebase on origin/main before each push.

# Tests and environments
- Choose the checks with the test-policy skill.
- Integration tests and the local preview use the database ledgerly_test_2.
  Never use ledgerly or ledgerly_test.
- You do not deploy. You do not run e2e against the production site. Deliver
  in in_review with the list of commits; the Homelab Homeserver Dev deploys.

# No code review
- You do not review the code of the server stream, and no agent reviews your
  code before the end. The gate of each release is: tests, automatic checks,
  and the verification of the orchestrator. Deliver the output of each gate in
  the delivery comment.

# New tools and packages
- Do not install a new third-party tool or package (Android SDK, Capacitor
  plugin, Tauri plugin, npm dependency) before the Security Gatekeeper
  approves it. Ask the orchestrator to open the gate.

# Limits
- Never read, print or commit .env values, tokens, keys or signing keys.
- Write only inside the task repo and the run workdir.
- No app distribution: no public channel and no developer account. Build an
  APK or a Windows build for manual installation only.
- Hindsight: recall at the start, retain before the final report, bank
  Personal, tags progetto:ledgerly and agente:ledgerly-client-dev.
```

## 8.5 Verifica dei rilasci, senza review del codice

Decisione di Mattia del 14/11/2026 (H6): **nessuna review del codice fino alla fine, in nessun rilascio.** Nessun
agente legge il diff di un altro: né la review incrociata tra i due sviluppatori, né un revisore intermedio.

Il gate di ogni rilascio ha tre parti:

| Parte | Chi | Cosa |
|---|---|---|
| Test | Lo sviluppatore del filone | G2, G3, G5, G6 ([`03-releases.md`](03-releases.md) §3.1) |
| Controlli automatici | Lo sviluppatore del filone | G4 (modularità), G1 (pulizia), G9 (prestazioni), G8 (health) |
| Verifica dell'orchestratore (G7) | Homelab Orchestrator | Legge gli esiti scritti nel commento di consegna. Non legge il codice |

Lo sviluppatore scrive nel commento di consegna l'esito di ogni gate, con il comando e il risultato reale.
L'orchestratore verifica, in ordine:

1. **Perimetro:** l'elenco dei file cambiati e dei commit corrisponde al rilascio di [`03-releases.md`](03-releases.md).
2. **Priorità 1:** esito di G4; le liste note non sono più lunghe di prima; lista di controllo degli ID dell'audit del
   modulo ([`05-refactor.md`](05-refactor.md) §5.1, condizioni 1.x).
3. **Priorità 2:** esito di G1; condizioni 2.x.
4. **Priorità 3:** esito di G9 contro i valori di partenza; nessuna eccezione senza la decisione di Mattia.
5. **Comportamento invariato:** `assertions-diff` senza differenze; fotografia dei numeri «prima» = «dopo»; risposte di
   riferimento uguali; e2e verdi.
6. **Criteri di accettazione** del rilascio, uno per uno, con l'evidenza.
7. Valutazione `git-policy` §6 sul diff, scritta dallo sviluppatore.

Un punto negativo o senza evidenza riporta il lavoro all'autore. L'orchestratore può rilanciare un comando di gate in
sola lettura per controllare un esito.

**Alla fine: una review finale unica** (rilascio Z), quando Mattia dichiara tutto completo. Copre il codice e la
sicurezza. I finding diventano correzioni con il loro rilascio.

## 8.6 Secondo database di test

| Punto | Valore |
|---|---|
| Nome | `ledgerly_test_2`, nel PostgreSQL condiviso di `db/`, stesso utente del database `ledgerly_test` |
| Perché | Due filoni non possono usare insieme `ledgerly_test`: gli integration test lo ricreano |
| Chi lo usa | Solo il filone client: integration test e anteprima locale (`scripts/preview-on-test.sh`) |
| Come | `scripts/test-integration.sh` e l'anteprima leggono il nome del database da una variabile; default `ledgerly_test` |
| Quando si crea | Con il secondo agente, all'inizio di R2. Lo crea Homelab Homeserver Dev. È una modifica a un servizio condiviso (`git-policy` §6 #6): un OK di Mattia sul comando, e una riga in `/home/mattia/docker/AGENTS.md` |
| Quando si toglie | Con il secondo agente, a fine sviluppo. Contiene solo dati di prova: nessun dump |
| Produzione | Nessun effetto: `ledgerly` non è toccato |

## 8.7 OK di Mattia

| Quando | Cosa approva |
|---|---|
| Dato il 14/11/2026 | Questo piano e le ipotesi di [`09-risks.md`](09-risks.md) §9.3 |
| Ogni rilascio con un criterio §6 | Il singolo SHA, prima del deploy |
| Ogni decisione di prodotto non scritta qui | Prima dello sviluppo |
| Ogni eccezione alle priorità: velocità che costa modularità o leggibilità ([`10-modularity.md`](10-modularity.md) §10.9.3) | Prima del commit |
| Ogni numero che cambia fuori dalle decisioni D1-D11 | Prima del commit che lo cambia |
| Fine | Dichiara lo sviluppo completo: parte la review finale unica (codice e sicurezza); poi l'agente temporaneo si elimina |

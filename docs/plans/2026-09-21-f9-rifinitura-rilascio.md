# F9 — Rifinitura e rilascio

> Piano da eseguire **in linea**, lotto dopo lotto, come F3–F8. Chi lo riprende in mano non ha il
> contesto della sessione che l'ha scritto: qui dentro c'è tutto quello che serve.

## 0. Come si legge

1. `CLAUDE.md` alla radice — convenzioni vincolanti.
2. `docs/specs/2026-09-13-dev-0.1-design.md` — **§12 (riga F9)** e **§13 Rilascio e pulizia finale**
   (vincolanti), §8 intero (interfaccia e design system, in particolare **§8.2 struttura e
   responsive** e §8.4 correzioni al design), §11 (test e qualità, incluso il cancello di fine fase
   e la revisione per aree), §5.4 (container), §10 (job).
3. `docs/reviews/2026-09-16-f2-revisione-di-fase.md` — la forma che una revisione per aree ha già
   preso una volta: sei aree, rilievi con **[verificato]** riprodotti a mano, lotti sequenziali.
   È il modello da riusare per P3.
4. `UI Recreation and branding decisions/Finance Dashboard.dc.html` (sola lettura) — il confronto a
   schermo, che §11 assegna al proprietario, si fa contro questo file.
5. I piani da F0 a F8 in `docs/plans/`: ogni fase ha lasciato dei §3.6 («dove spec, design e realtà
   divergono») e dei §7 («resta al proprietario»). F9 è l'ultima occasione di chiuderli, e §7.1 di
   questo piano li raccoglie.

## 1. Obiettivo

F9 secondo §12: **revisione finale dell'intero branch; accessibilità (tastiera, etichette,
contrasto); prestazioni; documentazione (`README`, `CLAUDE.md`, procedura di rilascio); rilascio e
pulizia finale (§13)**.

Il prodotto della fase: un'applicazione che **si regge su uno schermo da telefono come su uno da
1440**, che una persona può attraversare da tastiera, e un repository che chi lo apre fra sei mesi
capisce senza chiedere. Poi il rilascio vero sul database `finance` e la cancellazione delle tre
cartelle di supporto.

Fuori perimetro: funzionalità nuove. Se una schermata non fa quello che la specifica dice, è un
difetto e si corregge; se la specifica non lo chiede, non entra in F9.

## 2. Punto di partenza (2026-09-21)

Branch `dev-0.1` con F8 consegnata (`6b4e031`); ultime migrazioni `0020`/`0021`. Cancello verde:
`format:check`, `lint`, `typecheck`, **1291** test unitari, **565** di integrazione, **66**
end-to-end sul sito pubblicato.

### 2.1 Che cosa misura oggi il controllo di layout, e che cosa no

`tests/e2e/a11y.spec.ts` (F7) controlla, a **1440 e 400 px**, quattro cose: nessuna violazione axe
WCAG 2.1 A/AA, niente che sporga dalla finestra, nessuna barra di scorrimento orizzontale che
nessuno ha chiesto, nessun bersaglio sotto 24 px. È il metro giusto. **Il problema è quanto poco
misura.**

Percorsi oggi nell'elenco: nove. **Sei** di essi (`/`, `/funds`, `/budgets`, `/interests`,
`/settings/integrations`, `/settings/security`) si aprono con la sessione `funds` — e il seme
end-to-end (`scripts/seed-e2e.ts`) non dà a quell'utente né conti, né fondi, né budget, né regole.
**Verificato il 2026-09-21** sul sito pubblicato: `/funds` per quell'utente dice «No investment
funds», `/accounts` per l'utente `accounts` dice «No accounts yet», e lo stesso vale per
`interests`, `payroll` e `cometa`, i cui spec si costruiscono i dati da soli durante il percorso.

Quindi il controllo misura **sei stati vuoti** e tre schermate con del contenuto (`/timeoff`,
`/settings/users`, `/settings/server`). Su **ventitré** schermate dell'applicazione, e con **zero**
pagine di dettaglio: le pagine che con ogni probabilità stanno peggio — quelle con i grafici e le
tabelle larghe — non sono mai state misurate piene.

Questo non è un difetto del metro: `a11y.spec.ts` fa esattamente quello che dice. È un difetto di
**che cosa gli si mette davanti**, e si corregge nel seme.

### 2.2 Che cosa ha trovato l'audit di questo piano

Passata a 400 px con emulazione mobile vera (`--project=mobile`) e a 1440 px sul sito pubblicato,
2026-09-21, su quindici percorsi con dodici sessioni diverse. Tutto quello che segue è misurato, non
ipotizzato:

| Dove | Che cosa | Gravità |
|---|---|---|
| `/settings/integrations` **da admin** | la tabella dei job esce **147 px** dalla finestra e la pagina scorre di lato | rotto |
| `/expenses` | i chip di categoria sono 110×22, 78×22, 62×22, 102×22; la casella «mostra nascoste» 14×24 | sotto i 24 px |
| `/expenses` | axe **`aria-prohibited-attr`** (serious, ×4): `aria-label="96%"` su uno `<span>` senza ruolo | violazione WCAG |
| `/budgets` | i bottoni degli importi rapidi sono 39×21 e 47×21 | sotto i 24 px |
| `/subscriptions` | i bottoni di utilità sono 41×19, 45×19, 90×19; i link «Check expenses» 94×17 | sotto i 24 px |
| `/expenses`, `/subscriptions` a 1440 | le intestazioni ordinabili sono alte 17 px (40×17 … 53×17) | sotto i 24 px |

Le pagine che l'audit ha aperto **piene** e che non hanno mostrato un solo difetto di sporgenza:
`/`, `/accounts`, `/pockets`, `/timeoff`, `/settings/profile`, `/settings/security`,
`/settings/data`, `/settings/users`, `/settings/server`. Non vuol dire che siano a posto: vuol dire
che a 400 px stanno nella finestra, il che è il punto di partenza e non l'arrivo.

**`/settings/integrations` è una regressione di F8** e la causa è nota: `a11y.spec.ts` apre quella
pagina con la sessione `funds`, che non è admin, quindi la card dei job non viene nemmeno resa. Il
metro non ha sbagliato la misura: ha misurato un'altra pagina. È il primo esempio del problema di
§2.1 e la prima cosa che P1 corregge.

## 3. Contratti decisi in anticipo

### 3.1 Il metro prima delle correzioni

P0 **non corregge niente**. Costruisce lo strumento e produce l'elenco; P1 e P2 lavorano su
quell'elenco. Invertire l'ordine vuol dire correggere quello che si vede e lasciare quello che non
si guarda, che è esattamente come si è arrivati a §2.2.

### 3.2 Ogni schermata, con dei dati dentro

Il seme end-to-end si estende finché **ogni utente ha la sua pagina piena**: un conto con dei saldi
per `accounts`, una regola per `interests`, un PAC con valorizzazioni per `funds`, un fondo pensione
con operazioni per `cometa`, un cedolino applicato per `payroll`. I dati si creano **attraverso i
servizi**, come già fa il seme, mai con INSERT a mano: un seme che scrive righe che nessun servizio
scriverebbe misura una schermata che non esiste.

Il cedolino di `payroll` è il caso scomodo: serve un PDF vero. Si usa il **gemello sintetico** già
versionato in `tests/fixtures/` (§11), che è lì apposta perché i test restino validi dopo la
cancellazione delle cartelle di supporto.

### 3.3 Che cosa conta come difetto di layout

Le quattro regole di `a11y.spec.ts` restano, e se ne aggiunge una quinta, che è quella che il
proprietario ha descritto a parole («testi che escono da div»):

5. **Nessun testo che trabocca dal suo contenitore**: un nodo di solo testo con `overflow: visible`
   il cui `scrollWidth` supera il `clientWidth`. È diverso dal troncamento voluto (`overflow:
   hidden` con `truncate`), che resta legittimo e non viene segnalato.

Una tabella che scorre dentro un contenitore `overflow-x-auto` **non è** un'eccezione alla regola
«niente che sporga dalla finestra»: il contenitore taglia l'immagine, non la posizione, e una
colonna a 147 px oltre il bordo resta irraggiungibile su un telefono. Dove una tabella non ci sta,
la risposta è quella che `funds` e (in F8) `users` hanno già dato: **tabella da `md` in su, elenco
sotto**, con gli stessi comandi in tutte e due le forme.

### 3.4 I 24 px, e l'unica eccezione

La regola del repository (24×24 px) è **più severa** di WCAG 2.1 AA, che non ha un criterio di
dimensione del bersaglio: è una scelta del proprietario (2026-09-20) e resta. WCAG 2.2 §2.5.8
introduce quel criterio e ne esclude i **link dentro una frase**, perché ingrandirli spezzerebbe la
riga di testo attorno.

Proposta: si adotta la stessa eccezione, **scritta nel controllo e non nel giudizio di chi legge**:
un `<a>` il cui genitore contiene altro testo attorno è inline ed è esente; tutto il resto no. Così
«Check expenses» (94×17, dentro una frase) smette di essere un rilievo e i chip di categoria
(110×22, bersagli isolati) restano un rilievo.

### 3.5 La revisione per aree (§11)

Sei aree, come in F2, sul diff `dev-0.1` intero. Ogni rilievo dichiara **dove**, **che cosa succede
davvero** e **come riprodurlo**; i rilievi che l'orchestratore riproduce a mano si marcano
**[verificato]**. Le correzioni arrivano in lotti sequenziali, e ogni lotto si chiude con il
cancello verde sull'albero intero.

Le sei aree: (A) soldi, date e arrotondamenti; (B) isolamento fra utenti e controlli di accesso;
(C) job, transazioni e I/O di rete; (D) integrazioni e importazioni; (E) interfaccia, stati vuoti e
messaggi; (F) piattaforma, configurazione e segreti.

### 3.6 Dove spec, design e realtà divergono — proposte

1. **Il `README` è fermo a F4.** Mancano le sezioni F5 (importazioni e payroll), F6 (Cometa), F7
   (ferie e Trek); F8 c'è. Proposta: P5 le scrive tutte e tre, perché un README che salta tre fasi
   su nove è peggio di nessun README — chi lo legge crede che quelle funzioni non ci siano.
2. **La card dei job in `/settings/integrations`** (F8) è la sola cosa che un admin vede lì e che
   un utente no. Proposta: resta dov'è (§7.10 la mette lì), e il controllo di layout impara a
   guardare la pagina **da admin**, che è il buco vero.
3. **`/api/metrics` e `/api/health`** non hanno mai avuto un controllo di prestazione. Proposta:
   P4 misura le tre pagine più pesanti (Overview, Expenses, Fund detail) con una sola passata di
   `performance.getEntriesByType("navigation")` e registra i numeri nel piano; nessuna soglia
   inventata, solo il numero e il giudizio del proprietario.
4. **Il confronto visivo con il design** resta del proprietario (§11) e non diventa un test.
5. **L'avatar** (§7.10 Profile, rimandato da F8 §3.6.1) non esiste ancora. Proposta: entra in F9
   solo se il proprietario lo chiede; non è una rifinitura, è una funzione, e §12 non la nomina.

## 4. Lotti

### P0 — Il metro
Estendere il seme (§3.2) perché ogni utente abbia dati; portare `a11y.spec.ts` a coprire **tutti** i
percorsi — le liste, le pagine di dettaglio, i dialoghi aperti, la tavolozza dei comandi e la
navigazione mobile — ciascuno con la sessione che ha i dati e, dove serve, **da admin**; aggiungere
la quinta regola (§3.3) e l'eccezione dei link inline (§3.4). Si chiude con l'elenco dei difetti,
scritto nel piano: è il lavoro di P1 e P2.

### P1 — Layout mobile
Correggere ogni sporgenza e ogni traboccamento dell'elenco di P0, a partire da
`/settings/integrations` (§2.2). La forma è quella di §3.3: tabella sopra `md`, elenco sotto, stessi
comandi. Nessuna colonna sparisce soltanto: quello che una forma mostra, l'altra lo mostra.

### P2 — Accessibilità
I bersagli sotto i 24 px che restano dopo §3.4; `aria-prohibited-attr` su `/expenses` e ogni altra
violazione axe; attraversamento da tastiera di dialoghi, menu, tavolozza e tabelle ordinabili con il
focus sempre visibile; contrasto nei due temi. Le intestazioni ordinabili (17 px) si risolvono una
volta in `src/ui/table.tsx`, non pagina per pagina.

### P3 — Revisione dell'intero branch per aree
§3.5. Il documento va in `docs/reviews/2026-09-2X-f9-revisione-finale.md`.

### P4 — Prestazioni
Query per pagina (una `EXPLAIN` sulle tre viste più larghe), N+1 nei servizi che iterano sugli
utenti, peso della build, e la misura di §3.6.3. Si corregge solo ciò che una misura mostra.

### P5 — Documentazione
`README` (le tre sezioni mancanti di §3.6.1, più la procedura di rilascio di §13), `CLAUDE.md`
allineato a com'è davvero il repository dopo nove fasi, e un `docs/RELEASE.md` che sia la checklist
di §13 eseguibile da chi non ha scritto il codice.

### P6 — Rilascio (§13)
Nell'ordine della specifica: backup di `dashboard`; recupero dei valori d'ambiente da `docker
inspect dashboard-app`; `docker-compose.yml` di produzione (`dashboard-app`, `dashboard-cron`,
`dash.longobardo.me`, database `finance`, bucket `finance-dashboard`); URI di callback in Authentik;
build, migrazioni, avvio, `/api/health`; primo accesso admin; collegamento di Wallet e Trek;
caricamento di cedolini e documenti Cometa. Rollback documentato: immagine precedente e database
`dashboard`.

### P7 — Pulizia finale (obbligatoria, ultimo passo)
1. i test sulle fixture reali passano un'ultima volta e i gemelli sintetici coprono gli stessi casi;
2. si eliminano `Fondo Cometa/`, `Payroll/`, `UI Recreation and branding decisions/` e le loro righe
   in `.gitignore`;
3. si controlla che non restino file inutilizzati, riferimenti a quelle cartelle o documentazione
   non allineata.

## 5. Cancello

`npm run format && npm run lint && npm run typecheck && npm run format:check && npm test`, poi
`npm run test:integration`, `npm run db:generate` (nessuna differenza), `docker compose build &&
docker compose up -d`, `/api/health`, `npm run e2e` — che dopo P0 comprende la passata di layout e
accessibilità su **ogni** schermata a 1440 e 400 px. Infine il confronto a schermo con il design,
che resta del proprietario.

## 6. Fatto quando

- Nessuna schermata, a 400 px, esce dalla finestra, scorre di lato o lascia un testo fuori dal suo
  contenitore — e il test che lo dice guarda tutte e ventitré, con dei dati dentro.
- Nessuna violazione axe WCAG 2.1 A/AA su nessuna schermata, in tutti e due i temi.
- Ogni bersaglio è almeno 24×24 px, salvo i link dentro una frase (§3.4).
- La revisione per aree è chiusa e i suoi lotti sono applicati.
- `README`, `CLAUDE.md` e `docs/RELEASE.md` raccontano il repository che esiste.
- L'applicazione gira sul database `finance` con il bucket `finance-dashboard`, e `dashboard` resta
  intatto come rollback.
- Le tre cartelle di supporto non esistono più, e niente nel repository le nomina.

## 7. Resta al proprietario

1. **Chiudere i §7 aperti dalle fasi precedenti**, che F9 raccoglie qui: `GOTIFY_URL`/`GOTIFY_TOKEN`
   in `.env.homelab` (F8 §7.1); il backup **in chiaro** nel bucket privato, applicato come proposto
   (F8 §3.6.2) e da confermare; «Back up now» premuto una volta sul sito (F8 §7.3 — il percorso di
   `pg_dump` è già stato verificato a mano il 2026-09-21 contro `ledgerly_test`, dall'immagine vera,
   con un dump `PGDMP` da 190 KB, quindi resta solo la conferma dalla schermata).
2. Decidere su §3.4: l'eccezione dei link dentro una frase, o i 24 px senza eccezioni.
3. Decidere su §3.6.5: l'avatar entra in F9 o resta fuori dalla 0.1.
4. Il confronto visivo con il design (§11), schermata per schermata.
5. Le credenziali e le decisioni di §13 che solo chi ha accesso al homelab può prendere: il momento
   del rilascio, il nome del database e del bucket, la voce in Authentik.

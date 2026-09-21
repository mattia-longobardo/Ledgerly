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

### P0.1 — L'elenco, misurato (2026-09-21)

Il metro è costruito. Che cosa è cambiato rispetto a com'era scritto qui sopra:

1. **Il seme non riempie gli utenti dei percorsi, ne riempie uno nuovo.** §3.2 diceva «ogni utente ha
   la sua pagina piena», ma `accounts`, `interests`, `funds` e `payroll` aprono i loro percorsi
   **sullo stato vuoto** («No accounts yet», «No interest rules», «No investment funds», «No
   payslips yet»): riempirli avrebbe rotto quattro specifiche per far vedere qualcosa a una quinta.
   Il seme crea invece un utente `layout` che ha tutto — conti con saldi e movimenti, budget,
   pockets, abbonamenti, una regola di interessi, un PAC con cinque versamenti e cinque
   valorizzazioni, un fondo pensione con l'export delle operazioni e il riepilogo di posizione,
   cinque cedolini applicati, ferie e un token — costruito **attraverso i servizi**, come §3.2
   chiedeva. Le specifiche dei moduli restano dove sono, vuote all'inizio.
2. **Le schede contano come schermate.** `?tab=` non è un dettaglio della stessa pagina: le tabelle
   più larghe dell'applicazione stanno lì. Il controllo apre le tre schede di `/accounts/[id]` e le
   tre di un fondo pensione.
3. **Una sola asserzione per schermata**, non quattro in fila: una pagina bocciata dal layout non
   sarebbe mai finita davanti ad axe, e la passata avrebbe raccontato metà di quello che ha misurato.
4. **Axe si restringe all'overlay** quando la schermata è un overlay: altrimenti un dialogo paga
   per i difetti della pagina che ha dietro.

Il controllo guarda ora **36 schermate** (23 pagine, le sei schede, due pagine da non autenticati,
gli overlay) a 1440 e a 400 px, **nei due temi**, con cinque regole. Passata del 2026-09-21:
**221 bersagli sotto i 24 px**, **163 nodi oltre il bordo della finestra**, **52 violazioni di
contrasto (tutte e sole nel tema scuro)**, **10 `scrollable-region-focusable`**, **4
`aria-prohibited-attr`**. La quinta regola — il testo che trabocca dal contenitore — non ha trovato
**niente**: il difetto che il proprietario descriveva a parole non esiste più o non è mai stato
questo.

| Schermata | Sessione | 1440 px | 400 px |
|---|---|---|---|
| `/` | layout | axe color-contrast/dark ×1 | axe color-contrast/dark ×1 |
| `/accounts` | layout | bersagli: 1× a 116×19, 1× a 90×19, 1× a 166×19, 1× a 49×19; axe color-contrast/dark ×1 | 36 nodi oltre il bordo; bersagli: 1× a 116×19, 1× a 90×19, 1× a 166×19, 1× a 49×19; axe color-contrast/dark ×1 |
| `/accounts/new` | layout | axe color-contrast/dark ×1 | — |
| `/accounts/[id]` | layout | bersagli: 1× a 46×17; axe color-contrast/dark ×1 | bersagli: 1× a 46×17; axe color-contrast/dark ×1 |
| `/accounts/[id]?tab=transactions` | layout | axe color-contrast/dark ×1 | — |
| `/accounts/[id]?tab=entries` | layout | axe color-contrast/dark ×1 | 15 nodi oltre il bordo |
| `/accounts/[id]?tab=settings` | layout | axe color-contrast/dark ×1 | — |
| `/expenses` | layout | bersagli: 8× input 14×24, 1× button 40×17, 1× button 36×17, 1× button 48×17; axe aria-prohibited-attr/dark ×1; axe color-contrast/dark ×1; axe aria-prohibited-attr/light ×1 | bersagli: 7× input 14×24, 1× button 56×22, 1× button 110×22, 1× button 63×22; axe aria-prohibited-attr/dark ×1; axe color-contrast/dark ×1; axe aria-prohibited-attr/light ×1 |
| `/budgets` | layout | bersagli: 3× button 40×23, 1× button 48×23; axe color-contrast/dark ×1 | bersagli: 3× button 39×21, 1× button 47×21 |
| `/pockets` | layout | axe color-contrast/dark ×1 | axe color-contrast/dark ×1 |
| `/subscriptions` | layout | bersagli: 3× button 36×17, 2× a 94×17, 2× button 34×17, 1× button 33×17; axe color-contrast/dark ×1 | bersagli: 2× a 94×17, 1× button 148×19, 1× button 41×19, 1× button 90×19; axe color-contrast/dark ×1 |
| `/interests` | layout | axe color-contrast/dark ×1 | axe color-contrast/dark ×1 |
| `/interests/[id]` | layout | axe color-contrast/dark ×1; axe scrollable-region-focusable/dark ×1; axe scrollable-region-focusable/light ×1 | 9 nodi oltre il bordo; axe scrollable-region-focusable/dark ×1; axe scrollable-region-focusable/light ×1 |
| `/funds` | layout | bersagli: 1× a 94×17; axe color-contrast/dark ×1 | bersagli: 1× a 94×17; axe color-contrast/dark ×1 |
| `/funds/[id] (PAC)` | layout | bersagli: 1× a 64×17; axe color-contrast/dark ×1 | bersagli: 1× a 64×17; axe color-contrast/dark ×1 |
| `/funds/[id]/returns` | layout | axe color-contrast/dark ×1 | axe color-contrast/dark ×1 |
| `/funds/[id] (pension)` | layout | axe color-contrast/dark ×1 | 27 nodi oltre il bordo; axe color-contrast/dark ×1; axe scrollable-region-focusable/dark ×1; axe scrollable-region-focusable/light ×1 |
| `/funds/[id] (pension)?tab=contributions` | layout | axe color-contrast/dark ×1 | 2 nodi oltre il bordo |
| `/funds/[id] (pension)?tab=valuations` | layout | bersagli: 1× a 144×16, 1× a 141×16; axe color-contrast/dark ×1 | 14 nodi oltre il bordo; bersagli: 1× a 144×16, 1× a 141×16; axe scrollable-region-focusable/dark ×1; axe scrollable-region-focusable/light ×1 |
| `/funds/[id] (pension)?tab=settings` | layout | axe color-contrast/dark ×1 | — |
| `/funds/[id]/documents/[docId]` | layout | bersagli: 5× button 376×19, 5× button 392×19, 1× button 352×19, 1× button 384×19; axe color-contrast/dark ×1 | bersagli: 5× button 271×19, 5× button 287×19, 1× button 247×19, 1× button 279×19 |
| `/payroll` | layout | bersagli: 1× a 126×15, 1× a 93×15, 1× a 98×15, 1× a 108×15; axe color-contrast/dark ×1 | axe color-contrast/dark ×1 |
| `/payroll/[id]` | layout | bersagli: 25× button 418×19, 12× button 376×19, 5× button 392×19, 5× button 385×19; axe color-contrast/dark ×1 | 20 nodi oltre il bordo; bersagli: 25× button 313×19, 12× button 271×19, 5× button 287×19, 5× button 280×19; axe scrollable-region-focusable/dark ×1; axe scrollable-region-focusable/light ×1 |
| `/timeoff` | layout | axe color-contrast/dark ×1 | axe color-contrast/dark ×1 |
| `/settings/profile` | layout | axe color-contrast/dark ×1 | — |
| `/settings/security` | layout | axe color-contrast/dark ×1 | 6 nodi oltre il bordo |
| `/settings/categories` | layout | axe color-contrast/dark ×1 | — |
| `/settings/data` | layout | axe color-contrast/dark ×1 | — |
| `/settings/integrations` | layout | axe color-contrast/dark ×1 | — |
| `/settings/users (admin)` | admin | axe color-contrast/dark ×1 | — |
| `/settings/server (admin)` | admin | axe color-contrast/dark ×1 | — |
| `/settings/integrations (admin)` | admin | axe color-contrast/dark ×1 | 34 nodi oltre il bordo |
| `signed out › /sign-in` | signed out | bersagli: 1× a 294×17; axe color-contrast/dark ×1 | bersagli: 1× a 294×17; axe color-contrast/dark ×1 |
| `signed out › /forgot-password` | signed out | bersagli: 1× a 294×17; axe color-contrast/dark ×1 | bersagli: 1× a 294×17; axe color-contrast/dark ×1 |
| `the command palette` | layout | bersagli: 1× input 466×20; axe color-contrast/dark ×1 | bersagli: 1× input 274×20; axe color-contrast/dark ×1 |
| `the mobile More sheet` | layout | — | axe color-contrast/dark ×1 |

Quello che l'elenco dice, in breve:

- **Il tema chiaro non ha una sola violazione di contrasto; il tema scuro ne ha una su quasi ogni
  schermata**, sempre la stessa: `--faint: #6c727b` su `--card: #16181b` sta a **3,64:1**, sotto il
  4,5:1 che AA chiede al testo piccolo. In F7 il `--faint` chiaro era stato scurito a 4,75:1 e
  quello scuro non è mai stato guardato. È una riga di CSS, e risolve 52 rilievi su 52. → P2
- **Le tabelle larghe escono dalla finestra a 400 px**: `/settings/integrations` da admin (34 nodi),
  `/accounts` (36), un fondo pensione (27 sulla panoramica, 14 sulle valorizzazioni, 2 sui
  contributi), `/payroll/[id]` (20), `/accounts/[id]?tab=entries` (15), `/interests/[id]` (9),
  `/settings/security` (6). Sette schermate, la stessa forma. → P1
- **I bersagli sotto i 24 px si concentrano in pochi componenti**, non in pochi punti: le
  intestazioni ordinabili e i link di riga (17–19 px), i chip di categoria e i bottoni degli importi
  rapidi (21–23 px), le caselle di `/expenses` (14×24), i bottoni di campo della revisione di un
  cedolino (19 px, 47 per schermata). Si risolvono nei componenti condivisi. → P2
- **`aria-prohibited-attr`** è la barra di avanzamento di `/expenses`: `aria-label="89%"` su uno
  `<span>` senza ruolo. → P2
- **`scrollable-region-focusable`** è un contenitore che scorre senza essere raggiungibile da
  tastiera; compare dove c'è una tabella dentro `overflow-x-auto` o un elenco dentro
  `max-h-[420px] overflow-y-auto`. Sparisce da solo dove P1 sostituisce la tabella con un elenco, e
  dove resta vuole un `tabindex=0` con un nome. → P1 e P2

### P1 — Layout mobile
Correggere ogni sporgenza e ogni traboccamento dell'elenco di P0, a partire da
`/settings/integrations` (§2.2). La forma è quella di §3.3: tabella sopra `md`, elenco sotto, stessi
comandi. Nessuna colonna sparisce soltanto: quello che una forma mostra, l'altra lo mostra.

### P2 — Accessibilità
I bersagli sotto i 24 px che restano dopo §3.4; `aria-prohibited-attr` su `/expenses` e ogni altra
violazione axe; attraversamento da tastiera di dialoghi, menu, tavolozza e tabelle ordinabili con il
focus sempre visibile; contrasto nei due temi. Le intestazioni ordinabili (17 px) si risolvono una
volta in `src/ui/table.tsx`, non pagina per pagina.

### P1.1 e P2.1 — Che cosa è stato corretto (2026-09-21)

Passata finale sul sito pubblicato: **72 misure di layout e accessibilità verdi su 72**, più cinque
di tastiera; la suite end-to-end intera passa a **128 test** (erano 66).

| | prima | dopo |
|---|---|---|
| bersagli sotto i 24 px | 221 | **0** |
| nodi oltre il bordo a 400 px | 163 | **0** |
| violazioni di contrasto (tema scuro) | 52 | **0** |
| `scrollable-region-focusable` | 10 | **0** |
| `aria-prohibited-attr` | 4 | **0** |
| testo fuori dal contenitore | 0 | 0 |

**P1 — nove pannelli, due cause.** Sette tabelle hanno preso la forma di §3.3, tabella da `md` in su
ed elenco sotto con gli stessi comandi: i job di `/settings/integrations`, i conti di `/accounts`, i
token di `/settings/security`, i conguagli di `/interests/[id]`, le operazioni e i riepiloghi di un
fondo pensione, le voci di un cedolino, i saldi di `/accounts/[id]`, i documenti Cometa. Gli altri
due erano la **stessa causa, non una tabella**: sotto il punto di rottura una griglia `@4xl:` è una
sola traccia `auto`, e il minimo automatico di una traccia `auto` è il `min-content` della cella più
larga — cioè, quando dentro c'è una tabella, la tabella intera. La griglia dei saldi spingeva il
modulo accanto 77 px fuori dallo schermo, quella della deducibilità 9. `min-w-0` sulle celle, e
basta: una riga per griglia, non un ripensamento del layout.

**P2 — quasi tutto in pochi componenti.**

1. **Contrasto:** `--faint` nel tema scuro era `#6c727b`, 3,64:1 su `--card`. F7 aveva schiarito solo
   il gemello chiaro. Portato a `#868d96` — 5,31:1 su `--card`, 4,93:1 su `--hover`, il fondo più
   stretto su cui quel testo si appoggia davvero, e ancora chiaramente più tenue di `--muted` a 7:1.
   **Una riga di CSS, 52 rilievi su 52.** Il tema chiaro non ne aveva nemmeno uno.
2. Il numero di un giorno di **ferie pianificate** usava `text-primary`: `--primary` è il riempimento
   di un bottone e nel tema scuro resta lo stesso teal scuro. Passato a `text-accent`, che nel tema
   chiaro è **lo stesso colore**, quindi lì non si muove niente.
3. **I 24 px** erano quasi sempre l'*altezza*, mai la larghezza: le parole sono alte 17 px e il
   bersaglio era alto quanto le parole. Risolti nei componenti condivisi — l'intestazione ordinabile
   in `src/ui/table.tsx`, il chip di categoria, la casella di selezione di una riga (14 px di scatola
   con l'etichetta larga uguale: ora l'etichetta ha un pavimento di 24 px in **tutte e due** le
   direzioni), il bottone di campo della revisione di un cedolino e quello di un documento Cometa,
   il limite rapido di `/budgets`, l'utilità di `/subscriptions`, il campo della tavolozza — e con
   `inline-flex min-h-6 items-center` su tredici link di riga.
4. **`aria-prohibited-attr`:** la barra di `/expenses` portava `aria-label` su uno `<span>` nudo, che
   è vietato. Ora è `role="img"`: quella barra è un'immagine e la sua descrizione è la quota.
5. **`scrollable-region-focusable`:** il riquadro degli accrediti giornalieri scorre e non si poteva
   raggiungere da tastiera. `tabIndex={0}`, `role="region"` e un nome. Gli altri sono spariti da soli
   dove P1 ha tolto la tabella.
6. **Tastiera:** `tests/e2e/keyboard.spec.ts`, nuovo. Tavolozza (apre, filtra, si muove, va, chiude),
   dialogo (prende il focus, lo tiene, lo restituisce a chi l'ha aperto), menu di riga, tabella
   ordinabile, e la traversata dall'alto con il **focus sempre disegnato**. Il primo giro ha
   segnalato la trappola del focus come rotta: non lo era — Base UI avvolge il popup in sentinelle
   `data-base-ui-focus-guard`, e il focus ci passa sopra per rientrare. Il test lo dice adesso.

Due cose che il metro ha segnalato e che **non erano difetti dell'applicazione**:

- il contrasto della tendina mobile, misurato a metà dell'animazione di apertura: axe leggeva i
  colori di quello che stava dietro. Il controllo ora aspetta che il popup sia fermo;
- `admin.spec.ts` ha fallito **una volta su due** passate intere, e mai da solo: la Server Action che
  cambia il ruolo e il `page.reload()` che la verifica corrono. È una fragilità del test, non del
  prodotto, ed è un rilievo per P3.

### P3 — Revisione dell'intero branch per aree
§3.5. Il documento va in `docs/reviews/2026-09-2X-f9-revisione-finale.md`.

### P3.1 — Esito (2026-09-21)

Il documento è `docs/reviews/2026-09-21-f9-revisione-finale.md`. Tre rilievi correggibili, tutti e
tre corretti in un lotto solo; tre note e una conferma.

- **E1 [verificato, riprodotto sul sito]** — `/accounts/[id]?tab=settings`: il bottone si chiamava
  «Archive account» e chiamava `removeAccountAction`, che **cancella** il conto quando niente vi si
  appoggia; e `transactions.account_id` è `on delete cascade`. Un clic, **nessuna conferma**, e un
  conto con tutti i suoi movimenti spariva per sempre. Riprodotto: dialoghi di conferma 0, la
  pagina del conto 404, il conto fuori dall'elenco. Era l'**unica** azione distruttiva
  dell'applicazione senza conferma — «Remove person» ce l'ha. Ora il dialogo dice quali sono le due
  cose che possono succedere, l'etichetta è «Rimuovi il conto», e l'avviso a cose fatte dice quale
  delle due è successa, in rosso quando è stata la cancellazione. `accounts.spec.ts` lo controlla.
- **A1 [verificato]** — la card dei documenti di un fondo pensione rendeva la data di arrivo in UTC
  mentre ogni altra schermata usa `civilDateIn(…, ctx.timeZone)`: a Roma, un documento caricato dopo
  mezzanotte portava due date diverse a due clic di distanza. Unica violazione della regola delle
  date in tutto il branch.
- **C1 [verificato]** — `admin.spec.ts` ricaricava la pagina senza aspettare la Server Action:
  falliva una passata intera su due e mai da solo. Ora aspetta la risposta.

E quello che **non** c'era, che è il risultato più utile: su 99 statement e 55 tabelle nessuna query
su dati di un utente senza il suo filtro; nessuna Server Action senza sessione salvo quella che non
può averne una; nessuna chiamata di rete dentro una transazione; nessun importo trattato come
`float`; nessun segreto nei log, negli argomenti di un processo o in un messaggio d'errore; nessun
job fuori dal registro; 2 465 chiavi di messaggio in parità perfetta fra le due lingue.

### P4 — Prestazioni
Query per pagina (una `EXPLAIN` sulle tre viste più larghe), N+1 nei servizi che iterano sugli
utenti, peso della build, e la misura di §3.6.3. Si corregge solo ciò che una misura mostra.

### P4.1 — Le misure (2026-09-21)

Tre misure, due strumenti nuovi, **nessuna correzione**: è l'esito che §4 P4 prevede quando una
misura non mostra niente, e i numeri sono qui perché chi riapre il piano fra sei mesi possa
rifarli invece di crederci.

**1. Le pagine, sul sito pubblicato**, con l'utente `layout` che ha dati su ogni schermata
(`performance.getEntriesByType("navigation")`, mediana di tre caricamenti):

| Pagina | mediana | TTFB | peso trasferito |
|---|---|---|---|
| Overview | 235 ms | 8 ms | 45 KiB |
| Accounts | 171 ms | 8 ms | 46 KiB |
| Expenses | 185 ms | 6 ms | 49 KiB |
| Budgets | 142 ms | 8 ms | 42 KiB |
| Subscriptions | 144 ms | 9 ms | 44 KiB |
| Time off | 255 ms | 6 ms | 49 KiB |

**2. Le viste più larghe, su dati pesanti** — `npm run perf` (`scripts/perf-probe.ts`), che costruisce
in `ledgerly_test` un utente con dodici conti, **sessantamila movimenti** su tre anni e
quattordicimila righe di saldo, misura cinque volte e prende la mediana:

| Vista | mediana |
|---|---|
| `expensesView`, mese corrente | **47 ms** |
| `expensesView`, tre anni interi | **66 ms** |
| `accountsView`, dodici mesi | **28 ms** |

**3. I piani, su quegli stessi dati.** La lista dei movimenti di un mese — lo statement più largo
dell'applicazione — legge **1 650 righe in 7 ms** con un bitmap index scan e un top-N heapsort di
200: nessun sequential scan, nessun ordinamento su disco. L'ultimo saldo noto di ogni conto è
l'unico piano che *non* usa un indice: con 14 400 righe in 237 pagine il pianificatore preferisce
leggere tutto e ordinare piuttosto che fare dodici sonde sull'indice, che è la scelta giusta a
quella taglia e che cambierà da sola quando la tabella crescerà. Il tempo che `EXPLAIN ANALYZE`
riporta per quel piano (87 ms) è gonfiato dalla strumentazione riga per riga: la stessa query dentro
`accountsView` contribuisce a un totale di 28 ms.

**4. Il peso della build.** Immagine 389 MB; `.next` 24,2 MB di cui **3,2 MB di statici** in 57
chunk; fra i 42 e i 49 KiB trasferiti per pagina, JavaScript compreso.

**Gli N+1 che ci sono, e perché restano.** Nove cicli del branch fanno una query per elemento:
sui conti di una persona, sulle sue regole di interesse, sui suoi fondi. Sono limitati da quante
cose possiede una famiglia — cifre a una cifra — e le misure qui sopra li contengono già tutti.
Riscriverli in query aggregate costerebbe leggibilità per guadagnare millisecondi che nessuno
aspetta. Se un giorno una di queste pagine rallenta, `npm run perf` lo dirà prima di chiunque altro.

### P5 — Documentazione
`README` (le tre sezioni mancanti di §3.6.1, più la procedura di rilascio di §13), `CLAUDE.md`
allineato a com'è davvero il repository dopo nove fasi, e un `docs/RELEASE.md` che sia la checklist
di §13 eseguibile da chi non ha scritto il codice.

### P5.1 — Fatto (2026-09-21)

- **`README`**: le tre sezioni che mancavano — **F5** (la pipeline di importazione, il parser a
  coordinate, l'LLM come ripiego mai come lettore, i controlli, la sostituzione di un cedolino
  ristampato), **F6** (le sei grandezze mai sommate, i due documenti Cometa, la riconciliazione per
  trimestre con la sua scadenza, le tariffe con la data in cui sono state verificate) e **F7**
  (ferie e ROL contati a parte, il residuo che viene dal cedolino e non da un conto nostro, Trek
  che non cancella mai un giorno per sbaglio). Più una sezione **«On a phone»** e **sedici
  screenshot**, tutti dell'utente `layout`: nessuna immagine nel repository mostra i soldi di una
  persona vera, e `npm run docs:shots` le rifà.
- **`CLAUDE.md`**: una sezione nuova, «What a screen has to be», che scrive le regole che F9 ha
  trovato invece di lasciarle nel piano — le cinque del controllo, la forma tabella/elenco, il
  `min-w-0` sulle celle di griglia che possono contenere una tabella, i 24 px che sono quasi sempre
  un'altezza, i token di colore che si cambiano **in coppia** (è così che il tema scuro è rimasto
  rotto dopo F7), e che un'azione distruttiva chiede prima e dice dopo quale delle cose che poteva
  fare ha fatto.
- **`docs/RELEASE.md`**: la checklist di §13 eseguibile, che dichiara in apertura che cosa di §13
  non ha più oggetto e perché (§P6.1 qui sotto).
- **`LICENSE`**: PolyForm Noncommercial 1.0.0, presa dal testo ufficiale e non riscritta a memoria.
  Uso personale, studio, progetti amatoriali, più enti di beneficenza, istruzione, ricerca
  pubblica, sicurezza, ambiente e pubblica amministrazione. L'uso commerciale non è concesso qui.
- **`.env.example`**: `S3_KEY_PREFIX`, che l'applicazione legge e il file non nominava (rilievo F1
  della revisione).

### P6 — Rilascio (§13)
Nell'ordine della specifica: backup di `dashboard`; recupero dei valori d'ambiente da `docker
inspect dashboard-app`; `docker-compose.yml` di produzione (`dashboard-app`, `dashboard-cron`,
`dash.longobardo.me`, database `finance`, bucket `finance-dashboard`); URI di callback in Authentik;
build, migrazioni, avvio, `/api/health`; primo accesso admin; collegamento di Wallet e Trek;
caricamento di cedolini e documenti Cometa. Rollback documentato: immagine precedente e database
`dashboard`.

### P6.1 — Il rilascio, fatto (2026-09-21)

**La decisione.** §13 e D15 dicono di rilasciare su un database **nuovo** `finance` con un bucket
`finance-dashboard`, lasciando intatto `dashboard` per il rollback. Verificato sul homelab: non
esiste nessun container `dashboard-app` e nessun database `dashboard` — Ledgerly **è già** su
`dash.longobardo.me`, sul database `ledgerly` e sul bucket `ledgerly`, con Authentik già puntato
lì. Quei nomi erano stati scelti per non collidere con un'applicazione che non c'è più, quindi
rinominarli adesso sarebbe una migrazione di dati vivi senza guadagno. **Il proprietario ha deciso
il 2026-09-21: database e bucket restano `ledgerly`.** I passi 2, 3 e 4 di §13 non hanno più
oggetto, e `docs/RELEASE.md` lo dichiara in apertura invece di lasciarlo scoprire a chi legge.

**Che cosa è stato fatto, nell'ordine.**

1. **I dati di prova cancellati, quelli dell'utente intatti** (richiesta del proprietario). Nessun
   utente `@example.test` era rimasto nel database. Nel bucket invece sì: accanto alle due cartelle
   dell'unico utente vero — **12 cedolini (2,66 MiB) e 1 documento Cometa** — c'erano **49 cartelle
   orfane** sotto `cometa/`, di utenti di prova cancellati durante F6 e F7 quando il seme non
   ripuliva ancora S3, più **3 oggetti sotto `tests/`** lasciati dai test di integrazione. Cancellate
   controllando l'esistenza del proprietario di *ogni* cartella prima di toccarla: **96 oggetti
   rimossi, 13 tenuti**. Contato dopo: `tests/` 0, `payslips/` 12, `cometa/` 1, `exports/` 0,
   `avatars/` 0.
2. **Il backup che è il piano di rollback** (§13 passo 1): il giro giornaliero lanciato a mano dal
   container cron — così `CRON_SECRET` non esce da lì — ha chiuso tutti e cinque i job con
   `success`, `database-backup` compreso. Il dump è `backups/2026-09-21t14-36-21-009z.dump`,
   377 KiB, formato `pg_dump -Fc`. Questo chiude anche il §7.3 di F8: il percorso di backup non è
   più «verificato contro `ledgerly_test`», è **eseguito in produzione**.
3. **Build e avvio** (§13 passo 5): `docker compose build && up -d` per `ledgerly` e
   `ledgerly-cron`, migrazioni applicate dall'entrypoint, `/api/health` → `{"status":"ok","db":"up"}`.
   `npm run db:generate` → *«No schema changes, nothing to migrate»*: codice e migrazioni non sono
   divergenti. Immagine precedente per il rollback annotata prima della build.
4. **La verifica da fuori**: **129 test end-to-end verdi** sul sito pubblicato, che comprendono le
   72 misure di layout e accessibilità su ogni schermata nei due temi e le 5 di tastiera.

**Che cosa resta al proprietario** — non perché sia difficile, ma perché richiede credenziali e
documenti che solo lui ha: collegare Wallet e Trek se i token sono cambiati, e caricare i cedolini
e i documenti Cometa che mancano. I 12 cedolini e il documento Cometa già caricati sono suoi e non
sono stati toccati. `docs/RELEASE.md` §6 e §7 spiegano i due passi.

**Una cosa notata e non corretta** (fuori perimetro: sarebbe una funzione nuova). Le 49 cartelle
orfane non si sono create da sole: fino a F6 la cancellazione di un utente non portava via le sue
cartelle in S3. Oggi lo fa — `removePerson` e il seme cancellano `payslips/`, `cometa/` ed
`exports/` — quindi non se ne accumulano di nuove. Ma **nessun job spazza gli orfani**, e se un
giorno una cancellazione fallisse a metà nessuno se ne accorgerebbe. Una passata dentro
`housekeeping` sarebbe il posto giusto, in una fase che possa aggiungere funzioni.

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

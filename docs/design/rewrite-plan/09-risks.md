# 9. Rischi, ipotesi aperte, ipotesi confermate

Indice del piano: [`../rewrite-plan.md`](../rewrite-plan.md).

Elenchi:

- §9.1 **Ipotesi aperte**: fatti non ancora misurati. Ognuna ha il passo che la chiude e cosa succede se è falsa.
- §9.2 **Rischi** del piano, con la mitigazione.
- §9.3 **Ipotesi confermate il 14/11/2026**: scelte che mancavano nelle decisioni. Mattia le ha confermate con l'OK al piano: vale il default.
- §9.5 **Punti decisi il 14/11/2026**: erano ipotesi da confermare, ora sono decisioni di Mattia.
- §9.6 **Ipotesi · revisione sulla standardizzazione**: ST-1…ST-24 hanno la risposta di Mattia del 14/11/2026
  (decisioni, con il default, salvo ST-4, ST-6, ST-7 che sono le decisioni H18-H20); ST-26 e ST-27 sono decisioni,
  con il default; ST-25 è una decisione, con l'alternativa «cancellazione in N6» (H24).

## 9.1 Ipotesi aperte

| # | Ipotesi | Stato | Passo che la chiude | Se è falsa |
|---|---|---|---|---|
| A1 | **Banca vera.** Il flusso provato in sandbox vale sulle banche di Mattia: consenso di 180 giorni, `entry_reference` presente e stabile, storico lungo subito dopo il consenso | Provato solo in sandbox (banca di prova) | N1, passo 1 | L'hash di riserva diventa l'identità principale; la durata del consenso si legge per banca. Nessun cambio di architettura |
| A2 | I conti «Subscriptions», «Savings», «Holidays» sono esposti dalla banca | Non noto | N1, passo 1 | Restano conti manuali o conti Wallet |
| A3 | `identification_hash` è stabile tra due consensi | Non provato | N2 (primo rinnovo reale) | Al rinnovo l'utente abbina i conti a mano, con la stessa schermata «È lo stesso conto di…» |
| A4 | **MCC reali.** La banca compila `merchant_category_code` e `bank_transaction_code` | Nulli su 155 movimenti su 155 in sandbox | N1, passo 1; misura in N3 | I livelli 0 e 3 della cascata lavorano solo su testo e marchi. La precisione non cambia; la copertura iniziale è più bassa |
| A5 | Il testo della banca è abbastanza simile a quello di Wallet per riusare le etichette | Non misurabile senza dati reali | N3 (seconda prova), N4 (prova a secco: stessi movimenti nelle due sorgenti) | Il classificatore parte solo dalle conferme nuove; la revisione guidata copre l'avvio |
| A6 | La precisione del 95% regge sui dati reali della banca | Misurata 97,0% sui testi di Wallet, con memoria severa e categorie doppie unite | N3, criterio di accettazione | La soglia sale da sola: più movimenti in «Da categorizzare», nessun errore in più |
| A7 | L'abbinamento per gruppi regge su dati reali; il saldo della banca è confrontabile con quello locale | Provato solo su dati costruiti da Wallet | N4, prova a secco sul primo conto | Il controllo del saldo blocca. Il conto resta su Wallet |
| A8 | **EODHD.** Il piano gratuito copre gli strumenti di Mattia per ISIN, con il mercato dell'ordine o Xetra, entro 20 chiamate al giorno | Non eseguibile senza una chiave | R5d, passo 1 (chiave gratuita registrata da Mattia) | Strumenti senza fonte: «prezzo manuale». Xetra come riserva (scostamento misurato ≤ 0,29% per strumento). Piano a pagamento solo con una decisione di Mattia |
| A9 | La licenza personale di EODHD ammette più utenti sulla stessa istanza | Zona grigia | R5d | La chiave è per utente, come per Enable Banking, oppure i prezzi valgono solo per i dati del proprietario |
| A10 | BTP e fondi non quotati | Non provati | R5d | «Prezzo manuale» con promemoria |
| A11 | **Lavori in background su Android.** Il sistema lascia girare un controllo ogni poche ore su telefoni di marche diverse | Non provato | C0, prova B | Avvisi solo all'apertura dell'app, più email. Il widget mostra l'ultimo dato con la data |
| A12 | Un pacchetto statico delle schermate gira in Capacitor; il login con schema privato torna all'app | Non provato | C0, prova A | R3 non parte. Il vincolo «solo client» si rivede con Mattia prima di scrivere una sola schermata |
| A13 | **Pacchetto Windows.** Tauri 2 costruisce l'app su un PC Windows con il pacchetto web condiviso; il login su `127.0.0.1` funziona | Non provato | C0, prova C | Electron con lo stesso pacchetto web |
| A14 | Il documento OpenAPI si genera dagli schemi zod delle rotte Hono | Non provato | R2, primo modulo | Documento scritto dal descrittore del contratto con un generatore proprio; il test «solo additivo» resta |
| A15 | L'uscita dei plugin si può limitare agli host del manifest con un proxy semplice | Non provato | R5c | Uscita libera e dichiarata nel manifest; punto per la review finale |
| A16 | Addestramento del classificatore entro memoria e CPU del container (1 GB, 1 CPU) | Misurato: 1,4 s per 850 righe | N3 | Dopo R1 gira nel worker, fuori dal processo che risponde |

## 9.2 Rischi

| # | Rischio | Effetto | Mitigazione | Dove |
|---|---|---|---|---|
| R-1 | Il refactor cambia un numero senza che nessuno lo veda | Viola il vincolo principale | Fotografia dei numeri prima e dopo ogni passo; test di parità; file di riferimento dei calcoli; asserzioni dei test non adattate | [`06-data.md`](06-data.md) §6.4, [`05-refactor.md`](05-refactor.md) §5.6 |
| R-2 | Le voci «stesso numero in due modi» obbligano a scegliere un valore: una superficie cambia | API, MCP, export o mail mostrano un valore diverso da oggi | Decisione presa per ogni voce (§9.5, D1-D11: il numero delle pagine); commit separato; riga in `docs/api-changelog.md` | R2 |
| R-3 | Login nativo, CORS e rete dei plugin vanno in produzione prima della review di sicurezza, su un'istanza pubblica | Superficie nuova non rivista | Regole di oggi invariate (registrazione dinamica chiusa a `/api/v1`, PKCE obbligatorio, redirect fissi); test di sicurezza esistenti nel gate; OK di Mattia sul SHA per i criteri #3 e #4; elenco dei dispositivi con revoca | R2, R4, N1 |
| R-4 | Per un periodo convivono Server Actions e rotte API | Due strade per la stessa scrittura | Le azioni chiamano lo stesso caso d'uso della rotta; parità per modulo; l'azione si cancella nel passo R3 dello stesso modulo | R2, R3 |
| R-5 | Due agenti sullo stesso repo | Conflitti, deploy incrociati | Confini dei pacchetti; contratto prima; il client lavora un modulo dietro; un solo agente fa i deploy; secondo database di test | [`08-agents.md`](08-agents.md) |
| R-6 | Un solo ambiente: gli e2e girano sul sito in produzione | Un errore si vede in produzione | Anteprima sul database di test prima del deploy; immagine `pre-*`; rollback senza dump grazie alle migrazioni additive | [`03-releases.md`](03-releases.md) §3.1 |
| R-7 | Il lato core del runtime dei plugin nasce su codice che cambierà | Lavoro doppio | Il codice del runtime non importa Next.js; diventa `packages/plugin-host` in R0 senza riscrittura | N1, R0 |
| R-8 | La finestra dello storico oltre 90 giorni si chiude in pochi minuti | La prima sync perde lo storico | La prima sync parte nella richiesta di ritorno dal consenso; se fallisce, l'utente vede «Rinnova accesso» per rifare il consenso | N1 |
| R-9 | Limite della banca: 4 letture automatiche al giorno | 429 e attesa di 6 ore | 3 letture automatiche; «Sincronizza ora» con header `Psu-*`; stato `rate_limited` | N1, N2 |
| R-10 | La chiave privata Enable Banking dell'utente attraversa la rete interna a ogni chiamata | Un plugin compromesso la vede mentre gestisce la chiamata | Rete dedicata, segreto condiviso core-plugin, plugin senza stato; l'applicazione è solo AIS. La firma del JWT nel core resta un'opzione per la review finale | N1 |
| R-11 | L'app Android è più nuova o più vecchia dell'istanza | Funzioni mancanti o errori | `GET /api/v1/meta`, capacità, API solo additiva, test di contratto contro il livello minimo | R2, C1 |
| R-12 | Dati finanziari in cache su un telefono | Lettura da parte di terzi | Cache cifrata con chiave nel deposito del sistema; sblocco con biometria; revoca del dispositivo dal web; logout cancella tutto | C1, C2 |
| R-13 | R5f rimuove colonne e tabelle | Rilascio senza rollback della sola immagine (come il passo A4 di N6, R-29) | Dump obbligatorio con ripristino di prova; query «zero usi»; ogni rimozione dopo un rilascio stabile; OK di Mattia | R5f |
| R-14 | Strumenti nuovi sul server (Android SDK, toolchain Rust) | Superficie e spazio su disco | Gate del Security Gatekeeper prima di ogni installazione; strumenti nella cartella del progetto, non in `/home/mattia` | C0 |
| R-15 | Il piano è lungo: le decisioni di prodotto invecchiano | R5 realizza un design non più voluto | Ogni rilascio R5 parte con una conferma breve di Mattia sul suo contenuto | R5 |
| R-16 | Solo 4 movimenti hanno una categoria corretta a mano: le etichette sono quelle di Wallet | Rumore nell'addestramento | L'app propone l'unione delle categorie doppie; la soglia si alza con le correzioni | N3 |
| R-17 | Nessuna review del codice prima della fine (H6) | Un difetto di struttura si vede tardi; la review finale trova molto | Le regole di modularità e di pulizia sono controlli automatici nel gate; liste note che possono solo accorciarsi; verifica dell'orchestratore sugli esiti; prova di comportamento invariato a ogni commit | [`10-modularity.md`](10-modularity.md) §10.6, §10.8, §10.10; [`08-agents.md`](08-agents.md) §8.5 |
| R-18 | Una regola automatica si aggira: si rispetta la lettera e non lo scopo (esempio: un file diviso in due senza una responsabilità chiara) | Modularità solo apparente | Responsabilità e interfaccia di ogni modulo scritte prima (§10.3); file di riferimento degli export (M7); misura dei duplicati; review finale del codice contro le tre priorità | [`10-modularity.md`](10-modularity.md) |
| R-19 | Le soglie di dimensione e complessità sono troppo strette o troppo larghe | Divisioni forzate, oppure regola inutile | Soglie confermate (decisione I15); prima misura in R0; una modifica alle soglie è una decisione di Mattia | R0 |
| R-20 | Le misure di tempo sono instabili sul server condiviso | Falsi allarmi nel gate G9 | Mediana su 5 esecuzioni, margine del 10%, e il numero di query come misura senza rumore | [`10-modularity.md`](10-modularity.md) §10.9 |
| R-21 | Porte ed eventi al posto degli import diretti aggiungono un passaggio | Codice più lungo da seguire; una scrittura in due moduli non è più in una sola transazione | Una porta solo dove oggi c'è un ciclo o una direzione sbagliata (§10.5); gli eventi di dominio girano nella stessa transazione di chi li emette, salvo i job | R2 |
| R-22 | Le regole nuove rallentano i rilasci N1-N5, che lavorano sul codice attuale | Lavoro in più prima della riscrittura | Prima di R0 vale solo «non peggiora»: nessuna violazione nuova rispetto alle liste note | N0-N5 |
| R-23 | N6 migra dati finanziari dei 2 fondi in produzione | Un numero dei fondi cambia senza volerlo | Migrazione additiva: le tabelle vecchie restano intatte; parità della copia dentro la migrazione; prove SN1-SN6; fotografia prima e dopo; file SQL di rollback e dump `n6.dump` | N6; [`11-standardization.md`](11-standardization.md) §11.2.4 |
| R-24 | N6 allunga la fase A: R0 parte dopo | La riscrittura inizia più tardi | N6 non dipende da N1-N4: si fa mentre N1 aspetta la banca vera. Il lavoro tolto a R0, R2 e R3 (un motore in meno) compensa. Alternativa scritta: ST-18 | N6 |
| R-25 | La revisione aggiunge molto lavoro (N6, R5g, 28 voci, 8 meccanismi) | Il piano si allunga; R5a cresce | Ogni voce ha un rilascio; i meccanismi entrano nel passo del modulo che già si rifà; R5g è un rilascio a parte, non dentro il refactor; conferma breve di Mattia prima di ogni rilascio R5 (R-15) | Tutti |
| R-26 | Un vocabolario aperto perde il check DB con l'elenco dei valori (M13) | Un valore sbagliato entra nel database | Check di formato nel database; il registro valida il valore in scrittura; test: un valore non registrato è rifiutato dal servizio | N6, R2 |
| R-27 | Un punto di estensione nasce più generale del bisogno | Complessità superflua (contro la priorità 2) | Un meccanismo entra solo con almeno un uso reale nello stesso rilascio; i profili e i pacchetti paese sono file di dati, non codice; le capacità non note sono ignorate | [`10-modularity.md`](10-modularity.md) §10.11 |
| R-28 | Le righe di riferimento delle due analisi sono di `9be59db` e nessun test è stato eseguito | Una voce descrive codice già cambiato dalla fase A in corso | Ogni rilascio verifica le sue voci sul codice del momento; ST-23 e OT-9 chiedono un test prima della correzione | Tutti |
| R-29 | Il passo A4 di N6 cancella i file e le righe dei documenti di Cometa (decisione ST-25) | Irreversibile senza la copia: l'immagine `pre-n6` non riporta i file | Dump e copia dei file in `projects/Ledgerly-dumps/` con impronte; prova di ripristino prima della cancellazione; passo separato dopo SN7; OK di Mattia sul SHA; la copia resta finché Mattia non dice di toglierla | N6; [`11-standardization.md`](11-standardization.md) §11.2.4 |

## 9.3 Ipotesi confermate il 14/11/2026

Le decisioni del 13/11/2026 non coprivano questi punti. Mattia ha approvato il piano il 14/11/2026: il default di ogni
riga è una decisione confermata ([`01-decisions.md`](01-decisions.md) §1.0, H7). Mattia ha confermato in modo esplicito
I15, I16, I17 e I18 (H8-H11). La colonna «Alternativa» elenca le scelte scartate.

**Scelte del piano**

| # | Punto | Decisione (default del piano) | Alternativa scartata |
|---|---|---|---|
| I1 | Percorso dei dump | `/home/mattia/docker/projects/Ledgerly-dumps/`, ultimi 5 rilasci ([`06-data.md`](06-data.md) §6.3) | Un altro nome sotto `projects/` |
| I2 | Rotta di ritorno dalla banca | `/api/v1/plugins/<id>/callback`, come già registrato nell'applicazione di prova. È l'unica rotta sotto `/api/v1` che usa la sessione del browser e non un token: resta fuori dal contratto OpenAPI | `/api/plugins/<id>/callback`, fuori da `/api/v1`. Chiede una registrazione diversa nell'applicazione Production |
| I3 | Coda dei job | Tabella propria `job_queue` con `FOR UPDATE SKIP LOCKED`: nessun pacchetto nuovo | Libreria `pg-boss`, dopo il gate del Security Gatekeeper |
| I4 | Forma di `apps/web` dopo R3 | Un sito statico solo client, lo stesso pacchetto degli involucri. La tecnologia del contenitore (Next.js con export statico, oppure un bundler con router client) si decide con la prova A di C0 | Next.js con rendering sul server solo per il contenitore |
| I5 | Dove si costruisce l'app Windows | Su un PC Windows di Mattia, con uno script del repo | Un runner Windows di GitHub Actions che produce un file da scaricare. Nessuna pubblicazione in nessun caso |
| I6 | N5 (Time Off) prima di N1 | Sì, se l'applicazione Production o l'accesso alla banca ritardano: N5 non dipende da N1-N4 | Ordine fisso N1 → N5 |
| I8 | Uscita dei plugin verso internet | In N1 libera e dichiarata nel manifest; in R5c limitata agli host dichiarati, se la prova A15 riesce | Limitazione già in N1 |
| I9 | Categorie predefinite per Mattia | Corrispondenza proposta tra le sue 55 categorie usate e i 12 gruppi predefiniti, da confermare una volta nell'interfaccia | Nessuna corrispondenza: le tabelle statiche valgono solo per gli utenti nuovi |
| I10 | Origini CORS degli involucri | I due valori letti nella prova D di C0, scritti come costanti | — |
| I11 | Contenuto di R5f | L'elenco di [`06-data.md`](06-data.md) §6.1. Ogni voce parte solo con «zero righe, zero usi» | Tenere tutto: nessuna rimozione |
| I12 | Catalogo ufficiale dei plugin | `plugins/catalog.json` nel repo privato. Basta per l'istanza di Mattia | Un indice pubblico: si decide quando un altro host installa Ledgerly |
| I14 | Misure di partenza in N0 | N0 aggiunge solo test e script, senza cambi al codice di prodotto: liste note delle violazioni, prima misura dei duplicati, valori di partenza delle prestazioni, risposte di riferimento di API e MCP, `assertions-diff`. Da N0 vale «non peggiora» | Tutto in R0: i rilasci N1-N5 senza questi controlli |
| I15 | Soglie di pulizia e di duplicazione | File 400 righe, funzione 60 righe, 4 parametri, complessità ciclomatica 12, annidamento 4, righe duplicate al massimo 3% per pacchetto a fine R3 | Altri valori, dopo la prima misura di R0 |
| I16 | Guadagno di velocità «significativo» e obiettivi assoluti | Significativo: almeno il 30% del tempo di una vista o di una rotta, o almeno 200 ms sul 95° percentile di una pagina. Obiettivi assoluti: una proposta dopo le misure di N0. Fino ad allora vale «non peggiora di oltre il 10%» | Un'altra soglia; obiettivi assoluti fissati ora |
| I17 | Forma della review finale unica | Un solo passo Z con due parti: il codice (un agente di review scelto dall'orchestratore) e la sicurezza (Security Reviewer) | Un solo agente per le due parti |
| I18 | Strumenti per duplicati, codice morto, complessità e cicli | Nessun pacchetto nuovo: script propri sullo scanner di `typescript`, regole del nucleo di ESLint, `architecture.test.ts` esteso ([`10-modularity.md`](10-modularity.md) §10.7.5) | `jscpd`, `knip`, `dependency-cruiser`, `eslint-plugin-sonarjs`: ognuno dopo il gate del Security Gatekeeper, prima dell'installazione |
| I19 | Elenco, nomi e livelli dei moduli di arrivo | Quelli di [`10-modularity.md`](10-modularity.md) §10.3. Nomi nuovi: `identity` (oggi `users`), `documents` (oggi `imports`), `connections`, `portfolio`, `shared/*` | Tenere i nomi di oggi (`users`, `imports`) |

## 9.4 Fuori dal piano

- Distribuzione delle app, account sviluppatore, firma pubblica, aggiornamenti automatici.
- iOS.
- Guida e immagine per l'installazione di un'istanza da parte di un altro host.
- Contratto Enable Banking a pagamento.
- Tasse italiane (plusvalenze, bollo).
- Import dell'estratto di un broker per il Portafoglio manuale.
- Notifiche immediate con un servizio di consegna di terzi.
- Scritture senza rete.

## 9.5 Punti decisi il 14/11/2026

Erano ipotesi da confermare. Mattia le ha decise il 14/11/2026 ([`01-decisions.md`](01-decisions.md) §1.0).

| # | Punto | Decisione | Effetto sul piano |
|---|---|---|---|
| I7 | Revisore del codice | **Nessuna review del codice fino alla fine, in nessun rilascio** (H6). Nessuna review incrociata tra i due sviluppatori, nessun revisore intermedio | Gate di ogni rilascio: test, controlli automatici, verifica dell'orchestratore. Alla fine una review finale unica (Z). [`08-agents.md`](08-agents.md) §8.5 |
| I13 | Difetti probabili trovati dall'audit | **BUD-1 si corregge subito**, come `fix`, in una sotto-issue separata (H4). ACC-2 e FND-2 restano nel passo R2 del loro modulo, con un commit separato e un test | BUD-1 esce da R2: corretto in `main` a `86e3d43`, tag `v0.10.2`. La correzione non tocca le righe già scritte: una correzione dei dati chiede un OK separato |
| D1-D11 | Numeri oggi calcolati in due modi | **Vale il numero delle pagine** (H5): il default della tabella qui sotto | Nessuna domanda aperta prima dei passi di R2. Ogni cambio ha un commit separato e un test |

**Numeri oggi calcolati in due modi.** Il refactor ne tiene uno solo: il valore che l'utente vede oggi nelle pagine.
Cambiano le altre superfici. Sono le sole differenze di numeri ammesse dal vincolo «comportamento invariato».

| # | Voce | Oggi | Decisione | Cosa cambia |
|---|---|---|---|---|
| D1 | ACC-2 | `previousNetWorth` è sempre `null` su `GET /summary`, `get_summary`, mail mensile; Overview mostra la variazione | Il valore di Overview | API, MCP e mail ricevono un valore al posto di `null` (additivo) |
| D2 | ACC-3 | Il totale salvato dallo snapshot mensile usa i conti `inSnapshot`; il patrimonio usa `inNetWorth` | Restano due filtri, con due nomi distinti e visibili | Nessun numero; solo l'etichetta in Settings › Dati |
| D3 | TRX-1 | `net` include i trasferimenti; entrate e uscite no | `net` resta com'è; nasce un secondo campo «entrate − uscite» con un nome suo | Nessun numero esistente; un campo in più |
| D4 | TR-4, TRX-2, POC-2, SUB-4 | Solo accounts converte nella valuta di visualizzazione. Movimenti, budget, pocket e abbonamenti sommano centesimi senza valuta | Con una sola valuta (il caso di oggi) nulla cambia. Con valute diverse: conversione al cambio BCE del giorno del movimento, come per i conti | Nessun numero finché tutti i conti di spesa sono in EUR |
| D5 | BUD-1 | Lo stop di un budget per conto scrive una riga senza conto | Correzione: la riga porta il conto. **Subito, come `fix`, fuori dai rilasci del piano** (H4) | I budget per conto fermati dopo la correzione |
| D6 | SUB-1 | «Prossimi 30 giorni» parte da oggi nel KPI e da domani nella proiezione | Da oggi, in entrambi | La proiezione per conto comprende un addebito con scadenza oggi |
| D7 | INT-3 | «Lettura vecchia»: 1 ora in Interests, soglia del conto (36 ore) in Accounts | Restano due soglie, con due nomi distinti | Nessun numero |
| D8 | FND-1, FND-2, FND-3 | Export e riga dei fondi in Investments usano il motore vecchio; le pagine Funds il motore di periodo. Il «versato» dell'export esclude `transfer_in` | Il motore di periodo e i numeri delle pagine Funds | Export e riga dei fondi si allineano alle pagine Funds |
| D9 | INV-1 | API, MCP ed export pubblicano il rendimento semplice; le pagine mostrano Modified Dietz | Il campo esistente resta (rendimento semplice, con il suo nome). Si aggiunge il campo Modified Dietz del periodo | Nessun numero esistente; un campo in più |
| D10 | INV-5 | L'export comprende i servizi archiviati e non converte; API, MCP e pagine li escludono e convertono | L'export tiene gli archiviati (è un'esportazione completa) con un campo `archived`, e usa la stessa conversione | I valori convertiti dell'export |
| D11 | PLT-1 | Due percorsi di conversione: possono differire di un centesimo | Una sola conversione, quella di `platform/fx`. Gli importi già salvati sugli eventi non si ricalcolano | Possibile differenza di un centesimo su conversioni a schermo di eventi nuovi |

## 9.6 Ipotesi · revisione sulla standardizzazione (approvata da Mattia il 14/11/2026)

Le decisioni H12-H17 sono di Mattia. Queste righe sono le scelte che le decisioni non coprono. Il piano applica il
default. Le due analisi (prodotto e codice) sono unite qui senza doppioni.
«Scelta» = l'orchestratore ha scelto tra due proposte diverse.

**Risposta di Mattia del 14/11/2026.** Mattia ha risposto con le sole eccezioni:

- ST-4, ST-6 e ST-7 sono decisioni: H18, H19, H20 ([`01-decisions.md`](01-decisions.md) §1.0). Non sono più in
  questo elenco.
- ST-19 è tolta: nei fondi non si caricano documenti (H19).
- Ogni altra riga ST-1…ST-24: **decisione di Mattia del 14/11/2026, con il default (risposta con le sole eccezioni)**.
- OK alla revisione: dato da Mattia il 14/11/2026 ([`01-decisions.md`](01-decisions.md) §1.0, H21).
- Ipotesi nuove, in fondo a questa sezione: ST-26 e ST-27 sono decisioni, con il default (H22, H23). ST-25 è una
  decisione, con l'alternativa «cancellazione in N6» (H24).

**Fondo pensione (N6)**

| ID | Domanda | Decisione del 14/11/2026 (default del piano) | Alternativa scartata | Rilascio |
|---|---|---|---|---|
| ST-1 | Contributo del datore di lavoro: come si tratta? | **Scelta.** Componente della sorgente `payroll`, con lavoratore e TFR. L'interfaccia mostra ogni componente con la sua origine. Motivo: un solo meccanismo, una sola riconciliazione per versamento | Sorgente a parte «Dalla busta paga»: due sorgenti per lo stesso bonifico | N6 |
| ST-10 | Il tariffario pubblico di Cometa (13 righe nel database)? | Le 13 righe diventano righe `fund_fees` del fondo Cometa: nessun dato perso; l'utente toglie quelle che non usa. Nessuna tariffa resta nel codice | Migra solo la commissione di gestione del comparto in uso; le voci a richiesta non migrano | N6 |
| ST-11 | La riconciliazione busta paga ↔ fondo? | Resta. Compare solo con una sorgente `payroll`; il periodo segue il calendario della sorgente. Il lato del fondo sono le operazioni registrate: nessun documento del fondo (H19) | Trimestre fisso come oggi | N6 |
| ST-12 | Un fondo nuovo senza Payroll e senza modello? | Funziona e nasce vuoto: nessuna scadenza, nessuna commissione; contributi e valori a mano. Il modello «Cometa» è una scelta facoltativa | Ogni fondo nuovo parte da un modello | N6 |
| ST-16 | Strada per i dati dei 2 fondi in produzione? | Strada A: migrazione additiva con riclassificazione; rimozione del vecchio in R5f | Strada B: nessuna migrazione, adattatore di lettura. Lascia due forme di archivio | N6, R5f |
| ST-17 | Il conto di Fideuram passa dal tipo `investment` al tipo `pension`? | Sì: il patrimonio non cambia, cambia il subtotale del gruppo (eccezione X2) | No: il gruppo si legge dal fondo, con una regola in più | N6 |
| ST-18 | Quando si fa il fondo unico? | **Scelta.** N6, ultimo rilascio della fase A. Motivo: R0, R2 e R3 non spostano e non rifanno il codice del PAC | In R2, prima del refactor di `funds`; oppure un rilascio nuovo prima di R5b | N6 |

**Investments e piano di acquisto**

| ID | Domanda | Decisione del 14/11/2026 (default del piano) | Alternativa scartata | Rilascio |
|---|---|---|---|---|
| ST-2 | Quanti gruppi ha Investments, e con quali nomi? | 2: «Azioni e crypto», «Fondi pensione». I conti con solo valore stanno nel primo | 3 gruppi per origine dei dati: «Servizi collegati», «Portafoglio manuale», «Fondi pensione»; oppure una lista unica con un'etichetta per riga | R5b |
| ST-3 | Le 3 scelte di «Aggiungi investimento»? | «Collega un servizio» · «Segui i tuoi titoli a mano» · «Fondo pensione» | Altri nomi | R5b |
| ST-5 | A ogni scadenza di un piano di acquisto? | L'app propone l'operazione; l'utente conferma. «Registra in automatico» è un interruttore del piano, spento | Sempre in automatico, con il prezzo di chiusura: quantità e P&L sono stime | R5d, secondo passo |

**Lettori, Payroll, Time Off (R5g)**

| ID | Domanda | Decisione del 14/11/2026 (default del piano) | Alternativa scartata | Rilascio |
|---|---|---|---|---|
| ST-20 | Festività senza un calendario sottoscritto? | Solo fine settimana, con un avviso. Il calendario del paese si propone al primo avvio. Via il ripiego italiano nel codice | Tenere il ripiego italiano | R5a, R5g |
| ST-21 | Busta paga di un datore senza profilo? | Inserimento a mano della busta paga generica. Lettura generica con AI, se configurata, e revisione a mano. Un profilo nuovo è un file di dati | Solo avviso «formato sconosciuto», come oggi | R5g |
| ST-22 | Rilascio R5g «Lavoro standard»? | Sì, dopo R5c e prima di R5f | Dentro i passi R2 e R3 di `timeoff` e `payroll`: cambi di modello dentro il refactor «a comportamento invariato» | R5g |
| ST-23 | Difetto probabile: un giorno ROL non avvia la sync verso Trek (due liste diverse, non verificato)? | Verifica con un test in N5. Se il test fallisce, correzione come `fix` nello stesso rilascio | Correzione in R5c, con Trek come plugin | N5 |

**Altre funzioni**

| ID | Domanda | Decisione del 14/11/2026 (default del piano) | Alternativa scartata | Rilascio |
|---|---|---|---|---|
| ST-8 | Import dei movimenti da file CSV nel core? | Sì, con mappa delle colonne salvata per conto. Rilascio proposto: R5c, con le sorgenti che diventano plugin | Rilascio nuovo in fase A, subito dopo N3; oppure fuori dal piano | R5c |
| ST-9 | Valori predefiniti per paese (festività, tassa sugli interessi, tipi di assenza)? | Pacchetto paese: file di dati nel core, scelto al primo avvio. Ogni valore è modificabile. Senza valore il default non compare. Nessun limite fiscale nel pacchetto (H18) | Un plugin per paese; oppure nessun default | R0, R5a, R5g |
| ST-13 | «Connections» del conto (lista a mano di addebiti)? | Si toglie. Le righe passano in Subscriptions, con il filtro per conto | Resta com'è | R5a; R5f |
| ST-14 | Pubblicazione degli interessi su Wallet? | Finisce con R5c per tutti i conti, anche quelli non passati a Enable Banking (Wallet in sola lettura, C4b) | Resta per i conti ancora su Wallet, come capacità `ledgerPosting` del plugin | R5c |
| ST-15 | Il voto «utilità» degli abbonamenti? | Resta, facoltativo e spento per gli utenti nuovi | Si toglie | R5a |
| ST-24 | Avvio senza OIDC, senza posta e senza S3; compose di esempio neutro? | Fuori dal piano: entra con la guida di installazione per un altro host (§9.4). Il piano tiene solo il nome dell'accesso come impostazione (R2) | Dentro R5a | — |

Corrispondenza con le due analisi: ST-1…ST-15 sono le domande dell'analisi di prodotto; le 13 domande dell'analisi
del codice sono unite così: Q1 → ST-16, Q2 → ST-4 (ora H18), Q3 → ST-17, Q4 → ST-18, Q5 → ST-1, Q6 → ST-12,
Q7 → ST-19 (tolta: H19), Q8 → ST-9, Q9 → ST-5, Q10 → ST-20, Q11 → ST-21, Q12 → ST-7 (ora H20), Q13 → ST-22.
ST-23 e ST-24 sono nuove.

Già decise da Mattia, non in questo elenco: fondo unico e fine del tipo PAC (H12), PAC nel Portafoglio manuale (H13),
sorgenti TFR e volontario (H14), commissioni impostabili (H15), nessuna funzione su misura (H16), nessun «Deducibile»
(H18), lettore della busta paga dietro E1 e nessun documento nei fondi (H19), malattia fuori da Time Off (H20).

**Ipotesi nuove** (nate dalle risposte del 14/11/2026). Risposta di Mattia del 14/11/2026: ST-26 e ST-27 sono
decisioni, con il default (H22, H23). ST-25: il default è scartato; decisione del 14/11/2026, cancellazione in N6 (H24).

| ID | Domanda | Default del piano | Alternativa | Rilascio |
|---|---|---|---|---|
| ST-25 | I file dei documenti di Cometa già salvati, con le loro righe `documents`? | **Scartato da Mattia il 14/11/2026.** Era: restano archiviati fino a R5f, senza pagina nell'app; restano nell'export ZIP. In R5f si cancellano file e righe, con dump e OK di Mattia | **Decisione di Mattia del 14/11/2026 (H24): cancellazione in N6.** File nell'archivio S3 e righe `documents` dei tipi `cometa_*`. Prima: dump del database e copia dei file in `projects/Ledgerly-dumps/`, con una prova di ripristino. Passo separato del rilascio (A4), dopo la prova SN7, con l'OK di Mattia sul SHA (`git-policy` §6 #1 e #2). Rollback: ripristino dalla copia. Le operazioni e i valori già letti restano dati del fondo. Scartata: nessuna cancellazione | N6 |
| ST-26 | `POST /imports` con i tipi `cometa_operations` e `cometa_position` (API pubblica)? | Regola «API solo additiva»: i due valori restano nel contratto. Da N6 la rotta li rifiuta con un errore dichiarato e non salva il file. Escono dal contratto con R5f | I due valori escono dal contratto in N6: un client che li usa riceve l'errore generico `invalid` | N6, R5f |
| ST-27 | Il tipo `sick` del codice di oggi: quando esce da Time Off? | In N5: il pannello nuovo non lo offre (0 righe in produzione). In R5g non diventa un tipo. Il valore esce dal check in R5f | In R5g, con i tipi come dati: fino ad allora il pannello lo mostra | N5, R5g, R5f |

Campi pubblici: il «Deducibile» non ha campi in API, MCP ed export, quindi nessun campo sparisce (verificato su `main` a
`9be59db`). Se un controllo in N6 trova un campo pubblico legato a H18 o H19, vale il default «il campo resta e vale
`null`».

# 13. Sezione Addons (e plugin dell'admin, ritirati)

Indice del piano: [`../rewrite-plan.md`](../rewrite-plan.md). Registro: [`01-decisions.md`](01-decisions.md) H48-H51.

Decisioni di Mattia del **16/11/2026**. Questo documento scrive la decisione sugli addon, le domande aperte e gli
effetti sugli altri rilasci. Non riscrive i rilasci e non contiene codice.

**Stato: la sezione Addons è decisa (H50); rilascio e dettagli sono da decidere (§13.4, §13.5).** Nessuno sviluppo
parte prima delle risposte. La parte sui plugin dell'admin è ritirata (§13.2): per i plugin il piano non cambia.

Segni usati: **[PROPOSTA]** = default proposto da questo documento, non deciso da Mattia. **[DEV]** = stima o scelta
tecnica da confermare con lo sviluppo.

## 13.1 La decisione

Parole di Mattia:

> «Ci deve essere anche la sezione Addons. Un Addon è un modulo core che può essere disattivato dal singolo utente,
> come (investments, work), oppure le singole sotto categorie come payroll, subscriptions, budgets, pocket, timeoff
> possono essere disattivate o attivate, tranne quelle necessarie per il funzionamento base dell'applicazione.»

| ID | Regola | Cosa dice |
|---|---|---|
| H50 | **Sezione Addons** | Un addon è un modulo del core che il singolo utente può disattivare: un modulo intero (Investments, Work) oppure una sotto-categoria (Payroll, Subscriptions, Budgets, Pockets, Time Off). I moduli necessari al funzionamento di base non si disattivano |

Due parole, due cose:

| Parola | Cos'è | Chi lo gestisce |
|---|---|---|
| **Plugin** | Una sorgente esterna, fuori dal core, in un container separato (Enable Banking; Wallet e Trek da R5c) | Ogni utente, per sé (H25, H27, H51) |
| **Addon** | Un modulo del core, già dentro Ledgerly | Ogni utente, per sé (H50) |

H50 precisa D2 («moduli attivabili») e la riga R5a «Moduli attivabili per utente»: dà il nome, l'elenco di partenza
e la regola dei moduli di base. D3 (tab di Settings) è da rivedere con la domanda PA16.

## 13.2 Parte ritirata: plugin dell'admin e applicazione Enable Banking unica

Nello stesso messaggio Mattia aveva deciso anche:

- **H48:** i plugin sono gestiti e aggiunti dall'admin; l'utente sceglie solo se attivarli.
- **H49:** Enable Banking ha una sola applicazione per istanza, dell'admin; gli altri utenti collegano solo la banca.

Mattia le ha **ritirate lo stesso giorno (H51)**: «annulla la parte dei plugin, la gestiscono gli utenti come nel
piano originale». Per i plugin valgono, senza cambi, H25-H30, C1c e C4: ogni utente attiva e gestisce i suoi plugin,
registra la sua applicazione Enable Banking e inserisce le sue credenziali. N1 e N2 in produzione sono già così.

Motivo, da ricordare se il tema torna:

| Fatto | Effetto con un'applicazione unica |
|---|---|
| L'applicazione Enable Banking gratuita è «Restricted»: legge solo i conti già collegati nel pannello di Enable Banking del proprietario (prova del 15/11/2026) | L'admin dovrebbe collegare a mano, nel suo pannello, i conti di ogni altro utente. Oppure serve un'applicazione verificata, con condizioni e costo non noti |
| Una chiave sola firmerebbe le richieste di tutti gli utenti | Una chiave compromessa esporrebbe le banche di tutta l'istanza, non di un solo utente |
| L'applicazione sarebbe un punto unico di guasto | Una revoca o un limite di Enable Banking fermerebbe tutti gli utenti insieme |

Le domande PA2-PA8, le ipotesi A17-A19 e i rischi R-37…R-40 riguardavano questa parte: non servono più.

## 13.3 Modello proposto degli addon **[PROPOSTA]**

Tutto in questa sezione è una proposta: serve a rendere concrete le domande di §13.5.

Elenco proposto (domanda PA9). I nomi sono quelli del menu di oggi.

| Tipo | Voce | Disattivabile | Nota |
|---|---|---|---|
| Base | Overview | No | — |
| Base | Accounts (conti, saldi, patrimonio) | No | — |
| Base | Expenses (movimenti, categorie, «Da rivedere») | No | — |
| Base | Settings, collegamenti e sorgenti, avvisi, esportazione | No | — |
| Addon, modulo | **Investments** (servizi collegati, portafoglio, fondi pensione) | Sì | Oggi «Funds» è una voce a parte: fino a R5b è un addon suo |
| Addon, modulo | **Work** (Payroll + Time Off) | Sì | Spegne le due sotto-categorie insieme |
| Addon, sotto-categoria | **Payroll** | Sì | Dentro Work |
| Addon, sotto-categoria | **Time Off** | Sì | Dentro Work |
| Addon, sotto-categoria | **Budgets** | Sì | — |
| Addon, sotto-categoria | **Subscriptions** | Sì | — |
| Addon, sotto-categoria | **Pockets** | Sì | — |
| Addon, sotto-categoria | **Interests** | Sì **[PROPOSTA]** | Mattia non l'ha nominato. Funds e Pockets lo usano |

Dipendenze tra i moduli, misurate sul codice (`main` a `b3ab940`, import tra moduli, file non di test):

| Modulo | Chi lo importa | Effetto sulla disattivazione |
|---|---|---|
| `budgets`, `pockets`, `subscriptions`, `timeoff` | Nessun altro modulo | Si disattivano senza effetti su altri moduli |
| `payroll` | `funds`, `imports`, `timeoff` | Time Off legge la maturazione dalle buste paga (N5.1). Un fondo pensione può avere la sorgente «busta paga» (N6) |
| `interests` | `funds`, `pockets` | Fondi e Pockets usano i tassi |
| `funds` | `investments`, `payroll` | — |
| `accounts`, `transactions` | Quasi tutti | Sono moduli di base |

Regola proposta per le dipendenze (domanda PA12): la disattivazione di un addon non spegne un altro addon. La
funzione che dipende dall'addon spento resta, senza la parte che manca. Esempio: senza Payroll, Time Off resta e non
calcola la maturazione dalle buste paga.

Cosa fa la disattivazione, proposta (domande PA10 e PA11):

| Superficie | Addon disattivato |
|---|---|
| Menu, pagine, palette dei comandi, riquadri di Overview | Spariscono. L'URL diretto porta alla sezione Addons |
| Job e letture del modulo | Si fermano per quell'utente |
| Avvisi e mail del modulo | Nessuno |
| Dati | Restano tutti. Alla riattivazione tornano com'erano |
| Patrimonio e totali | Non cambiano: i conti del modulo continuano a contare |
| API e MCP | Le rotte e gli strumenti del modulo rispondono con un errore dichiarato «modulo non attivo» |
| Esportazione | Contiene anche i dati dei moduli disattivati |

## 13.4 Dove entra nei rilasci: domanda PA1

Le dimensioni sono stime **[DEV]**.

| | A · Dentro R5a **[PROPOSTA]** | B · Rilascio nuovo N7, fase A, dopo N4 |
|---|---|---|
| Contenuto | La sezione Addons prende il posto di «moduli attivabili» in R5a, con il menu a 3 gruppi e il primo avvio | Sezione Addons sul menu e sulle impostazioni di oggi |
| Migrazioni | `user_preferences.modules` (già prevista in R5a). Additiva | La stessa, anticipata. Additiva |
| Criteri §6 attesi | #1, come oggi per R5a | #1 |
| Dimensione **[DEV]** | R5a resta M (può passare a L, rischio R-15) | N7: M |
| Effetto sul piano | Nessun rilascio nuovo. La fase A non si allunga | R0 parte dopo N7. Menu e schermate nascono sul codice che R3 riscrive e sul menu che R5a cambia: lavoro doppio |
| Quando sceglierla | Gli addon possono aspettare la navigazione nuova | Vuoi spegnere i moduli prima della riscrittura |

Motivo della proposta A: R5a ha già i moduli per utente, il menu nuovo e il primo avvio; nessun lavoro si fa due volte.

## 13.5 Domande per Mattia

Ogni domanda ha un esempio, l'opzione A (default proposto), l'opzione B e l'effetto. «ok default» vale per tutte;
le eccezioni si scrivono come «PA9 B». I numeri PA2-PA8 erano le domande sui plugin, ritirate con H51.

| # | Domanda | Esempio | A (default) | B | Effetto |
|---|---|---|---|---|---|
| PA1 | In quale rilascio entra la sezione Addons? | Oggi il piano ha i «moduli attivabili» in R5a | Dentro R5a. Nessun rilascio nuovo | Rilascio nuovo N7 nella fase A, dopo N4. Dettaglio in §13.4 | A: la fase A non si allunga. B: R0 parte dopo; parte del lavoro si rifà nella riscrittura |
| PA9 | Quali sono i moduli di base e quali gli addon? | Un utente usa Ledgerly solo per conti e spese | Base: Overview, Accounts, Expenses con le categorie, Settings, collegamenti, avvisi, esportazione. Addon: Investments (con i fondi pensione), Work (Payroll, Time Off), Budgets, Subscriptions, Pockets, Interests. Tabella in §13.3 | Il tuo elenco, senza Interests: Interests resta di base | A: tutto ciò che non serve ai conti e alle spese si spegne. B: una voce in meno da gestire; Interests resta nel menu di tutti |
| PA10 | Cosa fa la disattivazione di un addon? | Disattivi Subscriptions | Spento ovunque: menu, pagine, riquadri di Overview, job, avvisi e mail, API e MCP (errore dichiarato «modulo non attivo»). I dati restano e tornano alla riattivazione | Spento solo nell'interfaccia: job, avvisi, API e MCP continuano | A: un addon spento non lavora e non avvisa; al ritorno i dati si aggiornano. B: i dati restano sempre aggiornati; arrivano avvisi di un modulo che non vedi |
| PA11 | Un addon disattivato conta ancora nel patrimonio? | Hai 5.000 € su un servizio di investimento e disattivi Investments | Sì: patrimonio e totali non cambiano. Overview mostra la riga del gruppo, senza il link al modulo. Il valore resta l'ultimo letto | No: i conti del modulo escono dai totali finché l'addon è spento | A: nessun numero cambia per un interruttore; il valore invecchia. B: il patrimonio scende alla disattivazione e risale alla riattivazione |
| PA12 | Cosa succede quando un addon dipende da un altro? | Time Off legge la maturazione dalle buste paga. Un fondo pensione ha la sorgente «busta paga». Disattivi Payroll | L'altro addon resta attivo, senza la parte che manca: Time Off senza maturazione automatica, il fondo senza contributi dalla busta paga. Prima della conferma Ledgerly elenca cosa si ferma | Blocco: Payroll non si disattiva finché Time Off e la sorgente «busta paga» lo usano | A: massima libertà; qualche funzione resta a metà, con un avviso. B: nessuna funzione a metà; per spegnere Payroll devi prima spegnere o cambiare il resto |
| PA13 | Quali addon sono attivi all'inizio? | Arriva un utente nuovo. Tu hai già tutti i moduli in uso | Utenti di oggi: tutti gli addon attivi, niente cambia. Utente nuovo: sceglie nel primo avvio (R5a); nessun addon attivo senza la sua scelta | Tutti attivi per tutti, anche per l'utente nuovo; chi vuole spegne | A: l'utente nuovo vede solo ciò che sceglie. B: l'utente nuovo vede tutto il menu |
| PA14 | L'admin può limitare gli addon disponibili? | Non vuoi che gli altri utenti usino Payroll sulla tua istanza | No: ogni utente sceglie tra tutti gli addon | Sì: l'admin sceglie quali addon esistono nell'istanza; l'utente attiva solo quelli | A: nessuna schermata dell'admin per gli addon. B: una schermata in più e un secondo livello di regole (istanza, poi utente) |
| PA15 | Quale nome vede l'utente? | La voce nelle impostazioni | «Addons», in italiano e in inglese | «Moduli» in italiano, «Modules» in inglese; «addon» resta una parola del piano | A: la tua parola, uguale ovunque. B: una parola più semplice per chi non è tecnico (premessa 2) |
| PA16 | Dove sta nelle impostazioni? | Apri Settings | Un tab proprio: Settings › **Addons**, accanto al tab Plugin di R5a | Una sezione dentro il tab «Profilo» | A: si trova subito; un tab in più. B: nessun tab nuovo; la sezione è meno visibile |

## 13.6 Righe del piano con una nota del 16/11/2026

| # | Punto del piano | Nota |
|---|---|---|
| 1 | `01-decisions.md` D2, D3 | I moduli attivabili sono la sezione Addons (H50); posto in Settings da decidere |
| 2 | `03-releases.md` R5a: «Contenuto», «Per l'utente», «Migrazioni», criteri | «Moduli attivabili per utente» diventa la sezione Addons. Nota sotto le tabelle di R5 |
| 3 | `06-data.md` §6.1, `user_preferences.modules` | È il dato degli addon |
| 4 | `07-apps.md` §7.4, «moduli attivi» | Diventa «Addons» |
| 5 | `09-risks.md` §9.2 | Rischio nuovo R-41. A17-A19 e R-37…R-40 ritirati |
| 6 | `rewrite-plan.md`, riga R5a | Nota sotto la tabella dei rilasci |

Nessuna riga sui plugin cambia: H25-H30, C1c, C4, N1, N2, R5c, `04-now.md` §4.1 e §4.2 e le specifiche UX di N1 e N2
restano come prima del 16/11/2026.

## 13.7 Effetti sugli altri rilasci

Questa sezione elenca gli effetti. Non riscrive i rilasci: ogni rilascio si aggiorna dopo le risposte di §13.5.

| Rilascio | Effetto | Da confermare |
|---|---|---|
| **N1-N4, N3.1** | Nessun effetto | — |
| **N5, N5.1, N6** | Nessun effetto ora. Con gli addon: Time Off senza Payroll non ha la maturazione; la sorgente «busta paga» di un fondo non riceve contributi | PA12 |
| **N7** (solo con PA1 = B) | Rilascio nuovo della fase A. R0 parte dopo N7 | PA1 |
| **R1** | I job di un addon disattivato non girano per quell'utente | PA10 |
| **R2** | 1) Risposta dichiarata «modulo non attivo» per le rotte e gli strumenti MCP di un addon spento. 2) `GET /api/v1/meta` espone gli addon attivi dell'utente | PA10. **[DEV]** L'errore nuovo è un cambio additivo del contratto (F5b)? |
| **R3** | La sezione Addons nasce in `packages/ui` | — |
| **R5a** | «Moduli attivabili» diventa la sezione Addons: elenco, moduli di base, dipendenze, valori di partenza. Il primo avvio propone gli addon. Il menu a 3 gruppi mostra solo gli addon attivi | PA9-PA16 |
| **R5b** | Investments unificata: l'addon Investments comprende i fondi pensione. Overview mostra o no il gruppo di un addon spento | PA9, PA11 |
| **R5c, R5d** | Nessun effetto: i plugin restano di ogni utente (H51) | — |
| **R5e** | Nessun avviso per un addon spento | PA10 |
| **R5g** | Nessun effetto sul contenuto. Payroll e Time Off sono addon: i tipi di assenza e i profili restano dati dell'utente anche con l'addon spento | — |
| **C1, C2 (Android)** | «Moduli attivi» nel profilo diventa «Addons» | — |
| **Z** | Nessun punto nuovo | — |

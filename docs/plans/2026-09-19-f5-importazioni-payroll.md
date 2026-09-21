# F5 — Importazioni e Payroll

> Piano eseguito **in linea**, lotto dopo lotto, come F3 e F4. Chi lo riprende in mano non ha il
> contesto della sessione che l'ha scritto: qui dentro c'è tutto quello che serve.

## 0. Come si legge

1. `CLAUDE.md` alla radice — convenzioni vincolanti.
2. `docs/specs/2026-09-13-dev-0.1-design.md` — D11–D14, D18; §4.3; §5.2 (CSP, `frame-ancestors`);
   §6 (righe importazioni e payroll, `app_settings`); **§7.8**; §8.3 (`PdfViewer`); **§9.3**; §9.4
   (S3, LLM); §10.2 (job orario di rete di sicurezza, eliminazione originali scaduti); §11 (fixture
   reali e gemelli sintetici); §12. **La spec vince sul piano**, e sopra la spec c'è la specifica del
   proprietario (§0.2).
3. **`Payroll/SPECIFICA-ESTRAZIONE-PAYROLL.md`** — la specifica funzionale del proprietario (254
   righe, locale, mai committata). Il piano la cita per riga (`SP L…`). Va implementata per intero.
4. `docs/plans/2026-09-19-f4-interessi-pac.md` §8 — cosa esiste e cosa è cambiato.
5. Il design (`UI Recreation and branding decisions/Finance Dashboard.dc.html`, sola lettura):
   Payroll 725–750, Review 752–775, modale "Add payslip" 1143–1153, mobile 1011–1019; dati
   `PAYSLIPS`/`REVIEW_FIELDS` in `data.js` 67–85. Il design è **precedente a D13**: dove divergono vale
   D13 (§3.6).
6. Riferimento della versione precedente, solo da leggere: su `origin/main` il modulo
   `dashboard-app/src/lib/payroll/` e `src/modules/payroll/`. Lavorava **senza coordinate** (testo
   piano per pagina), quindi serve come elenco di trappole, non come modello.

## 1. Obiettivo

F5 secondo §12: **la pipeline di importazione di §9.3; §7.8 per intero (parser deterministico a
coordinate, revisione con evidenze, registro D13); il fallback LLM OpenAI (D12, D18)**. Con la
mappa dei codici in Settings › Data e il minimo di impostazioni admin che il fallback richiede.

Fuori perimetro: OCR (D11: resta lo stato `needs_ocr`), importazioni Cometa (F6, ma la pipeline le
prevede), sink verso i fondi (F6) e le ferie (F7), `/api/v1/imports` (F8), antivirus (§3.6.5).

## 2. Punto di partenza (2026-09-19)

- Branch `dev-0.1` su `4836024` (F3 e F4 committate e spinte). Ultima migrazione `0010`.
- Nessun server di sviluppo; ogni lotto si verifica su `https://dash.longobardo.me`.
- **I 12 cedolini veri** sono in `Payroll/` (locale): una pagina ciascuno, testo nativo (font
  Courier e Times, nessuna immagine), **due generazioni** — ottobre 2025–febbraio 2026 con molte
  stringhe per blocco di testo, marzo–agosto 2026 con una stringa per blocco. Nessun PDF richiede
  OCR. I test d'integrazione girano in un container che monta la cartella del repository: i PDF sono
  leggibili da lì.

### Cosa esiste già e va riusato

| Serve a | Dove |
|---|---|
| S3 (Silo): scrivi, leggi, cancella | `platform/storage.ts` (`putObject`, `getObject`, `deleteObject`), `storage-keys.ts` |
| Cifratura delle credenziali | `platform/crypto.ts` (`sealJson`/`openJson`, `APP_ENCRYPTION_KEY`) |
| CSP | `platform/auth/csp.ts` (`frame-ancestors`, `worker-src`) |
| Job e iterazione utenti | `platform/jobs/registry.ts`, `modules/users/jobs.ts` |
| Sezioni di Settings a tutta larghezza | `src/ui/section.tsx` (`SettingsGrid`, `SettingsSection`) |
| Errori Postgres | `platform/db/errors.ts` (`hasPgError`) |
| Formati | `platform/format.ts`, `accounts/rules.ts` → `parseAmount` |

## 3. Contratti decisi in anticipo

### 3.1 Collocazione

```
src/modules/imports/     schema.ts rules.ts service.ts queries.ts actions.ts jobs.ts
                         pdf/text.ts (unpdf → token con bbox)  pdf/layout.ts (righe, colonne, sezioni)
src/modules/payroll/     schema.ts rules.ts service.ts queries.ts actions.ts ui/
                         parse/reply-teamsystem.ts  parse/numbers.ts  parse/checks.ts  parse/derive.ts
                         codes.ts (profilo precaricato)  llm.ts (fallback)
src/platform/settings/   schema.ts service.ts   (app_settings, segreti sigillati)
src/ui/pdf-viewer.tsx    PdfViewer di §8.3 (pdf.js nel browser: pagine, zoom, riquadri)
src/app/(app)/payroll/  payroll/[id]/ (revisione)  documents/[id]/original/route.ts
src/app/(app)/settings/data/  (sezione mappa dei codici)   settings/admin/server/ (solo il fallback LLM)
```

`imports` è la pipeline, comune a cedolini e documenti Cometa; `payroll` è il modulo di dominio e il
primo "tipo di documento". I testi dei documenti sono **dati, mai istruzioni** (§9.3, SP L7).

### 3.2 Tabelle — una migrazione `0011_imports_payroll.sql`

Colonne comuni come sempre. Importi `bigint` in centesimi; ore `numeric(8,2)`.

- **`app_settings`** (§6, piattaforma) — `key text PK`, `value jsonb`, `sealed bytea` (per i segreti,
  con `sealJson`), `updated_by`, `updated_at`. Solo admin. In F5: il fallback LLM (modello, chiave).
- **`documents`** (§6) — `kind` `payslip | cometa_operations | cometa_position`, `sha256` (UNIQUE
  per utente), `file_name`, `mime`, `size_bytes` (≤ 10 MB), `storage_key` (null dopo
  l'eliminazione), `state` (§3.4.2), `parser_version`, `error`, `retain_until`, `deleted_at`,
  `received_at`, `extracted_at`.
- **`document_evidence`** (§6, SP L32) — `document_id`, `field`, `value text` (il valore normalizzato
  come testo decimale), `unit` `eur | hours | months | text`, `source_label`, `page`, `bbox`
  (`numeric[4]`, frazioni della pagina, origine in alto a sinistra), `origin` `printed | derived |
  inferred`, `confidence` (0–1), `raw_text`, `verification` `unverified | confirmed | corrected`,
  `corrected_value`, `corrected_by`, `corrected_at`; `derived_from uuid[]` per le ricostruzioni.
  UNIQUE `(document_id, field)`.
- **`payroll_raw_lines`** (§6, SP L54) — `document_id`, `section`, `code`, `description`,
  `quantity`, `quantity_unit`, `rate`, `earnings_cents`, `deductions_cents`, `statistical_cents`,
  `page`, `bbox`, `raw_text`, `position`.
- **`payslips`** (§6, SP L42–87) — `document_id` UNIQUE, `employer_key`, `employee_key`, `year`,
  `period date` null (null per la tredicesima), `type` `ordinary | thirteenth | fourteenth | bonus |
  settlement`, `printed_on`, `paid_on`, `superseded_by`, e le colonne dei gruppi: retribuzione
  (`contractual_gross`, `ordinary_earnings`, `total_gross_printed`, `gross_derived`, `welfare_cash`,
  `welfare_in_kind`, `net_pay`), imposte (`irpef_gross`, `tax_deductions`, `irpef_withheld`,
  `regional_installment`, `municipal_withheld`, `substitute_tax`, `year_end_adjustment`,
  `refund_730`, `taxes_total`, `taxes_net_of_refunds`), contributi (`employee_social`,
  `employee_fund_regular`, `employee_fund_adjustments`, `employee_fund_effective`,
  `employee_fund_enrollment`, `employer_fund_printed`, `employer_fund_adjustments`,
  `employer_fund_effective`, `employer_fund_enrollment`, `employer_social_total`), TFR
  (`tfr_month_field`, `tfr_contribution_line`, `tfr_selected`, `tfr_source`), stato `state`
  `needs_review | verified | applied | superseded` e `checks jsonb`. Ogni importo è `null` quando non
  esposto (SP L89). La chiave logica (datore + dipendente + anno/periodo + tipo) ha un indice unico
  **parziale** sui cedolini applicati e non sostituiti.
- **`payroll_code_map`** (§6) — per utente, seminata al primo import dal profilo Reply/TeamSystem
  (`codes.ts`): `profile`, `code`, `role` (il campo o la famiglia: `fund_employee`,
  `leave_vacation_event`, `statistical`…), `column` atteso, `counts_in_net boolean`, `note`. UNIQUE
  `(user, profile, code)`. Modificabile in Settings › Data.
- **`leave_balance_snapshots`** (§6, §7.8) — `payslip_id`, `kind` `vacation | rol`, `previous_year`,
  `accrued_ytd`, `used_ytd`, `remaining` (ore, null se vuoti), `unit`, `unit_evidence`, `period`
  (quello del cedolino).
- **`payroll_leave_events`** (§6, §7.8) — `payslip_id`, `kind` `vacation | rol | permit`, `hours`,
  `payroll_period`, `usage_period` (= periodo − 1 mese), `source_line_ids uuid[]`.

### 3.3 Firme

```ts
// modules/imports
uploadDocument(ctx, file: { name; bytes: Uint8Array }): Promise<{ id; duplicateOf?: string }>
  // formato dal contenuto (firma %PDF), sha256 per utente, S3 fuori da ogni transazione,
  // poi la lettura parte subito (§7.8) in background (`after()` di Next)
extractDocument(ctx, id): Promise<void>        // stato → extracting → needs_review | needs_ocr | failed
readOriginal(ctx, id): Promise<{ bytes; mime; name } | null>
transition(from, to): boolean                  // rules.ts, la macchina di §7.8
pdf/text.ts:   textItems(bytes): Promise<{ page; width; height; items: Token[] }[]>
               // Token = { text, x, y, w, h } in frazioni della pagina; un Tj con più parole è
               // spezzato in token (Courier è a passo fisso: larghezza = w / lunghezza)
pdf/layout.ts: rows(tokens, tolerance), columnsFromHeader(row, headers), sectionOf(…)

// modules/payroll
parseReplyTeamsystem(pages, codeMap): ParsedPayslip  // puro: righe grezze, campi con evidenza,
                                                     // derivati, avvisi — nessun I/O
runChecks(parsed, previous: PayslipSummary[]): CheckResult[]   // SP L115, L175, L226–235
verifyField / correctField(ctx, documentId, field, value?)     // l'originale resta (SP L249)
verifyPayslip, rejectDocument, retryDocument
applyPayslip(ctx, documentId)   // una transazione: sostituisce, scrive cedolino, istantanee, eventi
registerView(ctx): Register     // D13: anni, totali e medie, KPI
fillWithLlm(ctx, documentId)    // solo i campi ancora null, risultato `inferred`, confidenza bassa
```

### 3.4 Regole sottili, decise qui una volta sola

1. **Testo con coordinate** (SP L25): `unpdf` (`getDocumentProxy` → `getTextContent` per pagina) dà
   stringhe con matrice di trasformazione e larghezza; la y si ribalta (origine in alto) e tutto si
   esprime in frazioni della pagina. Le righe si ricostruiscono per y con una tolleranza di mezza
   altezza di carattere, le colonne dalle intestazioni (x d'inizio e fine), le sezioni dalle
   etichette di SP L26. **Nessun ordine testuale è affidabile**: la prima generazione mette etichette e
   valori in blocchi diversi.
2. **Stati** (§7.8): `received → scanning → extracting → needs_review | needs_ocr → verified →
   applied → superseded`, più `rejected` e `failed`; transizioni in `rules.ts`, applicate in modo
   condizionale nel database (nessuna corsa fra job e utente). `scanning` passa subito oltre finché
   l'antivirus non c'è (§3.6.5). Meno di 200 caratteri di testo → `needs_ocr`.
3. **Duplicati e rettifiche** (SP L24, L39–40): stesso sha256 → nessun nuovo documento, si risponde
   con quello esistente. Stessa chiave logica con hash diverso → è una **rettifica**: la revisione lo
   dice e l'applicazione sostituisce il cedolino attivo (`superseded`), mai una somma.
4. **Periodo e tipo** (SP L36–38): il mese da *MESE RETRIBUITO*; `13a MENS. <anno>` → `thirteenth`,
   anno, periodo `null`; `14a` per analogia. Il nome del file non conta mai.
5. **Numeri** (SP L28): formato italiano, segno conservato (compreso un meno finale se i PDF lo
   usano: si verifica sui dodici), testo originale in evidenza; centesimi `bigint`, ore decimali;
   una casella vuota è `null`, mai zero (SP L7, L89).
6. **Definizioni** — quelle di SP L91–161 e §7.8, alla lettera. In particolare: lordo = lordo
   retributivo senza rimborsi welfare, totale lordo stampato a parte; imposte = IRPEF trattenuta +
   rate addizionali + imposta sostitutiva, prima dei rimborsi; imposte al netto dei rimborsi anche
   negative; netto = NETTO BUSTA; 7101 riduce il netto, 9110 e 9109 sono statistici; TFR: sia `TFR
   MESE` sia 8003, mai sommati, mai nel netto.
7. **Controlli** (SP L115, L175, L226–235): IRPEF lorda − detrazioni = trattenuta (±1 cent) **nei soli
   mesi ordinari**; netto ricostruito dalle righe e dalla mappa dei codici, al centesimo;
   A.P. + MAT. − GOD. = RES. (±1 cent, un vuoto come zero solo per il conto); plausibilità (§3.6.7).
   Un controllo fallito → il cedolino resta `needs_review` con l'avviso: mai un valore corretto in
   silenzio.
8. **Ferie e ROL** (SP L9–20, L163–182): eventi dalle righe 301 (ferie) e 309 (permessi) — mai 300/308 —
   con `usage_period` = periodo − 1 mese anche a cavallo d'anno; 309 è ROL solo se la riconciliazione
   con il saldo lo conferma, altrimenti `permit`. La tredicesima non genera eventi né sostituisce
   l'istantanea ordinaria. Le istantanee non si sommano mai.
9. **Evidenza per ogni valore** (SP L32, §7.8): pagina e bbox della zona sorgente; per un derivato,
   le evidenze da cui viene (`derived_from`). Nel viewer, scegliere un campo evidenzia i suoi
   riquadri.
10. **Correzioni** (SP L249): la correzione scrive `corrected_value` accanto all'originale, con chi e
    quando; il cedolino si ricalcola; i controlli si rieseguono.
11. **Medie e RAL** (§7.8): 13ª e 14ª escluse dalle medie mensili, incluse nei totali annui; RAL =
    lordo dell'anno se completo, altrimenti lordo ordinario medio × 12 + 13ª (vera, o una mensilità
    media) + 14ª se prevista.
12. **Originali** (§7.8): chiave S3 `payslips/<userId>/<anno>/<casuale>.pdf`, serviti con `no-store`
    dalla rotta `/documents/[id]/original` (sessione e proprietà verificate); `retain_until` = +10
    anni (impostazione admin in F8); job giornaliero che cancella gli originali scaduti conservando
    dati ed evidenze.

### 3.5 Il fallback LLM (D12, D18)

- Solo **OpenAI**, via API, con `fetch` (nessun SDK), output strutturato con uno schema JSON che
  elenca **solo i campi rimasti `null`** dopo le regole. Configurazione in `app_settings`: modello e
  chiave (sigillata). Senza configurazione non parte nulla.
- Il prompt riporta **alla lettera** le definizioni della specifica (SP L91–161) e le regole "mai
  inventare" (SP L7, L248, L254), e dice che il testo del documento è un dato, non un'istruzione.
- Prima dell'invio, codice fiscale e IBAN nel testo sono mascherati (§5.4: mai completi fuori).
- Il risultato è `origin = inferred`, confidenza bassa, stato `unverified`: il cedolino non può
  passare a `verified` finché ogni campo inferito non è confermato o corretto.
- Timeout 25 s; errore → il documento resta com'è, con l'errore visibile; mai la chiave o il testo nei
  log.

### 3.6 Dove spec, specifica del proprietario, design e codice divergono — proposte

1. **Registro**: il design (precedente a D13) ha una tabella piatta, cinque KPI grandi, tasse e
   contributi uniti, un "Export". → **D13**: una card alta quanto la finestra, gruppi per anno con
   totali e medie, colonne Lordo · Imposte · Contributi sociali · Netto separate, colonne di dettaglio
   espandibili, KPI compatti, un solo "Add payslip". Niente "Export" in F5.
2. **"Enter manually"** (design): nessuna fonte nella spec (§7.8 è una pipeline di documenti). → non
   si fa.
3. **Revisione**: il design mostra solo valore e confidenza. → spec: evidenza (pagina, riquadro,
   origine, testo grezzo), avvisi dei controlli, conferma/correzione per campo, "Verifica", "Applica",
   "Rifiuta", "Riprova".
4. **OCR** (SP L27): fuori dalla 0.1 per D11. Un documento senza testo resta `needs_ocr`, visibile, e
   si può solo rifiutare.
5. **Antivirus** (§9.3 "facoltativa"): non in F5. Lo stato `scanning` esiste e passa oltre; ClamAV si
   aggiunge quando l'admin lo configura (F8).
6. **Impostazioni admin**: Admin › Server è F8, ma il fallback LLM ne ha bisogno ora. → F5 crea
   `app_settings` e la pagina `/settings/admin/server` con la sola sezione "Fallback LLM" (solo admin);
   F8 aggiunge il resto.
7. **Plausibilità** (§7.8 "rispetto ai cedolini precedenti"): la specifica non dà soglie. → avviso
   (mai blocco) se netto o lordo ordinario si scostano di oltre il **30 %** dalla mediana degli ultimi
   sei ordinari, o se il contrattuale cambia senza che il lordo cambi (SP L111 al contrario).
8. **Mesi non ordinari e controllo IRPEF** (SP L115): la tredicesima e il conguaglio di dicembre
   saltano il controllo IRPEF con la motivazione scritta, non con un "superato".
9. **Rettifica con hash diverso** (SP L39–40): nessuna politica nella specifica. → la più recente
   applicata sostituisce l'altra, con la scelta visibile in revisione; nessuna eliminazione.
10. **Fondo azienda fra dicembre e tredicesima** (SP L145–147): lo schema del caso d'esempio si
    riconosce e si ricostruisce con evidenza; uno schema diverso → `needs_review` con avviso, nessun
    importo aziendale mensile calcolato.
11. **Sink verso fondi (F6) e ferie (F7)**: le tabelle non esistono ancora. → F5 scrive cedolino,
    istantanee ed eventi; F6 e F7 li leggono dal servizio di payroll (competenze Cometa e giornate),
    e un'applicazione rifatta li ricalcola.
12. **Fixture** (§11, D14): i PDF veri non entrano mai in git e nemmeno i loro importi. → i test
    di regressione leggono i PDF da `Payroll/` **e le tabelle attese dalla specifica stessa** (SP
    L184–222) a runtime, e si saltano se la cartella non c'è. I **gemelli sintetici** sono pagine
    costruite in test con le posizioni del layout (costanti senza dati personali) e numeri inventati
    ma coerenti: un ordinario, una tredicesima, un mese con rimborso 730 e imposta sostitutiva, un
    mese con ferie e permessi, una rettifica. Due di questi diventano PDF veri (generati con
    `pdf-lib`, dipendenza di sviluppo) per provare anche l'estrazione.
13. **Navigazione**: Payroll nel gruppo "Work" (icona `Banknote`) e fra le schede in basso su
    mobile, come nel design.

## 4. Lotti

```
L0 fondamenta ── L1 pipeline ── L2 testo e layout ── L3 parser Reply/TeamSystem ── L4 revisione
                                                                               └── L5 registro e mappa codici
                                                                               └── L6 fallback LLM
```

Ogni lotto: test prima, cancello (§5), deploy, e2e sul sito (utenti `@example.test`; il seed usa i
gemelli sintetici, mai i PDF veri).

### L0 — Fondamenta
Schemi e migrazione `0011`; `tables.ts`; voce Payroll (Work, mobile); icone; dipendenze `unpdf`,
`pdfjs-dist` (viewer) e `pdf-lib` (sviluppo); CSP per il worker di pdf.js (`worker-src 'self'`, file
servito da `public/`). Test dei CHECK e dell'isolamento di ogni tabella nuova.

### L1 — Pipeline (§9.3)
Caricamento (azione + formato dal contenuto + 10 MB + sha256), S3 fuori transazione, stati con
transizioni condizionali, lettura avviata dopo la risposta, job orario `documents-sweep` (rete di
sicurezza) e giornaliero `documents-retention`, rotta dell'originale. **Test**: duplicato, file non
PDF, errore di S3 (nessun documento orfano), transizioni vietate, isolamento (nessun originale di un
altro utente).

### L2 — Testo e layout
`pdf/text.ts`, `pdf/layout.ts`, `parse/numbers.ts`. **Test**: gemelli sintetici in PDF → token con
bbox corretti; spezzatura dei blocchi della prima generazione; righe e colonne; numeri (migliaia,
virgola, segno, vuoti). Sui PDF veri (se presenti): ogni pagina dà testo, nessuno va in `needs_ocr`.

### L3 — Parser Reply/TeamSystem e controlli (§7.8, SP intera)
Righe grezze, campi con evidenza, derivati, TFR, fondo, ferie/ROL, tipo e periodo, controlli, mappa
dei codici precaricata. **Test**: i gemelli sintetici (tutti i casi); sui PDF veri, le due tabelle
di regressione di SP L184–222 lette dalla specifica, i quattro netti di SP L230–233 e i **dodici
controlli di accettazione** di SP L237–250 come test automatici.

### L4 — Revisione (§7.8)
`PdfViewer` in `src/ui` (pdf.js: pagine, zoom, riquadri evidenziati), pagina `/payroll/[id]`: campi
per gruppi con origine, confidenza e stato, avvisi, conferma/correzione, "Verifica", "Applica",
"Rifiuta", "Riprova"; applicazione con sostituzione. **Test**: correzione che conserva l'originale e
ricalcola; applicazione in una transazione; rettifica che sostituisce; e2e: carica un gemello, apri,
correggi un campo, applica.

### L5 — Registro e mappa dei codici
`/payroll` secondo D13 (§3.6.1), KPI (netto medio 3/6/12 sui soli ordinari, aliquota media, stima RAL),
pillola "N da rivedere", "Add payslip" con trascinamento; Settings › Data: la mappa dei codici;
mobile. **Test**: medie e RAL (unit), registro (integrazione), e2e a 1440 e 400 px.

### L6 — Fallback LLM (§3.5)
`app_settings`, pagina admin, `llm.ts`, bottone "Completa con l'LLM" in revisione (e automatico dopo
l'estrazione se configurato). **Test** con `fetch` finto: solo i campi null nello schema, maschera di
CF e IBAN, risultato `inferred` che blocca la verifica finché non è confermato, nessuna chiamata senza
configurazione, chiave e testo mai nei log. **Collaudo con il proprietario** con la sua chiave.

## 5. Cancello

```
npm run format && npm run lint && npm run typecheck && npm run format:check && npm test && npm run test:integration
docker compose build && docker compose up -d && curl -fsS https://dash.longobardo.me/api/health
npm run e2e
```
In più: `db:generate` → nessuna differenza; nessun PDF, testo o importo dei cedolini veri in git
(`git grep` sui nomi dei file e sulle intestazioni prima di ogni commit).

## 6. Fatto quando

- §7.8 e §9.3 hanno codice e test; la specifica del proprietario è coperta (tabelle di regressione e
  dodici controlli di accettazione verdi sui PDF veri, in locale).
- Il registro mostra i cedolini veri caricati dal proprietario, ciascuno con la sua evidenza.

## 7. Resta al proprietario

- Confermare §3.6 (soprattutto 7, 9, 11, 12).
- Caricare i propri cedolini sul sito e rivederli.
- La chiave OpenAI e il modello per il fallback (L6).
- I commit.

## 8. Esito

Fase implementata il 2026-09-19, lotti L0–L6 in un unico passaggio con cancello e deploy alla fine
di L5 e di L6. Distribuita su `https://dash.longobardo.me` (migrazione `0011` applicata).

### 8.1 Verifiche

- **Unitari 894, integrazione 310, end-to-end 35/35** sul sito; `db:generate` → nessuna differenza.
- **I 12 cedolini veri** (in locale, `src/modules/payroll/parse/real-payslips.test.ts`, saltato senza
  `Payroll/`): entrambe le tabelle di SP L184–222 con i totali, il lordo stampato complessivo, i
  controlli bloccanti tutti superati (netto al centesimo compreso), IRPEF saltata con motivo per 13ª e
  conguaglio, ferie 2026 per mese di utilizzo e per cedolino, TFR 2025/2026, fondo gennaio–agosto,
  13ª senza eventi e con la rettifica aziendale da rivedere. I valori attesi sono letti **dalla
  specifica a runtime**: nel repository non c'è nessun importo dei cedolini veri (verificato con
  `grep` prima della fine: alcuni esempi nei commenti e nei test di `layout` usavano importi veri e
  sono stati sostituiti con numeri inventati).
- **Gemelli sintetici** (`tests/fixtures/payroll/twin.ts`, `samples.ts`): il modulo TeamSystem
  disegnato con pdf-lib alle posizioni reali, numeri inventati coerenti (marzo, aprile con ROL, 13ª,
  ristampa, codice sconosciuto). Percorrono lo stesso codice nei test unitari, d'integrazione ed e2e.
- Controllo visivo di registro, revisione (riquadro evidenziato sulla voce 8054), 400 px e Settings ›
  Data con screenshot da una spec temporanea (non committata).

### 8.2 Scelte fatte in implementazione

1. **Parser generico a coordinate** (`imports/pdf/layout.ts`): etichette = testo ≤ 7 pt, valori = testo
   più grande diviso in parole (passo fisso Courier); righe per baseline; una seconda riga di etichetta
   si unisce a quella sopra; un valore appartiene all'ultima etichetta che inizia prima del suo bordo
   destro; la riga di valori riempie la riga di etichette 12–19 pt sopra. Le due generazioni di PDF
   differiscono solo per gli spazi dentro le etichette ("MES E RETRIBUITO"): le chiavi le ignorano.
2. **Prima occorrenza dall'alto** di un'etichetta, non il primo valore trovato: IMPONIBILE IRPEF,
   IRPEF LORDA e TOTALE DETRAZIONI si ripetono nei progressivi annui e a dicembre le caselle del mese
   sono vuote.
3. **Definizioni ricavate e verificate sui 12**: lordo = TOTALE LORDO − rimborso welfare; imposte =
   TOTALE TRATTENUTE IRPEF (o il conguaglio a debito) + 1150 + imposta sostitutiva del riepilogo T.S.;
   netto ricostruito = Σ competenze − Σ trattenute del corpo − contributi sociali − IRPEF (o conguaglio)
   − sostitutiva − arrotondamento precedente + attuale; secondo controllo su TOTALE TRATTENUTE.
   L'addizionale regionale del conguaglio di dicembre (riga 604) non è trattenuta e non entra.
4. **ROL**: un permesso (309) è ROL solo se residuo precedente + maturato del mese − ore = residuo ROL
   stampato; il cedolino precedente è quello applicato (o in revisione). Applicare un cedolino rilegge
   gli eventi del mese dopo, se già applicato: l'ordine di applicazione non conta.
5. **Tabelle**: `payslips` porta una colonna per ogni importo del catalogo (`payroll/fields.ts`) e
   `active` (indice unico parziale sulla chiave logica); gli stati stanno solo in `documents`.
   Istantanee ed eventi ferie si scrivono solo all'applicazione e si cancellano con la sostituzione.
6. **Revisione**: i derivati non si correggono (si ricalcolano); i totali di colonna del corpo sì,
   perché una riga letta male non ha un campo suo. "Verifica" con controlli bloccanti falliti chiede
   una conferma esplicita ("Verifica comunque"); i valori dedotti dall'LLM vanno confermati prima.
7. **Viewer**: pdf.js nel browser (`src/ui/pdf-viewer.tsx`); worker e font standard copiati in
   `public/pdfjs/` da `scripts/copy-pdfjs.mjs` a ogni build (non versionati). L'originale è servito da
   `/payroll/[id]/original` (sessione, proprietà, `no-store`, `frame-ancestors 'self'`).
8. **S3**: `S3_KEY_PREFIX` (vuoto in produzione, `tests/` nei test d'integrazione, che condividono il
   bucket dell'app); `deleteFolder` elimina gli originali degli utenti e2e alla loro rimozione.
9. **Fallback LLM**: **solo manuale** (bottone "Completa i vuoti con OpenAI" in revisione), non
   automatico dopo la lettura come diceva §3.5: sui 12 cedolini veri alcuni campi che l'LLM potrebbe
   riempire sono vuoti legittimamente (IRPEF del mese a dicembre, detrazioni della 13ª), e una
   chiamata automatica inviterebbe a inventarli. Il prompt riporta le definizioni della specifica
   **senza gli esempi**, che sono importi del proprietario (D14). Chiave sigillata in `app_settings`,
   mai restituita (solo le ultime 4 cifre), modello validato come id OpenAI. Nessuna chiamata reale nei
   test (`fetch` finto).
10. **Admin › Server** è per ora la scheda "Server" di Settings, visibile e raggiungibile solo dagli
    admin (404 agli altri); F8 la completa.
11. **Metriche**: `documents_awaiting_review` in `/api/metrics` (spec §10.4).
12. **Job**: `documents-retention` (giornaliero) e `payslips-sweep` (orario) in coda al registro.

### 8.3 Correzioni dopo la consegna

- Tornare dalla revisione al registro con la navigazione dell'app ("Payroll" nel breadcrumb o nella
  barra laterale) mostrava "Something went wrong": smontando il viewer si chiamava `destroy()` sul
  documento di pdf.js 6, che non ce l'ha. Ora si chiude il loading task; l'e2e torna al registro
  cliccando e fallisce su qualunque errore del browser (prima gli e2e ricaricavano sempre la pagina).

- **Il viewer perdeva le immagini JBIG2** (trovato il 2026-09-20 su un cedolino vero): pdf.js 6
  decodifica JBIG2 e JPEG 2000 attraverso i propri file WASM, e `scripts/copy-pdfjs.mjs` copiava
  solo il worker e i font standard. Senza `wasmUrl` la pagina si disegnava **senza il logo** e il
  browser registrava `#instantiateWasm: … Ensure that the wasmUrl API parameter is provided`. Ora lo
  script copia anche `wasm/` e il viewer passa `wasmUrl`; gli indirizzi stanno in un solo posto
  (`src/ui/pdf-assets.ts`) e `src/ui/pdf-assets.test.ts` verifica che lo script copi tutto quello che
  il viewer chiede. I gemelli sintetici non hanno immagini — per questo nessun test lo aveva visto:
  il difetto si vede solo sui cedolini della generazione con il logo (444 KB).

### 8.4 Resta al proprietario

- Caricare i 12 cedolini sul sito, rivederli e applicarli (il registro e i KPI si riempiono solo con
  quelli applicati).
- Configurare il fallback (Settings › Server: modello e chiave OpenAI) se lo vuole, e provarlo su un
  cedolino con un campo vuoto.
- Revisione visiva di registro e revisione rispetto al design.
- I commit.

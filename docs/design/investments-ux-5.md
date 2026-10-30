# Investments UX · U5 dialog, catalogo, Accounts e API

PERS-120 (30/10/2026), issue madre PERS-79. Regole: `docs/design/investments-ux.md` §3.7 e §8, con
l'obiezione 6 della review PERS-113 (anteprima dell'effetto sul P&L). U5 parte dal motore di PERS-145:
niente tratteggio, niente stime, niente riga "Altro". Il tratteggio di Overview previsto in §8 non
c'è più, perché PERS-145 lo ha tolto.

## Cosa c'è

- **Aggiungi asset** (D1, D2): la ricerca parte sulla classe e sulla valuta del conto (crypto ed EUR
  per Binance), nessun asset preselezionato, filtro "Valuta" nuovo. Su un servizio sincronizzato il
  prodotto è vuoto e da scegliere; i prodotti che il provider legge già sono disattivati, con la nota
  "Binance legge già … Aggiungi qui solo quello che Binance non vede, per esempio un wallet esterno".
  Su un servizio manuale il prodotto resta "custody", l'unico che ha. Regole pure in
  `modules/investments/ui/dialog-rules.ts`, con i test.
- **Collegamento al movimento bancario** (D3): la `select` mostra solo i candidati (stesso importo,
  entro 3 giorni); il campo "Cerca un movimento bancario" trova ogni movimento per beneficiario o
  conto. Il movimento già collegato resta sempre nella lista.
- **Correggi il valore** (D4): esempio nel testo ("eToro non ha letto 120 USD di liquidità dal 3 al 10
  marzo"), campi Importo, Dal, Al (facoltativo, "senza fine" spiegato), Motivo; la classe e
  l'anteprima dell'effetto sul P&L restano quelle di U3.
- **Trasferimenti** (PERS-113 · 6): la proposta dice che il collegamento non cambia nessun P&L.
- **Crea conto manuale** (D6): "Posizioni: una riga per asset, P&L per asset" / "Solo valore: aggiorni
  il totale a mano", ognuna con un esempio.
- **Catalogo** (C1, C2): sottotitolo con eToro e Binance; Kraken tolto; i provider non ancora
  collegabili sono in un `<details>` chiuso "In arrivo · N".
- **Accounts** (§8): un conto alimentato da un provider tramite Investments mostra "Synced with
  <provider>" e "Last synced" dall'ultima lettura del provider, non "Manual"
  (`syncedServicesOf` in `modules/investments/managed.ts`).
- **API e MCP**: `from`/`to` e `period` su `GET /api/v1/investments` e `list_investments` sono già
  arrivati con PERS-145 (`docs/api-changelog.md`, 30/10/2026). U5 aggiunge il test d'integrazione:
  il periodo è facoltativo, gli altri campi non cambiano, il P&L è quello del motore, l'MCP risponde
  uguale.
- **E2E**: la suite gira con `--disable-quic`. Causa del fallimento intermittente di "a withdrawal
  and a deposit between two services…" (e, a turno, di altri step): Chrome passa a HTTP/3 verso
  Cloudflare e da questo host una richiesta QUIC a volte si perde. La richiesta non arriva a Traefik
  (nessuna riga 499 nell'access log), il DB è fermo, la Server Action o la navigazione resta appesa e
  lo step va in timeout. Con HTTP/2 su TCP la richiesta persa viene ritrasmessa.

## Deploy e rollback

- Nessuna migrazione, `cron/` invariato: si ricostruisce solo `ledgerly`.
- Prima del deploy: `docker tag ledgerly:latest ledgerly:pre-ux-5`, `ledgerly-cron:pre-ux-5` e
  `pg_dump -Fc` in `backups/ledgerly/pre-ux-5.dump`.
- Rollback: `docker tag ledgerly:pre-ux-5 ledgerly:latest && docker compose up -d --no-build ledgerly`.
  Nessun dato da ripristinare.

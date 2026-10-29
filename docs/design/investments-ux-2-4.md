# Investments UX · U4 e rilascio unico di U2–U4

PERS-119 (29/10/2026), issue madre PERS-79. Regole: `docs/design/investments-ux.md` §3.4, §4.2, §4.7,
con le obiezioni accettate della review PERS-113 (1, 4, 5, 9). U4 chiude il ramo di integrazione
`feat/investments-ux` (U2 PR #26, U3 PR #27, U4): il rilascio porta in `main` home, servizio a tab e
posizioni insieme, senza flag, e toglie la UI vecchia nello stesso deploy (§10).

## Cosa c'è (U4)

- **Migrazione additiva `0041_reading_cost`**: `cost_cents bigint` nullable su
  `investment_reading_positions`. Le letture già scritte restano `null`.
- **eToro**: il sync salva come costo l'`amount` investito di ogni posizione, al cambio del conto
  trading della lettura (lo stesso del valore): valore − costo è il P/L di eToro. Le monete del conto
  crypto di eToro non hanno costo.
- **Motore** (`pnl.ts`): `positionsOn(book, d, …)` dà le posizioni aperte a fine `d` con valore e
  costo, anche per i conti sincronizzati. La variazione del non realizzato è per posizione:
  `U(e) − U(s⁻)` dove il costo è noto; il resto resta in "Altro (dati incompleti)", additivo.
- **Tab Posizioni** (`[accountId]/positions`): `Aperte | Chiuse nel periodo | Tutte le chiuse`
  (`status`), "Contributi al P&L" con aperte e vendute che chiudono sul P&L della Panoramica, residui
  senza mercato in un `<details>`. Un periodo passato mostra le posizioni al suo ultimo giorno, con il
  link a quelle di oggi (PERS-113 · 4). "% sul costo" (dall'acquisto) è separata dal rendimento del
  periodo (contributo ÷ valore a `s⁻`, o costo se acquistata dopo).
- **Panoramica**: "Posizioni principali" diventa "Contributi principali": le 5 posizioni che hanno
  pesato di più sul periodo, anche vendute (PERS-113 · 9).
- Tolti `investmentHistory` e `window.ts`, usati solo dai test (input di U3).

## Decisioni di implementazione

- **Da dove viene il costo**, in ordine: il provider (eToro `amount`); il replay dei trade quando la
  quantità ricostruita è quella letta, a un milionesimo (Binance, arrotondamenti dell'exchange); una
  lettura successiva con la **stessa quantità** e un costo salvato (badge "Costo da una lettura
  successiva": il costo medio cambia solo con la quantità). Altrimenti `null`, mai una stima.
- **Lettura senza posizioni**: un giorno dello storico eToro o uno stimato di Binance ha il totale e
  nessuna posizione né cassa. Le sue posizioni sono **sconosciute**, non assenti: la variazione del
  non realizzato con quel giorno come base va in "Altro". Una lettura vuota con totale zero
  (`confirmed_zero`) vuol dire "niente".
- **Binance in produzione** ha `quantity_mismatch`: le monete i cui trade non tornano con la quantità
  letta restano senza costo, le altre hanno il costo dei trade (§4.7).
- La Cassa delle posizioni è la cassa letta dal provider (eToro, Binance) o quella del libro (manuale).
- Non fatto: "Raggruppa per Asset | Classe" del mockup `05` (non nei criteri di U4).

## Rilascio unico U2–U4

1. Merge di `feat/investments-ux` in `main` (U2, U3, U4).
2. `docker tag ledgerly:latest ledgerly:pre-ux-2-4` e `docker tag ledgerly-cron:latest ledgerly-cron:pre-ux-2-4`.
3. `pg_dump -Fc` di `ledgerly` in `../../backups/ledgerly/pre-ux-2-4.dump`.
4. `docker compose build ledgerly && docker compose up -d --wait ledgerly` (`cron/` non cambia):
   l'entrypoint applica `0040_adjustment_class` e `0041_reading_cost`, entrambe additive.
5. `npm run e2e` sul sito: percorso home → servizio → posizioni, somma Posizioni = Panoramica, a11y e
   tastiera di tutte le schermate nuove.

## Rollback

1. `docker tag ledgerly:pre-ux-2-4 ledgerly:latest`, poi `docker compose up -d --no-build ledgerly`:
   l'immagine di prima non legge le due colonne nuove, che possono restare.
2. Facoltativo, se il rilascio non torna a breve: `docs/design/investments-ux-2-4-rollback.sql` toglie
   le colonne di 0040 e 0041 e le loro righe del journal (perde le classi delle correzioni e i costi
   eToro salvati da allora; il sync successivo li riscrive dopo un nuovo deploy).
3. Ultima risorsa: `pg_restore --clean --if-exists` di `pre-ux-2-4.dump`.

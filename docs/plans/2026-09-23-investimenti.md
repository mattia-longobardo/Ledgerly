# Investimenti — piattaforme di trading, depositi e ritiri

> Richiesta del proprietario (2026-09-23): una pagina dove controllare gli investimenti, con uno
> storico, depositi e ritiri collegabili (o no) a un'entrata o un'uscita di un conto senza toccare
> il saldo, piattaforme aggiunte dall'utente con un link al loro sito, e statistiche. Il foglio che
> il proprietario teneva a mano non si importa: il proprietario non vuole il tasto (2026-09-23),
> i movimenti si registrano dalla pagina.

## 1. Cosa c'è

- **Modulo** `src/modules/investments` — `rules.ts` (validazione e statistiche),
  `schema.ts`, `service.ts`, `queries.ts`, `actions.ts`, `ui/investment-actions.tsx`.
- **Pagina** `/investments` (voce «Investimenti» nel gruppo Finanza, non nella barra mobile).
  `?platform=` restringe KPI, grafico e storico a una piattaforma e mostra il suo dettaglio.
- **Tabelle** (migrazione `0023_investments`):
  - `investment_platforms` — nome unico per persona, `url` facoltativo e solo `http(s)`.
  - `investment_movements` — `kind` deposito/ritiro, importo sempre positivo, `on`,
    `transaction_id` facoltativo (FK `on delete set null`, unico: un movimento bancario documenta
    un solo movimento di piattaforma). La migrazione `0024` toglie la colonna `sheet_key` che
    serviva all'import CSV, rimosso su richiesta del proprietario.
  - `investment_valuations` — il valore della piattaforma a fine giornata, uno per giorno.
- **Transazioni**: una sola funzione nuova, `linkCandidates` in `transactions/queries.ts` — i
  movimenti visibili in uscita (per un deposito) o in entrata (per un ritiro), giroconti compresi.
- **Export dati**: due sezioni, `investment-platforms` e `investment-movements`.

## 2. Decisioni

1. **Nessun saldo cambia.** Il collegamento è un riferimento: né il conto, né il patrimonio netto,
   né i totali delle spese lo leggono. Il test d'integrazione lo verifica sul saldo del conto.
2. **Il valore è dichiarato, non calcolato.** Nessuna quotazione dall'esterno: la persona legge il
   valore sulla piattaforma e lo registra («Aggiorna valore»). Il valore di oggi è l'ultima
   valutazione più i depositi e meno i ritiri successivi (mai sotto zero), marcato «stima» quando
   ci sono movimenti dopo la valutazione. Senza nessuna valutazione il valore è **sconosciuto**
   (`null`, «—»), mai zero, e il totale del portafoglio diventa sconosciuto con lui (§4.3 della
   spec: una somma a cui manca un termine è un numero sbagliato con la forma di uno giusto).
3. **Statistiche**: versato, ritirato, investito netto (versato − ritirato), valore, guadagno
   (valore + ritirato − versato), rendimento (guadagno ÷ versato), quota del portafoglio. Una
   piattaforma chiusa si registra con valore 0: il guadagno diventa quanto è tornato in più.
4. **Direzione del collegamento**: un deposito si collega solo a denaro uscito dal conto, un ritiro
   solo a denaro entrato. Il selettore propone prima gli importi uguali, poi le date più vicine.
5. **Eliminazioni**: piattaforma, movimento e valutazione chiedono conferma; eliminare una
   piattaforma elimina il suo storico e il messaggio dice quanti movimenti sono andati.

## 3. Test

- Unit: `rules.test.ts` (statistiche, valore stimato, storico mensile, URL).
- Integrazione: `service.itest.ts` (collegamento e direzione, unicità, saldo invariato, FK che
  dimentica il collegamento, isolamento fra utenti, eliminazione con conteggio).
- E2E: `investments.spec.ts` (utente `investments@example.test`), e in `a11y.spec.ts` la pagina,
  la pagina filtrata e il dialog del nuovo movimento, misurati sull'utente `layout`.

## 4. Resta al proprietario

- Inserire i movimenti del proprio `Investements.csv` dalla pagina e registrare il valore
  attuale di ogni piattaforma: finché manca, valore e guadagno restano «—».
- Il file `Investements.csv` alla radice non entra nel repository (dati reali).

# Investments · storico, selettore del periodo e dust

PERS-100, dopo il collegamento di eToro e Binance (28/10/2026). Decisioni di Mattia: eToro resta in
USD; lo storico di Binance si ricostruisce, dicendo che è una stima; ETHW senza mercato è dust.

## Cosa cambia

| Punto | Dove | Effetto |
|---|---|---|
| Selettore del periodo | `ui/history-card.tsx`, `window.ts`, `queries.ts` `investmentHistory` | Il grafico "Valore e versato netto" di `/investments` e di `/investments/[accountId]` ha i controlli di Overview (spec §7.1, F2.5): ultimo anno di default, 3M · 1Y · All, intervallo di mesi personalizzato (`from`/`to`), punti per mese o per giorno (`grain=day`, al massimo gli ultimi 366 giorni). I mesi prima della prima `period` sono tolti. I valori sono i saldi `portfolio` giorno per giorno (`dailyBalancesOf`), il versato i flussi fino a quel giorno |
| Storico stimato | `history.ts`, `sync.ts` `estimateHistoryOf`, `ccxt/source.ts` `fetchDailyRates` | Per un servizio collegato nuovo il cui provider non dà lo storico del valore (Binance): dopo i flussi, una volta sola, ogni giorno dal primo flusso al giorno prima della prima lettura riceve una lettura `estimated`. Le quantità partono dalla prima lettura e vanno all'indietro togliendo i movimenti; ogni moneta è valutata alla chiusura giornaliera dell'exchange (§1.8, l'ultima chiusura precedente se un giorno manca); la cassa in EUR segue le gambe senza holding e i trade contro EUR; una quantità sotto zero conta zero. La `period` di apertura, `managed_since`, `opened_on` del servizio e del conto vanno al primo flusso; la copertura `balance_history` diventa `partial` / `estimated` |
| Stima visibile | `MultiLine` (`estimated`), pagina del servizio | Il tratto stimato è tratteggiato, il tooltip dice "stima" e sotto il grafico c'è la nota; le letture `estimated` hanno lo stato "Stima" |
| Dust | `rules.ts` `isUnpricedDust`, `missingPricesOf` | Una posizione senza prezzo sotto 0,001 unità non conta come prezzo mancante (né nella lettura né negli avvisi) e nella tabella si legge "residuo, nessun mercato". ETHW non ha mercati su Binance (`ETHWUSDT`, `ETHWEUR`, `ETHWBTC`, `ETHWETH`: simbolo non valido al 28/10/2026) |

## Migrazione `0039_investment_estimated`

Additiva: lo stato `estimated` nel check di `investment_readings.status`, e `missing_prices`
ricalcolato senza il dust sulle letture che ne avevano.

## Deploy

1. `docker tag ledgerly:latest ledgerly:pre-investments-history` e
   `docker tag ledgerly-cron:latest ledgerly-cron:pre-investments-history`.
2. `pg_dump -Fc` di `ledgerly` in `../../backups/ledgerly/pre-investments-history.dump`.
3. `docker compose build ledgerly && docker compose up -d --wait ledgerly` (`cron/` non cambia).
4. Lo storico di Binance arriva al pass successivo (07:30 o 22:30) o con "Sincronizza ora".

## Rollback

1. `docs/design/investments-history-rollback.sql`: toglie le letture stimate e i punti `portfolio`
   prima della prima lettura reale, riporta la `period` di apertura e le date a quella lettura e
   rimette il check di prima. `accounts.opened_on` resta: è solo informativo.
2. `docker tag ledgerly:pre-investments-history ledgerly:latest`, poi
   `docker compose up -d --no-build ledgerly`.
3. Ultima risorsa: `pg_restore --clean --if-exists` del dump.

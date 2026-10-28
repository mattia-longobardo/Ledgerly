# Investments · correzioni della security review PERS-87

PERS-99: correzioni dei finding SEC-01, 02, 03, 04 e 06 della review PERS-87 sulle fasi 3–5.
SEC-05 (`investments:read` ai client DCR) è un rischio accettato e non cambia.

## Cosa cambia

| Finding | Dove | Effetto |
|---|---|---|
| SEC-01 | `sync.ts` `takeKeyAttempt` | "Collega" e "Sostituisci chiave" insieme: al massimo 5 tentativi ogni 10 minuti per persona e provider (`KEY_ATTEMPTS`), poi `SyncError("cooldown")` senza nessuna chiamata al provider. Conta ogni tentativo che arriva alla rete; un errore di schema delle chiavi non conta. In memoria, come il rate limit dell'API: un riavvio lo azzera |
| SEC-02 | `ui/key-check.tsx`, pagina del servizio, `ConnectDialog` | Con `ip_restricted = false` (Binance `ipRestrict`): badge "IP non limitato" accanto all'ultima verifica della chiave e, dopo il collegamento, il dialog dice che la chiave funziona da qualsiasi IP prima di aprire il servizio. `null` (eToro: l'API non lo dice) non mostra niente |
| SEC-03 | `sync.ts` `replaceKey` | La lettura di prova della nuova chiave deve venire dallo stesso conto esterno (eToro `gcid`, Binance `uid`) dell'ultima lettura (`investment_reading_scopes.external_account_id`); altrimenti `SyncError("different_account")` e la chiave vecchia resta. Senza letture precedenti si accetta |
| SEC-04 | `Dockerfile` | `npm ci --ignore-scripts`. Nessun pacchetto ha bisogno del suo script: esbuild, `@swc/core`, `@parcel/watcher` e `bufferutil` trovano il binario nella dipendenza opzionale; il `postinstall` di ccxt stampa solo un banner. `npm run build` e il passo esbuild del Dockerfile falliscono se un binario manca |
| SEC-06 | `sync.ts` `noteFailure`, `etoro/source.ts` | Revoca solo su 401 o su 403 della verifica della chiave (eToro `/me`, Binance `apiRestrictions`). Un 403 su `/market-data/instruments` costa solo i nomi: la lettura è `partial`. Un 403 su un'altra lettura (`/balances`, portafoglio) è un pass `failed`, senza revoca |

Nessuna migrazione.

## Deploy

1. `docker tag ledgerly:latest ledgerly:pre-investments-secfix` e
   `docker tag ledgerly-cron:latest ledgerly-cron:pre-investments-secfix`.
2. `docker exec postgres pg_dump -Fc -U ledgerly ledgerly > ../../backups/ledgerly/pre-investments-secfix.dump`.
3. `docker compose build ledgerly && docker compose up -d --wait ledgerly` (`cron/` non cambia).

## Rollback

1. `docker tag ledgerly:pre-investments-secfix ledgerly:latest`, poi `docker compose up -d --no-build ledgerly`.
2. Nessun dato da ripristinare: il dump `backups/ledgerly/pre-investments-secfix.dump` resta solo
   come ultima risorsa (`pg_restore --clean --if-exists`).

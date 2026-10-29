# Investments UX · U1 — motore P&L per periodo

PERS-116 (29/10/2026), issue madre PERS-79. Regole: `docs/design/investments-ux.md` §4, con le
obiezioni accettate della review PERS-113. **Nessuna UI, nessuna migrazione**: niente cambia in
produzione finché il rilascio unico di U2–U4 non usa il motore (§10).

## Cosa c'è

- `src/modules/investments/pnl.ts` (puro): `periodOf`, `replayHoldings` (costo medio con il costo
  uscito; eToro per `positionId`), `pnlOf` (§4.1–§4.6, §4.9), `modifiedDietz`, `portfolioPnl` (§4.8).
- `investmentsPnl(ctx, period)` in `queries.ts`: il motore sui servizi vivi della persona, con la
  copertura dei flussi, gli id del provider e i cambi dal primo giorno misurato.
- `rules.ts` esporta `eventsOn`, `periodIndexOf` e `sortedPeriods`, senza cambiarli.

## Decisioni di implementazione

- Ogni stream `quantities` non completo (`quantity_mismatch` o `negative_opening`) rende lo storico
  stimato una base non affidabile (§4.6): oggi Binance in produzione ha la quantità che non torna e lo
  storico stimato, quindi il suo P&L parte dal giorno dopo la prima lettura vera.
- Le commissioni sono sempre una parte a sé, mai nel costo di un acquisto (§4.4): un trade Binance ha
  la gamba fee separata.
- Un'uscita di quantità superiore a quella mai tenuta non ha costo noto: il suo realizzato non entra
  nel KPI e resta in "Non attribuito".
- La classe delle rettifiche (§4.9) è un input del motore; finché U3 non la salva vale `data`.

## Deploy

1. `docker tag ledgerly:latest ledgerly:pre-ux-1` e `docker tag ledgerly-cron:latest ledgerly-cron:pre-ux-1`.
2. `pg_dump -Fc` di `ledgerly` in `../../backups/ledgerly/pre-ux-1.dump`.
3. `docker compose build ledgerly && docker compose up -d --wait ledgerly` (`cron/` non cambia).

## Rollback

Nessun dato cambia: `docker tag ledgerly:pre-ux-1 ledgerly:latest`, poi
`docker compose up -d --no-build ledgerly`. Il dump serve solo come ultima risorsa
(`pg_restore --clean --if-exists`).

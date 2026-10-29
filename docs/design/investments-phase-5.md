# Investments · fase 5: esposizione e rendimento

PERS-86, fase 5 del piano di `docs/design/investments.md` (§7): rendimento semplice + XIRR con la
regola di completezza (§2.4, D8), trasferimenti tra i servizi, scope `investments:read`, tool MCP
`list_investments` e `get_investment_holdings`, endpoint `/api/v1/investments`, export aggiornato
(§5.5, SEC-08). **Escluso**: il drop delle tabelle legacy (`0039_drop_legacy_investments`), che
resta un'issue separata dal 27/11/2026 (30 giorni dalla fase 2).

## Cosa cambia

| Punto | Dove | Effetto |
|---|---|---|
| XIRR | `src/modules/investments/xirr.ts` | Funzione pura: VAN scandito su [−99 %, +1000 %] (4000 punti in log(1 + r)); nessun cambio di segno → `none`, più di uno → `multiple` (entrambi "non calcolabile"), uno → bisezione. Unico punto del modulo in virgola mobile: un tasso è un rapporto, mai un importo |
| Flussi datati | `rules.ts` | `flowEntriesOn` (apertura, depositi, prelievi con giorno e `transfer_group_id`), `sumFlows`, `investorFlows`; `flowsOn` invariato nei numeri |
| Conto | `queries.ts` `summaryOf` | `xirr` per servizio nella valuta del conto, solo se il rendimento è attendibile (manuale, o copertura dei flussi `complete`) |
| Portafoglio | `queries.ts` `portfolioState` | Flussi esterni: le gambe di un trasferimento escono solo se entrambe sono tra i servizi attivi. Ogni flusso nella valuta di visualizzazione al cambio del suo giorno, il valore al cambio di oggi (§2.4). Versato netto, guadagno, rendimento semplice e XIRR; `fxEffect` se un servizio è in un'altra valuta. Prima la conversione usava il cambio di oggi per tutti i flussi |
| Trasferimenti | `service.ts`, `rules.ts` `transferProposals` | Proposta: prelievo e deposito in due servizi, stesso asset e quantità (o stesso importo e valuta), entro 3 giorni, nessuna gamba già collegata; ogni gamba con il partner più vicino. `linkTransfer` rifà gli stessi controlli e scrive lo stesso `transfer_group_id` sui due eventi sotto lock; `unlinkTransfer` lo toglie. Cancellare una gamba libera l'altra. Nessun punto `portfolio` riscritto: il valore dei conti non cambia |
| Scope | `src/platform/auth/scopes.ts`, `oauth.ts` | `investments:read` in `API_SCOPES`, separato da `read`. Metadati RFC 9728 dell'MCP: `read`, `investments:read`. DCR: ammesso, default sempre `read`; la pagina di consenso lo nomina |
| API | `src/modules/investments/api.ts` | `GET /api/v1/investments`, `GET /api/v1/investments/{accountId}/holdings`, entrambi `investments:read`. Risposte costruite campo per campo: niente chiave, verifica della chiave, stato o `last_error` della connessione, id esterni |
| MCP | `src/platform/mcp/tools.ts`, `handler.ts` | `list_investments` e `get_investment_holdings` solo con `investments:read`; un token con solo `investments:read` entra e vede solo questi due |
| Export | `src/platform/export/service.ts` | `investment-services`: `invested`, `gain`, `simpleReturn`, `xirr` (tasso, oppure `none`/`multiple`), `reliableFrom`. `investment-operations`: `transferWith` |
| UI | home e pagina del servizio | KPI XIRR (sostituisce il conteggio dei servizi nella home, §4.1); nota "effetto cambio incluso"; card "Trasferimenti da confermare" con "Collega come trasferimento"; "Trasferimento · <servizio>" e "Scollega trasferimento" sull'operazione; en/it |

Nessuna migrazione: `investment_events.transfer_group_id` esiste dalla `0037`.

## Interpretazioni dove il design non decide

- **Gamba orfana.** Un evento con `transfer_group_id` la cui controparte non c'è (cancellata o in un
  servizio archiviato) per il portafoglio è un flusso esterno. `deleteOperation` libera comunque
  l'altra gamba.
- **Collegamento solo su proposta.** `linkTransfer` accetta solo una coppia che la proposta farebbe
  (3 giorni, stesso importo): un trasferimento più lento non si collega. Si allarga se serve.
- **Importo per la proposta.** Per la cassa conta `native_amount`/`native_currency` della gamba se
  presenti, altrimenti l'importo nella valuta del conto; per un asset l'asset e la quantità.
- **XIRR senza tempo.** Flussi tutti nello stesso giorno con un guadagno ≠ 0: nessun tasso li
  risolve, `none` ("non calcolabile").
- **API.** I rendimenti sono rapporti con 6 decimali (`0.05` = 5 %); `xirrStatus` dice perché manca
  (`unavailable` = storico non completo o valore ignoto).

## Deploy

1. `docker tag ledgerly:latest ledgerly:pre-investments-5` e
   `docker tag ledgerly-cron:latest ledgerly-cron:pre-investments-5`.
2. `docker exec postgres pg_dump -Fc -U ledgerly ledgerly > ../../backups/ledgerly/pre-investments-5.dump`.
3. `docker compose build ledgerly && docker compose up -d --wait ledgerly` (`cron/` non cambia).

All'avvio il plugin OAuth riscrive le risorse (`resourceSeedMode: "overwrite"`): la risorsa MCP
accetta `investments:read`.

## Rollback

1. `docker tag ledgerly:pre-investments-5 ledgerly:latest`, poi `docker compose up -d --no-build ledgerly`.
   L'immagine precedente riscrive le risorse OAuth senza `investments:read`; uno scope
   `investments:read` già concesso a un client viene ignorato (`API_SCOPES` lo filtra).
2. Facoltativo: `docker exec -i postgres psql -U ledgerly ledgerly -v ON_ERROR_STOP=1 < docs/design/investments-phase-5-rollback.sql`
   toglie i collegamenti dei trasferimenti fatti dopo il deploy. L'immagine precedente non li legge,
   quindi lasciarli non cambia nessun numero.
3. Ultima risorsa: `pg_restore --clean --if-exists` da `backups/ledgerly/pre-investments-5.dump`.

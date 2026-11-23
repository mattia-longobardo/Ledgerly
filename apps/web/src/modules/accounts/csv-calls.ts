// The import of a CSV file of movements on an account «a mano» (rewrite plan R5c, decision ST-8): the
// calls to `/api/v1/accounts/{id}/csv/…`. The server reads the file and writes the movements; the
// dialog only shows what it answers.
// shortcut: the root entry of the contract, as `@ledgerly/api-contract/transactions` does not list
// `csv` yet; move to that entry when the contract adds it.
import { CSV_MAX_BYTES, TRANSACTIONS } from "@ledgerly/api-contract";
import { views } from "@ledgerly/api-contract/accounts";
import { categoryBoard } from "@ledgerly/api-contract/settings";
import { movements, review, spending } from "@ledgerly/api-contract/transactions";
import { ApiError, call, type RouteOutput } from "@ledgerly/api-client";
import { invalidate } from "@ledgerly/ui/data";

const { csv } = TRANSACTIONS;

export type CsvPreview = RouteOutput<typeof csv.previewCsv>;
export type CsvMap = NonNullable<CsvPreview["proposedMap"]>;
export type CsvImported = RouteOutput<typeof csv.importCsv>;
type Refused = { ok: false; error: string };

/** The route's code: the reason of a refusal, or the refusal itself; a failure of the server throws. */
function refusal(error: unknown): Refused {
  if (error instanceof ApiError && error.status < 500)
    return { ok: false, error: error.reason ?? error.code };
  throw error;
}

/** What an import changes: the movements, the balances of the account and Overview. */
function changed(): void {
  invalidate(
    movements.getTransactionsView,
    movements.listTransactions,
    spending.getSpending,
    spending.getSpendingBreakdown,
    spending.getSpendingSeries,
    review.getReview,
    views.getNetWorth,
    views.getNetWorthDaily,
    views.getAccountDailyBalances,
    categoryBoard.getCategoriesBoard,
  );
}

/** Reads the file and writes nothing: its columns, the maps and the first rows read with one. */
export async function previewCsv(
  accountId: string,
  file: File,
): Promise<{ ok: true; preview: CsvPreview } | Refused> {
  // The same limit the route has, said before the file travels.
  if (file.size > CSV_MAX_BYTES) return { ok: false, error: "too_large" };
  try {
    return { ok: true, preview: await call(csv.previewCsv, { params: { id: accountId }, body: { file } }) };
  } catch (error) {
    return refusal(error);
  }
}

/** Writes the rows of the file as movements of the account; `save` keeps the map for the next file. */
export async function importCsv(
  accountId: string,
  file: File,
  map: CsvMap,
  save: boolean,
): Promise<{ ok: true; result: CsvImported } | Refused> {
  try {
    const result = await call(csv.importCsv, {
      params: { id: accountId },
      body: { file, map: JSON.stringify(map), saveMap: save ? "true" : "false" },
    });
    changed();
    return { ok: true, result };
  } catch (error) {
    return refusal(error);
  }
}

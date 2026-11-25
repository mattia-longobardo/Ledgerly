// Transactions · the import of a CSV file on an account «a mano» (decision ST-8). The routes join
// the two modules as the dialog of a manual movement does (rule M8): accounts says whether the
// account is «a mano» and rebuilds its balance, transactions reads the file and writes the rows.
import type { Hono } from "hono";
import { TRANSACTIONS } from "@ledgerly/api-contract";
import { accountMode, getAccount, rebuildDerivedBalances } from "@ledgerly/domain/accounts";
import { CsvError, csvMapOf, importCsv, previewCsv, saveCsvMap } from "@ledgerly/domain/transactions";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";
import { refusing, type TransactionCases } from "./cases";

const { csv } = TRANSACTIONS;

/**
 * Refuses an account that is not the person's, is archived, or has a source: only an account «a
 * mano» takes a file. A source's capabilities do not matter here: any source makes it another mode.
 */
async function requireManualAccount(ctx: Ctx, id: string): Promise<void> {
  const account = await getAccount(ctx, id);
  if (!account) throw new ApiRefusal("not_found");
  if (account.state === "archived") throw new ApiRefusal("conflict", "account_unavailable");
  const source = account.provider === null ? null : { createsRecords: false };
  if (accountMode(account, source) !== "manual") throw new ApiRefusal("conflict", "account_not_manual");
}

/** A refusal of the file as the contract answers it. */
async function readingFile<T>(work: Promise<T>): Promise<T> {
  try {
    return await refusing(work);
  } catch (error) {
    if (!(error instanceof CsvError)) throw error;
    if (error.code === "empty") throw new ApiRefusal("invalid", "empty");
    throw new ApiRefusal("too_large", error.code === "too_many_rows" ? error.code : undefined);
  }
}

const bytesOf = async (file: File) => new Uint8Array(await file.arrayBuffer());

export function serveCsv(app: Hono<ApiEnv>, guard: Guard, cases: TransactionCases): void {
  serve(app, guard, csv.previewCsv, async ({ ctx, params, body }) => {
    await requireManualAccount(ctx, params.id);
    return readingFile(previewCsv(ctx, params.id, await bytesOf(body.file), body.map));
  });
  serve(app, guard, csv.importCsv, async ({ ctx, params, body }) => {
    await requireManualAccount(ctx, params.id);
    if (body.saveMap === "true") await refusing(saveCsvMap(ctx, params.id, body.map));
    const outcome = await readingFile(importCsv(ctx, params.id, await bytesOf(body.file), body.map));
    if (outcome.created > 0) {
      // The balance as after a movement written by hand. A row with no category gets the automatic
      // categories' pass: the dialog suggests one before it saves, a file cannot.
      await rebuildDerivedBalances(ctx, [params.id], { manualChanged: true });
      await cases.learn(ctx, true);
    }
    return outcome;
  });
  serve(app, guard, csv.getCsvMap, async ({ ctx, params }) => {
    await requireManualAccount(ctx, params.id);
    return { map: await csvMapOf(ctx, params.id) };
  });
  serve(app, guard, csv.saveCsvMap, async ({ ctx, params, body }) => {
    await requireManualAccount(ctx, params.id);
    return { map: await refusing(saveCsvMap(ctx, params.id, body)) };
  });
}

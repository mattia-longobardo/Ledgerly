/**
 * `node /app/worker.mjs --import-labels <file> --user <id>` (decision 13A, 2026-11-25): once, the
 * release reads a person's export of the app they used before as labels the automatic categories
 * learn from — no screen, no route. `-` reads the file from stdin, so the export never has to be
 * copied into the container. A row that is one movement here gives it the export's category. It
 * prints the counts and nothing else, then queues the training the running worker does.
 */
import { createReadStream } from "node:fs";
import { enqueue } from "@ledgerly/domain/platform/jobs";
import { importCategoryLabels, LABELS_MAX_BYTES, LabelsImportError } from "@ledgerly/domain/transactions";
import { contextFor, personById } from "@ledgerly/domain/users";
import { tasks } from "@ledgerly/web/jobs";
import { readCapped } from "./read-capped";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const valueOf = (argv: readonly string[], flag: string) => {
  const place = argv.indexOf(flag);
  return place === -1 ? undefined : argv[place + 1];
};

export async function importLabels(argv: readonly string[]): Promise<number> {
  const file = valueOf(argv, "--import-labels");
  const user = valueOf(argv, "--user");
  if (file === undefined || user === undefined || !UUID.test(user)) {
    console.error("usage: node /app/worker.mjs --import-labels <file|-> --user <user id>");
    return 2;
  }
  const person = await personById(user);
  if (person === null) {
    console.error("no user with that id");
    return 1;
  }
  const ctx = await contextFor(person);
  // Never more than one byte past the limit: an oversized file is refused as `too_large` unread.
  const input = file === "-" ? process.stdin : createReadStream(file);
  const bytes = new Uint8Array(await readCapped(input, LABELS_MAX_BYTES));
  let outcome;
  try {
    outcome = await importCategoryLabels(ctx, bytes);
  } catch (error) {
    if (!(error instanceof LabelsImportError)) throw error;
    console.error(`refused: ${error.code}`);
    return 1;
  }
  if (outcome === null) {
    console.error("refused: the columns are not those of an export");
    return 1;
  }
  await enqueue(tasks.categorise(ctx.userId, true));
  console.log(outcome);
  return 0;
}

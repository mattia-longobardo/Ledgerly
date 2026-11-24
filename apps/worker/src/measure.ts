/**
 * `node /app/worker.mjs --measure-categories` (rewrite plan R6, "Misura prima/dopo"): the cascade
 * of today and the one with the embedding model, graded on every person's confirmed labels, read
 * only. It prints the sums and nothing else: no text, id or amount of a movement, no person.
 */
import { measureCategories, type Embedder, type Measure, type Tally } from "@ledgerly/domain/transactions";
import { forEachUser } from "@ledgerly/domain/users";

const tally = (): Tally => ({ graded: 0, automatic: 0, automaticRight: 0, suggested: 0, suggestedRight: 0 });

function add(into: Tally, from: Tally): void {
  into.graded += from.graded;
  into.automatic += from.automatic;
  into.automaticRight += from.automaticRight;
  into.suggested += from.suggested;
  into.suggestedRight += from.suggestedRight;
}

/** Coverage and precision of a tally, rounded: what the acceptance of R6 reads. */
function rates(one: Tally) {
  const share = (part: number, whole: number) =>
    whole === 0 ? null : Math.round((part / whole) * 1000) / 1000;
  return {
    ...one,
    automaticCoverage: share(one.automatic, one.graded),
    automaticPrecision: share(one.automaticRight, one.automatic),
    suggestedCoverage: share(one.suggested, one.graded),
    suggestedPrecision: share(one.suggestedRight, one.suggested),
  };
}

/** The sums over every person, as one JSON line. */
export async function measureAll(embedder: Embedder): Promise<string> {
  const sum: Measure = {
    labels: 0,
    today: { all: tally(), unseen: tally() },
    withModel: { all: tally(), unseen: tally() },
  };
  let measured = 0;
  const { users, failed } = await forEachUser("measure-categories", async (_person, ctx) => {
    const one = await measureCategories(ctx, embedder);
    measured += 1;
    sum.labels += one.labels;
    for (const side of ["today", "withModel"] as const) {
      add(sum[side].all, one[side].all);
      add(sum[side].unseen, one[side].unseen);
    }
  });
  return JSON.stringify({
    model: embedder.revision,
    users,
    measured,
    failed,
    labels: sum.labels,
    today: { all: rates(sum.today.all), unseen: rates(sum.today.unseen) },
    withModel: { all: rates(sum.withModel.all), unseen: rates(sum.withModel.unseen) },
  });
}

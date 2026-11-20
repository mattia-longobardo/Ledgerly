// scripts/perf-compare.ts — the second half of `npm run perf`: holds the samples of
// `scripts/perf-probe.ts` to `baselines/performance.json` (rewrite plan, 10-modularity.md §10.9;
// gate G9). A view or a route may not send more queries than its baseline, and its median time may
// not be more than 10% worse. `npm run perf -- --write` records a new baseline — after a measured
// improvement, or with a decision that accepts a cost; never to make a slower step pass.
//
//   node --import tsx scripts/perf-compare.ts [--write | --queries] <sample.json> [<sample.json> …]
//
// `--queries` holds the number of queries only: it is what one process can say, and it is the part
// of the gate that runs at every release (docs/testing.md).
//
// Each sample is one process. The measure of a view is its best median over the samples, because
// what moved the figures was the process and not the run: the same code over the same data gave one
// process 45 ms for the widest view and the next one 55, each steady from its first run to its last
// (the collector and the compiler of the runtime settle differently every time it starts). More runs
// in one process do not average that out; more processes do. A step that is really slower is slower
// in every process, so the best of them still shows it. The queries are exact and must agree.
//
// A sample named `ref-<n>.json` is of the reference version (the last release), taken by
// `scripts/perf-on-test.sh` in turn with the code's. The views in `ALTERNATED` are held to it and
// not to the baseline: their time moves with the host and the database by more than 10% from one
// session to the next, so only a reference measured in the same minutes says what the code changed.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const BASELINE = "baselines/performance.json";
/** A median this many ms over its baseline is noise, whatever the percentage says. */
const NOISE_MS = 3;
const WORSE = 1.1;
/**
 * Slower times Mattia accepted, each until the step that has to take it back (a written decision,
 * not a baseline): the time is printed and not held, the queries still are. The step named here
 * removes its entry; a later run that still needs it asks again.
 */
const ACCEPTED_TIMES: Record<string, string> = {};
/**
 * The measures held to the reference of the same session, not to the file: the views whose time the
 * collector decides (perf-probe.ts, `fromCleanHeap`), and those whose time moves with the host. One
 * joins only when the reference of the same session gives its time within 10% (the reference's
 * threshold stays 10%): Overview and GET /investments, 20/11/2026 (v0.43.0 60.3 and 24.6 ms against
 * 60.2 and 25.0, the release not touching investments).
 */
const ALTERNATED = new Set(["expensesView (tre anni)", "Overview", "GET /investments"]);

type Measure = { medianMs: number; p95Ms: number; queries: number };
type Group = Record<string, Measure>;
type Sample = { heavyUser: unknown; views: Group; routes: Group };

const write = process.argv.includes("--write");
const queriesOnly = process.argv.includes("--queries");
if (write && queriesOnly) throw new Error("--queries measures no time: it cannot write a baseline");
const files = process.argv.slice(2).filter((one) => !one.startsWith("--"));
if (files.length === 0) throw new Error("usage: perf-compare.ts [--write] <sample.json> …");
const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Sample;
const isReference = (file: string) => basename(file).startsWith("ref-");
const samples = files.filter((file) => !isReference(file)).map(read);
const references = files.filter(isReference).map(read);

/** The best median of every measure, with the p95 of the same sample and the most queries seen. */
function best(group: "views" | "routes", samples: readonly Sample[]): Group {
  const result: Group = {};
  for (const sample of samples) {
    for (const [name, measure] of Object.entries(sample[group])) {
      const held = result[name];
      const queries = Math.max(measure.queries, held?.queries ?? 0);
      result[name] =
        held === undefined || measure.medianMs < held.medianMs
          ? { ...measure, queries }
          : { ...held, queries };
    }
  }
  return result;
}
const measured = { views: best("views", samples), routes: best("routes", samples) };
const reference = { views: best("views", references), routes: best("routes", references) };

const baseline = (() => {
  try {
    return JSON.parse(readFileSync(BASELINE, "utf8")) as typeof measured;
  } catch {
    return null;
  }
})();
const worse: string[] = [];
for (const group of ["views", "routes"] as const) {
  console.log(
    `\n${group === "views" ? "VISTE" : "ROTTE /api/v1"}${" ".repeat(26)}mediana    p95   query   (partenza: mediana, query)`,
  );
  for (const [name, now] of Object.entries(measured[group])) {
    const held = baseline?.[group][name];
    // The time of an alternated view against the reference's; its queries against the baseline still.
    const versus = ALTERNATED.has(name) ? reference[group][name] : undefined;
    const before = held && versus ? { ...held, medianMs: versus.medianMs } : held;
    const beyond =
      !queriesOnly &&
      before &&
      now.medianMs > before.medianMs * WORSE &&
      now.medianMs - before.medianMs > NOISE_MS;
    const accepted = beyond ? ACCEPTED_TIMES[name] : undefined;
    const slower = beyond && accepted === undefined;
    const more = before && now.queries > before.queries;
    if (slower) worse.push(`${name}: mediana ${before.medianMs} → ${now.medianMs} ms`);
    if (more) worse.push(`${name}: query ${before.queries} → ${now.queries}`);
    console.log(
      `PERF ${name.padEnd(36)} ${now.medianMs.toFixed(1).padStart(7)} ${now.p95Ms.toFixed(1).padStart(7)} ${String(now.queries).padStart(6)}` +
        (before
          ? `   (${before.medianMs}${versus ? " riferimento" : ""}, ${before.queries})${slower || more ? "  PEGGIO" : ""}` +
            (accepted ? `  ACCETTATA ${accepted}` : "")
          : "   (nuova)"),
    );
  }
}
console.log(
  `\nmisura: la mediana migliore di ${samples.length} processi` +
    (references.length > 0 ? `, alternati con ${references.length} della versione di riferimento` : ""),
);

if (write) {
  // `production` (job durations, image) is read by hand at a deploy and kept as it is.
  writeFileSync(
    BASELINE,
    `${JSON.stringify({ ...baseline, heavyUser: samples[0].heavyUser, ...measured }, null, 2)}\n`,
  );
  console.log(`${BASELINE} scritto`);
} else if (worse.length > 0) {
  console.error(`\nG9: ${worse.length} misure peggiori della partenza:\n  ${worse.join("\n  ")}`);
  process.exit(1);
} else {
  console.log(
    baseline
      ? queriesOnly
        ? "G9 (solo query): nessuna vista o rotta con più query della partenza"
        : "G9: nessuna misura peggiore della partenza"
      : "nessun file di partenza: `npm run perf -- --write`",
  );
}

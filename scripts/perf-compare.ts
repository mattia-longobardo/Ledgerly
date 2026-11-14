// scripts/perf-compare.ts — the second half of `npm run perf`: holds the samples of
// `scripts/perf-probe.ts` to `baselines/performance.json` (rewrite plan, 10-modularity.md §10.9;
// gate G9). A view or a route may not send more queries than its baseline, and its median time may
// not be more than 10% worse. `npm run perf -- --write` records a new baseline — after a measured
// improvement, or with a decision that accepts a cost; never to make a slower step pass.
//
//   node --import tsx scripts/perf-compare.ts [--write] <sample.json> [<sample.json> …]
//
// Each sample is one process. The measure of a view is its best median over the samples, because
// what moved the figures was the process and not the run: the same code over the same data gave one
// process 45 ms for the widest view and the next one 55, each steady from its first run to its last
// (the collector and the compiler of the runtime settle differently every time it starts). More runs
// in one process do not average that out; more processes do. A step that is really slower is slower
// in every process, so the best of them still shows it. The queries are exact and must agree.
import { readFileSync, writeFileSync } from "node:fs";

const BASELINE = "baselines/performance.json";
/** A median this many ms over its baseline is noise, whatever the percentage says. */
const NOISE_MS = 3;
const WORSE = 1.1;

type Measure = { medianMs: number; p95Ms: number; queries: number };
type Group = Record<string, Measure>;
type Sample = { heavyUser: unknown; views: Group; routes: Group };

const write = process.argv.includes("--write");
const files = process.argv.slice(2).filter((one) => !one.startsWith("--"));
if (files.length === 0) throw new Error("usage: perf-compare.ts [--write] <sample.json> …");
const samples = files.map((file) => JSON.parse(readFileSync(file, "utf8")) as Sample);

/** The best median of every measure, with the p95 of the same sample and the most queries seen. */
function best(group: "views" | "routes"): Group {
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
const measured = { views: best("views"), routes: best("routes") };

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
    const before = baseline?.[group][name];
    const slower =
      before && now.medianMs > before.medianMs * WORSE && now.medianMs - before.medianMs > NOISE_MS;
    const more = before && now.queries > before.queries;
    if (slower) worse.push(`${name}: mediana ${before.medianMs} → ${now.medianMs} ms`);
    if (more) worse.push(`${name}: query ${before.queries} → ${now.queries}`);
    console.log(
      `PERF ${name.padEnd(36)} ${now.medianMs.toFixed(1).padStart(7)} ${now.p95Ms.toFixed(1).padStart(7)} ${String(now.queries).padStart(6)}` +
        (before
          ? `   (${before.medianMs}, ${before.queries})${slower || more ? "  PEGGIO" : ""}`
          : "   (nuova)"),
    );
  }
}
console.log(`\nmisura: la mediana migliore di ${samples.length} processi`);

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
      ? "G9: nessuna misura peggiore della partenza"
      : "nessun file di partenza: `npm run perf -- --write`",
  );
}

// Layers piled one on the other: the bands of `StackedArea` and the pieces of `StackedBars`.
import { type Box, type Extent, scale, xOf } from "./geometry";

/** One band of a stacked chart: where it starts and where it ends at each step. */
export interface Band {
  lower: (number | null)[];
  upper: (number | null)[];
}

/**
 * Layers piled one on the other, in the order given (the first at the bottom), so the top edge of
 * the last is the total. Positive values pile up from zero, negative ones down from it, so a
 * credit card never eats into the accounts above the line. A layer with no value at a step counts
 * as nothing there; a step no layer knows is a gap in every band, never a fall to zero.
 */
export function stackLayers(
  layers: readonly (readonly (number | null)[])[],
  length: number,
): { bands: Band[]; top: (number | null)[]; bottom: (number | null)[] } {
  const bands: Band[] = layers.map(() => ({ lower: [], upper: [] }));
  const top: (number | null)[] = [];
  const bottom: (number | null)[] = [];
  for (let step = 0; step < length; step += 1) {
    const known = layers.some((values) => values[step] !== null && values[step] !== undefined);
    let above = 0;
    let below = 0;
    layers.forEach((values, index) => {
      if (!known) {
        bands[index].lower.push(null);
        bands[index].upper.push(null);
        return;
      }
      const value = values[step] ?? 0;
      const base = value < 0 ? below : above;
      bands[index].lower.push(base);
      bands[index].upper.push(base + value);
      if (value < 0) below += value;
      else above += value;
    });
    top.push(known ? above : null);
    bottom.push(known ? below : null);
  }
  return { bands, top, bottom };
}

/** A band as closed paths, one per run of known steps: along the top, back along the bottom. */
export function bandPaths(band: Band, extent: Extent, box: Box): string[] {
  const paths: string[] = [];
  const count = band.upper.length;
  const point = (step: number, value: number) =>
    `${xOf(step, count, box).toFixed(1)},${scale(value, extent, box).toFixed(1)}`;
  let run: { step: number; upper: number; lower: number }[] = [];
  const close = () => {
    if (run.length > 1) {
      const along = run.map((one) => point(one.step, one.upper));
      const back = [...run].reverse().map((one) => point(one.step, one.lower));
      paths.push(`M ${along.join(" L ")} L ${back.join(" L ")} Z`);
    }
    run = [];
  };
  band.upper.forEach((upper, step) => {
    const lower = band.lower[step];
    // `stackLayers` leaves both edges of a step unknown together.
    if (upper === null || lower === null) close();
    else run.push({ step, upper, lower });
  });
  close();
  return paths;
}

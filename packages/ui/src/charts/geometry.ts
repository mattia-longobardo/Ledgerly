// The geometry the line and area charts share: the value range, where a value lands in the box, and
// a series as the runs and strokes it is drawn with.

export interface Series {
  /** One value per step; `null` is a gap, never a zero. */
  values: readonly (number | null)[];
  color?: string;
  label?: string;
  /** Drawn dashed: a reference line (what was paid in) beside a measured one. */
  dashed?: boolean;
  /**
   * Drawn as a step, flat then vertical, instead of sloping from point to point. What a fund has
   * paid in does not creep up through the month: it lands on the day the money leaves, and a line
   * sloping from the month before made a credit of 20 April look as if it had begun in March
   * (owner, 2026-09-20). The same holds for a value that only moves when a document says so.
   */
  step?: boolean;
  /** Per value, whether it is an estimate (PERS-100): those steps of the line are dashed. */
  estimated?: readonly boolean[];
}

export interface Box {
  width: number;
  height: number;
  pad: number;
}

export interface Extent {
  low: number;
  high: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The value range a chart is drawn against, padded so a flat line is not glued to an edge. */
export function extentOf(series: readonly Pick<Series, "values">[]): Extent {
  const known = series.flatMap((one) => one.values.filter((value): value is number => value !== null));
  if (known.length === 0) return { low: 0, high: 1 };
  const low = Math.min(...known, 0);
  const high = Math.max(...known);
  if (high === low) return { low, high: low + 1 };
  return { low, high };
}

export function scale(value: number, { low, high }: Extent, box: Box): number {
  const usable = box.height - box.pad * 2;
  return box.pad + usable - ((value - low) / (high - low)) * usable;
}

export function xOf(index: number, count: number, box: Box): number {
  if (count <= 1) return box.width / 2;
  return box.pad + (index * (box.width - box.pad * 2)) / (count - 1);
}

/**
 * A series as the runs of consecutive known values it is made of. A gap breaks the line instead of
 * being drawn through, so a month with no balance is visibly missing rather than invented.
 */
export function segmentsOf(values: readonly (number | null)[], extent: Extent, box: Box): Point[][] {
  const runs: Point[][] = [];
  let run: Point[] = [];
  values.forEach((value, index) => {
    if (value === null) {
      if (run.length > 0) runs.push(run);
      run = [];
      return;
    }
    run.push({ x: xOf(index, values.length, box), y: scale(value, extent, box) });
  });
  if (run.length > 0) runs.push(run);
  return runs;
}

/** The same run, drawn flat until the next point and then straight up to it. */
export function stepped(run: readonly Point[]): Point[] {
  const out: Point[] = [];
  run.forEach((point, index) => {
    if (index > 0) out.push({ x: point.x, y: run[index - 1].y });
    out.push(point);
  });
  return out;
}

/** A piece of a line drawn in one style: solid, or dashed where the values are estimates. */
export interface Stroke {
  points: Point[];
  dashed: boolean;
}

/**
 * A series as the strokes it is drawn with (F2.5). A step between two months is dashed when either
 * end is an estimate — a month end rebuilt from the movements rather than read — so the line says
 * where it stops knowing and starts reconstructing. Consecutive steps of one style are one stroke,
 * and neighbouring strokes share their meeting point, so the line has no gap where the style
 * changes. A gap in the values still breaks the line, as in `segmentsOf`.
 */
export function strokesOf(
  values: readonly (number | null)[],
  estimated: readonly boolean[],
  extent: Extent,
  box: Box,
): Stroke[] {
  const strokes: Stroke[] = [];
  for (let step = 0; step + 1 < values.length; step += 1) {
    const from = values[step];
    const to = values[step + 1];
    if (from === null || to === null) continue;
    const dashed = estimated[step] === true || estimated[step + 1] === true;
    const start = { x: xOf(step, values.length, box), y: scale(from, extent, box) };
    const end = { x: xOf(step + 1, values.length, box), y: scale(to, extent, box) };
    const last = strokes.at(-1);
    const joined = last && last.dashed === dashed && last.points.at(-1)?.x === start.x;
    if (joined) last.points.push(end);
    else strokes.push({ points: [start, end], dashed });
  }
  return strokes;
}

export const path = (run: readonly Point[]) =>
  run.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");

/** The same run closed down to the baseline, for the soft fill under the line. */
export const areaPath = (run: readonly Point[], floor: number) =>
  [
    `M ${run[0].x.toFixed(1)},${floor.toFixed(1)}`,
    ...run.map((point) => `L ${point.x.toFixed(1)},${point.y.toFixed(1)}`),
    `L ${run[run.length - 1].x.toFixed(1)},${floor.toFixed(1)}`,
    "Z",
  ].join(" ");

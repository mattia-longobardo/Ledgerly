/**
 * Columns from zero, one per period (spec §8.3 MiniBars; the design's "Earmarked · 12 months"). The
 * top of the scale is `target` when there is one, drawn as a dashed line; otherwise the highest
 * value with some headroom. A `null` period draws no column: unknown, not zero. Each column carries
 * its own tooltip (`labels`).
 */
export function MiniBars({
  values,
  labels,
  xLabels,
  summary,
  target = null,
  height = 120,
}: {
  values: readonly (number | null)[];
  labels: readonly string[];
  xLabels: readonly string[];
  summary: string;
  target?: number | null;
  height?: number;
}) {
  const known = values.filter((value): value is number => value !== null && value > 0);
  const top = target !== null && target > 0 ? target : Math.max(1, ...known) * 1.15;
  const scale = (value: number) => Math.min(1, Math.max(0, value) / top) * 100;

  return (
    <figure className="flex flex-col gap-2">
      <div className="relative" style={{ height }}>
        {target !== null && (
          <div
            aria-hidden
            data-testid="mini-bars-target"
            className="absolute inset-x-0 top-0 border-t border-dashed border-muted"
          />
        )}
        <div
          className="grid h-full items-end gap-1.5"
          style={{ gridTemplateColumns: `repeat(${Math.max(1, values.length)}, minmax(0, 1fr))` }}
        >
          {values.map((value, index) => (
            <div
              key={index}
              title={labels[index]}
              data-testid="mini-bar"
              className="rounded-t-xs-plus bg-accent opacity-85"
              style={{ height: value === null ? 0 : `${scale(value)}%` }}
            />
          ))}
        </div>
      </div>
      <div
        aria-hidden
        className="grid text-center text-xs text-faint"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, xLabels.length)}, minmax(0, 1fr))` }}
      >
        {xLabels.map((label, index) => (
          <span key={index} className="truncate">
            {label}
          </span>
        ))}
      </div>
      <figcaption className="sr-only">{summary}</figcaption>
    </figure>
  );
}

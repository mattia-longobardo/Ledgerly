import type { Route } from "next";
import Link from "next/link";

/**
 * The design's year stepper: previous, the year itself, next, and a way back to this one. Links
 * rather than buttons, so the year is in the URL and the whole page stays a server render.
 */
export function YearPicker({
  year,
  years,
  currentYear,
  lastYear = currentYear,
  hrefFor,
  labels,
}: {
  year: number;
  years: number[];
  currentYear: number;
  /** The latest year it walks to: Settings can state next year's allowance ahead of time. */
  lastYear?: number;
  hrefFor: (year: number) => Route;
  labels: { label: string; previous: string; next: string; today: string };
}) {
  const first = Math.min(...years, year);
  return (
    <nav aria-label={labels.label} className="flex h-7 items-center rounded-ctl border border-border bg-card">
      <YearStep href={hrefFor(year - 1)} label={labels.previous} disabled={year <= first - 1} glyph="‹" />
      <span className="min-w-[56px] px-2 text-center font-medium tabular-nums">{year}</span>
      <YearStep href={hrefFor(year + 1)} label={labels.next} disabled={year >= lastYear} glyph="›" />
      <span aria-hidden="true" className="h-4 w-px bg-border max-sm:hidden" />
      <Link
        href={hrefFor(currentYear)}
        // Hidden on the narrowest screens, where it would wrap the topbar onto two lines; the
        // arrows still walk the years, and the year itself is always in view.
        className="focus-ring inline-flex h-full items-center px-2.5 text-sm font-medium text-accent hover:underline max-sm:hidden"
      >
        {labels.today}
      </Link>
    </nav>
  );
}

function YearStep({
  href,
  label,
  disabled,
  glyph,
}: {
  href: Route;
  label: string;
  disabled: boolean;
  glyph: string;
}) {
  if (disabled) {
    return (
      <span aria-hidden="true" className="grid h-full w-7 place-items-center text-faint">
        {glyph}
      </span>
    );
  }
  return (
    <Link
      href={href}
      aria-label={label}
      className="focus-ring grid h-full w-7 place-items-center text-muted hover:text-fg"
    >
      <span aria-hidden="true">{glyph}</span>
    </Link>
  );
}

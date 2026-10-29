"use client";

import {
  createContext,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  useContext,
  useId,
  useState,
} from "react";
import { cn } from "./cn";

interface Highlight {
  picked: string | null;
  toggle: (key: string) => void;
}

const HighlightContext = createContext<Highlight>({ picked: null, toggle: () => {} });

/** The key of the marked element at a point, through the chart's hover overlay. */
function keyAt(x: number, y: number, scope: HTMLElement): string | null {
  for (const element of document.elementsFromPoint(x, y)) {
    if (!scope.contains(element)) continue;
    const key = element.closest("[data-series], [data-series-row]");
    if (key && scope.contains(key))
      return key.getAttribute("data-series") ?? key.getAttribute("data-series-row");
  }
  return null;
}

/**
 * A chart and the list that is its legend, tied together (docs/design/investments-ux.md §3.1): the
 * pointer over a row or over a series, or the focus inside a row, keeps that series full and dims
 * the others to 30 %, and marks the row. A `SeriesToggle` pins one series, for touch and keyboard,
 * apart from the link that opens it (PERS-113 · 9). The pieces only carry `data-series` (chart)
 * and `data-series-row` (list); this draws the rule, so the chart and the list stay server-drawn.
 */
export function HighlightScope({ children, className }: { children: ReactNode; className?: string }) {
  const scope = useId();
  const [hovered, setHovered] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const active = hovered ?? picked;

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") return;
    setHovered(keyAt(event.clientX, event.clientY, event.currentTarget));
  };
  const onFocus = (event: FocusEvent<HTMLDivElement>) => {
    const row = (event.target as HTMLElement).closest("[data-series-row]");
    setHovered(row?.getAttribute("data-series-row") ?? null);
  };
  // The key is an account id: no quote or backslash can reach the selector.
  const safe = active?.replace(/["\\]/g, "") ?? null;
  const rule =
    safe === null
      ? ""
      : `[data-highlight="${scope}"] [data-series]:not([data-series="${safe}"]){opacity:.3}` +
        `[data-highlight="${scope}"] [data-series-row="${safe}"]{background:var(--sel)}`;

  return (
    <HighlightContext.Provider
      value={{ picked, toggle: (key) => setPicked((current) => (current === key ? null : key)) }}
    >
      <div
        data-highlight={scope}
        className={cn(className)}
        onPointerMove={onPointerMove}
        onPointerLeave={() => setHovered(null)}
        onFocus={onFocus}
        onBlur={() => setHovered(null)}
      >
        <style>{rule}</style>
        {children}
      </div>
    </HighlightContext.Provider>
  );
}

/**
 * The button that pins a series in the chart: the dot of its colour, pressed while pinned. It is
 * the touch and keyboard way to the highlight; the name next to it stays the link that opens.
 */
export function SeriesToggle({
  seriesKey,
  color,
  label,
}: {
  seriesKey: string;
  color: string;
  label: string;
}) {
  const { picked, toggle } = useContext(HighlightContext);
  const pressed = picked === seriesKey;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={() => toggle(seriesKey)}
      className="focus-ring grid size-6 shrink-0 place-items-center rounded-[4px] hover:bg-hover"
    >
      <span
        aria-hidden
        className={cn("size-2.5 rounded-full", pressed && "ring-2 ring-fg ring-offset-1 ring-offset-card")}
        style={{ background: color }}
      />
    </button>
  );
}

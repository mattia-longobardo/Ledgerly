"use client";

import { useTranslations } from "next-intl";
import { DEFAULT_DIRECTION, type SortDirection, type SortKey } from "./filters";

/**
 * The direction one more click on a heading would order by, which is what `sortBy` asks for: a
 * column already sorted turns round, a new one starts in its own natural direction. The heading
 * announces this, so what a screen reader hears is what the click does (review B4).
 */
export function nextDirection(key: SortKey, sort: SortKey, direction: SortDirection): SortDirection {
  return key === sort ? (direction === "asc" ? "desc" : "asc") : DEFAULT_DIRECTION[key];
}

/** The heading of an Expenses column, and, when it sorts, what one more click on it would do. */
export function SortHeading({
  name,
  sort,
}: {
  name: SortKey;
  /** The list's order; `null` where no heading changes it. */
  sort: { sort: SortKey; direction: SortDirection } | null;
}) {
  const text = useTranslations("expenses");
  return (
    <>
      {text(`columns.${name}`)}
      {sort && (
        <>
          {" "}
          <span className="sr-only">
            {nextDirection(name, sort.sort, sort.direction) === "asc"
              ? text("sort.ascending")
              : text("sort.descending")}
          </span>
        </>
      )}
    </>
  );
}

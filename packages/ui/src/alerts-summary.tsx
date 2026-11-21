"use client";

// What needs a look, at the head of a section (audit UI-INV-4): one thing is a link with its badge,
// more are a popover that lists them. Investments and Funds draw it the same; the words are the caller's.
import { Badge } from "./badge";
import { Popover } from "./popover";
import { Link } from "./router";

interface AlertItem {
  key: string;
  href: string;
  text: string;
}

export function AlertsSummary({
  items,
  one,
  many,
  manyLabel,
}: {
  items: readonly AlertItem[];
  /** The link of a single item, in words. */
  one: (item: AlertItem) => string;
  /** The popover's trigger, after its badge. */
  many: string;
  /** The trigger's accessible name. */
  manyLabel: string;
}) {
  if (items.length === 0) return null;
  if (items.length === 1)
    return (
      <Link
        href={items[0].href}
        className="focus-ring inline-flex min-h-6 items-center gap-1.5 rounded-sm text-sm hover:underline"
      >
        <Badge tone="warn">1</Badge>
        {one(items[0])}
      </Link>
    );
  return (
    <Popover
      triggerLabel={manyLabel}
      trigger={
        <>
          <Badge tone="warn">{items.length}</Badge>
          {many}
        </>
      }
    >
      <ul className="flex max-w-80 flex-col">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="focus-ring flex min-h-8 items-center rounded-sm px-2 text-sm hover:bg-hover"
            >
              {item.text}
            </Link>
          </li>
        ))}
      </ul>
    </Popover>
  );
}

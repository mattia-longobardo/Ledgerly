import type { ReactNode } from "react";

/**
 * An empty state inside a section that already has its title (Settings › Contributions and Fees):
 * the dashed frame of `EmptyState`, without the icon and with a third of its height.
 */
export function CompactEmpty({
  title,
  description,
  actions,
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-start gap-2 rounded-card border border-dashed border-border2 px-4 py-4">
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-muted">{description}</p>
      {actions && <div className="mt-1 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

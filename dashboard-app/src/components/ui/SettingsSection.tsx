import type { ReactNode } from "react";
import { cn } from "./cn";

export interface SettingsSectionProps {
  /** §6: section headings are always the muted uppercase caption. */
  title: string;
  /** Optional line under the heading — the "why", not per-row detail. */
  description?: ReactNode;
  /** The body: a form, a list, an empty state. Spacing is already applied. */
  children: ReactNode;
  /** Trailing note under the body, e.g. an explainer for the list above. */
  footnote?: ReactNode;
  className?: string;
}

/**
 * One settings block: heading → optional description → body → optional
 * footnote. Carries the 16 px mobile gutter itself and drops it at `lg:`,
 * where the page's grid wrapper owns the gutter instead — the same idiom as
 * Home and the fund detail page. Adding a settings section is therefore one
 * element in one of the page's two columns, never a block of repeated markup.
 */
export function SettingsSection({
  title,
  description,
  children,
  footnote,
  className,
}: SettingsSectionProps) {
  return (
    <section className={cn("px-4 lg:px-0", className)}>
      <h2 className="text-caption tracking-wide text-fg-muted uppercase">{title}</h2>
      {description !== undefined && (
        <p className="mt-1 text-body-sm text-fg-muted">{description}</p>
      )}
      <div className="mt-3">{children}</div>
      {footnote !== undefined && <p className="mt-3 text-body-sm text-fg-muted">{footnote}</p>}
    </section>
  );
}

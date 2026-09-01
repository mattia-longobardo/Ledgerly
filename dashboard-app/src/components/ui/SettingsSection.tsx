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
 * One settings block: heading and its rationale on the left, the controls they
 * describe on the right.
 *
 * This is the one screen where a split header earns its place, because the
 * right column carries controls rather than filler prose. In a narrow column it
 * collapses to the obvious stack: heading, description, controls, footnote.
 *
 * The split is a container query on the SECTION, not the viewport, so a section
 * placed in a narrow column stacks and the same section across a full row
 * splits, with no page-level breakpoint to keep in sync.
 */
export function SettingsSection({
  title,
  description,
  children,
  footnote,
  className,
}: SettingsSectionProps) {
  return (
    <section
      className={cn("@container grid gap-x-6 gap-y-3 @2xl:grid-cols-12", className)}
    >
      <div className="@2xl:col-span-4">
        <h2 className="text-caption tracking-wide text-fg-muted uppercase">{title}</h2>
        {description !== undefined && (
          <p className="mt-1 max-w-prose text-body-sm text-fg-muted">{description}</p>
        )}
      </div>
      <div className="min-w-0 @2xl:col-span-8">
        {children}
        {footnote !== undefined && (
          <p className="mt-3 max-w-prose text-body-sm text-fg-muted">{footnote}</p>
        )}
      </div>
    </section>
  );
}

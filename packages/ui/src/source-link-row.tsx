"use client";

// The links of the connections' pages: a source in the list of Settings › Integrations, and the way
// from a disconnection to the source's page.
import { ChevronRight } from "lucide-react";
import { useTranslations } from "use-intl";
import { Tag } from "./badge";
import { Dot, type RowStatusValue, StatusWord } from "./connection-row";
import { Link } from "./router";

/**
 * One source in the list of Settings › Integrations (plugin-settings.md §2.1): the name, the state
 * of its connection, one line of summary, what it reads (UX review, point 6) and a chevron. The whole row is the one link to the
 * source's page, where every setting of the source is.
 */
export function SourceLinkRow({
  slug,
  name,
  status,
  summary,
  href,
  reads = [],
}: {
  slug: string;
  name: string;
  status: RowStatusValue;
  summary: string | null;
  href: string;
  /** What the source reads, in the person's words: one chip each. */
  reads?: readonly string[];
}) {
  return (
    <Link
      href={href}
      data-testid="source-row"
      data-source={slug}
      data-status={status}
      className="focus-ring flex min-h-6 items-center justify-between gap-4 px-4 py-3.5 hover:bg-hover"
    >
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2">
          <Dot value={status} />
          <span className="min-w-0 font-semibold break-words">{name}</span>
          <StatusWord value={status} />
        </span>
        {summary !== null && <span className="mt-0.5 block text-sm text-muted">{summary}</span>}
        <SourceReads reads={reads} />
      </span>
      <ChevronRight aria-hidden className="size-4 shrink-0 text-muted" />
    </Link>
  );
}

/** What a source reads, one chip each; nothing when it says nothing. */
export function SourceReads({ reads }: { reads: readonly string[] }) {
  if (reads.length === 0) return null;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1" data-testid="source-reads">
      {reads.map((one) => (
        <Tag key={one}>{one}</Tag>
      ))}
    </span>
  );
}

/**
 * Under "Disconnect" (plugin-settings.md §4.2): a disconnection keeps the settings, and the way
 * to stop using a source for good is on the source's page.
 */
export function DeactivateLink({ href, provider }: { href: string; provider: string }) {
  const text = useTranslations("settings.plugin");
  return (
    <Link
      href={href}
      className="focus-ring inline-flex min-h-6 items-center self-start rounded-xs text-accent underline underline-offset-2"
    >
      {text("disconnect.toDeactivate", { provider })}
    </Link>
  );
}

import Link from "next/link";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { cn } from "@/components/ui/cn";
import type { IntegrationSummary } from "../application/list-integrations";
import { STATUS_LABEL, STATUS_TONE } from "./styles";

/**
 * Every registered provider, connected or not. There is deliberately no empty
 * state: the list IS the call to action, and a provider with no connection is
 * the row you click to make one.
 */
export function IntegrationsList({ items }: { items: readonly IntegrationSummary[] }) {
  return (
    <ul className="hairline-t">
      {items.map((item) => {
        const status = item.connection?.status ?? "disconnected";
        return (
          <li key={item.provider}>
            <Link
              href={`/settings/integrations/${item.provider}`}
              className="flex min-h-11 items-center gap-3 py-3 hairline-b transition-colors hover:bg-surface-hover"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-fg">{item.label}</span>
                <span className="block truncate text-caption text-fg-muted">
                  {item.capabilities.join(" · ")}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-0.5">
                <span className={cn("text-caption", STATUS_TONE[status])}>{STATUS_LABEL[status]}</span>
                {item.connection && (
                  <StaleBadge
                    capturedAt={item.connection.lastSyncAt}
                    stale={item.connection.lastSyncAt === null}
                  />
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

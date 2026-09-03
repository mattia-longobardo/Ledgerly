"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Sparkline } from "@/components/chart/Sparkline";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { StaleBadge } from "@/components/ui/StaleBadge";
import { formatAsOf } from "@/lib/format";
import type {
  AccountOrigin,
  AccountStatus,
  AccountType,
} from "../domain/account";
import {
  ACCOUNT_STATUS_LABEL,
  ACCOUNT_TYPE_LABEL,
  MANUAL_ORIGIN_LABEL,
  WALLET_ORIGIN_LABEL,
} from "./labels";

/** What the accounts list page hands down — dates already flattened to ISO strings so the row stays serialisable across the server/client boundary. */
export interface AccountTableRow {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  origin: AccountOrigin;
  status: AccountStatus;
  provider: string | null;
  groupName: string | null;
  balance: string | null;
  capturedAt: string | null;
  trend: readonly (number | null)[];
  stale: boolean;
  /** Set only when `status === "unavailable"`; an approximation (the account's last update) of when it went dark upstream. */
  unavailableSince: string | null;
}

export interface AccountsTableProps {
  rows: readonly AccountTableRow[];
}

type GroupBy = "none" | "type" | "provider" | "currency" | "status" | "group";

const GROUP_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: "none", label: "None" },
  { value: "type", label: "Type" },
  { value: "provider", label: "Provider" },
  { value: "currency", label: "Currency" },
  { value: "status", label: "Status" },
  { value: "group", label: "Group" },
];

function groupKey(row: AccountTableRow, by: GroupBy): string {
  switch (by) {
    case "type":
      return ACCOUNT_TYPE_LABEL[row.type];
    case "provider":
      return row.provider === null ? MANUAL_ORIGIN_LABEL : WALLET_ORIGIN_LABEL;
    case "currency":
      return row.currency;
    case "status":
      return ACCOUNT_STATUS_LABEL[row.status];
    case "group":
      return row.groupName ?? "No group";
    case "none":
      return "";
  }
}

/** Group-by list of accounts. The empty state is the page's job, not this component's — it only ever receives rows to show. */
export function AccountsTable({ rows }: AccountsTableProps) {
  const [groupBy, setGroupBy] = useState<GroupBy>("none");

  const buckets = useMemo(() => {
    if (groupBy === "none") return [{ key: "", items: rows }];
    const map = new Map<string, AccountTableRow[]>();
    for (const row of rows) {
      const key = groupKey(row, groupBy);
      const bucket = map.get(key);
      if (bucket) bucket.push(row);
      else map.set(key, [row]);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, items]) => ({ key, items }));
  }, [rows, groupBy]);

  return (
    <div className="flex flex-col gap-6">
      <SegmentedControl
        options={GROUP_OPTIONS}
        value={groupBy}
        onChange={setGroupBy}
        label="Group accounts by"
      />

      {buckets.map((bucket) => (
        <div key={bucket.key || "all"}>
          {bucket.key !== "" && (
            <h3 className="mb-1 text-caption tracking-wide text-fg-muted uppercase">
              {bucket.key}
            </h3>
          )}
          <ul className="hairline-t">
            {bucket.items.map((row) => (
              <AccountListRow key={row.id} row={row} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function AccountListRow({ row }: { row: AccountTableRow }) {
  return (
    <li>
      <Link
        href={`/finance/accounts/${row.id}`}
        className="flex min-h-11 items-center gap-3 py-2 hairline-b transition-colors hover:bg-surface-hover"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-body text-fg">{row.name}</span>
            <span className="shrink-0 rounded-xs bg-surface-raised px-1.5 py-0.5 text-caption text-fg-muted">
              {row.origin === "synced"
                ? WALLET_ORIGIN_LABEL
                : MANUAL_ORIGIN_LABEL}
            </span>
          </span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StaleBadge
              capturedAt={row.capturedAt ? new Date(row.capturedAt) : null}
              stale={row.stale}
              compact
            />
            {row.status === "unavailable" && (
              <span className="rounded-xs bg-warning/10 px-1.5 py-0.5 text-caption text-warning">
                Unavailable upstream since{" "}
                {row.unavailableSince
                  ? formatAsOf(new Date(row.unavailableSince))
                  : "unknown"}
              </span>
            )}
          </span>
        </span>

        <Sparkline values={row.trend} width={64} />

        {row.balance !== null ? (
          <MoneyValue
            value={row.balance}
            size="body"
            cents="full"
            className="text-right text-fg"
          />
        ) : (
          <span className="text-body-sm text-fg-muted whitespace-nowrap">
            No balance yet
          </span>
        )}
      </Link>
    </li>
  );
}

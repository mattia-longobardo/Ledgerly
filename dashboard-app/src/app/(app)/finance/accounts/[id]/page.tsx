import Link from "next/link";
import { notFound } from "next/navigation";
import { TimeSeriesChart } from "@/components/chart/TimeSeriesChart";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { MoneyValue } from "@/components/ui/MoneyValue";
import { StaleBadge } from "@/components/ui/StaleBadge";
import type { Series } from "@/lib/contracts";
import { formatAsOf } from "@/lib/format";
import { romeDate } from "@/lib/time";
import { listGroups } from "@/modules/accounts/application/groups";
import { getAccountDetail } from "@/modules/accounts/application/get-account-detail";
import { NotFoundError } from "@/modules/accounts/application/errors";
import { runForPrincipal } from "@/modules/accounts/ui/deps";
import {
  ACCOUNT_TYPE_LABEL,
  MANUAL_ORIGIN_LABEL,
  WALLET_ORIGIN_LABEL,
} from "@/modules/accounts/ui/labels";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { AccountDetailActions } from "./_components/AccountDetailActions";
import {
  BalanceHistoryTable,
  type BalanceHistoryRow,
} from "./_components/BalanceHistoryTable";

export const dynamic = "force-dynamic";

const HISTORY_ROWS = 50;

/** Mirrors the `/accounts/{id}/balances` route's own cursor encoding, so a page fetched here and a page fetched from "Load more" are interchangeable. */
function encodeCursor(asOf: string): string {
  return Buffer.from(asOf, "utf8").toString("base64url");
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await runForPrincipal((deps, principal) =>
    getAccountDetail(deps)(principal, id),
  ).catch(() => null);
  return { title: detail?.account.name ?? "Account" };
}

export default async function AccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePrincipalOrRedirect();

  let detail;
  let groups;
  let historyPage: { items: BalanceHistoryRow[]; nextCursor: string | null };
  try {
    ({ detail, groups, historyPage } = await runForPrincipal(
      async (deps, principal) => {
        const [detail, groups] = await Promise.all([
          getAccountDetail(deps)(principal, id),
          listGroups(deps)(principal),
        ]);
        // The full history, not just the trend window `getAccountDetail` keeps: the
        // table's "Load more" needs a real cursor to hand off to the API, and that
        // cursor has to be computed over the same unbounded set the API paginates.
        const all = await deps.accounts.history(
          principal.userId,
          [id],
          "0001-01-01",
        );
        const sorted = [...all].sort(
          (a, b) =>
            b.asOf.localeCompare(a.asOf) ||
            b.capturedAt.getTime() - a.capturedAt.getTime(),
        );
        const items = sorted.slice(0, HISTORY_ROWS).map((p) => ({
          asOf: p.asOf,
          balance: p.balance,
          source: p.source,
          capturedAt: p.capturedAt.toISOString(),
        }));
        const last = items[items.length - 1];
        const nextCursor =
          sorted.length > HISTORY_ROWS && last ? encodeCursor(last.asOf) : null;
        return { detail, groups, historyPage: { items, nextCursor } };
      },
    ));
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }

  const { account, latest, series: rawSeries, link, stale } = detail;
  const archived = account.status === "archived";

  const series: Series[] = [
    { key: "balance", label: "Balance", points: rawSeries },
  ];

  return (
    <>
      <PageHeader
        title={account.name}
        eyebrow={
          <Link
            href="/finance/accounts"
            className="text-fg-muted transition-colors hover:text-fg"
          >
            &larr; Accounts
          </Link>
        }
      />

      <PageGrid className="pt-5">
        <Panel span={7} ariaLabel={`${account.name} balance`}>
          <div className="axis-rule-live pb-6">
            {latest !== null ? (
              <MoneyValue value={latest.balance} size="display" cents="muted" />
            ) : (
              <p className="text-body text-fg-muted">
                No balance recorded yet.
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="rounded-xs bg-surface-raised px-1.5 py-0.5 text-caption text-fg-muted">
                {account.origin === "synced"
                  ? WALLET_ORIGIN_LABEL
                  : MANUAL_ORIGIN_LABEL}
              </span>
              <span className="text-caption text-fg-muted">
                {ACCOUNT_TYPE_LABEL[account.type]}
              </span>
              {latest !== null && (
                <StaleBadge capturedAt={latest.capturedAt} stale={stale} />
              )}
              {account.status === "unavailable" && (
                <span className="rounded-xs bg-warning/10 px-1.5 py-0.5 text-caption text-warning">
                  Unavailable upstream since {formatAsOf(account.updatedAt)}
                </span>
              )}
              {archived && (
                <span className="rounded-xs bg-surface-raised px-1.5 py-0.5 text-caption text-fg-muted">
                  Archived
                </span>
              )}
            </div>
          </div>

          <h2 className="mt-5 text-caption tracking-wide text-fg-muted uppercase">
            Balance over time
          </h2>
          <TimeSeriesChart
            series={series}
            label={`${account.name}: balance by month`}
            height={280}
            className="mt-3"
          />
        </Panel>

        <Panel span={5} title="Actions" chrome="framed">
          {archived ? (
            <p className="text-body-sm text-fg-muted">
              This account is archived. Restore it from{" "}
              <Link
                href="/finance/management/accounts"
                className="text-accent underline underline-offset-2"
              >
                Finance &rsaquo; Management
              </Link>{" "}
              to make changes.
            </p>
          ) : (
            <AccountDetailActions
              account={{
                id: account.id,
                version: account.version,
                name: account.name,
                type: account.type,
                currency: account.currency,
                groupId: account.groupId,
                includeInNetWorth: account.includeInNetWorth,
                notes: account.notes,
                origin: account.origin,
              }}
              groups={groups.map((g) => ({ id: g.id, name: g.name }))}
              today={romeDate()}
            />
          )}

          {account.notes !== null && account.notes !== "" && (
            <p className="mt-4 text-body-sm text-fg-muted">{account.notes}</p>
          )}

          {link !== null && (
            <dl className="mt-4 flex flex-col gap-1 hairline-t pt-4">
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-caption text-fg-muted">External ID</dt>
                <dd className="num truncate text-body-sm text-fg">
                  {link.externalId}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-3">
                <dt className="text-caption text-fg-muted">
                  {link.missingSince !== null ? "Missing since" : "Last synced"}
                </dt>
                <dd className="num text-body-sm text-fg">
                  {formatAsOf(link.missingSince ?? latest?.capturedAt ?? null)}
                </dd>
              </div>
            </dl>
          )}
        </Panel>

        <Panel span={12} title="Balance history">
          <BalanceHistoryTable
            accountId={account.id}
            initialItems={historyPage.items}
            initialNextCursor={historyPage.nextCursor}
            pageSize={HISTORY_ROWS}
          />
        </Panel>
      </PageGrid>
    </>
  );
}

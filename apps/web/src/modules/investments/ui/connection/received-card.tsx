"use client";

// «What we get from <service>» (§3.6, S11, A1, V3): one row per kind of data — balances and positions,
// activity, value history, cost basis — an icon, a badge in words and a sentence; the detail by stream
// and product stays closed. Only the days the service reads (`visibleCoverage`, PERS-145).
import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatDate } from "@ledgerly/format/format";
import { civilDateIn } from "@ledgerly/format/dates";
import { Badge } from "@ledgerly/ui/badge";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { TONE_TEXT } from "@ledgerly/ui/tone";
import { useProductLabel } from "../labels";
import { instantText } from "../present";
import type { ServicePage } from "../service/service-view";
import type { Connection, Sync } from "./connection-view";
import { useConnectionWords } from "./connection-words";

type Status = "complete" | "partial" | "check" | "missing";

const ICON = {
  complete: CheckCircle2,
  partial: CircleDashed,
  check: AlertTriangle,
  missing: CircleSlash,
} as const;
const TONE = { complete: "pos", partial: "accent", check: "warn", missing: "warn" } as const;
const ICON_TONE = {
  complete: TONE_TEXT.pos,
  partial: TONE_TEXT.accent,
  check: TONE_TEXT.warn,
  missing: TONE_TEXT.warn,
} as const;

type Coverage = Sync["visibleCoverage"][number];

interface ReceivedRow {
  key: string;
  title: string;
  status: Status;
  text: string;
}

type Text = ReturnType<typeof useTranslations<"investments">>;

interface RowWords {
  text: Text;
  long: (day: string) => string;
  stream: (stream: string) => string;
  reason: (reason: string) => string;
  products: (products: readonly string[]) => string;
  instant: (iso: string) => string;
}

/** Balances and positions: read, read in part, or not yet. */
function balancesRow(words: RowWords, connection: Connection, sync: Sync): ReceivedRow {
  const { text } = words;
  const latest = connection.readings[0] ?? null;
  const title = text("connection.received.balances");
  if (!latest)
    return { key: "balances", title, status: "missing", text: text("connection.received.balancesNone") };
  if (latest.unread.length > 0)
    return {
      key: "balances",
      title,
      status: "partial",
      text: text("connection.received.balancesPartial", { products: words.products(latest.unread) }),
    };
  return {
    key: "balances",
    title,
    status: "complete",
    text: text("connection.received.balancesOk", {
      when: sync.lastOkAt ? words.instant(sync.lastOkAt) : words.long(latest.on),
    }),
  };
}

/** The activity: its streams, with what is missing grouped by reason. */
function activityRow(words: RowWords, connection: Connection, sync: Sync): ReceivedRow {
  const { text } = words;
  const title = text("connection.received.activity");
  const flows = sync.visibleCoverage.filter(
    (row) => row.kind === "flows" && row.stream !== "quantities" && row.stream !== "balance_history",
  );
  if (flows.length === 0)
    return {
      key: "activity",
      title,
      status: "missing",
      text: text("connection.received.activityNone", { name: connection.name }),
    };
  const incomplete = flows.filter((row) => row.status !== "complete");
  if (incomplete.length === 0)
    return {
      key: "activity",
      title,
      status: "complete",
      text: text("connection.received.activityOk", { date: words.long(sync.activityFrom ?? "") }),
    };
  // One part per reason, its streams together: "Trades, Withdrawals: not available, the API keeps 24 months".
  const streams = [
    ...Map.groupBy(incomplete, (row: Coverage) => `${row.status}|${row.reason ?? ""}`).values(),
  ]
    .map((rows) =>
      [
        rows.map((row) => words.stream(row.stream)).join(", "),
        [text(`sync.coverageStatus.${rows[0].status}`), rows[0].reason ? words.reason(rows[0].reason) : null]
          .filter(Boolean)
          .join(", "),
      ].join(": "),
    )
    .join("; ");
  return {
    key: "activity",
    title,
    status: "partial",
    text: text("connection.received.activityGaps", { streams }),
  };
}

/** The value's history: reconstructed from the flows, read since a day, or none. */
function historyRow(words: RowWords, connection: Connection): ReceivedRow {
  const { text } = words;
  const title = text("connection.received.history");
  const reconstructed = connection.reconstructedReadings;
  if (reconstructed)
    return {
      key: "history",
      title,
      status: "complete",
      text: text("connection.received.historyReconstructed", {
        from: words.long(reconstructed.from),
        to: words.long(reconstructed.to),
        name: connection.name,
      }),
    };
  return connection.firstReadOn
    ? {
        key: "history",
        title,
        status: "complete",
        text: text("connection.received.historyRead", { date: words.long(connection.firstReadOn) }),
      }
    : { key: "history", title, status: "missing", text: text("connection.received.balancesNone") };
}

/** The cost basis: of the period, or to check when the quantities do not match. */
function costRow(words: RowWords, sync: Sync): ReceivedRow {
  const { text } = words;
  const quantities = sync.visibleCoverage.find((row) => row.kind === "flows" && row.stream === "quantities");
  const mismatch = quantities !== undefined && quantities.status !== "complete";
  return {
    key: "cost",
    title: text("connection.received.cost"),
    status: mismatch ? "check" : "complete",
    text: mismatch ? text("connection.received.costMismatch") : text("connection.received.costPeriod"),
  };
}

function useRows(page: ServicePage, connection: Connection, sync: Sync): ReceivedRow[] {
  const text = useTranslations("investments");
  const { stream, reason } = useConnectionWords();
  const productLabel = useProductLabel();
  const words: RowWords = {
    text,
    long: (day) => formatDate(day, "long", page.say.locale),
    stream,
    reason,
    products: (products) => products.map(productLabel).join(", "),
    instant: (iso) => instantText(iso, page.say, (time) => text("header.today", { time })),
  };
  return [
    balancesRow(words, connection, sync),
    activityRow(words, connection, sync),
    historyRow(words, connection),
    costRow(words, sync),
  ];
}

function CoverageDetails({
  page,
  connection,
  sync,
}: {
  page: ServicePage;
  connection: Connection;
  sync: Sync;
}) {
  const text = useTranslations("investments");
  const words = useConnectionWords();
  const productLabel = useProductLabel();
  const long = (iso: string) =>
    formatDate(civilDateIn(new Date(iso), page.say.timeZone), "long", page.say.locale);
  const latest = connection.readings[0] ?? null;
  if (sync.visibleCoverage.length === 0) return null;
  return (
    <details className="border-t border-border px-4 py-2.5 text-sm">
      <summary className="focus-ring inline-flex min-h-6 cursor-pointer items-center rounded-sm text-muted hover:text-fg">
        {text("connection.received.details", { count: sync.visibleCoverage.length })}
      </summary>
      <ul className="mt-2 flex flex-col gap-1">
        {sync.visibleCoverage.map((row) => (
          <li key={`${row.kind}-${row.stream}-${row.from}`} className="flex flex-wrap gap-x-2">
            <span>{words.stream(row.stream)}</span>
            <span className="text-muted">
              {long(row.from)} → {long(row.to)}
            </span>
            <span className={row.status === "complete" ? "text-muted" : "text-warn"}>
              {text(`sync.coverageStatus.${row.status}`)}
              {row.reason ? ` · ${words.reason(row.reason)}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {latest && latest.products.length > 0 && (
        <p className="mt-2 text-muted">
          {text("connection.received.products", { products: latest.products.map(productLabel).join(", ") })}
        </p>
      )}
    </details>
  );
}

export function ReceivedCard({
  page,
  connection,
  sync,
}: {
  page: ServicePage;
  connection: Connection;
  sync: Sync;
}) {
  const text = useTranslations("investments");
  const rows = useRows(page, connection, sync);
  return (
    <Card padded={false} className="min-w-0" data-testid="received">
      <CardHeader title={text("connection.received.title", { name: connection.name })} />
      <p className="-mt-2 px-4 pb-2 text-sm text-muted">{text("connection.received.note")}</p>
      <ul className="flex flex-col">
        {rows.map((row) => {
          const Icon = ICON[row.status];
          return (
            <li
              key={row.key}
              data-testid="received-row"
              className="flex items-start gap-3 border-t border-border px-4 py-2.5 text-sm"
            >
              <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", ICON_TONE[row.status])} />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {row.title}
                  <Badge tone={TONE[row.status]}>{text(`connection.status.${row.status}`)}</Badge>
                </span>
                <span className="text-muted">{row.text}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <CoverageDetails page={page} connection={connection} sync={sync} />
    </Card>
  );
}

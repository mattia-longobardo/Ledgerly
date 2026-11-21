"use client";

// The readings (§3.6, S6), newest first, the runs of equal ones folded into one line («20 equal
// readings, 18–27 Oct») and the reconstructed ones into another; «Confirm zero» on a reading of nothing.
import { useTranslations } from "next-intl";
import { formatDate } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { RunLog, type RunLogRow } from "@ledgerly/ui/run-log";
import type { ServicePage } from "../service/service-view";
import { ConfirmZeroButton } from "../settings-forms";
import type { Connection, Reading } from "./connection-view";

/** The readings in runs of the same total and status: grouping, no sum. */
function runsOf(readings: readonly Reading[]) {
  const runs: { first: Reading; last: Reading; count: number }[] = [];
  for (const reading of readings) {
    const run = runs.at(-1);
    if (run && run.first.total === reading.total && run.first.status === reading.status) {
      run.last = reading;
      run.count += 1;
    } else runs.push({ first: reading, last: reading, count: 1 });
  }
  return runs;
}

function useRows(page: ServicePage, connection: Connection): RunLogRow[] {
  const text = useTranslations("investments");
  const long = (day: string) => formatDate(day, "long", page.say.locale);
  const rows: RunLogRow[] = runsOf(connection.readings).map((run) => ({
    key: run.first.id,
    when:
      run.count === 1
        ? long(run.first.on)
        : text("connection.history.same", {
            count: run.count,
            from: long(run.last.on),
            to: long(run.first.on),
          }),
    state: {
      tone: run.first.status === "complete" || run.first.status === "confirmed_zero" ? "neutral" : "warn",
      label: text(`readings.statuses.${run.first.status}`),
    },
    note:
      run.first.missingPrices > 0 ? (
        <span className="text-warn">{text("readings.missing", { count: run.first.missingPrices })}</span>
      ) : undefined,
    value: page.money(run.first.total),
  }));
  const reconstructed = connection.reconstructedReadings;
  if (reconstructed)
    rows.push({
      key: "reconstructed",
      when: text("connection.history.reconstructed", {
        count: reconstructed.count,
        from: long(reconstructed.from),
        to: long(reconstructed.to),
      }),
      state: { tone: "neutral", label: text("readings.statuses.reconstructed") },
    });
  return rows;
}

export function ReadingsCard({ page, connection }: { page: ServicePage; connection: Connection }) {
  const text = useTranslations("investments");
  const latest = connection.readings[0] ?? null;
  const rows = useRows(page, connection);
  return (
    <Card padded={false} className="min-w-0" data-testid="sync-history">
      <CardHeader title={text("connection.history.title")} />
      <p className="-mt-2 px-4 pb-2 text-sm text-muted">{text("connection.history.note")}</p>
      {latest?.status === "pending_zero" && (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3">
          <p className="text-sm text-warn">{text("readings.pendingZero")}</p>
          <ConfirmZeroButton
            accountId={page.id}
            readingId={latest.id}
            dateLabel={formatDate(latest.on, "long", page.say.locale)}
          />
        </div>
      )}
      {rows.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-muted">{text("connection.history.empty")}</p>
      ) : (
        <RunLog rows={rows} testId="reading-run" />
      )}
    </Card>
  );
}

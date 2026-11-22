"use client";

// Settings › Data, read from `/api/v1` (rewrite plan R3): the monthly snapshots and the export of the
// person's own data. The snapshots' log is `GET /snapshots`; the export is a plain link to the file.
import { useTranslations } from "next-intl";
import { summary } from "@ledgerly/api-contract/accounts";
import { profile } from "@ledgerly/api-contract/settings";
import { parseCents } from "@ledgerly/format/cents";
import { formatDate, formatMoney, NULL_DISPLAY, numberStyle } from "@ledgerly/format/format";
import { Badge } from "@ledgerly/ui/badge";
import { buttonClassName } from "@ledgerly/ui/button";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { Table, TBody, Td, Th, THead, Tr } from "@ledgerly/ui/table";
import { SnapshotButton } from "@/modules/accounts/client";

function SnapshotLog() {
  const text = useTranslations("settings.snapshots");
  const preferences = useApi(profile.getPreferences, {});
  const snapshots = useApi(summary.listSnapshots, {});
  return (
    <Loaded state={preferences}>
      {(prefs) => (
        <Loaded state={snapshots}>
          {({ snapshots: runs }) =>
            runs.length === 0 ? (
              <p className="p-4 text-muted">{text("log.empty")}</p>
            ) : (
              <Table>
                <THead>
                  <Th>{text("log.month")}</Th>
                  <Th>{text("log.result")}</Th>
                  <Th align="right">{text("log.accounts")}</Th>
                  <Th align="right">{text("log.total")}</Th>
                  <Th>{text("log.detail")}</Th>
                </THead>
                <TBody>
                  {runs.map((run) => (
                    <Tr key={run.month}>
                      <Td>{formatDate(run.month, "monthYear", prefs.locale)}</Td>
                      <Td>
                        <Badge
                          tone={run.state === "success" ? "pos" : run.state === "warning" ? "warn" : "neg"}
                        >
                          {text(`states.${run.state}`)}
                        </Badge>
                      </Td>
                      <Td align="right">
                        {text("log.written", { written: run.accountsWritten, skipped: run.accountsSkipped })}
                      </Td>
                      <Td align="right">
                        {formatMoney(run.total === null ? null : parseCents(run.total), numberStyle(prefs), {
                          currency: run.totalCurrency,
                        })}
                      </Td>
                      <Td muted>
                        {run.warnings.length > 0
                          ? text("log.stale", { accounts: run.warnings.join(", ") })
                          : NULL_DISPLAY}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            )
          }
        </Loaded>
      )}
    </Loaded>
  );
}

export function DataScreen() {
  const text = useTranslations("settings.snapshots");
  const mine = useTranslations("settings.exportMine");
  return (
    <SettingsGrid>
      <SettingsSection title={text("title")} description={text("description")}>
        <SnapshotButton />
      </SettingsSection>

      <SettingsSection title={text("log.title")} description={text("log.description")} padded={false}>
        <SnapshotLog />
      </SettingsSection>

      <SettingsSection title={mine("title")} description={mine("description")}>
        {/* A plain link and not a button: the response *is* the file, so the browser downloads it
            without a round trip through a write that would have to buffer it first. */}
        <div className="flex flex-col items-start gap-2">
          <a href="/settings/data/export.zip" download className={buttonClassName("secondary", "md")}>
            {mine("download")}
          </a>
          <p className="text-sm text-muted">{mine("hint")}</p>
        </div>
      </SettingsSection>
    </SettingsGrid>
  );
}

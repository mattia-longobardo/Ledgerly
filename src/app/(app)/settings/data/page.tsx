import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { listSnapshotRuns } from "@/modules/accounts/queries";
import { SnapshotButton } from "@/modules/accounts/ui/snapshot-button";
import { requireSession } from "@/platform/auth/session";
import { formatDate, formatMoney, NULL_DISPLAY } from "@/platform/format";
import { Badge } from "@/ui/badge";
import { SettingsSection } from "@/ui/section";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings.tabs"))("data") };
}

export default async function SettingsDataPage() {
  const ctx = await requireSession();
  const t = await getTranslations("settings.snapshots");
  const runs = await listSnapshotRuns(ctx);

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title={t("title")} description={t("description")}>
        <SnapshotButton />
      </SettingsSection>

      <SettingsSection title={t("log.title")} description={t("log.description")} padded={false}>
        {runs.length === 0 ? (
          <p className="p-4 text-muted">{t("log.empty")}</p>
        ) : (
          <Table>
            <THead>
              <Th>{t("log.month")}</Th>
              <Th>{t("log.result")}</Th>
              <Th align="right">{t("log.accounts")}</Th>
              <Th align="right">{t("log.total")}</Th>
              <Th>{t("log.detail")}</Th>
            </THead>
            <TBody>
              {runs.map((run) => (
                <Tr key={run.id}>
                  <Td>{formatDate(run.month, "monthYear", ctx.locale)}</Td>
                  <Td>
                    <Badge tone={run.state === "success" ? "pos" : run.state === "warning" ? "warn" : "neg"}>
                      {t(`states.${run.state}`)}
                    </Badge>
                  </Td>
                  <Td align="right">
                    {t("log.written", { written: run.accountsWritten, skipped: run.accountsSkipped })}
                  </Td>
                  <Td align="right">{formatMoney(run.totalCents, ctx.numberFormat)}</Td>
                  <Td muted>
                    {run.warnings && run.warnings.length > 0
                      ? t("log.stale", { accounts: run.warnings.join(", ") })
                      : NULL_DISPLAY}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
      </SettingsSection>
    </div>
  );
}

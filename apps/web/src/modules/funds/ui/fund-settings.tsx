"use client";

import type { Route } from "next";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { funds } from "@ledgerly/api-contract/funds";
import type { RouteOutput } from "@ledgerly/api-client";
import { useApi, useLatest } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { Link } from "@ledgerly/ui/router";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { FundFeesSection } from "./fund-fees";
import { FundStateButton } from "./fund-forms";
import { FundSettingsForm } from "./fund-settings-form";
import { FundSourcesSection } from "./fund-sources";
import { type Say, useSay } from "@/platform/say";
import { movementOptions } from "./wire-forms";

export type Settings = RouteOutput<typeof funds.getFundSettings>;

/** A section the address can point at (`#sources`), with the name the tests find it by. */
function Anchor({ id, testId, children }: { id: string; testId?: string; children: ReactNode }) {
  return (
    <div id={id} data-testid={testId} className="min-w-0 scroll-mt-4">
      {children}
    </div>
  );
}

/**
 * The Settings tab of a fund (docs/design/rewrite-plan/ux/n6-pension-fund.md §6), read from
 * `GET /funds/{id}/settings` (rewrite plan R3): General, the contribution sources, the fees and the
 * danger zone, the same four for every fund. It does not follow the period. An archived fund is read
 * only: only "Restore fund" is offered.
 */
export function FundSettings({ fundId }: { fundId: string }) {
  const settings = useLatest(useApi(funds.getFundSettings, { params: { id: fundId } }));
  const say = useSay();
  const open = useApi(accountRoutes.listAccounts, {});
  return (
    <Loaded state={settings}>
      {(read) => (
        <Loaded state={say}>
          {(words) => (
            <Loaded state={open}>
              {(list) => (
                <SettingsBody
                  settings={read}
                  say={words}
                  accounts={list.accounts.map((account) => ({ id: account.id, name: account.name }))}
                />
              )}
            </Loaded>
          )}
        </Loaded>
      )}
    </Loaded>
  );
}

/** The movements "Find from the movements" chooses from: the ones that left the active debit's account. */
function useMovements(settings: Settings, say: Say) {
  const debit = settings.sources.find((source) => source.kind === "bank_debit" && source.state === "active");
  const query = debit?.accountId ? { accountId: debit.accountId } : {};
  const read = useApi(funds.getFundMovementCandidates, { params: { id: settings.fund.id }, query });
  if (settings.fund.state === "archived") return [];
  return movementOptions(read.data?.movements ?? [], say);
}

function SettingsBody({
  settings,
  say,
  accounts,
}: {
  settings: Settings;
  say: Say;
  accounts: readonly { id: string; name: string }[];
}) {
  const t = useTranslations("funds");
  const { fund } = settings;
  const archived = fund.state === "archived";
  const movements = useMovements(settings, say);
  return (
    <SettingsGrid>
      <Anchor id="general">
        <SettingsSection title={t("settings.general.title")} description={t("settings.general.description")}>
          <FundSettingsForm
            fundId={fund.id}
            form={{
              name: fund.name,
              provider: fund.provider ?? "",
              compartment: fund.compartment ?? "",
              startOn: fund.startOn,
              code: fund.code ?? "",
            }}
            currency={fund.currency}
            today={say.todayOn}
            readOnly={archived}
          />
          <p className="flex flex-wrap items-center gap-x-2 border-t border-border pt-3 text-sm">
            <span>{t("settings.general.valueAccount", { account: fund.accountName })}</span>
            <Link
              href={`/accounts/${fund.accountId}?tab=settings` as Route}
              className="focus-ring inline-flex min-h-6 items-center rounded-xs font-medium text-accent hover:underline"
            >
              {t("settings.general.openAccount", { account: fund.accountName })}
            </Link>
          </p>
        </SettingsSection>
      </Anchor>

      <Anchor id="sources" testId="fund-sources">
        <SettingsSection title={t("sources.title")} description={t("sources.description")}>
          <FundSourcesSection settings={settings} say={say} accounts={accounts} movements={movements} />
        </SettingsSection>
      </Anchor>

      <Anchor id="fees" testId="fund-fees">
        <SettingsSection title={t("fees.title")} description={t("fees.description")}>
          <FundFeesSection settings={settings} say={say} />
        </SettingsSection>
      </Anchor>

      <Anchor id="danger">
        <SettingsSection title={t("settings.danger.title")} description={t("settings.danger.description")}>
          <p className="text-sm">{t("settings.danger.text", { name: fund.name })}</p>
          {/* A button is as wide as its label: a section's children stretch, and an «Archive fund»
              drawn across the whole card reads as a banner, not as a command. */}
          <div className="flex">
            {archived ? (
              <FundStateButton
                fundId={fund.id}
                state="active"
                label={t("settings.danger.restore")}
                toast={t("toasts.restored")}
              />
            ) : (
              <FundStateButton
                fundId={fund.id}
                state="archived"
                label={t("settings.danger.archive")}
                toast={t("toasts.archived")}
              />
            )}
          </div>
        </SettingsSection>
      </Anchor>
    </SettingsGrid>
  );
}

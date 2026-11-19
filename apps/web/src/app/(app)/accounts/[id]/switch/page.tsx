import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getAccount } from "@ledgerly/domain/accounts";
import { openSwitchOf } from "@ledgerly/domain/accounts";
import { SwitchCheck } from "@/modules/accounts/ui/switch/switch-check";
import { UndoSwitch } from "@/modules/accounts/ui/switch/undo-switch";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn } from "@ledgerly/domain/shared/dates";
import { formatDate } from "@ledgerly/domain/platform/format";
import { labelOf } from "@/platform/integrations/registry";
import { listConnections } from "@ledgerly/domain/platform/integrations";
import { findInstancePlugin, isPluginActive } from "@ledgerly/domain/platform/plugins";
import { maskIdentifier } from "@ledgerly/domain/platform/plugins";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { Page } from "@ledgerly/ui/shell/page";
import { StepIndicator } from "@ledgerly/ui/step-indicator";
import { BANK_PLUGIN_ID } from "../../../banks/plugin";
import { freeBankAccounts, switchable } from "./switch";
import { SwitchChoices } from "./switch-choices";

export const metadata: Metadata = { title: "Switch account" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * "Move an account to the bank" (ux/n4-account-switch.md §3): one account, three steps in the URL.
 * The step "Account" is a plain form; the step "Check" runs the dry run in the browser's request;
 * the step "Done" reads the switch that "Apply" recorded. Nothing is saved before "Apply".
 */
export default async function SwitchAccountPage({
  params,
  searchParams,
}: PageProps<"/accounts/[id]/switch">) {
  const ctx = await requireSession();
  const { id } = await params;
  const query = await searchParams;
  // An id that is not one is an account that does not exist.
  const account = UUID.test(id) ? await getAccount(ctx, id) : null;
  if (!account) notFound();
  const plugin = await findInstancePlugin(BANK_PLUGIN_ID);
  if (!plugin || !(await isPluginActive(ctx, BANK_PLUGIN_ID))) notFound();

  const t = await getTranslations("accounts.switch");
  const settings = `/accounts/${account.id}?tab=settings` as Route;
  const here = `/accounts/${account.id}/switch` as Route;
  const step = one(query.step) ?? "account";
  const open = await openSwitchOf(ctx, account.id);
  if (open !== null && step !== "done") redirect(settings);
  if (open === null && (step === "done" || !switchable(account))) redirect(settings);
  const source = (
    await labelOf(
      { provider: (open?.fromProvider ?? account.provider) as string, instanceKey: "" },
      ctx.locale,
    )
  ).name;

  const frame = (current: "account" | "check" | "done", body: React.ReactNode) => (
    <Page title={t("title", { account: account.name })} parent={{ href: settings, label: account.name }}>
      <div className="flex w-full flex-col gap-3">
        <StepIndicator
          label={t("steps.label")}
          steps={[
            { id: "account", label: t("steps.account"), href: here },
            { id: "check", label: t("steps.check"), href: here },
            { id: "done", label: t("steps.done"), href: here },
          ]}
          current={current}
          doneLabel={t("steps.completed")}
        />
        {body}
      </div>
    </Page>
  );

  if (step === "done" && open !== null) {
    const counts = open.counts as Record<string, number>;
    const since = formatDate(civilDateIn(open.appliedAt, ctx.timeZone), "long", ctx.locale);
    const sourceThere = (await listConnections(ctx)).some((one) => one.provider === open.fromProvider);
    return frame(
      "done",
      <Card className="flex flex-col gap-3">
        <h1 tabIndex={-1} className="text-xl font-semibold">
          {t("done.title", { account: account.name })}
        </h1>
        <ul className="flex flex-col gap-1 text-sm">
          <li>{t("done.matched", { count: counts.matched ?? 0 })}</li>
          <li>{t("done.fresh", { count: counts.fresh ?? 0 })}</li>
          {(counts.transfers ?? 0) > 0 && <li>{t("done.transfers", { count: counts.transfers ?? 0 })}</li>}
          {(counts.joined ?? 0) > 0 && <li>{t("done.joined", { count: counts.joined ?? 0 })}</li>}
        </ul>
        <p className="text-sm text-muted">{t("done.sourceStops", { source })}</p>
        <p className="text-sm text-muted">{t("done.howToUndo")}</p>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <UndoSwitch
            account={account.name}
            source={source}
            bank={t("done.theBank")}
            since={since}
            transfers={counts.transfers ?? 0}
            publishes={(open.interestModes ?? []).length > 0}
            joined={
              open.mergedAccountId === null
                ? null
                : ((await getAccount(ctx, open.mergedAccountId))?.name ?? null)
            }
            available={sourceThere}
            accountId={account.id}
          />
          <ButtonLink href={`/accounts/${account.id}` as Route} variant="primary">
            {t("done.goToAccount")}
          </ButtonLink>
        </div>
      </Card>,
    );
  }

  const target = one(query.t);
  if (step === "check" && target !== null && target.includes(":")) {
    const [connectionId, ...rest] = target.split(":");
    const bankAccountId = rest.join(":");
    const where = { connectionId, bankAccountId };
    return frame(
      "check",
      <SwitchCheck
        account={account.name}
        source={source}
        numberFormat={ctx.numberFormat}
        locale={ctx.locale}
        accountId={account.id}
        target={where}
        leaveHref={settings}
        doneHref={`${here}?step=done` as Route}
      />,
    );
  }

  // Step "Account" (§4): the choices are read from `/api/v1`. Their masked identifier is read here,
  // since no answer carries an IBAN, even masked (H45); the names are the API's, so `String`.
  const banks = await freeBankAccounts(ctx, account.id, account.currency, String);
  const masked = Object.fromEntries(
    banks.flatMap((bank) =>
      bank.accounts.map((choice) => [
        `${bank.connectionId}:${choice.providerAccountId}`,
        maskIdentifier(choice.identifier),
      ]),
    ),
  );
  return frame(
    "account",
    <SwitchChoices
      account={{ id: account.id, name: account.name, currency: account.currency }}
      settings={settings}
      here={here}
      masked={masked}
    />,
  );
}

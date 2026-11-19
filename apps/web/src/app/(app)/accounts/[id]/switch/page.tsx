import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getAccount } from "@ledgerly/domain/accounts";
import { openSwitchOf } from "@ledgerly/domain/accounts";
import { SwitchCheck } from "@/modules/accounts/ui/switch/switch-check";
import { requireSession } from "@/platform/auth/session";
import { labelOf } from "@/platform/integrations/registry";
import { findInstancePlugin, isPluginActive } from "@ledgerly/domain/platform/plugins";
import { maskIdentifier } from "@ledgerly/domain/platform/plugins";
import { Page } from "@ledgerly/ui/shell/page";
import { StepIndicator } from "@ledgerly/ui/step-indicator";
import { BANK_PLUGIN_ID } from "../../../banks/plugin";
import { freeBankAccounts, switchable } from "./switch";
import { SwitchChoices } from "./switch-choices";
import { SwitchDone } from "./switch-done";

export const metadata: Metadata = { title: "Switch account" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function one(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * "Move an account to the bank" (ux/n4-account-switch.md §3): one account, three steps in the URL.
 * The step "Account" is a plain form; the step "Check" runs the dry run in the browser's request;
 * the step "Done" reads the switch that "Apply" recorded, from `/api/v1`. Nothing is saved before "Apply".
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
    return frame("done", <SwitchDone account={{ id: account.id, name: account.name }} />);
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
  // decided: the IBAN decision is open, the masked identifier is read on the server.
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

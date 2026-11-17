import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { getAccount } from "@/modules/accounts/queries";
import { openSwitchOf } from "@/modules/accounts/switching";
import { SwitchCheck } from "@/modules/accounts/ui/switch/switch-check";
import { UndoSwitch } from "@/modules/accounts/ui/switch/undo-switch";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn } from "@/platform/dates";
import { formatDate } from "@/platform/format";
import { normalizeIban } from "@/platform/iban";
import { labelOf } from "@/platform/integrations/registry";
import { listConnections } from "@/platform/integrations/service";
import { findInstancePlugin, isPluginActive } from "@/platform/plugins/queries";
import { maskIdentifier } from "@/platform/plugins/rules";
import { Badge } from "@/ui/badge";
import { Button, ButtonLink } from "@/ui/button";
import { Card } from "@/ui/card";
import { Page } from "@/ui/shell/page";
import { EmptyState } from "@/ui/states";
import { StepIndicator } from "@/ui/step-indicator";
import { BANK_PLUGIN_ID } from "../../../banks/plugin";
import { applySwitchAction, checkSwitchAction, undoSwitchAction } from "./actions";
import { freeBankAccounts, switchable } from "./switch";

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

  const frame = (current: "account" | "check" | "done", body: React.ReactNode, wide = false) => (
    <Page title={t("title", { account: account.name })} parent={{ href: settings, label: account.name }}>
      <div className={`flex w-full flex-col gap-3 ${wide ? "max-w-[880px]" : "max-w-[560px]"}`}>
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
            available={sourceThere}
            undo={undoSwitchAction.bind(null, account.id)}
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
        commands={{
          check: checkSwitchAction.bind(null, account.id, where),
          apply: async (fingerprint: string) => {
            "use server";
            return applySwitchAction(account.id, { ...where, fingerprint });
          },
        }}
        leaveHref={settings}
        doneHref={`${here}?step=done` as Route}
      />,
      true,
    );
  }

  // Step "Account" (§4): the accounts of the person's banks not yet in Ledgerly, in its currency.
  const banks = await freeBankAccounts(ctx, account.currency);
  const own = account.iban;
  const choices = banks.flatMap((bank) => bank.accounts);
  if (banks.length === 0 || choices.length === 0) {
    return frame(
      "account",
      banks.length === 0 ? (
        <EmptyState
          title={t("account.noBank")}
          description={t("account.noBankText")}
          actions={<ButtonLink href={"/banks/connect" as Route}>{t("account.connect")}</ButtonLink>}
        />
      ) : (
        <EmptyState
          title={t("account.noFree")}
          description={t("account.noFreeText", { currency: account.currency })}
          actions={
            <ButtonLink href={"/settings/integrations" as Route}>{t("account.integrations")}</ButtonLink>
          }
        />
      ),
    );
  }
  const sameIban = (identifier: string | null) => own !== null && normalizeIban(identifier) === own;
  const otherIban = (identifier: string | null) =>
    own !== null && normalizeIban(identifier) !== null && normalizeIban(identifier) !== own;
  const preselected =
    choices.find((choice) => sameIban(choice.identifier)) ??
    (choices.filter((choice) => !otherIban(choice.identifier)).length === 1
      ? choices.find((choice) => !otherIban(choice.identifier))
      : undefined);
  return frame(
    "account",
    <Card>
      <form method="get" action={here} className="flex flex-col gap-3.5">
        <input type="hidden" name="step" value="check" />
        <fieldset className="flex flex-col gap-3">
          <legend className="text-xl font-semibold">
            {t("account.question", { account: account.name })}
          </legend>
          <p className="text-sm text-muted">{t("account.explain", { currency: account.currency })}</p>
          {banks.map((bank) => (
            <fieldset key={bank.connectionId} className="flex flex-col gap-1.5">
              <legend className="font-medium">{bank.bank}</legend>
              {bank.expired && (
                <p className="text-sm text-warn">{t("account.expired", { bank: bank.bank })}</p>
              )}
              {bank.accounts.map((choice) => {
                const value = `${bank.connectionId}:${choice.providerAccountId}`;
                const disabled = bank.expired || otherIban(choice.identifier);
                const reason = `why-${choice.providerAccountId}`;
                return (
                  <label key={value} className="flex min-h-6 flex-wrap items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="t"
                      value={value}
                      required
                      disabled={disabled}
                      defaultChecked={preselected === choice && !disabled}
                      aria-describedby={disabled ? reason : undefined}
                    />
                    <span className="break-words">
                      {[
                        choice.name ?? t("account.unnamed"),
                        maskIdentifier(choice.identifier),
                        choice.currency,
                      ]
                        .filter((part) => part !== null)
                        .join(" · ")}
                    </span>
                    {sameIban(choice.identifier) && <Badge tone="pos">{t("account.sameIban")}</Badge>}
                    {otherIban(choice.identifier) && (
                      <span id={reason} className="text-muted">
                        {t("account.otherIban")}
                      </span>
                    )}
                  </label>
                );
              })}
            </fieldset>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2 max-[480px]:flex-col-reverse">
          <ButtonLink href={settings}>{t("actions.cancel")}</ButtonLink>
          <Button type="submit" variant="primary">
            {t("account.start")}
          </Button>
        </div>
      </form>
    </Card>,
  );
}

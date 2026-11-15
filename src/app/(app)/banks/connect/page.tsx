import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { balancesOn } from "@/modules/accounts/queries";
import { accountsOfProvider } from "@/modules/accounts/service";
import { movementSpanByAccount } from "@/modules/transactions/queries";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn, today } from "@/platform/dates";
import { formatDate, formatMoney } from "@/platform/format";
import { listRuns, readSyncJob } from "@/platform/integrations/service";
import {
  credentialsStatus,
  findInstancePlugin,
  isPluginActive,
  listPluginConnections,
} from "@/platform/plugins/queries";
import { institutionOf, isReturnError, maskIdentifier } from "@/platform/plugins/rules";
import { exposedAccounts } from "@/platform/plugins/sync";
import { ButtonLink } from "@/ui/button";
import { Card } from "@/ui/card";
import { Page } from "@/ui/shell/page";
import { StepIndicator } from "@/ui/step-indicator";
import { formatInstant } from "../../settings/integrations/format-instant";
import { BANK_PLUGIN_ID } from "../plugin";
import { bankSink } from "../sink";
import { AccountsStep } from "./accounts-step";
import { BankStep } from "./bank-step";
import { RenewAccess, RetryReading } from "./outcome-actions";

const SETTINGS: Route = "/settings/integrations";
const HERE: Route = "/banks/connect";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("banks.connect"))("title") };
}

function one(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** The provider's word for a kind of account, as the kind of account it becomes here. */
function typeOf(kind: string | null): string {
  if (kind === "SVGS") return "savings";
  if (kind === "CARD") return "credit";
  if (kind === "CASH") return "cash";
  return "checking";
}

/** The kinds of account a bank's account can become: the ones a bank holds. */
const BANK_ACCOUNT_TYPES = ["checking", "savings", "cash", "credit", "other"] as const;

/**
 * "Connect a bank" (ux/n1-plugin-bank.md §6): a page of its own, because the procedure leaves for
 * the bank's site and comes back. The step is in the address, so a reload keeps the place: the
 * choice of the bank, the choice of the accounts, the outcome of the reading.
 */
export default async function ConnectBankPage({ searchParams }: PageProps<"/banks/connect">) {
  const ctx = await requireSession();
  // Not turned on by this person, or not in this instance: the page does not exist (§6.1).
  const plugin = await findInstancePlugin(BANK_PLUGIN_ID);
  if (!plugin || !(await isPluginActive(ctx, BANK_PLUGIN_ID))) notFound();

  const t = await getTranslations("banks.connect");
  const accountTypes = await getTranslations("accounts.types");
  const params = await searchParams;
  const connections = await listPluginConnections(ctx, BANK_PLUGIN_ID);
  const step = one(params.step);
  const steps = [
    { id: "bank", label: t("steps.bank"), href: HERE },
    { id: "accounts", label: t("steps.accounts"), href: HERE },
    { id: "done", label: t("steps.done"), href: HERE },
  ];
  const frame = (current: "bank" | "accounts" | "done", body: React.ReactNode) => (
    <Page title={t("title")} parent={{ href: SETTINGS, label: t("parent") }}>
      <div className="flex w-full max-w-[560px] flex-col gap-3">
        <StepIndicator
          label={t("steps.label")}
          // A step already done is not a place to go back to: the access was given once.
          steps={steps.map((item) => ({ ...item, href: HERE }))}
          current={current}
          doneLabel={t("steps.completed")}
        />
        {body}
      </div>
    </Page>
  );
  const day = (instant: Date) => formatDate(civilDateIn(instant, ctx.timeZone), "long", ctx.locale);

  const connectionId = one(params.c);
  if ((step === "accounts" || step === "done") && connectionId !== null) {
    const connection = connections.find((candidate) => candidate.id === connectionId);
    if (!connection) notFound();
    const bank = institutionOf(connection.instanceKey).name;
    const target = { pluginId: BANK_PLUGIN_ID, connectionId: connection.id };
    const exposed = await exposedAccounts(ctx, target, bankSink);
    const legendOf = (account: (typeof exposed.accounts)[number]) =>
      [account.name ?? t("accounts.unnamed"), maskIdentifier(account.identifier), account.currency]
        .filter((part) => part !== null)
        .join(" · ");
    const toChoose = exposed.accounts.filter(
      (account) =>
        account.linked === null && !(exposed.chosen && exposed.skipped.includes(account.providerAccountId)),
    );

    if (step === "accounts") {
      // Nothing left to choose: the connection is complete (§6.4, "already completed").
      if (exposed.chosen && toChoose.length === 0) redirect(`${HERE}?step=done&c=${connection.id}` as Route);
      const used = new Map<string, number>();
      return frame(
        "accounts",
        <AccountsStep
          connectionId={connection.id}
          bank={bank}
          accounts={toChoose.map((account) => {
            // The bank's name of an account is often the holder's: the kind says more. Two
            // accounts of the same kind get a number, so no two names start equal.
            const type = typeOf(account.kind);
            const count = (used.get(type) ?? 0) + 1;
            used.set(type, count);
            const label = accountTypes(type as (typeof BANK_ACCOUNT_TYPES)[number]);
            return {
              providerAccountId: account.providerAccountId,
              legend: legendOf(account),
              currency: account.currency,
              defaultName: `${bank} ${label}${count > 1 ? ` ${count}` : ""}`.slice(0, 80),
              defaultType: type,
            };
          })}
          linked={exposed.accounts.flatMap((account) =>
            account.linked ? [{ legend: legendOf(account), account: account.linked.name }] : [],
          )}
          existing={await bankSink.openAccounts(ctx)}
          types={BANK_ACCOUNT_TYPES.map((value) => ({ value, label: accountTypes(value) }))}
          cancellable={!exposed.chosen}
        />,
      );
    }

    // The outcome (§6.6): what the last reading did, account by account.
    if (!exposed.chosen) redirect(`${HERE}?step=accounts&c=${connection.id}` as Route);
    const [run] = await listRuns(ctx, { connectionId: connection.id, limit: 1 });
    const linked = [...(await accountsOfProvider(ctx, connection.provider)).entries()];
    const ids = linked.map(([, account]) => account.id);
    const [spans, balances, job] = await Promise.all([
      movementSpanByAccount(ctx, ids),
      balancesOn(ctx, ids, today(ctx.timeZone)),
      readSyncJob(ctx, connection.id, "transactions"),
    ]);
    const stillShared = new Set(exposed.accounts.map((account) => account.providerAccountId));
    const failed = run?.state === "failed";
    const wait =
      failed && run.error === "rate_limited" && job?.cursor?.retryAfter
        ? new Date(job.cursor.retryAfter)
        : null;
    const neverRead = failed && connection.lastOkAt === null;
    return frame(
      "done",
      <Card className="flex flex-col gap-3.5">
        <h1 tabIndex={-1} className="text-xl font-semibold">
          {neverRead && wait === null
            ? t("done.syncFailedHeading", { bank })
            : one(params.renewed) === "1"
              ? t("done.renewed", { bank })
              : t("done.heading", { bank })}
        </h1>
        <ul className="flex flex-col divide-y divide-border">
          {linked.map(([providerAccountId, account]) => {
            const span = spans.get(account.id);
            return (
              <li key={account.id} className="py-2 first:pt-0 last:pb-0">
                <div className="font-medium break-words">{account.name}</div>
                <div className="text-sm text-muted">
                  {t("done.account", {
                    count: span?.count ?? 0,
                    date: span ? formatDate(span.first, "long", ctx.locale) : "",
                    balance: formatMoney(balances.get(account.id) ?? null, ctx.numberFormat, {
                      currency: account.currency,
                    }),
                  })}
                </div>
                {!stillShared.has(providerAccountId) && (
                  <div className="text-sm text-muted">{t("done.accountGone")}</div>
                )}
              </li>
            );
          })}
        </ul>
        {wait !== null ? (
          <p className="rounded-ctl bg-warn-bg px-3 py-2 text-sm text-warn">
            {t("done.rateLimited", { time: formatInstant(wait, ctx) })}
          </p>
        ) : failed ? (
          <p role="alert" className="text-neg">
            {t("done.syncFailed")}
          </p>
        ) : (
          (run?.counts?.accountErrors ?? 0) > 0 && <p className="text-sm text-neg">{t("done.partial")}</p>
        )}
        <p className="text-sm text-muted">
          {t("done.schedule")}{" "}
          {connection.expiresAt && t("done.validUntil", { date: day(connection.expiresAt) })}
        </p>
        <div className="flex flex-wrap justify-end gap-2 max-[480px]:flex-col-reverse">
          <ButtonLink href={SETTINGS}>{t("done.toSettings")}</ButtonLink>
          {failed && wait === null ? (
            <RetryReading connectionId={connection.id} />
          ) : (
            <ButtonLink href={"/accounts" as Route} variant="primary">
              {t("done.toAccounts")}
            </ButtonLink>
          )}
        </div>
      </Card>,
    );
  }

  const credentials = await credentialsStatus(ctx, BANK_PLUGIN_ID);
  if (!credentials.saved || credentials.invalid) {
    return frame(
      "bank",
      <Card className="flex flex-col gap-3.5">
        <h1 tabIndex={-1} className="text-xl font-semibold">
          {t("bank.heading")}
        </h1>
        <p>{credentials.saved ? t("guard.invalidKey") : t("guard.noCredentials")}</p>
        <div className="flex justify-end max-[480px]:flex-col">
          <ButtonLink
            href={(credentials.saved ? `${SETTINGS}?replace=1` : SETTINGS) as Route}
            variant="primary"
          >
            {credentials.saved ? t("guard.replaceKey") : t("guard.openSettings")}
          </ButtonLink>
        </div>
      </Card>,
    );
  }

  // "Renew access" (§6.7): no bank to choose.
  const renewing = connections.find((candidate) => candidate.id === one(params.renew));
  if (renewing) {
    const bank = institutionOf(renewing.instanceKey).name;
    return frame(
      "bank",
      <Card className="flex flex-col gap-3.5">
        <h1 tabIndex={-1} className="text-xl font-semibold">
          {t("renew.heading", { bank })}
        </h1>
        <p>{t("renew.description")}</p>
        <div className="flex flex-wrap justify-end gap-2 max-[480px]:flex-col-reverse">
          <ButtonLink href={SETTINGS}>{t("renew.cancel")}</ButtonLink>
          <RenewAccess connectionId={renewing.id} bank={bank} />
        </div>
      </Card>,
    );
  }
  // Until N2 a person connects one bank (§5.5): with one connected there is nothing to choose.
  if (connections.length > 0) redirect(SETTINGS);

  const regions = new Intl.DisplayNames([ctx.locale], { type: "region" });
  const countries = (
    plugin.manifest.connectionFields.find((field) => field.name === "country")?.options ?? []
  )
    .map((option) => ({ code: option.value, name: regions.of(option.value) ?? option.value }))
    .sort((a, b) => a.name.localeCompare(b.name, ctx.locale));
  if (countries.length === 0) notFound();
  const home = ctx.locale === "it" ? "IT" : null;
  const error = one(params.error);

  return frame(
    "bank",
    <BankStep
      countries={countries}
      defaultCountry={
        countries.some((country) => country.code === home) ? (home as string) : countries[0].code
      }
      returned={isReturnError(error) ? { error, bank: one(params.bank)?.slice(0, 200) ?? null } : null}
    />,
  );
}

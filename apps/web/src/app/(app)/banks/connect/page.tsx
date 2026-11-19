import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { readingsAt, listAccounts } from "@ledgerly/domain/accounts";
import { openSwitchOf } from "@ledgerly/domain/accounts";
import { labelOf } from "@/platform/integrations/registry";
import { switchable } from "../../accounts/[id]/switch/switch";

type Ctx = Awaited<ReturnType<typeof requireSession>>;
import { categoryCounts } from "@ledgerly/domain/transactions";
import { listCategories } from "@ledgerly/domain/transactions";
import { accountsOfProvider } from "@ledgerly/domain/accounts";
import { movementSpanByAccount } from "@ledgerly/domain/transactions";
import { withParams } from "@/ui/url";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn, today } from "@ledgerly/domain/shared/dates";
import { formatDate, formatMoney } from "@ledgerly/domain/platform/format";
import { listRuns, readSyncJob } from "@ledgerly/domain/platform/integrations";
import {
  credentialsStatus,
  findInstancePlugin,
  isPluginActive,
  listPluginConnections,
} from "@ledgerly/domain/platform/plugins";
import {
  bankAccountNames,
  bankAccountType,
  institutionOf,
  isReturnError,
  maskIdentifier,
} from "@ledgerly/domain/platform/plugins";
import { exposedAccounts } from "@ledgerly/plugin-host";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { Page } from "@ledgerly/ui/shell/page";
import { StepIndicator } from "@ledgerly/ui/step-indicator";
import { formatInstant } from "@ledgerly/format/format";
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
      <div className="flex w-full flex-col gap-3">
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
    // The same name here, in "Switch to the bank" and as the name of a new account.
    const names = bankAccountNames(exposed.accounts, bank, (type) => accountTypes(type));
    const nameOf = (account: (typeof exposed.accounts)[number]) =>
      names.get(account.providerAccountId) ?? t("accounts.unnamed");
    const legendOf = (account: (typeof exposed.accounts)[number]) =>
      [nameOf(account), maskIdentifier(account.identifier), account.currency]
        .filter((part) => part !== null)
        .join(" · ");
    // `all=1` (the menu of the integration's row): the accounts left out before are offered too,
    // so one can be chosen later; a deleted account is no longer tied and is offered anyway.
    const offerSkipped = one(params.all) === "1";
    const toChoose = exposed.accounts.filter(
      (account) =>
        account.linked === null &&
        (offerSkipped || !(exposed.chosen && exposed.skipped.includes(account.providerAccountId))),
    );

    if (step === "accounts") {
      // Nothing left to choose: the connection is complete (§6.4, "already completed").
      if (exposed.chosen && toChoose.length === 0) redirect(`${HERE}?step=done&c=${connection.id}` as Route);
      // An account of the bank whose IBAN an account here has is not added twice (H39, §2.4.2).
      const owners = await bankSink.ibanOwners(
        ctx,
        toChoose.map((account) => account.identifier),
      );
      return frame(
        "accounts",
        <AccountsStep
          connectionId={connection.id}
          bank={bank}
          accounts={toChoose.map((account) => ({
            providerAccountId: account.providerAccountId,
            legend: legendOf(account),
            currency: account.currency,
            defaultName: nameOf(account),
            defaultType: bankAccountType(account.kind),
            ibanOwner: account.identifier === null ? null : (owners.get(account.identifier) ?? null),
          }))}
          linked={exposed.accounts.flatMap((account) =>
            account.linked ? [{ legend: legendOf(account), account: account.linked.name }] : [],
          )}
          existing={await bankSink.openAccounts(ctx)}
          sameAs={await sameAsChoices(ctx)}
          types={BANK_ACCOUNT_TYPES.map((value) => ({ value, label: accountTypes(value) }))}
          cancellable={!exposed.chosen}
        />,
      );
    }

    // The outcome (§6.6): what the last reading did, account by account.
    if (!exposed.chosen) redirect(`${HERE}?step=accounts&c=${connection.id}` as Route);
    const [run] = await listRuns(ctx, { connectionId: connection.id, limit: 1 });
    const stillShared = new Set(exposed.accounts.map((account) => account.providerAccountId));
    // With more than one bank the provider's accounts are of several banks: this bank's are the
    // ones its access shares. With one bank they are all its own, also one it no longer shares.
    const linked = [...(await accountsOfProvider(ctx, connection.provider)).entries()].filter(
      ([providerAccountId]) => connections.length <= 1 || stillShared.has(providerAccountId),
    );
    const ids = linked.map(([, account]) => account.id);
    const [spans, balances, job] = await Promise.all([
      movementSpanByAccount(ctx, ids),
      readingsAt(ctx, ids, today(ctx.timeZone)),
      readSyncJob(ctx, connection.id, "transactions"),
    ]);
    // How the movements of this bank stand after the cascade read them (rewrite plan N3).
    const [categoryState, ownCategories] = await Promise.all([categoryCounts(ctx, ids), listCategories(ctx)]);
    const waiting = categoryState.suggested + categoryState.open;
    const read = categoryState.categorised + waiting;
    const reviewHref = withParams("/expenses/review", {}, { guide: "1", acc: ids.join(","), bank });
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
        {Number(one(params.back)) > 0 && (
          <p role="status" className="text-sm text-muted">
            {(await getTranslations("settings.plugin"))("reactivate.back", {
              count: Math.min(Number(one(params.back)), 999),
              provider: bank,
            })}
          </p>
        )}
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
        {(await toSwitchFrom(ctx, one(params.same), exposed.accounts, names)).map((row) => (
          <div key={row.bankAccountId} className="flex flex-col gap-1 border-t border-border pt-2">
            <div className="font-medium break-words">{row.legend}</div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted">
                {t("accounts.switchTitle", { account: row.account })}
              </span>
              <ButtonLink
                href={
                  `/accounts/${row.accountId}/switch?step=check&t=${connection.id}:${row.bankAccountId}` as Route
                }
                variant="primary"
                size="sm"
              >
                {t("accounts.switchAction")}
              </ButtonLink>
            </div>
          </div>
        ))}
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
        {read > 0 && (
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <h2 className="font-semibold">{t("done.categories.title")}</h2>
            <p className="text-sm text-muted">
              {waiting === 0
                ? t("done.categories.all", { count: read })
                : ownCategories.length === 0
                  ? t("done.categories.noGroups", { count: read })
                  : t("done.categories.summary", {
                      done: categoryState.categorised,
                      suggested: categoryState.suggested,
                      open: categoryState.open,
                    })}
            </p>
          </div>
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
            <>
              <ButtonLink href={"/accounts" as Route} variant={waiting > 0 ? "secondary" : "primary"}>
                {t("done.toAccounts")}
              </ButtonLink>
              {waiting > 0 && (
                <ButtonLink href={reviewHref} variant="primary">
                  {t("done.categories.action")}
                </ButtonLink>
              )}
            </>
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

/** The person's accounts that come from another source and may be moved to the bank (ux/n4-account-switch.md §2.1). */
async function sameAsChoices(ctx: Ctx) {
  const all = await listAccounts(ctx);
  const choices = [];
  for (const account of all.filter(switchable)) {
    if ((await openSwitchOf(ctx, account.id)) !== null) continue;
    const source = (await labelOf({ provider: account.provider as string, instanceKey: "" }, ctx.locale))
      .name;
    choices.push({ id: account.id, name: account.name, currency: account.currency, source });
  }
  return choices;
}

/** The accounts chosen as "the same account as…", from the address of the outcome: nothing was saved. */
async function toSwitchFrom(
  ctx: Ctx,
  list: string | null,
  exposed: readonly {
    providerAccountId: string;
    identifier: string | null;
    currency: string;
    linked: unknown;
  }[],
  names: ReadonlyMap<string, string>,
) {
  if (list === null) return [];
  const mine = new Map((await listAccounts(ctx)).filter(switchable).map((account) => [account.id, account]));
  return list.split(",").flatMap((pair) => {
    const at = pair.lastIndexOf(".");
    const bankAccountId = pair.slice(0, at);
    const accountId = pair.slice(at + 1);
    const bankAccount = exposed.find((one) => one.providerAccountId === bankAccountId && one.linked === null);
    const account = mine.get(accountId);
    if (!bankAccount || !account) return [];
    const legend = [names.get(bankAccountId) ?? null, maskIdentifier(bankAccount.identifier)]
      .filter((part) => part !== null)
      .join(" · ");
    return [{ bankAccountId, accountId, account: account.name, legend }];
  });
}

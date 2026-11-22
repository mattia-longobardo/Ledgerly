import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { connections as connectionRoutes, sources } from "@ledgerly/api-contract/settings";
import { ApiError, type RouteInput, type RouteOutput } from "@ledgerly/api-client";
import { civilDateIn } from "@ledgerly/domain/shared/dates";
import { parseCents } from "@ledgerly/format/cents";
import { formatDate, formatInstant, formatMoney } from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { Page } from "@ledgerly/ui/shell/page";
import { StepIndicator } from "@ledgerly/ui/step-indicator";
import { withParams } from "@ledgerly/ui/url";
import { apiRead } from "@/platform/api-read";
import { requireSession } from "@/platform/auth/session";
import { BANK_PLUGIN_ID } from "../plugin";
import { AccountsStep } from "./accounts-step";
import { BankStep } from "./bank-step";
import { RenewAccess, RetryReading } from "./outcome-actions";
import { isBankStepError } from "./return-errors";

const SETTINGS: Route = "/settings/plugins";
const HERE: Route = "/banks/connect";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("banks.connect"))("title") };
}

function one(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/**
 * A read of the procedure from `/api/v1`: `null` is a 404; the conflict the route names (`complete`,
 * `not_chosen`) is the step to go to instead.
 */
async function stepRead<R extends Parameters<typeof apiRead>[0]>(
  route: R,
  input: RouteInput<R>,
  elsewhere: { reason: string; href: Route },
): Promise<RouteOutput<R>> {
  try {
    const answer = await apiRead(route, input);
    if (answer === null) notFound();
    return answer;
  } catch (error) {
    if (error instanceof ApiError && error.status === 409 && error.reason === elsewhere.reason)
      redirect(elsewhere.href);
    throw error;
  }
}

/** The kinds of account a bank's account can become: the ones a bank holds. */
const BANK_ACCOUNT_TYPES = ["checking", "savings", "cash", "credit", "other"] as const;

/**
 * "Connect a bank" (ux/n1-plugin-bank.md §6): a page of its own, because the procedure leaves for
 * the bank's site and comes back. The step is in the address, so a reload keeps the place: the
 * choice of the bank, the choice of the accounts, the outcome of the reading. Every step reads
 * `/api/v1` (`apiRead`): its 404 and its redirects stay the server's.
 */
export default async function ConnectBankPage({ searchParams }: PageProps<"/banks/connect">) {
  const ctx = await requireSession();
  // Not turned on by this person, or not in this instance: the page does not exist (§6.1).
  const plugin = (await apiRead(sources.listPlugins, {}))?.plugins.find((one) => one.id === BANK_PLUGIN_ID);
  if (!plugin || plugin.state !== "active") notFound();

  const t = await getTranslations("banks.connect");
  const accountTypes = await getTranslations("accounts.types");
  const params = await searchParams;
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
  const day = (instant: string) =>
    formatDate(civilDateIn(new Date(instant), ctx.timeZone), "long", ctx.locale);

  const connectionId = one(params.c);
  if (step === "accounts" && connectionId !== null) {
    const choice = await stepRead(
      sources.getBankChoice,
      { params: { id: connectionId }, query: { all: one(params.all) === "1" ? "1" : undefined } },
      // Nothing left to choose: the connection is complete (§6.4, "already completed").
      { reason: "complete", href: `${HERE}?step=done&c=${connectionId}` as Route },
    );
    return frame(
      "accounts",
      <AccountsStep
        connectionId={connectionId}
        bank={choice.bank}
        accounts={choice.accounts}
        linked={choice.linked}
        existing={choice.existing}
        sameAs={choice.sameAs}
        types={BANK_ACCOUNT_TYPES.map((value) => ({ value, label: accountTypes(value) }))}
        cancellable={!choice.chosen}
      />,
    );
  }

  if (step === "done" && connectionId !== null) {
    // The outcome (§6.6): what the last reading did, account by account.
    const outcome = await stepRead(
      sources.getBankOutcome,
      { params: { id: connectionId }, query: { same: one(params.same) ?? undefined } },
      { reason: "not_chosen", href: `${HERE}?step=accounts&c=${connectionId}` as Route },
    );
    const { bank, reading, categories } = outcome;
    const reviewHref = withParams(
      "/expenses/review",
      {},
      { guide: "1", acc: outcome.reviewAccountIds.join(","), bank },
    );
    const wait = reading.retryAfter;
    return frame(
      "done",
      <Card className="flex flex-col gap-3.5">
        <h1 tabIndex={-1} className="text-xl font-semibold">
          {reading.neverRead && wait === null
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
          {outcome.accounts.map((account) => (
            <li key={account.id} className="py-2 first:pt-0 last:pb-0">
              <div className="font-medium break-words">{account.name}</div>
              <div className="text-sm text-muted">
                {t("done.account", {
                  count: account.movements,
                  date: account.firstOn ? formatDate(account.firstOn, "long", ctx.locale) : "",
                  balance: formatMoney(
                    account.balance === null ? null : parseCents(account.balance),
                    ctx.numberFormat,
                    { currency: account.currency },
                  ),
                })}
              </div>
              {!account.shared && <div className="text-sm text-muted">{t("done.accountGone")}</div>}
            </li>
          ))}
        </ul>
        {outcome.switches.map((row) => (
          <div key={row.bankAccountId} className="flex flex-col gap-1 border-t border-border pt-2">
            <div className="font-medium break-words">{row.legend}</div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-muted">
                {t("accounts.switchTitle", { account: row.account })}
              </span>
              <ButtonLink
                href={
                  `/accounts/${row.accountId}/switch?step=check&t=${connectionId}:${row.bankAccountId}` as Route
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
            {t("done.rateLimited", { time: formatInstant(new Date(wait), ctx) })}
          </p>
        ) : reading.failed ? (
          <p role="alert" className="text-neg">
            {t("done.syncFailed")}
          </p>
        ) : (
          reading.accountErrors > 0 && <p className="text-sm text-neg">{t("done.partial")}</p>
        )}
        {categories.read > 0 && (
          <div className="flex flex-col gap-1 border-t border-border pt-3">
            <h2 className="font-semibold">{t("done.categories.title")}</h2>
            <p className="text-sm text-muted">
              {categories.waiting === 0
                ? t("done.categories.all", { count: categories.read })
                : !categories.any
                  ? t("done.categories.noGroups", { count: categories.read })
                  : t("done.categories.summary", {
                      done: categories.categorised,
                      suggested: categories.suggested,
                      open: categories.open,
                    })}
            </p>
          </div>
        )}
        <p className="text-sm text-muted">
          {t("done.schedule")} {outcome.expiresAt && t("done.validUntil", { date: day(outcome.expiresAt) })}
        </p>
        <div className="flex flex-wrap justify-end gap-2 max-[480px]:flex-col-reverse">
          <ButtonLink href={SETTINGS}>{t("done.toSettings")}</ButtonLink>
          {reading.failed && wait === null ? (
            <RetryReading connectionId={connectionId} />
          ) : (
            <>
              <ButtonLink
                href={"/accounts" as Route}
                variant={categories.waiting > 0 ? "secondary" : "primary"}
              >
                {t("done.toAccounts")}
              </ButtonLink>
              {categories.waiting > 0 && (
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

  const { credentials } = plugin;
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
  const renew = one(params.renew);
  const renewing =
    renew === null
      ? undefined
      : (await apiRead(connectionRoutes.listConnections, {}))?.connections.find(
          (candidate) => candidate.id === renew && candidate.provider === `plugin:${BANK_PLUGIN_ID}`,
        );
  if (renewing) {
    const bank = renewing.name;
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
  const countries = plugin.countries
    .map((code) => ({ code, name: regions.of(code) ?? code }))
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
      returned={isBankStepError(error) ? { error, bank: one(params.bank)?.slice(0, 200) ?? null } : null}
    />,
  );
}

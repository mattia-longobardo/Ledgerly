import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/platform/auth/session";
import type { Ctx } from "@/platform/context";
import { civilDateIn } from "@/platform/dates";
import { formatDate } from "@/platform/format";
import { listRuns } from "@/platform/integrations/service";
import {
  credentialsStatus,
  findInstancePlugin,
  isPluginActive,
  listPluginConnections,
} from "@/platform/plugins/queries";
import { institutionOf, isReturnError } from "@/platform/plugins/rules";
import { ButtonLink } from "@/ui/button";
import { Card } from "@/ui/card";
import { Page } from "@/ui/shell/page";
import { StepIndicator } from "@/ui/step-indicator";
import { BANK_PLUGIN_ID } from "../plugin";
import { BankStep } from "./bank-step";

const SETTINGS: Route = "/settings/integrations";
const HERE: Route = "/banks/connect";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("banks.connect"))("title") };
}

function one(value: string | string[] | undefined): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** A day number of a reading's measures (`20250110`) as a date of the person's locale. */
function measuredDay(value: number | undefined, ctx: Pick<Ctx, "locale">): string | null {
  if (value === undefined) return null;
  const text = String(value);
  return formatDate(`${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`, "long", ctx.locale);
}

/**
 * "Connect a bank" (ux/n1-plugin-bank.md §6): a page of its own, because the procedure leaves for
 * the bank's site and comes back. The step is in the address, so a reload keeps the place.
 *
 * Step 1 of N1 (the trial on a real bank) has two steps here: the choice of the bank, and the
 * outcome of the first reading as numbers. The choice of the accounts joins with the rest of N1.
 */
export default async function ConnectBankPage({ searchParams }: PageProps<"/banks/connect">) {
  const ctx = await requireSession();
  // Not turned on by this person, or not in this instance: the page does not exist (§6.1).
  if (!(await findInstancePlugin(BANK_PLUGIN_ID)) || !(await isPluginActive(ctx, BANK_PLUGIN_ID))) notFound();

  const t = await getTranslations("banks.connect");
  const params = await searchParams;
  const connections = await listPluginConnections(ctx, BANK_PLUGIN_ID);
  const connectionId = one(params.c);
  const done = one(params.step) === "done" && connectionId !== null;
  const steps = [
    { id: "bank", label: t("steps.bank"), href: HERE },
    { id: "done", label: t("steps.done"), href: HERE },
  ];
  const frame = (current: "bank" | "done", body: React.ReactNode) => (
    <Page title={t("title")} parent={{ href: SETTINGS, label: t("parent") }}>
      <div className="flex w-full max-w-[560px] flex-col gap-3">
        <StepIndicator
          label={t("steps.label")}
          steps={steps}
          current={current}
          doneLabel={t("steps.completed")}
        />
        {body}
      </div>
    </Page>
  );

  if (done) {
    const connection = connections.find((candidate) => candidate.id === connectionId);
    if (!connection) notFound();
    const bank = institutionOf(connection.instanceKey).name;
    const [run] = await listRuns(ctx, { connectionId: connection.id, limit: 1 });
    const counts = run?.counts ?? {};
    const since = measuredDay(counts.oldestBooking, ctx);
    return frame(
      "done",
      <Card className="flex flex-col gap-3.5">
        <h1 tabIndex={-1} className="text-xl font-semibold">
          {t("done.heading", { bank })}
        </h1>
        {run?.state === "success" ? (
          <ul className="flex flex-col gap-1">
            <li>{t("trial.accounts", { count: counts.accounts ?? 0 })}</li>
            <li>
              {since === null
                ? t("trial.noTransactions")
                : t("trial.transactions", { count: counts.transactions ?? 0, date: since })}
            </li>
          </ul>
        ) : (
          <p role="alert" className="text-neg">
            {t("trial.failed")}
          </p>
        )}
        <p className="text-sm text-muted">{t("trial.note")}</p>
        {connection.expiresAt && (
          <p className="text-sm text-muted">
            {t("done.validUntil", {
              date: formatDate(civilDateIn(connection.expiresAt, ctx.timeZone), "long", ctx.locale),
            })}
          </p>
        )}
        <div className="flex justify-end max-[480px]:flex-col">
          <ButtonLink href={SETTINGS} variant="primary">
            {t("done.toSettings")}
          </ButtonLink>
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
  // Until N2 a person connects one bank (§5.5): with one connected there is nothing to choose.
  if (connections.length > 0) redirect(SETTINGS);

  const plugin = await findInstancePlugin(BANK_PLUGIN_ID);
  const regions = new Intl.DisplayNames([ctx.locale], { type: "region" });
  const countries = (
    plugin?.manifest.connectionFields.find((field) => field.name === "country")?.options ?? []
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

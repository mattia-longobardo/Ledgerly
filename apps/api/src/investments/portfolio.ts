// The one list of Investments on the wire (rewrite plan R5b): the application hands `portfolio` what
// accounts, investments and funds read, because no module imports another one's read model. The rows
// and the totals stand on Overview's own accounts (`accountsView`), so a subtotal of Investments is
// the subtotal of Overview's group to the cent (decision O1); the KPIs of the period are each group's
// own engine: the services' P&L (§4) and the funds' measure (§5).
import { type accountsView, bucketOf, listAccounts } from "@ledgerly/domain/accounts";
import {
  aggregateCapital,
  fundsByAccount,
  fundsExport,
  fundsHomeView,
  viewPeriod,
} from "@ledgerly/domain/funds";
import { type InvestmentsPnl, type Portfolio, portfolioMeasure } from "@ledgerly/domain/investments";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { addDays, type CivilDate, today } from "@ledgerly/domain/shared/dates";
import { convertCents, ratesOn } from "@ledgerly/domain/platform/fx";
import {
  type GroupMeasure,
  groupTotals,
  type HeldAccount,
  type Kpis,
  type PortfolioGroup,
  portfolioRows,
  portfolioView,
} from "@ledgerly/domain/portfolio";
import { type Cents } from "@ledgerly/domain/shared/money";
import { maybe, ratio } from "./dto";

type ViewRows = Awaited<ReturnType<typeof accountsView>>["rows"];

/** Each account as Overview counts it today: its bucket «investments», in the net worth, not archived. */
function heldAccounts(rows: ViewRows): HeldAccount[] {
  return rows.map((row) => ({
    accountId: row.account.id,
    name: row.account.name,
    currency: row.account.currency,
    valueCents: row.balance,
    displayCents: row.display.balance,
    counted:
      row.account.inNetWorth && row.account.state !== "archived" && bucketOf(row.account) === "investments",
  }));
}

const totalOut = (total: { total: Cents | null; partial: boolean; count: number }) => ({
  total: maybe(total.total),
  partial: total.partial,
  count: total.count,
});

/**
 * Overview's two groups of «Investments» (`GET /net-worth`): its accounts split as the home of
 * Investments splits them, and the group of each account it counts.
 */
export async function overviewGroups(ctx: Pick<Ctx, "userId">, rows: ViewRows) {
  const counted = portfolioRows(heldAccounts(rows), {
    services: new Map(),
    funds: await fundsByAccount(ctx),
  }).filter((row) => row.counted);
  return {
    groups: groupTotals(counted).map((one) => ({ id: one.group, ...totalOut(one) })),
    groupOf: new Map<string, PortfolioGroup>(counted.map((row) => [row.accountId, row.group])),
  };
}

/** The query of Funds for the period Investments measured: the same days for both groups. */
function fundsQuery(period: InvestmentsPnl["period"]) {
  if (period.kind === "all") return { period: "all" };
  if (period.kind === "custom") return { period: "custom", from: period.from!, to: period.to };
  return { period: String(period.year) };
}

/**
 * The funds' measure of the period in the display currency. Funds sums its funds without converting
 * them, so they share one currency; shortcut: converted at today's rate, and no measure for funds in
 * more than one currency — upgrade when Funds measures in the display currency itself.
 */
async function fundsMeasure(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  period: InvestmentsPnl["period"],
  currencies: ReadonlySet<string>,
  todayOn: CivilDate,
): Promise<GroupMeasure | null> {
  if (currencies.size !== 1) return null;
  const home = await fundsHomeView(ctx, viewPeriod(fundsQuery(period), todayOn));
  const { summary } = home;
  if (summary.lines.length === 0) return null;
  const [currency] = currencies;
  // The days before today too: the rate of a weekend is Friday's.
  const rates =
    currency === ctx.displayCurrency
      ? null
      : await ratesOn([ctx.displayCurrency, currency], addDays(todayOn, -7), todayOn);
  const display = (cents: Cents | null) =>
    cents === null || rates === null
      ? cents
      : convertCents(cents, currency, ctx.displayCurrency, todayOn, rates);
  const unit = display(1_000_000n);
  const capital = aggregateCapital(summary.lines);
  return {
    paidInCents: display(summary.paidInCents),
    gainCents: display(summary.gainCents),
    rate: summary.rate,
    capital:
      capital === null || summary.rate === null || unit === null
        ? null
        : (capital * Number(unit)) / 1_000_000,
    to: summary.valueTo,
  };
}

const kpisOut = (kpis: Kpis) => ({
  value: maybe(kpis.valueCents),
  valuePartial: kpis.valuePartial,
  paidIn: maybe(kpis.paidInCents),
  gain: maybe(kpis.gainCents),
  rate: ratio(kpis.rate),
  rateReason: kpis.rateReason,
});

/** `total` and `groups` of the home and of `GET /investments?include=funds`. */
export async function portfolioOut(
  ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">,
  input: { rows: ViewRows; portfolio: Pick<Portfolio, "services">; pnl: InvestmentsPnl },
) {
  const { rows, portfolio, pnl } = input;
  const funds = await fundsByAccount(ctx);
  const services = new Map(
    portfolio.services.map((one) => [
      one.account.id,
      { provider: one.investment.provider, accountOrigin: one.account.origin },
    ]),
  );
  const listed = portfolioRows(heldAccounts(rows), { services, funds });
  const fundCurrencies = new Set(
    listed.filter((row) => row.kind === "pension_fund").map((row) => row.currency),
  );
  const measured = pnl.portfolio;
  const { netFlowsCents, capital } = portfolioMeasure(measured.services);
  const view = portfolioView(listed, {
    stocks_crypto:
      measured.parts === null
        ? null
        : {
            paidInCents: netFlowsCents,
            gainCents: measured.parts.pnlCents,
            rate: measured.rate,
            capital,
            to: pnl.period.to,
          },
    pension_funds:
      fundCurrencies.size === 0 ? null : await fundsMeasure(ctx, pnl.period, fundCurrencies, pnl.todayOn),
  });
  return {
    total: kpisOut(view.total),
    groups: view.groups.map((group) => ({
      id: group.group,
      kpis: kpisOut(group.kpis),
      rows: group.rows.map((row) => ({
        kind: row.kind,
        accountId: row.accountId,
        fundId: row.fundId,
        name: row.name,
        currency: row.currency,
        value: maybe(row.valueCents),
        displayValue: maybe(row.displayCents),
        inTotal: row.counted,
      })),
    })),
  };
}

/**
 * `GET /investments/funds` and `list_funds`: the funds as the export has them (`fundsExport`, the
 * engine of the Funds pages), each on its account, in its currency and in the display one at today's
 * rate. No type: every fund is a pension fund (decision H12).
 */
export async function fundsListOut(ctx: Pick<Ctx, "userId" | "timeZone" | "displayCurrency">) {
  const todayOn = today(ctx.timeZone);
  const [funds, accounts] = await Promise.all([
    fundsExport(ctx),
    listAccounts(ctx, { includeArchived: true }),
  ]);
  const currencyOf = new Map(accounts.map((account) => [account.id, account.currency]));
  const currencies = new Set([...currencyOf.values()].filter((one) => one !== ctx.displayCurrency));
  const rates = await ratesOn(
    currencies.size === 0 ? [] : [ctx.displayCurrency, ...currencies],
    addDays(todayOn, -7),
    todayOn,
  );
  return {
    on: todayOn,
    currency: ctx.displayCurrency,
    funds: funds.map((row) => {
      const currency = currencyOf.get(row.fund.valuationAccountId) ?? ctx.displayCurrency;
      return {
        id: row.fund.id,
        accountId: row.fund.valuationAccountId,
        name: row.fund.name,
        provider: row.fund.provider,
        currency,
        value: maybe(row.valueCents),
        displayValue: maybe(
          row.valueCents === null
            ? null
            : convertCents(row.valueCents, currency, ctx.displayCurrency, todayOn, rates),
        ),
        lastValuation: row.lastValuation,
        paidIn: maybe(row.paidInCents),
        gain: maybe(row.gainCents),
        state: row.fund.state,
      };
    }),
  };
}

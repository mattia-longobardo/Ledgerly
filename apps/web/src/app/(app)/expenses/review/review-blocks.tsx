"use client";

// The blocks of «To review» under its heading: the period and the accounts, the groups and the single
// movements, or the state that takes their place. Every count and amount is a field of the API.
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { movements, review as reviewRoutes } from "@ledgerly/api-contract/transactions";
import type { RouteOutput } from "@ledgerly/api-client";
import { parseCents } from "@ledgerly/format/cents";
import type { CivilDate } from "@ledgerly/format/dates";
import {
  formatDate,
  formatMoney,
  NULL_DISPLAY,
  type NumberFormat,
  type UiLocale,
} from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import type { CategoryOption } from "@ledgerly/ui/category-picker";
import { cn } from "@ledgerly/ui/cn";
import { invalidate, useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { PeriodBar } from "@ledgerly/ui/period-bar";
import { EmptyState } from "@ledgerly/ui/states";
import type { Params } from "@ledgerly/ui/url";
import {
  CATEGORY_CALLS,
  CategoryActions,
  lineViewOf,
  PreparingCard,
  type ReviewGroupView,
  ReviewList,
  TransactionsTable,
} from "@/modules/transactions/client";
import { ExpensesTabs } from "../tabs";
import { REVIEW_PRESETS } from "./review-query";
import type { ReviewQuery } from "./review-query";

const HERE = "/expenses/review";
/** As many single movements as the server page read: the most a read of the list gives. */
const SINGLES_LIMIT = 2000;

/** Reads the review again, while its first pass runs; one function, so the card's timer keeps its start. */
const reloadReview = () => invalidate(reviewRoutes.getReview);

type Review = RouteOutput<typeof reviewRoutes.getReview>;
type Group = Review["suggested"][number];

/** What the blocks of the screen read: the answer, the address, the format and the pickers. */
export interface ReviewData {
  review: Review;
  query: ReviewQuery;
  todayOn: CivilDate;
  locale: UiLocale;
  timeZone: string;
  numberFormat: NumberFormat;
  labels: readonly { id: string; name: string; color: string | null }[];
  options: readonly CategoryOption[];
  colorOf: ReadonlyMap<string, string>;
  accountName: ReadonlyMap<string, string>;
  /** The accounts that take an automatic category, in the order of the accounts. */
  eligible: readonly { id: string; name: string }[];
  /** The accounts the address chose, among those; none means all of them. */
  selected: readonly string[];
  /** The accounts the review reads. */
  accountIds: readonly string[];
  params: Params;
  link: (changes: Params) => string;
}

export const moneyOf = (amount: string, numberFormat: NumberFormat) =>
  formatMoney(parseCents(amount), numberFormat);

export function ReviewBody({
  data,
  heading,
  indicator,
  intro,
}: {
  data: ReviewData;
  heading: ReactNode;
  indicator: ReactNode;
  /** The guided review's card over the categories step. */
  intro: boolean;
}) {
  const text = useTranslations("expenses");
  const { review, query, params } = data;
  return (
    <CategoryActions commands={CATEGORY_CALLS} categories={data.options}>
      {heading}
      {indicator}
      {!query.guided && (
        <ExpensesTabs
          current="review"
          params={{
            preset: params.preset,
            from: params.from,
            to: params.to,
            off: params.off,
            acc: params.acc,
          }}
        />
      )}
      {intro && review.count > 0 && (
        <Card className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="font-semibold">{text("review.guide.intro.title", { bank: query.bank })}</p>
            <p className="text-sm text-muted">{text("review.guide.intro.body")}</p>
          </div>
          <ButtonLink href={data.link({ step: "done" })}>{text("review.guide.later")}</ButtonLink>
        </Card>
      )}
      {!query.guided && <Controls data={data} />}
      <Body data={data} />
    </CategoryActions>
  );
}

function Controls({ data }: { data: ReviewData }) {
  const text = useTranslations("expenses");
  const period = useTranslations("common.period");
  const { review, query, params, selected } = data;
  // What "All" spans, for the day picker to start from: from the oldest movement waiting to today.
  const days = [...review.suggested, ...review.unsuggested]
    .flatMap((group) => group.rows)
    .concat(review.singles)
    .map((row) => row.on)
    .sort();
  const whole = { from: days[0] ?? data.todayOn, to: data.todayOn };
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* The period control of Expenses and Accounts, the same one: the stepper, the day picker and
          the presets, with "All" for a page that empties a queue. */}
      <PeriodBar
        period={{
          preset: query.preset,
          offset: query.offset,
          range: query.window,
          stepperParams: { preset: params.preset, from: params.from, to: params.to },
        }}
        path={HERE}
        carry={{ acc: params.acc }}
        locale={data.locale}
        presets={REVIEW_PRESETS}
        whole={{ range: whole, text: period("presets.all") }}
      />
      {data.eligible.length > 1 && (
        <nav aria-label={text("review.accounts")} className="flex flex-wrap gap-1">
          <ButtonLink
            size="sm"
            href={data.link({ acc: undefined })}
            aria-current={selected.length === 0 ? "page" : undefined}
            className={cn(selected.length === 0 && "border-accent bg-sel")}
          >
            {text("review.allAccounts")}
          </ButtonLink>
          {data.eligible.map((account) => {
            const chosen = selected.includes(account.id);
            const next = chosen ? selected.filter((id) => id !== account.id) : [...selected, account.id];
            return (
              <ButtonLink
                key={account.id}
                size="sm"
                href={data.link({ acc: next.length > 0 ? next.join(",") : undefined })}
                aria-current={chosen ? "page" : undefined}
                className={cn("max-w-full", chosen && "border-accent bg-sel")}
              >
                <span className="truncate">{account.name}</span>
              </ButtonLink>
            );
          })}
        </nav>
      )}
    </div>
  );
}

function Body({ data }: { data: ReviewData }) {
  const { review, query } = data;
  // The card that waits is the guided review's (ux §8.4): anywhere else a pass that runs for a
  // moment after an action must not take the place of what the page has to say.
  if (query.guided && review.preparing && review.count === 0)
    return <PreparingCard count={review.counts.left} reload={reloadReview} />;
  if (data.eligible.length === 0 || review.count === 0) return <Empty data={data} />;
  const groupView = (group: Group) => groupViewOf(group, data);
  return (
    <ReviewList
      suggested={review.suggested.map(groupView)}
      unsuggested={review.unsuggested.map(groupView)}
      singlesCount={review.singles.length}
      categories={data.options}
      guide={query.guided ? { categorised: review.counts.categorised } : undefined}
      aside={review.mergeProposals.length > 0 && <MergeAside count={review.mergeProposals.length} />}
      singles={
        <Card padded={false} className="overflow-clip">
          {review.singles.length === 0 ? <SinglesTable data={data} lines={[]} /> : <Singles data={data} />}
        </Card>
      }
    />
  );
}

/** No account takes an automatic category, or nothing waits: in the range chosen, or at all. */
function Empty({ data }: { data: ReviewData }) {
  const text = useTranslations("expenses");
  if (data.eligible.length === 0)
    return (
      <EmptyState
        title={text("review.empty.source.title")}
        description={text("review.empty.source.description")}
        actions={
          <ButtonLink href="/expenses" variant="primary">
            {text("review.empty.done.action")}
          </ButtonLink>
        }
      />
    );
  const filtered = data.query.preset !== "all" || data.selected.length > 0;
  return (
    <EmptyState
      icon={filtered ? undefined : <Check aria-hidden className="size-5 text-pos" />}
      title={text(filtered ? "review.empty.filtered.title" : "review.empty.done.title")}
      description={text(filtered ? "review.empty.filtered.description" : "review.empty.done.description")}
      actions={
        filtered ? (
          <ButtonLink href={HERE} variant="primary">
            {text("review.empty.filtered.action")}
          </ButtonLink>
        ) : (
          <ButtonLink href="/expenses" variant="primary">
            {text("review.empty.done.action")}
          </ButtonLink>
        )
      }
    />
  );
}

function MergeAside({ count }: { count: number }) {
  const text = useTranslations("expenses");
  return (
    <p className="flex flex-wrap items-center gap-x-2 border-t border-border pt-2 text-sm">
      {text("review.aside.merge", { count })}
      <a
        href="/settings/finance"
        className="focus-ring inline-flex min-h-6 items-center text-accent underline"
      >
        {text("review.aside.mergeLink")}
      </a>
    </p>
  );
}

function groupViewOf(group: Group, data: ReviewData): ReviewGroupView {
  const suggestion = data.options.find((option) => option.id === group.suggestedCategoryId) ?? null;
  return {
    id: group.id,
    text: group.text === "" ? NULL_DISPLAY : group.text,
    count: group.count,
    total: moneyOf(group.total, data.numberFormat),
    suggestion: suggestion && { id: suggestion.id, name: suggestion.name, color: suggestion.color },
    reason: suggestion && group.reason !== null ? { code: group.reason, params: group.params ?? {} } : null,
    rows: group.rows.map((row) => ({
      id: row.id,
      date: formatDate(row.on, "long", data.locale),
      account: data.accountName.get(row.accountId) ?? NULL_DISPLAY,
      amount: moneyOf(row.amount, data.numberFormat),
    })),
  };
}

/** The single movements, drawn by the table of Expenses from the rows its own read gives. */
function Singles({ data }: { data: ReviewData }) {
  const read = useApi(movements.getTransactionsView, {
    query: {
      from: data.query.window?.from,
      to: data.query.window?.to,
      accounts: data.accountIds.join(","),
      categories: "none",
      limit: SINGLES_LIMIT,
    },
  });
  const ids = new Set(data.review.singles.map((row) => row.id));
  return (
    <Loaded state={read}>
      {(view) => <SinglesTable data={data} lines={view.rows.filter((line) => ids.has(line.id))} />}
    </Loaded>
  );
}

function SinglesTable({
  data,
  lines,
}: {
  data: ReviewData;
  lines: RouteOutput<typeof movements.getTransactionsView>["rows"];
}) {
  return (
    <TransactionsTable
      groups={[
        {
          key: "singles",
          label: null,
          count: lines.length,
          total: "",
          rows: lines.map((line) => lineViewOf(line, { ...data, categories: data.options })),
        },
      ]}
      categories={data.options}
      labels={data.labels}
      params={data.params}
      sort="date"
      direction="desc"
      path={HERE}
      sortable={false}
    />
  );
}

"use client";

// «To review» (rewrite plan N3; ux/n3-categories-manual.md §4, §8), read from `/api/v1` (rewrite plan
// R3): the groups, the single movements, the counts and the amount waiting are fields of
// `GET /transactions/review`; the screen reads the address, colours and formats.
//
// Only the accounts whose source gives no category are here (decision H35 point 1): a movement of
// a source that gives its own is never shown and never touched.
import { Check } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { DEFAULT_GROUPS } from "@ledgerly/domain/transactions/client";
import {
  categories as categoryRoutes,
  labels as labelRoutes,
  profile,
} from "@ledgerly/api-contract/settings";
import { review as reviewRoutes } from "@ledgerly/api-contract/transactions";
import type { RouteOutput } from "@ledgerly/api-client";
import { type CivilDate, today } from "@ledgerly/format/dates";
import { numberStyle } from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { useApi, useLatest } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { Page } from "@ledgerly/ui/shell/page";
import { StepIndicator } from "@ledgerly/ui/step-indicator";
import { withParams } from "@ledgerly/ui/url";
import { categoryColor, categoryColors, withMacroTitles } from "@/modules/transactions";
import { GroupsStep } from "@/modules/transactions/client";
import { moneyOf, type ReviewData, ReviewBody } from "./review-blocks";
import {
  parseReviewQuery,
  type ReviewQuery,
  reviewParams,
  type ReviewStep,
  reviewStep,
} from "./review-query";

const HERE = "/expenses/review";

type Preferences = RouteOutput<typeof profile.getPreferences>;
type Category = RouteOutput<typeof categoryRoutes.listCategories>["categories"][number];
type Label = RouteOutput<typeof labelRoutes.listLabels>["labels"][number];
type Account = RouteOutput<typeof accountRoutes.listAccounts>["accounts"][number];

/** A default group as the first step of the guided review offers it, in the person's language. */
interface DefaultGroup {
  key: string;
  en: string;
  it: string;
  examples: { en: string; it: string };
}

export function ReviewScreen() {
  const defaultGroups = DEFAULT_GROUPS;
  const text = useTranslations("expenses");
  const prefs = useApi(profile.getPreferences, {});
  const categoryList = useApi(categoryRoutes.listCategories, { query: {} });
  const labelList = useApi(labelRoutes.listLabels, {});
  // The names of every account, archived too, as the page listed them.
  const accountList = useApi(accountRoutes.listAccounts, { query: { archived: "true" } });
  return (
    <Page title={text("review.title")} parent={{ href: "/expenses", label: text("title") }}>
      <Loaded state={prefs}>
        {(prefsData) => (
          <Loaded state={categoryList}>
            {(categoryData) => (
              <Loaded state={labelList}>
                {(labelData) => (
                  <Loaded state={accountList}>
                    {(accountData) => (
                      <Review
                        prefs={prefsData}
                        categories={categoryData.categories}
                        labels={labelData.labels}
                        accounts={accountData.accounts}
                        defaultGroups={defaultGroups}
                      />
                    )}
                  </Loaded>
                )}
              </Loaded>
            )}
          </Loaded>
        )}
      </Loaded>
    </Page>
  );
}

function Review({
  prefs,
  categories,
  labels,
  accounts,
  defaultGroups,
}: {
  prefs: Preferences;
  categories: readonly Category[];
  labels: readonly Label[];
  accounts: readonly Account[];
  defaultGroups: readonly DefaultGroup[];
}) {
  const todayOn = today(prefs.timeZone);
  const query = parseReviewQuery(Object.fromEntries(useSearchParams().entries()), todayOn);
  const read = useLatest(
    useApi(reviewRoutes.getReview, {
      query: {
        from: query.window?.from,
        to: query.window?.to,
        accounts: query.accounts.length > 0 ? query.accounts.join(",") : undefined,
      },
    }),
  );
  return (
    <Loaded state={read}>
      {(review) => (
        <ReviewView
          review={review}
          query={query}
          todayOn={todayOn}
          prefs={prefs}
          categories={categories}
          labels={labels}
          accounts={accounts}
          defaultGroups={defaultGroups}
        />
      )}
    </Loaded>
  );
}

interface ViewProps {
  review: ReviewData["review"];
  query: ReviewQuery;
  todayOn: CivilDate;
  prefs: Preferences;
  categories: readonly Category[];
  labels: readonly Label[];
  accounts: readonly Account[];
  defaultGroups: readonly DefaultGroup[];
}

function ReviewView(props: ViewProps) {
  const { review, query, categories } = props;
  const data = useReviewData(props);
  const step = reviewStep(query, {
    hasCategories: categories.length > 0,
    count: review.count,
    preparing: review.preparing,
  });
  const heading = <Heading data={data} />;
  const indicator = query.guided && (
    <Indicator data={data} step={step} hasCategories={categories.length > 0} />
  );

  if (step === "groups")
    return (
      <>
        {heading}
        {indicator}
        <GroupsStep
          groups={props.defaultGroups.map((group, index) => ({
            key: group.key,
            name: group[data.locale],
            examples: group.examples[data.locale],
            color: categoryColor(null, index),
          }))}
          next={data.link({ step: "categories" })}
        />
      </>
    );
  if (step === "done")
    return (
      <>
        {heading}
        {indicator}
        <DoneCard data={data} />
      </>
    );
  return <ReviewBody data={data} heading={heading} indicator={indicator} intro={step === "categories"} />;
}

/** What the blocks read: the accounts kept from the address, the pickers' categories, the format. */
function useReviewData({
  review,
  query,
  todayOn,
  prefs,
  categories,
  labels,
  accounts,
}: ViewProps): ReviewData {
  const text = useTranslations("expenses");
  const eligibleIds = review.accountIds;
  const selected = query.accounts.filter((id) => eligibleIds.includes(id));
  const params = reviewParams(query, selected);
  const colorOf = categoryColors(categories);
  // Under the title of their macro, in every picker of the page (categories-and-rules.md §2.4).
  const options = withMacroTitles(
    categories.map((category) => ({
      id: category.id,
      name: category.name,
      color: colorOf.get(category.id) ?? categoryColor(category.color, 0),
      depth: category.depth,
      type: category.type,
    })),
    {
      income: text("categories.macro.income"),
      expense: text("categories.macro.expense"),
      transfer: text("categories.macro.transfer"),
    },
  );
  return {
    review,
    query,
    todayOn,
    locale: prefs.locale,
    numberFormat: numberStyle(prefs),
    labels,
    selected,
    accountIds: selected.length > 0 ? selected : eligibleIds,
    params,
    options,
    colorOf,
    accountName: new Map(accounts.map((account) => [account.id, account.name])),
    eligible: accounts.filter((account) => eligibleIds.includes(account.id)),
    link: (changes) => withParams(HERE, params, changes),
  };
}

function Heading({ data }: { data: ReviewData }) {
  const text = useTranslations("expenses");
  const { review } = data;
  return (
    <div className="flex flex-col gap-1">
      <h1 className="text-title font-semibold tracking-title">{text("review.title")}</h1>
      {review.count > 0 && (
        <p className="text-muted">
          {text("review.summary", {
            count: review.count,
            groups: review.suggested.length + review.unsuggested.length,
            total: moneyOf(review.total, data.numberFormat),
          })}
        </p>
      )}
    </div>
  );
}

/** The steps of the guided review: the groups first, for a person with no category. */
function Indicator({
  data,
  step,
  hasCategories,
}: {
  data: ReviewData;
  step: ReviewStep | null;
  hasCategories: boolean;
}) {
  const text = useTranslations("expenses");
  const steps = [
    ...(hasCategories
      ? []
      : [{ id: "groups", label: text("review.guide.steps.groups"), href: data.link({ step: "groups" }) }]),
    { id: "categories", label: text("review.guide.steps.categories"), href: data.link({ step: undefined }) },
    { id: "done", label: text("review.guide.steps.done"), href: data.link({ step: "done" }) },
  ];
  return (
    <StepIndicator
      label={text("review.title")}
      steps={steps}
      current={step ?? "categories"}
      doneLabel={text("review.guide.steps.done")}
    />
  );
}

function DoneCard({ data }: { data: ReviewData }) {
  const text = useTranslations("expenses");
  const { counts } = data.review;
  const left = counts.left;
  return (
    <Card className="flex flex-col gap-2">
      <h2 tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold">
        <Check aria-hidden className="size-4 text-pos" />
        {text("review.guide.done.title")}
      </h2>
      <p>{text("review.guide.done.categorised", { count: counts.categorised, bank: data.query.bank })}</p>
      {left > 0 && <p className="text-muted">{text("review.guide.done.left", { count: left })}</p>}
      <div className="flex flex-wrap justify-end gap-2 max-sm:flex-col-reverse">
        <ButtonLink href="/accounts">{text("review.guide.done.accounts")}</ButtonLink>
        <ButtonLink href="/expenses" variant="primary">
          {text("review.guide.done.expenses")}
        </ButtonLink>
      </div>
    </Card>
  );
}

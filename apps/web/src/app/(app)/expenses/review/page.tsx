import { Check } from "lucide-react";
import type { Metadata, Route } from "next";
import { getTranslations } from "next-intl/server";
import { listAccounts } from "@ledgerly/domain/accounts";
import {
  chooseCategoryAction,
  confirmCategoriesAction,
  createDefaultGroupsAction,
  similarMovementsAction,
  undoCategoriesAction,
} from "@/modules/transactions/categorize/actions";
import { categoryCounts, listMergeProposals, reviewOf } from "@ledgerly/domain/transactions";
import type { ReviewGroup } from "@ledgerly/domain/transactions";
import { isPreparing } from "@ledgerly/domain/transactions";
import { DEFAULT_GROUPS } from "@ledgerly/domain/transactions";
import { listTransactions } from "@ledgerly/domain/transactions";
import { categorisableAccountIds } from "@ledgerly/domain/transactions";
import { listCategories, listLabels } from "@ledgerly/domain/transactions";
import { CategoryActions, type CategoryCommands } from "@/modules/transactions/ui/category-actions";
import { categoryColor, categoryColors, withMacroTitles } from "@/modules/transactions/ui/display";
import { PeriodBar } from "@ledgerly/ui/period-bar";
import { presetRange, RANGE_PRESETS } from "@/modules/transactions/ui/filters";
import { GroupsStep, PreparingCard } from "@/modules/transactions/ui/review-guide";
import { type ReviewGroupView, ReviewList } from "@/modules/transactions/ui/review-list";
import { TransactionsTable } from "@/modules/transactions/ui/transactions-table";
import { requireSession } from "@/platform/auth/session";
import { isCivilDate, today } from "@ledgerly/domain/shared/dates";
import { shiftRange } from "@ledgerly/domain/platform/ranges";
import { formatDate, formatMoney, NULL_DISPLAY } from "@ledgerly/domain/platform/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { cn } from "@ledgerly/ui/cn";
import { Page } from "@ledgerly/ui/shell/page";
import { EmptyState } from "@ledgerly/ui/states";
import { StepIndicator } from "@ledgerly/ui/step-indicator";
import { withParams } from "@ledgerly/ui/url";
import { rowViewOf } from "../row-view";
import { ExpensesTabs } from "../tabs";

const HERE = "/expenses/review";
/** The four windows of Expenses, and "All" — the default: the page empties a queue, it reads no month. */
const PRESETS = [...RANGE_PRESETS, "all"] as const;
type Preset = (typeof PRESETS)[number];

const COMMANDS: CategoryCommands = {
  confirm: confirmCategoriesAction,
  choose: chooseCategoryAction,
  undo: undoCategoriesAction,
  similar: similarMovementsAction,
};

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("expenses.review"))("title") };
}

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value)?.trim() ?? "";

/**
 * "To review" (rewrite plan N3; ux/n3-categories-manual.md §4, §8): the movements that wait for a
 * category, grouped by their text so one decision covers a group. Everything is resolved here, on
 * the server, from the address — the period, the accounts, the guided review — and the components
 * are handed formatted text and the Server Actions.
 *
 * Only the accounts whose source gives no category are here (decision H35 point 1): a movement of
 * a source that gives its own is never shown and never touched.
 */
export default async function ReviewPage({ searchParams }: PageProps<"/expenses/review">) {
  const ctx = await requireSession();
  const t = await getTranslations("expenses");
  const raw = await searchParams;
  const todayOn = today(ctx.timeZone);

  // The days another page asked for (a month of Budgets, the range of Expenses) win over a preset.
  const from = one(raw.from);
  const to = one(raw.to);
  const custom = isCivilDate(from) && isCivilDate(to) && from <= to;
  const preset: Preset | null = custom ? null : (PRESETS.find((key) => key === one(raw.preset)) ?? "all");
  // The stepper moves a window back by periods of its own length; "All" has no window to move.
  const offset = preset === "all" ? 0 : Math.max(0, Math.trunc(Number(one(raw.off))) || 0);
  const window =
    preset === "all"
      ? null
      : shiftRange(custom ? { from, to } : presetRange(preset ?? "thisMonth", todayOn), -offset);
  const range = window ?? {};
  const guided = one(raw.guide) === "1";
  const bank = one(raw.bank).slice(0, 60);

  const [eligibleIds, accounts, categories, labels, proposals, preparing] = await Promise.all([
    categorisableAccountIds(ctx),
    listAccounts(ctx, { includeArchived: true }),
    listCategories(ctx),
    listLabels(ctx),
    listMergeProposals(ctx),
    isPreparing(ctx),
  ]);
  const eligible = accounts.filter((account) => eligibleIds.includes(account.id));
  const selected = one(raw.acc)
    .split(",")
    .filter((id) => eligibleIds.includes(id));
  const accountIds = selected.length > 0 ? selected : eligibleIds;
  const params = {
    preset: preset === "all" || preset === null ? undefined : preset,
    from: custom ? from : undefined,
    to: custom ? to : undefined,
    off: offset > 0 ? String(offset) : undefined,
    acc: selected.length > 0 ? selected.join(",") : undefined,
    guide: guided ? "1" : undefined,
    bank: guided && bank !== "" ? bank : undefined,
  };

  const review =
    accountIds.length === 0
      ? { suggested: [], unsuggested: [], singles: [] }
      : await reviewOf(ctx, { ...range, accountIds });
  const groups = [...review.suggested, ...review.unsuggested];
  const total =
    groups.reduce((sum, group) => sum + group.totalCents, 0n) +
    review.singles.reduce((sum, row) => sum + row.amountCents, 0n);
  const count = groups.reduce((sum, group) => sum + group.count, 0) + review.singles.length;

  const colorOf = categoryColors(categories);
  // Under the title of their macro, in every picker of the page (categories-and-rules.md §2.4).
  const options = withMacroTitles(
    categories.map((category) => ({
      id: category.id,
      name: category.name,
      color: colorOf.get(category.id) as string,
      depth: category.depth,
      type: category.type,
    })),
    {
      income: t("categories.macro.income"),
      expense: t("categories.macro.expense"),
      transfer: t("categories.macro.transfer"),
    },
  );
  const accountName = new Map(accounts.map((account) => [account.id, account.name]));
  const money = (cents: bigint) => formatMoney(cents, ctx.numberFormat);

  const groupView = (group: ReviewGroup): ReviewGroupView => {
    const suggestion = options.find((option) => option.id === group.suggestedCategoryId) ?? null;
    return {
      id: group.id,
      text: group.text === "" ? NULL_DISPLAY : group.text,
      count: group.count,
      total: money(group.totalCents),
      suggestion: suggestion && { id: suggestion.id, name: suggestion.name, color: suggestion.color },
      reason: suggestion && group.reason !== null ? { code: group.reason, params: group.params ?? {} } : null,
      rows: group.rows.map((row) => ({
        id: row.id,
        date: formatDate(row.on, "long", ctx.locale),
        account: accountName.get(row.accountId) ?? NULL_DISPLAY,
        amount: money(row.amountCents),
      })),
    };
  };

  // The single movements are drawn by the table of Expenses, from the same rows it reads.
  const singleIds = new Set(review.singles.map((row) => row.id));
  const singleRows =
    singleIds.size === 0
      ? []
      : (await listTransactions(ctx, { ...range, accountIds, categoryIds: [null], limit: 2000 })).filter(
          (row) => singleIds.has(row.id),
        );
  // What "All" spans, for the day picker to start from: from the oldest movement waiting to today.
  const days = [...groups.flatMap((group) => group.rows), ...review.singles].map((row) => row.on).sort();
  const whole = { from: days[0] ?? todayOn, to: todayOn };

  const title = t("review.title");
  const parent = { href: "/expenses" as Route, label: t("title") };
  const link = (changes: Record<string, string | undefined>) => withParams(HERE, params, changes);

  /** The steps of the guided review: the groups first, for a person with no category. */
  const steps = [
    ...(categories.length === 0
      ? [{ id: "groups", label: t("review.guide.steps.groups"), href: link({ step: "groups" }) }]
      : []),
    { id: "categories", label: t("review.guide.steps.categories"), href: link({ step: undefined }) },
    { id: "done", label: t("review.guide.steps.done"), href: link({ step: "done" }) },
  ];
  const wanted = one(raw.step);
  const step = !guided
    ? null
    : wanted === "done"
      ? "done"
      : categories.length === 0 && wanted !== "categories"
        ? "groups"
        : count === 0 && !preparing
          ? "done"
          : "categories";
  const indicator = guided && (
    <StepIndicator
      label={title}
      steps={steps}
      current={step ?? "categories"}
      doneLabel={t("review.guide.steps.done")}
    />
  );
  const heading = (
    <div className="flex flex-col gap-1">
      <h1 className="text-title font-semibold tracking-title">{title}</h1>
      {count > 0 && (
        <p className="text-muted">
          {t("review.summary", { count, groups: groups.length, total: money(total) })}
        </p>
      )}
    </div>
  );

  if (step === "groups") {
    return (
      <Page title={title} parent={parent}>
        {heading}
        {indicator}
        <GroupsStep
          groups={DEFAULT_GROUPS.map((group, index) => ({
            key: group.key,
            name: group[ctx.locale],
            examples: group.examples[ctx.locale],
            color: categoryColor(null, index),
          }))}
          next={link({ step: "categories" })}
          create={createDefaultGroupsAction}
        />
      </Page>
    );
  }

  if (step === "done") {
    const counts = await categoryCounts(ctx, accountIds);
    const left = counts.suggested + counts.open;
    return (
      <Page title={title} parent={parent}>
        {heading}
        {indicator}
        <Card className="flex flex-col gap-2">
          <h2 tabIndex={-1} className="flex items-center gap-2 text-lg font-semibold">
            <Check aria-hidden className="size-4 text-pos" />
            {t("review.guide.done.title")}
          </h2>
          <p>{t("review.guide.done.categorised", { count: counts.categorised, bank })}</p>
          {left > 0 && <p className="text-muted">{t("review.guide.done.left", { count: left })}</p>}
          <div className="flex flex-wrap justify-end gap-2 max-sm:flex-col-reverse">
            <ButtonLink href={"/accounts" as Route}>{t("review.guide.done.accounts")}</ButtonLink>
            <ButtonLink href={"/expenses" as Route} variant="primary">
              {t("review.guide.done.expenses")}
            </ButtonLink>
          </div>
        </Card>
      </Page>
    );
  }

  const controls = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      {/* The period control of Expenses and Accounts, the same one: the stepper, the day picker and
          the presets, with "All" for a page that empties a queue. */}
      {!guided && (
        <PeriodBar
          period={{
            preset,
            offset,
            range: window,
            stepperParams: {
              preset: preset === "all" || preset === null ? undefined : preset,
              from: custom ? from : undefined,
              to: custom ? to : undefined,
            },
          }}
          path={HERE}
          carry={{ acc: params.acc }}
          locale={ctx.locale}
          presets={PRESETS}
          whole={{ range: whole, text: t("filters.presets.all") }}
        />
      )}
      {!guided && eligible.length > 1 && (
        <nav aria-label={t("review.accounts")} className="flex flex-wrap gap-1">
          <ButtonLink
            size="sm"
            href={link({ acc: undefined })}
            aria-current={selected.length === 0 ? "page" : undefined}
            className={cn(selected.length === 0 && "border-accent bg-sel")}
          >
            {t("review.allAccounts")}
          </ButtonLink>
          {eligible.map((account) => {
            const on = selected.includes(account.id);
            const next = on ? selected.filter((id) => id !== account.id) : [...selected, account.id];
            return (
              <ButtonLink
                key={account.id}
                size="sm"
                href={link({ acc: next.length > 0 ? next.join(",") : undefined })}
                aria-current={on ? "page" : undefined}
                className={cn("max-w-full", on && "border-accent bg-sel")}
              >
                <span className="truncate">{account.name}</span>
              </ButtonLink>
            );
          })}
        </nav>
      )}
    </div>
  );

  let body;
  // The card that waits is the guided review's (ux §8.4): anywhere else a pass that runs for a
  // moment after an action must not take the place of what the page has to say.
  if (guided && preparing && count === 0) {
    const waiting = await categoryCounts(ctx, accountIds);
    body = <PreparingCard count={waiting.open + waiting.suggested} />;
  } else if (eligible.length === 0) {
    body = (
      <EmptyState
        title={t("review.empty.source.title")}
        description={t("review.empty.source.description")}
        actions={
          <ButtonLink href={"/expenses" as Route} variant="primary">
            {t("review.empty.done.action")}
          </ButtonLink>
        }
      />
    );
  } else if (count === 0) {
    const filtered = preset !== "all" || selected.length > 0;
    body = (
      <EmptyState
        icon={filtered ? undefined : <Check aria-hidden className="size-5 text-pos" />}
        title={t(filtered ? "review.empty.filtered.title" : "review.empty.done.title")}
        description={t(filtered ? "review.empty.filtered.description" : "review.empty.done.description")}
        actions={
          filtered ? (
            <ButtonLink href={HERE as Route} variant="primary">
              {t("review.empty.filtered.action")}
            </ButtonLink>
          ) : (
            <ButtonLink href={"/expenses" as Route} variant="primary">
              {t("review.empty.done.action")}
            </ButtonLink>
          )
        }
      />
    );
  } else {
    const guide = guided ? { categorised: (await categoryCounts(ctx, accountIds)).categorised } : undefined;
    body = (
      <ReviewList
        suggested={review.suggested.map(groupView)}
        unsuggested={review.unsuggested.map(groupView)}
        singlesCount={review.singles.length}
        categories={options}
        guide={guide}
        aside={
          proposals.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 border-t border-border pt-2 text-sm">
              {t("review.aside.merge", { count: proposals.length })}
              <a
                href="/settings/categories"
                className="focus-ring inline-flex min-h-6 items-center text-accent underline"
              >
                {t("review.aside.mergeLink")}
              </a>
            </p>
          )
        }
        singles={
          <Card padded={false} className="overflow-clip">
            <TransactionsTable
              groups={[
                {
                  key: "singles",
                  label: null,
                  count: singleRows.length,
                  total: "",
                  rows: singleRows.map((row) => rowViewOf(row, { ctx, colorOf, categories: options })),
                },
              ]}
              categories={options}
              labels={labels}
              params={params}
              sort="date"
              direction="desc"
              path={HERE}
              sortable={false}
            />
          </Card>
        }
      />
    );
  }

  return (
    <CategoryActions commands={COMMANDS} categories={options}>
      <Page title={title} parent={parent}>
        {heading}
        {indicator}
        {!guided && (
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
        {guided && step === "categories" && count > 0 && (
          <Card className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="font-semibold">{t("review.guide.intro.title", { bank })}</p>
              <p className="text-sm text-muted">{t("review.guide.intro.body")}</p>
            </div>
            <ButtonLink href={link({ step: "done" })}>{t("review.guide.later")}</ButtonLink>
          </Card>
        )}
        {controls}
        {body}
      </Page>
    </CategoryActions>
  );
}

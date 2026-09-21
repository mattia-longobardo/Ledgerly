import { Check, ChevronDown, Landmark, Search, Tag as TagIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { LinkTabs, type Params, PeriodStepper, withParams } from "@/modules/accounts/ui/controls";
import { TRANSACTION_TYPES, type TransactionType } from "@/modules/transactions/rules";
import type { UiLocale } from "@/platform/format";
import { IconButton } from "@/ui/button";
import { cn } from "@/ui/cn";
import { Input } from "@/ui/input";
import { rangeLabel } from "./display";
import { type ExpensesQuery, listParam, RANGE_PRESETS, toggle, UNCATEGORISED } from "./filters";
import { RangePicker } from "./range-picker";
import type { AccountFilterOption, CategoryFilterOption } from "./view";

const CONTROL =
  "focus-ring flex h-[30px] cursor-pointer list-none items-center gap-1.5 rounded-ctl border border-border bg-card px-2.5 text-sm font-medium hover:bg-hover [&::-webkit-details-marker]:hidden";

const PANEL =
  "absolute top-9 left-0 z-30 flex w-[240px] max-w-[calc(100vw-32px)] animate-in flex-col rounded-lg border border-border bg-card p-1.5 shadow-overlay";

const OPTION = "focus-ring flex h-[30px] items-center gap-2.5 rounded-[5px] px-2 text-sm hover:bg-hover";

/** The design's checkbox square, as a glyph: these are links, not form controls. */
function Box({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-3.5 shrink-0 place-items-center rounded-[4px] border",
        checked ? "border-primary bg-primary text-primary-fg" : "border-border2",
      )}
    >
      {checked && <Check className="size-2.5" />}
    </span>
  );
}

function Dot({ color }: { color: string | null }) {
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0 rounded-[2px]", color === null && "bg-faint")}
      style={color === null ? undefined : { background: color }}
    />
  );
}

/**
 * The filter row of the design: the date range with its stepper, its four presets and its
 * two-month picker, then categories, account, type (F2.5), "Show hidden", the payee search and
 * "Clear filters".
 *
 * Everything here is a link or a GET form, which is the whole point of keeping the state in the
 * URL (spec §8.4 point 2): the row is rendered by the server and every control works before any
 * JavaScript has run. `LinkTabs` and `PeriodStepper` come from F1 unchanged.
 */
export async function FilterBar({
  query,
  categories,
  accounts,
  uncategorisedCount,
  typeCounts,
  locale,
  path = "/expenses",
}: {
  query: ExpensesQuery;
  categories: readonly CategoryFilterOption[];
  accounts: readonly AccountFilterOption[];
  /** How many movements of the range carry no category: the count of the last chip. */
  uncategorisedCount: number;
  /** How many movements of the range each type holds, counted without the type filter. */
  typeCounts: Partial<Record<TransactionType, number>>;
  locale: UiLocale;
  path?: string;
}) {
  const t = await getTranslations("expenses.filters");
  const selected = query.categorySelection;
  const accountSelection = query.accountSelection;
  const typeSelection = query.typeSelection;

  /** A filter changes, the period does not: the links keep the window the reader is looking at. */
  const carry: Params = query.params;
  const categoryHref = (id: string) => withParams(path, carry, { cat: listParam(toggle(selected, id)) });
  const accountHref = (id: string) =>
    withParams(path, carry, { acc: listParam(toggle(accountSelection, id)) });
  // In the fixed order of the types, so one selection is always one address.
  const typeHref = (type: TransactionType) => {
    const next = toggle(typeSelection, type);
    return withParams(path, carry, {
      type: listParam(TRANSACTION_TYPES.filter((one) => next.includes(one))),
    });
  };
  /** A menu's summary: "All …", the one name picked, or how many. */
  const summaryOf = (count: number, all: string, oneName: string | undefined, some: string) =>
    count === 0 ? all : count === 1 && oneName !== undefined ? oneName : some;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <PeriodStepper
        label={t("range.label")}
        path={path}
        params={query.stepperParams}
        offset={query.offset}
        periodLabel={
          <RangePicker
            range={query.range}
            text={rangeLabel(query.range, locale)}
            params={query.presetParams}
            locale={locale}
            label={t("range.label")}
            path={path}
          />
        }
        previousLabel={t("range.previous")}
        nextLabel={t("range.next")}
        latestLabel={t("range.latest")}
      />

      <LinkTabs
        label={t("range.label")}
        path={path}
        params={query.presetParams}
        name="preset"
        current={query.preset ?? ""}
        options={RANGE_PRESETS.map((preset) => ({ value: preset, label: t(`presets.${preset}`) }))}
      />

      <span aria-hidden className="mx-1 h-[18px] w-px bg-border max-md:hidden" />

      <details className="relative">
        <summary className={cn(CONTROL, selected.length > 0 && "border-accent")}>
          <TagIcon aria-hidden className="size-3.5 text-muted" />
          {selected.length === 0 ? t("categories.all") : t("categories.some", { count: selected.length })}
          <ChevronDown aria-hidden className="size-3 text-muted" />
        </summary>
        <div className={PANEL}>
          <div className="flex items-center justify-between px-2 pt-1 pb-1.5 text-micro font-medium tracking-[0.04em] text-faint uppercase">
            {t("categories.title")}
            <Link
              href={withParams(path, carry, { cat: "" })}
              className="focus-ring rounded-[2px] text-sm font-medium tracking-normal text-accent normal-case hover:underline"
            >
              {t("categories.clear")}
            </Link>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {categories.map((category) => (
              <Link
                key={category.id}
                href={categoryHref(category.id)}
                aria-current={selected.includes(category.id) ? "true" : undefined}
                className={cn(OPTION, category.depth === 1 && "pl-7")}
              >
                <Box checked={selected.includes(category.id)} />
                <Dot color={category.color} />
                <span className="min-w-0 flex-1 truncate">{category.name}</span>
                <span className="text-micro text-muted">{category.count}</span>
              </Link>
            ))}
            <Link
              href={categoryHref(UNCATEGORISED)}
              aria-current={selected.includes(UNCATEGORISED) ? "true" : undefined}
              className={OPTION}
            >
              <Box checked={selected.includes(UNCATEGORISED)} />
              <Dot color={null} />
              <span className="min-w-0 flex-1 truncate">{t("categories.none")}</span>
              <span className="text-micro text-muted">{uncategorisedCount}</span>
            </Link>
          </div>
        </div>
      </details>

      {/* Accounts and types are multiple choice too, like the categories. */}
      <details className="relative">
        <summary className={cn(CONTROL, accountSelection.length > 0 && "border-accent")}>
          <Landmark aria-hidden className="size-3.5 text-muted" />
          {summaryOf(
            accountSelection.length,
            t("accounts.all"),
            accounts.find((one) => one.id === accountSelection[0])?.name,
            t("accounts.some", { count: accountSelection.length }),
          )}
          <ChevronDown aria-hidden className="size-3 text-muted" />
        </summary>
        <div className={cn(PANEL, "w-[240px]")}>
          <div className="flex items-center justify-between px-2 pt-1 pb-1.5 text-micro font-medium tracking-[0.04em] text-faint uppercase">
            {t("accounts.title")}
            <Link
              href={withParams(path, carry, { acc: "" })}
              className="focus-ring rounded-[2px] text-sm font-medium tracking-normal text-accent normal-case hover:underline"
            >
              {t("accounts.clear")}
            </Link>
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {accounts.map((one) => (
              <Link
                key={one.id}
                href={accountHref(one.id)}
                aria-current={accountSelection.includes(one.id) ? "true" : undefined}
                className={OPTION}
              >
                <Box checked={accountSelection.includes(one.id)} />
                <span className="min-w-0 flex-1 truncate">{one.name}</span>
                <span className="text-micro text-muted">{one.count}</span>
              </Link>
            ))}
          </div>
        </div>
      </details>

      <details className="relative">
        <summary className={cn(CONTROL, typeSelection.length > 0 && "border-accent")}>
          {summaryOf(
            typeSelection.length,
            t("types.all"),
            typeSelection[0] === undefined ? undefined : t(`types.${typeSelection[0]}`),
            t("types.some", { count: typeSelection.length }),
          )}
          <ChevronDown aria-hidden className="size-3 text-muted" />
        </summary>
        <div className={cn(PANEL, "w-[200px]")}>
          <div className="flex items-center justify-between px-2 pt-1 pb-1.5 text-micro font-medium tracking-[0.04em] text-faint uppercase">
            {t("types.label")}
            <Link
              href={withParams(path, carry, { type: "" })}
              className="focus-ring rounded-[2px] text-sm font-medium tracking-normal text-accent normal-case hover:underline"
            >
              {t("types.clear")}
            </Link>
          </div>
          {TRANSACTION_TYPES.map((type) => (
            <Link
              key={type}
              href={typeHref(type)}
              aria-current={typeSelection.includes(type) ? "true" : undefined}
              className={OPTION}
            >
              <Box checked={typeSelection.includes(type)} />
              <span className="min-w-0 flex-1 truncate">{t(`types.${type}`)}</span>
              <span className="text-micro text-muted">{typeCounts[type] ?? 0}</span>
            </Link>
          ))}
        </div>
      </details>

      <Link
        href={withParams(path, carry, { hidden: query.showHidden ? "" : "1" })}
        aria-current={query.showHidden ? "true" : undefined}
        className={cn(CONTROL, "font-medium", query.showHidden && "border-accent")}
      >
        <Box checked={query.showHidden} />
        {t("showHidden")}
      </Link>

      {query.filtered && (
        <Link
          href={withParams(path, query.clearedParams, {})}
          className="focus-ring inline-flex min-h-6 items-center rounded-[2px] px-1 font-medium text-accent hover:underline"
        >
          {t("clear")}
        </Link>
      )}

      <span className="flex-1" />

      <form method="get" action={path} className="flex items-center gap-1.5">
        {Object.entries(query.params).map(([name, value]) =>
          name === "q" || value === undefined || value === "" ? null : (
            <input key={name} type="hidden" name={name} value={value} />
          ),
        )}
        <Input
          type="search"
          name="q"
          defaultValue={query.search}
          placeholder={t("search")}
          aria-label={t("searchLabel")}
          className="h-[30px] w-[200px] text-sm max-md:w-full"
        />
        <IconButton label={t("searchLabel")} type="submit" size={28} bordered>
          <Search aria-hidden className="size-3.5" />
        </IconButton>
      </form>
    </div>
  );
}

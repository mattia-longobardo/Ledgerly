"use client";

import { Check, ChevronDown, Landmark, Search, Tag as TagIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { type FormEvent, type ReactNode, useState } from "react";
import { Link, useRouter } from "@ledgerly/ui/router";
import { type Params, withParams } from "@ledgerly/ui/url";
import { TRANSACTION_TYPES, type TransactionType } from "@ledgerly/domain/transactions/client";
import type { UiLocale } from "@ledgerly/format/format";
import { IconButton } from "@ledgerly/ui/button";
import { CategoryPicker } from "@ledgerly/ui/category-picker";
import { cn } from "@ledgerly/ui/cn";
import { Input } from "@ledgerly/ui/input";
import { PeriodBar } from "@ledgerly/ui/period-bar";
import { Popover } from "@ledgerly/ui/popover";
import { type ExpensesQuery, listParam, toggle, UNCATEGORISED } from "./filters";
import type { AccountFilterOption, CategoryFilterOption } from "./view";

const CONTROL =
  "focus-ring flex h-[30px] cursor-pointer list-none items-center gap-1.5 rounded-ctl border border-border bg-card px-2.5 text-sm font-medium hover:bg-hover";

/**
 * A menu of links in a popover, as the categories' (audit UI-EXP-3, Mattia's decision of
 * 20/11/2026): it stays open after a pick, so a second choice is one more click.
 */
function LinkMenu({
  label,
  active,
  width,
  children,
}: {
  label: ReactNode;
  active: boolean;
  width: string;
  children: ReactNode;
}) {
  return (
    <Popover trigger={label} triggerClassName={cn(CONTROL, active && "border-accent")}>
      <div className={cn("flex max-w-[calc(100vw-32px)] flex-col", width)}>{children}</div>
    </Popover>
  );
}

const HEADER =
  "flex items-center justify-between px-2 pt-1 pb-1.5 text-micro font-medium tracking-caps text-faint uppercase";

const CLEAR =
  "focus-ring rounded-xs text-sm font-medium tracking-normal text-accent normal-case hover:underline";

const OPTION = "focus-ring flex h-[30px] items-center gap-2.5 rounded-tag px-2 text-sm hover:bg-hover";

/** The design's checkbox square, as a glyph: these are links, not form controls. */
function Box({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-3.5 shrink-0 place-items-center rounded-sm border",
        checked ? "border-primary bg-primary text-primary-fg" : "border-border2",
      )}
    >
      {checked && <Check className="size-2.5" />}
    </span>
  );
}

/** A menu's summary: "All …", the one name picked, or how many. */
const summaryOf = (count: number, all: string, oneName: string | undefined, some: string) =>
  count === 0 ? all : count === 1 && oneName !== undefined ? oneName : some;

/**
 * The accounts menu of the filter row, multiple choice: Expenses and the page of the categories
 * (categories-and-rules.md §5.1) draw the same one. Its options are links: each is an address.
 */
export function AccountsMenu({
  accounts,
  selection,
  path,
  carry,
}: {
  accounts: readonly AccountFilterOption[];
  selection: readonly string[];
  path: string;
  carry: Params;
}) {
  const t = useTranslations("expenses.filters");
  const accountHref = (id: string) => withParams(path, carry, { acc: listParam(toggle(selection, id)) });
  const label = summaryOf(
    selection.length,
    t("accounts.all"),
    accounts.find((one) => one.id === selection[0])?.name,
    t("accounts.some", { count: selection.length }),
  );
  return (
    <LinkMenu
      active={selection.length > 0}
      width="w-[240px]"
      label={
        <>
          <Landmark aria-hidden className="size-3.5 text-muted" />
          {label}
          <ChevronDown aria-hidden className="size-3 text-muted" />
        </>
      }
    >
      <div className="flex flex-col">
        <div className={HEADER}>
          {t("accounts.title")}
          <Link href={withParams(path, carry, { acc: "" })} className={CLEAR}>
            {t("accounts.clear")}
          </Link>
        </div>
        <div className="max-h-[320px] overflow-y-auto">
          {accounts.map((one) => (
            <Link
              key={one.id}
              href={accountHref(one.id)}
              aria-current={selection.includes(one.id) ? "true" : undefined}
              className={OPTION}
            >
              <Box checked={selection.includes(one.id)} />
              <span className="min-w-0 flex-1 truncate">{one.name}</span>
              <span className="text-micro text-muted">{one.count}</span>
            </Link>
          ))}
        </div>
      </div>
    </LinkMenu>
  );
}

/**
 * The filter row of the design: the date range with its stepper, its four presets and its
 * two-month picker, then categories, account, type (F2.5), "Show hidden", the payee search and
 * "Clear filters".
 *
 * The state stays in the URL (spec §8.4 point 2): every control writes the address, through a
 * link or the router, and the page reads it back. Props are plain data: a server page renders it.
 */
export function FilterBar({
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
  const t = useTranslations("expenses.filters");
  const row = useTranslations("expenses.row");
  const router = useRouter();
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const selected = query.categorySelection;
  const accountSelection = query.accountSelection;
  const typeSelection = query.typeSelection;

  /** A filter changes, the period does not: the links keep the window the reader is looking at. */
  const carry: Params = query.params;
  const categoryHref = (id: string) => withParams(path, carry, { cat: listParam(toggle(selected, id)) });
  // In the fixed order of the types, so one selection is always one address.
  const typeHref = (type: TransactionType) => {
    const next = toggle(typeSelection, type);
    return withParams(path, carry, {
      type: listParam(TRANSACTION_TYPES.filter((one) => next.includes(one))),
    });
  };
  const typesLabel = summaryOf(
    typeSelection.length,
    t("types.all"),
    typeSelection[0] === undefined ? undefined : t(`types.${typeSelection[0]}`),
    t("types.some", { count: typeSelection.length }),
  );
  const categoriesLabel =
    selected.length === 0 ? t("categories.all") : t("categories.some", { count: selected.length });

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The address the GET form writes, field by field, without the full page load.
    const search = new URLSearchParams();
    for (const [name, value] of new FormData(event.currentTarget)) {
      if (typeof value === "string") search.append(name, value);
    }
    router.push(`${path}?${search}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <PeriodBar
        period={{
          preset: query.preset,
          offset: query.offset,
          range: query.range,
          stepperParams: query.stepperParams,
        }}
        path={path}
        locale={locale}
      />

      <span aria-hidden className="mx-1 h-[18px] w-px bg-border max-md:hidden" />

      <CategoryPicker
        categories={categories}
        multiple={{
          selectedIds: selected.map((id) => (id === UNCATEGORISED ? null : id)),
          title: t("categories.title"),
          clearLabel: t("categories.clear"),
          onClear: () => router.push(withParams(path, carry, { cat: "" })),
        }}
        uncategorisedLabel={t("categories.none")}
        uncategorisedCount={uncategorisedCount}
        open={categoriesOpen}
        onOpenChange={setCategoriesOpen}
        onPick={(id) => router.push(categoryHref(id ?? UNCATEGORISED))}
        searchLabel={row("searchCategory")}
        noMatchLabel={row("noCategoryMatch")}
        triggerLabel={categoriesLabel}
        triggerClassName={cn(CONTROL, selected.length > 0 && "border-accent")}
      >
        <TagIcon aria-hidden className="size-3.5 text-muted" />
        {categoriesLabel}
        <ChevronDown aria-hidden className="size-3 text-muted" />
      </CategoryPicker>

      {/* Accounts and types are multiple choice too, like the categories. */}
      <AccountsMenu accounts={accounts} selection={accountSelection} path={path} carry={carry} />

      <LinkMenu
        active={typeSelection.length > 0}
        width="w-[200px]"
        label={
          <>
            {typesLabel}
            <ChevronDown aria-hidden className="size-3 text-muted" />
          </>
        }
      >
        <div className="flex flex-col">
          <div className={HEADER}>
            {t("types.label")}
            <Link href={withParams(path, carry, { type: "" })} className={CLEAR}>
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
      </LinkMenu>

      <Link
        href={withParams(path, carry, { hidden: query.showHidden ? "" : "1" })}
        aria-current={query.showHidden ? "true" : undefined}
        className={cn(CONTROL, query.showHidden && "border-accent")}
      >
        <Box checked={query.showHidden} />
        {t("showHidden")}
      </Link>

      {query.filtered && (
        <Link
          href={withParams(path, query.clearedParams, {})}
          className="focus-ring inline-flex min-h-6 items-center rounded-xs px-1 font-medium text-accent hover:underline"
        >
          {t("clear")}
        </Link>
      )}

      <span className="flex-1" />

      {/* Still a GET form underneath: the same address before the bundle has loaded. */}
      <form method="get" action={path} onSubmit={submitSearch} className="flex items-center gap-1.5">
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

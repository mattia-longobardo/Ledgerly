"use client";

// «Da fare» of Overview (rewrite plan R5e): the items of `GET /todo`, oldest first, each a link to the
// page that resolves it. The sentence is the catalogue's, from the event and its counts and dates:
// a notification carries no amount, bank or account (G4).
import { useTranslations } from "next-intl";
import { listTodo, type NOTIFICATION_PAGES } from "@ledgerly/api-contract";
import type { RouteOutput } from "@ledgerly/api-client";
import { isCivilDate } from "@ledgerly/format/dates";
import { formatDate, type UiLocale } from "@ledgerly/format/format";
import { Card, CardHeader } from "@ledgerly/ui/card";
import { useApi } from "@ledgerly/ui/data";
import { Link } from "@ledgerly/ui/router";

type TodoItem = RouteOutput<typeof listTodo>["items"][number];
type Target = TodoItem["target"];

/** The page of each target; the ones with an id open that record (a fund: its account's, `pageId`). */
const PAGES: Record<(typeof NOTIFICATION_PAGES)[number], (id: string | null) => string> = {
  connection: () => "/settings/plugins",
  account: (id) => (id ? `/accounts/${id}` : "/accounts"),
  budget: (id) => (id ? `/budgets/${id}` : "/budgets"),
  expenses_review: () => "/expenses/review",
  payroll_review: () => "/payroll",
  investments_transfers: () => "/investments",
  fund: (id) => (id ? `/investments/${id}` : "/investments"),
  // A plan's instalment: its portfolio (R5d).
  investment_plan: (id) => (id ? `/investments/${id}` : "/investments"),
  overview: () => "/",
};

export const hrefOf = (target: Target): string =>
  PAGES[target.page](target.page === "fund" ? (target.pageId ?? null) : target.id);

/** The catalogue's values for the sentence: every parameter a sentence may name, never absent. */
function valuesOf(item: TodoItem, locale: UiLocale) {
  const { count = 0, percent = 0, days = 0, date } = item.params;
  return { count, percent, days, date: date && isCivilDate(date) ? formatDate(date, "long", locale) : "" };
}

/** Nothing while it reads or when there is nothing to do: Overview stays as it was. */
export function TodoCard({ locale }: { locale: UiLocale }) {
  const text = useTranslations("overview.todo");
  const events = useTranslations("notifications.todo");
  const todo = useApi(listTodo, {});
  const items = todo.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <Card padded={false} data-testid="todo">
      <CardHeader title={text("title")} />
      <ul className="flex flex-col">
        {items.map((item) => (
          <li key={item.id} className="border-t border-border">
            <Link
              href={hrefOf(item.target)}
              className="focus-ring flex min-h-11 items-center justify-between gap-3 px-4 py-2.5 hover:bg-hover"
            >
              <span>{events(item.event, valuesOf(item, locale))}</span>
              <span aria-hidden className="text-sm text-accent">
                {text("open")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

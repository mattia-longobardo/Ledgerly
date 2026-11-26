"use client";

// The tab «Transactions» of an account's page (PERS-651): its latest movements from
// `GET /transactions/view`, drawn by the table of Expenses, which opens with the account's filter.
import { useTranslations } from "next-intl";
import { accounts as accountRoutes } from "@ledgerly/api-contract/accounts";
import { categories as categoryRoutes, labels as labelRoutes } from "@ledgerly/api-contract/settings";
import { movements } from "@ledgerly/api-contract/transactions";
import type { RouteOutput } from "@ledgerly/api-client";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { withParams } from "@ledgerly/ui/url";
import { categoryColor, categoryColors, withMacroTitles } from "@/modules/transactions";
import { lineViewOf, TransactionsTable } from "@/modules/transactions/client";
import type { AccountPage } from "./account-screen";

/** The latest movements the tab shows; the rest are in Expenses. */
const ROWS = 50;

export function TransactionsTab({ page }: { page: AccountPage }) {
  const { account } = page;
  const view = useApi(movements.getTransactionsView, { query: { account: account.id, limit: ROWS } });
  const categoryList = useApi(categoryRoutes.listCategories, { query: {} });
  const labelList = useApi(labelRoutes.listLabels, {});
  const accountList = useApi(accountRoutes.listAccounts, { query: { archived: "true" } });
  return (
    <Loaded state={view}>
      {(data) => (
        <Loaded state={categoryList}>
          {({ categories }) => (
            <Loaded state={labelList}>
              {({ labels }) => (
                <Loaded state={accountList}>
                  {({ accounts }) => (
                    <Movements
                      page={page}
                      lines={data.rows}
                      truncated={data.listCount > data.rows.length}
                      categories={categories}
                      labels={labels}
                      accounts={accounts}
                    />
                  )}
                </Loaded>
              )}
            </Loaded>
          )}
        </Loaded>
      )}
    </Loaded>
  );
}

type Lines = RouteOutput<typeof movements.getTransactionsView>["rows"];
type Categories = RouteOutput<typeof categoryRoutes.listCategories>["categories"];

/** The active categories as the pickers offer them, under the title of their macro, as in Expenses. */
function useOptions(categories: Categories) {
  const text = useTranslations("expenses");
  const colorOf = categoryColors(categories);
  const options = withMacroTitles(
    categories
      .filter((one) => one.archivedAt === null)
      .map((one) => ({
        id: one.id,
        name: one.name,
        color: colorOf.get(one.id) ?? categoryColor(one.color, 0),
        depth: one.depth,
        type: one.type,
      })),
    { income: text("categories.macro.income"), expense: text("categories.macro.expense") },
  );
  return { colorOf, options };
}

function Movements({
  page,
  lines,
  truncated,
  categories,
  labels,
  accounts,
}: {
  page: AccountPage;
  lines: Lines;
  truncated: boolean;
  categories: Categories;
  labels: readonly { id: string; name: string; color: string | null }[];
  accounts: readonly { id: string; name: string }[];
}) {
  const text = useTranslations("accounts.detail.transactions");
  const { colorOf, options } = useOptions(categories);
  return (
    <section aria-labelledby="account-movements" className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="account-movements" className="text-lg font-semibold">
          {text("title")}
        </h2>
        <ButtonLink size="sm" href={withParams("/expenses", {}, { acc: page.account.id })}>
          {text("openInExpenses")}
        </ButtonLink>
      </div>
      <Card padded={false} className="overflow-clip" data-testid="account-transactions">
        {lines.length === 0 ? (
          <p className="p-4 text-muted">{text("empty")}</p>
        ) : (
          <TransactionsTable
            groups={[
              {
                key: "account",
                label: null,
                count: lines.length,
                total: "",
                rows: lines.map((line) =>
                  lineViewOf(line, { ...page.format, colorOf, categories: options, accounts }),
                ),
              },
            ]}
            categories={options}
            labels={labels}
            accounts={accounts}
            params={{ tab: "transactions" }}
            sort="date"
            direction="desc"
            path={`/accounts/${page.account.id}`}
            sortable={false}
          />
        )}
      </Card>
      {truncated && <p className="text-sm text-muted">{text("more", { shown: lines.length })}</p>}
    </section>
  );
}

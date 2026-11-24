"use client";

// What Ledgerly writes to the source (Settings › Integrations): the interest rules that publish on the
// source's accounts, read from `GET /interests`, the movements waiting to be sent, and the ones the
// source refused.
import { Link } from "@ledgerly/ui/router";
import { useTranslations } from "next-intl";
import { interests } from "@ledgerly/api-contract/interests";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";

const LINK =
  "focus-ring inline-flex min-h-6 items-center rounded-xs text-accent underline underline-offset-2";
const ROW = "border-t border-border px-4 py-3 first:border-t-0";

export function SourceWrites({
  provider,
  accountIds,
  waiting,
  refused,
}: {
  /** The name of the source. */
  provider: string;
  /** The source's accounts. */
  accountIds: readonly string[];
  /** The movements waiting to be sent, and the accounts they are on. */
  waiting: { count: number; accountIds: readonly string[] };
  /** Of those, the movements the source refused, and the accounts they are on. */
  refused: { count: number; accountIds: readonly string[] };
}) {
  const plugin = useTranslations("settings.plugin");
  const read = useApi(interests.listInterestRules, {});
  return (
    <Loaded state={read}>
      {(view) => {
        const publishing = view.rules.filter(
          (rule) => rule.mode === "post_to_provider" && accountIds.includes(rule.accountId),
        );
        return (
          <ul className="flex flex-col text-sm" data-testid="source-writes">
            {publishing.length === 0 && waiting.count === 0 && (
              <li className="px-4 py-3.5 text-muted">{plugin("writes.none")}</li>
            )}
            {publishing.map((rule) => (
              <li key={rule.id} className={ROW}>
                <Link href={`/interests/${rule.id}`} className={LINK}>
                  {plugin("writes.rule", { account: rule.account })}
                </Link>
              </li>
            ))}
            {waiting.count > 0 && (
              <li className={ROW}>
                <Link href={`/expenses?acc=${waiting.accountIds.join(",")}`} className={LINK}>
                  {plugin("writes.unsent", { count: waiting.count })}
                </Link>
              </li>
            )}
            {refused.count > 0 && (
              <li className={ROW}>
                <Link href={`/expenses?acc=${refused.accountIds.join(",")}`} className={LINK}>
                  {plugin("writes.refused", { provider })}
                </Link>
              </li>
            )}
          </ul>
        );
      }}
    </Loaded>
  );
}

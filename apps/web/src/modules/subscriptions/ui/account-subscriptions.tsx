"use client";

// The subscriptions an account pays, on its page (R5a, ST-13): `GET /subscriptions?account=`. It takes
// the place of the account's «Connections», a list kept by hand of the same charges; they are edited
// on the Subscriptions page, so this list only shows them and leads there.
import { useTranslations } from "next-intl";
import { profile } from "@ledgerly/api-contract/settings";
import { subscriptions } from "@ledgerly/api-contract/subscriptions";
import { parseCents } from "@ledgerly/format/cents";
import { formatMoney, numberStyle } from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { useApi } from "@ledgerly/ui/data";
import { SettingsSection } from "@ledgerly/ui/section";
import { frequencyText } from "./present";

/** The web's account page and the static package both mount it: it reads the number style itself. */
export function AccountSubscriptions({ accountId }: { accountId: string }) {
  const text = useTranslations("subscriptions");
  const prefs = useApi(profile.getPreferences, {}).data;
  const read = useApi(subscriptions.listSubscriptions, { query: { account: accountId } }).data;
  const style = prefs && numberStyle(prefs);
  const rows = style && read?.subscriptions;
  return (
    <SettingsSection
      title={text("account.label")}
      description={text("account.list")}
      action={
        <ButtonLink href="/subscriptions" size="sm">
          {text("account.manage")}
        </ButtonLink>
      }
    >
      {rows?.length === 0 && <p className="text-sm text-faint">{text("account.none")}</p>}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col gap-2 text-sm">
          {rows.map((row) => (
            <li key={row.id} className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-medium">{row.name}</span>
              <span className="shrink-0 text-muted tabular-nums">
                {formatMoney(parseCents(row.price), style)} · {frequencyText(row, text)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

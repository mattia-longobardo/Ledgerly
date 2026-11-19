"use client";

// The step «Done» of the switch (ux/n4-account-switch.md §3): what «Apply» counted and «Undo
// switch», read from the switch of `GET /accounts/{id}/context`.
import { useTranslations } from "next-intl";
import { views } from "@ledgerly/api-contract/accounts";
import { profile } from "@ledgerly/api-contract/settings";
import { civilDateIn } from "@ledgerly/format/dates";
import { formatDate } from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { Card } from "@ledgerly/ui/card";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { UndoSwitch } from "@/modules/accounts/client";

export function SwitchDone({ account }: { account: { id: string; name: string } }) {
  const text = useTranslations("accounts.switch");
  const preferences = useApi(profile.getPreferences, {});
  const context = useApi(views.getAccountContext, { params: { id: account.id } });
  return (
    <Loaded state={preferences}>
      {(prefs) => (
        <Loaded state={context}>
          {({ switch: open }) => {
            // «Undo switch» closed it: the page sends the person back to the account's settings.
            if (open === null) return null;
            const { counts } = open;
            const since = formatDate(
              civilDateIn(new Date(open.appliedAt), prefs.timeZone),
              "long",
              prefs.locale,
            );
            return (
              <Card className="flex flex-col gap-3">
                <h1 tabIndex={-1} className="text-xl font-semibold">
                  {text("done.title", { account: account.name })}
                </h1>
                <ul className="flex flex-col gap-1 text-sm">
                  <li>{text("done.matched", { count: counts.matched })}</li>
                  <li>{text("done.fresh", { count: counts.fresh })}</li>
                  {counts.transfers > 0 && <li>{text("done.transfers", { count: counts.transfers })}</li>}
                  {counts.joined > 0 && <li>{text("done.joined", { count: counts.joined })}</li>}
                </ul>
                <p className="text-sm text-muted">{text("done.sourceStops", { source: open.source })}</p>
                <p className="text-sm text-muted">{text("done.howToUndo")}</p>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <UndoSwitch
                    account={account.name}
                    source={open.source}
                    bank={text("done.theBank")}
                    since={since}
                    transfers={counts.transfers}
                    publishes={open.publishes}
                    joined={open.joined}
                    available={open.sourceConnected}
                    accountId={account.id}
                  />
                  <ButtonLink href={`/accounts/${account.id}`} variant="primary">
                    {text("done.goToAccount")}
                  </ButtonLink>
                </div>
              </Card>
            );
          }}
        </Loaded>
      )}
    </Loaded>
  );
}

"use client";

// The tab «Settings» of an account's page: its connections, its settings form, the switch to the
// bank and the Danger zone. It reads nothing of its own: the account and its context are the
// page's, the connections are read by their section, and the IBAN comes from the server (H45).
import { useTranslations } from "next-intl";
import { hasIbanField } from "@ledgerly/domain/accounts/client";
import { civilDateIn, today } from "@ledgerly/format/dates";
import { formatDate } from "@ledgerly/format/format";
import { ButtonLink } from "@ledgerly/ui/button";
import { UnsavedChangesProvider } from "@ledgerly/ui/unsaved-changes";
import { AccountSettingsForm, ConnectionsSection, UndoSwitch } from "@/modules/accounts/client";
import type { AccountPage } from "./account-screen";
import { DeleteAccount } from "./delete-account";

export function SettingsTab({ page, iban }: { page: AccountPage; iban: string | null }) {
  const { account, context } = page;
  const providerLabel = context.providerLabel;
  return (
    // Save and Discard for the settings live in the banner, which appears with a change: above the
    // connections, the first section of the tab, so it is seen where the tab starts.
    <UnsavedChangesProvider>
      <ConnectionsSection accountId={account.id} />
      <AccountSettingsForm
        sourceExtra={
          context.switch !== null || context.switchOffer !== "none" ? <SwitchBlock page={page} /> : null
        }
        deleteControl={
          <DeleteAccount
            accountId={account.id}
            name={account.name}
            source={account.origin === "synced" ? providerLabel : null}
          />
        }
        today={today(page.format.timeZone)}
        // The place the account holds in the list, so the colour control shows the colour the
        // charts and the list really draw it with (`colorFor`) rather than a fixed blue.
        index={page.index}
        account={{
          id: account.id,
          name: account.name,
          type: account.type,
          currency: account.currency,
          provider: providerLabel,
          origin: account.origin,
          state: account.state,
          color: account.color,
          reference: account.reference,
          // The IBAN is shown in full only here, on the person's own page (H45).
          iban,
          ibanFromSource: account.ibanFromSource,
          ibanField: hasIbanField(account.type),
          purpose: account.purpose,
          openedOn: account.openedOn,
          notes: account.notes,
          inNetWorth: account.inNetWorth,
          inSnapshot: account.inSnapshot,
          countsAsLiquid: account.countsAsLiquid,
          lowBalance: account.lowBalance ?? "",
          staleAfterHours: account.staleAfterHours,
          reminder: account.reminder,
          betweenEntries: account.betweenEntries,
        }}
      />
    </UnsavedChangesProvider>
  );
}

/**
 * The block of the switch to the bank in "Data source" (ux/n4-account-switch.md §2.2, §9.1): "Undo
 * switch" for an account that was moved, "Move to the bank" for one that may be, "Connect a bank"
 * when the person has the bank's plugin on and no bank yet.
 */
function SwitchBlock({ page }: { page: AccountPage }) {
  const text = useTranslations("accounts.switch");
  const { account, format } = page;
  const open = page.context.switch;
  if (open !== null) {
    const since = formatDate(civilDateIn(new Date(open.appliedAt), format.timeZone), "long", format.locale);
    return (
      <>
        <p className="text-sm text-muted">
          {text("settings.switched", {
            source: open.source,
            date: since,
            cut: formatDate(open.cutDate, "long", format.locale),
          })}
        </p>
        <UndoSwitch
          account={account.name}
          source={open.source}
          bank={text("done.theBank")}
          since={since}
          transfers={open.transfers}
          publishes={open.publishes}
          joined={open.joined}
          available={open.sourceConnected}
          accountId={account.id}
        />
      </>
    );
  }
  const offer = page.context.switchOffer === "offer";
  return (
    <>
      <p className="text-sm">{text(offer ? "settings.offer" : "settings.connectFirst")}</p>
      <div>
        <ButtonLink href={offer ? `/accounts/${account.id}/switch` : "/banks/connect"} size="sm">
          {text(offer ? "settings.offerAction" : "settings.connect")}
        </ButtonLink>
      </div>
    </>
  );
}

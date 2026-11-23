"use client";

// What holds the account, as the layout read it on the server (rewrite plan R5b, B1b): the pages under
// it draw the service's screens or the fund's with no read of their own, so a prefetch of a tab or a
// period renders them for free.
import { notFound } from "next/navigation";
import { createContext, type ReactNode, useContext } from "react";
import { FundScreen } from "@/modules/funds/client";
import { ServiceScreen, type ServiceTabKey } from "@/modules/investments/client";
import { OnClickRouter } from "@/platform/router";
import type { Holder } from "./holder";

const HolderContext = createContext<Holder | null>(null);

/**
 * The holder for the pages below, whose links load on the click only: each render of these pages asks
 * the server who holds the account (two reads), and a fund's page has a dozen links of tabs and periods.
 */
export function HolderProvider({ holder, children }: { holder: Holder; children: ReactNode }) {
  return (
    <HolderContext.Provider value={holder}>
      <OnClickRouter>{children}</OnClickRouter>
    </HolderContext.Provider>
  );
}

/** A tab of the account: the fund's page for a pension fund, which has its tabs in the address. */
export function HolderScreen({ accountId, tab }: { accountId: string; tab: ServiceTabKey }) {
  const holder = useContext(HolderContext);
  if (holder?.kind === "fund") {
    // A fund has no tab of a service.
    if (tab !== "overview") notFound();
    return <FundScreen id={holder.fundId} accountId={accountId} />;
  }
  return <ServiceScreen id={accountId} tab={tab} />;
}

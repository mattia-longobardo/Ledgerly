"use client";
// Funds, the entry of the pension funds' pages (rule M3): a fund's page and "Add pension fund", each read
// from `/api/v1` (rewrite plan R3), both in Investments since R5b. Each is loaded on its own: an entry is
// not split by the bundler, and a page that imported both would carry the code of the other.
import { lazy, Suspense } from "react";
import { FundDetailSkeleton } from "./ui/fund-skeleton";
import { WizardSkeleton } from "./ui/wizard-skeleton";

const Fund = lazy(() => import("./ui/fund-screen").then((screen) => ({ default: screen.FundScreen })));
const NewFund = lazy(() =>
  import("./ui/new-fund-screen").then((screen) => ({ default: screen.NewFundScreen })),
);

/** A fund's page, its tabs and its period, at its account's address in Investments. */
export function FundScreen({ id, accountId }: { id: string; accountId: string }) {
  return (
    <Suspense fallback={<FundDetailSkeleton />}>
      <Fund id={id} accountId={accountId} />
    </Suspense>
  );
}

/** "Add pension fund". */
export function NewFundScreen() {
  return (
    <Suspense fallback={<WizardSkeleton />}>
      <NewFund />
    </Suspense>
  );
}

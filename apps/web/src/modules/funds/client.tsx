"use client";
// Funds, the entry of the Funds pages (rule M3): the three screens, each read from `/api/v1`
// (rewrite plan R3). Each is loaded on its own: an entry is not split by the bundler, and a page that
// imported all three would carry the code of the other two.
import { lazy, Suspense } from "react";
import { FundDetailSkeleton } from "./ui/fund-skeleton";
import { FundsHomeSkeleton } from "./ui/home-skeleton";
import { WizardSkeleton } from "./ui/wizard-skeleton";

const Home = lazy(() => import("./ui/funds-screen").then((screen) => ({ default: screen.FundsScreen })));
const Fund = lazy(() => import("./ui/fund-screen").then((screen) => ({ default: screen.FundScreen })));
const NewFund = lazy(() =>
  import("./ui/new-fund-screen").then((screen) => ({ default: screen.NewFundScreen })),
);

/** The Funds home. */
export function FundsScreen() {
  return (
    <Suspense fallback={<FundsHomeSkeleton />}>
      <Home />
    </Suspense>
  );
}

/** A fund's page, its tabs and its period. */
export function FundScreen({ id }: { id: string }) {
  return (
    <Suspense fallback={<FundDetailSkeleton />}>
      <Fund id={id} />
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

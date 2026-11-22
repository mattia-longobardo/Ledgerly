"use client";
// Investments, the entry of the Investments pages (rule M3): the home and a service's tabs, read from
// `/api/v1` (rewrite plan R3). Each is loaded on its own: an entry is not split by the bundler, and a page that imported every screen would carry the code of the others.
import { type ComponentProps, lazy, Suspense } from "react";
import { HomeSkeleton, ServiceSkeleton } from "./ui/skeletons";

const Home = lazy(() =>
  import("./ui/home/home-screen").then((screen) => ({ default: screen.InvestmentsHomeScreen })),
);
const Service = lazy(() =>
  import("./ui/service/service-screen").then((screen) => ({ default: screen.ServiceScreen })),
);

export type { ServiceTabKey } from "./ui/service/service-tabs";

/** The Investments home. */
export function InvestmentsHomeScreen() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <Home />
    </Suspense>
  );
}

/** A service: its header, its tabs and the tab of the address. */
export function ServiceScreen(props: ComponentProps<typeof Service>) {
  return (
    <Suspense fallback={<ServiceSkeleton />}>
      <Service {...props} />
    </Suspense>
  );
}

"use client";
// Investments, the entry of the Investments pages (rule M3): the home and a service's tabs, read from
// `/api/v1` (rewrite plan R3), and the catalog's two commands. Each is loaded on its own: an entry is
// not split by the bundler, and a page that imported every screen would carry the code of the others.
import { type ComponentProps, lazy, Suspense } from "react";
import { HomeSkeleton, ServiceSkeleton } from "./ui/skeletons";

const Home = lazy(() =>
  import("./ui/home/home-screen").then((screen) => ({ default: screen.InvestmentsHomeScreen })),
);
const Service = lazy(() =>
  import("./ui/service/service-screen").then((screen) => ({ default: screen.ServiceScreen })),
);
const Manual = lazy(() =>
  import("./ui/manual-service").then((one) => ({ default: one.CreateManualServiceButton })),
);
const Connect = lazy(() => import("./ui/connect").then((one) => ({ default: one.ConnectProviderButton })));

export type { ConnectableProvider } from "./ui/connect";
export type { ExistingChoice } from "./ui/manual-service";
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

/** «Manual account» of the catalog. */
export function CreateManualServiceButton(props: ComponentProps<typeof Manual>) {
  return (
    <Suspense fallback={null}>
      <Manual {...props} />
    </Suspense>
  );
}

/** «Connect» of a provider in the catalog. */
export function ConnectProviderButton(props: ComponentProps<typeof Connect>) {
  return (
    <Suspense fallback={null}>
      <Connect {...props} />
    </Suspense>
  );
}

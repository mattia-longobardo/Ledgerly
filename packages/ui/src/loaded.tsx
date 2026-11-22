"use client";

// The three states of a block of data (audit UI-DS-8): reading, refused, read. A screen draws its
// data only once it is there; a refusal says so and offers to read again.
import { type ReactNode, useEffect } from "react";
import { useTranslations } from "use-intl";
import { ApiError } from "@ledgerly/api-client";
import type { ApiState } from "./data";
import { Link, useRouter } from "./router";
import { ErrorState } from "./states";

/** Where an addon that is off is turned on again (PA10): the same place a direct address leads to. */
const addonsHref = (addon: string) => `/settings/addons?off=${encodeURIComponent(addon)}`;

/** A read of an addon that is off (`409 module_inactive`): the screen goes to Settings › Addons. */
function ModuleInactive({ addon }: { addon: string }) {
  const text = useTranslations();
  const router = useRouter();
  useEffect(() => router.replace(addonsHref(addon)), [router, addon]);
  return (
    <p role="status" className="text-sm text-muted">
      {text("errors.moduleInactive")}{" "}
      <Link href={addonsHref(addon)} className="focus-ring rounded-xs text-accent underline">
        {text("errors.moduleInactiveLink")}
      </Link>
    </p>
  );
}

export function Loaded<T>({ state, children }: { state: ApiState<T>; children: (data: T) => ReactNode }) {
  const text = useTranslations();
  if (state.data !== undefined) return children(state.data);
  if (state.error instanceof ApiError && state.error.code === "module_inactive" && state.error.reason)
    return <ModuleInactive addon={state.error.reason} />;
  if (state.error)
    return (
      <ErrorState
        title={text("errors.generic.title")}
        description={text("errors.generic.description")}
        onRetry={state.reload}
        retryLabel={text("common.retry")}
      />
    );
  return (
    <p role="status" className="text-sm text-muted">
      {text("common.loading")}
    </p>
  );
}

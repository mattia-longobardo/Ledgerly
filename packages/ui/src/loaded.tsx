"use client";

// The three states of a block of data (audit UI-DS-8): reading, refused, read. A screen draws its
// data only once it is there; a refusal says so and offers to read again.
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import type { ApiState } from "./data";
import { ErrorState } from "./states";

export function Loaded<T>({ state, children }: { state: ApiState<T>; children: (data: T) => ReactNode }) {
  const text = useTranslations();
  if (state.data !== undefined) return children(state.data);
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

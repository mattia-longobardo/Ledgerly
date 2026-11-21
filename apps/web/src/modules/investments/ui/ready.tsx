"use client";

// A read of a whole screen: its skeleton while it is read, the refusal with «Try again», then the screen.
// The skeleton is a `<main>`, as the page it stands for (the screen checks wait for it to go).
import type { ReactNode } from "react";
import type { ApiState } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";

export function Ready<T>({
  state,
  skeleton,
  children,
}: {
  state: ApiState<T>;
  skeleton: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (state.data === undefined && !state.error) return <>{skeleton}</>;
  return <Loaded state={state}>{children}</Loaded>;
}

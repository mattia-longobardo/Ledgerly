"use client";

// The plugins that are off (H56, PERS-615 §4): nothing of theirs can be changed, and nothing waits to
// be sent to them. Read once from `GET /plugins` (the cache of `useApi` shares it between the rows).
import { sources } from "@ledgerly/api-contract/settings";
import { useApi } from "@ledgerly/ui/data";

interface SourcesOff {
  /** Their names, as a movement waiting to be sent names its source. */
  names: ReadonlySet<string>;
  /** Their providers (`plugin:<id>`), as a category of a source names it. */
  providers: ReadonlySet<string>;
}

export function useSourcesOff(): SourcesOff {
  const plugins = useApi(sources.listPlugins, {});
  const off = (plugins.data?.plugins ?? []).filter(
    (one) => one.pluginState === "not_active" || one.pluginState === "needs_cleanup",
  );
  return {
    names: new Set(off.map((one) => one.name)),
    providers: new Set(off.map((one) => `plugin:${one.id}`)),
  };
}

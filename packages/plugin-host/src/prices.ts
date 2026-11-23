/**
 * The adapter of the port `PriceSource` of `instruments` (rewrite plan R5d): a plugin with
 * `prices.daily`, called on `POST /prices` through the one client of the core. It speaks the
 * contract's types: the port has the same shape, and `apps/worker`, which connects the two, is where
 * the compiler holds them equal.
 */
import type { z } from "zod";
import {
  PLUGIN_PATHS,
  type pricesRequestSchema,
  type PricesResponse,
  pricesResponseSchema,
} from "@ledgerly/plugin-contract";
import type { ConfiguredPlugin } from "@ledgerly/domain/platform/plugin-config";
import { callPlugin, type Fetch } from "./client";

/** The plugin answers within its own budget of 40 seconds; the call waits a little more. */
const PRICES_TIMEOUT_MS = 60_000;

interface PluginPriceSource {
  id: string;
  closes(request: z.input<typeof pricesRequestSchema>): Promise<PricesResponse>;
}

export function pluginPriceSource(plugin: ConfiguredPlugin, fetchFn?: Fetch): PluginPriceSource {
  return {
    id: plugin.id,
    closes: (request) =>
      callPlugin(plugin, PLUGIN_PATHS.prices, pricesResponseSchema, {
        body: request,
        timeoutMs: PRICES_TIMEOUT_MS,
        fetchFn,
      }),
  };
}

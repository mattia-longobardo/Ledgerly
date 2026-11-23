/**
 * The calls of contract 2 (a source read with the person's own credentials), as the core's engines
 * of a source ask them: one function per path, the credentials of one connection in every body,
 * every answer read through the contract's schema by `callPlugin`. Which plugin is called is the
 * caller's word; this file names no provider (rule M12).
 */
import type { z } from "zod";
import {
  editResponseSchema,
  pushResponseSchema,
  SOURCE_PATHS,
  sourceAccountsResponseSchema,
  sourceCategoriesResponseSchema,
  sourceMovementsResponseSchema,
  writeCategoriesResponseSchema,
} from "@ledgerly/plugin-contract";
import type {
  editRequestSchema,
  pushRequestSchema,
  writeCategoriesRequestSchema,
} from "@ledgerly/plugin-contract";
import type { ConfiguredPlugin } from "@ledgerly/domain/platform/plugin-config";
import { configuredPlugins } from "@ledgerly/domain/platform/plugins";
import { callPlugin, type Fetch, PluginCallError } from "./client";

type Request<T extends z.ZodType> = Omit<z.infer<T>, "credentials">;

/**
 * A reading of a source retries the provider inside the plugin (five attempts, with waits of up to
 * 16 s) and halves a window while a page comes back full: the core waits longer than for a bank's
 * call, or a provider that is only slow would read as a plugin that is down.
 */
const SOURCE_TIMEOUT_MS = 180_000;

/** The calls of one plugin with one connection's credentials. `fetchFn` is the tests' door. */
export function sourceCalls(plugin: ConfiguredPlugin, credentials: Record<string, string>, fetchFn?: Fetch) {
  const call = <T>(path: string, schema: z.ZodType<T>, body: object = {}) =>
    callPlugin(plugin, path, schema, {
      body: { credentials, ...body },
      timeoutMs: SOURCE_TIMEOUT_MS,
      fetchFn,
    });
  return {
    accounts: async () => (await call(SOURCE_PATHS.accounts, sourceAccountsResponseSchema)).accounts,
    categories: async () => (await call(SOURCE_PATHS.categories, sourceCategoriesResponseSchema)).categories,
    movements: async (window: { from: string; to: string }) =>
      (await call(SOURCE_PATHS.movements, sourceMovementsResponseSchema, window)).movements,
    push: (request: Request<typeof pushRequestSchema>) =>
      call(SOURCE_PATHS.push, pushResponseSchema, request),
    edit: (request: Request<typeof editRequestSchema>) =>
      call(SOURCE_PATHS.edit, editResponseSchema, request),
    writeCategories: (request: Request<typeof writeCategoriesRequestSchema>) =>
      call(SOURCE_PATHS.writeCategories, writeCategoriesResponseSchema, request),
  };
}

/**
 * The calls of the plugin `pluginId` of the server's configuration. A plugin the configuration
 * does not name fails every call as `plugin_down`: the reading fails, and says the plugin is not
 * there, instead of the process failing at the first connection it opens.
 */
export function openSource(pluginId: string, credentials: Record<string, string>) {
  const plugin = configuredPlugins().find((one) => one.id === pluginId);
  if (!plugin) {
    const down = () => Promise.reject(new PluginCallError("plugin_down"));
    return {
      accounts: down,
      categories: down,
      movements: down,
      push: down,
      edit: down,
      writeCategories: down,
    };
  }
  return sourceCalls(plugin, credentials);
}

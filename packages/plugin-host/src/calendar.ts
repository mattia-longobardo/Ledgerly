/**
 * The calls of contract 2 for an external calendar of days off, as the core's engine asks them: one
 * function per path, the credentials of one connection in every body, every answer read through
 * the contract's schema by `callPlugin`. Which plugin is called is the caller's word; this file
 * names no provider (rule M12).
 */
import {
  CALENDAR_PATHS,
  leaveFiguresResponseSchema,
  leaveReadResponseSchema,
  leaveWriteResponseSchema,
  PLUGIN_PATHS,
  verifyResponseSchema,
} from "@ledgerly/plugin-contract";
import type { LeaveDay, leaveWriteRequestSchema } from "@ledgerly/plugin-contract";
import type { z } from "zod";
import type { ConfiguredPlugin } from "@ledgerly/domain/platform/plugin-config";
import { configuredPlugins } from "@ledgerly/domain/platform/plugins";
import { callPlugin, type Fetch, PluginCallError } from "./client";

/**
 * A write reads the year, sends each change once and reads it again; the plugin retries a read of
 * the calendar with waits of up to 8 s. The core waits longer than for a bank's call.
 */
const CALENDAR_TIMEOUT_MS = 120_000;

interface Target {
  plugin: ConfiguredPlugin;
  credentials: Record<string, string>;
  fetchFn?: Fetch;
}

/** One call with the connection's credentials in its body, read through the contract's schema. */
function post<T>(target: Target, path: string, schema: z.ZodType<T>, body: object = {}): Promise<T> {
  const options = { body: { credentials: target.credentials, ...body }, timeoutMs: CALENDAR_TIMEOUT_MS };
  return callPlugin(target.plugin, path, schema, { ...options, fetchFn: target.fetchFn });
}

/** The calls of one plugin with one connection's credentials. `fetchFn` is the tests' door. */
export function calendarCalls(
  plugin: ConfiguredPlugin,
  credentials: Record<string, string>,
  fetchFn?: Fetch,
) {
  const target: Target = { plugin, credentials, fetchFn };
  return {
    verify: async () => (await post(target, PLUGIN_PATHS.verify, verifyResponseSchema)).access,
    read: async (year: number): Promise<LeaveDay[]> =>
      (await post(target, CALENDAR_PATHS.read, leaveReadResponseSchema, { year })).days,
    write: (request: Omit<z.infer<typeof leaveWriteRequestSchema>, "credentials">) =>
      post(target, CALENDAR_PATHS.write, leaveWriteResponseSchema, request),
    figures: async (year: number) =>
      (await post(target, CALENDAR_PATHS.figures, leaveFiguresResponseSchema, { year })).figures,
  };
}

/**
 * The calls of the plugin `pluginId` of the server's configuration. A plugin the configuration
 * does not name fails every call as `plugin_down`: the pass fails and says the plugin is not there.
 */
export function openCalendar(pluginId: string, credentials: Record<string, string>) {
  const [plugin] = configuredPlugins().filter((one) => one.id === pluginId);
  if (plugin !== undefined) return calendarCalls(plugin, credentials);
  const down = async (): Promise<never> => {
    throw new PluginCallError("plugin_down");
  };
  return { verify: down, read: down, write: down, figures: down };
}

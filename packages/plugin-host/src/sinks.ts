// The ports of the engines of plugin-host (rewrite plan R5c, P3b): what each needs from the domain,
// wired by the application (rule M8: only `apps/api` joins a port and its adapter).
import type { LeaveSink } from "./leave/ports";
import type { MovementsSink } from "./movements/ports";

interface Sinks {
  movements?: MovementsSink;
  leave?: LeaveSink;
}

// On `globalThis`, as the other ports: one process may load this file in more than one bundle.
declare global {
  var ledgerlyEngineSinks: Sinks | undefined;
}

/** Wires the ports; the application calls it once per process, before any request or job. */
export function wireSinks(sinks: Sinks): void {
  globalThis.ledgerlyEngineSinks = { ...globalThis.ledgerlyEngineSinks, ...sinks };
}

/** A wired port; a process that did not wire it fails loudly. */
export function sinkOf<K extends keyof Sinks>(key: K): NonNullable<Sinks[K]> {
  const sink = globalThis.ledgerlyEngineSinks?.[key];
  if (!sink) throw new Error(`${key}: the port is not wired (wireDomain of @ledgerly/api)`);
  return sink;
}

import { env } from "@/lib/env";
import type { MalwareScanner } from "../application/ports";
import { createClamdScanner } from "./clamd-scanner";
import { noopScanner } from "./noop-scanner";

/**
 * The one place the deployment's scanner choice is read. Called by whoever
 * builds the deps bag, before any transaction opens (Ruling R4-8), because
 * scanning is a network round trip.
 */
export function resolveScanner(): MalwareScanner {
  const e = env();
  if (e.MALWARE_SCANNER === "clamd") {
    return createClamdScanner({ host: e.CLAMD_HOST, port: e.CLAMD_PORT, timeoutMs: 30_000 });
  }
  return noopScanner;
}

import type {
  ConnectionStatus,
  DisconnectPolicy,
  IntegrationConnection,
  TestResult,
} from "@/platform/integrations/types";

/** A test is the only thing that can move a connection into `connected`. */
export function statusAfterTest(result: TestResult): ConnectionStatus {
  return result.ok ? "connected" : "error";
}

/**
 * `disabled` is a deliberate pause and `error` is a broken credential; neither
 * may be synced from. Keeping this in one predicate is what stops a caller
 * from checking `!== "disconnected"` and quietly syncing a broken connection.
 */
export function isUsable(connection: IntegrationConnection): boolean {
  return connection.status === "connected";
}

export function nextStatusAfterSync(failed: boolean): ConnectionStatus {
  return failed ? "error" : "connected";
}

export const DISCONNECT_POLICIES: readonly DisconnectPolicy[] = ["keep", "archive", "purge"];

/** The exact sentence the disconnect dialog shows, so UI and API cannot describe the same policy differently. */
export function describeDisconnectPolicy(policy: DisconnectPolicy): string {
  if (policy === "keep") {
    return "Keep everything. The credential is deleted; synced accounts and their history stay exactly as they are.";
  }
  if (policy === "archive") {
    return "Archive. The credential is deleted and every account this provider owned is archived, history included.";
  }
  return "Purge. The credential is deleted, the provider links are removed, and accounts nothing else references are deleted.";
}

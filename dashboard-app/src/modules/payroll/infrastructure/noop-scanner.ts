import type { MalwareScanner } from "../application/ports";

/**
 * Spec §13.3's default: the boundary exists, no scanner is enabled.
 *
 * It names itself `"none"` rather than pretending to be a scanner, and that
 * name is **persisted** on every import it clears (Ruling R4-2). "Nothing
 * scanned this" is then a recorded fact an auditor can read off the row, not an
 * assumption they have to reconstruct from a deployment's environment three
 * years later.
 */
export const noopScanner: MalwareScanner = {
  async scan() {
    return { verdict: "clean", scanner: "none", signature: null };
  },
};

export interface StatusChip {
  label: string;
  tone: "positive" | "warning" | "negative" | "neutral";
}

/**
 * One English label per pipeline status. The scan status wins where it is the
 * more useful thing to say: "Scanner unavailable" tells an operator to look at
 * clamd, where a bare "Scanning" would look like ordinary progress, and
 * "Malware found" is the one rejection reason worth naming on the list.
 */
const LABELS: Record<string, StatusChip> = {
  received: { label: "Uploaded", tone: "neutral" },
  scanning: { label: "Scanning", tone: "neutral" },
  needs_ocr: { label: "Needs OCR", tone: "warning" },
  extracting: { label: "Reading", tone: "neutral" },
  parsed: { label: "Parsed", tone: "neutral" },
  needs_review: { label: "Needs review", tone: "warning" },
  verified: { label: "Confirmed", tone: "warning" },
  applied: { label: "Applied", tone: "positive" },
  rejected: { label: "Rejected", tone: "negative" },
  superseded: { label: "Superseded", tone: "neutral" },
  failed: { label: "Failed", tone: "negative" },
};

export function statusChip(status: string, scanStatus: string): StatusChip {
  if (scanStatus === "infected") return { label: "Malware found", tone: "negative" };
  if (scanStatus === "unavailable" && status === "scanning") return { label: "Scanner unavailable", tone: "warning" };
  return LABELS[status] ?? { label: status, tone: "neutral" };
}

// Imports (rewrite plan R2, 05-refactor.md §5.5 «imports»; audit IMP-4, PAY-2, API-4): the upload of
// a document, one route for a script and for the screen. It keeps the shape `POST /api/v1/imports`
// had before the contract (spec §9.3): one `file` and its `kind` per request, the answer of the
// document received. A file already received is the same document again, with 200. The kinds of a
// fund's documents stay on the wire and are refused with 415, nothing of the file kept (ST-26).
import { z } from "zod";
import { defineRoute } from "../route";
import { DOCUMENT_STATES } from "../payroll/shared";

// The vocabulary is the domain's (`@ledgerly/domain/imports`): `tools/contract.test.ts` holds it equal.
export const DOCUMENT_KINDS = ["payslip", "cometa_operations", "cometa_position"] as const;

/** At most this many files in one upload of a screen: one call of the route carries one. */
export const MAX_FILES = 24;

const DOCUMENT_ID = "3f2a1b0c-9d8e-4f7a-8b6c-5d4e3f2a1b0c";

export const uploadDocument = defineRoute({
  id: "upload_document",
  method: "POST",
  path: "/imports",
  scope: "imports",
  capability: "imports",
  summary:
    "Receives one document as `multipart/form-data` (`kind`, `file`) and starts its reading. The format " +
    "is read from the content: a payslip is a PDF, of at most 10 MiB. The same file sent again is the " +
    "same document (`duplicate: true`, 200). A fund's kinds are refused with 415 and nothing is kept. " +
    "A `400` names the use case's refusal in `reason` (`empty`, `storage_failed`, …).",
  actions: [],
  bodyFormat: "multipart",
  // No size here: the use case checks it once (IMP-4), after the kind, as before the contract.
  body: z.object({ kind: z.enum(DOCUMENT_KINDS), file: z.file() }),
  response: z.object({
    id: z.uuid(),
    kind: z.enum(DOCUMENT_KINDS),
    fileName: z.string(),
    state: z.enum(DOCUMENT_STATES),
    duplicate: z.boolean(),
  }),
  status: 201,
  otherStatus: { status: 200, when: "The file was already received: the same document." },
  errors: ["invalid", "too_large", "unsupported_format"],
  example: {
    body: { kind: "payslip", file: new File([new Uint8Array([37, 80, 68, 70, 45])], "payslip.pdf") },
    response: {
      id: DOCUMENT_ID,
      kind: "payslip",
      fileName: "payslip.pdf",
      state: "received",
      duplicate: false,
    },
  },
});

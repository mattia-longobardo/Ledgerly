// Imports (rewrite plan R2, 05-refactor.md §5.5; audit API-4, IMP-4): `POST /imports`, the upload of
// one document, the use case the Payroll screen calls with many. The route knows the registry of the
// readers, never a kind's owner: a kind nobody reads (a fund's, ST-26) is refused before the size,
// and nothing of its file is kept.
import type { Hono } from "hono";
import { IMPORTS, type RouteContract } from "@ledgerly/api-contract";
import { documentReaderOf, ImportError, uploadDocuments } from "@ledgerly/domain/imports";
import { type ApiEnv, ApiRefusal, type Guard, OtherStatus, serve } from "../serve";

const { imports } = IMPORTS;

/** The codes of a refused file, as the route answered them before the contract. */
const REFUSALS: Partial<Record<string, "too_large" | "unsupported_format">> = {
  too_large: "too_large",
  unsupported_format: "unsupported_format",
};

export function serveImports(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serve(app, guard, imports.uploadDocument, async ({ ctx, body }) => {
    const reader = documentReaderOf(body.kind);
    if (!reader) throw new ApiRefusal("unsupported_format");
    let result;
    try {
      result = await uploadDocuments(ctx, reader, [body.file]);
    } catch (error) {
      if (error instanceof ImportError) throw new ApiRefusal("invalid", error.code);
      throw error;
    }
    const [refused] = result.refused;
    if (refused) {
      const code = REFUSALS[refused.error];
      // A refusal the contract has no code of its own for is `invalid`, with the use case's in `reason`.
      throw code ? new ApiRefusal(code) : new ApiRefusal("invalid", refused.error);
    }
    const [{ document, duplicate }] = result.uploaded;
    const answer = {
      id: document.id,
      kind: document.kind,
      fileName: document.fileName,
      state: document.state,
      duplicate,
    };
    return duplicate ? new OtherStatus(answer) : answer;
  });
  return [imports.uploadDocument];
}

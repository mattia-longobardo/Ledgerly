// src/app/(app)/settings/categories/macro.ts — "Move to another section" (§5.6, QC8). The use case
// joins several modules, so it lives in `apps/api` with its route; the screen gives it the names of
// the sources, from the registry of the providers that is still the web's (rewrite plan E5).
import "server-only";
import { macroMoveView as viewWithNames } from "@ledgerly/api";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { sourceNameOf } from "@/platform/integrations/registry";

export type { MacroMoveUndo, MacroMoveView } from "@ledgerly/api";
export { moveToMacro, undoMoveToMacro } from "@ledgerly/api";

export const macroMoveView = (ctx: Pick<Ctx, "userId" | "timeZone" | "locale">, id: string) =>
  viewWithNames(ctx, id, sourceNameOf);

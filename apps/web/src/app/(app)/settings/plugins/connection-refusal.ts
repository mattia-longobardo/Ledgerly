// src/app/(app)/settings/plugins/connection-refusal.ts — the sentence of a refusal of a connection's
// run, a `reason` of the contract's closed list (CONNECTION_REFUSALS): the row of a connection and
// «Try again now» of a bank's first reading say the same thing for the same code.
import { useTranslations } from "next-intl";
import { codeKey } from "@ledgerly/domain/platform/integrations/client";

/** The words of a connection in a refusal: `name`, and `provider` as a person calls it. */
type RefusalNames = { name: string; provider: string };

/** A refusal's code as its sentence; one branch per code so the catalogue keys stay literal. */
export function useRefusalText() {
  const text = useTranslations("settings.connections");
  return (code: string, names: RefusalNames): string => {
    if (code === "busy") return text("codes.busy");
    if (code === "unavailable") return text("codes.unavailable");
    if (code === "not_active") return text("text.pausedProvider", names);
    if (code === "pending") return text("text.pending");
    return text(`codes.${codeKey(code)}`, names);
  };
}

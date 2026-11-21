"use client";

// What the catalogue says of one provider (rule M12: no provider is named in the code): its key's steps,
// the line of its data's source, and how it differs — its closes come matched with their openings
// (`closedNote`), its income is in the value (`incomeIncludedNote`). Read by the provider's id, `_` for
// every sign a message key cannot hold.
import { useMessages } from "next-intl";
import { z } from "zod";

const STEPS = z.object({ 1: z.string(), 2: z.string(), 3: z.string(), 4: z.string() });

const CATALOGUE = z.object({
  investments: z.object({
    providers: z.record(
      z.string(),
      z.object({
        steps: STEPS,
        brand: z.string(),
        closedNote: z.string().optional(),
        incomeIncludedNote: z.string().optional(),
      }),
    ),
  }),
});

type ProviderWords = z.infer<typeof CATALOGUE>["investments"]["providers"][string];

/** The words of a provider; undefined for one the catalogue does not describe (a manual service). */
export function useProviderWords(providerId: string | null | undefined): ProviderWords | undefined {
  const providers = CATALOGUE.parse(useMessages()).investments.providers;
  return providerId ? providers[providerId.replace(/[^a-z0-9]/g, "_")] : undefined;
}

/** A sentence of the catalogue with its `{name}`. */
export const withName = (sentence: string, name: string) => sentence.replace("{name}", name);

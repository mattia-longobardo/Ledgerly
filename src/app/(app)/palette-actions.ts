// src/app/(app)/palette-actions.ts — the ⌘K palette's search of the user's own records (spec §8.2):
// pockets, funds and subscriptions by name. Here rather than in a module because it spans two of them.
"use server";

import type { Route } from "next";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { searchFunds } from "@/modules/funds/queries";
import { searchPockets } from "@/modules/pockets/queries";
import { searchSubscriptions } from "@/modules/subscriptions/queries";
import { requireSession } from "@/platform/auth/session";
import type { RecordMatch } from "@/ui/shell/commands";

export async function searchRecordsAction(query: string): Promise<RecordMatch[]> {
  const ctx = await requireSession();
  const term = z.string().max(200).safeParse(query);
  if (!term.success) return [];
  const t = await getTranslations("shell.palette");
  const [pockets, subscriptions, funds] = await Promise.all([
    searchPockets(ctx, term.data),
    searchSubscriptions(ctx, term.data),
    searchFunds(ctx, term.data),
  ]);
  return [
    ...pockets.map((pocket) => ({
      id: `pocket:${pocket.id}`,
      label: pocket.name,
      hint: t("pocket"),
      href: `/pockets?pocket=${pocket.id}` as Route,
    })),
    ...funds.map((fund) => ({
      id: `fund:${fund.id}`,
      label: fund.name,
      hint: t("fund"),
      href: `/funds/${fund.id}` as Route,
    })),
    ...subscriptions.map((subscription) => ({
      id: `subscription:${subscription.id}`,
      label: subscription.name,
      hint: t("subscription"),
      href: "/subscriptions" as Route,
    })),
  ];
}

"use client";

// The manual movement and the automatic categories with their calls to `/api/v1` (rewrite plan R3). A
// server page cannot hand a client component plain functions, so it renders these. The pages that list
// the rows are still drawn on the server: after a write, the page is read again, as `revalidatePath`
// did. shortcut: `router.refresh()` goes when Expenses, «To review» and a category's page read their
// rows on the client (the fields asked on PERS-474).
import { useRouter } from "next/navigation";
import { type ComponentProps, useMemo } from "react";
import { CATEGORY_CALLS } from "../category-calls";
import { MANUAL_CALLS } from "../manual-calls";
import { CategoryActions, type CategoryCommands } from "./category-actions";
import { ManualMovement } from "./manual-movement";
import type { ManualCommands } from "./manual-types";

/** A write, followed by a read of the page. */
const thenRefresh =
  <A extends unknown[], R>(write: (...args: A) => Promise<R>, refresh: () => void) =>
  async (...args: A): Promise<R> => {
    const result = await write(...args);
    refresh();
    return result;
  };

export function ApiManualMovement(props: Omit<ComponentProps<typeof ManualMovement>, "commands">) {
  const router = useRouter();
  const commands = useMemo<ManualCommands>(
    () => ({
      ...MANUAL_CALLS,
      create: thenRefresh(MANUAL_CALLS.create, router.refresh),
      update: thenRefresh(MANUAL_CALLS.update, router.refresh),
      remove: thenRefresh(MANUAL_CALLS.remove, router.refresh),
      retrySend: thenRefresh(MANUAL_CALLS.retrySend, router.refresh),
    }),
    [router],
  );
  return <ManualMovement {...props} commands={commands} />;
}

export function ApiCategoryActions(props: Omit<ComponentProps<typeof CategoryActions>, "commands">) {
  const router = useRouter();
  const commands = useMemo<CategoryCommands>(
    () => ({
      ...CATEGORY_CALLS,
      confirm: thenRefresh(CATEGORY_CALLS.confirm, router.refresh),
      choose: thenRefresh(CATEGORY_CALLS.choose, router.refresh),
      undo: thenRefresh(CATEGORY_CALLS.undo, router.refresh),
    }),
    [router],
  );
  return <CategoryActions {...props} commands={commands} />;
}

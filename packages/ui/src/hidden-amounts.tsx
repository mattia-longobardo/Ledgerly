"use client";

// «Hide amounts» (rewrite plan R5e, D3): the one component that hides every amount of every screen.
// It masks the text `@ledgerly/format` writes, so no screen has a branch of its own and no figure,
// total or chart scale changes: only what is read on the screen does.
import { Fragment, type ReactNode } from "react";
import { maskAmounts } from "@ledgerly/format/format";

export function HiddenAmounts({ hidden, children }: { hidden: boolean; children: ReactNode }) {
  // Before the children draw, and only in the browser: a server draws the pages of many people.
  if (typeof window !== "undefined") maskAmounts(hidden);
  // A new key draws the screens again when the choice changes: a text written before keeps its form.
  return <Fragment key={String(hidden)}>{children}</Fragment>;
}

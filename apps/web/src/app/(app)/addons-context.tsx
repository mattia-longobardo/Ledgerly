"use client";

// The addons that are on, as the layout read them from the session: a screen hides the blocks of an
// addon that is off (PA10) with no request of its own. The layout is drawn again when they change.
import { createContext, type ReactNode, useContext } from "react";
import type { AddonId } from "@ledgerly/api-contract";
import { isOn } from "./navigation";

const AddonsContext = createContext<readonly AddonId[] | undefined>(undefined);

export function AddonsProvider({ addons, children }: { addons?: readonly AddonId[]; children: ReactNode }) {
  return <AddonsContext.Provider value={addons}>{children}</AddonsContext.Provider>;
}

/** Whether the addon is on; outside the shell every addon is. */
export function useAddonOn(addon: AddonId): boolean {
  return isOn(addon, useContext(AddonsContext));
}

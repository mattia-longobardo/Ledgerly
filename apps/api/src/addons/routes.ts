// The Addons of a person (rewrite plan R5a, H52): which modules are on, and the switch of each.
import type { Hono } from "hono";
import {
  ADDON_GROUPS,
  ADDON_STOPS,
  ADDONS,
  ADDONS_ROUTES,
  type AddonId,
  getAddons,
  type RouteContract,
  setAddon,
} from "@ledgerly/api-contract";
import { getSavedPreferences, setAddon as switchAddon } from "@ledgerly/domain/users";
import { type ApiEnv, type Guard, serve } from "../serve";

/** Every addon, in the order of the list, with whether it is on and what it stops elsewhere. */
function addonsBody(active: readonly AddonId[]) {
  return {
    addons: ADDONS.map((id) => ({
      id,
      group: ADDON_GROUPS[id] ?? null,
      active: active.includes(id),
      stops: [...(ADDON_STOPS[id] ?? [])],
    })),
  };
}

export function serveAddons(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serve(app, guard, getAddons, async ({ ctx }) => addonsBody((await getSavedPreferences(ctx)).addons));
  serve(app, guard, setAddon, async ({ ctx, params, body }) =>
    addonsBody(await switchAddon(ctx, params.id, body.active)),
  );
  return ADDONS_ROUTES;
}

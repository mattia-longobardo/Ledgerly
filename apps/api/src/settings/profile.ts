// Users and settings · profile and preferences. `changePreferences` and `renameProfile` are the use
// cases of the forms too; the app composes the change of zone with the schedules (D7, §10.2).
import type { Hono } from "hono";
import { type RouteContract, SETTINGS } from "@ledgerly/api-contract";
import type { Ctx } from "@ledgerly/domain/platform/context";
import { rescheduleConnections } from "@ledgerly/domain/platform/integrations";
import { ProfileError, profileOf, renameProfile } from "@ledgerly/domain/platform/auth";
import { changePreferences, getPreferences, type Preferences } from "@ledgerly/domain/users";
import { type ApiEnv, ApiRefusal, type Guard, serve } from "../serve";

const { profile } = SETTINGS;

/**
 * Changes some preferences; a new zone moves the times of every connection with it (D7, audit
 * USR-7). The one place that does: the Profile form and `PATCH /api/v1/preferences` call it.
 */
export async function savePreferences(ctx: Pick<Ctx, "userId">, patch: unknown): Promise<Preferences> {
  const { preferences, timeZoneChanged } = await changePreferences(ctx, patch);
  if (timeZoneChanged) await rescheduleConnections({ userId: ctx.userId, timeZone: preferences.timeZone });
  return preferences;
}

export function serveProfile(app: Hono<ApiEnv>, guard: Guard): readonly RouteContract[] {
  serve(app, guard, profile.getPreferences, ({ ctx }) => getPreferences(ctx));
  serve(app, guard, profile.updatePreferences, ({ ctx, body }) => savePreferences(ctx, body));
  serve(app, guard, profile.getProfile, ({ ctx }) => profileOf(ctx));
  serve(app, guard, profile.updateProfile, async ({ ctx, body }) => {
    try {
      await renameProfile(ctx, body.name);
      return await profileOf(ctx);
    } catch (error) {
      if (error instanceof ProfileError)
        throw new ApiRefusal(error.code === "sso" ? "conflict" : "invalid", error.code);
      throw error;
    }
  });
  return Object.values(profile);
}

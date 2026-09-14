import { authClient } from "@/platform/auth/client";
import { OIDC_PROVIDER_ID } from "@/platform/auth/provider";

/**
 * Sends the browser to Authentik's login page. Resolves to false when the flow could not start
 * (identity provider unavailable, network failure): the caller shows the Authentik error.
 */
export async function startAuthentikSignIn(callbackURL: string): Promise<boolean> {
  try {
    const { error } = await authClient.signIn.social({
      provider: OIDC_PROVIDER_ID,
      callbackURL,
      errorCallbackURL: "/sign-in?error=oidc",
    });
    return !error;
  } catch {
    return false;
  }
}

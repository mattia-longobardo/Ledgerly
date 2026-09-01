"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getToken } from "next-auth/jwt";
import { discoverOidc, sessionCookieName, signOut, useSecureCookies } from "@/auth";
import { env } from "@/lib/env";

async function endSessionUrl(idToken: string | undefined): Promise<string> {
  try {
    const { end_session_endpoint } = await discoverOidc();
    if (!end_session_endpoint) return "/signin";
    const url = new URL(end_session_endpoint);
    // Without id_token_hint Authentik keeps its own SSO session and silently
    // signs the user straight back in on the next request.
    if (idToken) url.searchParams.set("id_token_hint", idToken);
    url.searchParams.set("post_logout_redirect_uri", new URL("/signin", env().AUTH_URL).toString());
    return url.toString();
  } catch {
    return "/signin";
  }
}

export async function signOutAndEndSession(): Promise<void> {
  // The id_token lives only in the encrypted JWT cookie — it is deliberately not
  // exposed on the session object — so read it before the cookie is cleared.
  const requestHeaders = Object.fromEntries((await headers()).entries());
  const token = await getToken({
    req: { headers: requestHeaders },
    secret: env().AUTH_SECRET,
    cookieName: sessionCookieName(),
    secureCookie: useSecureCookies(),
  });
  const idToken = typeof token?.id_token === "string" ? token.id_token : undefined;

  await signOut({ redirect: false });

  redirect(await endSessionUrl(idToken));
}

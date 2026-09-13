import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { contentSecurityPolicy } from "@/platform/auth/csp";
import { identityProviderUrl } from "@/platform/auth/provider";

const PUBLIC_PREFIXES = ["/sign-in", "/forgot-password", "/reset-password", "/invite"];

/**
 * Convenience only — never the security boundary: every page and action calls
 * requireSession(). Sends anonymous visitors to /sign-in and sets the CSP.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const response =
    isPublic || getSessionCookie(request)
      ? NextResponse.next()
      : NextResponse.redirect(new URL("/sign-in", request.url));
  response.headers.set(
    "Content-Security-Policy",
    contentSecurityPolicy({
      authOrigin: identityProviderUrl()?.origin ?? null,
      dev: process.env.NODE_ENV !== "production",
    }),
  );
  return response;
}

export const config = {
  matcher: ["/((?!api/|_next/static/|_next/image|favicon\\.ico$|robots\\.txt$).*)"],
};

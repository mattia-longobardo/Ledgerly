import { NextResponse, type NextRequest } from "next/server";

/**
 * Deny-by-default gate. DEFENCE IN DEPTH ONLY: Next.js middleware has been
 * bypassable via a spoofed internal header (CVE-2025-29927), so nothing may
 * rely on it for authorization. The real gate is `requireUser()` inside every
 * route handler, page and server action.
 *
 * It deliberately does NOT use the Auth.js `auth()` wrapper: `src/auth.ts`
 * builds its config lazily (`NextAuth(() => buildConfig())`) so no secret is
 * read at build time, and in that form `auth()` is not a usable middleware
 * wrapper — it throws `TypeError: wb is not a function` on every request.
 * A cookie-presence check is all this layer is entitled to do anyway;
 * validating the JWT is `requireUser()`'s job.
 *
 * Kept as `middleware.ts`: `proxy.ts` is the Next 16 name, but under
 * `output: "standalone"` it fails at runtime with "The Proxy file must export
 * a function". Never have both files — that is a hard build error.
 */

// "/api/v1/" is listed here too: Hono's own auth middleware (see
// src/platform/http/app.ts) is the real gate for that tree, since it needs a
// session to build the OpenAPI document. This layer remains defence in depth
// for pages only.
const PUBLIC_PREFIXES = ["/api/health", "/api/auth/", "/api/jobs/", "/api/v1/"] as const;
const PUBLIC_PATHS = ["/api/health", "/signin"] as const;

function isPublic(pathname: string): boolean {
  if (PUBLIC_PATHS.some((p) => p === pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Matches by PREFIX, deliberately. Auth.js splits the session cookie into
 * `<name>.0`, `<name>.1`, ... once the JWT exceeds ~4 kB, which it does here
 * because the token carries the Authentik access, refresh and id tokens. An
 * exact-name lookup finds nothing in that case, so the gate bounces an already
 * authenticated user straight back to /signin — an endless login loop with no
 * error anywhere, since the callback itself succeeded.
 *
 * All prefixes are accepted rather than deriving one from AUTH_URL: this layer
 * only decides "is there plausibly a session", and `requireUser()` does the
 * real validation, so a false positive here costs nothing.
 */
const SESSION_COOKIE_PREFIXES = [
  "__Host-authjs.session-token",
  "__Secure-authjs.session-token",
  "authjs.session-token",
] as const;

function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((c) => SESSION_COOKIE_PREFIXES.some((p) => c.name === p || c.name.startsWith(`${p}.`)));
}

/**
 * CSP is emitted here rather than in next.config.ts because `form-action` must
 * name the Authentik origin, which is only known at runtime — a build-time
 * header would bake in the wrong value and silently break the OIDC redirect.
 */
/**
 * The payslip original is served same-origin and embedded in an <iframe> by the
 * review screen. `frame-ancestors 'none'` on *that* response makes the browser
 * refuse to render it, so the preview silently stays blank with no error
 * server-side. It still must not be embeddable by third parties, hence 'self'
 * rather than dropping the directive.
 *
 * The path moved with the route: `/api/paperless/preview/:id` became
 * `/api/v1/payroll/imports/:id/original`, which is scan-gated and audited.
 * Matching on the prefix rather than the whole path keeps it a prefix test, so
 * the trailing `/original` segment is covered without a regex.
 */
function frameAncestorsFor(pathname: string): string {
  return pathname.startsWith("/api/v1/payroll/imports/") ? "'self'" : "'none'";
}

function contentSecurityPolicy(pathname: string): string {
  let authOrigin = "";
  try {
    authOrigin = new URL(process.env.OIDC_ISSUER ?? "").origin;
  } catch {
    authOrigin = "";
  }
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    `frame-ancestors ${frameAncestorsFor(pathname)}`,
    "base-uri 'self'",
    `form-action 'self'${authOrigin ? ` ${authOrigin}` : ""}`,
  ].join("; ");
}

function withCsp(res: NextResponse, pathname: string): NextResponse {
  res.headers.set("Content-Security-Policy", contentSecurityPolicy(pathname));
  return res;
}

export default function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isPublic(pathname)) return withCsp(NextResponse.next(), pathname);

  if (hasSessionCookie(request)) return withCsp(NextResponse.next(), pathname);

  if (pathname.startsWith("/api/")) {
    return withCsp(NextResponse.json({ error: "unauthorized" }, { status: 401 }), pathname);
  }

  const url = request.nextUrl.clone();
  url.pathname = "/signin";
  url.search = "";
  url.searchParams.set("callbackUrl", `${pathname}${search}`);
  return withCsp(NextResponse.redirect(url), pathname);
}

// `brand/` is excluded for the same reason as the icon paths: the favicon and
// manifest icons are fetched by the browser with no session, so gating them
// 307s the tab icon to /signin and it silently never renders. They are public
// brand assets and carry nothing sensitive.
//
// `output: standalone` does not ship a working edge bundle for middleware:
// without this the file compiles to .next/server/edge/, is absent from the
// image, and every request logs "must export a function". Node runtime also
// matches the rest of the app.
export const runtime = "nodejs";

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|manifest.webmanifest|brand/|icons/|apple-icon|icon).*)",
  ],
};

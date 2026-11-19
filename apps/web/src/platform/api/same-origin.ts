/**
 * Whether a call that presents the web's session comes from the app's own origin (§6 #4). A
 * browser names a cross-origin caller in `Sec-Fetch-Site` and in `Origin`; a write must name its
 * origin, a read may omit it (a same-origin `GET` carries no `Origin`). Pure: the guard decides.
 */
export function fromAppOrigin(headers: Headers, method: string, appOrigin: string): boolean {
  const site = headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return false;
  const origin = headers.get("origin");
  if (origin !== null) return origin === appOrigin;
  return method === "GET" || method === "HEAD";
}

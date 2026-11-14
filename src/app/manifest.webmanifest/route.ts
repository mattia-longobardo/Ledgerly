import type { MetadataRoute } from "next";
import icon192 from "./app-192.png";
import icon512 from "./app-512.png";
import maskable512 from "./app-maskable-512.png";

export const dynamic = "force-static";

/**
 * The web manifest: what lets a browser offer "Install" and open Ledgerly in its own window, with
 * its own icon, on Android and Windows (rewrite plan, release N0).
 *
 * A route of its own and not the `manifest.ts` file convention, on purpose. The convention adds
 * `<link rel="manifest">` to every page, and a browser fetches a manifest **without** cookies: the
 * session guard (`src/proxy.ts`) would answer with the sign-in page. The signed-in shell adds the
 * link itself, with `crossorigin="use-credentials"` (`src/app/(app)/layout.tsx`), so the manifest
 * stays behind the session and no page outside it asks for one.
 *
 * The icons are imported, so they are served from `/_next/static/media/`, which the guard does not
 * cover: an installer fetches them on its own, without the session. `scripts/icons.mjs` renders
 * them from `src/app/icon.svg`. The colours are the light theme's `--bg` and the icon's plate.
 */
export function GET(): Response {
  const manifest: MetadataRoute.Manifest = {
    name: "Ledgerly",
    short_name: "Ledgerly",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f7f7f8",
    theme_color: "#15181d",
    icons: [
      { src: icon192.src, sizes: "192x192", type: "image/png", purpose: "any" },
      { src: icon512.src, sizes: "512x512", type: "image/png", purpose: "any" },
      { src: maskable512.src, sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
  return Response.json(manifest, { headers: { "content-type": "application/manifest+json" } });
}

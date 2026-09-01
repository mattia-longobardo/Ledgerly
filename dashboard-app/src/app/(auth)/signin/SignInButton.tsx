"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

/**
 * Client-side `signIn` on purpose. The previous implementation was an inline
 * server action with a closure over `callbackUrl`, which Next compiles to a
 * *bound* action whose id and encrypted arguments are regenerated on every
 * build: any page a browser had already loaded then failed with
 * "Failed to find Server Action" after a redeploy, and the login button did
 * nothing. The client helper posts to `/api/auth/signin/<provider>` with the
 * CSRF token instead, which is stable across deployments.
 */
export function SignInButton({ provider, callbackUrl }: { provider: string; callbackUrl: string }) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void signIn(provider, { callbackUrl });
      }}
      className="mt-6 w-full rounded-sm bg-accent px-4 py-3 text-body-sm font-medium text-accent-contrast disabled:opacity-60"
    >
      {busy ? "Signing in…" : "Sign in with Authentik"}
    </button>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/platform/auth/client";

/** Ends the session and goes to sign-in: the sidebar and the mobile More sheet both use it. */
export function useSignOut(): () => Promise<void> {
  const router = useRouter();
  return async () => {
    await authClient.signOut();
    router.push("/sign-in");
  };
}

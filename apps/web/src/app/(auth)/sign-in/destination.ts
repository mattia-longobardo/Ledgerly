import type { useRouter } from "next/navigation";

/**
 * After a sign-in: the app through the client router, or the OAuth authorize endpoint through a
 * full navigation — it is a route handler that answers with a redirect to the client, which the
 * client router cannot follow.
 */
export function goTo(router: ReturnType<typeof useRouter>, next: string): void {
  if (next === "/") {
    router.push("/");
    router.refresh();
    return;
  }
  window.location.assign(next);
}

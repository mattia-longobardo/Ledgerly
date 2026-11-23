"use client";

// Next's router behind `packages/ui`'s routing adapter (`@ledgerly/ui/router`): the one place where a
// shared component's link or navigation becomes Next's. Mounted once, in the root layout.
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useMemo } from "react";
import { appRoute, isAppAddress } from "./route";
import { type AppRouter, type LinkProps, type RouterAdapter, RouterProvider } from "@ledgerly/ui/router";

/** A link of the app goes through Next; an absolute URL stays a plain anchor, as `next/link` drew it. */
function Link({ href, prefetch, ...props }: LinkProps) {
  return isAppAddress(href) ? (
    <NextLink href={href} prefetch={prefetch} {...props} />
  ) : (
    <a href={href} {...props} />
  );
}

/** The same object while Next's router stays the same: a shell's context holds what it builds. */
function useAppRouter(): AppRouter {
  const router = useRouter();
  return useMemo(
    () => ({
      push: (href) => router.push(appRoute(href)),
      replace: (href) => router.replace(appRoute(href)),
      refresh: () => router.refresh(),
    }),
    [router],
  );
}

const NEXT_ROUTER: RouterAdapter = { Link, useRouter: useAppRouter, usePathname };

export function NextRouter({ children }: { children: ReactNode }) {
  return <RouterProvider adapter={NEXT_ROUTER}>{children}</RouterProvider>;
}

/** A link that loads its page on the click only. */
function LinkOnClick(props: LinkProps) {
  return <Link {...props} prefetch={false} />;
}

const ON_CLICK_ROUTER: RouterAdapter = { ...NEXT_ROUTER, Link: LinkOnClick };

/**
 * The links of a part of the app whose every render reads `/api/v1` on the server (an account's pages
 * of Investments): no prefetch of each tab and each period, each of which would be such a render.
 */
export function OnClickRouter({ children }: { children: ReactNode }) {
  return <RouterProvider adapter={ON_CLICK_ROUTER}>{children}</RouterProvider>;
}

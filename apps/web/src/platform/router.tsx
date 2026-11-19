"use client";

// Next's router behind `packages/ui`'s routing adapter (`@ledgerly/ui/router`): the one place where a
// shared component's link or navigation becomes Next's. Mounted once, in the root layout.
import type { Route } from "next";
import NextLink from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { type AppRouter, type LinkProps, type RouterAdapter, RouterProvider } from "@ledgerly/ui/router";

/** An address of the app: what Next's typed routes accept, checked at the one place it is needed. */
const isAppAddress = (href: string): href is Route => href.startsWith("/");

function appAddress(href: string): Route {
  if (!isAppAddress(href)) throw new Error(`not an address of the app: ${href}`);
  return href;
}

/** A link of the app goes through Next; an absolute URL stays a plain anchor, as `next/link` drew it. */
function Link({ href, ...props }: LinkProps) {
  return isAppAddress(href) ? <NextLink href={href} {...props} /> : <a href={href} {...props} />;
}

function useAppRouter(): AppRouter {
  const router = useRouter();
  return {
    push: (href) => router.push(appAddress(href)),
    replace: (href) => router.replace(appAddress(href)),
    refresh: () => router.refresh(),
  };
}

const NEXT_ROUTER: RouterAdapter = { Link, useRouter: useAppRouter, usePathname };

export function NextRouter({ children }: { children: ReactNode }) {
  return <RouterProvider adapter={NEXT_ROUTER}>{children}</RouterProvider>;
}

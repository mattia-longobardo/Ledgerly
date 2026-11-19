"use client";

// The routing adapter (rewrite plan R3, audit UI-DS-20): `packages/ui` names no router. A container
// gives its own through `<RouterProvider>` (the web app gives Next's, `apps/web/src/platform/router.tsx`);
// without one, a link is a plain `<a>` and a navigation loads the page, which is what a static
// package needs.
import {
  type AnchorHTMLAttributes,
  type ComponentType,
  createContext,
  type ReactNode,
  type Ref,
  useContext,
} from "react";

export interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  /** An address of the app (`/settings/profile?tab=x`), or an absolute URL. */
  href: string;
  ref?: Ref<HTMLAnchorElement>;
}

/** What a screen asks of the router. */
export interface AppRouter {
  push: (href: string) => void;
  replace: (href: string) => void;
  /** Reads the screen's data again. */
  refresh: () => void;
}

export interface RouterAdapter {
  Link: ComponentType<LinkProps>;
  useRouter: () => AppRouter;
  usePathname: () => string;
}

function PlainLink(props: LinkProps) {
  return <a {...props} />;
}

const PLAIN_ROUTER: AppRouter = {
  push: (href) => window.location.assign(href),
  replace: (href) => window.location.replace(href),
  refresh: () => window.location.reload(),
};

const PLAIN: RouterAdapter = {
  Link: PlainLink,
  useRouter: () => PLAIN_ROUTER,
  usePathname: () => (typeof window === "undefined" ? "/" : window.location.pathname),
};

const RouterContext = createContext<RouterAdapter>(PLAIN);

export function RouterProvider({ adapter, children }: { adapter: RouterAdapter; children: ReactNode }) {
  return <RouterContext.Provider value={adapter}>{children}</RouterContext.Provider>;
}

export function Link(props: LinkProps) {
  const { Link: Implementation } = useContext(RouterContext);
  return <Implementation {...props} />;
}

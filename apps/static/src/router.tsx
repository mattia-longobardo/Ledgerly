// The router the static package injects (`@ledgerly/ui/router`): the browser's history, no server. A
// link of the app changes the address and the screen without loading the page; reading the data
// again loads it, which also applies a language or a theme the person just saved.
import { type MouseEvent, type ReactNode, useSyncExternalStore } from "react";
import { type AppRouter, type LinkProps, type RouterAdapter, RouterProvider } from "@ledgerly/ui/router";

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

function navigate(href: string, replace = false) {
  if (replace) window.history.replaceState(null, "", href);
  else window.history.pushState(null, "", href);
  for (const listener of listeners) listener();
}

const ROUTER: AppRouter = {
  push: (href) => navigate(href),
  replace: (href) => navigate(href, true),
  refresh: () => window.location.reload(),
};

/** The open address, path and query: a screen draws again when it changes. */
export function useLocation(): string {
  return useSyncExternalStore(subscribe, () => window.location.pathname + window.location.search);
}

const isPlainClick = (event: MouseEvent) =>
  event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

function Link({ href, onClick, ...props }: LinkProps) {
  return (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented || !href.startsWith("/") || !isPlainClick(event)) return;
        event.preventDefault();
        navigate(href);
      }}
    />
  );
}

const ADAPTER: RouterAdapter = {
  Link,
  useRouter: () => ROUTER,
  usePathname: () => useLocation().split("?")[0],
};

export function HistoryRouter({ children }: { children: ReactNode }) {
  return <RouterProvider adapter={ADAPTER}>{children}</RouterProvider>;
}

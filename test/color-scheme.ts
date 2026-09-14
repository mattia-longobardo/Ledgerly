// A stand-in for `matchMedia("(prefers-color-scheme: dark)")`, which jsdom does not implement.
import { vi } from "vitest";

export function stubColorScheme(initiallyDark: boolean): { setDark: (dark: boolean) => void } {
  let dark = initiallyDark;
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return dark;
    },
    addEventListener: (_type: "change", listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: "change", listener: () => void) => listeners.delete(listener),
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    setDark(next) {
      dark = next;
      for (const listener of listeners) listener();
    },
  };
}

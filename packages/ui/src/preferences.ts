// What a device keeps of a person's choices between visits (audit UI-NAV-5): the theme, the language
// and the sidebar. Screens read and write them only through a `PreferencesStore`; a container without
// a browser (a native app) can hand its own.

export type PreferenceKey = "theme" | "locale" | "sidebar";

interface PreferencesStore {
  read: (key: PreferenceKey) => string | null;
  write: (key: PreferenceKey, value: string) => void;
}

const YEAR = 60 * 60 * 24 * 365;

/**
 * The browser's store: `localStorage`, mirrored in a cookie of the same name so that a server render
 * (the web app) draws the first paint with the same choice and nothing flashes.
 */
export const browserPreferences: PreferencesStore = {
  read: (key) => {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  write: (key, value) => {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Storage refused (private mode, quota): the cookie still carries the choice.
    }
    document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=${YEAR}; samesite=lax`;
  },
};

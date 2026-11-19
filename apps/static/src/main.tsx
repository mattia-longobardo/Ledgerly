// The static package's start (audit UI-AUT-2): the language and the theme come from the device's store
// before the first render, so the first paint is already the person's; then the screens read
// `/api/v1`.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { IntlProvider } from "use-intl";
import { browserPreferences } from "@ledgerly/ui/preferences";
import { PREFERS_DARK_QUERY, resolveTheme, type ThemePreference } from "@ledgerly/ui/theme";
import { ThemeProvider } from "@ledgerly/ui/theme-provider";
import { App } from "./app";
import { HistoryRouter } from "./router";
import "./styles.css";

const CATALOGUES = {
  en: () => import("../../../messages/en.json"),
  it: () => import("../../../messages/it.json"),
};

const THEMES: readonly ThemePreference[] = ["system", "light", "dark"];

function savedTheme(): ThemePreference {
  const saved = browserPreferences.read("theme");
  return THEMES.find((theme) => theme === saved) ?? "system";
}

const locale = browserPreferences.read("locale") === "it" ? "it" : "en";
const theme = savedTheme();
document.documentElement.lang = locale;
document.documentElement.dataset.themePref = theme;
document.documentElement.dataset.theme = resolveTheme(theme, matchMedia(PREFERS_DARK_QUERY).matches);

const messages = (await CATALOGUES[locale]()).default;
const root = document.getElementById("root");
if (!root) throw new Error("the page has no #root");

createRoot(root).render(
  <StrictMode>
    <IntlProvider
      locale={locale}
      messages={messages}
      timeZone={Intl.DateTimeFormat().resolvedOptions().timeZone}
    >
      <HistoryRouter>
        <ThemeProvider saved={theme}>
          <App />
        </ThemeProvider>
      </HistoryRouter>
    </IntlProvider>
  </StrictMode>,
);

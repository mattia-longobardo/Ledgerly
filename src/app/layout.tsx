import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";
import { getOptionalPreferences } from "@/platform/auth/session";
import { requestThemePreference, THEME_COOKIE, THEME_SCRIPT } from "@/platform/theme";
import { ThemeProvider } from "@/ui/theme-provider";
import "./globals.css";

// Inter, self-hosted (spec §8.1): the variable-weight latin and latin-ext files shipped by
// @fontsource-variable/inter, by path relative to this file.
const inter = localFont({
  src: [
    {
      path: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
      weight: "100 900",
      style: "normal",
    },
    {
      path: "../../node_modules/@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2",
      weight: "100 900",
      style: "normal",
    },
  ],
  variable: "--font-inter",
  display: "swap",
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("common");
  return { title: t("product") };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();
  const theme = requestThemePreference(
    (await getOptionalPreferences())?.theme ?? null,
    (await cookies()).get(THEME_COOKIE)?.value,
  );
  // React renders only the preference; THEME_SCRIPT and then ThemeProvider own `data-theme`, which
  // is why <html> suppresses the hydration warning for the attribute the script adds.
  return (
    <html lang={locale} data-theme-pref={theme} className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <NextIntlClientProvider>
          <ThemeProvider saved={theme}>
            <div className="root">{children}</div>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}

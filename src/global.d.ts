import type en from "../messages/en.json";
import type { LOCALES } from "@/platform/i18n/locales";

declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof LOCALES)[number];
    Messages: typeof en;
  }
}

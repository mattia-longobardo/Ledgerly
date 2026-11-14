import type { Metadata, Route } from "next";
import Link from "next/link";
import { createTranslator } from "next-intl";
import { getLocale } from "next-intl/server";
import { LOCALES } from "@/platform/i18n/locales";
import { readEnv } from "@/platform/env";
import { BrandLockup } from "@/ui/shell/brand";
import { type LegalLocale, legalLocale } from "./language";

export type LegalDocument = "privacy" | "terms";

/** The sections of each document, in reading order: `legal.<document>.<section>.{title,body}`. */
const SECTIONS = {
  privacy: ["host", "data", "where", "external", "sharing", "rights"],
  terms: ["service", "advice", "responsibility", "readOnly"],
} as const;

const LINK = "inline-flex min-h-6 items-center underline underline-offset-2 hover:text-fg";

async function translator(locale: LegalLocale) {
  // The catalogue of the page's own language, not of the request: `?lang=` can ask for the other.
  const messages = (await import(`../../../messages/${locale}.json`)).default;
  return createTranslator({ locale, messages });
}

type LegalProps = { searchParams: Promise<{ lang?: string | string[] }> };

/** What a document's `page.tsx` exports: the two documents differ in their name only. */
export function legalRoute(document: LegalDocument) {
  return {
    async generateMetadata({ searchParams }: LegalProps): Promise<Metadata> {
      const t = await translator(legalLocale((await searchParams).lang, await getLocale()));
      return { title: t(`legal.${document}.title`) };
    },
    async Page({ searchParams }: LegalProps) {
      return <LegalPage document={document} lang={(await searchParams).lang} />;
    },
  };
}

/**
 * A public document of the instance. The text names no person and no address: who runs the
 * instance is its host, and the one thing only the host knows — how to reach them — comes from
 * `INSTANCE_CONTACT`.
 */
async function LegalPage({
  document,
  lang,
}: {
  document: LegalDocument;
  lang: string | string[] | undefined;
}) {
  const locale = legalLocale(lang, await getLocale());
  const t = await translator(locale);
  const contact = readEnv().INSTANCE_CONTACT;
  const other: LegalDocument = document === "privacy" ? "terms" : "privacy";
  return (
    <article
      lang={locale}
      className="flex w-full max-w-[640px] animate-in flex-col gap-5 rounded-modal border border-border bg-card p-8"
    >
      <BrandLockup name={t("common.product")} />
      <div>
        <h1 className="text-title leading-[1.2] font-semibold tracking-[-0.02em]">
          {t(`legal.${document}.title`)}
        </h1>
        <p className="mt-1.5 text-muted">{t(`legal.${document}.intro`)}</p>
      </div>
      {SECTIONS[document].map((section) => (
        <section key={section} className="flex flex-col gap-1.5">
          <h2 className="text-lg font-semibold">{t(`legal.${document}.${section}.title`)}</h2>
          <p className="break-words text-muted">{t(`legal.${document}.${section}.body`)}</p>
        </section>
      ))}
      <section className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold">{t("legal.contact.title")}</h2>
        <p className="break-words text-muted">
          {contact ? t("legal.contact.set", { contact }) : t("legal.contact.unset")}
        </p>
      </section>
      <nav
        aria-label={t("legal.nav")}
        className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm text-faint"
      >
        <span className="flex flex-wrap gap-x-4">
          <Link className={LINK} href={`/${other}?lang=${locale}` as Route}>
            {t(`legal.${other}.title`)}
          </Link>
          <Link className={LINK} href="/sign-in">
            {t("legal.signIn")}
          </Link>
        </span>
        <span className="flex flex-wrap gap-x-4">
          {LOCALES.filter((candidate) => candidate !== locale).map((candidate) => (
            <Link
              key={candidate}
              className={LINK}
              href={`/${document}?lang=${candidate}` as Route}
              hrefLang={candidate}
              lang={candidate}
            >
              {t(`legal.language.${candidate}`)}
            </Link>
          ))}
        </span>
      </nav>
    </article>
  );
}

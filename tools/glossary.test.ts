// The single glossary of the interface (rewrite plan R5a; audit OP-1, OP-2; rule Q4): one word per
// idea in each language, and none of the words it replaced. This file is where the glossary is
// declared; the catalogue is held to it.
import { describe, expect, it } from "vitest";
import en from "../messages/en.json";
import itMessages from "../messages/it.json";

interface Term {
  /** The word of the interface, in each language. */
  words: { en: string; it: string };
  /** The words the glossary replaced: none of them is left in the catalogue. */
  replaced: { en: RegExp | null; it: RegExp | null };
}

const GLOSSARY: Record<string, Term> = {
  movement: {
    words: { en: "transaction", it: "movimento" },
    replaced: { en: /\bmovements?\b/i, it: /\btransazion[ei]\b/i },
  },
  connection: {
    words: { en: "connection", it: "collegamento" },
    replaced: { en: /\bintegrations?\b/i, it: /\b(connession[ei]|integrazion[ei])\b/i },
  },
  source: {
    words: { en: "source", it: "sorgente" },
    replaced: { en: /\bproviders?\b/i, it: /\b(provider|fornitor[ei])\b/i },
  },
  iban: { words: { en: "IBAN", it: "IBAN" }, replaced: { en: /\b(iban|Iban)\b/, it: /\b(iban|Iban)\b/ } },
  transfer: {
    words: { en: "transfer", it: "giroconto" },
    replaced: { en: null, it: /\btrasferiment[oi]\b/i },
  },
};

/** Texts where one of the replaced words names another idea, or a name that is not Ledgerly's. */
const OTHER_IDEAS: readonly string[] = [
  "settings.oidc.", // the identity provider of the single sign-on
  "funds.home.kpis.market", // a movement of the market, not a transaction
  "funds.pension.classes.transfer_in", // a position moved in from another pension fund
  "funds.settings.general.provider", // the provider of a pension fund: who runs it
  "funds.settings.general.description",
  "funds.wizard.fund.provider",
  "legal.", // the legal pages keep their own wording
  "investments.providers.", // Binance's own names of its permissions
  "settings.integrations.trek.connectDescription", // Trek's own menu
  "expenses.wallet.errors.noTransferCategory", // Wallet's own category
  "settings.connections.codes.network", // the network connection
  "banks.connect.errors.network",
  "settings.llm.test.action",
  "settings.oidc.test.action",
];

type Catalogue = { [key: string]: string | Catalogue };

function texts(catalogue: Catalogue, prefix = ""): [string, string][] {
  return Object.entries(catalogue).flatMap(([key, value]) =>
    typeof value === "string" ? [[`${prefix}${key}`, value]] : texts(value, `${prefix}${key}.`),
  );
}

/** The words the person reads: the names of the placeholders (`{provider}`) are not. */
const read = (text: string) => text.replace(/\{\w+/g, "{");

describe("the glossary", () => {
  for (const [lang, catalogue] of [
    ["en", en],
    ["it", itMessages],
  ] as const) {
    it(`leaves no replaced word in the ${lang} catalogue`, () => {
      const found = texts(catalogue)
        .filter(([key]) => !OTHER_IDEAS.some((other) => key.startsWith(other)))
        .flatMap(([key, text]) =>
          Object.entries(GLOSSARY).flatMap(([idea, term]) => {
            const replaced = term.replaced[lang];
            return replaced !== null && replaced.test(read(text)) ? [`${key}: ${idea}`] : [];
          }),
        );
      expect(found).toEqual([]);
    });

    it(`uses each word of the glossary in the ${lang} catalogue`, () => {
      const all = texts(catalogue)
        .map(([, text]) => read(text).toLowerCase())
        .join("\n");
      for (const term of Object.values(GLOSSARY)) expect(all).toContain(term.words[lang].toLowerCase());
    });
  }
});

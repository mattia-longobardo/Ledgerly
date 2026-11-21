"use client";

import { useTranslations } from "next-intl";

/** The products the catalogue names: an exchange's (spot … custody) and a broker's (trading … copy). */
const NAMED = ["spot", "funding", "earn", "staking", "custody", "trading", "cash", "crypto", "copy"] as const;

/**
 * A product's name for the person (§1.4): the known ones translated, `other:<label>` as its label.
 */
export function useProductLabel(): (product: string) => string {
  const text = useTranslations("investments");
  return (product) => {
    const named = NAMED.find((one) => one === product);
    return named ? text(`products.${named}`) : product.replace(/^other:/, "");
  };
}

import { permanentRedirect } from "next/navigation";

/**
 * The catalog's old address (rewrite plan R5b, decision B1c): «Add investment» on the home took its
 * place, so the address leads there and never answers 404.
 */
export default function InvestmentsCatalogPage(): never {
  permanentRedirect("/investments");
}

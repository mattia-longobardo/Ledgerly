import { BROKER_PRODUCTS, PRODUCTS } from "../rules";

/**
 * A product's name for the person (§1.4): the known ones translated, `other:<label>` as its label.
 * Plain, not a client module: the server pages call it too.
 */
export function productLabel(product: string, t: (key: "products.spot") => string): string {
  return ([...PRODUCTS, ...BROKER_PRODUCTS] as readonly string[]).includes(product)
    ? t(`products.${product}` as "products.spot")
    : product.replace(/^other:/, "");
}

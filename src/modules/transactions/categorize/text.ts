/**
 * The text of a movement as the automatic categories read it (rewrite plan, 04-now.md §4.4):
 * the key of the memory and of "similar movements", and the features of the classifier. Pure, and
 * the one place that normalises: training and inference call the same functions, so a model never
 * meets a text shaped differently from the ones it learnt.
 */

/** What of a movement the categories look at. Everything but the sign and the size is optional. */
export interface MovementText {
  payee: string | null;
  counterparty: string | null;
  rawText: string | null;
  note: string | null;
  accountId: string;
  amountCents: bigint;
}

const DIACRITICS = /[̀-ͯ]/g;

/** Lower case, no accents, every run of anything that is not a letter or a digit one space. */
export function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(DIACRITICS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The words a person reads a movement by: the payee, or what the bank wrote when there is none. */
export function shownText(
  movement: Pick<MovementText, "payee" | "counterparty" | "rawText" | "note">,
): string {
  for (const candidate of [movement.payee, movement.counterparty, movement.rawText, movement.note]) {
    const trimmed = candidate?.trim() ?? "";
    if (trimmed !== "") return trimmed;
  }
  return "";
}

/**
 * The key two movements share when they are "similar": the shown text, normalised, without the
 * digits — a card number, a date or a receipt number never makes two payments to one shop
 * different. Empty for a movement with no text: such a movement is similar to nothing.
 */
export function memoryKey(
  movement: Pick<MovementText, "payee" | "counterparty" | "rawText" | "note">,
): string {
  return normalise(shownText(movement))
    .replace(/[0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The size of an amount as a band: a coffee and a rent are different things at the same shop. */
const AMOUNT_BANDS = [500n, 1_500n, 5_000n, 15_000n, 50_000n, 150_000n] as const;

export function amountBand(amountCents: bigint): number {
  const size = amountCents < 0n ? -amountCents : amountCents;
  const index = AMOUNT_BANDS.findIndex((limit) => size < limit);
  return index === -1 ? AMOUNT_BANDS.length : index;
}

const MIN_GRAM = 3;
const MAX_GRAM = 5;
/** Longer than any text a bank writes about one movement: a bound, so one row cannot cost seconds. */
const MAX_TEXT = 400;

/**
 * The features of a movement, as names: character n-grams of 3 to 5 of every text the movement
 * has, its words, its account, its sign and the band of its amount. Names, not numbers: the
 * classifier turns them into positions (`featureIndex`), and a test can read them.
 */
export function featuresOf(movement: MovementText): string[] {
  const texts = [movement.payee, movement.counterparty, movement.rawText, movement.note]
    .map((text) =>
      normalise(text ?? "")
        .replace(/[0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((text) => text !== "");
  const text = [...new Set(texts)].join(" ").slice(0, MAX_TEXT);
  const features: string[] = [];
  if (text !== "") {
    const padded = ` ${text} `;
    for (let size = MIN_GRAM; size <= MAX_GRAM; size += 1) {
      for (let start = 0; start + size <= padded.length; start += 1) {
        features.push(`g:${padded.slice(start, start + size)}`);
      }
    }
    for (const word of text.split(" ")) if (word.length > 1) features.push(`w:${word}`);
  }
  features.push(`acc:${movement.accountId}`);
  features.push(movement.amountCents < 0n ? "sign:out" : "sign:in");
  features.push(`amt:${amountBand(movement.amountCents)}`);
  return features;
}

/** How many positions the features are folded into: memory is bounded whatever the texts are. */
export const FEATURE_DIMENSIONS = 1 << 14;

/** The position of a feature: FNV-1a over its name, the same in every process and every release. */
export function featureIndex(name: string): number {
  let hash = 0x811c9dc5;
  for (let at = 0; at < name.length; at += 1) {
    hash ^= name.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % FEATURE_DIMENSIONS;
}

/** A movement as sparse counts: position → how many of its features fall there. */
export function featureCounts(movement: MovementText): Map<number, number> {
  const counts = new Map<number, number>();
  for (const name of featuresOf(movement)) {
    const index = featureIndex(name);
    counts.set(index, (counts.get(index) ?? 0) + 1);
  }
  return counts;
}

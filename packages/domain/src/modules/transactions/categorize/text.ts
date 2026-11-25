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

/**
 * The words a bank writes around the merchant in the text of a payment (PERS-630: a median of 15
 * words, most of them these): never what tells two shops apart. Generic words only, no shop.
 */
const BANK_WORDS = new Set(
  (
    "pagamento pagam pos carta card pfm mcc cod codice tramite presso effettuato mediante transazione " +
    "abi pan ind ser alle ore il la lo le di del della dal da al su per con in e ed n nr num " +
    "addebito diretto sdd bonifico sepa sct rif id favore ordinante beneficiario causale " +
    "operazione acquisto payment purchase debit contactless online web eur euro"
  ).split(" "),
);
/** How many words of the merchant the memory keeps: the name, not the town after it. */
const MERCHANT_WORDS = 2;

/**
 * The key of the strict memory (PERS-634): the merchant, not the whole text. The first words of
 * {@link memoryKey} that are not the bank's own (`BANK_WORDS`), a letter alone or a masked card
 * number: two payments at one shop share it, whatever the bank wrote around them. A text with none
 * of these keeps its whole key.
 */
export function merchantKey(
  movement: Pick<MovementText, "payee" | "counterparty" | "rawText" | "note">,
): string {
  const whole = memoryKey(movement);
  const words = whole
    .split(" ")
    .filter((word) => word.length > 1 && !BANK_WORDS.has(word) && !/^x+$/.test(word))
    .slice(0, MERCHANT_WORDS);
  return words.length === 0 ? whole : words.join(" ");
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
/**
 * Every text of a movement, normalised, without digits, each once, in one line: what the features
 * and the embedding model read (a card number or a receipt number says nothing of what was bought).
 */
export function wordsOf(movement: Pick<MovementText, "payee" | "counterparty" | "rawText" | "note">): string {
  const texts = [movement.payee, movement.counterparty, movement.rawText, movement.note]
    .map((text) =>
      normalise(text ?? "")
        .replace(/[0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((text) => text !== "");
  return [...new Set(texts)].join(" ").slice(0, MAX_TEXT);
}

export function featuresOf(movement: MovementText): string[] {
  const text = wordsOf(movement);
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

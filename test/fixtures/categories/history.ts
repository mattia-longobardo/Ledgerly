// test/fixtures/categories/history.ts — an invented history of movements with their categories,
// for the automatic categories (rewrite plan N3). Nothing here is anybody's: the shops, the texts
// and the amounts are made up by this file, the same way at every run.
//
// It is shaped like a real history where it matters to a classifier: a shop is written in several
// ways, with a city, a terminal number or a date in the text; most shops belong to one category,
// a few to two; a few labels are wrong; and new shops keep appearing, so the last months hold
// texts the first months never saw.
import type { Example } from "@/modules/transactions/categorize/classifier";

interface Shop {
  name: string;
  /** The category, or two with the share of the first one. */
  categories: [string] | [string, string, number];
  /** Typical amount in cents, and how much it moves around. */
  amount: number;
  spread: number;
  /** How many times a month, on average. */
  perMonth: number;
  /** The first month (0-based) the shop appears in. */
  from?: number;
}

const SHOPS: Shop[] = [
  { name: "Mercato Alfa", categories: ["groceries"], amount: 5200, spread: 0.6, perMonth: 6 },
  { name: "Superstore Beta", categories: ["groceries"], amount: 8300, spread: 0.5, perMonth: 4 },
  { name: "Alimentari Gamma", categories: ["groceries"], amount: 1900, spread: 0.7, perMonth: 3 },
  { name: "Bottega Delta Bio", categories: ["groceries"], amount: 2700, spread: 0.5, perMonth: 2, from: 9 },
  { name: "Bar Epsilon", categories: ["restaurants"], amount: 450, spread: 0.6, perMonth: 8 },
  { name: "Trattoria Zeta", categories: ["restaurants"], amount: 3800, spread: 0.4, perMonth: 2 },
  { name: "Pizzeria Eta", categories: ["restaurants"], amount: 2400, spread: 0.4, perMonth: 2 },
  {
    name: "Consegne Theta",
    categories: ["restaurants", "groceries", 0.8],
    amount: 2100,
    spread: 0.5,
    perMonth: 3,
  },
  { name: "Ferrovie Iota", categories: ["transport"], amount: 2900, spread: 0.8, perMonth: 3 },
  { name: "Carburanti Kappa", categories: ["transport"], amount: 6100, spread: 0.3, perMonth: 2 },
  { name: "Metro Lambda", categories: ["transport"], amount: 220, spread: 0.1, perMonth: 9 },
  { name: "Pedaggi My", categories: ["transport"], amount: 1400, spread: 0.9, perMonth: 2 },
  { name: "Farmacia Ny", categories: ["health"], amount: 1800, spread: 0.8, perMonth: 2 },
  { name: "Studio Medico Xi", categories: ["health"], amount: 9000, spread: 0.3, perMonth: 0.5 },
  { name: "Energia Omicron", categories: ["home"], amount: 7800, spread: 0.3, perMonth: 1 },
  { name: "Condominio Pi", categories: ["home"], amount: 12000, spread: 0.05, perMonth: 1 },
  { name: "Ferramenta Rho", categories: ["home"], amount: 2600, spread: 0.9, perMonth: 0.7 },
  { name: "Telefonia Sigma", categories: ["subscriptions"], amount: 999, spread: 0, perMonth: 1 },
  { name: "Video Tau", categories: ["subscriptions"], amount: 1299, spread: 0, perMonth: 1 },
  { name: "Musica Ypsilon", categories: ["subscriptions"], amount: 1099, spread: 0, perMonth: 1, from: 6 },
  { name: "Emporio Phi", categories: ["shopping", "home", 0.6], amount: 4500, spread: 1.1, perMonth: 3 },
  { name: "Moda Chi", categories: ["shopping"], amount: 5900, spread: 0.6, perMonth: 1 },
  { name: "Elettronica Psi", categories: ["shopping"], amount: 14900, spread: 0.9, perMonth: 0.4 },
  { name: "Cinema Omega", categories: ["leisure"], amount: 950, spread: 0.2, perMonth: 1 },
  { name: "Palestra Aleph", categories: ["leisure"], amount: 3900, spread: 0, perMonth: 1 },
  { name: "Libreria Bet", categories: ["leisure"], amount: 2200, spread: 0.6, perMonth: 0.8 },
  { name: "Voli Gimel", categories: ["travel"], amount: 12000, spread: 0.7, perMonth: 0.4 },
  { name: "Albergo Dalet", categories: ["travel"], amount: 18000, spread: 0.6, perMonth: 0.3 },
  { name: "Tributi He", categories: ["taxes_fees"], amount: 20000, spread: 0.8, perMonth: 0.4 },
  { name: "Datore Vav Srl", categories: ["income"], amount: -210000, spread: 0.02, perMonth: 1 },
  { name: "Rimborsi Zayin", categories: ["income"], amount: -4000, spread: 0.9, perMonth: 0.3 },
  { name: "Osteria Het", categories: ["restaurants"], amount: 3300, spread: 0.4, perMonth: 2, from: 13 },
  { name: "Mercato Tet", categories: ["groceries"], amount: 4100, spread: 0.6, perMonth: 4, from: 14 },
  { name: "Giochi Yod", categories: ["leisure"], amount: 2900, spread: 0.7, perMonth: 1, from: 15 },
];

const CITIES = ["MILANO", "ROMA", "TORINO", "BOLOGNA"];
/** The share of labels a person gets wrong, or files somewhere odd on purpose. */
const WRONG_LABELS = 0.02;
const ALL_CATEGORIES: string[] = [
  ...new Set(
    SHOPS.flatMap((shop): string[] =>
      shop.categories.length === 1 ? [shop.categories[0]] : [shop.categories[0], shop.categories[1]],
    ),
  ),
];

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The ways one shop is written on a statement. */
function textOf(shop: Shop, next: () => number): { payee: string; rawText: string } {
  const digits = (length: number) => Array.from({ length }, () => Math.floor(next() * 10)).join("");
  const city = CITIES[Math.floor(next() * CITIES.length)];
  const shape = Math.floor(next() * 4);
  const upper = shop.name.toUpperCase();
  if (shape === 0) return { payee: shop.name, rawText: `PAGAMENTO POS ${upper} ${city} CARTA *${digits(4)}` };
  if (shape === 1) return { payee: `${upper} ${digits(3)}`, rawText: `${upper} ${digits(3)} ${city}` };
  if (shape === 2)
    return { payee: `${shop.name} ${city}`, rawText: `ADDEBITO ${upper} DEL ${digits(2)}/${digits(2)}` };
  return { payee: upper, rawText: `${upper} OP. ${digits(6)}` };
}

export interface HistoryRow extends Example {
  at: Date;
  kind: "income" | "expense";
}

export const HISTORY_ACCOUNT = "018f4e9a-0000-7000-8000-0000000000aa";
export const HISTORY_MONTHS = 18;

/** The whole history, oldest first: about 1 400 movements over 18 months. */
export function history(seed = 20261116): HistoryRow[] {
  const next = random(seed);
  const rows: HistoryRow[] = [];
  for (let month = 0; month < HISTORY_MONTHS; month += 1) {
    for (const shop of SHOPS) {
      if (month < (shop.from ?? 0)) continue;
      const times = Math.floor(shop.perMonth) + (next() < shop.perMonth % 1 ? 1 : 0);
      for (let time = 0; time < times; time += 1) {
        const day = 1 + Math.floor(next() * 28);
        const [first, second, share] = shop.categories;
        let categoryId: string = second !== undefined && next() >= (share as number) ? second : first;
        if (next() < WRONG_LABELS) categoryId = ALL_CATEGORIES[Math.floor(next() * ALL_CATEGORIES.length)];
        const size = Math.max(100, Math.round(Math.abs(shop.amount) * (1 + (next() * 2 - 1) * shop.spread)));
        const income = shop.amount < 0;
        rows.push({
          ...textOf(shop, next),
          counterparty: null,
          note: null,
          accountId: HISTORY_ACCOUNT,
          amountCents: BigInt(income ? size : -size),
          categoryId,
          kind: income ? "income" : "expense",
          at: new Date(Date.UTC(2025, month, day, 12)),
        });
      }
    }
  }
  return rows.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/** The kind of each category of the history, as the cascade wants it. */
export function historyCategoryKinds(): Map<string, "income" | "expense"> {
  return new Map(ALL_CATEGORIES.map((id) => [id, id === "income" ? "income" : "expense"]));
}

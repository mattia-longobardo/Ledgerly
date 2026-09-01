const EUR = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const EUR_NO_CENTS = new Intl.NumberFormat("it-IT", {
  style: "currency",
  currency: "EUR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const PCT = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const NUM = new Intl.NumberFormat("it-IT", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export type Money = string | number | null | undefined;

function toNumber(v: Money): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `1.234,56 €` — never returns NaN; nullish renders an em dash. */
export function formatEur(v: Money, opts?: { cents?: boolean }): string {
  const n = toNumber(v);
  if (n === null) return "—";
  return (opts?.cents === false ? EUR_NO_CENTS : EUR).format(n);
}

/**
 * Splits a EUR string so the cents can be rendered at 70% muted on hero
 * figures, per the type spec. `{ main: "1.234", cents: ",56", suffix: " €" }`.
 */
export function splitEur(v: Money): { main: string; cents: string; suffix: string } {
  const n = toNumber(v);
  if (n === null) return { main: "—", cents: "", suffix: "" };
  const parts = EUR.formatToParts(n);
  let main = "";
  let cents = "";
  let suffix = "";
  let seenDecimal = false;
  for (const p of parts) {
    if (p.type === "decimal") {
      seenDecimal = true;
      cents += p.value;
    } else if (p.type === "fraction") {
      cents += p.value;
    } else if (p.type === "currency" || (seenDecimal && p.type === "literal")) {
      suffix += p.value;
    } else {
      main += p.value;
    }
  }
  return { main, cents, suffix };
}

/** Signed delta with a true minus glyph — colour is never the only signal. */
export function formatDelta(v: Money): string {
  const n = toNumber(v);
  if (n === null) return "—";
  const sign = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sign}${EUR.format(Math.abs(n))}`;
}

export function formatPercent(v: number | null | undefined, opts?: { signed?: boolean }): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  const sign = opts?.signed ? (v > 0 ? "+" : v < 0 ? "−" : "") : "";
  return `${sign}${PCT.format(Math.abs(v))} %`;
}

export function formatNumber(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return NUM.format(v);
}

/** Hours → days at the configured ratio (payslips state balances in hours). */
export function hoursToDays(hours: Money, hoursPerDay = 8): number | null {
  const n = toNumber(hours);
  if (n === null || hoursPerDay <= 0) return null;
  return n / hoursPerDay;
}

export function formatDays(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  return `${NUM.format(v)} d`;
}

const MONTH_LABEL = new Intl.DateTimeFormat("en-GB", {
  month: "short",
  year: "numeric",
  timeZone: "Europe/Rome",
});

const MONTH_LONG = new Intl.DateTimeFormat("en-GB", {
  month: "long",
  year: "numeric",
  timeZone: "Europe/Rome",
});

const DATE_LINE = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "Europe/Rome",
});

const DATETIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/Rome",
});

export function formatMonth(monthKey: string): string {
  return MONTH_LABEL.format(new Date(`${monthKey}T12:00:00Z`));
}

export function formatMonthLong(monthKey: string): string {
  return MONTH_LONG.format(new Date(`${monthKey}T12:00:00Z`));
}

export function formatDateLine(d: Date): string {
  return DATE_LINE.format(d);
}

/** "as of" stamps shown beside every cached figure. */
export function formatAsOf(d: Date | null | undefined): string {
  if (!d) return "never";
  return DATETIME.format(d);
}

export function formatRelativeAge(d: Date | null | undefined, now = new Date()): string {
  if (!d) return "never";
  const mins = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} d ago`;
}

/** Italian number normalization: `1.234,56` → 1234.56. Returns null on junk. */
export function parseItalianNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw
    .replace(/[ \s]/g, "")
    .replace(/[€]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".")
    .replace(/[^\d.\-+]/g, "");
  if (!cleaned || cleaned === "-" || cleaned === "+") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

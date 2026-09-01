/**
 * Tunable extraction config for TeamSystem "Mod. Cedolino TS" payslips
 * (employer: Reply). Everything here is DATA: label synonyms and value-picking
 * strategies. The engine in `rules.ts` never hardcodes a label, so tuning the
 * parser against a new payslip revision means editing this file only.
 *
 * Labels are matched case-insensitively against whitespace-collapsed lines, so
 * they are written here exactly as they read on the payslip.
 */

import type { PayslipField } from "@/lib/contracts";

/** How to pick the value once a label has matched. */
export type ValueStrategy =
  /** nth number appearing *after* the label on the same line (`last` = rightmost). */
  | { readonly kind: "same-line"; readonly occurrence: number | "last" }
  /** nth number on the first following line that carries numbers. */
  | { readonly kind: "next-line"; readonly occurrence: number | "last" }
  /** nth number on the whole matched line, label included (1-based). */
  | { readonly kind: "nth-number-on-line"; readonly index: number }
  /** value under a named column of a header/value grid. */
  | { readonly kind: "grid-column"; readonly grid: GridId; readonly column: number };

export type Unit = "eur" | "hours";

export interface Anchor {
  readonly labels: readonly string[];
  readonly strategy: ValueStrategy;
  readonly unit: Unit;
  /** Why this anchor is shaped the way it is — read by humans, not by code. */
  readonly note?: string;
}

export type GridId = "residui";

export interface GridSpec {
  readonly id: GridId;
  /** Column headers in printed order. `column` indexes into this array. */
  readonly headers: readonly string[];
  /** Minimum headers that must appear on a line before it counts as the header row. */
  readonly minHeaderHits: number;
}

/**
 * The residuals grid. Paperless OCR flattens it (the August 2026 sample shows
 * 6 values under 12 headers), which is exactly why the engine refuses to guess
 * a column when the value count does not match the header count.
 */
export const GRIDS: Readonly<Record<GridId, GridSpec>> = {
  residui: {
    id: "residui",
    headers: [
      "FERIE A.P.",
      "FERIE MAT.",
      "FERIE GOD.",
      "FERIE RES.",
      "PERMESSI A.P.",
      "PERMESSI MAT.",
      "PERMESSI GOD.",
      "PERMESSI RES.",
      "ROL A.P.",
      "ROL MAT.",
      "ROL GOD.",
      "ROL RES.",
    ],
    minHeaderHits: 3,
  },
};

/** Header synonyms tolerated on the grid header line (abbreviated printings). */
export const GRID_HEADER_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  "PERMESSI A.P.": ["PERM. A.P.", "PERM A.P."],
  "PERMESSI MAT.": ["PERM. MAT.", "PERM MAT."],
  "PERMESSI GOD.": ["PERM. GOD.", "PERM GOD."],
  "PERMESSI RES.": ["PERM. RES.", "PERM RES."],
  "ROL A.P.": ["ROL. A.P."],
  "ROL MAT.": ["ROL. MAT."],
  "ROL GOD.": ["ROL. GOD."],
  "ROL RES.": ["ROL. RES."],
};

/**
 * Values the engine reads for cross-field checks but that are not stored
 * columns of their own.
 */
export const AUX_FIELDS = [
  "totaleCompetenze",
  "totaleRitenute",
  "totaleContributi",
  "imponibileIrpef",
  "irpefLorda",
  "totaleDetrazioni",
  "irpefTrattenute",
  "addizionaleRegionale",
  "addizionaleComunale",
  "arrotondamento",
] as const;

export type AuxField = (typeof AUX_FIELDS)[number];

export const FIELD_ANCHORS: Readonly<Record<PayslipField, readonly Anchor[]>> = {
  gross: [
    {
      labels: ["TOTALE LORDO", "TOT. LORDO"],
      strategy: { kind: "same-line", occurrence: 1 },
      unit: "eur",
      note: "Block with IMPON. CONTR. SOC. / TOTALE CONTRIBUTI SOCIALI.",
    },
    {
      labels: ["TOTALE LORDO"],
      strategy: { kind: "next-line", occurrence: 1 },
      unit: "eur",
      note: "Some printings wrap the amount onto the following line.",
    },
  ],
  net: [
    {
      labels: ["NETTO BUSTA", "NETTO DEL MESE", "NETTO A PAGARE"],
      strategy: { kind: "same-line", occurrence: 1 },
      unit: "eur",
      note: "Same block as IRPEF ERARIO / ADDIZIONALE * / ARROTONDAMENTO.",
    },
    {
      labels: ["NETTO BUSTA"],
      strategy: { kind: "next-line", occurrence: 1 },
      unit: "eur",
    },
  ],
  taxes: [
    {
      labels: ["TOTALE TRATTENUTE IRPEF"],
      strategy: { kind: "same-line", occurrence: 1 },
      unit: "eur",
      note:
        "Direct anchor is IRPEF only; the stored `taxes` figure is the composite " +
        "below (IRPEF + both ADDIZIONALE lines) whenever all parts are present.",
    },
  ],
  fundContribEmployee: [
    {
      labels: ["FONDO C/DIPE", "FONDO C/DIP", "PREVIDENZA C/DIPE"],
      strategy: { kind: "same-line", occurrence: "last" },
      unit: "eur",
      note:
        "Body row: the rightmost figure is the amount column (rate/base columns " +
        "print to its left). Assumed to be the Cometa employee share — confirm " +
        "once on the first verification screen.",
    },
  ],
  fundContribEmployer: [
    {
      labels: ["FONDO C/AZIENDA", "FONDO C/AZ.", "PREVIDENZA C/AZIENDA"],
      strategy: { kind: "same-line", occurrence: "last" },
      unit: "eur",
      note: "Related rows: CONTRIBUZIONE TFR, ESONERO CTR - TFR PREV.C.",
    },
  ],
  ferieBalance: [
    {
      labels: ["FERIE RES."],
      strategy: { kind: "grid-column", grid: "residui", column: 3 },
      unit: "hours",
    },
    {
      labels: ["FERIE RES.", "FERIE RESIDUE"],
      strategy: { kind: "same-line", occurrence: 1 },
      unit: "hours",
      note: "Fallback for printings that put the residual on its own labelled line.",
    },
  ],
  rolBalance: [
    {
      labels: ["ROL RES."],
      strategy: { kind: "grid-column", grid: "residui", column: 11 },
      unit: "hours",
    },
    {
      labels: ["ROL RES.", "ROL RESIDUI"],
      strategy: { kind: "same-line", occurrence: 1 },
      unit: "hours",
    },
  ],
  permessiBalance: [
    {
      labels: ["PERMESSI RES."],
      strategy: { kind: "grid-column", grid: "residui", column: 7 },
      unit: "hours",
    },
    {
      labels: ["PERMESSI RES.", "PERM. RES."],
      strategy: { kind: "same-line", occurrence: 1 },
      unit: "hours",
    },
  ],
  // Nessuna ancora: il valore corretto e' la colonna `FERIE GOD.` della griglia,
  // che non ha etichetta adiacente e viene letta da `teamsystem.ts`. Ancorare
  // qui la voce di corpo 300 farebbe divergere i due pass su ogni mese con ore
  // godute (agosto: 12,01 contro 8,00), declassando il campo a confidence low.
  ferieTakenHours: [],
  // `ROL. GOD.` lives in the leave grid, not in a labelled body row, so there is
  // no anchor to match: `teamsystem.ts` derives it from the grid arithmetic.
  rolTakenHours: [],
};

export const AUX_ANCHORS: Readonly<Record<AuxField, readonly Anchor[]>> = {
  totaleCompetenze: [
    {
      labels: ["TOTALE COMPETENZE", "TOT. COMPETENZE"],
      strategy: { kind: "same-line", occurrence: 1 },
      unit: "eur",
    },
  ],
  totaleRitenute: [
    {
      labels: ["TOTALE RITENUTE", "TOT. RITENUTE"],
      strategy: { kind: "same-line", occurrence: 1 },
      unit: "eur",
    },
  ],
  totaleContributi: [
    {
      labels: ["TOTALE CONTRIBUTI SOCIALI"],
      strategy: { kind: "same-line", occurrence: 1 },
      unit: "eur",
    },
  ],
  imponibileIrpef: [
    { labels: ["IMPONIBILE IRPEF"], strategy: { kind: "same-line", occurrence: 1 }, unit: "eur" },
  ],
  irpefLorda: [
    { labels: ["IRPEF LORDA"], strategy: { kind: "same-line", occurrence: 1 }, unit: "eur" },
  ],
  totaleDetrazioni: [
    { labels: ["TOTALE DETRAZIONI"], strategy: { kind: "same-line", occurrence: 1 }, unit: "eur" },
  ],
  irpefTrattenute: [
    {
      labels: ["TOTALE TRATTENUTE IRPEF", "IRPEF ERARIO", "IRPEF NETTA"],
      strategy: { kind: "same-line", occurrence: 1 },
      unit: "eur",
    },
  ],
  addizionaleRegionale: [
    {
      labels: ["ADDIZIONALE REGIONALE", "ADD. REGIONALE"],
      strategy: { kind: "same-line", occurrence: 1 },
      unit: "eur",
    },
  ],
  addizionaleComunale: [
    {
      labels: ["ADDIZIONALE COMUNALE", "ADD. COMUNALE"],
      strategy: { kind: "same-line", occurrence: 1 },
      unit: "eur",
    },
  ],
  arrotondamento: [
    { labels: ["ARROTONDAMENTO"], strategy: { kind: "same-line", occurrence: 1 }, unit: "eur" },
  ],
};

/**
 * Fields the engine prefers to compute from parts. Used only when every part
 * resolved; otherwise the field's own anchors stand.
 */
export const COMPOSITE_FIELDS: Partial<Record<PayslipField, readonly AuxField[]>> = {
  taxes: ["irpefTrattenute", "addizionaleRegionale", "addizionaleComunale"],
};

/** Fields whose value depends on column association — the OCR-fragile ones. */
export const GRID_DEPENDENT_FIELDS: readonly PayslipField[] = [
  "ferieBalance",
  "rolBalance",
  "permessiBalance",
];

export const THIRTEENTH_KEYWORDS: readonly string[] = [
  "TREDICESIMA",
  "13MA",
  "13^ MENSILITA",
  "GRATIFICA NATALIZIA",
];

/**
 * Markers that only an ordinary monthly payslip carries. A December document
 * without any of them is a strong tredicesima signal on its own.
 */
export const ORDINARY_MONTH_MARKERS: readonly string[] = [
  "FERIE RES.",
  "ROL RES.",
  "GIORNI RETRIBUITI",
  "ORE LAVORATE",
  "RETRIBUZIONE ORDINARIA",
];

export const PERIOD_LABELS: readonly string[] = [
  "PERIODO DI PAGA",
  "PERIODO PAGA",
  "MESE DI RETRIBUZIONE",
  "COMPETENZE DEL MESE",
];

export const ITALIAN_MONTHS: Readonly<Record<string, number>> = {
  GENNAIO: 1,
  FEBBRAIO: 2,
  MARZO: 3,
  APRILE: 4,
  MAGGIO: 5,
  GIUGNO: 6,
  LUGLIO: 7,
  AGOSTO: 8,
  SETTEMBRE: 9,
  OTTOBRE: 10,
  NOVEMBRE: 11,
  DICEMBRE: 12,
};

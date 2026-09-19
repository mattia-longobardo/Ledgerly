// tests/fixtures/payroll/twin.ts — synthetic twins of a Reply/TeamSystem payslip (spec §11, D14).
//
// The "«Mod. Cedolino TS»" form drawn with pdf-lib at the positions the real form uses — labels in
// 5 pt, values in 10 pt fixed pitch, amounts right-aligned in their box — and filled with invented
// numbers that add up the way a real payslip does. The positions are the form's, not anyone's data.
// Imports nothing from `src/`, so Vitest and Playwright's Node side can both build them.
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts } from "pdf-lib";

export interface TwinLine {
  code: string;
  description: string;
  quantity?: string;
  rate?: string;
  earnings?: string;
  deductions?: string;
  statistical?: string;
}

/** Amounts as plain decimals ("2000.00", "-20.00"); the twin prints them the Italian way. */
export interface TwinPayslip {
  period: string;
  employerCode: string;
  employeeCode: string;
  employeeName: string;
  printedOn: string;
  contractual: string;
  lines: TwinLine[];
  totalGross: string;
  social: string;
  substituteSummary?: string;
  oneri?: string;
  irpefTaxable?: string;
  irpefGross?: string;
  taxDeductions?: string;
  irpefWithheld?: string;
  roundingPrevious?: string;
  bodyDeductions?: string;
  totalDeductions: string;
  yearEndAdjustment?: string;
  irpefErario?: string;
  regionalAnnual?: string;
  roundingCurrent?: string;
  net: string;
  tfrMonth?: string;
  /** A.P., MAT., GOD., RES. — `null` for a blank box. */
  vacation?: (string | null)[];
  permit?: (string | null)[];
  rol?: (string | null)[];
  /** The yearly progressives, printed under labels the month's boxes share. */
  progressives?: { taxable: string; irpefGross: string; deductions: string; paid: string };
}

const WIDTH = 595.28;
const HEIGHT = 841.88;
const PITCH = 6; // Courier at 10 pt: 600/1000 em.

/** "2345.6" → "2.345,60"; "-20" → "-20,00"; decimals kept as given beyond two. */
export function italianAmount(decimal: string, decimals = 2): string {
  const negative = decimal.startsWith("-");
  const [whole, fraction = ""] = decimal.replace(/^[-+]/, "").split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${fraction.padEnd(decimals, "0")}`;
}

class Form {
  constructor(
    private readonly page: PDFPage,
    private readonly label: PDFFont,
    private readonly value: PDFFont,
  ) {}

  /** A printed label, its baseline `baseline` points from the top. */
  caption(text: string, x: number, baseline: number, size = 5): void {
    this.page.drawText(text, { x, y: HEIGHT - baseline, size, font: this.label });
  }

  /** A value starting at `x`. */
  left(text: string, x: number, baseline: number): void {
    this.page.drawText(text, { x, y: HEIGHT - baseline, size: 10, font: this.value });
  }

  /** A value ending at `right`, as amounts are printed. */
  right(text: string | undefined, right: number, baseline: number): void {
    if (text === undefined || text === "") return;
    this.left(text, right - text.length * PITCH, baseline);
  }
}

const amount = (decimal: string | undefined) => (decimal === undefined ? undefined : italianAmount(decimal));
const hours = (decimal: string | null | undefined) =>
  decimal === null || decimal === undefined ? undefined : italianAmount(decimal);

/** Builds one twin as PDF bytes. */
export async function twinPdf(twin: TwinPayslip): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  // Fixed dates: the same twin is the same bytes, so its SHA-256 is stable.
  pdf.setCreationDate(new Date("2030-01-01T00:00:00Z"));
  pdf.setModificationDate(new Date("2030-01-01T00:00:00Z"));
  const page = pdf.addPage([WIDTH, HEIGHT]);
  const form = new Form(
    page,
    await pdf.embedFont(StandardFonts.Helvetica),
    await pdf.embedFont(StandardFonts.Courier),
  );

  form.caption("Ditta", 36.2, 24, 7.5);
  form.left("ACME Consulenze srl", 48.5, 44);
  form.left("VIA DEGLI ESEMPI 1", 48.5, 68);
  form.left(`Cod.fiscale : ${twin.employerCode}`, 48.5, 80);

  form.caption("MESE RETRIBUITO", 27, 100);
  form.caption("COD.", 113.4, 100.3);
  form.caption("AZIENDA", 113.4, 106);
  form.caption("CODICE", 294.9, 100.3);
  form.caption("COGNOME E NOME", 336.2, 100.3);
  form.caption("DATA ASSUNZIONE", 520.2, 100.3);
  form.left(twin.period, 24.5, 116);
  form.left("900", 120.5, 116);
  form.left(`${twin.employeeCode.padStart(3, " ")} ${twin.employeeName}`, 312.5, 116);
  form.left("01/01/30", 522.5, 116);

  form.caption("RETRIBUZIONE DI FATTO", 27, 148.3);
  form.caption("QUAL.", 101.4, 148.3);
  form.caption("QUALIFICA", 120.6, 148.3);
  form.caption("ORE CCNL", 462.6, 148.3);
  form.right(amount(twin.contractual), 96.5, 164);
  form.left("47 IMPIEGATO", 102.5, 164);
  form.left("173,00", 462.5, 164);

  // The body: code right-aligned at 48.5, description from 54.5, then the five columns.
  form.caption("CODICE", 27, 247.4);
  form.caption("DESCRIZIONE VOCE", 57.3, 247.4);
  form.caption("ORE/GIORNI", 219.3, 247.4);
  form.caption("BASE", 271.8, 247.4);
  form.caption("COMPETENZE", 343.8, 247.4);
  form.caption("TRATTENUTE", 423, 247.4);
  form.caption("DATI STATISTICI", 502.2, 247.4);
  twin.lines.forEach((line, index) => {
    const baseline = 260 + index * 12;
    form.right(line.code, 48.5, baseline);
    form.left(line.description, 54.5, baseline);
    form.right(line.quantity === undefined ? undefined : italianAmount(line.quantity), 264.5, baseline);
    form.right(line.rate === undefined ? undefined : italianAmount(line.rate, 5), 336.5, baseline);
    form.right(amount(line.earnings), 414.5, baseline);
    form.right(amount(line.deductions), 492.5, baseline);
    form.right(amount(line.statistical), 570.5, baseline);
  });
  form.left("Codice CCNL: C011", 54.5, 260 + twin.lines.length * 12);

  form.caption("TOTALE LORDO", 27, 484.3);
  form.caption("IMPON. CONTR. SOC.", 111.3, 484.3);
  form.caption("CONTRIBUTO 1", 189, 484.3);
  form.caption("TOTALE CONTRIBUTI SOCIALI", 487.6, 484.5);
  form.right(amount(twin.totalGross), 102.5, 500);
  form.right(amount(twin.social), 246.5, 500);
  form.right(amount(twin.social), 564.5, 500);

  form.caption("IMP. T.S. TFR ANTE 2001 NETTO", 25.6, 508);
  form.caption("IRPEF", 138.6, 508.3);
  form.caption("IRPEF NETTA", 311.4, 508.3);
  form.caption("TOTALE TRATTENUTE IRPEF T.S.", 487.6, 508.5);
  form.right(amount(twin.substituteSummary), 564.5, 524);

  form.caption("IMP. T.S. ARR. A.P.", 27, 532.3);
  form.caption("IRPEF A.P.", 138.6, 532.3);
  form.caption("ONERI DEDUCIBILI", 196.2, 532.3);
  form.caption("IMPONIBILE IRPEF", 271.8, 532.3);
  form.caption("IRPEF LORDA", 356.1, 532.3);
  form.caption("TOTALE DETRAZIONI", 424.5, 532.3);
  form.caption("TOTALE TRATTENUTE IRPEF", 487.6, 532.5);
  form.right(amount(twin.oneri), 258.5, 548);
  form.right(amount(twin.irpefTaxable), 342.5, 548);
  form.right(amount(twin.irpefGross), 420.5, 548);
  form.right(amount(twin.taxDeductions), 480.5, 548);
  form.right(amount(twin.irpefWithheld), 564.5, 548);

  form.caption("ACCONTO", 27, 556.3);
  form.caption("ARROTOND. PRECED.", 361.8, 556.3);
  form.caption("TRATTENUTE CORPO", 421.6, 556.3);
  form.caption("TOTALE TRATTENUTE", 487.6, 556.5);
  form.right(amount(twin.roundingPrevious), 414.5, 572);
  form.right(amount(twin.bodyDeductions), 480.5, 572);
  form.right(amount(twin.totalDeductions), 564.5, 572);

  form.caption("PROGR. ONERI DED.", 66.6, 580.5);
  form.caption("PROG. IMPONIBILE IRPEF", 124.2, 580.3);
  form.caption("CONGUAGLIO IRPEF +/-", 487.8, 579.8);
  form.caption("CONGUAGLIO", 30.2, 584.4, 4.3);
  form.caption("«Mod. Cedolino TS» - Elaborazione Grafica", 22.5, 587.5);
  form.right(amount(twin.yearEndAdjustment), 564.5, 596);

  form.caption("IRPEF ERARIO", 27, 604.3);
  form.caption("ADDIZIONALE REGIONALE", 118.5, 604.3);
  form.caption("ADDIZIONALE COMUNALE", 204.9, 604.3);
  form.caption("ARROTONDAMENTO", 428.3, 604.3);
  form.caption("ATTUALE", 442.4, 608.6);
  form.caption("NETTO BUSTA", 487.6, 604.5);
  form.right(amount(twin.irpefErario), 108.5, 620);
  form.right(amount(twin.regionalAnnual), 192.5, 620);
  form.right(amount(twin.roundingCurrent), 480.5, 620);
  form.right(amount(twin.net), 570.5, 620);

  const grid: [string, number, number][] = [
    ["FERIE A.P.", 27, 72.5],
    ["FERIE MAT.", 77.4, 114.5],
    ["FERIE GOD.", 120.6, 162.5],
    ["FERIE RES.", 166, 210.5],
    ["PERMESSI A.P.", 211.4, 252.5],
    ["PERMESSI MAT.", 256.7, 300.5],
    ["PERMESSI GOD.", 301.8, 342.5],
    ["PERMESSI RES.", 347.2, 390.5],
    ["ROL A.P.", 392.8, 432.5],
    ["ROL MAT.", 437.9, 480.5],
    ["ROL. GOD.", 483.5, 522.5],
    ["ROL. RES.", 528.6, 570.5],
  ];
  const leave = [...(twin.vacation ?? [null, null, null, null]), ...(twin.permit ?? [null, null, null, null]), ...(twin.rol ?? [null, null, null, null])];
  grid.forEach(([text, x, right], index) => {
    form.caption(text, x, 628.3);
    form.right(hours(leave[index]), right, 644);
  });

  form.caption("Q/INPS", 66.6, 676.3);
  form.caption("ORE INPS", 140.8, 676.3);
  form.caption("TFR MESE", 495, 676.3);
  form.caption("DATI", 34.5, 682.3);
  form.left("5", 72.5, 692);
  form.right(amount(twin.tfrMonth), 570.5, 692);

  form.caption("IMPONIBILE INAIL", 70.2, 724.3);
  form.caption("IMP. CONTRIBUTI SOCIALI", 138.6, 724.3);
  form.caption("IMPONIBILE IRPEF", 316.5, 724.3);
  form.caption("IRPEF LORDA", 388.5, 724.3);
  form.caption("TOTALE DETRAZIONI", 454.5, 724.3);
  form.caption("IRPEF PAGATA", 516.6, 724.3);
  if (twin.progressives) {
    form.right(twin.progressives.taxable.replace(".", ","), 384.5, 740);
    form.right(twin.progressives.irpefGross.replace(".", ","), 450.5, 740);
    form.right(twin.progressives.deductions.replace(".", ","), 504.5, 740);
    form.right(twin.progressives.paid.replace(".", ","), 570.5, 740);
  }
  form.caption(`stampato il ${twin.printedOn} alle ore 12:00:00`, 400, 800, 5.5);
  return pdf.save({ useObjectStreams: false });
}

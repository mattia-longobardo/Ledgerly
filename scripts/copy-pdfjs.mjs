// scripts/copy-pdfjs.mjs — the PDF viewer's worker and standard fonts, served by the site itself
// (spec §8.3 PdfViewer): the CSP allows scripts from 'self' only. Runs before every build; the
// copies are not versioned (they come from node_modules, at the installed pdfjs-dist version).
import { cpSync, mkdirSync } from "node:fs";

const from = "node_modules/pdfjs-dist";
const to = "public/pdfjs";
mkdirSync(to, { recursive: true });
cpSync(`${from}/build/pdf.worker.min.mjs`, `${to}/pdf.worker.min.mjs`);
cpSync(`${from}/standard_fonts`, `${to}/standard_fonts`, { recursive: true });

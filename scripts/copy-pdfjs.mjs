// scripts/copy-pdfjs.mjs — the PDF viewer's own files, served by the site itself (spec §8.3
// PdfViewer): the CSP allows scripts from 'self' only. Runs before every build; the copies are not
// versioned (they come from node_modules, at the installed pdfjs-dist version).
//
// Three things, and all three are needed: the worker, the standard fonts, and the WASM decoders —
// pdf.js 6 reads JBIG2 and JPEG 2000 images through the latter, and without them a payslip whose
// logo is a JBIG2 image loses the image and warns in the console. `src/ui/pdf-assets.ts` names the
// URLs the viewer asks for, and `src/ui/pdf-assets.test.ts` keeps the two sides in step.
//
// Takes the destination as an argument so the test can copy into a throwaway directory.
import { cpSync, mkdirSync } from "node:fs";

const from = "node_modules/pdfjs-dist";
const to = process.argv[2] ?? "public/pdfjs";
mkdirSync(to, { recursive: true });
cpSync(`${from}/build/pdf.worker.min.mjs`, `${to}/pdf.worker.min.mjs`);
cpSync(`${from}/standard_fonts`, `${to}/standard_fonts`, { recursive: true });
cpSync(`${from}/wasm`, `${to}/wasm`, { recursive: true });

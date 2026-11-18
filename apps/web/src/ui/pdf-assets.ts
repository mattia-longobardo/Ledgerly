/**
 * Where the PDF viewer finds pdf.js's own files (spec §8.3): the site serves them itself, because
 * the CSP allows scripts from 'self' only. `scripts/copy-pdfjs.mjs` puts them there before every
 * build, and `pdf-assets.test.ts` checks the two sides cannot drift apart.
 *
 * The WASM folder is not optional: pdf.js 6 decodes JBIG2 and JPEG 2000 images through it, and a
 * payslip whose logo is a JBIG2 image simply loses the image — with a warning in the console — when
 * `wasmUrl` is missing.
 */
export const PDF_ASSETS = {
  worker: "/pdfjs/pdf.worker.min.mjs",
  standardFonts: "/pdfjs/standard_fonts/",
  wasm: "/pdfjs/wasm/",
} as const;

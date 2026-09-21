import "server-only";
import { getDocumentProxy } from "unpdf";

/**
 * A string as the PDF draws it (spec §7.8 pipeline step 2): its text and its box in points, with
 * the origin at the page's top left like the viewer's — whatever the page's rotation.
 */
export interface TextItem {
  text: string;
  page: number;
  x0: number;
  x1: number;
  top: number;
  bottom: number;
  /** Where the glyphs sit: rows of a form line up on it, whatever their font size. */
  baseline: number;
  /** The font size in points: labels and values of a form are told apart by it. */
  size: number;
}

export interface PageText {
  page: number;
  width: number;
  height: number;
  items: TextItem[];
}

/**
 * The text of every page with coordinates, through pdf.js (`unpdf`). No OCR (spec D11): a page
 * without a text layer simply has no items. Blank strings are dropped.
 */
export async function readPdfText(bytes: Uint8Array): Promise<PageText[]> {
  // pdf.js detaches the buffer it is given: it gets a copy.
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 });
  try {
    const pages: PageText[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      for (const item of content.items) {
        if (!("str" in item) || item.str.trim() === "") continue;
        const [, , , , e, f] = item.transform as number[];
        const size = item.height || Math.hypot(item.transform[2], item.transform[3]);
        const [left, baseline] = viewport.convertToViewportPoint(e, f);
        const [right] = viewport.convertToViewportPoint(e + item.width, f);
        items.push({
          text: item.str,
          page: number,
          x0: Math.min(left, right),
          x1: Math.max(left, right),
          // Ascent and descent are not in the text layer: 80 % above the baseline, 20 % below.
          top: baseline - size * 0.8,
          bottom: baseline + size * 0.2,
          baseline,
          size,
        });
      }
      pages.push({ page: number, width: viewport.width, height: viewport.height, items });
    }
    return pages;
  } finally {
    await pdf.loadingTask.destroy();
  }
}

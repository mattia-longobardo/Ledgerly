import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PDF_ASSETS } from "./pdf-assets";

/**
 * The viewer asks for three things under `/pdfjs/`, and a build script puts them there. Nothing
 * else connects the two: a file the script stops copying would 404 in the browser, and the only
 * symptom would be a warning in a console nobody reads — which is exactly how a payslip's JBIG2
 * logo went missing until it was noticed by eye. This test copies into a throwaway directory and
 * checks that every URL the viewer names has a file behind it.
 */
const destination = mkdtempSync(join(tmpdir(), "pdfjs-"));

afterAll(() => rmSync(destination, { recursive: true, force: true }));

/** "/pdfjs/wasm/" → "wasm" — the path the copy leaves behind. */
function pathOf(url: string): string {
  return url.replace(/^\/pdfjs\//, "").replace(/\/$/, "");
}

describe("the files pdf.js is served from (spec §8.3)", () => {
  it("copies everything the viewer asks for", () => {
    execFileSync("node", ["scripts/copy-pdfjs.mjs", destination], { stdio: "pipe" });
    for (const url of Object.values(PDF_ASSETS)) {
      expect(existsSync(join(destination, pathOf(url))), url).toBe(true);
    }
  });

  it("brings the image decoders with it: without them a JBIG2 or JPEG 2000 image is dropped", () => {
    const wasm = join(destination, pathOf(PDF_ASSETS.wasm));
    expect(existsSync(join(wasm, "jbig2.wasm"))).toBe(true);
    expect(existsSync(join(wasm, "openjpeg.wasm"))).toBe(true);
  });

  it("serves them from this site, never from a CDN (the CSP allows 'self' only)", () => {
    for (const url of Object.values(PDF_ASSETS)) expect(url.startsWith("/pdfjs/")).toBe(true);
  });
});

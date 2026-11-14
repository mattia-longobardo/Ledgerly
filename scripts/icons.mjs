// scripts/icons.mjs — renders the raster icons from `src/app/icon.svg`, which is their source.
// An SVG favicon alone is not enough: Safari ignores it, and every browser asks for
// `/favicon.ico` on its own. Run after changing the SVG; the outputs are committed because
// `next build` needs them on disk.
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const svg = await readFile(new URL("../src/app/icon.svg", import.meta.url));
const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/** An ICO holding PNG entries: supported everywhere that matters, and far smaller than BMP. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((one) => one.data)]);
}

const sizes = [16, 32, 48];
const rendered = await Promise.all(sizes.map(async (size) => ({ size, data: await png(size) })));
await writeFile(new URL("../src/app/favicon.ico", import.meta.url), ico(rendered));
await writeFile(new URL("../src/app/icon.png", import.meta.url), await png(32));
await writeFile(new URL("../src/app/apple-icon.png", import.meta.url), await png(180));

// The icons of the web manifest (`src/app/manifest.webmanifest/route.ts`), which is what lets a
// browser install Ledgerly with its own icon and window. Android and Windows ask for 192 and 512;
// the "maskable" one is cropped by the launcher to its own shape, so its plate fills the square and
// the letter stays inside the central 80% that every shape keeps (W3C manifest, "safe zone").
const maskable = Buffer.from(
  svg
    .toString("utf8")
    .replace('rx="8"', 'rx="0"')
    .replace(
      /<path class="letter"[^>]*\/>/,
      (letter) => `<g transform="translate(16 16) scale(0.7) translate(-16 -16)">${letter}</g>`,
    ),
);
const render = (source, size) =>
  sharp(source, { density: 1536 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
const manifestIcon = (name) => new URL(`../src/app/manifest.webmanifest/${name}`, import.meta.url);
await writeFile(manifestIcon("app-192.png"), await render(svg, 192));
await writeFile(manifestIcon("app-512.png"), await render(svg, 512));
await writeFile(manifestIcon("app-maskable-512.png"), await render(maskable, 512));
console.log("[icons] favicon.ico (16/32/48), icon.png (32), apple-icon.png (180)");
console.log("[icons] manifest: app-192.png, app-512.png, app-maskable-512.png");

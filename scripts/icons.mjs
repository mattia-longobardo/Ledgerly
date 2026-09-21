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
console.log("[icons] favicon.ico (16/32/48), icon.png (32), apple-icon.png (180)");

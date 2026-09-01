"""Rasterise the Finance Dashboard mark to PNG. No rasteriser is installed on
this box, so we supersample the (purely rectilinear) geometry by hand and
encode the result with zlib. Geometry mirrors public/brand/icon*.svg exactly."""
import pathlib, struct, zlib

SS = 4  # supersampling factor

def hexrgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i+2], 16) for i in (0, 2, 4))

BG      = hexrgb("#0c0e12")
FG      = hexrgb("#e6eaf0")
MUTED   = hexrgb("#8b94a3")
ACCENT  = hexrgb("#22d3ee")

# Glyph rects on the 48-unit grid: (x, y, w, h, colour)
GLYPH = [
    (3, 40, 42, 2.5, MUTED), # axis rule, overshooting both sides
    (8,  6,  6, 30, FG),      # stem, lifted clear of the rule
    (8,  6, 27,  6, FG),      # top arm
    (8, 18, 19,  6, ACCENT),  # mid arm (current value)
]

def render(size, scale, tx, ty, radius):
    """radius=0 renders a full-bleed square (maskable); otherwise a rounded square."""
    n = size * SS
    acc = [[[0, 0, 0] for _ in range(n)] for _ in range(n)]
    r = radius * SS

    # Background, with rounded corners where asked for.
    for y in range(n):
        for x in range(n):
            inside = True
            if r:
                cx = r if x < r else (n - 1 - r if x > n - 1 - r else x)
                cy = r if y < r else (n - 1 - r if y > n - 1 - r else y)
                if (cx != x or cy != y) and (x - cx) ** 2 + (y - cy) ** 2 > r * r:
                    inside = False
            acc[y][x] = list(BG) if inside else [-1, -1, -1]  # -1 marks transparent

    # Glyph rects, painted in SVG document order.
    for gx, gy, gw, gh, col in GLYPH:
        x0 = int(round((gx * scale + tx) * SS)); x1 = int(round(((gx + gw) * scale + tx) * SS))
        y0 = int(round((gy * scale + ty) * SS)); y1 = int(round(((gy + gh) * scale + ty) * SS))
        for y in range(max(0, y0), min(n, y1)):
            row = acc[y]
            for x in range(max(0, x0), min(n, x1)):
                if row[x][0] != -1:
                    row[x] = list(col)

    # Box-filter down to the target size, resolving transparency to alpha.
    px = bytearray()
    area = SS * SS
    for oy in range(size):
        px.append(0)  # PNG filter byte: none
        for ox in range(size):
            rs = gs = bs = a = 0
            for dy in range(SS):
                row = acc[oy * SS + dy]
                for dx in range(SS):
                    p = row[ox * SS + dx]
                    if p[0] != -1:
                        rs += p[0]; gs += p[1]; bs += p[2]; a += 1
            if a:
                px += bytes((rs // a, gs // a, bs // a, (a * 255) // area))
            else:
                px += b"\0\0\0\0"
    return bytes(px)

def write_png(path, size, raw):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)  # 8-bit RGBA
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr)
           + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
    with open(path, "wb") as f:
        f.write(png)
    return len(png)

# Run from the repo root:  python3 dashboard-app/scripts/render-brand-icons.py
OUT = str(pathlib.Path(__file__).resolve().parents[1] / "public")

# Optically centre the glyph from its own bounding box rather than by hand, so
# the offsets stay correct if the geometry is ever retuned.
BX0 = min(r[0] for r in GLYPH); BX1 = max(r[0] + r[2] for r in GLYPH)
BY0 = min(r[1] for r in GLYPH); BY1 = max(r[1] + r[3] for r in GLYPH)

jobs = [
    # (filename, size, glyph's longer side as a fraction of the canvas, corner radius)
    ("icon-192.png",          192, 0.66, 42),
    ("icon-512.png",          512, 0.66, 112),
    ("icon-512-maskable.png", 512, 0.52, 0),   # inside the 80% maskable safe zone
    ("apple-icon.png",        180, 0.58, 0),   # iOS applies its own squircle mask
]
for name, size, frac, radius in jobs:
    scale = (size * frac) / max(BX1 - BX0, BY1 - BY0)
    tx = (size - (BX0 + BX1) * scale) / 2
    ty = (size - (BY0 + BY1) * scale) / 2
    nbytes = write_png(f"{OUT}/{name}", size, render(size, scale, tx, ty, radius))
    print(f"{name:24} {size}x{size}  glyph {(BX1-BX0)*scale:6.1f}x{(BY1-BY0)*scale:6.1f}px"
          f"  margins {BX0*scale+tx:5.1f}/{BY0*scale+ty:5.1f}  {nbytes:>7,} bytes")

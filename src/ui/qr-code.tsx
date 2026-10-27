import { encode } from "uqr";

/**
 * A QR code drawn as SVG rectangles, from the value itself: no image request, no inline markup
 * string, so the CSP has nothing to allow. Always dark on white with a quiet zone, in both themes:
 * a phone camera reads that, not the theme's colours.
 */
export function QrCode({ value, label, size = 176 }: { value: string; label: string; size?: number }) {
  const { data, size: modules } = encode(value, { ecc: "M", border: 2 });
  const path = data.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : ""))).join("");
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${modules} ${modules}`}
      shapeRendering="crispEdges"
      className="rounded-ctl"
    >
      <rect width={modules} height={modules} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

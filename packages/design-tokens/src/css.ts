// Writes `tokens.css`: the colours of the two themes as CSS variables, and the Tailwind theme that
// names them. The web app imports the file after Tailwind (`apps/web/src/app/globals.css`).
import { COLORS, SHADOWS } from "./colors";
import { CONTAINERS, FONTS, RADIUS, SMALL_SHADOWS, TEXT, TRACKING } from "./scale";

const block = (selector: string, lines: string[]) =>
  `${selector} {\n${lines.map((line) => `  ${line}`).join("\n")}\n}`;

const declarations = (prefix: string, values: Record<string, string>) =>
  Object.entries(values).map(([name, value]) => `--${prefix}${name}: ${value};`);

function theme(name: "light" | "dark"): string[] {
  return [...declarations("", COLORS[name]), `--shadow: ${SHADOWS[name]};`, `color-scheme: ${name};`];
}

function textScale(): string[] {
  return Object.entries(TEXT).flatMap(([name, { size, lineHeight }]) => [
    `--text-${name}: ${size};`,
    ...(lineHeight ? [`--text-${name}--line-height: ${lineHeight};`] : []),
  ]);
}

const ANIMATIONS = `--animate-in: fd-in 0.2s ease;
  --animate-shimmer: fd-shimmer 1.4s infinite;

  @keyframes fd-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes fd-shimmer {
    0%,
    100% {
      opacity: 0.55;
    }
    50% {
      opacity: 1;
    }
  }`;

/** The whole file, as `npm run tokens` writes it. */
export function tokensCss(): string {
  const colorNames = Object.keys(COLORS.light);
  const sections = [
    "/* Written by `npm run tokens` from packages/design-tokens/src: do not edit by hand. */",
    block(':root,\n[data-theme="light"]', theme("light")),
    block('[data-theme="dark"]', theme("dark")),
    block("@theme inline", [
      ...colorNames.map((name) => `--color-${name}: var(--${name});`),
      "--shadow-overlay: var(--shadow);",
    ]),
    block("@theme", [
      ...declarations("font-", FONTS),
      ...textScale(),
      ...declarations("container-", CONTAINERS),
      ...declarations("radius-", RADIUS),
      ...declarations("tracking-", TRACKING),
      ...declarations("shadow-", SMALL_SHADOWS),
      ANIMATIONS,
    ]),
  ];
  return `${sections.join("\n\n")}\n`;
}

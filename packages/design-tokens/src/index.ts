// `packages/design-tokens` (10-modularity.md §10.2): the one source of every visual value (audit UI-DS-15).
// `tokens.css` is written from here by `npm run tokens`; `tokens.test.ts` holds the file to it.
// The public interface: the values as TypeScript constants, and the CSS that declares them.
export { COLORS } from "./colors";
export { TONE_TEXT, type Tone } from "./tone";
export { tokensCss } from "./css";

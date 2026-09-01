import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The design tokens add font sizes (`text-body`, `text-display`…) that are not
 * t-shirt sizes, so stock tailwind-merge files them under `text-color` and
 * silently drops the real colour class. Both groups are declared explicitly.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "caption",
            "body-sm",
            "body",
            "heading-sm",
            "heading",
            "display-sm",
            "display",
          ],
        },
      ],
      "text-color": [
        {
          text: [
            "fg",
            "fg-muted",
            "accent",
            "accent-contrast",
            "positive",
            "negative",
            "warning",
            "chart-1",
            "chart-2",
            "chart-3",
            "chart-4",
            "chart-5",
            "chart-6",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

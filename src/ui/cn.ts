import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge must know the custom font sizes and radii, otherwise it treats
// `text-kpi` as a colour and silently drops `text-fg` (or the other way round).
const merge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["micro", "md", "kpi", "title", "hero-sm", "hero", "display"],
      radius: ["ctl", "card", "modal"],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}

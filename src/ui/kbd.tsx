import type { ReactNode } from "react";

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded-[4px] border border-border px-1 font-sans text-xs leading-4 text-faint">
      {children}
    </kbd>
  );
}

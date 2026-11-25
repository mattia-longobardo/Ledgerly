// A banner on top of a page or of a section (PERS-615 §5): the cause in the title, what changed and
// what to do below it, and the action beside. `alert` makes it a live region: a failure, or something
// only the person can repair. Only today's tokens: `warn` and `neg` with their backgrounds (§7).
import { CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

const TONE = {
  warn: { box: "border-warn/40 bg-warn-bg", icon: "text-warn" },
  neg: { box: "border-neg/40 bg-neg-bg", icon: "text-neg" },
} as const;

export function Banner({
  tone,
  title,
  alert = false,
  action,
  children,
  testId,
}: {
  tone: keyof typeof TONE;
  title: string;
  /** `role="alert"`: an error, or an action only the person can take. */
  alert?: boolean;
  action?: ReactNode;
  children?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      role={alert ? "alert" : undefined}
      data-testid={testId}
      className={cn(
        "flex flex-col gap-3 rounded-card border px-4 py-3.5 text-fg md:flex-row md:items-start md:justify-between",
        TONE[tone].box,
      )}
    >
      <div className="flex min-w-0 gap-3">
        <CircleAlert aria-hidden className={cn("mt-0.5 size-[18px] shrink-0", TONE[tone].icon)} />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="font-semibold">{title}</p>
          {children !== undefined && <div className="text-sm">{children}</div>}
        </div>
      </div>
      {action !== undefined && <div className="flex shrink-0 [&>*]:w-full md:[&>*]:w-auto">{action}</div>}
    </div>
  );
}

// A portfolio's detail page (audit UI-FND-1, UI-INV-1): its header, its tabs, the period beside them,
// and the open tab. A fund and an investment service draw it the same; every word and figure is the
// caller's.
import type { ReactNode } from "react";
import { DetailHeader } from "./detail-header";

export function PortfolioDetail({
  header,
  tabs,
  period,
  children,
}: {
  /** The props of the page's `DetailHeader`. */
  header: Parameters<typeof DetailHeader>[0];
  /** The tabs, as routes or links. */
  tabs: ReactNode;
  /** The period bar; null on a tab that does not follow the period. */
  period: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <DetailHeader {...header} />
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1">{tabs}</div>
        {period}
      </div>
      {children}
    </>
  );
}

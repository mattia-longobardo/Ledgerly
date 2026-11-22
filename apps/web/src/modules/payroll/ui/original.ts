import { call } from "@ledgerly/api-client";
import { payroll } from "@ledgerly/api-contract/payroll";

/**
 * A signed address of the payslip's original (UI-PAY-2): it opens for five minutes, so it is asked
 * at every opening and never kept.
 */
export async function originalLink(id: string): Promise<string> {
  return (await call(payroll.getPayslipOriginalLink, { params: { id } })).url;
}

/**
 * Opens the original in a new tab. The tab opens at the click, before the address is asked, so a
 * blocker of pop-ups lets it through; it closes again if the address is refused.
 */
export function openOriginal(link: () => Promise<string>): void {
  const tab = window.open("about:blank", "_blank");
  if (!tab) return;
  tab.opener = null;
  link().then(
    (url) => tab.location.replace(url),
    () => tab.close(),
  );
}

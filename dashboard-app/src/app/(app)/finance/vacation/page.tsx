import { redirect } from "next/navigation";

/** The vacation fund's money moved into Budgets (Phase 6); this route stays only as a bookmark redirect. */
export default function VacationFundPage() {
  redirect("/finance/budgets");
}

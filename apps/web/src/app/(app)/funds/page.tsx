import { permanentRedirect } from "next/navigation";
import { withParams } from "@ledgerly/ui/url";
import { appRoute } from "@/platform/route";

/**
 * The old home of Funds (rewrite plan R5b, B1b): the pension funds are a group of Investments, so the
 * address leads to its chip, with the period of the address. The page's own `view` has no twin there.
 */
export default async function FundsHomePage({ searchParams }: PageProps<"/funds">) {
  const query = Object.entries(await searchParams).flatMap(([key, value]) =>
    typeof value === "string" && key !== "view" ? [[key, value] as const] : [],
  );
  permanentRedirect(
    appRoute(withParams("/investments", {}, { ...Object.fromEntries(query), group: "pension_funds" })),
  );
}

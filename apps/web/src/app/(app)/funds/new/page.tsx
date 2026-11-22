import { permanentRedirect } from "next/navigation";
import { withParams } from "@ledgerly/ui/url";
import { appRoute } from "@/platform/route";

/** The old address of "Add pension fund" (rewrite plan R5b, B1b): the steps are in Investments now. */
export default async function NewFundPage({ searchParams }: PageProps<"/funds/new">) {
  const { step } = await searchParams;
  permanentRedirect(
    appRoute(withParams("/investments/new-fund", {}, { step: typeof step === "string" ? step : undefined })),
  );
}

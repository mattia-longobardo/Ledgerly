import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isFundId } from "@/modules/funds/detail";
import { FundError, requireFund } from "@/modules/funds/service";
import { requireSession } from "@/platform/auth/session";

/** Above the page's skeleton, so another person's fund answers a real 404. */
export default async function FundDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const ctx = await requireSession();
  const { id } = await params;
  if (!isFundId(id)) notFound();
  try {
    await requireFund(ctx, id);
  } catch (error) {
    if (error instanceof FundError) notFound();
    throw error;
  }
  return children;
}

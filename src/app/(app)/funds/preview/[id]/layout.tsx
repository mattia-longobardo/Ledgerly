import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isFundId } from "@/modules/funds/detail";
import { fundsHomePreview } from "@/modules/funds/preview";
import { FundError, requireFund } from "@/modules/funds/service";
import { requireSession } from "@/platform/auth/session";

/** Above the page's `loading.tsx`, so another person's fund answers a real 404 and never a skeleton. */
export default async function FundDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  if (!fundsHomePreview()) notFound();
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

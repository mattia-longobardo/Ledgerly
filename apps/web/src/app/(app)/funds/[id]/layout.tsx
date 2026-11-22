import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { isFundId } from "@ledgerly/domain/funds/client";
import { fundNameOf } from "./name";

/** Above the page's skeleton, so another person's fund answers a real 404. */
export default async function FundDetailLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isFundId(id)) notFound();
  await fundNameOf(id);
  return children;
}

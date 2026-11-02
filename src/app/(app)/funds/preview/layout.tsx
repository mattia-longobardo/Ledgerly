import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { fundsHomePreview } from "@/modules/funds/preview";

/** Above the page's `loading.tsx`, so the deployed site answers a real 404 and never a skeleton. */
export default function FundsHomePreviewLayout({ children }: { children: ReactNode }) {
  if (!fundsHomePreview()) notFound();
  return children;
}

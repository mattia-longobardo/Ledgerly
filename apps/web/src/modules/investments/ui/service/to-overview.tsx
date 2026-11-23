"use client";

// A tab a service does not have (a position or a plan of a service kept by value, PERS-335): the
// address goes back to its Overview, where its value and P&L are.
import { useEffect } from "react";
import { useRouter } from "@ledgerly/ui/router";
import type { ServicePage } from "./service-view";

export function ToOverview({ page }: { page: ServicePage }) {
  const router = useRouter();
  const overview = page.href("overview");
  useEffect(() => router.replace(overview), [router, overview]);
  return null;
}

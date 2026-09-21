"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Follows a document being read (spec §7.8: reading starts right after the upload): while `active`,
 * asks the server for the page again every `every` ms, for two minutes at most — the hourly sweep
 * takes over a reading that takes longer.
 */
export function AutoRefresh({ active, every = 1500 }: { active: boolean; every?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (Date.now() - started > 120_000) window.clearInterval(timer);
      else router.refresh();
    }, every);
    return () => window.clearInterval(timer);
  }, [active, every, router]);
  return null;
}

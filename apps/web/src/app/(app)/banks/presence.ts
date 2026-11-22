// src/app/(app)/banks/presence.ts — who is asking, for a reading the person starts themselves
// (rewrite plan, 04-now.md §4.2: "Sync now" sends the `Psu-*` headers). The address is the one
// the reverse proxy reports; the interface shows nothing of this.
import "server-only";
import { z } from "zod";
import type { Presence } from "@ledgerly/plugin-host";

const address = z.union([z.ipv4(), z.ipv6()]);

export function presenceOf(source: Pick<Headers, "get">): Presence {
  const first = (source.get("x-forwarded-for") ?? "").split(",")[0].trim();
  return {
    ip: address.safeParse(first).success ? first : null,
    userAgent: source.get("user-agent")?.slice(0, 400) ?? null,
  };
}

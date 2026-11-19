// The search across modules of the ⌘K palette (spec §8.2): the person's pockets, funds and
// subscriptions by name. Its own file: it belongs to no module. The client writes the hint and the
// link of each match from `kind`.
import { z } from "zod";
import { id } from "./primitives";
import { defineRoute } from "./route";

const RECORD_KINDS = ["pocket", "fund", "subscription"] as const;

export const searchRecords = defineRoute({
  id: "search_records",
  method: "GET",
  path: "/search",
  scope: "read",
  capability: "search",
  summary: "The person's pockets, funds and subscriptions whose name contains the text.",
  actions: ["searchRecordsAction"],
  query: z.object({ q: z.string().max(200) }),
  response: z.object({
    records: z.array(z.object({ kind: z.enum(RECORD_KINDS), id: id(), name: z.string() })),
  }),
  errors: ["invalid"],
  example: {
    query: { q: "holiday" },
    response: { records: [{ kind: "pocket", id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "Holiday" }] },
  },
});

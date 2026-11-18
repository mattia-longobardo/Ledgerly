// src/app/api/mcp/route.ts — the MCP server (docs/auth-design.md D6). Everything it does is in
// `platform/mcp/handler.ts`, with the read tools of `/api/v1` the composition lends it (rewrite plan R2).
import { handleMcp } from "@/platform/mcp/handler";
import { reads } from "../v1/[[...route]]/composition";

export const dynamic = "force-dynamic";

const handler = (request: Request) => handleMcp(request, reads);

export { handler as GET, handler as POST, handler as DELETE, handler as OPTIONS };

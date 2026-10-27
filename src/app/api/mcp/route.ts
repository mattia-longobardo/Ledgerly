// src/app/api/mcp/route.ts — the MCP server (docs/auth-design.md D6). Everything it does is in
// `platform/mcp/handler.ts`; this file exists because Next.js needs a route handler.
import { handleMcp } from "@/platform/mcp/handler";

export const dynamic = "force-dynamic";

export { handleMcp as GET, handleMcp as POST, handleMcp as DELETE, handleMcp as OPTIONS };

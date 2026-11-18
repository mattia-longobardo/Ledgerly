// src/app/api/v1/[[...route]]/route.ts — the only door into /api/v1 (plan F8 §3.4.9). Everything
// it serves is decided by the Hono app; this file exists because Next.js needs a route handler.
import { api } from "./composition";

export const dynamic = "force-dynamic";

const handler = (request: Request) => api.fetch(request);

export { handler as DELETE, handler as GET, handler as PATCH, handler as POST, handler as PUT };

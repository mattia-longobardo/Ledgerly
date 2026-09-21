import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/platform/auth/auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return toNextJsHandler(await getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(await getAuth()).POST(request);
}

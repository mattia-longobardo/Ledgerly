import { ApiError } from "./errors";

export function parseExpectedVersion(input: { ifMatch: string | null; body: unknown }): number {
  const fromHeader = input.ifMatch ? Number(input.ifMatch.replace(/"/g, "")) : Number.NaN;
  if (Number.isInteger(fromHeader)) return fromHeader;
  const v =
    typeof input.body === "object" && input.body !== null
      ? (input.body as { version?: unknown }).version
      : undefined;
  if (typeof v === "number" && Number.isInteger(v)) return v;
  throw new ApiError(428, "version_mismatch", "Send the current version in If-Match or body.version");
}

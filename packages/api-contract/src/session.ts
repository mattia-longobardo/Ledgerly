// The web calls `/api/v1` with its session cookie (03-releases.md §R4: same host, no CORS for the
// web). Every such call carries this header: a page of another origin cannot add it without a CORS
// preflight, which `/api/v1` never answers, so a forged form or link never reaches a route.
export const SESSION_HEADER = "x-ledgerly-session";

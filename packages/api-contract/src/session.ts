// The web's session on `/api/v1` (rewrite plan R4: «il web resta sullo stesso host dell'API:
// cookie di sessione»). A write that comes with the session cookie and no `Authorization` must
// carry this header and an `Origin` equal to the instance's own: a page of another site cannot
// add a custom header without a CORS preflight, and `/api/v1` answers no preflight.
export const SESSION_CSRF_HEADER = "x-ledgerly-csrf";

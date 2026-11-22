// "Accept the invitation" through `POST /api/invite/{token}/accept` (rewrite plan R3, R4): the account
// is created and the invitee signed in by the server, which sets the session's cookie. The answer is
// the refusal's code, or where the browser goes.
import { z } from "zod";

const answer = z.union([
  z.object({ error: z.enum(["invalid", "email_taken", "weak_password", "mismatch", "name"]) }),
  z.object({ next: z.enum(["/", "/sign-in"]) }),
]);

type InviteAnswer = z.infer<typeof answer>;

/** Sends the form; throws when the server answers something else than the route's shape. */
export async function acceptInviteAction(
  token: string,
  input: { name: string; password: string; confirm: string },
): Promise<InviteAnswer> {
  const response = await fetch(`/api/invite/${encodeURIComponent(token)}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    credentials: "same-origin",
    body: JSON.stringify(input),
  });
  return answer.parse(await response.json());
}

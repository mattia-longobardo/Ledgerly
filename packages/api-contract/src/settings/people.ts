// Users and settings · Admin › Users (rewrite plan R2, spec §7.10). Behind the scope `admin` AND the
// admin role: the scope is the second gate, never the first (plan F8 §3.4.8). The refusals that
// keep an instance governable answer `conflict` with their code in `reason` (`last_admin`, `self`,
// `email_taken`).
import { z } from "zod";
import { defineRoute } from "../route";
import { id, instant } from "../primitives";

const role = z.enum(["admin", "user"]);

const person = z.object({
  /** A user, or an invitation still waiting to be accepted. */
  kind: z.enum(["user", "invitation"]),
  id: id(),
  name: z.string(),
  email: z.string(),
  method: z.enum(["password", "sso", "both", "none", "invited"]),
  role,
  lastSignInAt: instant().nullable(),
  status: z.enum(["active", "blocked", "pending", "expired"]),
  /** The admin who asked: their own row offers no block and no removal. */
  self: z.boolean(),
  twoFactor: z.boolean(),
});

const PERSON_ID = "5a9e2c41-7b3d-4f8e-a1c2-3d4e5f6a7b8c";

export const listPeople = defineRoute({
  id: "list_people",
  method: "GET",
  path: "/people",
  scope: "admin",
  capability: "people",
  summary: "Everyone who can reach the instance: the users, then the invitations still outstanding.",
  actions: [],
  response: z.object({ people: z.array(person) }),
  errors: [],
  example: {
    response: {
      people: [
        {
          kind: "user",
          id: PERSON_ID,
          name: "Alex Example",
          email: "alex@example.test",
          method: "sso",
          role: "admin",
          lastSignInAt: "2026-11-18T08:00:00.000Z",
          status: "active",
          self: true,
          twoFactor: false,
        },
      ],
    },
  },
});

export const invitePerson = defineRoute({
  id: "invite_person",
  method: "POST",
  path: "/people/invitations",
  scope: "admin",
  capability: "people",
  summary: "Invites a person by email. `outcome` says whether the email left, or why it did not.",
  actions: [],
  body: z.object({ email: z.email(), role }).strict(),
  response: z.object({ outcome: z.enum(["sent", "mail_off", "mail_failed"]) }),
  status: 201,
  errors: ["invalid", "conflict"],
  example: { body: { email: "sam@example.test", role: "user" }, response: { outcome: "sent" } },
});

export const revokeInvitation = defineRoute({
  id: "revoke_invitation",
  method: "DELETE",
  path: "/people/invitations/{id}",
  scope: "admin",
  capability: "people",
  summary: "Withdraws an invitation: its link stops working.",
  actions: [],
  params: z.object({ id: id() }),
  response: null,
  status: 204,
  errors: ["invalid", "not_found"],
  example: { params: { id: PERSON_ID } },
});

export const updatePerson = defineRoute({
  id: "update_person",
  method: "PATCH",
  path: "/people/{id}",
  scope: "admin",
  capability: "people",
  summary: "Changes a person's role or blocks them. The last admin and the admin who asks are refused.",
  actions: [],
  params: z.object({ id: id() }),
  body: z
    .object({ role: role.optional(), blocked: z.boolean().optional() })
    .strict()
    .refine((input) => input.role !== undefined || input.blocked !== undefined),
  response: null,
  status: 204,
  errors: ["invalid", "not_found", "conflict"],
  example: { params: { id: PERSON_ID }, body: { role: "user" } },
});

export const sendPersonReset = defineRoute({
  id: "send_person_reset",
  method: "POST",
  path: "/people/{id}/password-reset",
  scope: "admin",
  capability: "people",
  summary: "Emails a person a link to choose a new password.",
  actions: [],
  params: z.object({ id: id() }),
  response: z.object({ outcome: z.enum(["sent", "sso_only", "mail_off"]) }),
  errors: ["invalid", "not_found"],
  example: { params: { id: PERSON_ID }, response: { outcome: "sent" } },
});

export const resetPersonTwoFactor = defineRoute({
  id: "reset_person_two_factor",
  method: "DELETE",
  path: "/people/{id}/two-factor",
  scope: "admin",
  capability: "people",
  summary: "Turns a person's two-factor sign-in off, for a lost device.",
  actions: [],
  params: z.object({ id: id() }),
  response: null,
  status: 204,
  errors: ["invalid", "not_found"],
  example: { params: { id: PERSON_ID } },
});

export const removePerson = defineRoute({
  id: "remove_person",
  method: "DELETE",
  path: "/people/{id}",
  scope: "admin",
  capability: "people",
  summary: "Deletes a person and everything they own. The last admin and the admin who asks are refused.",
  actions: [],
  params: z.object({ id: id() }),
  response: null,
  status: 204,
  errors: ["invalid", "not_found", "conflict"],
  example: { params: { id: PERSON_ID } },
});

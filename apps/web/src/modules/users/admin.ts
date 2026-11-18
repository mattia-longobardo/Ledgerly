// Admin › Users (spec §7.10): the use cases are platform/auth's, shared with `/api/v1/people`
// (rewrite plan R2). The Server Actions and the page read them from here.
export {
  AdminError,
  invitePerson,
  listPeople,
  removePerson,
  resetPersonTwoFactor,
  revokeInvitation,
  sendPersonReset,
  setPersonBlocked,
  setPersonRole,
} from "@ledgerly/domain/platform/auth";
export type {
  AdminErrorCode,
  InviteOutcome,
  PersonStatus,
  ResetOutcome,
  SignInMethod,
} from "@ledgerly/domain/platform/auth";

// User-facing email copy. Task 13 moves these strings into the next-intl message catalogue.

export function invitationEmail(url: string) {
  return {
    subject: "You are invited to Finance Dashboard",
    text: `You have been invited to Finance Dashboard.\n\nAccept the invitation within 7 days:\n${url}\n`,
  };
}

export function passwordResetEmail(url: string) {
  return {
    subject: "Reset your Finance Dashboard password",
    text: `Someone asked to reset the password of this account.\n\nChoose a new password within 1 hour:\n${url}\n\nIf it was not you, ignore this email.\n`,
  };
}

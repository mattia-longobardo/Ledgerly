// The public interface of this unit (docs/design/rewrite-plan/10-modularity.md §10.3, rule M7).
export { BACKUP_LAST, EXPORT_LAST, mailAllowed, mailPolicy, readSetting } from "./config";
export type { LlmProbeResult } from "./llm-probe";
export type { OidcProbeOutcome } from "./oidc-probe";
export { issuerOrigin } from "./oidc";
export type { OidcInput } from "./oidc";
export { appSettings } from "./schema";
export {
  SettingsError,
  llmFallbackAvailable,
  llmFallbackView,
  oidcView,
  removeLlmFallback,
  removeOidc,
  removeSmtp,
  saveLlmFallback,
  saveOidc,
  saveSmtp,
  sendTestEmail,
  smtpView,
  testLlmFallback,
  testOidc,
  writeSetting,
} from "./service";
export type { MailProbeResult } from "./service";
export type { MailCategory, SmtpInput } from "./smtp";

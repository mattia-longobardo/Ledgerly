/**
 * The fixture `APP_ENCRYPTION_KEY` a unit test sets when it needs `env()` to
 * parse but does not care what the key actually is. Exported once so a
 * transcription slip doesn't quietly drift between the files that set it —
 * the same reasoning as `ITEST_ENCRYPTION_KEY` in `integration-setup.ts`, for
 * tests that build their own environment instead of using that setup file.
 */
export const TEST_ENCRYPTION_KEY = `unit:${Buffer.alloc(32, 9).toString("base64")}`;

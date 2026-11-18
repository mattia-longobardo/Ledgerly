export function contentSecurityPolicy({
  authOrigin,
  dev,
}: {
  authOrigin: string | null;
  dev: boolean;
}): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    `form-action 'self'${authOrigin ? ` ${authOrigin}` : ""}`,
  ].join("; ");
}

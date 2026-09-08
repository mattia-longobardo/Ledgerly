import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revokeTokenAction } from "@/app/actions/security";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { SettingsSection } from "@/components/ui/SettingsSection";
import { listTokens } from "@/modules/security/application/list-tokens";
import type { TokenRecord } from "@/modules/security/application/ports";
import { runForPrincipal } from "@/modules/security/ui/deps";
import { TokensForm } from "@/modules/security/ui/TokensForm";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";
import { describeCurrentSession } from "../_lib/load-settings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Security" };

/** A missing figure renders as an em dash, never as an invented value. */
const DASH = "—";

function day(value: Date | null): string {
  return value === null ? DASH : value.toISOString().slice(0, 10);
}

function status(token: TokenRecord, now: Date): string {
  if (token.revokedAt !== null) return `Revoked ${day(token.revokedAt)}`;
  if (token.expiresAt !== null && token.expiresAt.getTime() <= now.getTime()) {
    return `Expired ${day(token.expiresAt)}`;
  }
  return "Active";
}

/**
 * One session, honestly labelled (Ruling P2-8). Auth.js still issues JWT
 * sessions, so there is no table to list from — inventing rows here would be
 * worse than showing the one session this request can actually see.
 *
 * The Tokens section below is bare by design (reduced Phase 7–9 conventions):
 * native form, plain table, no design components. The redesign replaces it.
 */
export default async function SecuritySettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const principal = await requirePrincipalOrRedirect();
  const session = describeCurrentSession(await headers());
  const params = await searchParams;
  const error = typeof params.error === "string" ? params.error : null;

  const tokens = await runForPrincipal((deps, p) => listTokens(deps)(p));
  const scopes = [...principal.permissions].sort();
  const now = new Date();

  /**
   * The revoke button is a plain form post, so it works without JavaScript.
   * A failure comes back as `?error=` on this same page — no secret is
   * involved on this path, unlike the create flow (Ruling P8-1).
   */
  async function revoke(formData: FormData): Promise<void> {
    "use server";
    const result = await revokeTokenAction(formData);
    if (!result.ok) redirect(`/settings/security?error=${encodeURIComponent(result.error)}`);
    redirect("/settings/security");
  }

  return (
    <>
      <PageHeader title="Security" />
      <PageGrid className="pt-5">
        <Panel span={6} ariaLabel="Security" bodyClassName="flex flex-col gap-10">
          <SettingsSection
            title="Sessions"
            footnote="This device is the only session this release can see. Listing and revoking every session and two-factor authentication arrive with database sessions; Authentik provides both today."
          >
            <ul className="hairline-t">
              <li className="flex min-h-11 items-center gap-3 py-2 hairline-b">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-fg">{session.userAgent}</span>
                  <span className="num block text-caption text-fg-muted">
                    {session.ip ?? "Address unknown"}
                  </span>
                </span>
                <span className="shrink-0 text-caption text-positive">Current session</span>
              </li>
            </ul>
          </SettingsSection>
        </Panel>
      </PageGrid>

      <section aria-label="Personal access tokens">
        <h2>Tokens</h2>
        <p>
          A personal access token calls the API without a browser session:{" "}
          <code>Authorization: Bearer pat_…</code>. Its scopes can never exceed the permissions you
          hold, and they shrink with them.
        </p>

        {error !== null && <p role="alert">{error}</p>}

        <TokensForm scopes={scopes} />

        <table>
          <caption>Your tokens</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Prefix</th>
              <th scope="col">Scopes</th>
              <th scope="col">Created</th>
              <th scope="col">Expires</th>
              <th scope="col">Last used</th>
              <th scope="col">Status</th>
              <th scope="col">
                <span className="sr-only">Revoke</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tokens.length === 0 && (
              <tr>
                <td colSpan={8}>No tokens yet.</td>
              </tr>
            )}
            {tokens.map((token) => (
              <tr key={token.id}>
                <td>{token.name}</td>
                <td>
                  <code>{token.prefix}</code>
                </td>
                <td>{token.scopes.join(", ")}</td>
                <td>{day(token.createdAt)}</td>
                <td>{day(token.expiresAt)}</td>
                <td>{day(token.lastUsedAt)}</td>
                <td>{status(token, now)}</td>
                <td>
                  {token.revokedAt === null ? (
                    <form action={revoke}>
                      <input type="hidden" name="id" value={token.id} />
                      <button type="submit">Revoke</button>
                    </form>
                  ) : (
                    DASH
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}

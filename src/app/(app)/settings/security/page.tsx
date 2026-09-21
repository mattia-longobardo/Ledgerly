import type { Metadata } from "next";
import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { describeUserAgent } from "@/modules/users/rules";
import { listOwnSessions } from "@/modules/users/service";
import { getAuth } from "@/platform/auth/auth";
import { requireSession } from "@/platform/auth/session";
import { civilDateIn } from "@/platform/dates";
import { formatDate, NULL_DISPLAY } from "@/platform/format";
import { listTokens } from "@/platform/tokens/service";
import { SettingsGrid, SettingsSection } from "@/ui/section";
import { NewToken } from "./new-token";
import { type SessionRow, SessionsList } from "./sessions-list";
import { type TokenRow, TokensTable } from "./tokens-table";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.security")} · ${t("title")}` };
}

export default async function SecurityPage() {
  const ctx = await requireSession();
  const [current, sessions, tokens] = await Promise.all([
    (await getAuth()).api.getSession({ headers: await headers() }),
    listOwnSessions(ctx),
    listTokens(ctx),
  ]);
  const t = await getTranslations("settings");

  const day = (at: Date) => formatDate(civilDateIn(at, ctx.timeZone), "long", ctx.locale);

  const tokenRows: TokenRow[] = tokens.map((token) => ({
    id: token.id,
    name: token.name,
    prefix: token.prefix,
    scopes: token.scopes,
    expires: token.expiresAt ? day(token.expiresAt) : t("tokens.expiry.never"),
    lastUsed: token.lastUsedAt ? day(token.lastUsedAt) : NULL_DISPLAY,
    state: token.state,
  }));

  const rows: SessionRow[] = sessions.map((session) => {
    const { browser, os } = describeUserAgent(session.userAgent);
    const isCurrent = session.id === current?.session.id;
    return {
      id: session.id,
      device: browser && os ? `${browser} · ${os}` : t("sessions.unknownDevice"),
      detail: [session.ipAddress, isCurrent && t("sessions.thisDevice")].filter(Boolean).join(" · "),
      status: isCurrent ? t("sessions.activeNow") : t("sessions.since", { date: day(session.createdAt) }),
      current: isCurrent,
    };
  });

  return (
    <SettingsGrid>
      <SettingsSection
        title={t("tokens.title")}
        description={t("tokens.description")}
        action={<NewToken />}
        padded={false}
      >
        <TokensTable tokens={tokenRows} />
      </SettingsSection>
      <SettingsSection title={t("sessions.title")} description={t("sessions.description")} padded={false}>
        <SessionsList sessions={rows} />
      </SettingsSection>
    </SettingsGrid>
  );
}

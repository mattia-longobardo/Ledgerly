import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { listPeople } from "@/modules/users/admin";
import { initialsOf } from "@/modules/users/rules";
import { InvitePerson } from "@/modules/users/ui/invite-person";
import { PeopleTable, type PersonView } from "@/modules/users/ui/people-table";
import { requireAdmin } from "@/platform/auth/session";
import { civilDateIn } from "@/platform/dates";
import { formatDate, NULL_DISPLAY } from "@/platform/format";
import { SettingsGrid, SettingsSection } from "@/ui/section";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settings");
  return { title: `${t("tabs.users")} · ${t("title")}` };
}

/** Admin › Users (spec §7.10): who may sign in, how, and with what role. */
export default async function SettingsUsersPage() {
  const ctx = await requireAdmin();
  const [t, people] = await Promise.all([getTranslations("settings.people"), listPeople(ctx)]);

  const rows: PersonView[] = people.map((person) => ({
    kind: person.kind,
    id: person.id,
    name: person.name,
    initials: initialsOf(person.name, person.email),
    email: person.email,
    method: person.method,
    role: person.role,
    lastSignIn: person.lastSignInAt
      ? formatDate(civilDateIn(person.lastSignInAt, ctx.timeZone), "long", ctx.locale)
      : NULL_DISPLAY,
    status: person.status,
    self: person.self,
  }));

  return (
    <SettingsGrid>
      <SettingsSection
        title={t("title")}
        description={t("description")}
        action={<InvitePerson />}
        padded={false}
      >
        <PeopleTable people={rows} />
      </SettingsSection>
    </SettingsGrid>
  );
}

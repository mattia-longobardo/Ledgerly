"use client";

// Admin › Users, read from `/api/v1/people` (rewrite plan R3): who may sign in, how, and with what role.
import { useTranslations } from "next-intl";
import { SETTINGS } from "@ledgerly/api-contract";
import { civilDateIn } from "@ledgerly/format/dates";
import { formatDate, NULL_DISPLAY } from "@ledgerly/format/format";
import { useApi } from "@ledgerly/ui/data";
import { initialsOf } from "@ledgerly/ui/initials";
import { Loaded } from "@ledgerly/ui/loaded";
import { SettingsGrid, SettingsSection } from "@ledgerly/ui/section";
import { InvitePerson } from "@/modules/users/ui/invite-person";
import { PeopleTable, type PersonView } from "@/modules/users/ui/people-table";

const { people, profile } = SETTINGS;

export function UsersScreen() {
  const text = useTranslations("settings.people");
  const preferences = useApi(profile.getPreferences, {});
  const list = useApi(people.listPeople, {});
  return (
    <SettingsGrid>
      <SettingsSection
        title={text("title")}
        description={text("description")}
        action={<InvitePerson />}
        padded={false}
      >
        <Loaded state={preferences}>
          {(prefs) => (
            <Loaded state={list}>
              {({ people: everyone }) => {
                const rows: PersonView[] = everyone.map((person) => ({
                  kind: person.kind,
                  id: person.id,
                  name: person.name,
                  initials: initialsOf(person.name, person.email),
                  email: person.email,
                  method: person.method,
                  role: person.role,
                  lastSignIn: person.lastSignInAt
                    ? formatDate(
                        civilDateIn(new Date(person.lastSignInAt), prefs.timeZone),
                        "long",
                        prefs.locale,
                      )
                    : NULL_DISPLAY,
                  status: person.status,
                  self: person.self,
                  twoFactor: person.twoFactor,
                }));
                return <PeopleTable people={rows} />;
              }}
            </Loaded>
          )}
        </Loaded>
      </SettingsSection>
    </SettingsGrid>
  );
}

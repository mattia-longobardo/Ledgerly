// The screens of R3 in the static package: Settings › Profile and Users, and what hangs off an account.
// They are the web app's own screens, mounted in the shell of `packages/ui` with the router of the
// package; nothing here reads or computes a figure of its own.
import type { ReactNode } from "react";
import { useTranslations } from "use-intl";
import { accounts } from "@ledgerly/api-contract/accounts";
import { useApi } from "@ledgerly/ui/data";
import { Loaded } from "@ledgerly/ui/loaded";
import { Link } from "@ledgerly/ui/router";
import { SectionTabs, SectionTitle } from "@ledgerly/ui/section-tabs";
import { Page } from "@ledgerly/ui/shell/page";
import { ShellProvider } from "@ledgerly/ui/shell/shell-context";
import { useSaveTheme, useShellLabels } from "@ledgerly/ui/shell/shell-labels";
import { Toaster } from "@ledgerly/ui/toast";
import { UnsavedChangesProvider } from "@ledgerly/ui/unsaved-changes";
import { ConnectionsSection } from "@/modules/accounts/ui/connections";
import { ProfileScreen } from "@/app/(app)/settings/profile/profile-screen";
import { UsersScreen } from "@/app/(app)/settings/users/users-screen";
import { useLocation } from "./router";

/** The session ends on the instance, as the web app's auth client ends it. */
async function signOut() {
  await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin" });
  window.location.assign("/");
}

const SETTINGS_TABS = ["profile", "users"] as const;

function Settings({ children }: { children: ReactNode }) {
  const text = useTranslations("settings");
  const tabs = SETTINGS_TABS.map((tab) => ({ href: `/settings/${tab}`, label: text(`tabs.${tab}`) }));
  return (
    <Page title={<SectionTitle tabs={tabs} />} parent={{ href: "/settings/profile", label: text("title") }}>
      <div className="flex w-full flex-col gap-4">
        <h1 className="text-title font-semibold tracking-title max-md:sr-only">{text("title")}</h1>
        <SectionTabs label={text("tabs.label")} tabs={tabs} />
        <UnsavedChangesProvider>{children}</UnsavedChangesProvider>
      </div>
    </Page>
  );
}

/** The accounts as `GET /accounts` lists them: the way to an account's page. */
function Accounts() {
  const text = useTranslations("accounts");
  const list = useApi(accounts.listAccounts, {});
  return (
    <Page title={text("title")}>
      <h1 className="text-title font-semibold tracking-title">{text("title")}</h1>
      <Loaded state={list}>
        {(answer) => (
          <ul className="flex flex-col gap-2">
            {answer.accounts.map((account) => (
              <li key={account.id}>
                <Link
                  href={`/accounts/${account.id}`}
                  className="focus-ring rounded-xs font-medium hover:underline"
                >
                  {account.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Loaded>
    </Page>
  );
}

function Account({ id }: { id: string }) {
  const text = useTranslations("accounts");
  const account = useApi(accounts.getAccount, { params: { id } });
  return (
    <Page title={account.data?.name ?? text("title")} parent={{ href: "/accounts", label: text("title") }}>
      <UnsavedChangesProvider>
        <ConnectionsSection accountId={id} />
      </UnsavedChangesProvider>
    </Page>
  );
}

function Screen() {
  const path = useLocation().split("?")[0];
  const account = /^\/accounts\/([0-9a-f-]{36})$/.exec(path);
  if (path === "/settings/users")
    return (
      <Settings>
        <UsersScreen />
      </Settings>
    );
  if (path === "/accounts") return <Accounts />;
  if (account) return <Account id={account[1]} />;
  return (
    <Settings>
      <ProfileScreen />
    </Settings>
  );
}

export function App() {
  const text = useTranslations();
  const labels = useShellLabels();
  const saveTheme = useSaveTheme();
  return (
    <ShellProvider initialSidebar="auto" labels={labels} saveTheme={saveTheme} signOut={signOut}>
      <div className="flex h-dvh flex-col overflow-y-auto">
        <Screen />
      </div>
      <Toaster closeLabel={text("common.close")} />
    </ShellProvider>
  );
}

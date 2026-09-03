import Link from "next/link";
import { PageGrid, Panel } from "@/components/layout/PageGrid";
import { PageHeader } from "@/components/layout/PageHeader";
import { requirePrincipalOrRedirect } from "@/platform/auth/require-principal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Management" };

const SECTIONS = [
  {
    href: "/finance/management/accounts",
    title: "Accounts",
    description: "Groups, and the archived accounts kept out of the main list.",
  },
] as const;

export default async function ManagementPage() {
  await requirePrincipalOrRedirect();

  return (
    <>
      <PageHeader title="Management" />
      <PageGrid className="pt-5">
        <Panel span={12} ariaLabel="Management sections">
          <ul className="hairline-t">
            {SECTIONS.map((section) => (
              <li key={section.href}>
                <Link
                  href={section.href}
                  className="flex min-h-11 items-center gap-3 py-3 hairline-b transition-colors hover:bg-surface-hover"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-body text-fg">
                      {section.title}
                    </span>
                    <span className="block text-body-sm text-fg-muted">
                      {section.description}
                    </span>
                  </span>
                  <span
                    aria-hidden
                    className="shrink-0 text-body-sm text-accent"
                  >
                    Open &rarr;
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      </PageGrid>
    </>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { Role } from "@ledgerly/domain/platform/context";
import { Badge } from "@ledgerly/ui/badge";
import { Button } from "@ledgerly/ui/button";
import { Modal } from "@ledgerly/ui/modal";
import { Select } from "@ledgerly/ui/input";
import { DataTable } from "@ledgerly/ui/data-table";
import { notify } from "@ledgerly/ui/toast";
import type { AdminErrorCode, PersonStatus, SignInMethod } from "../admin";
import {
  removePersonAction,
  resetPersonTwoFactorAction,
  revokeInvitationAction,
  sendPersonResetAction,
  setPersonBlockedAction,
  setPersonRoleAction,
} from "../calls";

/** One row of the table, already formatted in the reader's language and time zone. */
export interface PersonView {
  kind: "user" | "invitation";
  id: string;
  name: string;
  initials: string;
  email: string;
  method: SignInMethod;
  role: Role;
  lastSignIn: string;
  status: PersonStatus;
  /** The admin reading the page: their own row offers no block and no remove (plan F8 §3.4.1). */
  self: boolean;
  /** TOTP is on: the row offers "Reset 2FA" (docs/auth-design.md D2). */
  twoFactor: boolean;
}

type ActionAnswer = { ok: true; outcome: unknown } | { ok: false; error: AdminErrorCode };

const STATUS_TONE = {
  active: "pos",
  blocked: "neg",
  pending: "accent",
  expired: "neutral",
} as const;

/** The row's role selector, in the table and in the list below it. */
function RoleSelect({
  person,
  pending,
  onChange,
}: {
  person: PersonView;
  pending: boolean;
  onChange: (person: PersonView, role: Role) => void;
}) {
  const t = useTranslations("settings.people");
  return (
    <Select
      aria-label={t("roleFor", { name: person.name || person.email })}
      className="h-6 w-auto text-sm"
      defaultValue={person.role}
      disabled={pending}
      onChange={(event) => onChange(person, event.currentTarget.value as Role)}
    >
      <option value="admin">{t("roles.admin")}</option>
      <option value="user">{t("roles.user")}</option>
    </Select>
  );
}

/**
 * What a row offers. An invitation can only be withdrawn; a person can be sent a reset link, and —
 * unless they are the admin reading the page — blocked and removed (plan F8 §3.4.1).
 */
function RowActions({
  person,
  pending,
  onReset,
  onResetTwoFactor,
  onBlock,
  onRevoke,
  onRemove,
}: {
  person: PersonView;
  pending: boolean;
  onReset: (person: PersonView) => void;
  onResetTwoFactor: (person: PersonView) => void;
  onBlock: (person: PersonView) => void;
  onRevoke: (person: PersonView) => void;
  onRemove: (person: PersonView) => void;
}) {
  const t = useTranslations("settings.people");
  if (person.kind === "invitation") {
    return (
      <Button size="xs" variant="danger" disabled={pending} onClick={() => onRevoke(person)}>
        {t("revokeInvitation")}
      </Button>
    );
  }
  return (
    <>
      <Button size="xs" disabled={pending} onClick={() => onReset(person)}>
        {t("resetPassword")}
      </Button>
      {person.twoFactor && !person.self && (
        <Button size="xs" disabled={pending} onClick={() => onResetTwoFactor(person)}>
          {t("resetTwoFactor")}
        </Button>
      )}
      {!person.self && (
        <Button size="xs" disabled={pending} onClick={() => onBlock(person)}>
          {person.status === "blocked" ? t("unblock") : t("block")}
        </Button>
      )}
      {!person.self && (
        <Button size="xs" variant="danger" disabled={pending} onClick={() => onRemove(person)}>
          {t("remove")}
        </Button>
      )}
    </>
  );
}

/** Admin › Users (spec §7.10, design rows 870–877). */
export function PeopleTable({ people }: { people: PersonView[] }) {
  const t = useTranslations("settings.people");
  const [pending, startTransition] = useTransition();
  const [removing, setRemoving] = useState<PersonView | null>(null);
  const [resettingTwoFactor, setResettingTwoFactor] = useState<PersonView | null>(null);

  function run(action: () => Promise<ActionAnswer>, success: string) {
    startTransition(async () => {
      const result = await action();
      notify(result.ok ? success : t(`errors.${result.error}`), result.ok ? "success" : "error");
    });
  }

  function onRole(person: PersonView, role: Role) {
    run(() => setPersonRoleAction(person.id, role), t("roleSaved"));
  }

  function onBlock(person: PersonView) {
    run(
      () => setPersonBlockedAction(person.id, person.status !== "blocked"),
      person.status === "blocked" ? t("unblocked") : t("blockedNow"),
    );
  }

  function onRevoke(person: PersonView) {
    run(() => revokeInvitationAction(person.id), t("invitationRevoked"));
  }

  function onReset(person: PersonView) {
    startTransition(async () => {
      const result = await sendPersonResetAction(person.id);
      if (!result.ok) {
        notify(t(`errors.${result.error}`), "error");
        return;
      }
      notify(t(`reset.${result.outcome}`), result.outcome === "sent" ? "success" : "error");
    });
  }

  /** The person's initials and name, or «invited» for an invitation not yet accepted. */
  const who = (person: PersonView) => (
    <span className="flex min-w-0 items-center gap-2">
      <span
        aria-hidden
        className="grid size-[22px] shrink-0 place-items-center rounded-full bg-soft text-micro font-semibold text-accent"
      >
        {person.initials}
      </span>
      <span className="max-w-44 truncate font-medium">
        {person.kind === "user" ? person.name : t("invitedPerson")}
      </span>
    </span>
  );

  return (
    <>
      <DataTable
        testIds={{ table: "people-table", list: "people-list" }}
        rows={people}
        rowKey={(person) => `${person.kind}-${person.id}`}
        rowClassName="h-9"
        columns={[
          { key: "user", header: t("columns.user"), cell: who, card: "title" },
          {
            key: "email",
            header: t("columns.email"),
            cell: (person) => <span title={person.email}>{person.email}</span>,
            muted: true,
            className: "max-w-56 truncate text-sm",
          },
          {
            key: "method",
            header: t("columns.method"),
            cell: (person) => t(`methods.${person.method}`),
            muted: true,
            className: "text-sm",
            card: "labelled",
          },
          {
            key: "role",
            header: t("columns.role"),
            card: "action",
            cell: (person) =>
              person.kind === "user" ? (
                <RoleSelect person={person} pending={pending} onChange={onRole} />
              ) : (
                <span className="text-sm text-muted">{t(`roles.${person.role}`)}</span>
              ),
          },
          {
            key: "lastSignIn",
            header: t("columns.lastSignIn"),
            cell: (person) => person.lastSignIn,
            muted: true,
            className: "text-sm",
            card: "labelled",
          },
          {
            key: "status",
            header: t("columns.status"),
            card: "action",
            cell: (person) => (
              <Badge tone={STATUS_TONE[person.status]}>{t(`statuses.${person.status}`)}</Badge>
            ),
          },
          {
            key: "actions",
            header: t("columns.actions"),
            hiddenHeader: true,
            align: "right",
            card: "action",
            cell: (person) => (
              // Wraps rather than widening the table: three buttons side by side are wider than the
              // column has, and a row that grows a line taller is better than a table past the window.
              <div className="inline-flex flex-wrap justify-end gap-1 whitespace-normal">
                <RowActions
                  person={person}
                  pending={pending}
                  onReset={onReset}
                  onResetTwoFactor={setResettingTwoFactor}
                  onBlock={onBlock}
                  onRevoke={onRevoke}
                  onRemove={setRemoving}
                />
              </div>
            ),
          },
        ]}
      />
      <Modal
        open={resettingTwoFactor !== null}
        onOpenChange={(next) => !next && setResettingTwoFactor(null)}
        title={t("resetTwoFactorTitle")}
        description={
          resettingTwoFactor ? t("resetTwoFactorWarning", { email: resettingTwoFactor.email }) : undefined
        }
        width={440}
        footer={
          <>
            <Button onClick={() => setResettingTwoFactor(null)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                const person = resettingTwoFactor;
                if (!person) return;
                setResettingTwoFactor(null);
                run(
                  () => resetPersonTwoFactorAction(person.id),
                  t("twoFactorReset", { email: person.email }),
                );
              }}
            >
              {t("resetTwoFactor")}
            </Button>
          </>
        }
      >
        <p className="text-muted">{t("resetTwoFactorDetail")}</p>
      </Modal>
      <Modal
        open={removing !== null}
        onOpenChange={(next) => !next && setRemoving(null)}
        title={t("removeTitle")}
        description={removing ? t("removeWarning", { email: removing.email }) : undefined}
        width={440}
        footer={
          <>
            <Button onClick={() => setRemoving(null)} disabled={pending}>
              {t("cancel")}
            </Button>
            <Button
              variant="danger"
              disabled={pending}
              onClick={() => {
                const person = removing;
                if (!person) return;
                setRemoving(null);
                run(() => removePersonAction(person.id), t("removed", { email: person.email }));
              }}
            >
              {t("remove")}
            </Button>
          </>
        }
      >
        <p className="text-muted">{t("removeDetail")}</p>
      </Modal>
    </>
  );
}

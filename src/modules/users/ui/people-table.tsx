"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import type { Role } from "@/platform/context";
import { Badge } from "@/ui/badge";
import { Button } from "@/ui/button";
import { Modal } from "@/ui/modal";
import { Select } from "@/ui/input";
import { Table, TBody, Td, Th, THead, Tr } from "@/ui/table";
import { notify } from "@/ui/toast";
import type { AdminErrorCode, PersonStatus, SignInMethod } from "../admin";
import {
  removePersonAction,
  revokeInvitationAction,
  sendPersonResetAction,
  setPersonBlockedAction,
  setPersonRoleAction,
} from "../actions";

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
  onBlock,
  onRevoke,
  onRemove,
}: {
  person: PersonView;
  pending: boolean;
  onReset: (person: PersonView) => void;
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

  return (
    <>
      {/* Seven columns do not fit a phone at any font size, so below `md` the same rows are a
          list instead — the shape `funds` already uses for its own wide table. */}
      <div data-testid="people-table" className="overflow-x-auto max-md:hidden">
        <Table>
          <THead>
            <Th>{t("columns.user")}</Th>
            <Th>{t("columns.email")}</Th>
            <Th>{t("columns.method")}</Th>
            <Th>{t("columns.role")}</Th>
            <Th>{t("columns.lastSignIn")}</Th>
            <Th>{t("columns.status")}</Th>
            <Th align="right">
              <span className="sr-only">{t("columns.actions")}</span>
            </Th>
          </THead>
          <TBody>
            {people.map((person) => (
              <Tr key={`${person.kind}-${person.id}`} className="h-9">
                <Td>
                  <div className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="grid size-[22px] shrink-0 place-items-center rounded-full bg-soft text-micro font-semibold text-accent"
                    >
                      {person.initials}
                    </span>
                    <span className="max-w-44 truncate font-medium">
                      {person.kind === "user" ? person.name : t("invitedPerson")}
                    </span>
                  </div>
                </Td>
                <Td muted className="max-w-56 truncate text-sm" title={person.email}>
                  {person.email}
                </Td>
                <Td muted className="text-sm">
                  {t(`methods.${person.method}`)}
                </Td>
                <Td>
                  {person.kind === "user" ? (
                    <RoleSelect person={person} pending={pending} onChange={onRole} />
                  ) : (
                    <span className="text-sm text-muted">{t(`roles.${person.role}`)}</span>
                  )}
                </Td>
                <Td muted className="text-sm">
                  {person.lastSignIn}
                </Td>
                <Td>
                  <Badge tone={STATUS_TONE[person.status]}>{t(`statuses.${person.status}`)}</Badge>
                </Td>
                <Td align="right">
                  {/* Wraps rather than widening the table: three buttons side by side are wider
                      than the column has, and a row that grows a line taller is better than a
                      table that reaches past the window. */}
                  <div className="inline-flex flex-wrap justify-end gap-1 whitespace-normal">
                    <RowActions
                      person={person}
                      pending={pending}
                      onReset={onReset}
                      onBlock={onBlock}
                      onRevoke={onRevoke}
                      onRemove={setRemoving}
                    />
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>

      {/* The same rows on a phone: the name with its address under it, the status beside it, and
          the very same controls — nothing is hidden here that a wider screen offers. */}
      <ul data-testid="people-list" className="flex flex-col md:hidden">
        {people.map((person) => (
          <li
            key={`${person.kind}-${person.id}`}
            className="flex flex-col gap-2 border-b border-border px-4 py-3 last:border-0"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="grid size-[22px] shrink-0 place-items-center rounded-full bg-soft text-micro font-semibold text-accent"
                >
                  {person.initials}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-medium">
                    {person.kind === "user" ? person.name : t("invitedPerson")}
                  </span>
                  <span className="truncate text-sm text-muted">{person.email}</span>
                </span>
              </div>
              <Badge tone={STATUS_TONE[person.status]}>{t(`statuses.${person.status}`)}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted">
                {t(`methods.${person.method}`)} · {person.lastSignIn}
              </span>
              {person.kind === "user" ? (
                <RoleSelect person={person} pending={pending} onChange={onRole} />
              ) : (
                <span className="text-sm text-muted">{t(`roles.${person.role}`)}</span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <RowActions
                person={person}
                pending={pending}
                onReset={onReset}
                onBlock={onBlock}
                onRevoke={onRevoke}
                onRemove={setRemoving}
              />
            </div>
          </li>
        ))}
      </ul>
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

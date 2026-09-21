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
      {/* The design's own container scrolls sideways: seven columns do not fit a phone, and a
          table that hides its actions is worse than one that has to be dragged. */}
      <div className="overflow-x-auto">
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
                      className="grid size-[22px] place-items-center rounded-full bg-soft text-micro font-semibold text-accent"
                    >
                      {person.initials}
                    </span>
                    <span className="font-medium">
                      {person.kind === "user" ? person.name : t("invitedPerson")}
                    </span>
                  </div>
                </Td>
                <Td muted className="text-sm">
                  {person.email}
                </Td>
                <Td muted className="text-sm">
                  {t(`methods.${person.method}`)}
                </Td>
                <Td>
                  {person.kind === "user" ? (
                    <Select
                      aria-label={t("roleFor", { name: person.name || person.email })}
                      className="h-6 w-auto text-sm"
                      defaultValue={person.role}
                      disabled={pending}
                      onChange={(event) =>
                        run(
                          () => setPersonRoleAction(person.id, event.currentTarget.value as Role),
                          t("roleSaved"),
                        )
                      }
                    >
                      <option value="admin">{t("roles.admin")}</option>
                      <option value="user">{t("roles.user")}</option>
                    </Select>
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
                  <div className="inline-flex gap-1.5 whitespace-nowrap">
                    {person.kind === "invitation" ? (
                      <Button
                        size="xs"
                        variant="danger"
                        disabled={pending}
                        onClick={() => run(() => revokeInvitationAction(person.id), t("invitationRevoked"))}
                      >
                        {t("revokeInvitation")}
                      </Button>
                    ) : (
                      <>
                        <Button size="xs" disabled={pending} onClick={() => onReset(person)}>
                          {t("resetPassword")}
                        </Button>
                        {!person.self && (
                          <Button
                            size="xs"
                            disabled={pending}
                            onClick={() =>
                              run(
                                () => setPersonBlockedAction(person.id, person.status !== "blocked"),
                                person.status === "blocked" ? t("unblocked") : t("blockedNow"),
                              )
                            }
                          >
                            {person.status === "blocked" ? t("unblock") : t("block")}
                          </Button>
                        )}
                        {!person.self && (
                          <Button
                            size="xs"
                            variant="danger"
                            disabled={pending}
                            onClick={() => setRemoving(person)}
                          >
                            {t("remove")}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </Td>
              </Tr>
            ))}
          </TBody>
        </Table>
      </div>
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

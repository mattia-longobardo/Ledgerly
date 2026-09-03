"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createGroupAction,
  deleteGroupAction,
  renameGroupAction,
} from "@/app/actions/accounts";
import { ErrorInline } from "@/components/ui/ErrorInline";
import { cn } from "@/components/ui/cn";

export interface GroupRow {
  id: string;
  name: string;
}

const FIELD =
  "min-h-11 flex-1 rounded-md border border-border bg-surface px-3 text-body text-fg";
const ROW_ACTION =
  "inline-flex min-h-11 items-center rounded-xs px-2 text-body-sm font-medium";

export function GroupsManager({ groups }: { groups: readonly GroupRow[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function startEdit(group: GroupRow) {
    setError(null);
    setEditingId(group.id);
    setEditingName(group.name);
  }

  function saveEdit() {
    if (editingId === null) return;
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", editingId);
      formData.set("name", editingName);
      const result = await renameGroupAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setEditingId(null);
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", id);
      const result = await deleteGroupAction(formData);
      setConfirmingId(null);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function addGroup() {
    setError(null);
    startTransition(async () => {
      const formData = new FormData();
      formData.set("name", newName);
      const result = await createGroupAction(formData);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setNewName("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3">
      {error !== null && <ErrorInline message={error} />}

      {groups.length === 0 ? (
        <p className="text-body-sm text-fg-muted">
          No groups yet. Accounts without a group show as ungrouped.
        </p>
      ) : (
        <ul className="hairline-t">
          {groups.map((group) => (
            <li
              key={group.id}
              className="flex min-h-11 items-center gap-3 py-2 hairline-b"
            >
              {editingId === group.id ? (
                <>
                  <input
                    value={editingName}
                    onChange={(event) => setEditingName(event.target.value)}
                    aria-label="Group name"
                    autoFocus
                    className={FIELD}
                  />
                  <button
                    type="button"
                    disabled={pending || editingName.trim() === ""}
                    onClick={saveEdit}
                    className={cn(
                      ROW_ACTION,
                      "text-accent disabled:opacity-40",
                    )}
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setEditingId(null)}
                    className={cn(ROW_ACTION, "text-fg-muted")}
                  >
                    Cancel
                  </button>
                </>
              ) : confirmingId === group.id ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-body text-fg">
                    {group.name}
                  </span>
                  <span className="text-body-sm text-fg-muted">
                    Delete this group?
                  </span>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => remove(group.id)}
                    className={cn(
                      ROW_ACTION,
                      "text-negative disabled:opacity-40",
                    )}
                  >
                    Confirm delete
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => setConfirmingId(null)}
                    className={cn(ROW_ACTION, "text-fg-muted")}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 truncate text-body text-fg">
                    {group.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => startEdit(group)}
                    className={cn(ROW_ACTION, "text-accent")}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingId(group.id)}
                    className={cn(ROW_ACTION, "text-negative")}
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          addGroup();
        }}
        className="flex items-center gap-2 pt-2"
      >
        <input
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="New group name"
          aria-label="New group name"
          autoComplete="off"
          className={FIELD}
        />
        <button
          type="submit"
          disabled={pending || newName.trim() === ""}
          className="inline-flex min-h-11 items-center justify-center rounded-md bg-accent px-4 text-body-sm font-medium text-accent-contrast disabled:opacity-40"
        >
          Add group
        </button>
      </form>

      <p className="text-body-sm text-fg-muted">
        Deleting a group ungroups its accounts; it never deletes them.
      </p>
    </div>
  );
}

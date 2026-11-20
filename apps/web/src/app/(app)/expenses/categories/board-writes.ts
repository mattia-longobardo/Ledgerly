// The writes of the board of the categories (categories-and-rules.md §5.5, §5.6) on `/api/v1`: each one
// says what it did in a toast, with «Undo» where the plan has one, or names the refusal in the open
// dialog. Each call drops the answers it changes from the cache: the board reads them again.
import { useTranslations } from "next-intl";
import { useTransition } from "react";
import { NAME_MAX } from "@ledgerly/domain/transactions/client";
import {
  archiveCategory,
  type CategoryFormInput,
  createCategory,
  mergeCategories,
  moveCategory,
  restoreCategories,
  saveCategory,
  undoMerge,
} from "@/modules/transactions";
import { notify } from "@ledgerly/ui/toast";
import type { BoardLine, Macro } from "./board-model";

type Outcome = { ok: true } | { ok: false; error: string };

interface WriteContext {
  text: ReturnType<typeof useTranslations<"expenses.categories">>;
  settingsText: ReturnType<typeof useTranslations<"settings.categories">>;
  lines: readonly BoardLine[];
  run: (work: () => Promise<void>) => void;
  /** After a write: the dialog closes. */
  done: () => void;
  fail: (message: string) => void;
}

/** What the board's state gives the writes. */
interface BoardState {
  lines: readonly BoardLine[];
  close: () => void;
  fail: (message: string) => void;
}

function messageFor(write: WriteContext, code: string, name = "", where = ""): string {
  if (code === "duplicate") return write.text("errors.duplicate", { name, group: where });
  if (code === "invalid") return write.settingsText("errors.invalid", { max: NAME_MAX });
  if (code === "not_found") return write.settingsText("errors.notFound");
  if (code === "invalid_parent") return write.settingsText("errors.invalidParent");
  return write.settingsText("errors.failed");
}

/** The group a line sits in, or its macro: where a name is a duplicate. */
export function whereOf(
  text: WriteContext["text"],
  lines: readonly BoardLine[],
  line: { parentId: string | null; type: Macro },
): string {
  const group = line.parentId === null ? undefined : lines.find((one) => one.id === line.parentId);
  return group?.name ?? text(`macro.${line.type}`);
}

/** A toast with «Undo»: the undo's own toast says whether it worked. */
function undoable(write: WriteContext, message: string, undo: () => Promise<Outcome>, failure?: string) {
  notify(message, "success", {
    label: write.text("undo"),
    onClick: () =>
      void undo().then((undone) => {
        notify(
          undone.ok ? write.text("undone") : (failure ?? messageFor(write, undone.error)),
          undone.ok ? "success" : "error",
        );
      }),
  });
}

/** Name, group, type and colour as `updateCategory` wants them, with one of them changed. */
function inputOf(line: BoardLine, changes: { name?: string; color?: string | null }): CategoryFormInput {
  return {
    name: changes.name ?? line.name,
    parentId: line.parentId ?? "",
    type: line.type,
    // A sub-category has no colour of its own: it is its group's.
    color: line.parentId === null ? (changes.color === undefined ? line.chosenColor : changes.color) : null,
  };
}

function rename(write: WriteContext, line: BoardLine, name: string, stop: () => void) {
  write.run(async () => {
    const result = await saveCategory(line.id, inputOf(line, { name }));
    if (!result.ok) {
      notify(messageFor(write, result.error, name, whereOf(write.text, write.lines, line)), "error");
      return;
    }
    stop();
    notify(write.text("renamed", { name }));
  });
}

function create(write: WriteContext, input: CategoryFormInput, where: string, opened: () => void) {
  write.run(async () => {
    const result = await createCategory(input);
    if (!result.ok) {
      write.fail(messageFor(write, result.error, input.name, where));
      return;
    }
    write.done();
    opened();
    notify(write.settingsText("saved"));
  });
}

function recolor(write: WriteContext, line: BoardLine, color: string | null) {
  write.run(async () => {
    const result = await saveCategory(line.id, inputOf(line, { color }));
    if (!result.ok) {
      write.fail(messageFor(write, result.error));
      return;
    }
    write.done();
    notify(write.settingsText("saved"));
  });
}

function move(write: WriteContext, line: BoardLine, parentId: string) {
  const target = write.lines.find((one) => one.id === parentId)?.name ?? "";
  write.run(async () => {
    const result = await moveCategory(line.id, parentId);
    if (!result.ok) {
      write.fail(messageFor(write, result.error, line.name, target));
      return;
    }
    write.done();
    const back = result.fromId;
    undoable(write, write.text("move.done", { name: line.name, group: target }), () =>
      moveCategory(line.id, back),
    );
  });
}

function merge(write: WriteContext, line: BoardLine, keepId: string) {
  const keep = write.lines.find((one) => one.id === keepId)?.name ?? "";
  write.run(async () => {
    const result = await mergeCategories(keepId, line.id);
    if (!result.ok) {
      write.fail(write.settingsText("errors.failed"));
      return;
    }
    write.done();
    const message = write.text("merge.done", { name: line.name, keep, count: result.moved });
    undoable(write, message, () => undoMerge(result.undo), write.settingsText("errors.failed"));
  });
}

function archive(write: WriteContext, line: BoardLine) {
  write.run(async () => {
    const result = await archiveCategory(line.id);
    if (!result.ok) {
      write.fail(messageFor(write, result.error));
      return;
    }
    write.done();
    undoable(write, write.text("archive.done", { name: line.name }), () => restoreCategories(result.ids));
  });
}

function restore(write: WriteContext, line: BoardLine) {
  write.run(async () => {
    const result = await restoreCategories([line.id]);
    notify(
      result.ok ? write.settingsText("restoredToast") : messageFor(write, result.error),
      result.ok ? "success" : "error",
    );
  });
}

/** The writes of the board, bound to its state; `pending` while one runs. */
export function useBoardWrites(state: BoardState) {
  const [pending, startTransition] = useTransition();
  const write: WriteContext = {
    text: useTranslations("expenses.categories"),
    settingsText: useTranslations("settings.categories"),
    lines: state.lines,
    run: (work) => startTransition(work),
    done: state.close,
    fail: state.fail,
  };
  return {
    pending,
    rename: (line: BoardLine, name: string, stop: () => void) => rename(write, line, name, stop),
    create: (input: CategoryFormInput, where: string, opened: () => void) =>
      create(write, input, where, opened),
    recolor: (line: BoardLine, color: string | null) => recolor(write, line, color),
    move: (line: BoardLine, parentId: string) => move(write, line, parentId),
    merge: (line: BoardLine, keepId: string) => merge(write, line, keepId),
    archive: (line: BoardLine) => archive(write, line),
    restore: (line: BoardLine) => restore(write, line),
  };
}

export type BoardWrites = ReturnType<typeof useBoardWrites>;

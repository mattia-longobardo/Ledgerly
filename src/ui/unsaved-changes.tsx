"use client";

// src/ui/unsaved-changes.tsx — the Settings forms say when they hold changes not yet saved: their
// Save button appears only then, a banner over the page offers Save and Discard for all of them,
// and leaving the page (a link, a reload, closing the tab) asks first.
//
// A form is compared by what its controls show, not by its state: the Settings forms are a mix of
// controlled and uncontrolled ones, and the DOM is the one thing every one of them has.
import { TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "./button";

type Value = string | boolean;

/** What a form's controls show, in order; buttons and hidden fields are not something one edits. */
export function readForm(form: HTMLFormElement): Value[] {
  return Array.from(form.elements).flatMap((element): Value[] => {
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox" || element.type === "radio") return [element.checked];
      if (["submit", "button", "reset", "hidden", "file", "image"].includes(element.type)) return [];
      return [element.value];
    }
    if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement)
      return [element.value];
    return [];
  });
}

/**
 * Puts the values of {@link readForm} back. Through the native setters and the events React
 * listens to, so a controlled field's state follows; a checkbox is clicked, which is how React
 * hears it change.
 */
export function writeForm(form: HTMLFormElement, values: readonly Value[]): void {
  let index = 0;
  for (const element of Array.from(form.elements)) {
    if (element instanceof HTMLInputElement) {
      if (element.type === "checkbox" || element.type === "radio") {
        const want = values[index++];
        if (element.checked !== want) element.click();
        continue;
      }
      if (["submit", "button", "reset", "hidden", "file", "image"].includes(element.type)) continue;
      setValue(element, HTMLInputElement.prototype, String(values[index++]), "input");
    } else if (element instanceof HTMLTextAreaElement) {
      setValue(element, HTMLTextAreaElement.prototype, String(values[index++]), "input");
    } else if (element instanceof HTMLSelectElement) {
      setValue(element, HTMLSelectElement.prototype, String(values[index++]), "change");
    }
  }
}

function setValue(element: HTMLElement & { value: string }, proto: object, value: string, event: string) {
  if (element.value === value) return;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(element, value);
  element.dispatchEvent(new Event(event, { bubbles: true }));
}

const same = (a: readonly Value[], b: readonly Value[]) =>
  a.length === b.length && a.every((value, i) => value === b[i]);

interface Entry {
  submit: () => void;
  reset: () => void;
}

interface Registry {
  set: (id: string, entry: Entry | null) => void;
}

const UnsavedContext = createContext<Registry | null>(null);

/**
 * Tracks one form. `dirty` is true while what it shows differs from what was saved; call `saved()`
 * once a save went through, so what it shows now is the new starting point. Works without a
 * {@link UnsavedChangesProvider} too (a form alone in a test): then only `dirty` is there.
 */
export function useUnsavedForm(formRef: RefObject<HTMLFormElement | null>) {
  const registry = useContext(UnsavedContext);
  const id = useId();
  const baseline = useRef<Value[] | null>(null);
  const [dirty, setDirty] = useState(false);

  const check = useCallback(() => {
    const form = formRef.current;
    if (!form || baseline.current === null) return;
    setDirty(!same(readForm(form), baseline.current));
  }, [formRef]);

  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    baseline.current = readForm(form);
    // After the event, never during it: a select fires `input` before `change`, and a render in
    // between would put a controlled select back to its old value before React heard the change.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const later = () => {
      clearTimeout(timer);
      timer = setTimeout(check, 0);
    };
    form.addEventListener("input", later);
    form.addEventListener("change", later);
    return () => {
      clearTimeout(timer);
      form.removeEventListener("input", later);
      form.removeEventListener("change", later);
    };
  }, [formRef, check]);

  useEffect(() => {
    if (!registry) return;
    registry.set(
      id,
      dirty
        ? {
            submit: () => formRef.current?.requestSubmit(),
            reset: () => {
              const form = formRef.current;
              if (form && baseline.current) writeForm(form, baseline.current);
              check();
            },
          }
        : null,
    );
  }, [registry, id, dirty, formRef, check]);

  useEffect(() => () => registry?.set(id, null), [registry, id]);

  const saved = useCallback(() => {
    const form = formRef.current;
    if (form) baseline.current = readForm(form);
    setDirty(false);
  }, [formRef]);

  return { dirty, saved };
}

/**
 * Holds the Settings forms with changes: the banner while there is one, and the question before a
 * link or the browser takes the page away.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("unsaved");
  const entries = useRef(new Map<string, Entry>());
  const [count, setCount] = useState(0);

  const registry = useMemo<Registry>(
    () => ({
      set: (id, entry) => {
        if (entry) entries.current.set(id, entry);
        else entries.current.delete(id);
        setCount(entries.current.size);
      },
    }),
    [],
  );

  useEffect(() => {
    if (count === 0) return;
    const message = t("leave");
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Older browsers show the dialog only with a return value.
      event.returnValue = "";
    }
    // Client navigation never unloads the page: a link inside it is asked here, before Next.js
    // sees the click. A new tab, a download or another site is left alone.
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.target && link.target !== "_self") return;
      if (link.hasAttribute("download")) return;
      const to = new URL(link.href, window.location.href);
      if (to.origin !== window.location.origin) return;
      if (to.pathname === window.location.pathname && to.search === window.location.search) return;
      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [count, t]);

  const all = (action: "submit" | "reset") => {
    for (const entry of [...entries.current.values()]) entry[action]();
  };

  return (
    <UnsavedContext.Provider value={registry}>
      {count > 0 && (
        <div
          role="status"
          data-testid="unsaved-banner"
          className="sticky top-2 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-card border border-warn bg-warn-bg px-4 py-2.5 text-sm"
        >
          <TriangleAlert aria-hidden className="size-4 shrink-0 text-warn" />
          <p className="mr-auto min-w-0 font-medium text-fg">{t("banner", { count })}</p>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => all("reset")}>
              {t("discard")}
            </Button>
            <Button size="sm" variant="primary" onClick={() => all("submit")}>
              {t("saveAll")}
            </Button>
          </div>
        </div>
      )}
      {children}
    </UnsavedContext.Provider>
  );
}

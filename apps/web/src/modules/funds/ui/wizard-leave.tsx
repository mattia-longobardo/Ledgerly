"use client";

// Leaving "Add pension fund" with something written (screens §3): the browser asks on a reload or a
// closed tab, and a link out of the procedure asks here first.
import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@ledgerly/ui/button";
import { Modal } from "@ledgerly/ui/modal";

/** A click that opens a link in this tab: the main button, no key held, not handled already. */
const plainClick = (event: MouseEvent) =>
  !event.defaultPrevented &&
  event.button === 0 &&
  !(event.metaKey || event.ctrlKey || event.shiftKey || event.altKey);

/** The link the click is on, when it opens in this tab and is no download. */
function sameTabLink(target: EventTarget | null): HTMLAnchorElement | null {
  const link = target instanceof Element ? target.closest("a[href]") : null;
  if (!(link instanceof HTMLAnchorElement)) return null;
  if ((link.target && link.target !== "_self") || link.hasAttribute("download")) return null;
  return link;
}

/** The address a plain click on a link takes the page to, when it leaves the procedure. */
function leavingTo(event: MouseEvent): string | null {
  const link = plainClick(event) ? sameTabLink(event.target) : null;
  if (link === null) return null;
  const next = new URL(link.href, window.location.href);
  // A link to another step, or to another site, is left alone.
  if (next.origin !== window.location.origin || next.pathname === window.location.pathname) return null;
  return `${next.pathname}${next.search}${next.hash}`;
}

/** While `dirty`, a reload asks the browser's question and a link out calls `onLeave` instead. */
export function useLeaveGuard(dirty: boolean, onLeave: (address: string) => void) {
  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    // Asked here, before Next.js sees the click.
    function onClick(event: MouseEvent) {
      const address = leavingTo(event);
      if (address === null) return;
      event.preventDefault();
      event.stopPropagation();
      onLeave(address);
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, onLeave]);
}

/** "Leave without saving?": stay, or go where the link pointed. */
export function LeaveDialog({
  open,
  onStay,
  onLeave,
}: {
  open: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  const text = useTranslations("funds.wizard");
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onStay();
      }}
      width={420}
      title={text("leave.title")}
      description={text("leave.text")}
      footer={
        <>
          <Button onClick={onStay}>{text("leave.stay")}</Button>
          <Button variant="danger" onClick={onLeave}>
            {text("leave.leave")}
          </Button>
        </>
      }
    >
      {null}
    </Modal>
  );
}

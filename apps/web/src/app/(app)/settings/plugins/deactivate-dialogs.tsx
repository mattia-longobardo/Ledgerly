"use client";

// «Deactivate {provider}» (H55, H56; PERS-615 §5): the dialog with the true counts read before it
// opens, and the dialog of a refusal — its cause, what changed (nothing), what to do. Shared by the
// row of the list (menu «⋯») and the page (the zone at its end, the choice of «Needs cleanup»).
import { useFormatter, useTranslations } from "next-intl";
import { type RefObject, useState, useTransition } from "react";
import type { RouteOutput } from "@ledgerly/api-client";
import type { banks } from "@ledgerly/api-contract/settings";
import { Banner } from "@ledgerly/ui/banner";
import { Button } from "@ledgerly/ui/button";
import { Modal } from "@ledgerly/ui/modal";
import { useRouter } from "@ledgerly/ui/router";
import { notify } from "@ledgerly/ui/toast";
import { type DeactivateRefusal, deactivateSourceAction, deactivationCountsAction } from "./deactivate-calls";

type Counts = RouteOutput<typeof banks.getSourceDeactivation>;
type Options = { force?: boolean; stopReading?: boolean };
/** A refusal, and whether its reading runs since more than 15 minutes (told when it came). */
type Refused = DeactivateRefusal & { stuck: boolean };

/** After this long a reading may be stopped (D3 = A): the server checks it again. */
const STOP_AFTER_MS = 15 * 60_000;

/** The lines of the dialog: only the ones above 0, and the credentials only when there are some. */
function useLines(counts: Counts, provider: string): string[] {
  const words = useTranslations("settings.plugin.deactivate");
  return [
    counts.accounts > 0 && words("accounts", { count: counts.accounts }),
    counts.movements > 0 && words("movements", { count: counts.movements }),
    counts.categories > 0 && words("categories", { count: counts.categories, provider }),
    counts.rules > 0 && words("rules", { count: counts.rules, provider }),
    counts.unsent > 0 && words("unsent", { count: counts.unsent }),
    counts.pendingDays > 0 && words("pendingDays", { count: counts.pendingDays, provider }),
    counts.credentials && words("credentials", { provider }),
  ].filter((line): line is string => typeof line === "string");
}

interface ConfirmProps {
  counts: Counts;
  provider: string;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  finalFocus?: RefObject<HTMLElement | null>;
}

function Confirm({ counts, provider, pending, onCancel, onConfirm, finalFocus }: ConfirmProps) {
  const words = useTranslations("settings.plugin.deactivate");
  const lines = useLines(counts, provider);
  return (
    <Modal
      open
      onOpenChange={(next) => !next && !pending && onCancel()}
      title={words("title", { provider })}
      description={words("body", { provider })}
      width={460}
      finalFocus={finalFocus}
      footer={
        <>
          <Button size="sm" disabled={pending} onClick={onCancel}>
            {words("cancel")}
          </Button>
          <Button variant="danger" size="sm" disabled={pending} aria-busy={pending} onClick={onConfirm}>
            {pending ? words("busy") : words("confirm", { provider })}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        {lines.length > 0 ? (
          <ul className="flex list-disc flex-col gap-1 pl-5" data-testid="deactivate-lines">
            {lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : (
          <p data-testid="deactivate-lines">{words("nothing", { provider })}</p>
        )}
        {counts.accounts > 0 && <p className="text-muted">{words("back", { provider })}</p>}
      </div>
    </Modal>
  );
}

/** What a refusal says (§5): its cause, what changed, what to do, and the way on. */
function useRefusalCopy(refusal: Refused, provider: string) {
  const words = useTranslations("settings.plugin.refusal");
  const format = useFormatter();
  if (refusal.reason === "reading_in_progress") {
    const time =
      refusal.startedAt === null
        ? ""
        : format.dateTime(new Date(refusal.startedAt), { hour: "2-digit", minute: "2-digit" });
    return {
      title: words("reading.title"),
      body: words("reading.body", { time }),
      hint: refusal.stuck ? words("reading.stuck") : words("reading.wait"),
      action: refusal.stuck
        ? { label: words("reading.stop"), options: { stopReading: true }, danger: true }
        : { label: words("retry"), options: {}, danger: false },
    };
  }
  if (refusal.reason === "plugin_down") {
    return {
      title: words("down.title", { provider }),
      body: words("down.body", { provider }),
      hint: null,
      action: { label: words("down.force"), options: { force: true }, danger: true },
    };
  }
  return {
    title: words("other.title", { provider }),
    body: words("other.body", { code: refusal.reason }),
    hint: null,
    action: { label: words("retry"), options: {}, danger: false },
  };
}

interface RefusalProps {
  refusal: Refused;
  provider: string;
  pending: boolean;
  onClose: () => void;
  onRetry: (options: Options) => void;
}

function Refusal({ refusal, provider, pending, onClose, onRetry }: RefusalProps) {
  const words = useTranslations("settings.plugin.refusal");
  const copy = useRefusalCopy(refusal, provider);
  return (
    <Modal
      open
      onOpenChange={(next) => !next && !pending && onClose()}
      title={words("title", { provider })}
      width={460}
      footer={
        <>
          <Button size="sm" disabled={pending} onClick={onClose}>
            {words("close")}
          </Button>
          <Button
            variant={copy.action.danger ? "danger" : "primary"}
            size="sm"
            disabled={pending}
            aria-busy={pending}
            onClick={() => onRetry(copy.action.options)}
          >
            {copy.action.label}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2" data-testid="deactivate-refusal" data-reason={refusal.reason}>
        <Banner tone="neg" alert title={copy.title}>
          {copy.body}
        </Banner>
        {copy.hint !== null && <p className="text-sm text-muted">{copy.hint}</p>}
      </div>
    </Modal>
  );
}

/** «Deactivate»: the call, its toast and the list after it, or the refusal to show. */
function useTurnOff(slug: string, provider: string) {
  const words = useTranslations("settings.plugin.deactivate");
  const router = useRouter();
  const [refusal, setRefusal] = useState<Refused | null>(null);
  const [pending, startTransition] = useTransition();
  function turnOff(options: Options, done: () => void) {
    startTransition(async () => {
      const result = await deactivateSourceAction(slug, options).catch((): DeactivateRefusal => ({
        ok: false,
        reason: "failed",
        startedAt: null,
      }));
      done();
      if (!result.ok) {
        const since = result.startedAt === null ? null : Date.parse(result.startedAt);
        setRefusal({ ...result, stuck: since !== null && Date.now() - since >= STOP_AFTER_MS });
        return;
      }
      setRefusal(null);
      notify(words("done", { provider, count: result.accounts }));
      router.push("/settings/plugins");
      router.refresh();
    });
  }
  return { refusal, close: () => setRefusal(null), pending, turnOff };
}

/**
 * «Deactivate…»: `open` reads the counts and opens the dialog; a refusal opens its own. `failure` says
 * that the counts could not be read: nothing opened, nothing changed.
 */
export function useDeactivate({
  slug,
  provider,
  finalFocus,
}: {
  slug: string;
  provider: string;
  finalFocus?: RefObject<HTMLElement | null>;
}) {
  const words = useTranslations("settings.plugin.deactivate");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [failed, setFailed] = useState(false);
  const [opening, startOpening] = useTransition();
  const { refusal, close, pending, turnOff } = useTurnOff(slug, provider);

  function open() {
    if (opening) return;
    setFailed(false);
    startOpening(async () => {
      const result = await deactivationCountsAction(slug).catch((): { ok: false } => ({ ok: false }));
      if (result.ok) setCounts(result.counts);
      else setFailed(true);
    });
  }

  const stop = () => setCounts(null);
  const dialogs = (
    <>
      {counts !== null && (
        <Confirm
          counts={counts}
          provider={provider}
          pending={pending}
          onCancel={stop}
          onConfirm={() => turnOff({}, stop)}
          finalFocus={finalFocus}
        />
      )}
      {refusal !== null && (
        <Refusal
          refusal={refusal}
          provider={provider}
          pending={pending}
          onClose={close}
          onRetry={(options) => turnOff(options, stop)}
        />
      )}
    </>
  );
  const failure = failed ? (
    <p role="alert" className="text-sm text-neg">
      {words("failed")}
    </p>
  ) : null;
  return { open, opening, dialogs, failure };
}

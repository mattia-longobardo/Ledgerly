"use client";

// The instrument of a purchase or of a position of «Switch to positions» (R5d): searched by ISIN, name
// or ticker in the registry (`GET /instruments/search`), then the market of the order. The price is in
// the market's currency; a market with no automatic price says so.
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { INVESTMENTS } from "@ledgerly/api-contract";
import type { RouteOutput } from "@ledgerly/api-client";
import { useApi } from "@ledgerly/ui/data";
import { Field } from "@ledgerly/ui/field";
import { Input, Select } from "@ledgerly/ui/input";

const { searchInstruments } = INVESTMENTS.instruments;
type Hit = RouteOutput<typeof searchInstruments>["items"][number];

/** The instrument picked and its market: what a purchase names. */
export interface PickedInstrument {
  instrumentId: string;
  name: string;
  mic: string | null;
  /** The currency of the price: the market's, or the instrument's without a market. */
  currency: string;
}

/** The search waits for the typing to stop: one read per word, not one per key. */
const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

const pick = (hit: Hit, mic: string | null): PickedInstrument => {
  const listing = hit.listings.find((one) => one.mic === mic) ?? null;
  return {
    instrumentId: hit.instrumentId,
    name: hit.name,
    mic: listing?.mic ?? null,
    currency: listing?.currency ?? hit.currency,
  };
};

/** The answers of one search, as radio buttons. */
function Hits({
  id,
  query,
  picked,
  onPick,
}: {
  id: string;
  query: string;
  picked: string | null;
  onPick: (hit: Hit) => void;
}) {
  const text = useTranslations("investments.portfolioOps");
  const classes = useTranslations("investments.classes");
  const found = useApi(searchInstruments, { query: { q: query } });
  if (found.error)
    return (
      <p role="alert" className="text-sm text-neg">
        {text("searchFailed")}
      </p>
    );
  if (!found.data) return <p className="text-sm text-muted">{text("searching")}</p>;
  const { items, complete } = found.data;
  return (
    <fieldset className="flex flex-col gap-1" aria-describedby={complete ? undefined : `${id}-partial`}>
      <legend className="sr-only">{text("results")}</legend>
      {items.length === 0 && <p className="text-sm text-muted">{text("noResults")}</p>}
      {items.map((hit) => (
        <label
          key={hit.instrumentId}
          data-testid="instrument-hit"
          className="flex min-h-6 cursor-pointer items-start gap-2 rounded-sm text-sm"
        >
          <input
            type="radio"
            name={`${id}-hit`}
            className="focus-ring mt-0.5"
            checked={picked === hit.instrumentId}
            onChange={() => onPick(hit)}
          />
          <span className="flex flex-col">
            <span className="font-medium">{hit.name}</span>
            <span className="text-xs text-muted">
              {[hit.isin, hit.listings[0]?.ticker, classes(hit.class)].filter(Boolean).join(" · ")}
            </span>
          </span>
        </label>
      ))}
      {!complete && (
        <p id={`${id}-partial`} className="text-sm text-warn">
          {text("partial")}
        </p>
      )}
    </fieldset>
  );
}

/** The markets of the instrument picked: the first is the form's proposal. */
function MarketField({
  id,
  hit,
  mic,
  onChange,
}: {
  id: string;
  hit: Hit;
  mic: string | null;
  onChange: (mic: string) => void;
}) {
  const text = useTranslations("investments.portfolioOps");
  if (hit.listings.length === 0) return <p className="text-sm text-muted">{text("noMarket")}</p>;
  return (
    <Field label={text("market")} htmlFor={`${id}-market`}>
      <Select id={`${id}-market`} value={mic ?? ""} onChange={(event) => onChange(event.target.value)}>
        {hit.listings.map((one) => (
          <option key={one.mic} value={one.mic}>
            {text(one.priced ? "marketOption" : "marketManual", {
              mic: one.mic,
              ticker: one.ticker ?? "—",
              currency: one.currency,
            })}
          </option>
        ))}
      </Select>
    </Field>
  );
}

/** The exchange rate of a price in another currency than the account's; empty, the ECB rate. */
export function FxRateField({
  id,
  from,
  to,
  value,
  onChange,
}: {
  id: string;
  from: string;
  to: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const text = useTranslations("investments.portfolioOps");
  if (from === to) return null;
  return (
    <Field label={text("fxRate", { from, to })} htmlFor={id} hint={text("fxRateHint")}>
      <Input
        id={id}
        inputMode="decimal"
        numeric
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

export function InstrumentField({
  id,
  initial = null,
  onChange,
}: {
  id: string;
  /** The instrument of the operation an «Edit» opens: kept until another one is picked. */
  initial?: PickedInstrument | null;
  onChange: (picked: PickedInstrument | null) => void;
}) {
  const text = useTranslations("investments.portfolioOps");
  const [typed, setTyped] = useState("");
  const [query, setQuery] = useState("");
  const [hit, setHit] = useState<Hit | null>(null);
  const [mic, setMic] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(typed.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [typed]);
  const choose = (next: Hit, market: string | null) => {
    setHit(next);
    setMic(market);
    onChange(pick(next, market));
  };
  return (
    <div className="col-span-full flex flex-col gap-2">
      <Field label={text("instrument")} htmlFor={`${id}-search`} hint={text("instrumentHint")}>
        <Input
          id={`${id}-search`}
          type="search"
          autoComplete="off"
          maxLength={60}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
        />
      </Field>
      {query.length >= MIN_QUERY && (
        <Hits
          id={id}
          query={query}
          picked={hit?.instrumentId ?? null}
          onPick={(next) => choose(next, next.listings[0]?.mic ?? null)}
        />
      )}
      {hit && <MarketField id={id} hit={hit} mic={mic} onChange={(market) => choose(hit, market)} />}
      {!hit && initial && (
        <p className="text-sm" data-testid="instrument-current">
          {text("currentInstrument", { name: initial.name, mic: initial.mic ?? "—" })}
        </p>
      )}
    </div>
  );
}

import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import { CONNECTION_REFUSALS } from "@ledgerly/api-contract";
import messages from "../../../../../../../messages/en.json";
import { useRefusalText } from "./connection-refusal";

function Sentence({ code }: { code: string }) {
  return <p>{useRefusalText()(code, { name: "Zeta Bank", provider: "Zeta Bank" })}</p>;
}

const sentenceOf = (code: string) => {
  const { unmount } = render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <Sentence code={code} />
    </NextIntlClientProvider>,
  );
  const text = screen.getByRole("paragraph").textContent;
  unmount();
  return text;
};

const EXPECTED: Record<(typeof CONNECTION_REFUSALS)[number], string> = {
  busy: "An update is already running. Try again shortly.",
  unavailable: "The connection is not available now. Try again later or tell the administrator.",
  not_active: "Zeta Bank is not active.",
  pending: messages.settings.connections.text.pending,
  auth: "The Zeta Bank key is no longer valid.",
  consent_expired: "Access to Zeta Bank has expired.",
  rate_limited: "Zeta Bank reached its limit of automatic readings.",
  provider_down: "Zeta Bank is not responding.",
  invalid_data: "Zeta Bank answered with data that Ledgerly cannot read. Nothing was changed.",
  failed: "Something went wrong.",
};

describe("useRefusalText", () => {
  it.each(CONNECTION_REFUSALS)("says %s in the words of the person", (code) => {
    expect(sentenceOf(code)).toBe(EXPECTED[code]);
  });

  it("says a code outside the closed list as a failure", () => {
    expect(sentenceOf("conflict")).toBe("Something went wrong.");
  });
});

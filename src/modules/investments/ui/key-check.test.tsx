import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../../messages/en.json";
import it_ from "../../../../messages/it.json";
import { KeyCheckLine } from "./key-check";

function inLocale(locale: "en" | "it", ipRestricted: boolean | null) {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? en : it_} timeZone="Europe/Rome">
      <KeyCheckLine text="read only" ipRestricted={ipRestricted} />
    </NextIntlClientProvider>,
  );
}

describe("KeyCheckLine (PERS-87 SEC-02)", () => {
  it("warns when the key is not restricted by IP, in both languages", () => {
    inLocale("en", false);
    expect(screen.getByText("IP not restricted")).toBeInTheDocument();
  });

  it("says it in Italian too", () => {
    inLocale("it", false);
    expect(screen.getByText("IP non limitato")).toBeInTheDocument();
  });

  it("says nothing when the key is restricted, or the provider does not say", () => {
    const { unmount } = inLocale("en", true);
    expect(screen.queryByText("IP not restricted")).toBeNull();
    unmount();
    inLocale("en", null);
    expect(screen.queryByText("IP not restricted")).toBeNull();
  });
});

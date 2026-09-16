import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import messages from "../../messages/it.json";
import ErrorBoundary from "./error";
import GlobalError from "./global-error";
import NotFound from "./not-found";

const LEAK = new Error('relation "user_preferences" does not exist at postgres://ledgerly@db');

function inItalian(children: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="it" messages={messages} timeZone="Europe/Rome">
      {children}
    </NextIntlClientProvider>,
  );
}

describe("not-found", () => {
  it("explains in the user's language and leads back to Overview", () => {
    inItalian(<NotFound />);
    expect(screen.getByRole("heading", { name: "Pagina non trovata" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Vai alla panoramica" })).toHaveAttribute("href", "/");
  });
});

describe("error", () => {
  it("shows catalogued copy, never the error's own message, and retries", async () => {
    const reset = vi.fn();
    inItalian(<ErrorBoundary error={LEAK} reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Qualcosa è andato storto");
    expect(document.body).not.toHaveTextContent("postgres");
    await userEvent.click(screen.getByRole("button", { name: "Riprova" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});

describe("global-error", () => {
  it("renders its own document with the generic copy and no error details", () => {
    const html = renderToStaticMarkup(<GlobalError error={LEAK} reset={() => undefined} />);
    expect(html).toMatch(/^<html lang="en">/);
    expect(html).toContain("Something went wrong");
    expect(html).not.toContain("postgres");
  });
});

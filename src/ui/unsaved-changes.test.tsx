import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { type FormEvent, useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { UnsavedChangesProvider, useUnsavedForm } from "./unsaved-changes";

/** One uncontrolled field and one controlled select and checkbox: the two kinds Settings has. */
function Form({ onSave }: { onSave: (values: { name: string; theme: string; mail: boolean }) => void }) {
  const ref = useRef<HTMLFormElement>(null);
  const unsaved = useUnsavedForm(ref);
  const [theme, setTheme] = useState("light");
  const [mail, setMail] = useState(false);
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave({ name: String(new FormData(event.currentTarget).get("name")), theme, mail });
    unsaved.saved();
  }
  return (
    <form ref={ref} onSubmit={onSubmit}>
      <label>
        Name
        <input name="name" defaultValue="Giulia" />
      </label>
      <label>
        Theme
        <select value={theme} onChange={(event) => setTheme(event.target.value)}>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label>
        <input type="checkbox" checked={mail} onChange={(event) => setMail(event.target.checked)} />
        Mail
      </label>
      {unsaved.dirty && <button type="submit">Save</button>}
    </form>
  );
}

function renderPage(onSave = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Rome">
      <UnsavedChangesProvider>
        <Form onSave={onSave} />
        <a href="/settings/security">Security</a>
      </UnsavedChangesProvider>
    </NextIntlClientProvider>,
  );
  return onSave;
}

const banner = () => screen.queryByTestId("unsaved-banner");

describe("unsaved changes", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows neither Save nor the banner until something changes, then both", async () => {
    renderPage();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(banner()).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Theme"), "dark");
    expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(banner()).toHaveTextContent("A section has changes that are not saved");
  });

  it("forgets the change when the value goes back to the saved one", async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText("Name"), "x");
    expect(await screen.findByTestId("unsaved-banner")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Name"), "{Backspace}");
    await waitFor(() => expect(banner()).toBeNull());
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("Discard puts back every field, controlled ones included", async () => {
    renderPage();
    await userEvent.type(screen.getByLabelText("Name"), " Rossi");
    await userEvent.selectOptions(screen.getByLabelText("Theme"), "dark");
    await userEvent.click(screen.getByLabelText("Mail"));
    await userEvent.click(await screen.findByRole("button", { name: "Discard changes" }));
    expect(screen.getByLabelText("Name")).toHaveValue("Giulia");
    expect(screen.getByLabelText("Theme")).toHaveValue("light");
    expect(screen.getByLabelText("Mail")).not.toBeChecked();
    expect(banner()).toBeNull();
  });

  it("Save changes submits the form, and a saved form leaves no banner", async () => {
    const onSave = renderPage();
    await userEvent.selectOptions(screen.getByLabelText("Theme"), "dark");
    await userEvent.click(screen.getByLabelText("Mail"));
    await userEvent.click(await screen.findByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith({ name: "Giulia", theme: "dark", mail: true });
    expect(banner()).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });

  it("asks before the page is left, and only while something is not saved", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    expect(fireEvent.click(screen.getByRole("link", { name: "Security" }))).toBe(true);
    expect(confirm).not.toHaveBeenCalled();

    await userEvent.selectOptions(screen.getByLabelText("Theme"), "dark");
    await screen.findByTestId("unsaved-banner");
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    // Refused: the click is cancelled, the page stays.
    expect(fireEvent.click(screen.getByRole("link", { name: "Security" }))).toBe(false);
    expect(confirm).toHaveBeenCalledWith(messages.unsaved.leave);
  });

  it("a form outside the provider still knows when it has changes", async () => {
    const onSave = vi.fn();
    render(<Form onSave={onSave} />);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    await userEvent.selectOptions(screen.getByLabelText("Theme"), "dark");
    expect(await screen.findByRole("button", { name: "Save" })).toBeInTheDocument();
  });
});

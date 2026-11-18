import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EmptyState, ErrorState, LoadingState } from "./states";
import { GroupRow, Table, TBody, Td, Th, THead, TotalRow, Tr } from "./table";

describe("table", () => {
  it("marks the sorted column and asks to re-sort", async () => {
    const onSort = vi.fn();
    render(
      <Table>
        <THead>
          <Th sort={{ direction: "desc", onSort }}>Date</Th>
          <Th align="right">Amount</Th>
        </THead>
        <TBody>
          <Tr selected>
            <Td>10 Sep</Td>
            <Td align="right">−12,00 €</Td>
          </Tr>
        </TBody>
      </Table>,
    );
    const header = screen.getByRole("columnheader", { name: /Date/ });
    expect(header).toHaveAttribute("aria-sort", "descending");
    expect(header).toHaveAttribute("scope", "col");
    await userEvent.click(screen.getByRole("button", { name: /Date/ }));
    expect(onSort).toHaveBeenCalledOnce();
    expect(screen.getByRole("row", { selected: true })).toBeInTheDocument();
  });

  it("labels group and total rows with row headers", () => {
    render(
      <Table>
        <TBody>
          <GroupRow colSpan={2} label="September 2026" summary="+2.028,88 €" />
          <TotalRow label="Total">
            <Td align="right">+2.028,88 €</Td>
          </TotalRow>
        </TBody>
      </Table>,
    );
    const headers = screen.getAllByRole("rowheader");
    expect(headers.map((header) => header.textContent)).toEqual(["September 2026+2.028,88 €", "Total"]);
    for (const header of headers) expect(header).toHaveAttribute("scope", "row");
  });
});

describe("states", () => {
  it("renders the empty state with its call to action", () => {
    render(
      <EmptyState
        title="No data yet"
        description="Connect an account"
        actions={<button>Open Settings</button>}
      />,
    );
    expect(screen.getByRole("heading", { name: "No data yet" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Settings" })).toBeInTheDocument();
  });

  it("announces the loading skeleton with its label", () => {
    render(<LoadingState label="Loading…" />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
  });

  it("announces errors and offers a retry", async () => {
    const onRetry = vi.fn();
    render(
      <ErrorState
        title="Could not load"
        description="The server did not answer"
        onRetry={onRetry}
        retryLabel="Try again"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Could not load");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

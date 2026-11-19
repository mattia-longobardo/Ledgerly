import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { profile } from "@ledgerly/api-contract/settings";

const answers = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@ledgerly/api-client", () => ({
  call: async () => {
    answers.calls += 1;
    return { name: `read ${answers.calls}` };
  },
}));

const { useApi } = await import("./data");

function Name() {
  const state = useApi(profile.getProfile, {});
  return <p>{state.data === undefined ? "loading" : JSON.stringify(state.data)}</p>;
}

describe("useApi", () => {
  it("reads again when a screen opens again, showing the last answer meanwhile", async () => {
    const first = render(<Name />);
    await screen.findByText(/read 1/);
    first.unmount();

    render(<Name />);
    // The cached answer at once, then the new read.
    expect(screen.getByText(/read 1/)).toBeInTheDocument();
    await screen.findByText(/read 2/);
    expect(answers.calls).toBe(2);
  });
});

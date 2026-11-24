import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { profile } from "@ledgerly/api-contract/settings";
import type { ApiState } from "./data";

const answers = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@ledgerly/api-client", () => ({
  call: async () => {
    answers.calls += 1;
    return { name: `read ${answers.calls}` };
  },
}));

const { invalidate, useApi, useLatest } = await import("./data");

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

describe("invalidate", () => {
  it("settles once the screen shows the new read", async () => {
    render(<Name />);
    const shown = await screen.findByText(/read \d+/);
    const before = answers.calls;
    await invalidate(profile.getProfile);
    expect(shown).toHaveTextContent(`read ${before + 1}`);
  });
});

describe("useLatest", () => {
  it("keeps the last answer while a new input is read, and gives way to an error or a new answer", () => {
    const reload = () => {};
    const states: ApiState<string>[] = [
      { data: "first", error: null, loading: false, reload },
      { data: undefined, error: null, loading: true, reload },
      { data: undefined, error: new Error("refused"), loading: false, reload },
      { data: "second", error: null, loading: false, reload },
    ];
    const seen: (string | undefined)[] = [];
    function Probe({ state }: { state: ApiState<string> }) {
      seen.push(useLatest(state).data);
      return null;
    }
    const { rerender } = render(<Probe state={states[0]} />);
    for (const state of states.slice(1)) rerender(<Probe state={state} />);
    expect(seen.filter((one, index) => one !== seen[index - 1])).toEqual(["first", undefined, "second"]);
  });
});

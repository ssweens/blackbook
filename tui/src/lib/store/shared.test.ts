import { describe, expect, it, vi } from "vitest";
import { withSpinner } from "./shared.js";

function notificationHarness() {
  const events: string[] = [];
  const notify = vi.fn((_message: string) => {
    events.push("notify");
    return "spinner-id";
  });
  const clear = vi.fn((_id: string) => {
    events.push("clear");
  });
  return { events, notify, clear };
}

describe("withSpinner", () => {
  it("publishes the spinner before starting work", async () => {
    const { events, notify, clear } = notificationHarness();

    const pending = withSpinner(
      "Working...",
      async () => {
        events.push("work");
      },
      notify as never,
      clear as never,
    );

    expect(events).toEqual(["notify"]);
    await pending;
    expect(events).toEqual(["notify", "work", "clear"]);
  });

  it("clears the spinner when work fails", async () => {
    const { events, notify, clear } = notificationHarness();

    await expect(withSpinner(
      "Working...",
      async () => {
        events.push("work");
        throw new Error("failed");
      },
      notify as never,
      clear as never,
    )).rejects.toThrow("failed");

    expect(events).toEqual(["notify", "work", "clear"]);
  });
});

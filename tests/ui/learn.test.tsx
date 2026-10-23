// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeekBars } from "../../ui/LearnView";
import { tabOf } from "../../ui/OttoPage";

afterEach(cleanup);

const trendsOut = (days = 30) => ({
  days,
  cardsInWindow: 12,
  rules: [
    { ruleId: "OTTO001", title: "Pipe hides the check's exit code", count: 7, threads: 4, byProvider: [{ providerId: "claude-code", count: 5 }, { providerId: "codex", count: 2 }], weekly: [0, 1, 2, 4], lastAt: 1_700_000_000_000 },
    { ruleId: "OTTO004", title: "Success asserted by matching a word", count: 1, threads: 1, byProvider: [{ providerId: "codex", count: 1 }], weekly: [0, 0, 0, 1], lastAt: 1_700_000_000_000 },
  ],
});
const line = "Never pipe a verification command into tail or head and trust the result.";
const options = { providers: [{ id: "claude-code", displayName: "Claude Code" }, { id: "codex", displayName: "Codex" }], projects: [] };

async function page(rpc: Record<string, (input: never) => unknown>, mode = "pro") {
  const app = await loadPluginApp(() => import("../../app"));
  return renderSlot(app.navPanels[0], { subPath: "learn" }, { rpc: { "bakeoff.options": () => options, ...rpc } as never, settings: { mode } });
}

describe("Learn tab", () => {
  it("routes the learn sub path", () => expect(tabOf("learn")).toBe("learn"));

  it("draws one bar per week with the numbers in its label", () => {
    const { container, getByRole } = render(<WeekBars weekly={[0, 1, 4]} />);
    expect(container.querySelectorAll("rect")).toHaveLength(3);
    expect(getByRole("img").getAttribute("aria-label")).toBe("Per week, oldest first: 0, 1, 4");
  });

  it("is closed to Starter mode", async () => {
    const slot = await page({}, "starter");
    expect(await slot.findByText(/Learn needs Pro or Operator mode/)).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("lists trends with provider split and shows a suggestion that copies", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const slot = await page({
      "learn.trends": ({ days }: { days: number }) => trendsOut(days),
      "learn.suggestions": () => ({ days: 30, suggestions: [{ ruleId: "OTTO001", title: "Pipe hides the check's exit code", count: 7, line }] }),
    });
    expect(await slot.findByText("7 times, last 30 days")).toBeTruthy();
    expect(slot.getByText("1 time, last 30 days")).toBeTruthy();
    expect(slot.getByText("Claude Code 5, Codex 2")).toBeTruthy();
    expect(slot.getByRole("img", { name: "7 times" })).toBeTruthy();
    expect(slot.getByText("12 cards in this window.")).toBeTruthy();
    fireEvent.click(await slot.findByText("Copy"));
    expect(writeText).toHaveBeenCalledWith(line);
    expect(await slot.findByText("Copied")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("changing the window asks for that many days", async () => {
    const slot = await page({
      "learn.trends": ({ days }: { days: number }) => trendsOut(days),
      "learn.suggestions": ({ days }: { days: number }) => ({ days, suggestions: [] }),
    });
    await slot.findByText("7 times, last 30 days");
    fireEvent.change(slot.getByLabelText("Window"), { target: { value: "90" } });
    expect(await slot.findByText("7 times, last 90 days")).toBeTruthy();
    expect(slot.rpcCalls.filter((c) => c.method === "learn.trends").map((c) => c.input)).toContainEqual({ days: 90 });
    expect(slot.getByText("Nothing has repeated three times yet.")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("says plainly when no rule fired", async () => {
    const slot = await page({
      "learn.trends": () => ({ days: 30, cardsInWindow: 0, rules: [] }),
      "learn.suggestions": () => ({ days: 30, suggestions: [] }),
    });
    expect(await slot.findByText("No rule fired in the last 30 days.")).toBeTruthy();
    slot.lifecycle.unmount();
  });
});

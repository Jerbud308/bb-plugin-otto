// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Meter } from "../../ui/BudgetView";
import { tabOf } from "../../ui/OttoPage";

afterEach(cleanup);

const summary = (over: Record<string, unknown> = {}) => ({
  projects: [{ projectId: "proj_1", totalTokens: 1_500_000, threads: 3 }],
  providers: [{ providerId: "claude-code", planLabel: "Max", windows: [{ label: "5h", usedPercent: 97, resetsAt: null }] }],
  usageCheckedAt: 1,
  guard: { mode: "reject", windowPercent: 95, projectTokenCap: 1_000_000, projectIds: [] },
  ...over,
});
const options = { providers: [{ id: "claude-code", displayName: "Claude Code" }], projects: [{ id: "proj_1", name: "Acme" }] };

async function page(rpc: Record<string, (input: never) => unknown>, mode = "operator") {
  const app = await loadPluginApp(() => import("../../app"));
  return renderSlot(app.navPanels[0], { subPath: "budget" }, { rpc: { "bakeoff.options": () => options, ...rpc } as never, settings: { mode } });
}

describe("Budget tab", () => {
  it("routes the budget sub path", () => {
    expect(tabOf("budget")).toBe("budget");
    expect(tabOf("")).toBe("feed");
  });

  it("marks a meter over its limit and describes it", () => {
    const { container, getByRole } = render(<Meter label="5h" percent={97} limit={95} />);
    expect(container.querySelector(".otto-meter__fill")?.getAttribute("data-over")).toBe("true");
    expect(getByRole("img").getAttribute("aria-label")).toBe("5h 97 percent used, guard limit 95 percent");
    cleanup();
    expect(render(<Meter label="5h" percent={40} limit={95} />).container.querySelector(".otto-meter__fill")?.getAttribute("data-over")).toBe("false");
  });

  it("needs Operator mode", async () => {
    const slot = await page({}, "pro");
    expect(await slot.findByText(/Budget needs Operator mode/)).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("shows windows, project tokens by name, the cap warning and guard events", async () => {
    const slot = await page({
      "budget.summary": () => summary(),
      "budget.events": () => ({
        events: [{ id: "g1", at: 1_700_000_000_000, mode: "reject", threadId: "thr_9", projectId: "proj_1", providerId: "claude-code", reason: 'Otto guard: plan window "5h" is at 97% (limit 95%).', action: "reject" }],
      }),
    });
    expect(await slot.findByText("Guard rejects: a message over a limit is refused with a reason.")).toBeTruthy();
    expect(slot.getByRole("img", { name: "5h 97 percent used, guard limit 95 percent" })).toBeTruthy();
    expect(slot.getByText("Max")).toBeTruthy();
    expect(slot.getByText("Acme")).toBeTruthy();
    expect(slot.getByText("1,500,000")).toBeTruthy();
    expect(slot.getByText("over cap")).toBeTruthy();
    expect(slot.getByText("thr_9")).toBeTruthy();
    expect(slot.container.textContent).not.toMatch(/\$\d/); // tokens only, no dollar figures
    slot.lifecycle.unmount();
  });

  it("says so plainly when nothing has been recorded", async () => {
    const slot = await page({
      "budget.summary": () => summary({ projects: [], providers: [], guard: { mode: "off", windowPercent: 95, projectTokenCap: 0, projectIds: ["a"] } }),
      "budget.events": () => ({ events: [] }),
    });
    expect(await slot.findByText(/Guard is off/)).toBeTruthy();
    expect(slot.getByText(/No provider has reported a plan window yet/)).toBeTruthy();
    expect(slot.getByText(/No token counts yet/)).toBeTruthy();
    expect(slot.getByText("Nothing held or flagged.")).toBeTruthy();
    expect(slot.container.textContent).toContain("no project token cap, guarding 1 project");
    slot.lifecycle.unmount();
  });
});

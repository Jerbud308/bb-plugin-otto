// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { describe, expect, it } from "vitest";

const summary = (id: string, verdict: string, threadId: string) => ({
  id,
  threadId,
  projectId: "proj_1",
  threadTitle: `Thread ${threadId}`,
  turnId: id.split(":")[1],
  verdict,
  claimKinds: ["tests"],
  findingCount: 1,
  highFindingCount: 1,
  createdAt: 1_700_000_000_000,
});

describe("app registration", () => {
  it("registers one header action, one thread panel, one nav panel", async () => {
    const app = await loadPluginApp(() => import("../app"));
    expect(app.threadHeaderActions.map((a) => a.id)).toEqual(["proof-badge"]);
    expect(app.threadPanelActions.map((a) => a.id)).toEqual(["proof"]);
    expect(app.navPanels.map((a) => a.id)).toEqual(["otto"]);
    expect(app.navPanels[0].path).toBe("otto");
  });

  it("the Otto page renders both feed rows", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const slot = renderSlot(
      app.navPanels[0],
      { subPath: "" },
      {
        rpc: {
          "proof.stats": () => ({
            last7d: { VERIFIED: 1, UNVERIFIED: 1, CONTRADICTED: 0, NO_CLAIM: 0 },
            totalCards: 2,
            threadsScanned: 2,
          }),
          "proof.listCards": () => ({
            cards: [summary("thr_a:t1", "VERIFIED", "thr_a"), summary("thr_b:t2", "UNVERIFIED", "thr_b")],
            nextBefore: null,
          }),
          "proof.rules": () => ({ rulesetVersion: 1, rules: [] }),
        },
      },
    );
    expect(await slot.findByText("Thread thr_a")).toBeTruthy();
    expect(await slot.findByText("Thread thr_b")).toBeTruthy();
    const stamps = Array.from(slot.container.querySelectorAll<HTMLElement>(".otto-stamp")).map((s) => s.dataset.verdict);
    expect(stamps).toEqual(["VERIFIED", "UNVERIFIED"]);
    expect(slot.getByText("Verified turns, last 7 days:")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("the badge renders nothing until the thread has a card", async () => {
    const app = await loadPluginApp(() => import("../app"));
    const slot = renderSlot(
      app.threadHeaderActions[0],
      { threadId: "thr_a", projectId: "proj_1", isCompactViewport: false },
      {
        rpc: {
          "proof.threadSummary": () => ({
            latest: null,
            counts: { VERIFIED: 0, UNVERIFIED: 0, CONTRADICTED: 0, NO_CLAIM: 0 },
          }),
        },
      },
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(slot.container.querySelector("button")).toBeNull();
    slot.lifecycle.unmount();
  });
});

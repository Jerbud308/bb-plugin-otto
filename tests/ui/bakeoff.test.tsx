// @vitest-environment jsdom
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Lane } from "../../src/shared/contract";
import { barWidths } from "../../ui/BakeoffDetail";
import { Lanes } from "../../ui/Lanes";
import { buildRace, axisTicks } from "../../ui/lanesModel";
import { Tally } from "../../ui/Tally";

afterEach(cleanup);

const T0 = 1_700_000_000_000;
const lane = (over: Partial<Lane> & Pick<Lane, "contestantId" | "providerId">): Lane => ({
  status: "idle",
  finishedAt: null,
  ticks: [],
  ...over,
});

describe("Tally", () => {
  it("draws groups of five plus the remainder, beside the real number", () => {
    const { container, getByRole, getByText } = render(<Tally count={7} />);
    expect(container.querySelectorAll("line")).toHaveLength(5 + 2); // one group (4 verticals + diagonal) + 2 verticals
    expect(getByRole("img").getAttribute("aria-label")).toBe("7 wins");
    expect(getByRole("img").getAttribute("title")).toBe("7 wins");
    expect(getByText("7").className).toContain("otto-mono");
  });
  it("says 1 win and draws nothing for zero", () => {
    expect(render(<Tally count={1} />).getByRole("img").getAttribute("aria-label")).toBe("1 win");
    cleanup();
    const zero = render(<Tally count={0} />);
    expect(zero.container.querySelector("svg")).toBeNull();
    expect(zero.getByText("0")).toBeTruthy();
  });
});

describe("race geometry", () => {
  it("puts an axis tick on every whole minute, every five minutes past twenty", () => {
    expect(axisTicks(150_000)).toEqual([0, 60_000, 120_000]);
    expect(axisTicks(21 * 60_000)).toEqual([0, 300_000, 600_000, 900_000, 1_200_000]);
  });

  it("ends the axis at the latest finish and finds the first finish", () => {
    const race = buildRace(
      T0,
      [
        lane({ contestantId: "a", providerId: "claude-code", finishedAt: T0 + 30_000, ticks: [{ t: T0 + 5_000, kind: "cmd" }] }),
        lane({
          contestantId: "b",
          providerId: "codex",
          finishedAt: T0 + 90_000,
          ticks: [
            { t: T0 + 10_000, kind: "check" },
            { t: T0 + 60_000, kind: "failedCheck" },
          ],
        }),
      ],
      T0 + 200_000,
    );
    expect(race.spanMs).toBe(90_000);
    expect(race.firstFinishMs).toBe(30_000);
    expect(race.lanes[0].atFirstFinish).toBeNull(); // it finished first
    expect(race.lanes[1].atFirstFinish).toBe(1); // one command by the time the other finished
  });

  it("runs the axis to now while any lane runs, and never has a zero span", () => {
    const running = buildRace(T0, [lane({ contestantId: "a", providerId: "x", status: "running" })], T0 + 45_000);
    expect(running.spanMs).toBe(45_000);
    expect(running.lanes[0].running).toBe(true);
    expect(running.firstFinishMs).toBeNull();
    expect(buildRace(T0, [lane({ contestantId: "a", providerId: "x", status: "failed", finishedAt: T0 })], T0).spanMs).toBe(1000);
  });
});

describe("Lanes", () => {
  const lanes: Lane[] = [
    lane({
      contestantId: "a",
      providerId: "claude-code",
      finishedAt: T0 + 30_000,
      ticks: [
        { t: T0 + 2_000, kind: "cmd" },
        { t: T0 + 8_000, kind: "check" },
      ],
    }),
    lane({
      contestantId: "b",
      providerId: "codex",
      status: "running",
      ticks: [
        { t: T0 + 5_000, kind: "failedCheck" },
        { t: T0 + 20_000, kind: "cmd" },
      ],
    }),
  ];
  const names: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex" };

  it("draws one lane per contestant, ticks by kind, and one photo-finish line", () => {
    const { container, getByText } = render(
      <Lanes startedAt={T0} lanes={lanes} nameOf={(id) => names[id] ?? id} now={T0 + 60_000} />,
    );
    expect(container.querySelectorAll(".otto-lane")).toHaveLength(2);
    expect(container.querySelectorAll(".otto-tick--cmd")).toHaveLength(2);
    expect(container.querySelectorAll(".otto-tick--check")).toHaveLength(1);
    expect(container.querySelectorAll(".otto-tick--failed")).toHaveLength(1);
    expect(container.querySelectorAll(".otto-photo")).toHaveLength(1);
    expect(getByText("first finish 0:30")).toBeTruthy();
    expect(container.querySelectorAll(".otto-lane__line--live")).toHaveLength(1); // only the running lane
    expect(container.querySelectorAll(".otto-lane__where")).toHaveLength(1); // the unfinished lane at the finish moment
    const plot = container.querySelector(".otto-lanes__plot");
    expect(plot?.getAttribute("aria-label")).toContain("Claude Code finished at 0:30, 2 commands");
    expect(plot?.getAttribute("aria-label")).toContain("Codex still running, 2 commands");
  });

  it("has a table twin with start, finish and tick counts", () => {
    const { container } = render(<Lanes startedAt={T0} lanes={lanes} nameOf={(id) => names[id] ?? id} now={T0 + 60_000} />);
    const rows = Array.from(container.querySelectorAll("details tbody tr")).map((r) =>
      Array.from(r.querySelectorAll("td")).map((td) => td.textContent),
    );
    expect(rows[0][0]).toBe("Claude Code");
    expect(rows[0].slice(2)).toEqual(["0:30", "2", "1", "0"]);
    expect(rows[1].slice(2)).toEqual(["running", "2", "0", "1"]);
  });

  it("draws no photo-finish line before anyone finishes", () => {
    const { container } = render(
      <Lanes startedAt={T0} lanes={[lane({ contestantId: "a", providerId: "x", status: "running" })]} nameOf={(i) => i} now={T0 + 5_000} />,
    );
    expect(container.querySelector(".otto-photo")).toBeNull();
  });
});

describe("contact print scale", () => {
  const c = (insertions: number | null, deletions: number | null) =>
    ({ insertions, deletions }) as Parameters<typeof barWidths>[0];
  it("sizes every bar against the largest total", () => {
    expect(barWidths(c(30, 10), 40)).toEqual({ add: 75, del: 25 });
    expect(barWidths(c(10, 0), 40)).toEqual({ add: 25, del: 0 });
    expect(barWidths(c(null, null), 40)).toEqual({ add: 0, del: 0 });
    expect(barWidths(c(5, 5), 0)).toEqual({ add: 0, del: 0 });
  });
});

const options = {
  projects: [{ id: "proj_1", name: "Demo" }],
  providers: [
    { id: "claude-code", displayName: "Claude Code", available: true },
    { id: "codex", displayName: "Codex", available: true },
    { id: "gemini", displayName: "Gemini", available: false },
  ],
};

const contestant = (id: string, providerId: string, over: Record<string, unknown> = {}) => ({
  id,
  bakeoffId: "bko_1",
  providerId,
  threadId: `thr_${id}`,
  environmentId: `env_${id}`,
  status: "idle",
  startedAt: T0,
  finishedAt: T0 + 60_000,
  verdict: "VERIFIED",
  filesChanged: 2,
  insertions: 30,
  deletions: 10,
  error: null,
  ...over,
});

async function page(subPath: string, rpc: Record<string, (input: never) => unknown>, mode = "operator") {
  const app = await loadPluginApp(() => import("../../app"));
  return renderSlot(app.navPanels[0], { subPath }, { rpc: { "bakeoff.options": () => options, ...rpc } as never, settings: { mode } });
}

describe("Bake-off tab", () => {
  it("asks for Operator mode otherwise", async () => {
    const slot = await page("bakeoff", {}, "pro");
    expect(slot.getByText("Bake-off needs Operator mode. Change Mode in Settings, Installed plugins, Otto.")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("shows the empty state with its action", async () => {
    const slot = await page("bakeoff", {
      "bakeoff.list": () => ({ bakeoffs: [] }),
      "bakeoff.scoreboard": () => ({ rows: [] }),
    });
    expect(await slot.findByText("No bake-offs yet. Send one task to two agents and compare the receipts.")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("lists bake-offs and a labeled scoreboard with a table twin", async () => {
    const slot = await page("bakeoff", {
      "bakeoff.list": () => ({
        bakeoffs: [{ id: "bko_1", taskTag: "docs", status: "decided", createdAt: T0, contestantCount: 2, winnerProviderId: "codex" }],
      }),
      "bakeoff.scoreboard": () => ({
        rows: [{ providerId: "codex", runs: 3, wins: 2, winRate: 2 / 3, verifiedRate: 1 / 3 }],
      }),
    });
    expect(await slot.findByText("docs", { selector: ".otto-chip" })).toBeTruthy();
    expect(await slot.findByText("Winner: Codex")).toBeTruthy();
    expect(await slot.findByText("3 runs")).toBeTruthy();
    expect(slot.getByText("67% win rate")).toBeTruthy();
    expect(slot.getByText("33% verified")).toBeTruthy();
    expect(slot.getByRole("img", { name: "2 wins" })).toBeTruthy();
    expect(slot.container.querySelectorAll("details tbody tr")).toHaveLength(1);
    fireEvent.click(slot.getByText("docs", { selector: ".otto-chip" }));
    expect(slot.navigateCalls.at(-1)).toEqual({ method: "toPluginPanel", path: "otto", options: { subPath: "bakeoff/bko_1" } });
    slot.lifecycle.unmount();
  });

  it("the new form stays disabled until valid, then creates and opens the detail", async () => {
    const slot = await page("bakeoff", {
      "bakeoff.list": () => ({ bakeoffs: [] }),
      "bakeoff.scoreboard": () => ({ rows: [] }),
      "bakeoff.create": () => ({ bakeoffId: "bko_9" }),
    });
    fireEvent.click((await slot.findAllByText("New bake-off"))[0]);
    const start = (await slot.findByText("Start bake-off")) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(slot.queryByLabelText("Gemini")).toBeNull(); // unavailable providers are not offered
    fireEvent.change(slot.getByLabelText("Prompt"), { target: { value: "Add HELLO.md" } });
    fireEvent.change(slot.getByLabelText("Task tag"), { target: { value: " Docs " } });
    fireEvent.click(slot.getByLabelText("Claude Code"));
    expect(start.disabled).toBe(true); // one agent is not enough
    fireEvent.click(slot.getByLabelText("Codex"));
    expect(start.disabled).toBe(false);
    fireEvent.click(start);
    await slot.findByText("New bake-off", { selector: "button" }).catch(() => undefined);
    await new Promise((r) => setTimeout(r, 20));
    const create = slot.rpcCalls.find((c) => c.method === "bakeoff.create");
    expect(create?.input).toEqual({
      projectId: "proj_1",
      prompt: "Add HELLO.md",
      providerIds: ["claude-code", "codex"],
      taskTag: "Docs",
    });
    expect(slot.navigateCalls.at(-1)).toEqual({ method: "toPluginPanel", path: "otto", options: { subPath: "bakeoff/bko_9" } });
    slot.lifecycle.unmount();
  });

  const detailRpc = (status: string, winner: string | null, extra: Record<string, unknown> = {}) => ({
    "bakeoff.get": () => ({
      bakeoff: {
        id: "bko_1",
        projectId: "proj_1",
        prompt: "Add HELLO.md",
        taskTag: "docs",
        baseBranch: null,
        status,
        winnerContestantId: winner,
        note: null,
        createdAt: T0,
        decidedAt: null,
      },
      contestants: [
        contestant("c1", "claude-code"),
        contestant("c2", "codex", { insertions: 10, deletions: 0, verdict: "UNVERIFIED" }),
      ],
    }),
    "bakeoff.lanes": () => ({
      startedAt: T0,
      lanes: [
        lane({ contestantId: "c1", providerId: "claude-code", finishedAt: T0 + 30_000, ticks: [{ t: T0 + 1000, kind: "check" }] }),
        lane({ contestantId: "c2", providerId: "codex", finishedAt: T0 + 60_000, ticks: [] }),
      ],
    }),
    ...extra,
  });

  it("a ready bake-off shows the race, prints on one scale, and enabled pick buttons", async () => {
    const slot = await page("bakeoff/bko_1", detailRpc("ready", null, { "bakeoff.pickWinner": () => ({ ok: true }) }));
    expect(await slot.findByText("first finish 0:30")).toBeTruthy();
    expect(slot.getByText("2 files, +30 -10")).toBeTruthy();
    expect(slot.getByText("2 files, +10 -0")).toBeTruthy();
    const adds = Array.from(slot.container.querySelectorAll<HTMLElement>(".otto-print__add")).map((e) => e.style.width);
    expect(adds).toEqual(["75%", "25%"]);
    const picks = slot.getAllByText("Pick as winner") as HTMLButtonElement[];
    expect(picks.every((b) => !b.disabled)).toBe(true);
    expect(Array.from(slot.container.querySelectorAll(".otto-stamp")).map((s) => (s as HTMLElement).dataset.verdict)).toEqual([
      "VERIFIED",
      "UNVERIFIED",
    ]);
    fireEvent.click(picks[1]);
    fireEvent.click(await slot.findByText("Confirm winner"));
    await new Promise((r) => setTimeout(r, 20));
    expect(slot.rpcCalls.find((c) => c.method === "bakeoff.pickWinner")?.input).toEqual({ bakeoffId: "bko_1", contestantId: "c2" });
    slot.lifecycle.unmount();
  });

  it("deleting a bake-off asks first, then calls delete and returns to the list", async () => {
    const slot = await page("bakeoff/bko_1", detailRpc("ready", null, { "bakeoff.delete": () => ({ ok: true }) }));
    await slot.findByText("first finish 0:30");
    fireEvent.click(slot.getByText("Delete bake-off", { selector: "button.otto-textbtn" }));
    expect(slot.rpcCalls.some((c) => c.method === "bakeoff.delete")).toBe(false);
    fireEvent.click(await slot.findByText("Delete bake-off", { selector: "[role=dialog] button" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(slot.rpcCalls.find((c) => c.method === "bakeoff.delete")?.input).toEqual({ bakeoffId: "bko_1" });
    expect(slot.navigateCalls.at(-1)).toEqual({ method: "toPluginPanel", path: "otto", options: { subPath: "bakeoff" } });
    slot.lifecycle.unmount();
  });

  it("pick buttons stay disabled until the bake-off is ready", async () => {
    const slot = await page("bakeoff/bko_1", detailRpc("running", null));
    await slot.findByText("first finish 0:30");
    expect((slot.getAllByText("Pick as winner") as HTMLButtonElement[]).every((b) => b.disabled)).toBe(true);
    slot.lifecycle.unmount();
  });

  it("a decided bake-off circles the winner, says how to merge, and archives after a confirm", async () => {
    const slot = await page("bakeoff/bko_1", detailRpc("decided", "c1", { "bakeoff.archiveLosers": () => ({ archived: 1 }) }));
    await slot.findByText("first finish 0:30");
    expect(slot.container.querySelectorAll(".otto-handcircle")).toHaveLength(1);
    expect(slot.container.querySelector(".otto-handcircle")?.textContent).toBe("Claude Code");
    expect(slot.getByText("Merge from the winner's thread with bb's own merge controls.")).toBeTruthy();
    expect(slot.queryByText("Pick as winner")).toBeNull();
    fireEvent.click(slot.getByText("Archive the other threads"));
    fireEvent.click(await slot.findByText("Archive the other threads", { selector: "[role=dialog] button" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(slot.rpcCalls.some((c) => c.method === "bakeoff.archiveLosers")).toBe(true);
    expect(await slot.findByText("Archived 1 threads.")).toBeTruthy();
    slot.lifecycle.unmount();
  });
});

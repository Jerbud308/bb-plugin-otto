import { makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import { beforeEach, describe, expect, it } from "vitest";
import { OTTO_INSTRUCTIONS } from "../../src/server/agents";
import { resetRows, startHost } from "./helpers";

describe("agent configuration", () => {
  beforeEach(() => resetRows());

  it("starter mode injects nothing", async () => {
    const { harness } = await startHost({ rows: () => [], settings: { mode: "starter" } });
    const cfg = await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext());
    expect(JSON.stringify(cfg)).not.toContain("otto_lint_command");
    expect(JSON.stringify(cfg)).not.toContain("otto-evidence");
    expect(JSON.stringify(cfg)).not.toContain("Otto checks");
  });

  it("pro mode adds the tool, the skill, and the instructions", async () => {
    const { harness } = await startHost({ rows: () => [], settings: { mode: "pro" } });
    const cfg = JSON.stringify(await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext()));
    expect(cfg).toContain("otto_lint_command");
    expect(cfg).toContain("otto-evidence");
    expect(cfg).toContain(JSON.stringify(OTTO_INSTRUCTIONS).slice(1, 60));
  });

  it("operator mode also coaches agents", async () => {
    const { harness } = await startHost({ rows: () => [], settings: { mode: "operator" } });
    const cfg = JSON.stringify(await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext()));
    expect(cfg).toContain("otto_lint_command");
  });

  it("an advisor-role context gets nothing, even in operator mode", async () => {
    const { harness } = await startHost({ rows: () => [], settings: { mode: "operator" } });
    const cfg = JSON.stringify(
      await harness.behavior.resolveAgentConfiguration(
        makePluginAgentConfigurationContext({ pluginMetadata: { ottoRole: "advisor" } }),
      ),
    );
    expect(cfg).not.toContain("otto_lint_command");
    expect(cfg).not.toContain("otto-evidence");
  });

  it("the mode follows a settings change without a reload", async () => {
    const { harness } = await startHost({ rows: () => [], settings: { mode: "starter" } });
    await harness.behavior.setSettings({ mode: "pro" });
    const cfg = JSON.stringify(await harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext()));
    expect(cfg).toContain("otto_lint_command");
  });

  it("the lint tool returns the same text as the CLI", async () => {
    const { harness } = await startHost({ rows: () => [], settings: { mode: "pro" } });
    const tool = await harness.behavior.callAgentTool("otto_lint_command", { command: "npm test 2>&1 | tail -3" });
    expect(JSON.stringify(tool)).toContain("OTTO001");
    const clean = await harness.behavior.callAgentTool("otto_lint_command", { command: "npm test" });
    expect(JSON.stringify(clean)).toContain("OK: no findings");
  });
});

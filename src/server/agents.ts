// Agent surfaces: the lint tool and per-thread configuration (BUILD_SPEC 11).
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { formatLintText } from "../proof/format";
import { lintCommand } from "../proof/rules";
import { parseRole } from "../shared/role";
import type { OttoState } from "./state";

export const OTTO_INSTRUCTIONS =
  'Otto checks this thread\'s evidence after each turn. When you say tests, typecheck, build, lint, or CI pass, the last matching command in this turn must run after your last file edit, with its own exit status visible. Do not pipe a check into tail, head, grep, or tee without "set -o pipefail". Do not follow a check with "; echo ..." or "|| true". Do not decide success by grepping for "passed". For CI, wait on ".status" and treat only conclusion == "SUCCESS" as green. Before relying on a verification command, check it with the otto_lint_command tool or `bb otto lint "<command>"`. When a run is meant to fail (a deliberate break, or a baseline on the old code), end the command with "# otto:expect-fail" so Otto does not count it as evidence.';

export function registerAgents(bb: BbPluginApi, state: OttoState): void {
  bb.agents.registerTool({
    name: "otto_lint_command",
    description:
      "Check a shell command that verifies work (tests, typecheck, build, lint, CI) for patterns that hide failures, before you rely on its result.",
    presentation: { label: { pending: "Checking a verification command", completed: "Checked a verification command" } },
    parameters: z.object({ command: z.string().min(1).max(8000) }),
    async execute({ command }) {
      return formatLintText(lintCommand(command)); // same text as `bb otto lint`
    },
  });

  // configure is synchronous: read the cached mode, never settings.get().
  bb.agents.configure((context) => {
    const role = parseRole(context.pluginMetadata);
    if (role === "advisor") return { tools: [], skills: [] };
    if (state.mode === "starter") return { tools: [], skills: [] };
    return { tools: ["otto_lint_command"], skills: ["otto-evidence"], instructions: OTTO_INSTRUCTIONS };
  });
}

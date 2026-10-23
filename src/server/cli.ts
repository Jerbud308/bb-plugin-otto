// `bb otto ...` (BUILD_SPEC 10). Output stays under the 1 MiB CLI cap.
import { PluginCliError, cliCommand, defineCli, type BbPluginApi } from "@get-bb/plugin-sdk";
import { formatLearnText, formatLintText, formatProofText, formatRulesText } from "../proof/format";
import { RULES, lintCommand } from "../proof/rules";
import { RULESET_VERSION } from "../shared/constants";
import type { Card } from "../shared/contract";
import type { OttoStore } from "./db";
import type { Advisor } from "./advisor";
import type { Learn } from "./learn";
import type { Scanner } from "./scanner";
import type { OttoSettings } from "./state";

const THREAD_HINT = "Run bb otto proof thr_abc123, or run it inside a thread.";

const threadIdPositional = {
  name: "thread-id",
  description: "Thread id (defaults to the current thread)",
  required: false,
} as const;

export function registerCli(
  bb: BbPluginApi,
  store: OttoStore,
  scanner: Scanner,
  advisor: Advisor,
  learn: Learn,
  getSettings: () => Promise<OttoSettings>,
): void {
  bb.cli.register(
    defineCli({
      name: "otto",
      summary: "Proof cards for agent turns: raw exit codes and output, checked against what the agent claimed",
      commands: {
        proof: cliCommand({
          summary: "Show the newest proof cards for a thread",
          positionals: [threadIdPositional],
          options: {
            limit: { type: "integer", min: 1, max: 20, default: 10, description: "Cards to show (1 to 20)" },
            json: { type: "boolean", description: "Emit machine-readable JSON (output tails are dropped)" },
          },
          async run(input, ctx) {
            const threadId = input.positionals["thread-id"] ?? ctx.threadId;
            if (!threadId) throw new PluginCliError("a thread id is required", { code: "thread_required", hint: THREAD_HINT });
            await scanner.scanThread(threadId);
            const cards = store
              .listCards({ threadId, limit: input.options.limit })
              .map((s) => store.getCard(s.id))
              .filter((c): c is Card => c !== null);
            if (input.options.json) {
              const trimmed = cards.map((c) => ({ ...c, evidence: c.evidence.map((e) => ({ ...e, outputTail: "" })) }));
              return { exitCode: 0, stdout: JSON.stringify({ threadId, cards: trimmed }) };
            }
            return { exitCode: 0, stdout: formatProofText(threadId, cards) };
          },
        }),
        scan: cliCommand({
          summary: "Rebuild proof cards for a thread, or for every recent thread with --all",
          positionals: [threadIdPositional],
          options: { all: { type: "boolean", description: "Rescan every recent thread (uses the startup window setting)" } },
          async run(input, ctx) {
            if (input.options.all) {
              const { reconcileWindowHours } = await getSettings();
              const r = await scanner.reconcile(reconcileWindowHours, { reset: true, wait: true });
              return { exitCode: 0, stdout: `Scanned ${r.threads} threads, wrote ${r.cardsWritten} cards.` };
            }
            const threadId = input.positionals["thread-id"] ?? ctx.threadId;
            if (!threadId) throw new PluginCliError("a thread id is required", { code: "thread_required", hint: THREAD_HINT });
            const r = await scanner.scanThread(threadId, { reset: true });
            return { exitCode: 0, stdout: `Scanned 1 thread, wrote ${r.cardsWritten} cards.` };
          },
        }),
        rules: cliCommand({
          summary: "List every rule Otto checks",
          options: { json: { type: "boolean", description: "Emit machine-readable JSON" } },
          run(input) {
            if (input.options.json) {
              return { exitCode: 0, stdout: JSON.stringify({ rulesetVersion: RULESET_VERSION, rules: RULES }) };
            }
            return { exitCode: 0, stdout: formatRulesText(RULESET_VERSION, RULES) };
          },
        }),
        advisor: cliCommand({
          summary: "Ask the advisor whether a card's evidence is enough (Operator mode)",
          positionals: [{ name: "card-id", description: "Card id, as shown by bb otto proof --json", required: true }],
          async run(input) {
            try {
              const { reviewId } = await advisor.request(input.positionals["card-id"]);
              return { exitCode: 0, stdout: `Advisor review ${reviewId} started. The result appears on the card.` };
            } catch (cause) {
              throw new PluginCliError(cause instanceof Error ? cause.message : String(cause), { code: "advisor_failed" });
            }
          },
        }),
        learn: cliCommand({
          summary: "Which traps repeat, per rule and provider, with lines worth adding to your CLAUDE.md (Pro and Operator)",
          options: {
            days: { type: "integer", min: 7, max: 90, default: 30, description: "Window in days: 7, 30 or 90" },
            json: { type: "boolean", description: "Emit machine-readable JSON" },
          },
          async run(input) {
            const days = input.options.days;
            if (days !== 7 && days !== 30 && days !== 90) throw new PluginCliError("--days must be 7, 30 or 90", { code: "bad_days" });
            try {
              const t = await learn.trends(days);
              const s = await learn.suggestions(days);
              const stdout = input.options.json ? JSON.stringify({ ...t, suggestions: s.suggestions }) : formatLearnText({ ...t, suggestions: s.suggestions });
              return { exitCode: 0, stdout };
            } catch (cause) {
              throw new PluginCliError(cause instanceof Error ? cause.message : String(cause), { code: "learn_failed" });
            }
          },
        }),
        lint: cliCommand({
          summary: "Check a verification command for patterns that hide failures",
          description: "Exit 2 when any finding is high severity.",
          positionals: [{ name: "command", description: "The shell command to check, as one quoted argument", required: true }],
          options: { json: { type: "boolean", description: "Emit machine-readable JSON" } },
          run(input) {
            const findings = lintCommand(input.positionals.command);
            const exitCode = findings.some((f) => f.severity === "high") ? 2 : 0;
            const stdout = input.options.json ? JSON.stringify({ findings }) : formatLintText(findings);
            return { exitCode, stdout };
          },
        }),
      },
    }),
  );
}

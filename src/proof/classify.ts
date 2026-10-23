// Stage normalization and check-kind classification. Ported from the reference engine.
import { segmentsOf, splitPipeline } from "./shell";

export type CheckKind = "test" | "typecheck" | "build" | "lint" | "ci";

const KIND_ORDER: CheckKind[] = ["test", "typecheck", "build", "lint", "ci"];

export function normalizeStage(stage: string): string {
  let s = stage.trim().replace(/^[({]\s*/, "");
  for (let i = 0; i < 8; i++) {
    const before = s;
    s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=(?:'[^']*'|"[^"]*"|\S*)\s+/, "");
    s = s.replace(/^(?:sudo|time|env|nice|command|exec|nohup)\s+/, "");
    s = s.replace(/^(?:npx|bunx|pnpx)\s+(?:-{1,2}\S+\s+)*/, "");
    s = s.replace(/^(?:pnpm|yarn|npm)\s+exec\s+/, "");
    s = s.replace(/^(?:pnpm|yarn)\s+dlx\s+/, "");
    s = s.replace(/^\S*\/(?=\S)/, "");
    if (s === before) break;
  }
  return s;
}

const K: Record<CheckKind, RegExp[]> = {
  test: [
    /^(?:vitest|jest|pytest|mocha|rspec|phpunit)\b/,
    /^(?:cargo|go|deno|bun)\s+test\b/,
    /^playwright\s+test\b/,
    /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test(?::[\w:-]+)?\b/,
    /^npm\s+t\b/,
    /^make\s+test\b/,
    /^python3?\s+-m\s+(?:pytest|unittest)\b/,
  ],
  typecheck: [
    /^tsc\b/,
    /^vue-tsc\b/,
    /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:typecheck|type-check|tsc|check-types)\b/,
    /^(?:mypy|pyright)\b/,
  ],
  build: [
    /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b/,
    /^(?:cargo|go)\s+build\b/,
    /^bb\s+plugin\s+build\b/,
    /^(?:next|vite)\s+build\b/,
  ],
  lint: [
    /^(?:eslint|ruff|biome|golangci-lint)\b/,
    /^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?lint\b/,
    /^prettier\s+(?:--check|-c)\b/,
  ],
  ci: [
    /^gh\s+pr\s+checks\b/,
    /^gh\s+run\s+(?:view|watch|list)\b/,
    /^gh\s+(?:pr\s+view|api)\b.*\b(?:statusCheckRollup|check-runs|check-suites|statuses)\b/,
  ],
};

export function classifyStage(stage: string): CheckKind[] {
  const s = normalizeStage(stage);
  const out: CheckKind[] = [];
  for (const k of KIND_ORDER) if (K[k].some((r) => r.test(s))) out.push(k);
  return out;
}

export function classifyCommand(cmd: string): CheckKind[] {
  const found = new Set<CheckKind>();
  for (const seg of segmentsOf(cmd)) {
    for (const st of splitPipeline(seg.text)) {
      for (const k of classifyStage(st)) found.add(k);
    }
  }
  return KIND_ORDER.filter((k) => found.has(k));
}

// One tick on a Bake-off lane per finished command (BUILD_SPEC 14.3). Pure.
import { codesToFindings } from "./rules";
import { parseItem, type EventRowLike } from "./turns";

export type TickKind = "cmd" | "check" | "failedCheck";

export interface Tick {
  t: number;
  kind: TickKind;
}

export function tickOfRow(row: EventRowLike): Tick | null {
  if (row.type !== "item/completed") return null;
  const { item } = parseItem(row);
  if (!item || item.kind !== "cmd") return null;
  const findings = codesToFindings(item.findings, item.item, item.item.id);
  if (findings.some((f) => f.effect === "failure")) return { t: row.createdAt, kind: "failedCheck" };
  return { t: row.createdAt, kind: item.kinds.length > 0 ? "check" : "cmd" };
}

// Plugin metadata is untrusted: validate before trusting it (BUILD_SPEC 8.4).
import { z } from "zod";

const roleSchema = z.enum(["advisor", "contestant", "stage"]);
export type OttoRole = z.infer<typeof roleSchema>;

export function parseRole(metadata: unknown): OttoRole | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const r = roleSchema.safeParse((metadata as { ottoRole?: unknown }).ottoRole);
  return r.success ? r.data : null;
}

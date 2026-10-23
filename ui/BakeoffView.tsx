// The Bake-off tab: list at `bakeoff`, detail at `bakeoff/<id>` (BUILD_SPEC 14.5).
import { BakeoffDetail } from "./BakeoffDetail";
import { BakeoffList } from "./BakeoffList";

export function BakeoffView({ subPath }: { subPath: string }) {
  const id = subPath.startsWith("bakeoff/") ? subPath.slice("bakeoff/".length) : "";
  return id === "" ? <BakeoffList /> : <BakeoffDetail bakeoffId={id} />;
}

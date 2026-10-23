// The Pipelines tab: `pipelines` (list), `pipelines/new[/<template>]` and `pipelines/edit/<id>` (builder), `pipelines/run/<id>` (run).
import { PipelineBuilder } from "./PipelineBuilder";
import { PipelineList } from "./PipelineList";
import { PipelineRunView } from "./PipelineRunView";

export function PipelinesView({ subPath }: { subPath: string }) {
  const rest = subPath.startsWith("pipelines/") ? subPath.slice("pipelines/".length) : "";
  if (rest.startsWith("run/")) return <PipelineRunView runId={rest.slice("run/".length)} />;
  if (rest.startsWith("edit/") || rest === "new" || rest.startsWith("new/")) return <PipelineBuilder target={rest} />;
  return <PipelineList />;
}

// The Otto nav panel: Feed, Rules, Learn, Bake-off, Budget tabs (BUILD_SPEC 12.9, V2).
import { useBbNavigate, useSettings } from "@get-bb/plugin-sdk/app";
import type { ReactNode } from "react";
import { BakeoffView } from "./BakeoffView";
import { BudgetView } from "./BudgetView";
import { FeedView } from "./FeedView";
import { LearnView } from "./LearnView";
import { PipelinesView } from "./PipelinesView";
import { RulesView } from "./RulesView";

type Tab = "feed" | "rules" | "learn" | "bakeoff" | "pipelines" | "budget";

const TABS: { id: Tab; label: string; subPath: string }[] = [
  { id: "feed", label: "Feed", subPath: "" },
  { id: "rules", label: "Rules", subPath: "rules" },
  { id: "learn", label: "Learn", subPath: "learn" },
  { id: "bakeoff", label: "Bake-off", subPath: "bakeoff" },
  { id: "pipelines", label: "Pipelines", subPath: "pipelines" },
  { id: "budget", label: "Budget", subPath: "budget" },
];

export function tabOf(subPath: string): Tab {
  if (subPath === "rules") return "rules";
  if (subPath === "bakeoff" || subPath.startsWith("bakeoff/")) return "bakeoff";
  if (subPath === "pipelines" || subPath.startsWith("pipelines/")) return "pipelines";
  if (subPath === "budget") return "budget";
  if (subPath === "learn") return "learn";
  return "feed";
}

function ProTab({ children }: { children: ReactNode }) {
  const { values } = useSettings();
  if (values?.mode !== "pro" && values?.mode !== "operator") {
    return <p className="otto-marginalia">Learn needs Pro or Operator mode. Change Mode in Settings, Installed plugins, Otto.</p>;
  }
  return <>{children}</>;
}

function OperatorTab({ name, children }: { name: string; children: ReactNode }) {
  const { values } = useSettings();
  if (values?.mode !== "operator") {
    return <p className="otto-marginalia">{name} needs Operator mode. Change Mode in Settings, Installed plugins, Otto.</p>;
  }
  return <>{children}</>;
}

export function OttoPage({ subPath }: { subPath: string }) {
  const navigate = useBbNavigate();
  const active = tabOf(subPath);
  return (
    <div className="otto h-full min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto box-border w-full max-w-3xl space-y-4 p-4 md:p-5">
        <nav className="otto-tabs" aria-label="Otto sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="otto-tab"
              aria-current={active === t.id ? "page" : undefined}
              onClick={() => navigate.toPluginPanel("otto", { subPath: t.subPath })}
            >
              {t.label}
            </button>
          ))}
        </nav>
        {active === "feed" ? (
          <FeedView />
        ) : active === "rules" ? (
          <RulesView />
        ) : active === "learn" ? (
          <ProTab>
            <LearnView />
          </ProTab>
        ) : active === "pipelines" ? (
          <OperatorTab name="Pipelines">
            <PipelinesView subPath={subPath} />
          </OperatorTab>
        ) : active === "budget" ? (
          <OperatorTab name="Budget">
            <BudgetView />
          </OperatorTab>
        ) : (
          <OperatorTab name="Bake-off">
            <BakeoffView subPath={subPath} />
          </OperatorTab>
        )}
      </div>
    </div>
  );
}

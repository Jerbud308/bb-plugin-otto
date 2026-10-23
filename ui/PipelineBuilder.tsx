// The pipeline builder: an ordered row of stage boxes joined by arrows. Drag a box to reorder, or use the buttons.
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { GATES, MAX_STAGES, keyFromLabel, validatePipeline } from "../src/proof/pipeline";
import type { StageDefRecord, rpcContract } from "../src/shared/contract";
import { useBakeoffOptions } from "./bakeoffShared";
import { LedgerSkeleton } from "./LedgerSkeleton";
import { GATE_WORD, blankStage, followSelection, moveStage } from "./pipelineModel";
import { messageOf, useLoad } from "./useLoad";

export function PipelineBuilder({ target }: { target: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const editingId = target.startsWith("edit/") ? target.slice("edit/".length) : null;
  const templateId = target.startsWith("new/") ? target.slice("new/".length) : null;
  const saved = useLoad(() => rpc.call("pipeline.list", null), "builder-pipelines");
  const templates = useLoad(() => rpc.call("pipeline.templates", null), "builder-templates");
  const { options, nameOf } = useBakeoffOptions();
  const available = (options.data?.providers ?? []).filter((p) => p.available);
  const defaultProvider = available[0]?.id ?? "";

  const [name, setName] = useState("");
  const [stages, setStages] = useState<StageDefRecord[]>([]);
  const [selected, setSelected] = useState(0);
  const [ready, setReady] = useState(false);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fill the draft once, when everything it depends on has loaded.
  useEffect(() => {
    if (ready || saved.data === null || templates.data === null || options.data === null) return;
    if (editingId !== null) {
      const p = saved.data.pipelines.find((x) => x.id === editingId);
      if (p) {
        setName(p.name);
        setStages(p.stages);
      }
    } else if (templateId !== null) {
      const t = templates.data.templates.find((x) => x.id === templateId);
      if (t) {
        setName(t.name);
        setStages(t.stages.map((s) => ({ ...s, providerId: defaultProvider })));
      }
    }
    setReady(true);
  }, [ready, saved.data, templates.data, options.data, editingId, templateId, defaultProvider]);

  if (!ready) return <LedgerSkeleton rows={3} />;
  if (editingId !== null && !(saved.data?.pipelines ?? []).some((p) => p.id === editingId)) {
    return <p className="otto-marginalia">That pipeline no longer exists.</p>;
  }

  const current = stages[selected] as StageDefRecord | undefined;
  const check = validatePipeline({ name, stages });
  const errors = check.ok ? [] : check.errors;
  const patch = (index: number, change: Partial<StageDefRecord>): void =>
    setStages((prev) => prev.map((s, i) => (i === index ? { ...s, ...change } : s)));
  const relocate = (from: number, to: number): void => {
    setStages((prev) => moveStage(prev, from, to));
    setSelected((s) => followSelection(s, from, to));
  };
  const add = (providerId: string): void => {
    if (stages.length >= MAX_STAGES) return;
    const label = nameOf(providerId);
    setStages((prev) => [...prev, blankStage(label, providerId, prev)]);
    setSelected(stages.length);
  };
  const remove = (index: number): void => {
    setStages((prev) => prev.filter((_, i) => i !== index));
    setSelected((s) => Math.max(0, Math.min(s, stages.length - 2)));
  };
  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await rpc.call("pipeline.save", { ...(editingId === null ? {} : { id: editingId }), name: name.trim(), stages });
      navigate.toPluginPanel("otto", { subPath: "pipelines" });
    } catch (cause) {
      setError(messageOf(cause));
      toast.error(messageOf(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="otto-field">
        <label htmlFor="otto-pl-name">Pipeline name</label>
        <Input id="otto-pl-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
      </div>

      <section aria-label="Stages">
        <p className="otto-section-label">Stages, in order</p>
        {stages.length === 0 ? (
          <p className="otto-marginalia">Add an agent below to make the first stage.</p>
        ) : (
          <ol className="otto-stages">
            {stages.map((s, i) => (
              <li
                key={s.key}
                className="otto-stagebox"
                draggable
                data-dragging={dragFrom === i ? "true" : "false"}
                onDragStart={(e) => {
                  setDragFrom(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(i));
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFrom !== null) relocate(dragFrom, i);
                  setDragFrom(null);
                }}
                onDragEnd={() => setDragFrom(null)}
              >
                <button type="button" className="otto-stagebox__main" aria-current={selected === i ? "true" : undefined} onClick={() => setSelected(i)}>
                  <span className="otto-mono otto-meta">{i + 1}</span>
                  <span>{s.label}</span>
                  <span className="otto-meta">{nameOf(s.providerId)}</span>
                </button>
                {i < stages.length - 1 ? (
                  <span className="otto-stagearrow" aria-hidden="true">
                    {"→"}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        )}
        <div className="otto-board__row">
          <span className="otto-meta">Add stage:</span>
          {available.map((p) => (
            <button key={p.id} type="button" className="otto-textbtn" disabled={stages.length >= MAX_STAGES} onClick={() => add(p.id)}>
              {p.displayName}
            </button>
          ))}
        </div>
      </section>

      {current === undefined ? null : (
        <section aria-label="Edit stage" className="otto-form">
          <p className="otto-section-label">Stage {selected + 1}</p>
          <div className="otto-board__row">
            <button type="button" className="otto-textbtn" disabled={selected === 0} onClick={() => relocate(selected, selected - 1)}>
              Move earlier
            </button>
            <button type="button" className="otto-textbtn" disabled={selected >= stages.length - 1} onClick={() => relocate(selected, selected + 1)}>
              Move later
            </button>
            <button type="button" className="otto-textbtn" onClick={() => remove(selected)}>
              Remove stage
            </button>
          </div>
          <div className="otto-field">
            <label htmlFor="otto-st-label">Label</label>
            <Input id="otto-st-label" value={current.label} maxLength={60} onChange={(e) => patch(selected, { label: e.target.value })} />
          </div>
          <div className="otto-field">
            <label htmlFor="otto-st-key">Name used in prompts</label>
            <Input
              id="otto-st-key"
              className="otto-mono"
              value={current.key}
              maxLength={24}
              onChange={(e) => patch(selected, { key: e.target.value.replace(/[^a-z0-9_]/g, "") || keyFromLabel("stage", stages.map((s) => s.key)) })}
            />
            <span className="otto-meta">
              Later stages can write {"{{stage."}
              {current.key}
              {"}}"} to receive this stage's reply.
            </span>
          </div>
          <div className="otto-field">
            <label htmlFor="otto-st-agent">Agent</label>
            <select id="otto-st-agent" className="otto-select" value={current.providerId} onChange={(e) => patch(selected, { providerId: e.target.value })}>
              {available.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>
          <div className="otto-field">
            <label htmlFor="otto-st-gate">After this stage</label>
            <select id="otto-st-gate" className="otto-select" value={current.gate} onChange={(e) => patch(selected, { gate: e.target.value as StageDefRecord["gate"] })}>
              {GATES.map((g) => (
                <option key={g} value={g}>
                  {GATE_WORD[g]}
                </option>
              ))}
            </select>
          </div>
          <div className="otto-field">
            <label htmlFor="otto-st-prompt">Prompt</label>
            <textarea id="otto-st-prompt" className="otto-textarea" rows={6} value={current.prompt} onChange={(e) => patch(selected, { prompt: e.target.value })} />
            <span className="otto-meta">
              {"{{input}}"} is the task you give when you run the pipeline.
            </span>
          </div>
        </section>
      )}

      {errors.length > 0 && stages.length > 0 ? (
        <ul className="otto-meta" aria-label="Things to fix">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      ) : null}
      {error === null ? null : (
        <p role="alert" className="otto-claimline__status--bad">
          {error}
        </p>
      )}
      <div className="otto-board__row">
        <button type="button" className="otto-btn" disabled={!check.ok || saving} onClick={() => void save()}>
          {saving ? "Saving..." : "Save"}
        </button>
        <button type="button" className="otto-textbtn" onClick={() => navigate.toPluginPanel("otto", { subPath: "pipelines" })}>
          Cancel
        </button>
      </div>
    </div>
  );
}

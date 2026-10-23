// The new bake-off form (BUILD_SPEC 14.5): one status line while worktrees start.
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { rpcContract } from "../src/shared/contract";
import { payloadBakeoffId } from "./bakeoffShared";
import { messageOf } from "./useLoad";

interface Options {
  projects: { id: string; name: string }[];
  providers: { id: string; displayName: string; available: boolean }[];
}

export interface NewBakeoffDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: Options | null;
  onCreated: (bakeoffId: string) => void;
}

export function NewBakeoffDialog({ open, onOpenChange, options, onCreated }: NewBakeoffDialogProps) {
  const rpc = useRpc<typeof rpcContract>();
  const [projectId, setProjectId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [chosen, setChosen] = useState<string[]>([]);
  const [tag, setTag] = useState("");
  const [branch, setBranch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(0);
  const tracked = useRef<string | null>(null);

  const available = (options?.providers ?? []).filter((p) => p.available);
  const project = projectId || options?.projects[0]?.id || "";
  const tagClean = tag.trim();
  const valid =
    project !== "" &&
    prompt.trim() !== "" &&
    prompt.length <= 20000 &&
    chosen.length >= 2 &&
    chosen.length <= 4 &&
    tagClean !== "" &&
    tagClean.length <= 40;

  // Worktrees are made one after another; each signal means one more contestant has settled.
  useRealtime("otto.bakeoff", (payload) => {
    if (!busy) return;
    const id = payloadBakeoffId(payload);
    if (id === null) return;
    tracked.current ??= id;
    if (tracked.current !== id) return;
    void rpc.call("bakeoff.get", { bakeoffId: id }).then(
      (r) => setReady(r.contestants.filter((c) => c.status !== "starting").length),
      () => undefined,
    );
  });

  const toggle = (id: string): void =>
    setChosen((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 4 ? prev : [...prev, id]));

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    setReady(0);
    tracked.current = null;
    try {
      const { bakeoffId } = await rpc.call("bakeoff.create", {
        projectId: project,
        prompt,
        providerIds: chosen,
        taskTag: tagClean,
        ...(branch.trim() === "" ? {} : { baseBranch: branch.trim() }),
      });
      onOpenChange(false);
      setPrompt("");
      setChosen([]);
      setTag("");
      setBranch("");
      onCreated(bakeoffId);
    } catch (cause) {
      setError(messageOf(cause));
      toast.error(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (busy ? undefined : onOpenChange(next))}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New bake-off</DialogTitle>
          <DialogDescription>
            Starts one visible thread per agent, each in its own new worktree. Every agent uses tokens on your account.
          </DialogDescription>
        </DialogHeader>
        <div className="otto-form">
          <div className="otto-field">
            <label htmlFor="otto-bk-project">Project</label>
            <select
              id="otto-bk-project"
              className="otto-select"
              value={project}
              disabled={busy}
              onChange={(e) => setProjectId(e.target.value)}
            >
              {(options?.projects ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="otto-field">
            <label htmlFor="otto-bk-prompt">Prompt</label>
            <textarea
              id="otto-bk-prompt"
              className="otto-textarea"
              rows={4}
              value={prompt}
              disabled={busy}
              onChange={(e) => setPrompt(e.target.value)}
            />
          </div>
          <fieldset className="otto-field otto-field--set" disabled={busy}>
            <legend>Agents (pick 2 to 4)</legend>
            {available.map((p) => (
              <label key={p.id} className="otto-check">
                <Checkbox
                  checked={chosen.includes(p.id)}
                  onCheckedChange={() => toggle(p.id)}
                  aria-label={p.displayName}
                />
                <span>{p.displayName}</span>
              </label>
            ))}
          </fieldset>
          <div className="otto-field">
            <label htmlFor="otto-bk-tag">Task tag</label>
            <Input id="otto-bk-tag" value={tag} maxLength={40} disabled={busy} onChange={(e) => setTag(e.target.value)} />
          </div>
          <div className="otto-field">
            <label htmlFor="otto-bk-branch">Base branch</label>
            <Input
              id="otto-bk-branch"
              value={branch}
              placeholder="default branch"
              disabled={busy}
              onChange={(e) => setBranch(e.target.value)}
            />
          </div>
          {busy ? (
            <p className="otto-mono otto-meta" role="status">
              worktree {ready} of {chosen.length} ready
            </p>
          ) : null}
          {error === null ? null : (
            <p role="alert" className="otto-claimline__status--bad">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <button type="button" className="otto-btn" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </button>
          <button type="button" className="otto-btn" disabled={!valid || busy} onClick={() => void submit()}>
            Start bake-off
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

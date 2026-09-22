import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { ModelOption, Project, Runner, RunnerInput, RunnerPermissionMode, RunnerRole, RunnerTool } from "../lib/api";
import { api } from "../lib/api";
import { Button } from "./Button";
import { Input } from "./Input";
import { Select } from "./Select";

const ROLES: RunnerRole[] = ["planner", "implementer", "reviewer", "senior", "architect"];

/** Sentinel value of the model select that reveals the free-text input. */
const CUSTOM_MODEL = "__custom__";

interface RunnerModalProps {
  /** Existing runner to edit; omit to create a new one. */
  runner?: Runner;
  projects: Project[];
  onClose: () => void;
}

function parseExtraArgs(text: string): string[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) return parsed;
    } catch {}
  }
  // Whitespace-separated with single/double quoting.
  const args: string[] = [];
  const re = /"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed))) {
    args.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : m[2] !== undefined ? m[2] : m[3]);
  }
  return args.length ? args : null;
}

function formatExtraArgs(args: string[] | null): string {
  if (!args || args.length === 0) return "";
  return JSON.stringify(args);
}

/**
 * Group options by `description` when it acts as a category (opencode providers,
 * claude "alias" / "full model ID"); a unique blurb per model is not a group.
 */
function groupModels(models: ModelOption[]): { group: string | null; models: ModelOption[] }[] {
  const distinct = new Set(models.map((m) => m.description ?? ""));
  const useGroups = models.length > 1 && models.every((m) => m.description) && distinct.size < models.length;
  if (!useGroups) return [{ group: null, models }];
  const groups = new Map<string, ModelOption[]>();
  for (const m of models) {
    const key = m.description!;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(m);
  }
  return [...groups].map(([group, list]) => ({ group, models: list }));
}

function modelOptionText(m: ModelOption): string {
  if (m.label === m.id || m.label.includes(m.id)) return m.label;
  // opencode: the provider is the group, the model part is the label.
  if (m.description && m.id === `${m.description}/${m.label}`) return m.label;
  return `${m.label} (${m.id})`;
}

export function RunnerModal({ runner, projects, onClose }: RunnerModalProps) {
  const queryClient = useQueryClient();
  const isEdit = !!runner;

  const { data: tools = [], isLoading: toolsLoading } = useQuery({
    queryKey: ["runner-tools"],
    queryFn: api.getRunnerTools,
    staleTime: 60_000,
  });
  const installed = tools.filter((t) => t.installed);

  const [name, setName] = useState(runner?.name ?? "");
  const [tool, setTool] = useState<RunnerTool | "">(runner?.tool ?? "");
  const [role, setRole] = useState<RunnerRole>(runner?.role ?? "senior");
  const [projectId, setProjectId] = useState(runner?.projectId ?? "");
  const [model, setModel] = useState(runner?.model ?? "");
  const [effort, setEffort] = useState(runner?.effort ?? "");
  // null = decide from the list: an edited runner whose model is not listed is "custom".
  const [customMode, setCustomMode] = useState<boolean | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [concurrency, setConcurrency] = useState(String(runner?.concurrency ?? 1));
  const [pollIntervalSec, setPollIntervalSec] = useState(String(runner?.pollIntervalSec ?? 5));
  const [permissionMode, setPermissionMode] = useState<RunnerPermissionMode>(runner?.permissionMode ?? "safe");
  const [extraArgs, setExtraArgs] = useState(formatExtraArgs(runner?.extraArgs ?? null));
  const [error, setError] = useState<string | null>(null);

  // Pick the first installed tool once the list arrives (create mode only).
  const effectiveTool: RunnerTool | "" = tool || (isEdit ? "" : (installed[0]?.tool ?? ""));

  const { data: discovery, isLoading: modelsLoading } = useQuery({
    queryKey: ["runner-models", effectiveTool],
    queryFn: () => api.getRunnerModels(effectiveTool as RunnerTool),
    enabled: !!effectiveTool,
    staleTime: 60_000,
  });
  const models = discovery?.models ?? [];
  const modelInList = models.some((m) => m.id === model);
  const customModel = models.length > 0 && (customMode ?? (!!model && !modelInList));
  const selectedModel = customModel ? undefined : models.find((m) => m.id === model);
  const efforts = selectedModel?.efforts ?? discovery?.efforts ?? null;
  const defaultEffort = selectedModel?.defaultEffort ?? discovery?.defaultEffort ?? null;
  const showEffort = !!efforts && efforts.length > 0;

  function changeTool(next: RunnerTool) {
    setTool(next);
    setModel("");
    setEffort("");
    setCustomMode(null);
  }

  function selectModel(value: string) {
    if (value === CUSTOM_MODEL) {
      setCustomMode(true);
      return;
    }
    setCustomMode(false);
    setModel(value);
    const allowed = models.find((m) => m.id === value)?.efforts ?? discovery?.efforts ?? [];
    if (effort && !allowed.includes(effort)) setEffort("");
  }

  async function refreshModels() {
    if (!effectiveTool) return;
    setRefreshingModels(true);
    try {
      await queryClient.fetchQuery({
        queryKey: ["runner-models", effectiveTool],
        queryFn: () => api.getRunnerModels(effectiveTool as RunnerTool, true),
        staleTime: 0,
      });
    } catch {
      // The query keeps its previous data; the hint simply stays as it was.
    } finally {
      setRefreshingModels(false);
    }
  }

  const mutation = useMutation({
    mutationFn: () => {
      const payload: RunnerInput = {
        name: name.trim(),
        tool: effectiveTool as RunnerTool,
        role,
        projectId: projectId || null,
        model: model.trim() || null,
        effort: showEffort && effort ? effort : null,
        concurrency: Math.max(1, parseInt(concurrency, 10) || 1),
        pollIntervalSec: Math.max(1, parseInt(pollIntervalSec, 10) || 5),
        permissionMode,
        extraArgs: parseExtraArgs(extraArgs),
      };
      return isEdit ? api.updateRunner(runner!.id, payload) : api.createRunner(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runners"] });
      onClose();
    },
    onError: (e: Error) => setError(e.message),
  });

  const customNeedsArgs = effectiveTool === "custom" && !parseExtraArgs(extraArgs);
  const canSave = name.trim() && effectiveTool && !customNeedsArgs && !mutation.isPending;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-surface rounded-xl shadow-lg w-full max-w-lg p-6 transition-colors duration-300 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-semibold mb-4 text-text">{isEdit ? "Edit Runner" : "New Runner"}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text mb-1">Name *</label>
            <Input placeholder="e.g. claude-senior" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text mb-1">Tool *</label>
              <Select value={effectiveTool} onChange={(e) => changeTool(e.target.value as RunnerTool)} disabled={toolsLoading}>
                {toolsLoading && <option value="">Detecting...</option>}
                {!toolsLoading && installed.length === 0 && <option value="">No tools installed</option>}
                {installed.map((t) => (
                  <option key={t.tool} value={t.tool}>
                    {t.tool}
                    {t.version ? ` (${t.version})` : ""}
                  </option>
                ))}
                {isEdit && runner && !installed.some((t) => t.tool === runner.tool) && (
                  <option value={runner.tool}>{runner.tool} (not installed)</option>
                )}
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-1">Role *</label>
              <Select value={role} onChange={(e) => setRole(e.target.value as RunnerRole)}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-1">Project</label>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Any project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </Select>
          </div>

          <div className={`grid gap-3 ${showEffort ? "grid-cols-3" : "grid-cols-1"}`}>
            <div className={showEffort ? "col-span-2" : ""}>
              <label className="block text-sm font-medium text-text mb-1">Model</label>
              {modelsLoading ? (
                <Select disabled>
                  <option value="">Loading models...</option>
                </Select>
              ) : models.length === 0 ? (
                <Input placeholder="default" value={model} onChange={(e) => setModel(e.target.value)} className="font-mono" />
              ) : (
                <Select value={customModel ? CUSTOM_MODEL : modelInList ? model : ""} onChange={(e) => selectModel(e.target.value)}>
                  <option value="">default</option>
                  {groupModels(models).map(({ group, models: list }) =>
                    group ? (
                      <optgroup key={group} label={group}>
                        {list.map((m) => (
                          <option key={m.id} value={m.id}>
                            {modelOptionText(m)}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      list.map((m) => (
                        <option key={m.id} value={m.id}>
                          {modelOptionText(m)}
                        </option>
                      ))
                    ),
                  )}
                  <option value={CUSTOM_MODEL}>Custom...</option>
                </Select>
              )}
              {customModel && (
                <Input
                  placeholder="model id"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="font-mono mt-2"
                  autoFocus={customMode === true}
                />
              )}
              {discovery && (
                <p className="text-xs text-text-muted mt-1">
                  source: {discovery.source}
                  {models.length > 0 ? ` · ${models.length} model${models.length === 1 ? "" : "s"}` : ""} ·{" "}
                  <button type="button" className="underline hover:text-text disabled:opacity-50" onClick={refreshModels} disabled={refreshingModels}>
                    {refreshingModels ? "Refreshing..." : "Refresh"}
                  </button>
                </p>
              )}
            </div>
            {showEffort && (
              <div>
                <label className="block text-sm font-medium text-text mb-1">Effort</label>
                <Select value={efforts!.includes(effort) ? effort : ""} onChange={(e) => setEffort(e.target.value)}>
                  <option value="">(default{defaultEffort ? `: ${defaultEffort}` : ""})</option>
                  {efforts!.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </Select>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-text mb-1">Concurrency</label>
              <Input type="number" min={1} max={16} value={concurrency} onChange={(e) => setConcurrency(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-text mb-1">Poll (sec)</label>
              <Input type="number" min={1} max={3600} value={pollIntervalSec} onChange={(e) => setPollIntervalSec(e.target.value)} />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-1">Permission mode</label>
            <div className="flex gap-4 text-sm text-text">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="permission" checked={permissionMode === "safe"} onChange={() => setPermissionMode("safe")} />
                Safe
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="radio" name="permission" checked={permissionMode === "full"} onChange={() => setPermissionMode("full")} />
                Full
              </label>
            </div>
            <p className={`text-xs mt-1 ${permissionMode === "full" ? "text-amber-600 dark:text-amber-400" : "text-text-muted"}`}>
              {permissionMode === "full"
                ? "Full skips every permission prompt and sandbox: the tool can run any command in the project directory."
                : "Safe auto-accepts edits and allows agentq, git, gh, bun/npm and read-only shell commands."}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-text mb-1">
              Extra args {effectiveTool === "custom" ? "* (full command line)" : ""}
            </label>
            <Input
              placeholder={effectiveTool === "custom" ? 'bash -c "my-agent \\"$AGENTQ_TASK_ID\\""' : "--verbose"}
              value={extraArgs}
              onChange={(e) => setExtraArgs(e.target.value)}
              className="font-mono"
            />
            <p className="text-xs text-text-muted mt-1">
              {effectiveTool === "custom"
                ? "Argv to run; the prompt is appended as the last argument and exposed as $AGENTQ_PROMPT."
                : "Appended to the generated command. Quoted or JSON array."}
            </p>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSave} variant="primary">
            {mutation.isPending ? "Saving..." : isEdit ? "Save" : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

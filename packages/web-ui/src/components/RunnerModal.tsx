import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cloneElement, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import toast from "react-hot-toast";
import type {
  ModelOption,
  Project,
  Runner,
  RunnerInput,
  RunnerPermissionMode,
  RunnerTool,
} from "../lib/api";
import { api } from "../lib/api";
import {
  AddIcon,
  ClockIcon,
  ConcurrencyIcon,
  EditIcon,
  EffortIcon,
  FolderIcon,
  FullAccessIcon,
  ModelIcon,
  RefreshIcon,
  SafeModeIcon,
  SaveIcon,
  TerminalIcon,
  UserIcon,
} from "../lib/icons";
import { pluralize } from "../lib/format";
import { cn } from "../lib/cn";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { Field } from "./Field";
import { IconButton } from "./IconButton";
import { Input } from "./Input";
import { Modal, useModal } from "./Modal";
import type { SegmentOption } from "./SegmentedControl";
import { SegmentedControl } from "./SegmentedControl";
import { Select } from "./Select";
import { DEFAULT_ROLES, ROLES, ROLE_INFO, normalizeRoles, type Role } from "@agentq/shared/catalog";

/** Sentinel value of the model select that reveals the free-text input. */
const CUSTOM_MODEL = "__custom__";

const PERMISSION_OPTIONS: SegmentOption<RunnerPermissionMode>[] = [
  { value: "safe", label: "Safe", icon: SafeModeIcon },
  { value: "full", label: "Full", icon: FullAccessIcon },
];

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
  const useGroups =
    models.length > 1 && models.every((m) => m.description) && distinct.size < models.length;
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

/**
 * Gives the id a Field hands out to `control` (so the label targets it) and
 * renders follow-up controls, like the custom model input, underneath.
 */
function ControlStack({
  id,
  control,
  children,
}: {
  id?: string;
  control: ReactElement<{ id?: string }>;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      {cloneElement(control, { id })}
      {children}
    </div>
  );
}

export function RunnerModal({ runner, projects, onClose }: RunnerModalProps) {
  const queryClient = useQueryClient();
  const modal = useModal(onClose);
  const isEdit = !!runner;

  const { data: tools = [], isLoading: toolsLoading } = useQuery({
    queryKey: ["runner-tools"],
    queryFn: api.getRunnerTools,
    staleTime: 60_000,
  });
  const installed = tools.filter((t) => t.installed);

  const [name, setName] = useState(runner?.name ?? "");
  const [tool, setTool] = useState<RunnerTool | "">(runner?.tool ?? "");
  const [roles, setRoles] = useState<Role[]>(runner?.roles ?? DEFAULT_ROLES);
  const [projectId, setProjectId] = useState(runner?.projectId ?? "");
  const [model, setModel] = useState(runner?.model ?? "");
  const [effort, setEffort] = useState(runner?.effort ?? "");
  // null = decide from the list: an edited runner whose model is not listed is "custom".
  const [customMode, setCustomMode] = useState<boolean | null>(null);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [concurrency, setConcurrency] = useState(String(runner?.concurrency ?? 1));
  const [pollIntervalSec, setPollIntervalSec] = useState(String(runner?.pollIntervalSec ?? 5));
  const [permissionMode, setPermissionMode] = useState<RunnerPermissionMode>(
    runner?.permissionMode ?? "safe",
  );
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

  function toggleRole(role: Role, on: boolean) {
    setRoles((current) => normalizeRoles(on ? [...current, role] : current.filter((r) => r !== role)));
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
        roles,
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
    onMutate: () => setError(null),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["runners"] });
      toast.success(isEdit ? "Runner updated" : "Runner created");
      modal.close();
    },
    onError: (e: Error) => setError(e.message),
  });

  const isCustomTool = effectiveTool === "custom";
  const customNeedsArgs = isCustomTool && !parseExtraArgs(extraArgs);
  const canSave =
    !!name.trim() && !!effectiveTool && roles.length > 0 && !customNeedsArgs && !mutation.isPending;

  const modelControl: ReactElement<{ id?: string }> = modelsLoading ? (
    <Select disabled>
      <option value="">Loading models...</option>
    </Select>
  ) : models.length === 0 ? (
    <Input
      placeholder="default"
      value={model}
      onChange={(e) => setModel(e.target.value)}
      className="font-mono"
      spellCheck={false}
    />
  ) : (
    <Select
      value={customModel ? CUSTOM_MODEL : modelInList ? model : ""}
      onChange={(e) => selectModel(e.target.value)}
    >
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
  );

  return (
    <Modal
      {...modal.props}
      dismissible={!mutation.isPending}
      size="lg"
      icon={isEdit ? EditIcon : AddIcon}
      title={isEdit ? "Edit runner" : "New runner"}
      description={
        isEdit
          ? "Change which tasks this runner claims and how it launches the tool."
          : "Claims tasks from the queue and runs a coding tool headless."
      }
      onSubmit={() => canSave && mutation.mutate()}
      footer={
        <>
          <Button variant="secondary" onClick={modal.close}>
            Cancel
          </Button>
          <Button
            type="submit"
            icon={isEdit ? SaveIcon : AddIcon}
            loading={mutation.isPending}
            disabled={!canSave}
          >
            {isEdit ? "Save changes" : "Create runner"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" required>
          <Input
            placeholder="e.g. claude-coder"
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Tool" icon={TerminalIcon} required>
            <Select
              value={effectiveTool}
              onChange={(e) => changeTool(e.target.value as RunnerTool)}
              disabled={toolsLoading}
            >
              {toolsLoading && <option value="">Detecting...</option>}
              {!toolsLoading && installed.length === 0 && (
                <option value="">No tools installed</option>
              )}
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
          </Field>
          <Field label="Project" icon={FolderIcon}>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              <option value="">Any project</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field
          label="Roles"
          icon={UserIcon}
          required
          aside={
            <Checkbox
              label="All"
              showLabel
              checked={roles.length === ROLES.length}
              indeterminate={roles.length > 0 && roles.length < ROLES.length}
              onChange={() => setRoles(roles.length === ROLES.length ? [] : [...ROLES])}
            />
          }
          hintTone={roles.length === 0 ? "danger" : "muted"}
          hint={
            roles.length === 0
              ? "Pick at least one role."
              : "The phases this runner works. The server verifies code itself, so verify is rarely needed."
          }
        >
          <div role="group" className="grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg border border-border p-3">
            {ROLES.map((r) => (
              <div key={r} className="min-w-0">
                <Checkbox
                  label={ROLE_INFO[r].label}
                  showLabel
                  checked={roles.includes(r)}
                  onChange={(on) => toggleRole(r, on)}
                />
                <p className="ml-6 text-xs leading-snug text-text-muted">{ROLE_INFO[r].description}</p>
              </div>
            ))}
          </div>
        </Field>

        <div className={cn("grid gap-4", showEffort ? "grid-cols-3" : "grid-cols-1")}>
          <Field
            label="Model"
            icon={ModelIcon}
            className={cn(showEffort && "col-span-2")}
            aside={
              discovery && (
                <IconButton
                  icon={RefreshIcon}
                  label="Refresh models"
                  size="xs"
                  loading={refreshingModels}
                  onClick={refreshModels}
                />
              )
            }
            hint={
              discovery && (
                <>
                  source: {discovery.source}
                  {models.length > 0 ? ` · ${pluralize(models.length, "model")}` : ""}
                </>
              )
            }
          >
            <ControlStack control={modelControl}>
              {customModel && (
                <Input
                  aria-label="Custom model id"
                  placeholder="model id"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="font-mono"
                  wrapperClassName="animate-slide-down"
                  spellCheck={false}
                  autoFocus={customMode === true}
                />
              )}
            </ControlStack>
          </Field>
          {showEffort && (
            <Field label="Effort" icon={EffortIcon}>
              <Select
                value={efforts!.includes(effort) ? effort : ""}
                onChange={(e) => setEffort(e.target.value)}
              >
                <option value="">(default{defaultEffort ? `: ${defaultEffort}` : ""})</option>
                {efforts!.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Concurrency" icon={ConcurrencyIcon} hint="Max jobs at the same time.">
            <Input
              type="number"
              min={1}
              max={16}
              value={concurrency}
              onChange={(e) => setConcurrency(e.target.value)}
            />
          </Field>
          <Field label="Poll interval (sec)" icon={ClockIcon} hint="How often it checks the queue.">
            <Input
              type="number"
              min={1}
              max={3600}
              value={pollIntervalSec}
              onChange={(e) => setPollIntervalSec(e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Permission mode"
          hintTone={permissionMode === "full" ? "warning" : "muted"}
          hint={
            permissionMode === "full"
              ? "Full skips every permission prompt and sandbox: the tool can run any command in the project directory."
              : "Safe auto-accepts edits and allows agentq, git, gh, bun/npm and read-only shell commands."
          }
        >
          <SegmentedControl
            label="Permission mode"
            value={permissionMode}
            onChange={(v) => setPermissionMode(v)}
            options={PERMISSION_OPTIONS}
          />
        </Field>

        <Field
          label={isCustomTool ? "Extra args (full command line)" : "Extra args"}
          icon={TerminalIcon}
          required={isCustomTool}
          hint={
            isCustomTool
              ? "Argv to run; the prompt is appended as the last argument and exposed as $AGENTQ_PROMPT."
              : "Appended to the generated command. Quoted or JSON array."
          }
        >
          <Input
            placeholder={isCustomTool ? 'bash -c "my-agent \\"$AGENTQ_TASK_ID\\""' : "--verbose"}
            value={extraArgs}
            onChange={(e) => setExtraArgs(e.target.value)}
            className="font-mono"
            spellCheck={false}
          />
        </Field>

        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Modal>
  );
}

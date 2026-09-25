import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import type {
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
  SafeModeIcon,
  SaveIcon,
  TerminalIcon,
  UserIcon,
} from "../lib/icons";
import { cn } from "../lib/cn";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Checkbox } from "./Checkbox";
import { Field } from "./Field";
import { Input } from "./Input";
import { Modal, useModal } from "./Modal";
import type { SegmentOption } from "./SegmentedControl";
import { SegmentedControl } from "./SegmentedControl";
import { Select } from "./Select";
import { DEFAULT_ROLES, ROLES, ROLE_INFO, normalizeRoles, type Role } from "@agentq/shared/catalog";

/** Effort levels per tool; null when the tool has no effort flag (see commands.ts). */
const TOOL_EFFORTS: Record<RunnerTool, string[] | null> = {
  claude: ["low", "medium", "high", "xhigh", "max"],
  codex: ["low", "medium", "high", "xhigh", "max"],
  opencode: ["minimal", "low", "medium", "high", "max"],
  gemini: null,
  custom: null,
};

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
  const [concurrency, setConcurrency] = useState(String(runner?.concurrency ?? 1));
  const [pollIntervalSec, setPollIntervalSec] = useState(String(runner?.pollIntervalSec ?? 5));
  const [permissionMode, setPermissionMode] = useState<RunnerPermissionMode>(
    runner?.permissionMode ?? "safe",
  );
  const [extraArgs, setExtraArgs] = useState(formatExtraArgs(runner?.extraArgs ?? null));
  const [error, setError] = useState<string | null>(null);

  // Pick the first installed tool once the list arrives (create mode only).
  const effectiveTool: RunnerTool | "" = tool || (isEdit ? "" : (installed[0]?.tool ?? ""));

  const toolEfforts = effectiveTool ? TOOL_EFFORTS[effectiveTool] : null;
  // Keep a stored effort that is not in the fixed list selectable, so editing does not drop it.
  const efforts =
    toolEfforts && effort && !toolEfforts.includes(effort) ? [...toolEfforts, effort] : toolEfforts;
  const showEffort = !!efforts;

  function changeTool(next: RunnerTool) {
    setTool(next);
    setModel("");
    setEffort("");
  }

  function toggleRole(role: Role, on: boolean) {
    setRoles((current) => normalizeRoles(on ? [...current, role] : current.filter((r) => r !== role)));
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
            hint="Leave empty to use the tool's default model."
          >
            <Input
              placeholder="default"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="font-mono"
              spellCheck={false}
            />
          </Field>
          {showEffort && (
            <Field label="Effort" icon={EffortIcon}>
              <Select value={effort} onChange={(e) => setEffort(e.target.value)}>
                <option value="">(default)</option>
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

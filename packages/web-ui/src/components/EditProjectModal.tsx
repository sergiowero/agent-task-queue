import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { AUTONOMY_LEVELS, type AutonomyLevel } from "@agentq/shared/catalog";
import { DEFAULT_POLICY, POLICY_RANGES } from "@agentq/shared/policy";
import { DEFAULT_PROFILE, PROFILE_RANGES } from "@agentq/shared/profile";
import { api } from "../lib/api";
import type { PolicySettings, ProjectProfile } from "../lib/api";
import { Tabs } from "./Tabs";
import { Textarea } from "./Textarea";
import { DeleteIcon, EditIcon, FolderIcon, MergeIcon, SaveIcon } from "../lib/icons";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Field } from "./Field";
import { Input } from "./Input";
import { Modal, useModal } from "./Modal";
import { Select } from "./Select";
import { Toggle } from "./Toggle";

interface ProjectRef {
  id: string;
  displayName: string;
  workingDirectory: string;
  defaultMergeBranch?: string | null;
  autonomy?: AutonomyLevel;
  policy?: Partial<PolicySettings>;
  profile?: ProjectProfile;
}

type ProjectTab = "general" | "autonomy" | "commands" | "guardrails";
const COMMANDS = ["install", "build", "typecheck", "lint", "test"] as const;
const lines = (v: string) =>
  v
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);
/** A number typed into a field, clamped to the range the server accepts (blank or junk: the default). */
const clamped = (value: string, { min, max }: { min: number; max: number }, fallback: number) => {
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? fallback : Math.min(max, Math.max(min, n));
};

const DOR_HINTS = {
  warn: "A task that is not ready is created with its problems listed.",
  enforce: "A task that is not ready is refused until the problems are fixed.",
  off: "New tasks are not checked.",
} as const;

interface EditProjectModalProps {
  project: ProjectRef;
  onClose: () => void;
  /** Open on this tab (default: General). */
  initialTab?: ProjectTab;
  /** The commands on the Commands tab were just detected from the repository: ask the person to check them. */
  detected?: boolean;
}

/** Delete confirmation for a project; shared by the projects grid and the edit modal. */
export function DeleteProjectDialog({
  project,
  onClose,
  onDeleted,
}: {
  project: Pick<ProjectRef, "id" | "displayName">;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });

  return (
    <ConfirmDialog
      title="Delete project?"
      message={
        <>
          <span className="font-medium text-text">{project.displayName}</span> will be deleted.
          Tasks in this project will become orphaned.
        </>
      }
      confirmLabel="Delete project"
      onConfirm={async () => {
        try {
          await mutation.mutateAsync();
          toast.success("Project deleted");
          onDeleted?.();
        } catch (e) {
          toast.error((e as Error).message);
          throw e;
        }
      }}
      onClose={onClose}
    />
  );
}

export function EditProjectModal({ project, onClose, initialTab = "general", detected = false }: EditProjectModalProps) {
  const queryClient = useQueryClient();
  const modal = useModal(onClose);
  const [displayName, setDisplayName] = useState(project.displayName);
  const [workingDirectory, setWorkingDirectory] = useState(project.workingDirectory);
  const [defaultMergeBranch, setDefaultMergeBranch] = useState(project.defaultMergeBranch ?? "");
  const [autonomy, setAutonomy] = useState<AutonomyLevel>(project.autonomy ?? 2);
  const policy = project.policy;
  const [maxReviewRounds, setMaxReviewRounds] = useState(String(policy?.maxReviewRounds ?? DEFAULT_POLICY.maxReviewRounds));
  const [maxPlanRounds, setMaxPlanRounds] = useState(String(policy?.maxPlanRounds ?? DEFAULT_POLICY.maxPlanRounds));
  const [maxVerifyFailures, setMaxVerifyFailures] = useState(
    String(policy?.maxVerifyFailures ?? DEFAULT_POLICY.maxVerifyFailures),
  );
  const [humanSampleEvery, setHumanSampleEvery] = useState(String(policy?.humanSampleEvery ?? DEFAULT_POLICY.humanSampleEvery));
  const [reviewStarvationMin, setReviewStarvationMin] = useState(
    String(policy?.reviewStarvationMin ?? DEFAULT_POLICY.reviewStarvationMin),
  );
  const [leaseMin, setLeaseMin] = useState(String(policy?.leaseMin ?? DEFAULT_POLICY.leaseMin));
  const [requireDifferentModel, setRequireDifferentModel] = useState(
    policy?.requireDifferentModel ?? DEFAULT_POLICY.requireDifferentModel,
  );
  const [autoMerge, setAutoMerge] = useState(policy?.autoMerge ?? DEFAULT_POLICY.autoMerge);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [tab, setTab] = useState<ProjectTab>(initialTab);
  const profile = project.profile;
  const [commands, setCommands] = useState<Record<string, string>>({
    ...(profile?.commands ?? {}),
  });
  const [protectedPaths, setProtectedPaths] = useState((profile?.protectedPaths ?? []).join("\n"));
  const [sharedGuardrails, setSharedGuardrails] = useState((profile?.guardrails ?? []).join("\n"));
  const [verifyAllowlist, setVerifyAllowlist] = useState(
    (profile?.verifyAllowlist ?? []).join("\n"),
  );
  const [maxDiffLines, setMaxDiffLines] = useState(String(profile?.maxDiffLines ?? DEFAULT_PROFILE.maxDiffLines));
  const [maxPlanFiles, setMaxPlanFiles] = useState(String(profile?.maxPlanFiles ?? DEFAULT_PROFILE.maxPlanFiles));
  const [maxCriteria, setMaxCriteria] = useState(String(profile?.maxCriteria ?? DEFAULT_PROFILE.maxCriteria));
  const [verifyTimeoutSec, setVerifyTimeoutSec] = useState(
    String(profile?.verifyTimeoutSec ?? DEFAULT_PROFILE.verifyTimeoutSec),
  );
  const [autoArchive, setAutoArchive] = useState(profile?.autoArchive ?? DEFAULT_PROFILE.autoArchive);
  const [dorMode, setDorMode] = useState<ProjectProfile["dorMode"]>(profile?.dorMode ?? DEFAULT_PROFILE.dorMode);
  const [detecting, setDetecting] = useState(false);

  async function detect() {
    setDetecting(true);
    try {
      const { commands: found } = await api.detectCommands(project.id);
      const filled = Object.fromEntries(Object.entries(found).filter(([, v]) => v));
      setCommands((c) => ({
        ...filled,
        ...Object.fromEntries(Object.entries(c).filter(([, v]) => v?.trim())),
      }));
      toast.success(Object.keys(filled).length ? "Commands detected" : "No commands found");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDetecting(false);
    }
  }

  const updateMutation = useMutation({
    mutationFn: () =>
      api.updateProject(project.id, {
        displayName,
        workingDirectory,
        defaultMergeBranch: defaultMergeBranch.trim() || null,
        autonomy,
        policy: {
          maxPlanRounds: clamped(maxPlanRounds, POLICY_RANGES.maxPlanRounds, DEFAULT_POLICY.maxPlanRounds),
          maxReviewRounds: clamped(maxReviewRounds, POLICY_RANGES.maxReviewRounds, DEFAULT_POLICY.maxReviewRounds),
          maxVerifyFailures: clamped(maxVerifyFailures, POLICY_RANGES.maxVerifyFailures, DEFAULT_POLICY.maxVerifyFailures),
          humanSampleEvery: clamped(humanSampleEvery, POLICY_RANGES.humanSampleEvery, DEFAULT_POLICY.humanSampleEvery),
          reviewStarvationMin: clamped(reviewStarvationMin, POLICY_RANGES.reviewStarvationMin, DEFAULT_POLICY.reviewStarvationMin),
          leaseMin: clamped(leaseMin, POLICY_RANGES.leaseMin, DEFAULT_POLICY.leaseMin),
          requireDifferentModel,
          autoMerge,
        },
        profile: {
          commands: Object.fromEntries(COMMANDS.map((k) => [k, commands[k]?.trim() ?? ""])),
          protectedPaths: lines(protectedPaths),
          guardrails: lines(sharedGuardrails),
          verifyAllowlist: lines(verifyAllowlist),
          maxDiffLines: clamped(maxDiffLines, PROFILE_RANGES.maxDiffLines, DEFAULT_PROFILE.maxDiffLines),
          maxPlanFiles: clamped(maxPlanFiles, PROFILE_RANGES.maxPlanFiles, DEFAULT_PROFILE.maxPlanFiles),
          maxCriteria: clamped(maxCriteria, PROFILE_RANGES.maxCriteria, DEFAULT_PROFILE.maxCriteria),
          verifyTimeoutSec: clamped(verifyTimeoutSec, PROFILE_RANGES.verifyTimeoutSec, DEFAULT_PROFILE.verifyTimeoutSec),
          autoArchive,
          dorMode,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project updated");
      modal.close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canSave = !!displayName.trim() && !!workingDirectory.trim() && !updateMutation.isPending;

  return (
    <>
      <Modal
        {...modal.props}
        // The confirm dialog handles Escape itself; don't close both at once.
        dismissible={!updateMutation.isPending && !confirmingDelete}
        icon={EditIcon}
        title="Edit project"
        description="Where it lives, how autonomous its agents are, and what they need to know to work in it."
        onSubmit={() => canSave && updateMutation.mutate()}
        footerStart={
          <Button
            variant="danger-ghost"
            icon={DeleteIcon}
            onClick={() => setConfirmingDelete(true)}
            disabled={updateMutation.isPending}
          >
            Delete
          </Button>
        }
        footer={
          <>
            <Button variant="secondary" onClick={modal.close}>
              Cancel
            </Button>
            <Button
              type="submit"
              icon={SaveIcon}
              loading={updateMutation.isPending}
              disabled={!canSave}
            >
              Save changes
            </Button>
          </>
        }
      >
        <Tabs<ProjectTab>
          label="Project settings"
          value={tab}
          onChange={setTab}
          className="mb-4 border-b border-border-light"
          items={[
            { value: "general", label: "General" },
            { value: "autonomy", label: "Autonomy" },
            { value: "commands", label: "Commands" },
            { value: "guardrails", label: "Guardrails" },
          ]}
        />
        {tab === "general" && (
          <div className="space-y-4">
            <Field label="Display name" required>
              <Input
                placeholder="My project"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                autoFocus
              />
            </Field>
            <Field label="Working directory" icon={FolderIcon} required>
              <Input
                placeholder="/path/to/repo"
                value={workingDirectory}
                onChange={(e) => setWorkingDirectory(e.target.value)}
                className="font-mono"
                spellCheck={false}
              />
            </Field>
            <Field
              label="Default merge branch"
              icon={MergeIcon}
              hint="Pull requests target this branch unless a task names another. Empty: detect it from origin/HEAD."
            >
              <Input
                placeholder="main"
                value={defaultMergeBranch}
                onChange={(e) => setDefaultMergeBranch(e.target.value)}
                className="font-mono"
                spellCheck={false}
              />
            </Field>
            <Toggle
              checked={autoArchive}
              onChange={setAutoArchive}
              label="Archive a task when its pull request is merged"
              description="Saves its summary and full record in the project's archive folder and clears it from the board."
            />
            <Field label="Definition of Ready" hint={DOR_HINTS[dorMode]}>
              <Select value={dorMode} onChange={(e) => setDorMode(e.target.value as ProjectProfile["dorMode"])}>
                <option value="warn">Warn</option>
                <option value="enforce">Enforce</option>
                <option value="off">Off</option>
              </Select>
            </Field>
          </div>
        )}
        {tab === "autonomy" && (
          <div className="space-y-4">
            <Field label="Autonomy" hint={AUTONOMY_LEVELS[autonomy].description}>
              <Select
                value={String(autonomy)}
                onChange={(e) => setAutonomy(Number(e.target.value) as AutonomyLevel)}
              >
                {Object.entries(AUTONOMY_LEVELS).map(([value, l]) => (
                  <option key={value} value={value}>
                    {l.label}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="AI review rounds" hint="Change requests before a person decides.">
                <Input
                  type="number"
                  {...POLICY_RANGES.maxReviewRounds}
                  value={maxReviewRounds}
                  onChange={(e) => setMaxReviewRounds(e.target.value)}
                />
              </Field>
              <Field label="Plan critique rounds" hint="Critiques asking for changes before a person decides.">
                <Input
                  type="number"
                  {...POLICY_RANGES.maxPlanRounds}
                  value={maxPlanRounds}
                  onChange={(e) => setMaxPlanRounds(e.target.value)}
                />
              </Field>
              <Field label="Failed verifications" hint="Red verifications in a row before a person decides.">
                <Input
                  type="number"
                  {...POLICY_RANGES.maxVerifyFailures}
                  value={maxVerifyFailures}
                  onChange={(e) => setMaxVerifyFailures(e.target.value)}
                />
              </Field>
              <Field
                label="Human spot check"
                hint="Every Nth AI approval also goes to you (0 = never)."
              >
                <Input
                  type="number"
                  {...POLICY_RANGES.humanSampleEvery}
                  value={humanSampleEvery}
                  onChange={(e) => setHumanSampleEvery(e.target.value)}
                />
              </Field>
              <Field
                label="Wait for a reviewer (min)"
                hint="A review or plan critique no eligible agent picked up goes to you after this (0 = never)."
              >
                <Input
                  type="number"
                  {...POLICY_RANGES.reviewStarvationMin}
                  value={reviewStarvationMin}
                  onChange={(e) => setReviewStarvationMin(e.target.value)}
                />
              </Field>
              <Field
                label="Session lease (min)"
                hint="A hand-opened agent session silent this long loses its task."
              >
                <Input
                  type="number"
                  {...POLICY_RANGES.leaseMin}
                  value={leaseMin}
                  onChange={(e) => setLeaseMin(e.target.value)}
                />
              </Field>
            </div>
            <Toggle
              checked={requireDifferentModel}
              onChange={setRequireDifferentModel}
              label="Reviewer uses a different model"
              description="A plan critique, verification or AI review is never claimed by an agent on the model of anyone who wrote the plan or code. A blank model counts as the tool's own default."
            />
            <Toggle
              checked={autoMerge}
              onChange={setAutoMerge}
              disabled={autonomy !== 3}
              label="Auto-merge green, low-risk pull requests"
              description={
                autonomy === 3
                  ? "AgentQ merges a PR by itself when its task is low risk, every check is green, no reviewer asks for changes and its head is the approved commit. Anything else waits for you."
                  : "Only at level 3 (Autonomous): choose that level to turn it on."
              }
            />
          </div>
        )}
        {tab === "commands" && (
          <div className="space-y-4">
            {detected && (
              <Alert tone="info" title="Commands found in the repository">
                Check them: the verifier runs every one after each code submission. Clear the ones you do not want.
              </Alert>
            )}
            <p className="text-sm text-text-secondary">
              The verifier runs these in the task's worktree after every code submission (install
              first), and agents read them in their brief. Leave a command empty to skip it.
            </p>
            <Button variant="secondary" size="sm" loading={detecting} onClick={detect}>
              Detect from the repository
            </Button>
            {COMMANDS.map((k) => (
              <Field key={k} label={k[0].toUpperCase() + k.slice(1)}>
                <Input
                  className="font-mono"
                  spellCheck={false}
                  placeholder={k === "test" ? "bun test" : ""}
                  value={commands[k] ?? ""}
                  onChange={(e) => setCommands((c) => ({ ...c, [k]: e.target.value }))}
                />
              </Field>
            ))}
            <Field label="Verify timeout (seconds)" hint="Each command may run this long before the verifier stops it.">
              <Input
                type="number"
                {...PROFILE_RANGES.verifyTimeoutSec}
                value={verifyTimeoutSec}
                onChange={(e) => setVerifyTimeoutSec(e.target.value)}
              />
            </Field>
          </div>
        )}
        {tab === "guardrails" && (
          <div className="space-y-4">
            <Field
              label="Shared guardrails"
              hint="Every task in the project inherits them. One per line."
            >
              <Textarea
                rows={3}
                value={sharedGuardrails}
                onChange={(e) => setSharedGuardrails(e.target.value)}
              />
            </Field>
            <Field
              label="Protected paths"
              hint="Globs; touching one raises a task's risk to high (a person reviews it). One per line."
            >
              <Textarea
                rows={3}
                className="font-mono"
                placeholder={"migrations/**\n.github/**"}
                value={protectedPaths}
                onChange={(e) => setProtectedPaths(e.target.value)}
              />
            </Field>
            <Field label="Largest diff before high risk" hint="Added plus deleted lines.">
              <Input
                type="number"
                {...PROFILE_RANGES.maxDiffLines}
                value={maxDiffLines}
                onChange={(e) => setMaxDiffLines(e.target.value)}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Most files per plan" hint="Planners split bigger plans into subtasks.">
                <Input type="number" {...PROFILE_RANGES.maxPlanFiles} value={maxPlanFiles} onChange={(e) => setMaxPlanFiles(e.target.value)} />
              </Field>
              <Field label="Most criteria per task" hint="More criteria: split into subtasks.">
                <Input type="number" {...PROFILE_RANGES.maxCriteria} value={maxCriteria} onChange={(e) => setMaxCriteria(e.target.value)} />
              </Field>
            </div>
            <Field
              label="Verify allowlist"
              hint="Command prefixes the verifier may run from an agent's plan without a person approving it. One per line."
            >
              <Textarea
                rows={2}
                className="font-mono"
                value={verifyAllowlist}
                onChange={(e) => setVerifyAllowlist(e.target.value)}
              />
            </Field>
          </div>
        )}
      </Modal>
      {confirmingDelete && (
        <DeleteProjectDialog
          project={project}
          onClose={() => setConfirmingDelete(false)}
          onDeleted={modal.close}
        />
      )}
    </>
  );
}

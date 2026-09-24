import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { AUTONOMY_LEVELS, type AutonomyLevel } from "@agentq/shared/catalog";
import { api } from "../lib/api";
import type { PolicySettings, ProjectProfile } from "../lib/api";
import { Tabs } from "./Tabs";
import { Textarea } from "./Textarea";
import { DeleteIcon, EditIcon, FolderIcon, MergeIcon, SaveIcon } from "../lib/icons";
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

type ProjectTab = "general" | "autonomy" | "commands" | "conventions";
const COMMANDS = ["install", "build", "typecheck", "lint", "test"] as const;
const lines = (v: string) =>
  v
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean);

interface EditProjectModalProps {
  project: ProjectRef;
  onClose: () => void;
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

export function EditProjectModal({ project, onClose }: EditProjectModalProps) {
  const queryClient = useQueryClient();
  const modal = useModal(onClose);
  const [displayName, setDisplayName] = useState(project.displayName);
  const [workingDirectory, setWorkingDirectory] = useState(project.workingDirectory);
  const [defaultMergeBranch, setDefaultMergeBranch] = useState(project.defaultMergeBranch ?? "");
  const [autonomy, setAutonomy] = useState<AutonomyLevel>(project.autonomy ?? 2);
  const [maxReviewRounds, setMaxReviewRounds] = useState(
    String(project.policy?.maxReviewRounds ?? 3),
  );
  const [humanSampleEvery, setHumanSampleEvery] = useState(
    String(project.policy?.humanSampleEvery ?? 0),
  );
  const [requireDifferentModel, setRequireDifferentModel] = useState(
    project.policy?.requireDifferentModel ?? false,
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [tab, setTab] = useState<ProjectTab>("general");
  const profile = project.profile;
  const [commands, setCommands] = useState<Record<string, string>>({
    ...(profile?.commands ?? {}),
  });
  const [conventionFiles, setConventionFiles] = useState(
    (profile?.conventionFiles ?? []).join("\n"),
  );
  const [protectedPaths, setProtectedPaths] = useState((profile?.protectedPaths ?? []).join("\n"));
  const [sharedGuardrails, setSharedGuardrails] = useState((profile?.guardrails ?? []).join("\n"));
  const [verifyAllowlist, setVerifyAllowlist] = useState(
    (profile?.verifyAllowlist ?? []).join("\n"),
  );
  const [maxDiffLines, setMaxDiffLines] = useState(String(profile?.maxDiffLines ?? 400));
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
          maxReviewRounds: Math.max(1, parseInt(maxReviewRounds, 10) || 3),
          humanSampleEvery: Math.max(0, parseInt(humanSampleEvery, 10) || 0),
          requireDifferentModel,
        },
        profile: {
          commands: Object.fromEntries(COMMANDS.map((k) => [k, commands[k]?.trim() ?? ""])),
          conventionFiles: lines(conventionFiles),
          protectedPaths: lines(protectedPaths),
          guardrails: lines(sharedGuardrails),
          verifyAllowlist: lines(verifyAllowlist),
          maxDiffLines: Math.max(10, parseInt(maxDiffLines, 10) || 400),
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
            { value: "conventions", label: "Conventions" },
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
                  min={1}
                  max={10}
                  value={maxReviewRounds}
                  onChange={(e) => setMaxReviewRounds(e.target.value)}
                />
              </Field>
              <Field
                label="Human spot check"
                hint="Every Nth AI approval also goes to you (0 = never)."
              >
                <Input
                  type="number"
                  min={0}
                  value={humanSampleEvery}
                  onChange={(e) => setHumanSampleEvery(e.target.value)}
                />
              </Field>
            </div>
            <Toggle
              checked={requireDifferentModel}
              onChange={setRequireDifferentModel}
              label="Reviewer uses a different model"
              description="An AI review is never claimed by an agent on the coder's model."
            />
          </div>
        )}
        {tab === "commands" && (
          <div className="space-y-4">
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
          </div>
        )}
        {tab === "conventions" && (
          <div className="space-y-4">
            <Field
              label="Convention files"
              hint="Agents read these first. One path per line (CLAUDE.md, AGENTS.md…)."
            >
              <Textarea
                rows={3}
                className="font-mono"
                value={conventionFiles}
                onChange={(e) => setConventionFiles(e.target.value)}
              />
            </Field>
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
                min={10}
                value={maxDiffLines}
                onChange={(e) => setMaxDiffLines(e.target.value)}
              />
            </Field>
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

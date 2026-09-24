import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { AUTONOMY_LEVELS, type AutonomyLevel } from "@agentq/shared/catalog";
import { api } from "../lib/api";
import type { PolicySettings } from "../lib/api";
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
}

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
  const [maxReviewRounds, setMaxReviewRounds] = useState(String(project.policy?.maxReviewRounds ?? 3));
  const [humanSampleEvery, setHumanSampleEvery] = useState(String(project.policy?.humanSampleEvery ?? 0));
  const [requireDifferentModel, setRequireDifferentModel] = useState(project.policy?.requireDifferentModel ?? false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

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
        description="Rename the project or point it at another directory."
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
          <Field label="Autonomy" hint={AUTONOMY_LEVELS[autonomy].description}>
            <Select value={String(autonomy)} onChange={(e) => setAutonomy(Number(e.target.value) as AutonomyLevel)}>
              {Object.entries(AUTONOMY_LEVELS).map(([value, l]) => (
                <option key={value} value={value}>
                  {l.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="AI review rounds" hint="Change requests before a person decides.">
              <Input type="number" min={1} max={10} value={maxReviewRounds} onChange={(e) => setMaxReviewRounds(e.target.value)} />
            </Field>
            <Field label="Human spot check" hint="Every Nth AI approval also goes to you (0 = never).">
              <Input type="number" min={0} value={humanSampleEvery} onChange={(e) => setHumanSampleEvery(e.target.value)} />
            </Field>
          </div>
          <Toggle
            checked={requireDifferentModel}
            onChange={setRequireDifferentModel}
            label="Reviewer uses a different model"
            description="An AI review is never claimed by an agent on the coder's model."
          />
        </div>
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

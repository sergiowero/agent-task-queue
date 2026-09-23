import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import toast from "react-hot-toast";
import { api } from "../lib/api";
import { DeleteIcon, EditIcon, FolderIcon, SaveIcon } from "../lib/icons";
import { Button } from "./Button";
import { ConfirmDialog } from "./ConfirmDialog";
import { Field } from "./Field";
import { Input } from "./Input";
import { Modal, useModal } from "./Modal";

interface ProjectRef {
  id: string;
  displayName: string;
  workingDirectory: string;
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const updateMutation = useMutation({
    mutationFn: () => api.updateProject(project.id, { displayName, workingDirectory }),
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

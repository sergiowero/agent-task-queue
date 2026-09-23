import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../lib/api";
import type { ArchiveResult, Project, Task } from "../lib/api";
import { ArchiveIcon } from "../lib/icons";
import { ConfirmDialog } from "./ConfirmDialog";

interface ArchiveTaskModalProps {
  task: Task;
  /** The task's project, to show where the files go. */
  project?: Project | null;
  onClose: () => void;
  onArchived?: (result: ArchiveResult) => void;
}

/** Confirms archiving a complete task into its project's archive/ folder. */
export function ArchiveTaskModal({ task, project, onClose, onArchived }: ArchiveTaskModalProps) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.archiveTask(task.id),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["task", task.id] });
      const file = result.summaryPath.split(/[\\/]/).pop();
      toast.success(`Archived to archive/${file}`);
      onArchived?.(result);
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const folder = project
    ? `${project.workingDirectory.replace(/[\\/]+$/, "")}/archive`
    : "archive/";

  return (
    <ConfirmDialog
      title="Archive task"
      icon={ArchiveIcon}
      tone="primary"
      confirmLabel="Archive"
      message={
        <>
          <span className="font-medium text-text">{task.title}</span> is saved as two Markdown files
          in <span className="break-all font-mono text-xs text-text">{folder}</span>: a summary with
          the description, and a full record with the conversation, branch, pull request and every
          agent that worked on it. Then it leaves the board.
        </>
      }
      // Rejects on failure (already toasted), which keeps the dialog open for a retry.
      onConfirm={() => mutation.mutateAsync()}
      onClose={onClose}
    />
  );
}

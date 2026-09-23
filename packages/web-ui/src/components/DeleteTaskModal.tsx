import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../lib/api";
import type { Task } from "../lib/api";
import { DeleteIcon } from "../lib/icons";
import { ConfirmDialog } from "./ConfirmDialog";

interface DeleteTaskModalProps {
  task: Task;
  onClose: () => void;
  onDeleted?: () => void;
}

export function DeleteTaskModal({ task, onClose, onDeleted }: DeleteTaskModalProps) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.deleteTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task deleted");
      onDeleted?.();
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  return (
    <ConfirmDialog
      title="Delete task"
      icon={DeleteIcon}
      confirmLabel="Delete task"
      message={
        <>
          <span className="font-medium text-text">{task.title}</span> will be permanently deleted.
          This cannot be undone.
        </>
      }
      // Rejects on failure, which keeps the dialog open for a retry.
      onConfirm={() => mutation.mutateAsync()}
      onClose={onClose}
    />
  );
}

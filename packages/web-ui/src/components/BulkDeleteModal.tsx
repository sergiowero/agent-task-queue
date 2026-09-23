import { useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../lib/api";
import { DeleteIcon } from "../lib/icons";
import { pluralize } from "../lib/format";
import { ConfirmDialog } from "./ConfirmDialog";

interface BulkDeleteModalProps {
  taskIds: string[];
  onClose: () => void;
  onDeleted?: () => void;
}

export function BulkDeleteModal({ taskIds, onClose, onDeleted }: BulkDeleteModalProps) {
  const queryClient = useQueryClient();
  const count = pluralize(taskIds.length, "task");

  const mutation = useMutation({
    mutationFn: () => Promise.all(taskIds.map((id) => api.deleteTask(id))),
    onSuccess: () => {
      toast.success(`${count} deleted`);
      onDeleted?.();
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
    // Some deletions may have gone through even when another failed.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  return (
    <ConfirmDialog
      title={`Delete ${count}`}
      icon={DeleteIcon}
      confirmLabel={taskIds.length === 1 ? "Delete" : "Delete all"}
      message={
        taskIds.length === 1 ? (
          "The selected task will be permanently deleted. This cannot be undone."
        ) : (
          <>
            All <span className="font-medium text-text">{count}</span> you selected will be
            permanently deleted. This cannot be undone.
          </>
        )
      }
      // Rejects on failure, which keeps the dialog open for a retry.
      onConfirm={() => mutation.mutateAsync()}
      onClose={onClose}
    />
  );
}

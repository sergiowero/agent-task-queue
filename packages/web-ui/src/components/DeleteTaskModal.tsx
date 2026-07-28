import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import toast from "react-hot-toast";
import { api } from "../lib/api";
import { Button } from "./Button";
import type { Task } from "../lib/api";

interface DeleteTaskModalProps {
  task: Task;
  onClose: () => void;
  onDeleted?: () => void;
}

export function DeleteTaskModal({ task, onClose, onDeleted }: DeleteTaskModalProps) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: () => api.deleteTask(task.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task deleted");
      onDeleted?.();
      onClose();
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-6 transition-colors duration-300">
        <h2 className="text-lg font-semibold mb-2 text-text">Delete Task</h2>
        <p className="text-sm text-text-secondary mb-4">
          Are you sure you want to delete{" "}
          <span className="font-medium text-text">{task.title}</span>? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="secondary" disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} variant="danger">
            {mutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}

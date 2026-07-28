import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
import { api } from "../lib/api";
import { Button } from "./Button";
import { Input } from "./Input";

interface EditProjectModalProps {
  project: {
    id: string;
    displayName: string;
    workingDirectory: string;
  };
  onClose: () => void;
}

export function EditProjectModal({ project, onClose }: EditProjectModalProps) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState(project.displayName);
  const [workingDirectory, setWorkingDirectory] = useState(project.workingDirectory);
  const titleId = "edit-project-title";
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const updateMutation = useMutation({
    mutationFn: () => api.updateProject(project.id, { displayName, workingDirectory }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project updated");
      onClose();
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project deleted");
      onClose();
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const canSave = displayName && workingDirectory && !updateMutation.isPending;

  function handleDelete() {
    if (window.confirm("Delete this project? Tasks in this project will become orphaned.")) {
      deleteMutation.mutate();
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div ref={modalRef} className="bg-surface rounded-xl shadow-lg w-full max-w-lg p-6 transition-colors duration-300">
        <h2 id={titleId} className="text-lg font-semibold mb-4 text-text">Edit Project</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="edit-name">Display Name *</label>
            <Input
              id="edit-name"
              placeholder="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="edit-dir">Working Directory *</label>
            <Input
              id="edit-dir"
              placeholder="Working Directory"
              value={workingDirectory}
              onChange={(e) => setWorkingDirectory(e.target.value)}
              className="font-mono"
            />
          </div>
        </div>
        <div className="flex justify-between mt-4">
          <Button onClick={handleDelete} variant="danger" disabled={deleteMutation.isPending}>
            Delete
          </Button>
          <div className="flex gap-2">
            <Button onClick={onClose} variant="secondary">
              Cancel
            </Button>
            <Button onClick={() => updateMutation.mutate()} disabled={!canSave} variant="primary">
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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

  const updateMutation = useMutation({
    mutationFn: () =>
      api.updateProject(project.id, { displayName, workingDirectory }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
  });

  const canSave = displayName && workingDirectory && !updateMutation.isPending;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-surface rounded-xl shadow-lg w-full max-w-lg p-6 transition-colors duration-300">
        <h2 className="text-lg font-semibold mb-4 text-text">Edit Project</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text mb-1">Display Name *</label>
            <Input
              placeholder="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Working Directory *</label>
            <Input
              placeholder="Working Directory"
              value={workingDirectory}
              onChange={(e) => setWorkingDirectory(e.target.value)}
              className="font-mono"
            />
          </div>
        </div>
        <div className="flex justify-between mt-4">
          <Button
            onClick={() => {
              if (window.confirm("Delete this project? Tasks in this project will become orphaned.")) {
                deleteMutation.mutate();
              }
            }}
            variant="danger"
            disabled={deleteMutation.isPending}
          >
            Delete
          </Button>
          <div className="flex gap-2">
            <Button onClick={onClose} variant="secondary">Cancel</Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={!canSave}
              variant="primary"
            >
              {updateMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

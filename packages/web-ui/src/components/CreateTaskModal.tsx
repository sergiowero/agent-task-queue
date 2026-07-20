import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { Button } from "./Button";
import { Input } from "./Input";
import { Textarea } from "./Textarea";
import { Toggle } from "./Toggle";

interface CreateTaskModalProps {
  projectId?: string;
  onClose: () => void;
}

export function CreateTaskModal({ projectId, onClose }: CreateTaskModalProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(0);
  const [branch, setBranch] = useState("");
  const [requiresPlan, setRequiresPlan] = useState(false);
  const [criteria, setCriteria] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      api.createTask({
        title,
        description: description || undefined,
        priority,
        recommendedBranch: branch || undefined,
        requiresPlan,
        acceptanceCriteria: criteria ? criteria.split("\n").filter(Boolean) : undefined,
        projectId: projectId || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-surface rounded-xl shadow-lg w-full max-w-lg p-6 transition-colors duration-300">
        <h2 className="text-lg font-semibold mb-4 text-text">New Task</h2>
        <div className="space-y-3">
          <Input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <Textarea
            placeholder="Description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <div className="flex gap-3">
            <Input
              type="number"
              placeholder="Priority"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
            <Input
              placeholder="Branch name"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="font-mono"
            />
          </div>
          <Toggle
            checked={requiresPlan}
            onChange={setRequiresPlan}
            label="Requires planning"
          />
          <Textarea
            placeholder="Acceptance criteria (one per line)"
            rows={3}
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={onClose} variant="secondary">Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!title || mutation.isPending}
            variant="primary"
          >
            {mutation.isPending ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

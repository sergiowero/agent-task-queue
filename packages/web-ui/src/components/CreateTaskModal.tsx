import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { Button } from "./Button";
import { Input } from "./Input";
import { Textarea } from "./Textarea";
import { Toggle } from "./Toggle";
import { Select } from "./Select";

interface CreateTaskModalProps {
  projectId?: string;
  onClose: () => void;
}

export function CreateTaskModal({ projectId, onClose }: CreateTaskModalProps) {
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(0);
  const [branch, setBranch] = useState("");
  const [mergeBranch, setMergeBranch] = useState("develop");
  const [requiresPlan, setRequiresPlan] = useState(false);
  const [steerDetails, setSteerDetails] = useState("");
  const [guardrails, setGuardrails] = useState("");
  const [criteria, setCriteria] = useState("");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: api.getProjects,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.createTask({
        title,
        description,
        steerDetails: steerDetails || undefined,
        guardrails: guardrails ? guardrails.split("\n").filter(Boolean) : undefined,
        priority,
        recommendedBranch: branch || undefined,
        mergeBranch,
        requiresPlan,
        acceptanceCriteria: criteria ? criteria.split("\n").filter(Boolean) : undefined,
        projectId: selectedProjectId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      onClose();
    },
  });

  const canCreate = title && description && selectedProjectId && !mutation.isPending;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-surface rounded-xl shadow-lg w-full max-w-lg p-6 transition-colors duration-300">
        <h2 className="text-lg font-semibold mb-4 text-text">New Task</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text mb-1">Project *</label>
            <Select
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              <option value="">Select a project...</option>
              {projects.map((p: any) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Title *</label>
            <Input
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Description *</label>
            <Textarea
              placeholder="Description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-text mb-1">Priority</label>
              <Input
                type="number"
                placeholder="0"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-text mb-1">Branch Name</label>
              <Input
                placeholder="Branch name"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Merge Branch</label>
            <Input
              placeholder="Merge branch"
              value={mergeBranch}
              onChange={(e) => setMergeBranch(e.target.value)}
              className="font-mono"
            />
          </div>
          <Toggle
            checked={requiresPlan}
            onChange={setRequiresPlan}
            label="Requires planning"
          />
          <div>
            <label className="block text-sm font-medium text-text mb-1">Steer Details</label>
            <Textarea
              placeholder="Implementation guidance, technical recommendations, preferred approaches"
              rows={3}
              value={steerDetails}
              onChange={(e) => setSteerDetails(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Guardrails</label>
            <Textarea
              placeholder="One constraint per line"
              rows={3}
              value={guardrails}
              onChange={(e) => setGuardrails(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Acceptance Criteria</label>
            <Textarea
              placeholder="One criterion per line"
              rows={3}
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={onClose} variant="secondary">Cancel</Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canCreate}
            variant="primary"
          >
            {mutation.isPending ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

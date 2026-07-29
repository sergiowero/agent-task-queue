import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import toast from "react-hot-toast";
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
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(0);
  const [branch, setBranch] = useState("");
  const [mergeBranch, setMergeBranch] = useState("develop");
  const [requiresPlan, setRequiresPlan] = useState(false);
  const [criteria, setCriteria] = useState("");
  const [steerDetails, setSteerDetails] = useState("");
  const [guardrails, setGuardrails] = useState("");
  const titleId = "create-task-title";
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
      toast.success("Task created");
      onClose();
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const canCreate = title && description && selectedProjectId && !mutation.isPending;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div ref={modalRef} className="bg-surface rounded-xl shadow-lg w-full max-w-lg p-6 transition-colors duration-300">
        <h2 id={titleId} className="text-lg font-semibold mb-4 text-text">New Task</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="project-select">Project *</label>
            <select
              id="project-select"
              className="border border-border bg-surface-secondary text-text rounded px-3 py-2 text-sm w-full"
              value={selectedProjectId}
              onChange={(e) => setSelectedProjectId(e.target.value)}
            >
              <option value="">Select a project...</option>
              {projects.map((p: any) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="task-title">Title *</label>
            <Input id="task-title" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="task-desc">Description *</label>
            <Textarea
              id="task-desc"
              placeholder="Description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-text mb-1" htmlFor="task-priority">Priority</label>
              <Input
                id="task-priority"
                type="number"
                placeholder="0"
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-text mb-1" htmlFor="task-branch">Branch Name</label>
              <Input
                id="task-branch"
                placeholder="Branch name"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="merge-branch">Merge Branch</label>
            <Input
              id="merge-branch"
              placeholder="Merge branch"
              value={mergeBranch}
              onChange={(e) => setMergeBranch(e.target.value)}
              className="font-mono"
            />
          </div>
          <Toggle checked={requiresPlan} onChange={setRequiresPlan} label="Requires planning" />
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="steer-details">Steer Details</label>
            <Textarea
              id="steer-details"
              placeholder="Implementation guidance, technical recommendations, preferred approaches"
              rows={3}
              value={steerDetails}
              onChange={(e) => setSteerDetails(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="guardrails">Guardrails</label>
            <Textarea
              id="guardrails"
              placeholder="One constraint per line"
              rows={3}
              value={guardrails}
              onChange={(e) => setGuardrails(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="criteria">Acceptance Criteria</label>
            <Textarea
              id="criteria"
              placeholder="One criterion per line"
              rows={3}
              value={criteria}
              onChange={(e) => setCriteria(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={onClose} variant="secondary">
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={!canCreate} variant="primary">
            {mutation.isPending ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

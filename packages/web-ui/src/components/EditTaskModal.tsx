import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useRef, useEffect } from "react";
import toast from "react-hot-toast";
import { api } from "../lib/api";
import { Button } from "./Button";
import { Input } from "./Input";
import { Textarea } from "./Textarea";
import type { Task } from "../lib/api";

interface EditTaskModalProps {
  task: Task;
  onClose: () => void;
  onSaved: (task: Task) => void;
}

export function EditTaskModal({ task, onClose, onSaved }: EditTaskModalProps) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [branch, setBranch] = useState(task.recommendedBranch);
  const [mergeBranch, setMergeBranch] = useState(task.mergeBranch);
  const [criteria, setCriteria] = useState(task.acceptanceCriteria?.join("\n") ?? "");
  const [steerDetails, setSteerDetails] = useState(task.steerDetails ?? "");
  const [guardrails, setGuardrails] = useState(task.guardrails?.join("\n") ?? "");
  const titleId = "edit-task-title";
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

  const mutation = useMutation({
    mutationFn: () =>
      api.updateTask(task.id, {
        title,
        description: description || null,
        steerDetails: steerDetails || null,
        guardrails: guardrails ? guardrails.split("\n").filter(Boolean) : [],
        priority,
        recommendedBranch: branch || undefined,
        mergeBranch,
        acceptanceCriteria: criteria ? criteria.split("\n").filter(Boolean) : [],
      }),
    onSuccess: (result: Task) => {
      queryClient.setQueryData(["task", task.id], result);
      queryClient.setQueryData<Task[]>(["tasks"], (old) =>
        old ? old.map((t) => (t.id === task.id ? { ...t, ...result } : t)) : undefined,
      );
      toast.success("Task updated");
      onSaved(result);
      onClose();
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const canSave = title.trim() && !mutation.isPending;

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div
        ref={modalRef}
        className="bg-surface rounded-xl shadow-lg w-full max-w-2xl p-6 transition-colors duration-300 max-h-[90vh] overflow-y-auto"
      >
        <h2 id={titleId} className="text-lg font-semibold mb-4 text-text">
          Edit Task
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="edit-title">
              Title
            </label>
            <Input
              id="edit-title"
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="edit-desc">
              Description
            </label>
            <Textarea
              id="edit-desc"
              placeholder="Description"
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-text mb-1" htmlFor="edit-priority">
                Priority
              </label>
              <Input
                id="edit-priority"
                type="number"
                placeholder="0"
                min={0}
                value={priority}
                onChange={(e) => setPriority(Number(e.target.value))}
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-text mb-1" htmlFor="edit-branch">
                Branch Name
              </label>
              <Input
                id="edit-branch"
                placeholder="Branch name"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                className="font-mono"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="edit-merge-branch">
              Merge Branch
            </label>
            <Input
              id="edit-merge-branch"
              placeholder="Merge branch"
              value={mergeBranch}
              onChange={(e) => setMergeBranch(e.target.value)}
              className="font-mono"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="edit-steer-details">
              Steer Details
            </label>
            <Textarea
              id="edit-steer-details"
              placeholder="Implementation guidance, technical recommendations, preferred approaches"
              rows={3}
              value={steerDetails}
              onChange={(e) => setSteerDetails(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="edit-guardrails">
              Guardrails
            </label>
            <Textarea
              id="edit-guardrails"
              placeholder="One constraint per line"
              rows={3}
              value={guardrails}
              onChange={(e) => setGuardrails(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1" htmlFor="edit-criteria">
              Acceptance Criteria
            </label>
            <Textarea
              id="edit-criteria"
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
          <Button onClick={() => mutation.mutate()} disabled={!canSave} variant="primary">
            {mutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { Button } from "./Button";

interface TaskDrawerProps {
  taskId: string;
  onClose: () => void;
}

const ACTIVE_STATUSES = new Set([
  "new", "ready", "planning", "waiting_plan_review", "plan_changes_requested",
  "coding", "waiting_code_review", "code_review_requested", "reviewing",
  "changes_requested", "approved", "merging",
]);

export function TaskDrawer({ taskId, onClose }: TaskDrawerProps) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"summary" | "conversation" | "history">("summary");
  const [feedback, setFeedback] = useState("");

  const { data: task, isLoading } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api.getTask(taskId),
    refetchInterval: 5000,
  });

  const mutation = useMutation({
    mutationFn: async ({ action, data }: { action: string; data?: any }) => {
      const fn = (api as any)[action];
      if (!fn) throw new Error(`Unknown action: ${action}`);
      return data !== undefined ? fn(taskId, data) : fn(taskId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", taskId] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setFeedback("");
    },
  });

  if (isLoading || !task) {
    return (
      <div className="fixed inset-y-0 right-0 w-[480px] bg-surface border-l border-border shadow-lg flex items-center justify-center animate-slide-in-right">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  const doAction = (action: string, data?: any) => mutation.mutate({ action, data });

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-surface border-l border-border shadow-lg flex flex-col z-50 animate-slide-in-right transition-colors duration-300">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex-1 min-w-0">
          <h2 className="font-semibold text-text truncate">{task.title}</h2>
          <span className="text-xs text-text-muted">{task.status.replace(/_/g, " ")}</span>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text ml-2 text-xl transition-colors duration-150">
          &times;
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border shrink-0">
        {(["summary", "conversation", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-sm font-medium capitalize transition-colors duration-150 ${
              tab === t ? "text-primary border-b-2 border-primary" : "text-text-muted hover:text-text"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {tab === "summary" && (
          <div className="space-y-3">
            <Field label="Title" value={task.title} />
            <Field label="Description" value={task.description || "—"} />
            <Field label="Priority" value={String(task.priority)} />
            <Field label="Branch" value={task.recommendedBranch || "—"} mono />
            <Field label="Merge Target" value={task.mergeBranch} mono />
            <Field label="Requires Plan" value={task.requiresPlan ? "Yes" : "No"} />
            <Field label="Assigned Agent" value={task.assignedAgent?.name || "—"} />
            {task.acceptanceCriteria?.length > 0 && (
              <div>
                <label className="text-xs font-medium text-text-muted uppercase">Acceptance Criteria</label>
                <ul className="mt-1 text-sm text-text-secondary list-disc list-inside space-y-0.5">
                  {task.acceptanceCriteria.map((c: string, i: number) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === "conversation" && (
          <div className="space-y-3">
            {task.conversation?.length === 0 && (
              <p className="text-sm text-text-muted">No messages yet.</p>
            )}
            {task.conversation?.map((entry: any, i: number) => (
              <div key={i} className="border-l-2 border-border pl-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-text-secondary">{entry.authorName}</span>
                  <span className="text-xs text-text-muted">{new Date(entry.timestamp).toLocaleString()}</span>
                </div>
                <p className="text-sm text-text mt-0.5 whitespace-pre-wrap">{entry.message}</p>
              </div>
            ))}
          </div>
        )}

        {tab === "history" && (
          <div className="space-y-2">
            {task.history?.length === 0 && (
              <p className="text-sm text-text-muted">No history yet.</p>
            )}
            {task.history?.map((h: any, i: number) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className="text-text-muted">{new Date(h.timestamp).toLocaleString()}</span>
                <span className="text-text-muted">→</span>
                <span className="font-medium text-text-secondary">{h.new_status.replace(/_/g, " ")}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Feedback Input */}
      {(mutation.mutateAsync as any)?.status === "pending" && (
        <div className="px-4 py-2 text-sm text-primary border-t border-border">Processing...</div>
      )}

      {/* Action Buttons */}
      {ACTIVE_STATUSES.has(task.status) && (
        <div className="border-t border-border p-4 space-y-2 shrink-0">
          {task.status === "waiting_plan_review" && (
            <div className="flex gap-2">
              <Button onClick={() => doAction("approvePlan")} variant="primary">Approve Plan</Button>
              <Button onClick={() => doAction("requestPlanChanges", { message: feedback || "Plan changes requested." })} variant="secondary">
                Request Changes
              </Button>
            </div>
          )}
          {task.status === "waiting_code_review" && (
            <div className="flex gap-2">
              <Button onClick={() => doAction("approveCode")} variant="primary">Approve Code</Button>
              <Button onClick={() => doAction("requestCodeChanges", { message: feedback || "Code changes requested." })} variant="secondary">
                Request Changes
              </Button>
              <Button onClick={() => doAction("requestAiReview")} variant="secondary">AI Review</Button>
            </div>
          )}
          {task.status === "merged" && (
            <Button onClick={() => doAction("confirmCompletion")} variant="primary">Confirm Complete</Button>
          )}
          {["planning", "coding", "reviewing"].includes(task.status) && (
            <Button onClick={() => doAction("unblock")} variant="secondary">Unblock</Button>
          )}
          <Button onClick={() => doAction("cancel")} variant="danger">Cancel Task</Button>
          <input
            className="w-full border border-border rounded-lg px-3 py-1.5 text-sm mt-2 bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-surface transition-all duration-150"
            placeholder="Add feedback (optional)..."
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <label className="text-xs font-medium text-text-muted uppercase">{label}</label>
      <div className={`text-sm text-text mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

function ActionBtn({ onClick, color, children }: { onClick: () => void; color: string; children: React.ReactNode }) {
  const colors: Record<string, string> = {
    green: "bg-green-600 hover:bg-green-500",
    yellow: "bg-yellow-500 hover:bg-yellow-400",
    red: "bg-red-600 hover:bg-red-500",
    purple: "bg-purple-600 hover:bg-purple-500",
  };
  return (
    <button
      onClick={onClick}
      className={`flex-1 text-white text-sm py-1.5 rounded ${colors[color] ?? "bg-gray-600"}`}
    >
      {children}
    </button>
  );
}

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { ConversationEntryCard } from "../components/ConversationEntryCard";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { Skeleton } from "../components/Skeleton";

const STATUS_VARIANTS: Record<string, "default" | "success" | "warning" | "danger" | "info" | "purple"> = {
  plan_requested: "default",
  planning: "purple",
  coding: "info",
  reviewing: "warning",
  merging: "warning",
  complete: "success",
  merged: "success",
  canceled: "danger",
  waiting_plan_review: "warning",
  waiting_code_review: "warning",
  code_review_requested: "warning",
  changes_requested: "danger",
  plan_changes_requested: "danger",
  approved: "success",
};

const ACTIVE_STATUSES = new Set([
  "plan_requested", "ready for code", "planning", "waiting_plan_review", "plan_changes_requested",
  "coding", "waiting_code_review", "code_review_requested", "reviewing",
  "changes_requested", "approved", "merging",
]);

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"conversation" | "history">("conversation");
  const [feedback, setFeedback] = useState("");

  const { data: task, isLoading } = useQuery({
    queryKey: ["task", id],
    queryFn: () => api.getTask(id!),
    enabled: !!id,
    refetchInterval: 5000,
  });

  const mutation = useMutation({
    mutationFn: async ({ action, data }: { action: string; data?: any }) => {
      const fn = (api as any)[action];
      if (!fn) throw new Error(`Unknown action: ${action}`);
      return data !== undefined ? fn(id, data) : fn(id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", id] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setFeedback("");
    },
  });

  const doAction = (action: string, data?: any) => mutation.mutate({ action, data });

  if (isLoading || !task) {
    return (
      <div className="flex-1 p-6 space-y-4">
        <div className="flex items-center gap-3 mb-4">
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <div className="grid grid-cols-2 gap-4 mt-6">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        <div className="border-b border-border bg-surface px-6 py-4">
          <div className="flex items-center gap-3 mb-3">
            <button
              onClick={() => navigate("/board")}
              className="text-sm text-text-muted hover:text-text flex items-center gap-1 transition-colors duration-150"
            >
              &larr; Back to Board
            </button>
          </div>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold text-text">{task.title}</h1>
              <div className="flex items-center gap-2 mt-1">
                <Badge variant={STATUS_VARIANTS[task.status] ?? "default"} dot>
                  {task.status.replace(/_/g, " ")}
                </Badge>
                {task.assignedAgent && (
                  <span className="text-sm text-text-muted">{task.assignedAgent.name}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="border-b border-border bg-surface px-6 py-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <Field label="Priority" value={String(task.priority)} />
            <Field label="Branch" value={task.recommendedBranch || "—"} mono />
            <Field label="Merge Target" value={task.mergeBranch} mono />
            <Field label="Requires Plan" value={task.requiresPlan ? "Yes" : "No"} />
            <Field label="Worktree" value={task.worktreePath || "—"} mono />
          </div>
          {task.description && (
            <div className="mt-4">
              <label className="text-xs font-medium text-text-muted uppercase tracking-wider">Description</label>
              <div className="mt-1">
                <MarkdownRenderer content={task.description} />
              </div>
            </div>
          )}
          {task.steerDetails && (
            <div className="mt-3">
              <label className="text-xs font-medium text-text-muted uppercase tracking-wider">Steer Details</label>
              <p className="mt-1 text-sm text-text-secondary whitespace-pre-wrap">{task.steerDetails}</p>
            </div>
          )}
          {task.guardrails?.length > 0 && (
            <div className="mt-3">
              <label className="text-xs font-medium text-text-muted uppercase tracking-wider">Guardrails</label>
              <ul className="mt-1 space-y-1">
                {task.guardrails.map((g: string, i: number) => (
                  <li key={i} className="flex gap-2 text-sm text-text-secondary">
                    <span className="mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700 text-xs font-bold shrink-0">{i + 1}</span>
                    <span>{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {task.acceptanceCriteria?.length > 0 && (
            <div className="mt-3">
              <label className="text-xs font-medium text-text-muted uppercase tracking-wider">Acceptance Criteria</label>
              <ul className="mt-1 text-sm text-text-secondary list-disc list-inside space-y-0.5">
                {task.acceptanceCriteria.map((c: string, i: number) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="border-b border-border bg-surface">
          <div className="flex px-6">
            {(["conversation", "history"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-3 text-sm font-medium capitalize transition-colors duration-150 ${
                  tab === t ? "text-primary border-b-2 border-primary" : "text-text-muted hover:text-text"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="px-6 py-4">
          {tab === "conversation" && (
            <div className="space-y-3 max-w-3xl">
              {task.conversation?.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                  <p className="text-sm">No messages yet.</p>
                </div>
              )}
              {task.conversation?.map((entry: any, i: number) => (
                <ConversationEntryCard key={i} entry={entry} />
              ))}
            </div>
          )}

          {tab === "history" && (
            <div className="space-y-2 max-w-3xl">
              {task.history?.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-text-muted">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <p className="text-sm">No history yet.</p>
                </div>
              )}
              {task.history?.map((h: any, i: number) => (
                <div key={i} className="flex items-center gap-2 text-sm">
                  <span className="text-text-muted">{new Date(h.timestamp).toLocaleString()}</span>
                  <span className="text-text-muted">&rarr;</span>
                  <span className="font-medium text-text-secondary">{h.new_status.replace(/_/g, " ")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {(mutation as any)?.isPending && (
        <div className="px-6 py-2 text-sm text-primary border-t border-border">Processing...</div>
      )}

      {ACTIVE_STATUSES.has(task.status) && (
        <div className="border-t border-border bg-surface px-6 py-4 space-y-2 shrink-0">
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
            <Button onClick={() => doAction("unblock")} variant="ghost">Unblock</Button>
          )}
          <Button onClick={() => doAction("cancel")} variant="danger">Cancel Task</Button>
          <input
            className="w-full border border-border rounded-lg px-3 py-1.5 text-sm mt-2 bg-surface text-text focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-surface transition-all duration-150"
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
      <label className="text-xs font-medium text-text-muted uppercase tracking-wider">{label}</label>
      <div className={`text-sm text-text mt-0.5 ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}

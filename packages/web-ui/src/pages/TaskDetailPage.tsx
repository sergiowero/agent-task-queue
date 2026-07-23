import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { ConversationEntryCard } from "../components/ConversationEntryCard";
import { MarkdownRenderer } from "../components/MarkdownRenderer";

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

const COMMENTABLE_STATUSES = new Set([
  "planning", "coding", "ready for code", "reviewing", "merged", "complete",
]);

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"description" | "conversation" | "context" | "history">("description");
  const [feedback, setFeedback] = useState("");
  const [conversationInput, setConversationInput] = useState("");

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
      setConversationInput("");
    },
  });

  const doAction = (action: string, data?: any) => mutation.mutate({ action, data });

  function handleInlineAction() {
    const status = task?.status;
    if (!status || !conversationInput.trim()) return;

    if (status === "waiting_plan_review") {
      doAction("requestPlanChanges", { message: conversationInput });
    } else if (status === "waiting_code_review") {
      doAction("requestCodeChanges", { message: conversationInput });
    } else if (COMMENTABLE_STATUSES.has(status)) {
      doAction("addComment", { message: conversationInput, authorName: "user" });
    }
  }

  function getInlineButtonLabel(): string {
    const status = task?.status;
    if (status === "waiting_plan_review") return "Request Plan Changes";
    if (status === "waiting_code_review") return "Request Changes";
    return "Add Comment";
  }

  function isInlineButtonVisible(): boolean {
    const status = task?.status;
    if (!status) return false;
    if (status === "waiting_plan_review") return true;
    if (status === "waiting_code_review") return true;
    return COMMENTABLE_STATUSES.has(status);
  }

  if (isLoading || !task) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto">
        {/* Header */}
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
                <Badge variant={STATUS_VARIANTS[task.status] ?? "default"}>
                  {task.status.replace(/_/g, " ")}
                </Badge>
                {task.assignedAgent && (
                  <span className="text-sm text-text-muted">{task.assignedAgent.name}</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Task Metadata */}
        <div className="border-b border-border bg-surface px-6 py-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-3">
            <Field label="Priority" value={String(task.priority)} />
            <Field label="Branch" value={task.recommendedBranch || "—"} mono />
            <Field label="Merge Target" value={task.mergeBranch} mono />
            <Field label="Requires Plan" value={task.requiresPlan ? "Yes" : "No"} />
            <Field label="Worktree" value={task.worktreePath || "—"} mono />
          </div>
          {task.acceptanceCriteria?.length > 0 && (
            <div className="mt-3">
              <label className="text-xs font-medium text-text-muted uppercase">Acceptance Criteria</label>
              <ul className="mt-1 text-sm text-text-secondary list-disc list-inside space-y-0.5">
                {task.acceptanceCriteria.map((c: string, i: number) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Tabs: Description / Conversation / Context / History */}
        <div className="border-b border-border bg-surface">
          <div className="flex px-6">
            {(["description", "conversation", "context", "history"] as const).map((t) => (
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

        {/* Tab Content */}
        <div className="px-6 py-4">
          {tab === "description" && (
            <div className="max-w-3xl">
              {task.description ? (
                <MarkdownRenderer content={task.description} />
              ) : (
                <p className="text-sm text-text-muted">No description.</p>
              )}
            </div>
          )}
          {tab === "conversation" && (
            <div className="space-y-3 max-w-3xl">
              {task.conversation?.length === 0 && (
                <p className="text-sm text-text-muted">No messages yet.</p>
              )}
              {task.conversation?.map((entry: any, i: number) => (
                <ConversationEntryCard key={i} entry={entry} />
              ))}
              {isInlineButtonVisible() && (
                <div className="sticky bottom-0 pt-3 pb-1 bg-surface flex gap-2">
                  <input
                    className="flex-1 border border-border rounded-lg px-3 py-1.5 text-sm bg-surface text-text focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-surface transition-all duration-150"
                    placeholder="Type a message..."
                    value={conversationInput}
                    onChange={(e) => setConversationInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleInlineAction(); }}
                  />
                  <Button
                    onClick={handleInlineAction}
                    variant={task.status === "waiting_code_review" ? "danger" : "primary"}
                    disabled={!conversationInput.trim() || (mutation as any)?.isPending}
                  >
                    {getInlineButtonLabel()}
                  </Button>
                </div>
              )}
            </div>
          )}

          {tab === "context" && (
            <div className="space-y-3 max-w-3xl">
              {(!task.contexts || task.contexts.length === 0) && (
                <p className="text-sm text-text-muted">No context entries recorded.</p>
              )}
              {task.contexts?.map((entry: string, i: number) => (
                <div key={i} className="border-l-4 border-blue-500 bg-surface pl-4 py-3 pr-4 rounded-r-lg shadow-sm">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-xs font-bold mr-2">
                    #{i + 1}
                  </span>
                  <span className="text-sm text-text">{entry}</span>
                </div>
              ))}
            </div>
          )}
          {tab === "history" && (
            <div className="space-y-2 max-w-3xl">
              {task.history?.length === 0 && (
                <p className="text-sm text-text-muted">No history yet.</p>
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

      {/* Processing indicator */}
      {(mutation as any)?.isPending && (
        <div className="px-6 py-2 text-sm text-primary border-t border-border">Processing...</div>
      )}

      {/* Action Buttons */}
      <div className="border-t border-border bg-surface px-6 py-4 space-y-2 shrink-0">
        {task.status === "waiting_plan_review" && (
          <div className="flex gap-2">
            <Button onClick={() => doAction("approvePlan")} variant="primary">Approve Plan</Button>
          </div>
        )}
        {task.status === "waiting_code_review" && (
          <div className="flex gap-2">
            <Button onClick={() => doAction("approveCode")} variant="primary">Approve</Button>
            <Button onClick={() => doAction("requestAiReview")} variant="secondary">Request AI Review</Button>
          </div>
        )}
        {task.status === "merged" && (
          <Button onClick={() => doAction("confirmCompletion")} variant="primary">Complete</Button>
        )}
        {!["canceled", "complete", "merged"].includes(task.status) && (
          <Button onClick={() => doAction("cancel")} variant="danger">Cancel Task</Button>
        )}
      </div>
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
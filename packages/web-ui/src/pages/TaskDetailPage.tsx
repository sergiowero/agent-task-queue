import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/Button";
import { Badge } from "../components/Badge";
import { Input } from "../components/Input";
import { ConversationEntryCard } from "../components/ConversationEntryCard";
import { MarkdownRenderer } from "../components/MarkdownRenderer";
import { EditableField } from "../components/EditableField";
import { Skeleton } from "../components/Skeleton";
import type { Task } from "../lib/api";

const STATUS_VARIANTS: Record<string, "default" | "success" | "warning" | "danger" | "info" | "purple"> = {
  plan_requested: "default",
  ready_for_code: "info",
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
  "plan_requested", "ready_for_code", "planning", "waiting_plan_review", "plan_changes_requested",
  "coding", "waiting_code_review", "code_review_requested", "reviewing",
  "changes_requested", "approved", "merging", "merged",
]);

const EDITABLE_STATUSES = new Set([
  "plan_requested", "ready_for_code", "plan_changes_requested", "code_review_requested", "changes_requested", "approved",
  "waiting_plan_review", "waiting_code_review",
]);

export function TaskDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"conversation" | "history">("conversation");
  const [feedback, setFeedback] = useState("");
  const [titleEditing, setTitleEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");

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

  const updateMutation = useMutation({
    mutationFn: (data: Partial<Task>) => api.updateTask(id!, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["task", id] });
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    },
  });

  const doAction = (action: string, data?: any) => mutation.mutate({ action, data });

  async function saveTitle() {
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== task?.title) {
      await updateMutation.mutateAsync({ title: trimmed });
    }
    setTitleEditing(false);
  }

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

  const canEdit = EDITABLE_STATUSES.has(task.status);

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
              {titleEditing ? (
                <div className="space-y-2">
                  <Input
                    autoFocus
                    value={titleDraft}
                    onChange={(e) => setTitleDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveTitle();
                      if (e.key === "Escape") setTitleEditing(false);
                    }}
                  />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={saveTitle} disabled={updateMutation.isPending}>
                      {updateMutation.isPending ? "Saving..." : "Save"}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setTitleEditing(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-semibold text-text">{task.title}</h1>
                  {canEdit && (
                    <button
                      onClick={() => { setTitleDraft(task.title); setTitleEditing(true); }}
                      className="p-1 rounded text-text-muted hover:text-text hover:bg-surface-secondary transition-colors"
                      title="Edit title"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                  )}
                </div>
              )}
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
            <EditableField
              label="Priority"
              value={String(task.priority)}
              rows={1}
              editable={canEdit}
              display={<div className="text-sm text-text">{String(task.priority)}</div>}
              onSubmit={async (v) => {
                const p = parseInt(v, 10);
                if (isNaN(p)) throw new Error("Priority must be a number");
                await updateMutation.mutateAsync({ priority: p });
              }}
            />
            <EditableField
              label="Branch"
              value={task.recommendedBranch || ""}
              placeholder="Branch name"
              rows={1}
              editable={canEdit}
              display={<div className={`text-sm text-text ${task.recommendedBranch ? "font-mono" : ""}`}>{task.recommendedBranch || "—"}</div>}
              onSubmit={async (v) => await updateMutation.mutateAsync({ recommendedBranch: v.trim() })}
            />
            <EditableField
              label="Merge Target"
              value={task.mergeBranch}
              placeholder="Merge branch"
              rows={1}
              editable={canEdit}
              display={<div className="text-sm text-text font-mono">{task.mergeBranch}</div>}
              onSubmit={async (v) => await updateMutation.mutateAsync({ mergeBranch: v.trim() })}
            />
            <Field label="Requires Plan" value={task.requiresPlan ? "Yes" : "No"} />
            <Field label="Worktree" value={task.worktreePath || "—"} mono />
          </div>
          <div className="mt-6 space-y-4">
            <EditableField
              label="Description"
              value={task.description ?? ""}
              placeholder="Description"
              editable={canEdit}
              display={
                task.description ? (
                  <div className="text-sm text-text">
                    <MarkdownRenderer content={task.description} />
                  </div>
                ) : (
                  <p className="text-sm text-text-muted italic">Description not present</p>
                )
              }
              onSubmit={async (v) => await updateMutation.mutateAsync({ description: v.trim() ? v : null })}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <EditableField
                label="Steer Details"
                value={task.steerDetails ?? ""}
                placeholder="Implementation guidance, technical recommendations, preferred approaches"
                editable={canEdit}
                display={
                  task.steerDetails ? (
                    <p className="text-sm text-text-secondary whitespace-pre-wrap">{task.steerDetails}</p>
                  ) : (
                    <p className="text-sm text-text-muted italic">Steer details not present</p>
                  )
                }
                onSubmit={async (v) => await updateMutation.mutateAsync({ steerDetails: v.trim() ? v : null })}
              />
              <EditableField
                label="Guardrails"
                value={task.guardrails?.join("\n") ?? ""}
                placeholder="One constraint per line"
                editable={canEdit}
                display={
                  task.guardrails?.length > 0 ? (
                    <ul className="space-y-1">
                      {task.guardrails.map((g: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                          <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 text-amber-700 text-xs font-bold shrink-0">{i + 1}</span>
                          <span className="pt-0.5">{g}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-text-muted italic">Guardrails not present</p>
                  )
                }
                onSubmit={async (v) =>
                  await updateMutation.mutateAsync({
                    guardrails: v.split("\n").map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
              <EditableField
                label="Acceptance Criteria"
                value={task.acceptanceCriteria?.join("\n") ?? ""}
                placeholder="One criterion per line"
                editable={canEdit}
                display={
                  task.acceptanceCriteria?.length > 0 ? (
                    <ul className="space-y-1.5">
                      {task.acceptanceCriteria.map((c: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                          <svg className="w-4 h-4 mt-0.5 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                          <span className="pt-0.5">{c}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-text-muted italic">Acceptance criteria not present</p>
                  )
                }
                onSubmit={async (v) =>
                  await updateMutation.mutateAsync({
                    acceptanceCriteria: v.split("\n").map((s) => s.trim()).filter(Boolean),
                  })
                }
              />
            </div>
          </div>
        </div>

        {ACTIVE_STATUSES.has(task.status) && (
          <div className="border-b border-border bg-surface px-6 py-4 space-y-2">
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

        {mutation.isPending && (
          <div className="border-b border-border bg-surface px-6 py-2 text-sm text-primary">Processing...</div>
        )}

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
              {[...(task.conversation ?? [])].reverse().map((entry: any, i: number) => (
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
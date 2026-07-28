import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { LoadingSkeleton } from "../components/LoadingSkeleton";
import { EmptyState } from "../components/EmptyState";
import type { ActivityEvent } from "../lib/api";

const EVENT_LABELS: Record<string, string> = {
  task_created: "Task created",
  task_completed: "Task completed",
  task_canceled: "Task canceled",
  task_unblocked: "Task unblocked",
  agent_claimed: "Agent claimed",
  plan_submitted: "Plan submitted",
  plan_approved: "Plan approved",
  plan_changes_requested: "Plan changes requested",
  code_submitted: "Code submitted",
  code_approved: "Code approved",
  code_changes_requested: "Code changes requested",
  review_submitted: "Review submitted",
  merge_submitted: "Merge submitted",
  ai_review_requested: "AI review requested",
  status_change: "Status changed",
  comment: "Comment",
};

export function ActivityPage() {
  const [limit, setLimit] = useState(50);

  const { data: eventsData, isLoading } = useQuery({
    queryKey: ["activity", limit],
    queryFn: () => api.getActivity({ limit }),
  });

  const events: ActivityEvent[] = eventsData?.data ?? [];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border bg-surface flex items-center px-4 gap-4 shrink-0 text-text">
        <h2 className="font-semibold text-text">Activity</h2>
        <div className="flex-1" />
        <select
          className="border border-border bg-surface-secondary text-text rounded px-2 py-1.5 text-sm"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
        >
          <option value={25}>25 events</option>
          <option value={50}>50 events</option>
          <option value={100}>100 events</option>
        </select>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading && <LoadingSkeleton count={5} />}
        {!isLoading && events.length === 0 && (
          <EmptyState
            title="No activity yet"
            description="Events appear as tasks are created and updated."
          />
        )}
        <div className="space-y-2">
          {events.map((event) => (
            <div key={event.id} className="flex items-start gap-3 py-2 border-b border-border">
              <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-text">
                    {EVENT_LABELS[event.eventType] ?? event.eventType}
                  </span>
                  {event.actor && <span className="text-xs text-text-muted">by {event.actor}</span>}
                </div>
                {event.details && <p className="text-xs text-text-muted mt-0.5">{event.details}</p>}
              </div>
              <span className="text-xs text-text-muted shrink-0">
                {new Date(event.createdAt).toLocaleString()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

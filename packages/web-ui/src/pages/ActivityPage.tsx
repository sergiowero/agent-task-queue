import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { Skeleton } from "../components/Skeleton";

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

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["activity", limit],
    queryFn: () => api.getActivity({ limit }),
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border bg-surface flex items-center px-4 gap-4 shrink-0 text-text">
        <h2 className="font-semibold text-text">Activity</h2>
        <div className="flex-1" />
        <select
          className="border border-border bg-surface-secondary text-text rounded-lg px-2 py-1.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary transition-all duration-150"
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
        >
          <option value={25}>25 events</option>
          <option value={50}>50 events</option>
          <option value={100}>100 events</option>
        </select>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading && (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-border">
                <Skeleton className="w-2 h-2 rounded-full mt-1.5 shrink-0" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-60" />
                </div>
                <Skeleton className="h-3 w-20 shrink-0" />
              </div>
            ))}
          </div>
        )}
        {!isLoading && events.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-text-muted">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm">No activity yet.</p>
            <p className="text-xs mt-1">Events appear as tasks are created and updated.</p>
          </div>
        )}
        {events.length > 0 && (
          <div className="space-y-1">
            {events.map((event: any) => (
              <div key={event.id} className="flex items-start gap-3 py-2 border-b border-border-light">
                <div className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-medium text-text">
                      {EVENT_LABELS[event.eventType] ?? event.eventType}
                    </span>
                    {event.actor && (
                      <span className="text-xs text-text-muted">by {event.actor}</span>
                    )}
                  </div>
                  {event.details && (
                    <p className="text-xs text-text-muted mt-0.5">{event.details}</p>
                  )}
                </div>
                <span className="text-xs text-text-muted shrink-0">
                  {new Date(event.createdAt).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

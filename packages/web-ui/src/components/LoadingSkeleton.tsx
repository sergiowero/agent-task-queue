import { Skeleton } from "./Skeleton";

/** Route-level fallback while a page chunk loads. */
export function LoadingSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden" aria-busy="true" aria-label="Loading">
      <div className="flex h-16 shrink-0 items-center gap-4 border-b border-border bg-surface/80 px-6">
        <Skeleton className="h-9 w-9 rounded-xl" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="space-y-3 px-6 py-6">
        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="card space-y-2.5 p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

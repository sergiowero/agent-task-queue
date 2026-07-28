export function LoadingSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3 p-2">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="bg-surface rounded-xl border border-border p-3 animate-pulse">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2" />
          <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2 mb-2" />
          <div className="flex gap-2">
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-16" />
            <div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-20" />
          </div>
        </div>
      ))}
    </div>
  );
}

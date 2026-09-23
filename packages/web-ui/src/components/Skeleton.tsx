import { cn } from "../lib/cn";

interface SkeletonProps {
  className?: string;
}

/** Shimmering placeholder block. Size it with `className`. */
export function Skeleton({ className }: SkeletonProps) {
  return <div aria-hidden className={cn("skeleton", className)} />;
}

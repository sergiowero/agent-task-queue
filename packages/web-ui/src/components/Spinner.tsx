import { SpinnerIcon } from "../lib/icons";
import { cn } from "../lib/cn";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return <SpinnerIcon aria-hidden className={cn("animate-spin shrink-0", className)} />;
}

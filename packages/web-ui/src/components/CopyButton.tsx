import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { CheckIcon, CopyIcon } from "../lib/icons";
import { cn } from "../lib/cn";
import { Tooltip } from "./Tooltip";

interface CopyButtonProps {
  value: string;
  label?: string;
  size?: "xs" | "sm";
  className?: string;
}

/** Copies `value` to the clipboard and morphs into a check for a moment. */
export function CopyButton({ value, label = "Copy", size = "sm", className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Could not copy to clipboard");
    }
  }

  const box = size === "xs" ? "h-6 w-6 rounded-md" : "h-8 w-8 rounded-lg";
  const icon = size === "xs" ? "h-3.5 w-3.5" : "h-4 w-4";

  return (
    <Tooltip content={copied ? "Copied!" : label}>
      <button
        type="button"
        aria-label={label}
        onClick={copy}
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center transition-all duration-150 active:scale-90",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
          copied ? "text-success" : "text-text-muted hover:bg-surface-tertiary/70 hover:text-text",
          box,
          className,
        )}
      >
        <CopyIcon
          aria-hidden
          className={cn(
            icon,
            "absolute transition-all duration-200 ease-out-expo",
            copied ? "scale-50 opacity-0" : "scale-100 opacity-100",
          )}
        />
        <CheckIcon
          aria-hidden
          className={cn(
            icon,
            "absolute transition-all duration-200 ease-spring",
            copied ? "scale-100 opacity-100" : "scale-50 opacity-0",
          )}
        />
      </button>
    </Tooltip>
  );
}

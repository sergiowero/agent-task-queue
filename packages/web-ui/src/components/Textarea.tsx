import { forwardRef } from "react";
import { cn } from "../lib/cn";
import { controlBase, controlState } from "./Input";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, className, ...props }, ref) => {
    return (
      <div className="w-full">
        <textarea
          ref={ref}
          aria-invalid={error ? true : undefined}
          className={cn(
            controlBase,
            controlState(error),
            "min-h-[2.25rem] resize-y px-3 py-2 leading-relaxed",
            className,
          )}
          {...props}
        />
        {error && <p className="mt-1.5 text-xs text-danger animate-slide-down">{error}</p>}
      </div>
    );
  },
);

Textarea.displayName = "Textarea";

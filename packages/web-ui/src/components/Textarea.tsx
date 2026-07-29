import { forwardRef } from "react";

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ error, className = "", ...props }, ref) => {
    return (
      <div className="w-full">
        <textarea
          ref={ref}
          className={`
            w-full border rounded-lg px-3 py-2 text-sm
            bg-surface text-text
            placeholder:text-text-muted
            focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-surface
            transition-all duration-150
            ${error ? "border-danger focus-visible:ring-danger" : "border-border focus-visible:ring-primary"}
            ${className}
          `}
          {...props}
        />
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
    );
  },
);

Textarea.displayName = "Textarea";

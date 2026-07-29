import { forwardRef } from "react";

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ error, className = "", children, ...props }, ref) => {
    return (
      <div className="w-full">
        <select
          ref={ref}
          className={`
            w-full border rounded-lg px-3 py-2 text-sm appearance-none
            bg-surface text-text
            focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-surface
            transition-all duration-150
            ${error ? "border-danger focus-visible:ring-danger" : "border-border focus-visible:ring-primary"}
            ${className}
          `}
          {...props}
        >
          {children}
        </select>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
    );
  }
);

Select.displayName = "Select";

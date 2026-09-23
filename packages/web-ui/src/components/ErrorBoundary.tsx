import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { RefreshIcon, WarningIcon } from "../lib/icons";
import { Button } from "./Button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="card max-w-md p-8 text-center animate-scale-in">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-danger/10 text-danger">
              <WarningIcon aria-hidden className="h-6 w-6" />
            </div>
            <h2 className="mb-1 text-base font-semibold text-text">Something went wrong</h2>
            <p className="mb-6 break-words text-sm text-text-muted">{this.state.error?.message}</p>
            <Button
              variant="secondary"
              icon={RefreshIcon}
              onClick={() => this.setState({ hasError: false, error: undefined })}
            >
              Try again
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

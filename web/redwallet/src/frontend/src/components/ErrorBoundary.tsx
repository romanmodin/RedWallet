/**
 * ErrorBoundary — top-level render error boundary.
 *
 * Catches render-time errors anywhere below it and renders the shared
 * ErrorState with a reset action instead of a blank screen.
 */

import { ErrorState } from "@/components/states/ErrorState";
import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("RedWallet render error:", error, info.componentStack);
  }

  private handleReset = (): void => {
    this.setState({ hasError: false });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-dvh items-center justify-center bg-background p-6">
          <ErrorState
            title="RedWallet hit an unexpected error"
            description="The view failed to render. Resetting usually clears it — your demo data is unaffected."
            retryLabel="Reset view"
            onRetry={this.handleReset}
            className="w-full max-w-md"
          />
        </div>
      );
    }
    return this.props.children;
  }
}

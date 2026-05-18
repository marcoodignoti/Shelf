import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    componentStack: ""
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, componentStack: "" };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ componentStack: errorInfo.componentStack || "" });
  }

  public render() {
    if (this.state.hasError) {
      const message = this.state.error?.message || "Unknown error";
      const stack = [this.state.error?.stack, this.state.componentStack].filter(Boolean).join("\n\n");

      return (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <h2 className="text-xl font-bold text-destructive mb-2">Something went wrong.</h2>
          <div className="bg-destructive/10 text-destructive text-sm p-4 rounded-md text-left max-w-2xl overflow-auto whitespace-pre-wrap">
            <div className="font-semibold mb-4">{message}</div>
            <div className="text-xs opacity-80">{stack}</div>
          </div>
          <button 
            className="mt-4 px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

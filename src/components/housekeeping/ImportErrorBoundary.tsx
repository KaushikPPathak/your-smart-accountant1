import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface State { error: Error | null }

export class ImportErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Import error boundary:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      return (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 space-y-3">
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span className="font-medium">Import ran into a problem</span>
          </div>
          <p className="text-sm text-muted-foreground">
            The file may be too large for the browser to handle, or the format wasn't recognised.
            Try splitting the export (e.g. Masters and Day Book separately) or re-export from
            Tally / Busy as XML.
          </p>
          <pre className="max-h-32 overflow-auto rounded bg-muted p-2 text-[11px] font-mono">
            {this.state.error.message}
          </pre>
          <Button size="sm" variant="outline" onClick={this.reset}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Reset
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}
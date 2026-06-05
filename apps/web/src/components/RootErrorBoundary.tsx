import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };

type State = { error: Error | null };

export class RootErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App render error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="dtp-error-page" role="alert" style={{ padding: "2rem", maxWidth: "40rem" }}>
          <h1>Something went wrong</h1>
          <p className="muted">
            The page could not load. Try a hard refresh (Ctrl+Shift+R). If this keeps happening,
            restart <code>pnpm dev</code> and <code>pnpm dev:api</code>.
          </p>
          <pre style={{ overflow: "auto", fontSize: "0.85rem" }}>{this.state.error.message}</pre>
          <button type="button" className="home-hero__btn home-hero__btn--primary" onClick={() => window.location.reload()}>
            Reload page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

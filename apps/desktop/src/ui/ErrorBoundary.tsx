import { Component, type ErrorInfo, type ReactNode } from "react";

/* A render failure in one page must not take the window with it. The chrome and
   the sidebar stay mounted, so a run in progress remains visible and the other
   pages remain reachable while this one is broken.

   There is no retry button: the page boundary is keyed on the active page, so
   navigating away and back remounts it. A button that only re-ran the same
   render would usually fail again on the same state.

   The app scope catches what the page scope cannot — a throw in the shell's own
   render, above the page boundaries — and says something different, because at
   that point nothing on screen is still working. */

type Scope = "page" | "app";
type Props = { page: string; scope?: Scope; className?: string; children: ReactNode };
type State = { error: Error | null; componentStack: string };

const COPY: Record<Scope, { title: string; note: string }> = {
  page: { title: "This page stopped responding", note: "Any run in progress is still recording. Other pages are unaffected." },
  app: { title: "Copify stopped responding", note: "Any run in progress is still recording in the background. Restart Copify to recover the window." },
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> { return { error }; }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? "" });
    console.error(`Copify: ${this.props.page} failed to render.`, error, info.componentStack);
  }

  private copyDetails = (): void => {
    const { error, componentStack } = this.state;
    if (!error) return;
    void navigator.clipboard.writeText(`${this.props.page}\n${error.stack ?? error.message}\n${componentStack}`.trim());
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const copy = COPY[this.props.scope ?? "page"];
    return (
      <section className={`panel ${this.props.className ?? ""}`}>
        <div className="section-title">
          <div>
            <h2>{copy.title}</h2>
            <p className="muted">{copy.note}</p>
          </div>
          <button onClick={this.copyDetails}>Copy details</button>
        </div>
        <p className="crash-detail mono">{error.message || String(error)}</p>
      </section>
    );
  }
}

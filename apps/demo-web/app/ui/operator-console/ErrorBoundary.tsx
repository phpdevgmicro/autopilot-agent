"use client";

import React from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="errorBoundary">
          <div className="errorBoundaryCard">
            <div className="errorBoundaryIcon">⚠️</div>
            <h2 className="errorBoundaryTitle">Something went wrong</h2>
            <p className="errorBoundaryMessage">{this.state.error.message}</p>
            <button
              className="errorBoundaryRetry"
              onClick={() => this.setState({ error: null })}
              type="button"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

import React from "react";
import { FaExclamationTriangle, FaRedo, FaHome } from "react-icons/fa";

/**
 * Top-level error boundary.
 *
 * React error boundaries must be class components (no hook equivalent as of
 * React 18). This one wraps the entire routed app so any uncaught render
 * error shows a friendly recovery card instead of a white screen.
 *
 * The boundary also resets its error state when the route changes — this
 * lets a cashier recover from a bug on one page without losing other
 * working pages in the same session.
 */
class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    // Log to the console so devs see it. In production you'd also send to
    // an error tracking service (Sentry, etc.) — left as a TODO.
    console.error("AppErrorBoundary caught:", error, info);
  }

  componentDidUpdate(prevProps) {
    // If the route path changes, clear the error so the user can recover
    // by navigating away from the broken page.
    if (this.state.hasError && prevProps.locationPathname !== this.props.locationPathname) {
      this.setState({ hasError: false, error: null });
    }
  }

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    window.location.href = "/home";
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="app-error-boundary" role="alert" aria-live="assertive">
        <div className="app-error-boundary-card">
          <div className="app-error-boundary-icon" aria-hidden="true">
            <FaExclamationTriangle />
          </div>
          <h1 className="app-error-boundary-title">Something went wrong</h1>
          <p className="app-error-boundary-text">
            We hit an unexpected error rendering this page. Your draft work in other tabs is safe —
            only this page is affected.
          </p>
          {process.env.NODE_ENV !== "production" && this.state.error ? (
            <pre className="app-error-boundary-detail">
              {String(this.state.error?.message || this.state.error)}
            </pre>
          ) : null}
          <div className="app-error-boundary-actions">
            <button
              type="button"
              className="app-error-boundary-btn primary"
              onClick={this.handleReload}
            >
              <FaRedo />
              Reload page
            </button>
            <button
              type="button"
              className="app-error-boundary-btn secondary"
              onClick={this.handleGoHome}
            >
              <FaHome />
              Go to dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default AppErrorBoundary;

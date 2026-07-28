import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

// Public routes that should never be considered part of the user's in-app
// navigation history. Hitting "back" should never send the user back to the
// login screen.
const PUBLIC_PATHS = new Set(["/login", "/register", "/password-reset", "/"]);

const isInAppPath = (pathname) =>
  Boolean(pathname) && !PUBLIC_PATHS.has(pathname) && !pathname.startsWith("/login");

/**
 * Track the user's in-app navigation history. Works around the broken
 * `window.history.state.idx` check, which can't distinguish a real back-stack
 * entry from a `replace: true` rewrite (most sidebar clicks use replace).
 *
 * Behavior:
 *   - On every location change, push the new pathname onto a small stack.
 *   - If the new path equals the current top of the stack, skip (avoids
 *     duplicate entries when nothing actually changed).
 *   - `previousInAppPath` returns the most recent path before the current one,
 *     excluding public paths.
 *   - The stack is capped at 20 entries to keep memory bounded.
 */
const MAX_STACK = 20;

const useInAppHistory = () => {
  const location = useLocation();
  const stackRef = useRef([]);

  useEffect(() => {
    const path = location.pathname + location.search;
    if (!isInAppPath(location.pathname)) return;
    const stack = stackRef.current;
    if (stack[stack.length - 1] !== path) {
      stack.push(path);
      if (stack.length > MAX_STACK) stack.shift();
    }
  }, [location.pathname, location.search]);

  const previousInAppPath = () => {
    const stack = stackRef.current;
    // Find the most recent entry that isn't the current path.
    for (let i = stack.length - 2; i >= 0; i -= 1) {
      const entry = stack[i];
      if (entry && entry !== location.pathname + location.search) {
        return entry;
      }
    }
    return null;
  };

  return { previousInAppPath, stack: stackRef.current };
};

export default useInAppHistory;

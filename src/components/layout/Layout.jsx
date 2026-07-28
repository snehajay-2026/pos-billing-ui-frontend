import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import Header from "./Header";
import Sidebar from "./Sidebar";
import HelpChatBot from "./HelpChatBot";
import "./Layout.css";

const resolveComponent = (component) => {
  if (typeof component === "function" || typeof component === "string") {
    return component;
  }
  if (component && typeof component === "object") {
    if (typeof component.default === "function" || typeof component.default === "string") {
      return component.default;
    }
  }
  return null;
};

const renderResolvedChild = (child) => {
  if (!React.isValidElement(child)) {
    return child;
  }

  const resolvedType = resolveComponent(child.type);
  if (!resolvedType || resolvedType === child.type) {
    return child;
  }

  return React.createElement(resolvedType, child.props);
};

// Routes that should occupy the full viewport (no sidebar). Keep this list
// tight — every entry here is a deliberate "focus mode" choice.
const FULLSCREEN_ROUTES = new Set(["/users"]);

const isFullscreenPath = (pathname) => {
  if (!pathname) return false;
  // Match exact paths and path-prefixes for nested routes (e.g. /users/123).
  if (FULLSCREEN_ROUTES.has(pathname)) return true;
  return Array.from(FULLSCREEN_ROUTES).some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
};

const Layout = ({ children }) => {
  const location = useLocation();
  const fullscreen = isFullscreenPath(location.pathname);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const ResolvedHeader = resolveComponent(Header);
  const ResolvedSidebar = resolveComponent(Sidebar);
  const ResolvedHelpChatBot = resolveComponent(HelpChatBot);

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarOpen(false);
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize();

    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <>
      {/* Header */}
      <div className="no-print">
        {ResolvedHeader ? (
          <ResolvedHeader toggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
        ) : null}
      </div>

      {fullscreen ? (
        <div className="layout-fullscreen">
          <div className="layout-fullscreen-main">
            {React.Children.map(children, renderResolvedChild)}
          </div>
        </div>
      ) : (
        <div className="layout-shell">
          {/* Sidebar */}
          <div className="no-print">
            {ResolvedSidebar ? (
              <ResolvedSidebar
                collapsed={!sidebarOpen}
                isMobile={isMobile}
                onMenuClick={() => {
                  if (isMobile) setSidebarOpen(false);
                }}
              />
            ) : null}
          </div>

          {/* Main Content */}
          <div className="layout-main">{React.Children.map(children, renderResolvedChild)}</div>
        </div>
      )}

      {ResolvedHelpChatBot && !fullscreen ? <ResolvedHelpChatBot /> : null}
    </>
  );
};

export default Layout;

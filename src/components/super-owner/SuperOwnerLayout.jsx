// SuperOwnerLayout.jsx
//
// Chrome wrapper for the Super Owner console. Lives at the route level
// (App.js wraps every /super/* page in this layout). Intentionally
// minimal: header on top, sidebar on the left, page content in the
// main column. Reuses the project's Header / HelpChatBot / Toasts
// and the Sidebar.css dark-theme tokens so the console feels like
// the same product as the tenant-admin shell.
//
// Why a separate layout instead of reusing <Layout>?
//   - The tenant-admin <Layout> assumes a single store scope and
//     renders that store's sidebar items. SUPER_OWNER at platform
//     scope has no store context; reusing the tenant layout would
//     render the wrong sidebar items.
//   - The /super/* pages need a stable, predictable chrome that
//     does not include the cashier shift gate (SUPER_OWNER is not
//     bound to a single store's open-shift policy).

import React, { useEffect, useState } from "react";
import Header from "../layout/Header";
import SuperOwnerSidebar from "./SuperOwnerSidebar";
import HelpChatBot from "../layout/HelpChatBot";
import "./SuperOwnerLayout.css";

const SuperOwnerLayout = ({ title, subtitle, children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isMobile, setIsMobile] = useState(
    typeof window !== "undefined" ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    const handleResize = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setSidebarOpen(false);
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <>
      <div className="no-print">
        <Header toggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
      </div>
      <div className="super-layout-shell">
        <div className="no-print">
          <SuperOwnerSidebar
            collapsed={!sidebarOpen}
            isMobile={isMobile}
            onMenuClick={() => {
              if (isMobile) setSidebarOpen(false);
            }}
          />
        </div>
        <main className="super-layout-main" role="main">
          {(title || subtitle) && (
            <div className="super-layout-header">
              <div className="super-layout-title">
                {title ? <h1>{title}</h1> : null}
                {subtitle ? <p>{subtitle}</p> : null}
              </div>
              <span className="super-layout-badge">Super Owner</span>
            </div>
          )}
          {children}
        </main>
      </div>
      {!isMobile ? <HelpChatBot /> : null}
    </>
  );
};

export default SuperOwnerLayout;

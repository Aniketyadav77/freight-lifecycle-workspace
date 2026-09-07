import { useEffect } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { useFreightStore } from "../store/useFreightStore";
import type { ConnectionStatus } from "../types";

const MODULES = [
  { to: "/procure", label: "Procurement" },
  { to: "/active", label: "Active Shipments" },
  { to: "/track", label: "Tracking" },
  { to: "/settle", label: "Settlement" },
  { to: "/analytics", label: "Analytics" },
];

const CONNECTION_UI: Record<ConnectionStatus, { dot: string; label: string }> = {
  idle: { dot: "bg-ink/25", label: "Idle" },
  connecting: { dot: "bg-warn animate-pulse", label: "Connecting" },
  open: { dot: "bg-ok", label: "Live" },
  closed: { dot: "bg-bad", label: "Reconnecting" },
};

/**
 * Persistent shell wrapping every module route. It owns the store's lifecycle,
 * so the socket connects once and survives navigation between modules.
 */
export function AppShell() {
  const init = useFreightStore((state) => state.init);
  const teardown = useFreightStore((state) => state.teardown);
  const connection = useFreightStore((state) => state.connection);
  const notice = useFreightStore((state) => state.notice);
  const dismissNotice = useFreightStore((state) => state.dismissNotice);

  useEffect(() => {
    void init();
    return teardown;
  }, [init, teardown]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(dismissNotice, 6_000);
    return () => clearTimeout(timer);
  }, [notice, dismissNotice]);

  const status = CONNECTION_UI[connection];

  return (
    <div className="flex min-h-full flex-col">
      <header className="px-6 pt-5">
        <div className="neu-raised mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-3 rounded-xl px-5 py-3.5">
          <span className="text-sm font-semibold tracking-tight text-ink">
            Freight Lifecycle
          </span>

          <nav className="flex flex-wrap gap-1.5">
            {MODULES.map((module) => (
              <NavLink
                key={module.to}
                to={module.to}
                className={({ isActive }) =>
                  // Inset is this system's "on": the selected item reads as
                  // pressed into the surface rather than painted a new colour.
                  `neu-toggle rounded-lg px-3 py-1.5 text-sm font-medium ${
                    isActive
                      ? "neu-inset text-accent"
                      : "text-ink/60 hover:text-ink"
                  }`
                }
              >
                {module.label}
              </NavLink>
            ))}
          </nav>

          <span className="ml-auto flex items-center gap-2 text-xs text-ink/50">
            <span className={`h-2 w-2 rounded-full ${status.dot}`} />
            {status.label}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-6">
        <Outlet />
      </main>

      {notice && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 flex justify-center px-6">
          <div className="neu-raised pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-ink">
            <span>{notice}</span>
            <button
              type="button"
              onClick={dismissNotice}
              className="text-ink/40 transition hover:text-ink"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import { useLayoutEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import type { LucideIcon } from "../lib/icons";
import {
  ActivityIcon,
  AgentsIcon,
  BoardIcon,
  CollapseIcon,
  ExpandIcon,
  ProjectsIcon,
  RunnersIcon,
  ToolsIcon,
} from "../lib/icons";
import { cn } from "../lib/cn";
import { IconButton } from "./IconButton";
import { ThemeToggle } from "./ThemeToggle";
import { Tooltip } from "./Tooltip";

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Extra path prefixes that highlight this item. */
  match?: string[];
}

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Work",
    items: [
      { to: "/board", label: "Board", icon: BoardIcon, match: ["/tasks"] },
      { to: "/projects", label: "Projects", icon: ProjectsIcon },
    ],
  },
  {
    label: "Automation",
    items: [
      { to: "/runners", label: "Runners", icon: RunnersIcon },
      { to: "/agents", label: "Agents", icon: AgentsIcon },
    ],
  },
  {
    label: "Insights",
    items: [
      { to: "/activity", label: "Activity", icon: ActivityIcon },
      { to: "/tools", label: "Tools", icon: ToolsIcon },
    ],
  },
];

const COLLAPSED_KEY = "agentq-sidebar-collapsed";

function readCollapsed() {
  try {
    const stored = localStorage.getItem(COLLAPSED_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    // Fall back to the viewport width.
  }
  return window.innerWidth < 900;
}

function isActive(item: NavItem, pathname: string) {
  return [item.to, ...(item.match ?? [])].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/** Brand mark: a gradient tile with three queue lines. */
function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <defs>
        <linearGradient id="agentq-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#a855f7" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#agentq-logo)" />
      <path
        d="M9 11h14M9 16h10M9 21h6"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export function Layout() {
  const { pathname } = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState<{ top: number; height: number } | null>(null);

  function toggleCollapsed() {
    setCollapsed((prev) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, prev ? "0" : "1");
      } catch {
        // Not persisting is fine.
      }
      return !prev;
    });
  }

  // Slide the highlight to the active item.
  useLayoutEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>("[data-active='true']");
    if (!nav || !active) {
      setIndicator(null);
      return;
    }
    setIndicator({ top: active.offsetTop, height: active.offsetHeight });
  }, [pathname, collapsed]);

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <aside
        className={cn(
          "relative z-30 flex shrink-0 flex-col border-r border-border bg-surface/60 backdrop-blur-xl",
          "transition-[width] duration-300 ease-out-expo",
          collapsed ? "w-[68px]" : "w-[244px]",
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 overflow-hidden px-4">
          <Logo className="h-9 w-9 shrink-0 drop-shadow-[0_4px_12px_rgb(99_102_241/0.35)] transition-transform duration-300 ease-spring hover:rotate-[-6deg] hover:scale-105" />
          <div
            className={cn(
              "min-w-0 transition-all duration-200",
              collapsed ? "pointer-events-none -translate-x-2 opacity-0" : "opacity-100",
            )}
          >
            <div className="truncate text-[15px] font-bold tracking-tight text-text">AgentQ</div>
            <div className="truncate text-[11px] text-text-muted">your 100x engineer tool</div>
          </div>
        </div>

        <nav ref={navRef} className="relative flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
          {indicator && (
            <span
              aria-hidden
              className="pointer-events-none absolute left-3 right-3 rounded-lg bg-primary/10 ring-1 ring-inset ring-primary/15 transition-all duration-300 ease-out-expo"
              style={{ top: indicator.top, height: indicator.height }}
            >
              <span className="absolute left-0 top-1/2 h-4 w-[3px] -translate-x-[5px] -translate-y-1/2 rounded-full bg-primary" />
            </span>
          )}
          {NAV_GROUPS.map((group, gi) => (
            <div key={group.label} className={cn(gi > 0 && "mt-5")}>
              <div
                className={cn(
                  "eyebrow mb-1.5 h-4 overflow-hidden whitespace-nowrap px-3 transition-opacity duration-200",
                  collapsed && "opacity-0",
                )}
              >
                {group.label}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active = isActive(item, pathname);
                  const link = (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      data-active={active}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "group/nav relative flex h-9 items-center gap-3 rounded-lg px-3 text-sm",
                        "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                        active
                          ? "font-medium text-primary"
                          : "text-text-secondary hover:bg-surface-secondary hover:text-text",
                      )}
                    >
                      <item.icon
                        aria-hidden
                        className={cn(
                          "h-[18px] w-[18px] shrink-0 transition-transform duration-300 ease-spring",
                          !active && "group-hover/nav:scale-110",
                        )}
                        strokeWidth={active ? 2.25 : 2}
                      />
                      <span
                        className={cn(
                          "truncate transition-opacity duration-200",
                          collapsed && "opacity-0",
                        )}
                      >
                        {item.label}
                      </span>
                    </NavLink>
                  );
                  return collapsed ? (
                    <Tooltip key={item.to} content={item.label} side="right" delay={100}>
                      {link}
                    </Tooltip>
                  ) : (
                    link
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="shrink-0 space-y-2 border-t border-border p-3">
          {collapsed ? (
            <div className="flex justify-center">
              <ThemeToggle compact />
            </div>
          ) : (
            <ThemeToggle />
          )}
          <div className={cn("flex", collapsed ? "justify-center" : "justify-end")}>
            <IconButton
              icon={collapsed ? ExpandIcon : CollapseIcon}
              label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              tooltipSide="right"
              onClick={toggleCollapsed}
            />
          </div>
        </div>
      </aside>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-72 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgb(var(--primary)/0.07),transparent)]"
        />
        <div key={pathname} className="relative flex min-h-0 flex-1 flex-col animate-page-in">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

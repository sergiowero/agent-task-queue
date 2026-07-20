import { Outlet, NavLink, useNavigate } from "react-router-dom";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { ThemeToggle } from "./ThemeToggle";

const NAV_ITEMS = [
  { to: "/board", label: "Board" },
  { to: "/agents", label: "Agents" },
  { to: "/activity", label: "Activity" },
];

export function Layout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDisplayName, setProjectDisplayName] = useState("");
  const [projectDir, setProjectDir] = useState("");

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: api.getProjects,
  });

  const handleCreateProject = async () => {
    if (!projectName || !projectDisplayName || !projectDir) return;
    await api.createProject({
      name: projectName,
      displayName: projectDisplayName,
      workingDirectory: projectDir,
    });
    queryClient.invalidateQueries({ queryKey: ["projects"] });
    setShowProjectForm(false);
    setProjectName("");
    setProjectDisplayName("");
    setProjectDir("");
  };

  return (
    <div className="flex h-screen bg-surface-secondary">
      {/* Sidebar */}
      <aside className="w-56 bg-surface border-r border-border flex flex-col">
        <div className="px-4 py-5 border-b border-border">
          <h1 className="text-text font-bold text-lg">ATQ</h1>
          <p className="text-xs text-text-muted">your 100x engineer tool</p>
        </div>

        <nav className="flex-1 px-2 py-4 space-y-1">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block px-3 py-2 rounded-lg text-sm transition-colors duration-150 ${
                  isActive
                    ? "bg-primary text-white"
                    : "text-text-secondary hover:text-text hover:bg-surface-secondary"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-2 py-4 border-t border-border">
          <div className="flex items-center justify-between px-3 mb-2">
            <span className="text-xs font-medium text-text-muted uppercase">Projects</span>
            <button
              onClick={() => setShowProjectForm(!showProjectForm)}
              className="text-text-muted hover:text-text text-lg leading-none transition-colors duration-150"
            >
              +
            </button>
          </div>

          {showProjectForm && (
            <div className="px-3 mb-2 space-y-1">
              <input
                className="w-full bg-surface-secondary text-text text-xs px-2 py-1.5 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-surface transition-all duration-150"
                placeholder="Name"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
              <input
                className="w-full bg-surface-secondary text-text text-xs px-2 py-1.5 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-surface transition-all duration-150"
                placeholder="Display Name"
                value={projectDisplayName}
                onChange={(e) => setProjectDisplayName(e.target.value)}
              />
              <input
                className="w-full bg-surface-secondary text-text text-xs px-2 py-1.5 rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-surface transition-all duration-150"
                placeholder="Working Directory"
                value={projectDir}
                onChange={(e) => setProjectDir(e.target.value)}
              />
              <button
                onClick={handleCreateProject}
                className="w-full bg-primary text-white text-xs py-1.5 rounded-lg hover:bg-primary-hover transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 focus:ring-offset-surface"
              >
                Create
              </button>
            </div>
          )}

          <div className="space-y-0.5">
            {projects.map((p: any) => (
              <div
                key={p.id}
                className="px-3 py-1.5 text-sm text-text-secondary hover:text-text cursor-pointer truncate transition-colors duration-150"
                onClick={() => navigate(`/board?projectId=${p.id}`)}
              >
                {p.displayName}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center justify-end px-4 py-2 border-b border-border bg-surface">
          <ThemeToggle />
        </div>
        <Outlet />
      </main>
    </div>
  );
}

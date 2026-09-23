import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "../lib/icons";
import { ChevronRightIcon, DownloadIcon, ToolsIcon } from "../lib/icons";
import { TOOLS } from "../lib/tools";
import { Badge } from "../components/Badge";
import { PageBody, PageHeader } from "../components/PageHeader";

const TOOL_ICONS: Record<string, LucideIcon> = {
  download: DownloadIcon,
};

export function ToolsPage() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        icon={ToolsIcon}
        title="Tools"
        description="Helpers for setting up AgentQ on your machine."
      />

      <PageBody>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {TOOLS.map((tool, i) => {
            const Icon = TOOL_ICONS[tool.icon] ?? ToolsIcon;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => navigate(`/tools/${tool.id}`)}
                className="card-interactive group stagger flex flex-col p-5 text-left"
                style={{ "--i": i } as CSSProperties}
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-accent/10 text-primary ring-1 ring-inset ring-primary/15 transition-transform duration-300 ease-spring group-hover:scale-105">
                  <Icon aria-hidden className="h-5 w-5" />
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-text">{tool.name}</h3>
                  {tool.badge && <Badge tone="warning">{tool.badge}</Badge>}
                </div>
                <p className="mt-1 flex-1 text-sm leading-relaxed text-text-secondary">
                  {tool.description}
                </p>
                <span className="mt-4 inline-flex items-center gap-0.5 text-xs font-medium text-text-muted transition-colors duration-150 group-hover:text-primary">
                  Open
                  <ChevronRightIcon
                    aria-hidden
                    className="h-3.5 w-3.5 transition-transform duration-200 ease-out-expo group-hover:translate-x-0.5"
                  />
                </span>
              </button>
            );
          })}
        </div>
      </PageBody>
    </div>
  );
}

import { useNavigate } from "react-router-dom";
import { TOOLS } from "../lib/tools";

function ToolIcon({ icon }: { icon: string }) {
  if (icon === "download") {
    return (
      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    );
  }
  return null;
}

export function ToolsPage() {
  const navigate = useNavigate();

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border bg-surface flex items-center px-4 gap-4 shrink-0 text-text">
        <h2 className="font-semibold text-text">Tools</h2>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              onClick={() => navigate(`/tools/${tool.id}`)}
              className="bg-surface border border-border rounded-lg p-6 text-left hover:border-primary hover:shadow-sm transition-all duration-150 cursor-pointer group"
            >
              <div className="text-primary group-hover:text-primary/80 mb-3">
                <ToolIcon icon={tool.icon} />
              </div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-text">{tool.name}</h3>
                {tool.badge && (
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-600 border border-yellow-500/30 leading-none">
                    {tool.badge}
                  </span>
                )}
              </div>
              <p className="text-sm text-text-secondary">{tool.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

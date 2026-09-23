import type { CSSProperties } from "react";
import { DownloadIcon } from "../lib/icons";
import { CopyButton } from "../components/CopyButton";
import { PageBody, PageHeader } from "../components/PageHeader";

const INSTALL_STEPS = [
  {
    title: "Register the MCP Server",
    description:
      "Connect every coding tool installed on this machine (Claude Code, Codex, OpenCode, Gemini CLI, GitHub Copilot CLI, GitHub Copilot in VS Code) to the AgentQ MCP server. Safe to run again.",
    command: "bun run install:mcp",
  },
  {
    title: "Install Workflow Skills",
    description: "Copy the AgentQ workflow skill to all detected coding-agent tool directories.",
    command: "bun run install:skills",
  },
];

export function InstallToolPage() {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        back={{ to: "/tools", label: "Back to tools" }}
        icon={DownloadIcon}
        title="Install AgentQ"
        description="Run these commands from the project root in your terminal."
      />

      <PageBody>
        <ol className="mx-auto max-w-3xl">
          {INSTALL_STEPS.map((step, i) => (
            <li
              key={step.command}
              className="stagger relative flex gap-4 pb-6 last:pb-0"
              style={{ "--i": i } as CSSProperties}
            >
              {i < INSTALL_STEPS.length - 1 && (
                <span
                  aria-hidden
                  className="absolute bottom-0 left-4 top-10 w-px -translate-x-1/2 bg-border"
                />
              )}
              <span className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold tabular-nums text-primary ring-1 ring-inset ring-primary/20">
                {i + 1}
              </span>
              <div className="card min-w-0 flex-1 p-4">
                <h3 className="text-sm font-semibold text-text">{step.title}</h3>
                <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
                  {step.description}
                </p>
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-canvas py-1 pl-3 pr-1">
                  <span aria-hidden className="select-none font-mono text-xs text-text-muted">
                    $
                  </span>
                  <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap py-1.5 font-mono text-xs text-text">
                    {step.command}
                  </code>
                  <CopyButton value={step.command} label="Copy command" />
                </div>
              </div>
            </li>
          ))}
        </ol>
      </PageBody>
    </div>
  );
}

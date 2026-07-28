export function InstallToolPage() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border bg-surface flex items-center px-4 gap-4 shrink-0 text-text">
        <h2 className="font-semibold text-text">Install AgentQ</h2>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-6">
        <div className="bg-surface border border-border rounded-lg p-6 text-sm text-text-secondary leading-relaxed space-y-4">
          <p>
            AgentQ provides a CLI tool and a workflow skill that integrates with AI coding
            assistants.
          </p>

          <h3 className="text-text font-semibold">CLI Binary</h3>
          <p>
            Install the <code className="text-primary">agentq</code> CLI tool by running:
          </p>
          <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs font-mono overflow-auto border border-border">
            {`bun run install:bin`}
          </pre>

          <h3 className="text-text font-semibold">Workflow Skills</h3>
          <p>
            To install the AgentQ workflow skills to your AI coding tools, run:
          </p>
          <pre className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs font-mono overflow-auto border border-border">
            {`bun run install:skills`}
          </pre>

          <h3 className="text-text font-semibold">Manual Setup</h3>
          <p>
            The skills directory at <code className="text-primary">skills/agentq-workflow/</code>{" "}
            contains the workflow skill files. You can manually copy them to your AI tool's skills
            directory if needed.
          </p>
        </div>
      </div>
    </div>
  );
}

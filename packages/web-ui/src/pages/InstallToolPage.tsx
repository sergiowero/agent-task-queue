const INSTALL_STEPS = [
  {
    title: "Install CLI Binary",
    description: "Build and install the AgentQ CLI so it is available on your PATH.",
    command: "bun run install:bin",
  },
  {
    title: "Install Workflow Skills",
    description: "Copy the AgentQ workflow skill to all detected coding-agent tool directories.",
    command: "bun run install:skills",
  },
  {
    title: "Install Agents",
    description: "Register the AgentQ agent definitions for your coding agents.",
    command: "bun run install:agents",
  },
];

export function InstallToolPage() {
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border bg-surface flex items-center px-4 shrink-0 text-text">
        <h2 className="font-semibold text-text">Install AgentQ</h2>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-4">
        <p className="text-sm text-text-secondary">
          Run these commands from the project root in your terminal:
        </p>
        {INSTALL_STEPS.map((step, i) => (
          <div key={step.command} className="rounded-lg border border-border p-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold shrink-0">
                {i + 1}
              </span>
              <h3 className="text-sm font-medium text-text">{step.title}</h3>
            </div>
            <p className="text-xs text-text-secondary mb-2 pl-7">{step.description}</p>
            <pre className="bg-gray-900 text-green-400 rounded-lg p-3 text-xs font-mono overflow-auto border border-border pl-7">
              {step.command}
            </pre>
          </div>
        ))}
      </div>
    </div>
  );
}
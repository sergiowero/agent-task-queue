import { useState, useRef, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";

function useSSEOutput() {
  const [output, setOutput] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const run = useCallback(async (fetcher: () => Promise<Response>) => {
    setIsRunning(true);
    setOutput("");
    setExitCode(null);

    try {
      const res = await fetcher();
      if (!res.ok) {
        setOutput(`Error: ${res.status} ${res.statusText}`);
        setIsRunning(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() || "";

        for (const event of events) {
          const dataMatch = event.match(/^data: (.+)$/m);
          if (!dataMatch) continue;
          const data = dataMatch[1];
          try {
            const parsed = JSON.parse(data);
            if (typeof parsed === "object" && parsed !== null && "code" in parsed) {
              setExitCode(parsed.code);
            } else {
              setOutput((prev) => prev + parsed);
            }
          } catch {
            setOutput((prev) => prev + data);
          }
        }
      }
    } catch (err: any) {
      setOutput((prev) => prev + `\nError: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  }, []);

  return { output, isRunning, exitCode, outputRef, run };
}

export function InstallToolPage() {
  const bin = useSSEOutput();
  const skills = useSSEOutput();
  const [copied, setCopied] = useState(false);

  const { data: skillData } = useQuery({
    queryKey: ["skill-file"],
    queryFn: () => api.getSkillFile(),
  });

  async function handleCopy() {
    if (!skillData?.content) return;
    await navigator.clipboard.writeText(skillData.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border bg-surface flex items-center px-4 gap-4 shrink-0 text-text">
        <h2 className="font-semibold text-text">Install AgentQ</h2>
      </div>

      <div className="flex-1 overflow-auto p-4 space-y-6">
        {/* Binary Install */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-text">Binary</h3>
            <button
              onClick={() => bin.run(api.executeInstall)}
              disabled={bin.isRunning}
              className="px-4 py-1.5 bg-primary text-white text-sm font-medium rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {bin.isRunning ? "Installing..." : "Install Binary"}
            </button>
          </div>
          <pre
            ref={bin.outputRef}
            className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs font-mono overflow-auto max-h-64 border border-border"
          >
            {bin.output || "Click 'Install Binary' to build and install the CLI tool."}
            {bin.exitCode !== null && (
              <span className="mt-2 text-yellow-400 block">
                Process exited with code {bin.exitCode}
              </span>
            )}
          </pre>
        </div>

        {/* Skills Install */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-text">Skills</h3>
            <button
              onClick={() => skills.run(api.executeInstallSkills)}
              disabled={skills.isRunning}
              className="px-4 py-1.5 bg-primary text-white text-sm font-medium rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {skills.isRunning ? "Installing..." : "Install Skills"}
            </button>
          </div>
          <pre
            ref={skills.outputRef}
            className="bg-gray-900 text-green-400 rounded-lg p-4 text-xs font-mono overflow-auto max-h-64 border border-border"
          >
            {skills.output || "Click 'Install Skills' to copy the workflow skill to all detected tools."}
            {skills.exitCode !== null && (
              <span className="mt-2 text-yellow-400 block">
                Process exited with code {skills.exitCode}
              </span>
            )}
          </pre>
        </div>

        {/* Skill File */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-text">Skill File (Manual Install)</h3>
            <button
              onClick={handleCopy}
              className="px-3 py-1 text-xs bg-surface-secondary border border-border rounded hover:bg-surface transition-colors text-text"
            >
              {copied ? "Copied!" : "Copy to Clipboard"}
            </button>
          </div>
          <p className="text-xs text-text-secondary mb-2">
            Copy this file to your AI tool's skill directory to manually install AgentQ support.
          </p>
          <pre className="bg-gray-900 text-gray-300 rounded-lg p-4 text-xs font-mono overflow-auto max-h-96 border border-border">
            {skillData?.content || "Loading..."}
          </pre>
        </div>
      </div>
    </div>
  );
}

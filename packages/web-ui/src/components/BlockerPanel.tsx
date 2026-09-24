import { useState } from "react";
import { resolveTargets, statusLabel } from "@agentq/shared/catalog";
import type { Task } from "../lib/api";
import { NeedsHumanIcon, SendIcon } from "../lib/icons";
import { formatRelative } from "../lib/format";
import { Alert } from "./Alert";
import { Button } from "./Button";
import { Field } from "./Field";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { Select } from "./Select";
import { Textarea } from "./Textarea";

interface BlockerPanelProps {
  task: Task;
  busy?: boolean;
  disabled?: boolean;
  onResolve: (answer: string, targetStatus: string) => void;
}

/** What blocked the agent, its question, and the person's answer + where the task goes next. */
export function BlockerPanel({ task, busy, disabled, onResolve }: BlockerPanelProps) {
  const blocker = task.blocker;
  const targets = resolveTargets(blocker?.phase ?? null);
  const [answer, setAnswer] = useState("");
  const [target, setTarget] = useState<string>(targets[0]);

  return (
    <div className="mt-4 space-y-3">
      {blocker && (
        <Alert tone="danger" icon={NeedsHumanIcon} title={blocker.question}>
          <div className="mt-1 text-text-secondary">
            <MarkdownRenderer content={blocker.reason} />
            <p className="mt-1 text-xs text-text-muted">
              Raised by <span className="font-mono">{blocker.raisedBy}</span> while{" "}
              {statusLabel(blocker.fromStatus).toLowerCase()}, {formatRelative(blocker.at)}
            </p>
          </div>
        </Alert>
      )}
      <Field label="Your answer" hint="Saved in the conversation, where the next agent reads it.">
        <Textarea
          rows={3}
          placeholder="Answer the question or say what you did to unblock it"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="Then move the task to" className="min-w-[14rem]">
          <Select value={target} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          icon={SendIcon}
          loading={busy}
          disabled={disabled}
          onClick={() => onResolve(answer.trim(), target)}
        >
          Send
        </Button>
      </div>
    </div>
  );
}

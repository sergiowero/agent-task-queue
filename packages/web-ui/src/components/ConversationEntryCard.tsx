import type { LucideIcon } from "../lib/icons";
import {
  AgentsIcon,
  InfoIcon,
  MergeIcon,
  PlanIcon,
  ReviewIcon,
  TerminalIcon,
  VerifyIcon,
  UserIcon,
} from "../lib/icons";
import type { Tone } from "../lib/status";
import { TONE_SOFT } from "../lib/status";
import { formatDateTime, formatRelative } from "../lib/format";
import { cn } from "../lib/cn";
import { Badge } from "./Badge";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface ConversationEntry {
  authorName: string;
  timestamp: string;
  message: string;
  messageType?: "user" | "agent" | "plan" | "code" | "review" | "merge" | "system" | (string & {});
}

const TYPE_META: Record<string, { label: string; tone: Tone; icon: LucideIcon }> = {
  plan: { label: "Plan", tone: "accent", icon: PlanIcon },
  code: { label: "Code", tone: "info", icon: TerminalIcon },
  verify: { label: "Verification", tone: "info", icon: VerifyIcon },
  review: { label: "Review", tone: "warning", icon: ReviewIcon },
  merge: { label: "Merge", tone: "success", icon: MergeIcon },
  user: { label: "User", tone: "primary", icon: UserIcon },
  agent: { label: "Agent", tone: "neutral", icon: AgentsIcon },
  system: { label: "System", tone: "neutral", icon: InfoIcon },
};

interface ConversationEntryCardProps {
  entry: ConversationEntry;
}

export function ConversationEntryCard({ entry }: ConversationEntryCardProps) {
  const type = entry.messageType ?? "agent";
  const meta = TYPE_META[type] ?? TYPE_META.agent;
  const isSystem = type === "system";
  const Icon = meta.icon;

  return (
    <article className="flex gap-3">
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
          TONE_SOFT[meta.tone],
        )}
      >
        <Icon aria-hidden className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <header className="flex min-h-8 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-sm font-medium text-text">{entry.authorName}</span>
          <Badge tone={meta.tone}>{meta.label}</Badge>
          <time
            dateTime={entry.timestamp}
            title={formatDateTime(entry.timestamp)}
            className="text-xs text-text-muted"
          >
            {formatRelative(entry.timestamp)}
          </time>
        </header>
        {isSystem ? (
          // A descendant selector outranks the renderer's own `text-text` regardless of CSS order.
          <div className="mt-0.5 [&_.markdown-content]:text-text-muted">
            <MarkdownRenderer content={entry.message} />
          </div>
        ) : (
          <div className="card mt-1.5 px-4 py-3">
            <MarkdownRenderer content={entry.message} />
          </div>
        )}
      </div>
    </article>
  );
}

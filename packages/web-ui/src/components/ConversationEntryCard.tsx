import { MarkdownRenderer } from "./MarkdownRenderer";
import { Badge } from "./Badge";

interface ConversationEntry {
  authorName: string;
  timestamp: string;
  message: string;
  messageType?: "user" | "agent" | "plan" | "code" | "review" | "merge" | "system";
}

const TYPE_VARIANTS: Record<string, "default" | "success" | "warning" | "danger" | "info" | "purple"> = {
  plan: "purple",
  code: "info",
  review: "warning",
  merge: "success",
  user: "default",
  agent: "default",
  system: "default",
};

const TYPE_LABELS: Record<string, string> = {
  plan: "Plan",
  code: "Code",
  review: "Review",
  merge: "Merge",
  user: "User",
  agent: "Agent",
  system: "System",
};

const BORDER_COLORS: Record<string, string> = {
  plan: "border-violet-400 dark:border-violet-500",
  code: "border-blue-400 dark:border-blue-500",
  review: "border-amber-400 dark:border-amber-500",
  merge: "border-green-400 dark:border-green-500",
  user: "border-gray-300 dark:border-gray-600",
  agent: "border-gray-300 dark:border-gray-600",
  system: "border-gray-200 dark:border-gray-700",
};

const BG_TINTS: Record<string, string> = {
  plan: "bg-violet-50/40 dark:bg-violet-900/10",
  code: "bg-blue-50/40 dark:bg-blue-900/10",
  review: "bg-amber-50/40 dark:bg-amber-900/10",
  merge: "bg-green-50/40 dark:bg-green-900/10",
  user: "bg-transparent",
  agent: "bg-surface-secondary/50",
  system: "bg-transparent",
};

interface ConversationEntryCardProps {
  entry: ConversationEntry;
}

export function ConversationEntryCard({ entry }: ConversationEntryCardProps) {
  const type = entry.messageType ?? "agent";
  const variant = TYPE_VARIANTS[type] ?? "default";
  const label = TYPE_LABELS[type] ?? "Agent";
  const borderColor = BORDER_COLORS[type] ?? "border-border";
  const bgTint = BG_TINTS[type] ?? "bg-transparent";
  const isSystem = type === "system";

  return (
    <div className={`border-l-2 ${borderColor} pl-3 py-2 ${bgTint} rounded-r-lg ${isSystem ? "opacity-70 italic" : ""}`}>
      <div className="flex items-baseline gap-2 flex-wrap">
        <Badge variant={variant} size="sm">{label}</Badge>
        <span className="text-xs font-medium text-text-secondary">{entry.authorName}</span>
        <span className="text-xs text-text-muted">{new Date(entry.timestamp).toLocaleString()}</span>
      </div>
      <MarkdownRenderer content={entry.message} className="mt-1" />
    </div>
  );
}
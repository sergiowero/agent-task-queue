import { STATUS_INFO, TaskStatus } from "@agentq/shared/catalog";
import type { LucideIcon } from "./icons";
import {
  ApproveIcon,
  CancelTaskIcon,
  CompleteIcon,
  FailedIcon,
  InProgressIcon,
  MergeIcon,
  NeedsHumanIcon,
  PendingIcon,
  PlanIcon,
  RequestChangesIcon,
  ReviewIcon,
  RevertedIcon,
  SpinnerIcon,
  SuccessIcon,
  TerminalIcon,
} from "./icons";
import type { RunnerJobStatus, RunnerTool } from "./api";

/** Semantic color tone shared by Badge, StatusBadge, dots and accents. */
export type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger" | "accent";

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  /** An agent is actively working on it: show a live indicator. */
  live?: boolean;
}

/** Look of each status (labels come from the shared catalog; a new status fails typecheck here). */
const STATUS_LOOK: Record<TaskStatus, Omit<StatusMeta, "label">> = {
  [TaskStatus.PlanRequested]: { tone: "neutral", icon: PendingIcon },
  [TaskStatus.Planning]: { tone: "accent", icon: PlanIcon, live: true },
  [TaskStatus.WaitingPlanReview]: { tone: "warning", icon: ReviewIcon },
  [TaskStatus.PlanChangesRequested]: { tone: "danger", icon: RequestChangesIcon },
  [TaskStatus.ReadyForCode]: { tone: "info", icon: PendingIcon },
  [TaskStatus.Coding]: { tone: "info", icon: TerminalIcon, live: true },
  [TaskStatus.WaitingCodeReview]: { tone: "warning", icon: ReviewIcon },
  [TaskStatus.CodeReviewRequested]: { tone: "warning", icon: ReviewIcon },
  [TaskStatus.Reviewing]: { tone: "warning", icon: ReviewIcon, live: true },
  [TaskStatus.ChangesRequested]: { tone: "danger", icon: RequestChangesIcon },
  [TaskStatus.Approved]: { tone: "success", icon: ApproveIcon },
  [TaskStatus.Merging]: { tone: "warning", icon: MergeIcon, live: true },
  [TaskStatus.Merged]: { tone: "success", icon: MergeIcon },
  [TaskStatus.Complete]: { tone: "success", icon: CompleteIcon },
  [TaskStatus.Canceled]: { tone: "danger", icon: CancelTaskIcon },
  [TaskStatus.NeedsHuman]: { tone: "danger", icon: NeedsHumanIcon },
};

export const TASK_STATUS: Record<string, StatusMeta> = Object.fromEntries(
  Object.entries(STATUS_LOOK).map(([status, look]) => [
    status,
    { label: STATUS_INFO[status as TaskStatus].label, ...look },
  ]),
);

export function taskStatusMeta(status: string): StatusMeta {
  return (
    TASK_STATUS[status] ?? {
      label: status.replace(/_/g, " "),
      tone: "neutral",
      icon: InProgressIcon,
    }
  );
}

export const JOB_STATUS: Record<RunnerJobStatus, StatusMeta> = {
  running: { label: "Running", tone: "info", icon: SpinnerIcon, live: true },
  succeeded: { label: "Succeeded", tone: "success", icon: SuccessIcon },
  failed: { label: "Failed", tone: "danger", icon: FailedIcon },
  reverted: { label: "Reverted", tone: "warning", icon: RevertedIcon },
  blocked: { label: "Blocked", tone: "danger", icon: NeedsHumanIcon },
};

export const TOOL_TONE: Record<RunnerTool | string, Tone> = {
  claude: "accent",
  codex: "info",
  opencode: "success",
  gemini: "warning",
  custom: "neutral",
};

/** Higher numbers are more urgent (agents claim `ORDER BY priority DESC`). */
export function priorityTone(priority: number): Tone {
  if (priority >= 3) return "danger";
  if (priority === 2) return "warning";
  if (priority === 1) return "info";
  return "neutral";
}

/** Solid background class per tone, for dots and accent bars. */
export const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-text-muted",
  primary: "bg-primary",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  accent: "bg-accent",
};

/** Readable text class per tone. */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-text-secondary",
  primary: "text-primary",
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  accent: "text-accent",
};

/** Soft tinted background + text, for chips and icon wells. */
export const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-surface-tertiary text-text-secondary",
  primary: "bg-primary/10 text-primary",
  info: "bg-info/10 text-info",
  success: "bg-success/10 text-success",
  warning: "bg-warning/10 text-warning",
  danger: "bg-danger/10 text-danger",
  accent: "bg-accent/10 text-accent",
};

/** Border class per tone, for left accents and outlines. */
export const TONE_BORDER: Record<Tone, string> = {
  neutral: "border-border-strong",
  primary: "border-primary/50",
  info: "border-info/50",
  success: "border-success/50",
  warning: "border-warning/50",
  danger: "border-danger/50",
  accent: "border-accent/50",
};

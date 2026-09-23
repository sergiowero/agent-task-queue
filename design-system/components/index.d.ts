// AgentQ portal components (packages/web-ui/src/components), exposed as window.AgentQ.
import type * as React from "react";
import type { LucideIcon } from "lucide-react";

/** Semantic color tone shared by Badge, StatusBadge, dots and accents. */
export type Tone = "neutral" | "primary" | "info" | "success" | "warning" | "danger" | "accent";

export type ButtonVariant =
  "primary" | "secondary" | "ghost" | "danger" | "danger-ghost" | "subtle";
export type ButtonSize = "sm" | "md" | "lg";
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Default "primary". */
  variant?: ButtonVariant;
  /** Default "md". */
  size?: ButtonSize;
  /** Leading icon. Replaced by a spinner while `loading`. */
  icon?: LucideIcon;
  /** Trailing icon. */
  iconRight?: LucideIcon;
  /** Shows a spinner and disables the button. */
  loading?: boolean;
}
export declare const Button: React.ForwardRefExoticComponent<
  ButtonProps & React.RefAttributes<HTMLButtonElement>
>;
export declare const buttonVariants: Record<ButtonVariant, string>;

export interface IconButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  icon: LucideIcon;
  /** Accessible name; also shown as the tooltip. */
  label: string;
  /** Default "ghost". */
  variant?: "ghost" | "secondary" | "primary" | "danger";
  /** Default "sm". */
  size?: "xs" | "sm" | "md";
  loading?: boolean;
  /** Pressed/selected look for toggle-style buttons. */
  active?: boolean;
  /** Default true. */
  tooltip?: boolean;
  tooltipSide?: "top" | "bottom" | "left" | "right";
}
/** Square, icon-only button. Always labelled for screen readers and via tooltip. */
export declare const IconButton: React.ForwardRefExoticComponent<
  IconButtonProps & React.RefAttributes<HTMLButtonElement>
>;

export interface CopyButtonProps {
  value: string;
  /** Default "Copy". */
  label?: string;
  /** Default "sm". */
  size?: "xs" | "sm";
  className?: string;
}
/** Copies `value` to the clipboard and morphs into a check for a moment. */
export declare function CopyButton(props: CopyButtonProps): React.ReactElement;

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  /** Leading icon inside the field. */
  icon?: LucideIcon;
  /** Element rendered at the right edge inside the field (e.g. a clear button). */
  trailing?: React.ReactNode;
  /** Classes for the outer wrapper. */
  wrapperClassName?: string;
  /** Default "md". */
  inputSize?: "sm" | "md";
}
export declare const Input: React.ForwardRefExoticComponent<
  InputProps & React.RefAttributes<HTMLInputElement>
>;

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string;
}
export declare const Textarea: React.ForwardRefExoticComponent<
  TextareaProps & React.RefAttributes<HTMLTextAreaElement>
>;

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  /** Leading icon inside the field. */
  icon?: LucideIcon;
  /** Classes for the outer wrapper (e.g. a fixed width in toolbars). */
  wrapperClassName?: string;
  /** Default "md". */
  selectSize?: "sm" | "md";
}
/** Native select with the shared control styling and a chevron. */
export declare const Select: React.ForwardRefExoticComponent<
  SelectProps & React.RefAttributes<HTMLSelectElement>
>;

export interface FieldProps {
  label: React.ReactNode;
  required?: boolean;
  /** Help text under the control. */
  hint?: React.ReactNode;
  /** Tints the hint (e.g. a warning about a risky setting). Default "muted". */
  hintTone?: "muted" | "warning" | "danger";
  icon?: LucideIcon;
  /** Right side of the label row (e.g. a small action). */
  aside?: React.ReactNode;
  className?: string;
  /** A single form control; it receives the generated id. */
  children: React.ReactNode;
}
/** Label + control + hint, the standard form row. */
export declare function Field(props: FieldProps): React.ReactElement;

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible label; shown as text when `showLabel` is set. */
  label: string;
  showLabel?: boolean;
  /** Mixed state (some but not all children selected). */
  indeterminate?: boolean;
  disabled?: boolean;
  className?: string;
}
/** Custom checkbox with an animated check. Stops click propagation so it works inside clickable cards. */
export declare function Checkbox(props: CheckboxProps): React.ReactElement;

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  /** Secondary line under the label. */
  description?: string;
  icon?: LucideIcon;
  disabled?: boolean;
}
export declare function Toggle(props: ToggleProps): React.ReactElement;

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Hide the text and show it as a tooltip instead. */
  iconOnly?: boolean;
}
export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange: (value: T, event: React.MouseEvent<HTMLButtonElement>) => void;
  options: SegmentOption<T>[];
  /** Default "md". */
  size?: "sm" | "md";
  /** Stretch segments to fill the width. */
  fullWidth?: boolean;
  /** Accessible name for the group. */
  label: string;
  className?: string;
}
/** Pill-style single choice with a sliding thumb. */
export declare function SegmentedControl<T extends string>(
  props: SegmentedControlProps<T>,
): React.ReactElement;

export interface TabItem<T extends string> {
  value: T;
  label: string;
  icon?: LucideIcon;
  /** Small count shown after the label. */
  count?: React.ReactNode;
}
export interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  items: TabItem<T>[];
  label: string;
  className?: string;
}
/** Underline tabs with a sliding indicator. */
export declare function Tabs<T extends string>(props: TabsProps<T>): React.ReactElement;

export interface BadgeProps {
  tone?: Tone;
  /** @deprecated use `tone` ("default" = neutral, "purple" = accent). */
  variant?: Tone | "default" | "purple";
  /** Default "sm". */
  size?: "sm" | "md";
  icon?: LucideIcon;
  dot?: boolean;
  /** Animated ring around the dot, for live states. */
  pulse?: boolean;
  className?: string;
  title?: string;
  children: React.ReactNode;
}
export declare function Badge(props: BadgeProps): React.ReactElement;
/** Colored status dot with an optional live pulse. */
export declare function Dot(props: {
  tone?: Tone;
  pulse?: boolean;
  className?: string;
}): React.ReactElement;
/** Badge for a task workflow status, with its icon, tone and live pulse. */
export declare function StatusBadge(props: {
  status: string;
  size?: "sm" | "md";
}): React.ReactElement;
/** Badge for a runner job status. */
export declare function JobStatusBadge(props: {
  status: "running" | "succeeded" | "failed" | "reverted";
  size?: "sm" | "md";
}): React.ReactElement;

/** Number pill next to a title. */
export declare function CountPill(props: { children: React.ReactNode }): React.ReactElement;

export interface AlertProps {
  /** Default "info". */
  tone?: "info" | "success" | "warning" | "danger";
  title?: React.ReactNode;
  icon?: LucideIcon;
  /** Right-aligned action (e.g. a small Button). */
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}
/** Inline message box for errors, warnings and notes. */
export declare function Alert(props: AlertProps): React.ReactElement;

/** Default className "h-4 w-4". */
export declare function Spinner(props: { className?: string }): React.ReactElement;
/** Shimmering placeholder block. Size it with `className`. */
export declare function Skeleton(props: { className?: string }): React.ReactElement;

export interface EmptyStateProps {
  /** Default EmptyIcon (Inbox). */
  icon?: LucideIcon;
  title: string;
  description?: React.ReactNode;
  /** Usually a primary Button. */
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}
export declare function EmptyState(props: EmptyStateProps): React.ReactElement;

export interface TooltipProps {
  content: React.ReactNode;
  /** Default "top". */
  side?: "top" | "bottom" | "left" | "right";
  /** Hover delay in ms before showing. Default 350. */
  delay?: number;
  disabled?: boolean;
  /** Must be a single element that accepts ref, mouse and focus handlers. */
  children: React.ReactElement;
}
/** Small label that appears on hover/focus. Rendered in a portal so it is not clipped by scroll containers. */
export declare function Tooltip(props: TooltipProps): React.ReactElement;

interface ModalShellProps {
  /** Called on Escape, backdrop click and the close button. */
  onClose: () => void;
  /** Plays the exit animation; supply via `useModal`. */
  closing?: boolean;
  /** Block Escape/backdrop dismissal (e.g. while saving). Default true. */
  dismissible?: boolean;
}
export interface ModalProps extends ModalShellProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  /** Default "primary". */
  iconTone?: Tone;
  /** sm 448px, md 512px (default), lg 672px, xl 896px. */
  size?: "sm" | "md" | "lg" | "xl";
  /** Buttons row, right-aligned. */
  footer?: React.ReactNode;
  /** Left side of the footer (e.g. a destructive action). */
  footerStart?: React.ReactNode;
  /** Wraps body+footer in a form; Enter submits. */
  onSubmit?: () => void;
  children?: React.ReactNode;
}
export declare function Modal(props: ModalProps): React.ReactPortal;
export interface DrawerProps extends ModalShellProps {
  /** Header content (title, badges, actions); a close button is appended. */
  header: React.ReactNode;
  /** Default "max-w-4xl". */
  width?: string;
  children: React.ReactNode;
}
/** Right-side sheet for detail views. Use `useModal` for animated closing. */
export declare function Drawer(props: DrawerProps): React.ReactPortal;
/** Animated close: `close()` plays the 180ms exit animation, then calls `onClose`. */
export declare function useModal(onClose: () => void): {
  close: () => void;
  closing: boolean;
  props: { closing: boolean; onClose: () => void };
};

export interface ConfirmDialogProps {
  title: React.ReactNode;
  message: React.ReactNode;
  /** Default "Delete". */
  confirmLabel?: string;
  /** Label of the dismiss button; override when "Cancel" would be ambiguous. */
  cancelLabel?: string;
  /** Icon on the confirm button and in the header. Defaults to a trash can for danger. */
  icon?: LucideIcon;
  /** Default "danger". */
  tone?: "danger" | "primary" | "warning";
  /** Runs on confirm. The dialog closes (animated) when it resolves and stays open if it throws. */
  onConfirm: () => Promise<unknown> | unknown;
  onClose: () => void;
}
/** Yes/no confirmation with a loading state, e.g. before deleting something. */
export declare function ConfirmDialog(props: ConfirmDialogProps): React.ReactElement;

export interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: LucideIcon;
  /** Back button before the title, e.g. `{ to: "/board", label: "Back to board" }`. */
  back?: { to: string; label: string };
  /** Right-aligned actions (primary button last). */
  actions?: React.ReactNode;
  /** Count or status next to the title. */
  meta?: React.ReactNode;
  /** Optional toolbar row (search, filters) under the title row. */
  toolbar?: React.ReactNode;
  className?: string;
}
/** Top bar of every page: icon, title, description, actions, optional toolbar. */
export declare function PageHeader(props: PageHeaderProps): React.ReactElement;
/** Scrollable page body with consistent padding. */
export declare function PageBody(props: {
  children: React.ReactNode;
  className?: string;
}): React.ReactElement;

export interface Task {
  id: string;
  title: string;
  description: string | null;
  priority: number;
  recommendedBranch: string;
  status: string;
  assignedAgent: { name: string; tool: string; model: string } | null;
  [key: string]: unknown;
}
export interface TaskCardProps {
  task: Task;
  onClick: () => void;
  onDelete?: () => void;
  /** Shows an "Archive" button, e.g. on complete tasks. */
  onArchive?: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
}
export declare function TaskCard(props: TaskCardProps): React.ReactElement;

export interface ConversationEntry {
  authorName: string;
  timestamp: string;
  message: string;
  messageType?: "user" | "agent" | "plan" | "code" | "review" | "merge" | "system" | (string & {});
}
export declare function ConversationEntryCard(props: {
  entry: ConversationEntry;
}): React.ReactElement;
/** GitHub-flavored Markdown with theme-aware syntax highlighting. */
export declare function MarkdownRenderer(props: {
  content: string;
  className?: string;
}): React.ReactElement;

/** Join class names, skipping falsy entries; later classes override conflicting earlier ones. */
export declare function cn(...classes: Array<string | false | null | undefined>): string;

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  /** An agent is actively working on it: show a live indicator. */
  live?: boolean;
}
export declare const TASK_STATUS: Record<string, StatusMeta>;
export declare const JOB_STATUS: Record<
  "running" | "succeeded" | "failed" | "reverted",
  StatusMeta
>;
export declare const TOOL_TONE: Record<string, Tone>;
export declare function taskStatusMeta(status: string): StatusMeta;
/** Higher numbers are more urgent: >=3 danger, 2 warning, 1 info, else neutral. */
export declare function priorityTone(priority: number): Tone;
/** Solid background class per tone, for dots and accent bars. */
export declare const TONE_DOT: Record<Tone, string>;
/** Readable text class per tone. */
export declare const TONE_TEXT: Record<Tone, string>;
/** Soft tinted background + text, for chips and icon wells. */
export declare const TONE_SOFT: Record<Tone, string>;
/** Border class per tone, for left accents and outlines. */
export declare const TONE_BORDER: Record<Tone, string>;

/** The portal's icon vocabulary (lucide-react glyphs under action names), from lib/icons.ts. */
export declare const Icons: Record<string, LucideIcon>;

declare global {
  interface Window {
    AgentQ: {
      Button: typeof Button;
      IconButton: typeof IconButton;
      CopyButton: typeof CopyButton;
      Input: typeof Input;
      Textarea: typeof Textarea;
      Select: typeof Select;
      Field: typeof Field;
      Checkbox: typeof Checkbox;
      Toggle: typeof Toggle;
      SegmentedControl: typeof SegmentedControl;
      Tabs: typeof Tabs;
      Badge: typeof Badge;
      Dot: typeof Dot;
      StatusBadge: typeof StatusBadge;
      JobStatusBadge: typeof JobStatusBadge;
      CountPill: typeof CountPill;
      Alert: typeof Alert;
      Spinner: typeof Spinner;
      Skeleton: typeof Skeleton;
      EmptyState: typeof EmptyState;
      Tooltip: typeof Tooltip;
      Modal: typeof Modal;
      Drawer: typeof Drawer;
      useModal: typeof useModal;
      ConfirmDialog: typeof ConfirmDialog;
      PageHeader: typeof PageHeader;
      PageBody: typeof PageBody;
      TaskCard: typeof TaskCard;
      ConversationEntryCard: typeof ConversationEntryCard;
      MarkdownRenderer: typeof MarkdownRenderer;
      cn: typeof cn;
      buttonVariants: typeof buttonVariants;
      TASK_STATUS: typeof TASK_STATUS;
      JOB_STATUS: typeof JOB_STATUS;
      TOOL_TONE: typeof TOOL_TONE;
      TONE_DOT: typeof TONE_DOT;
      TONE_TEXT: typeof TONE_TEXT;
      TONE_SOFT: typeof TONE_SOFT;
      TONE_BORDER: typeof TONE_BORDER;
      taskStatusMeta: typeof taskStatusMeta;
      priorityTone: typeof priorityTone;
      Icons: typeof Icons;
    };
  }
}

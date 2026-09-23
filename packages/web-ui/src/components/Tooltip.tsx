import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../lib/cn";

type Side = "top" | "bottom" | "left" | "right";

/** Props the tooltip wraps on its trigger element. */
interface TriggerProps {
  ref?: React.Ref<HTMLElement>;
  "aria-describedby"?: string;
  onMouseEnter?: (e: React.MouseEvent) => void;
  onMouseLeave?: (e: React.MouseEvent) => void;
  onFocus?: (e: React.FocusEvent) => void;
  onBlur?: (e: React.FocusEvent) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
}

interface TooltipProps {
  content: ReactNode;
  side?: Side;
  /** Hover delay in ms before showing. */
  delay?: number;
  disabled?: boolean;
  /** Must be a single element that accepts ref, mouse and focus handlers. */
  children: ReactElement<TriggerProps>;
}

const GAP = 8;

/**
 * Small label that appears on hover/focus. Rendered in a portal so it is not
 * clipped by scroll containers.
 */
export function Tooltip({ content, side = "top", delay = 350, disabled, children }: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; side: Side } | null>(null);

  const show = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setOpen(false);
    setPos(null);
  }, []);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const close = () => hide();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open, hide]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !bubbleRef.current) return;
    const t = triggerRef.current.getBoundingClientRect();
    const b = bubbleRef.current.getBoundingClientRect();
    let s = side;
    if (s === "top" && t.top - b.height - GAP < 4) s = "bottom";
    if (s === "bottom" && t.bottom + b.height + GAP > window.innerHeight - 4) s = "top";
    if (s === "right" && t.right + b.width + GAP > window.innerWidth - 4) s = "left";
    if (s === "left" && t.left - b.width - GAP < 4) s = "right";
    let top = 0;
    let left = 0;
    if (s === "top" || s === "bottom") {
      top = s === "top" ? t.top - b.height - GAP : t.bottom + GAP;
      left = t.left + t.width / 2 - b.width / 2;
    } else {
      top = t.top + t.height / 2 - b.height / 2;
      left = s === "left" ? t.left - b.width - GAP : t.right + GAP;
    }
    left = Math.max(4, Math.min(left, window.innerWidth - b.width - 4));
    setPos({ top, left, side: s });
  }, [open, side, content]);

  if (!isValidElement(children) || disabled || !content) return children;

  const childProps = children.props;
  const trigger = cloneElement(children, {
    // React 19 passes refs as a regular prop.
    ref: (node: HTMLElement | null) => {
      triggerRef.current = node;
      const { ref } = childProps;
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object") {
        (ref as React.MutableRefObject<HTMLElement | null>).current = node;
      }
    },
    "aria-describedby": open ? id : childProps["aria-describedby"],
    onMouseEnter: (e: React.MouseEvent) => {
      childProps.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e: React.MouseEvent) => {
      childProps.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent) => {
      childProps.onFocus?.(e);
      if ((e.target as HTMLElement).matches?.(":focus-visible")) show();
    },
    onBlur: (e: React.FocusEvent) => {
      childProps.onBlur?.(e);
      hide();
    },
    onPointerDown: (e: React.PointerEvent) => {
      childProps.onPointerDown?.(e);
      hide();
    },
  });

  const origin: Record<Side, string> = {
    top: "origin-bottom",
    bottom: "origin-top",
    left: "origin-right",
    right: "origin-left",
  };

  return (
    <>
      {trigger}
      {open &&
        createPortal(
          <div
            ref={bubbleRef}
            id={id}
            role="tooltip"
            style={{
              top: pos?.top ?? -9999,
              left: pos?.left ?? -9999,
              visibility: pos ? "visible" : "hidden",
            }}
            className={cn(
              "pointer-events-none fixed z-[100] max-w-xs rounded-md px-2 py-1 text-xs font-medium",
              "bg-text text-surface shadow-lg",
              pos && "animate-tooltip-in",
              pos && origin[pos.side],
            )}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}

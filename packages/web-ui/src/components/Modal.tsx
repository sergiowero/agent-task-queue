import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { FocusTrap } from "focus-trap-react";
import type { LucideIcon } from "../lib/icons";
import { CloseIcon } from "../lib/icons";
import type { Tone } from "../lib/status";
import { TONE_SOFT } from "../lib/status";
import { cn } from "../lib/cn";
import { IconButton } from "./IconButton";

/** Exit animation length; keep in sync with `animate-scale-out` / `animate-slide-out-right`. */
const EXIT_MS = 180;

/**
 * Animated close for a modal or drawer. `close()` plays the exit animation and
 * then calls `onClose`, so use it for Cancel buttons and after a successful save:
 *
 *   const modal = useModal(onClose);
 *   <Modal {...modal.props} title="...">...<Button onClick={modal.close}>Cancel</Button></Modal>
 */
export function useModal(onClose: () => void) {
  const [closing, setClosing] = useState(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const close = useCallback(() => {
    setClosing((already) => {
      if (!already) timer.current = window.setTimeout(() => onCloseRef.current(), EXIT_MS);
      return true;
    });
  }, []);

  return { close, closing, props: { closing, onClose: close } };
}

/** Open modals/drawers, bottom to top. Only the topmost one reacts to Escape. */
const layers: symbol[] = [];

/** Registers an overlay layer: Escape handling for the topmost layer plus body scroll lock. */
function useOverlayLayer(onClose: () => void, dismissible: boolean) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const dismissibleRef = useRef(dismissible);
  dismissibleRef.current = dismissible;

  useEffect(() => {
    const layer = Symbol("overlay");
    layers.push(layer);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || layers[layers.length - 1] !== layer) return;
      e.stopPropagation();
      if (dismissibleRef.current) onCloseRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      layers.splice(layers.indexOf(layer), 1);
      document.body.style.overflow = overflow;
    };
  }, []);
}

interface ModalShellProps {
  /** Called on Escape, backdrop click and the close button. */
  onClose: () => void;
  /** Plays the exit animation; supply via `useModal`. */
  closing?: boolean;
  /** Block Escape/backdrop dismissal (e.g. while saving). */
  dismissible?: boolean;
}

interface ModalProps extends ModalShellProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: LucideIcon;
  iconTone?: Tone;
  size?: "sm" | "md" | "lg" | "xl";
  /** Buttons row, right-aligned. */
  footer?: ReactNode;
  /** Left side of the footer (e.g. a destructive action). */
  footerStart?: ReactNode;
  /** Wraps body+footer in a form; Enter submits. */
  onSubmit?: () => void;
  children?: ReactNode;
}

const sizes = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-2xl",
  xl: "max-w-4xl",
};

export function Modal({
  onClose,
  closing = false,
  dismissible = true,
  title,
  description,
  icon: Icon,
  iconTone = "primary",
  size = "md",
  footer,
  footerStart,
  onSubmit,
  children,
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
  useOverlayLayer(onClose, dismissible);

  const body = (
    <>
      {children && <div className="flex-1 overflow-y-auto px-6 pb-2 pt-1">{children}</div>}
      {(footer || footerStart) && (
        <div className="mt-2 flex items-center gap-2 border-t border-border-light bg-surface-secondary/40 px-6 py-4">
          {footerStart}
          <div className="flex flex-1 items-center justify-end gap-2">{footer}</div>
        </div>
      )}
    </>
  );

  return createPortal(
    <FocusTrap
      focusTrapOptions={{
        fallbackFocus: () => document.getElementById(titleId) ?? document.body,
        allowOutsideClick: true,
        escapeDeactivates: false,
        tabbableOptions: { displayCheck: "none" },
      }}
    >
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 bg-[rgb(var(--overlay))] backdrop-blur-[3px]",
            closing ? "animate-fade-out" : "animate-fade-in",
          )}
          onClick={() => dismissible && onClose()}
        />
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          className={cn(
            "relative flex max-h-[min(90vh,52rem)] w-full flex-col overflow-hidden rounded-2xl",
            "border border-border bg-surface-elevated shadow-xl",
            sizes[size],
            closing ? "animate-scale-out" : "animate-scale-in",
          )}
        >
          <div className="flex items-start gap-3.5 px-6 pb-4 pt-5">
            {Icon && (
              <div
                className={cn(
                  "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                  TONE_SOFT[iconTone],
                )}
              >
                <Icon aria-hidden className="h-5 w-5" />
              </div>
            )}
            <div className="min-w-0 flex-1 pt-0.5">
              <h2
                id={titleId}
                tabIndex={-1}
                className="text-base font-semibold tracking-tight text-text focus:outline-none"
              >
                {title}
              </h2>
              {description && (
                <p id={descId} className="mt-1 text-sm leading-relaxed text-text-secondary">
                  {description}
                </p>
              )}
            </div>
            <IconButton
              icon={CloseIcon}
              label="Close"
              size="sm"
              onClick={onClose}
              disabled={!dismissible}
              className="-mr-2 -mt-1"
              tooltip={false}
            />
          </div>
          {onSubmit ? (
            <form
              className="flex min-h-0 flex-1 flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                onSubmit();
              }}
            >
              {body}
            </form>
          ) : (
            body
          )}
        </div>
      </div>
    </FocusTrap>,
    document.body,
  );
}

interface DrawerProps extends ModalShellProps {
  /** Header content (title, badges, actions); a close button is appended. */
  header: ReactNode;
  width?: string;
  children: ReactNode;
}

/** Right-side sheet for detail views. Use `useModal` for animated closing. */
export function Drawer({
  onClose,
  closing = false,
  dismissible = true,
  header,
  width = "max-w-4xl",
  children,
}: DrawerProps) {
  const titleId = useId();
  useOverlayLayer(onClose, dismissible);

  return createPortal(
    <FocusTrap
      focusTrapOptions={{
        initialFocus: () => document.getElementById(titleId) ?? false,
        fallbackFocus: () => document.getElementById(titleId) ?? document.body,
        allowOutsideClick: true,
        escapeDeactivates: false,
        tabbableOptions: { displayCheck: "none" },
      }}
    >
      <div className="fixed inset-0 z-40 flex justify-end">
        <div
          aria-hidden
          className={cn(
            "absolute inset-0 bg-[rgb(var(--overlay))] backdrop-blur-[2px]",
            closing ? "animate-fade-out" : "animate-fade-in",
          )}
          onClick={() => dismissible && onClose()}
        />
        <div
          role="dialog"
          aria-modal="true"
          className={cn(
            "relative flex h-full w-full flex-col border-l border-border bg-surface-elevated shadow-xl",
            width,
            closing ? "animate-slide-out-right" : "animate-slide-in-right",
          )}
        >
          <div
            id={titleId}
            tabIndex={-1}
            className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-5 focus:outline-none"
          >
            <div className="flex min-w-0 flex-1 items-center gap-3">{header}</div>
            <IconButton icon={CloseIcon} label="Close" onClick={onClose} tooltipSide="left" />
          </div>
          <div className="flex min-h-0 flex-1">{children}</div>
        </div>
      </div>
    </FocusTrap>,
    document.body,
  );
}

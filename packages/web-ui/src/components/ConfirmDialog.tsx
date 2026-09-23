import { useState } from "react";
import type { ReactNode } from "react";
import type { LucideIcon } from "../lib/icons";
import { DeleteIcon, WarningIcon } from "../lib/icons";
import { Button } from "./Button";
import { Modal, useModal } from "./Modal";

interface ConfirmDialogProps {
  title: ReactNode;
  message: ReactNode;
  confirmLabel?: string;
  /** Label of the dismiss button; override when "Cancel" would be ambiguous. */
  cancelLabel?: string;
  /** Icon on the confirm button and in the header. Defaults to a trash can for danger. */
  icon?: LucideIcon;
  tone?: "danger" | "primary" | "warning";
  /** Runs on confirm. The dialog closes (animated) when it resolves and stays open if it throws. */
  onConfirm: () => Promise<unknown> | unknown;
  onClose: () => void;
}

/** Yes/no confirmation with a loading state, e.g. before deleting something. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  icon,
  tone = "danger",
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const modal = useModal(onClose);
  const [pending, setPending] = useState(false);
  const Icon = icon ?? (tone === "danger" ? DeleteIcon : WarningIcon);

  async function confirm() {
    setPending(true);
    try {
      await onConfirm();
      modal.close();
    } catch {
      // The caller reports the error (toast); keep the dialog open to retry.
      setPending(false);
    }
  }

  return (
    <Modal
      {...modal.props}
      dismissible={!pending}
      size="sm"
      icon={Icon}
      iconTone={tone}
      title={title}
      description={message}
      footer={
        <>
          <Button variant="secondary" onClick={modal.close} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            icon={Icon}
            loading={pending}
            onClick={confirm}
            autoFocus
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}

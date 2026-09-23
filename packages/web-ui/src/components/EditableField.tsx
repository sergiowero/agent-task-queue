import { useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import type { LucideIcon } from "../lib/icons";
import { CloseIcon, EditIcon, SaveIcon } from "../lib/icons";
import { cn } from "../lib/cn";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Input } from "./Input";
import { Textarea } from "./Textarea";

interface EditableFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  rows?: number;
  display: ReactNode;
  onSubmit: (value: string) => unknown;
  editable?: boolean;
  icon?: LucideIcon;
  /** `section`: a card with an eyebrow label. `property`: a compact label/value row for a details sidebar. */
  variant?: "section" | "property";
}

/** Hover-revealed on pointer devices, always visible on touch screens. */
const revealOnHover =
  "opacity-0 group-hover/field:opacity-100 group-focus-within/field:opacity-100 [@media(hover:none)]:opacity-100";

export function EditableField({
  label,
  value,
  placeholder = "",
  rows = 6,
  display,
  onSubmit,
  editable = true,
  icon: Icon,
  variant = "section",
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setDraft(value);
    setEditing(true);
    setError(null);
  }

  function cancel() {
    setDraft(value);
    setEditing(false);
    setError(null);
  }

  async function save() {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSubmit(draft);
      setEditing(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const singleLine = rows === 1 || variant === "property";
    if (e.key === "Enter" && (singleLine || e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  const editLabel = `Edit ${label.toLowerCase()}`;

  if (variant === "property") {
    return (
      <div className="group/field">
        <PropertyRow icon={Icon} label={label}>
          {!editing && (
            <>
              {/* Pencil sits before the value so values stay flush right in every row. */}
              {editable && (
                <IconButton
                  icon={EditIcon}
                  label={editLabel}
                  size="xs"
                  onClick={startEdit}
                  className={revealOnHover}
                />
              )}
              {display}
            </>
          )}
        </PropertyRow>
        {editing && (
          <div className="pb-2.5 animate-slide-down">
            <div className="flex items-center gap-1">
              <Input
                autoFocus
                inputSize="sm"
                aria-label={label}
                value={draft}
                placeholder={placeholder}
                disabled={saving}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKeyDown}
              />
              <IconButton
                icon={SaveIcon}
                label="Save"
                variant="primary"
                size="sm"
                loading={saving}
                onClick={save}
              />
              <IconButton
                icon={CloseIcon}
                label="Cancel"
                size="sm"
                disabled={saving}
                onClick={cancel}
              />
            </div>
            {error && <p className="mt-1.5 text-xs text-danger animate-slide-down">{error}</p>}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className="card group/field p-4">
      <div className="flex h-6 items-center justify-between gap-2">
        <h3 className="eyebrow flex items-center gap-1.5">
          {Icon && <Icon aria-hidden className="h-3.5 w-3.5" />}
          {label}
        </h3>
        {editable && !editing && (
          <IconButton
            icon={EditIcon}
            label={editLabel}
            size="xs"
            onClick={startEdit}
            className={revealOnHover}
          />
        )}
      </div>
      {editing ? (
        <div className="mt-3 space-y-2.5 animate-slide-down">
          {rows === 1 ? (
            <Input
              autoFocus
              aria-label={label}
              value={draft}
              placeholder={placeholder}
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
          ) : (
            <Textarea
              autoFocus
              aria-label={label}
              value={draft}
              rows={rows}
              placeholder={placeholder}
              disabled={saving}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKeyDown}
            />
          )}
          {error && <p className="text-xs text-danger animate-slide-down">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            {rows !== 1 && (
              <span className="mr-auto hidden text-[11px] text-text-muted sm:inline">
                Ctrl+Enter to save · Esc to cancel
              </span>
            )}
            <Button size="sm" variant="ghost" icon={CloseIcon} onClick={cancel} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" icon={SaveIcon} loading={saving} onClick={save}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2">{display}</div>
      )}
    </section>
  );
}

interface PropertyRowProps {
  icon?: LucideIcon;
  label: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Label on the left, value on the right: one line of a details sidebar. */
export function PropertyRow({ icon: Icon, label, children, className }: PropertyRowProps) {
  return (
    <div className={cn("flex min-h-11 items-center gap-3 py-2", className)}>
      <div className="flex w-[7.5rem] shrink-0 items-center gap-2 text-[13px] text-text-muted">
        {Icon && <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex min-w-0 flex-1 items-center justify-end gap-1 text-right text-[13px] text-text">
        {children}
      </div>
    </div>
  );
}

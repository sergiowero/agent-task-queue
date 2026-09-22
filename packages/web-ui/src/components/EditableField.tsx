import { useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Textarea } from "./Textarea";

interface EditableFieldProps {
  label: string;
  value: string;
  placeholder?: string;
  rows?: number;
  display: ReactNode;
  onSubmit: (value: string) => unknown;
  editable?: boolean;
}

export function EditableField({
  label,
  value,
  placeholder = "",
  rows = 6,
  display,
  onSubmit,
  editable = true,
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
    setSaving(true);
    setError(null);
    try {
      await onSubmit(draft);
      setEditing(false);
    } catch (e: any) {
      setError(e?.message ?? "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-text-muted uppercase tracking-wider">{label}</h3>
        {editable && !editing && (
          <button
            onClick={startEdit}
            className="p-1 rounded text-text-muted hover:text-text hover:bg-surface-secondary transition-colors"
            title={`Edit ${label.toLowerCase()}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2">
          <Textarea
            autoFocus
            value={draft}
            rows={rows}
            placeholder={placeholder}
            disabled={saving}
            onChange={(e) => setDraft(e.target.value)}
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={cancel} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-2">{display}</div>
      )}
    </div>
  );
}
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { Meta, Task } from "../lib/api";
import { formatDateTime, formatRelative } from "../lib/format";
import { Alert } from "./Alert";
import { Badge } from "./Badge";

type PrSync = NonNullable<Meta["prSync"]>;

const Code = ({ children }: { children: ReactNode }) => <code className="font-mono">{children}</code>;

/** What the server reports about following pull requests on GitHub (`/api/meta`); undefined until it answers. */
export function usePrSync(): Meta["prSync"] {
  const { data } = useQuery({ queryKey: ["meta"], queryFn: api.getMeta, staleTime: 30_000, refetchInterval: 60_000 });
  return data?.prSync;
}

/** Why the sync follows no pull request and how to turn it on, or null while it runs. */
function prSyncOff(prSync: PrSync): { why: ReactNode; fix: ReactNode } | null {
  if (!prSync.available) {
    return {
      why: (
        <>
          The <Code>gh</Code> command is not installed on the server
        </>
      ),
      fix: (
        <>
          Install <Code>gh</Code> and run <Code>gh auth login</Code>
        </>
      ),
    };
  }
  // A server from before the flag says nothing: only an explicit false is "off".
  if (prSync.enabled === false) {
    return {
      why: (
        <>
          The server runs with <Code>AGENTQ_PR_SYNC=0</Code>
        </>
      ),
      fix: "Restart the server without that setting",
    };
  }
  return null;
}

/** The sync's last error about this task's pull request (gh not logged in, PR not found...), if any. */
function prSyncError(prSync: Meta["prSync"], taskId: string): string | null {
  return prSync?.errors.find((e) => e.taskId === taskId)?.error ?? null;
}

/**
 * On a task waiting for its pull request to merge: says so when the server cannot
 * complete it by itself (no `gh`, the sync turned off, or `gh` failing on this
 * pull request), and always when it last looked. The way out is the same in every
 * case: click Mark merged once the pull request is merged on GitHub.
 */
export function PrSyncNotice({ task }: { task: Task }) {
  const prSync = usePrSync();
  if (!prSync) return null;
  const off = prSyncOff(prSync);
  if (off) {
    return (
      <Alert tone="warning" title="The PR sync is off" className="mt-4">
        {off.why}, so a merged pull request will not complete this task by itself. {off.fix}, or click{" "}
        <strong>Mark merged</strong> once the pull request is merged on GitHub.
      </Alert>
    );
  }
  const error = prSyncError(prSync, task.id);
  const checked = task.pullRequest?.checkedAt;
  return (
    <div className="mt-4 space-y-2">
      {error && (
        <Alert tone="warning" title="The PR sync reported a problem with this pull request">
          <span className="font-mono text-xs">{error}</span>
          <br />
          If <Code>gh</Code> is not logged in, run <Code>gh auth login</Code>. Until the sync can read the pull
          request, click <strong>Mark merged</strong> once it is merged on GitHub.
        </Alert>
      )}
      <p className="text-xs text-text-muted" title={formatDateTime(checked)}>
        {checked ? `Last checked on GitHub ${formatRelative(checked)}.` : "Not checked on GitHub yet."}
      </p>
    </div>
  );
}

/** Above the pull requests waiting for a person: with the sync off, none of them completes by itself. */
export function PrSyncGroupNotice() {
  const prSync = usePrSync();
  const off = prSync ? prSyncOff(prSync) : null;
  if (!off) return null;
  return (
    <Alert tone="warning" title="The PR sync is off" className="mb-2">
      {off.why}, so none of these pull requests completes its task by itself. {off.fix}, or open each task and click{" "}
      <strong>Mark merged</strong> once its pull request is merged on GitHub.
    </Alert>
  );
}

/** Marks a pull request the sync failed on (with the sync off, the list says so once, above the tasks). */
export function PrSyncBadge({ task }: { task: Task }) {
  const prSync = usePrSync();
  const error = task.status === "pr_open" ? prSyncError(prSync, task.id) : null;
  return error ? (
    <Badge tone="warning" title={error}>
      sync error
    </Badge>
  ) : null;
}

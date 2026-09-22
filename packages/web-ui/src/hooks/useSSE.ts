import { useEffect, useRef } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { Runner, RunnerJobEvent, RunnerState, Task } from "../lib/api";

type SSEEvent = { event: string; data: any };

/** Events forwarded verbatim to `onMessage` after updating the query cache. */
const RUNNER_EVENTS = ["runner_updated", "runner_job", "runner_deleted"] as const;

const SSE_URL = "/api/events";

export function useSSE(
  onMessage: (event: SSEEvent) => void,
  queryClient?: QueryClient,
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;

    function connect() {
      es = new EventSource(SSE_URL);

      es.addEventListener("task_created", (e) => {
        const data = JSON.parse(e.data);
        if (queryClient) {
          queryClient.setQueryData<Task[]>(["tasks"], (old) =>
            old ? [...old, data] : [data],
          );
        }
        onMessageRef.current({ event: "task_created", data });
        retryDelay = 1000;
      });

      es.addEventListener("task_updated", (e) => {
        const data = JSON.parse(e.data);
        if (queryClient) {
          queryClient.setQueryData<Task[]>(["tasks"], (old) =>
            old
              ? old.map((t) => (t.id === data.id ? { ...t, ...data } : t))
              : undefined,
          );
          queryClient.setQueryData<Task>(["task", data.id], (old) =>
            old ? { ...old, ...data } : undefined,
          );
        }
        onMessageRef.current({ event: "task_updated", data });
        retryDelay = 1000;
      });

      for (const name of RUNNER_EVENTS) {
        es.addEventListener(name, (e) => {
          const data = JSON.parse((e as MessageEvent).data);
          if (queryClient) {
            if (name === "runner_updated") {
              const state = data as RunnerState;
              queryClient.setQueryData<Runner[]>(["runners"], (old) =>
                old ? old.map((r) => (r.id === state.id ? { ...r, state } : r)) : undefined,
              );
            } else if (name === "runner_deleted") {
              queryClient.setQueryData<Runner[]>(["runners"], (old) =>
                old ? old.filter((r) => r.id !== data.id) : undefined,
              );
            } else if (name === "runner_job") {
              const ev = data as RunnerJobEvent;
              if (ev.type !== "output") {
                queryClient.invalidateQueries({ queryKey: ["runner-jobs", ev.runnerId] });
              }
            }
          }
          onMessageRef.current({ event: name, data });
          retryDelay = 1000;
        });
      }

      es.onerror = () => {
        es?.close();
        retryTimeout = setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
      };
    }

    connect();

    return () => {
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, [queryClient]);
}

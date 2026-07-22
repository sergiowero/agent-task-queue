import { useEffect, useRef } from "react";

type SSEEvent = { event: string; data: any };

const SSE_URL = "/api/events";

export function useSSE(onMessage: (event: SSEEvent) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;

    function connect() {
      es = new EventSource(SSE_URL);

      es.addEventListener("task_created", (e) => {
        onMessageRef.current({ event: "task_created", data: JSON.parse(e.data) });
        retryDelay = 1000;
      });
      es.addEventListener("task_updated", (e) => {
        onMessageRef.current({ event: "task_updated", data: JSON.parse(e.data) });
        retryDelay = 1000;
      });

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
  }, []);
}

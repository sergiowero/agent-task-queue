import { useEffect, useRef } from "react";

type SSEEvent = { event: string; data: any };

export function useSSE(onMessage: (event: SSEEvent) => void) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    function connect() {
      es = new EventSource("/api/events");

      es.addEventListener("task_created", (e) => {
        onMessageRef.current({ event: "task_created", data: JSON.parse(e.data) });
      });
      es.addEventListener("task_updated", (e) => {
        onMessageRef.current({ event: "task_updated", data: JSON.parse(e.data) });
      });

      es.onerror = () => {
        es?.close();
        retryTimeout = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      es?.close();
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);
}

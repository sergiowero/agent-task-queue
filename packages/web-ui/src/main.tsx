import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "react-hot-toast";
import { ThemeProvider } from "./contexts/ThemeContext";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <App />
          <Toaster
            position="bottom-right"
            gutter={10}
            toastOptions={{
              duration: 3000,
              style: {
                borderRadius: "12px",
                fontSize: "13.5px",
                fontWeight: 500,
                padding: "10px 14px",
                background: "rgb(var(--surface-elevated))",
                color: "rgb(var(--text))",
                border: "1px solid rgb(var(--border))",
                boxShadow: "var(--shadow-lg)",
              },
              success: {
                iconTheme: { primary: "rgb(var(--success))", secondary: "rgb(var(--surface))" },
              },
              error: {
                iconTheme: { primary: "rgb(var(--danger))", secondary: "rgb(var(--surface))" },
              },
            }}
          />
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

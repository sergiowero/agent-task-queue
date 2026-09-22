import { lazy, Suspense, type ReactNode } from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoadingSkeleton } from "./components/LoadingSkeleton";

// Pages are code-split so the initial bundle only carries the shell.
const BoardPage = lazy(() => import("./pages/BoardPage").then((m) => ({ default: m.BoardPage })));
const TaskDetailPage = lazy(() =>
  import("./pages/TaskDetailPage").then((m) => ({ default: m.TaskDetailPage })),
);
const AgentsPage = lazy(() =>
  import("./pages/AgentsPage").then((m) => ({ default: m.AgentsPage })),
);
const RunnersPage = lazy(() =>
  import("./pages/RunnersPage").then((m) => ({ default: m.RunnersPage })),
);
const ActivityPage = lazy(() =>
  import("./pages/ActivityPage").then((m) => ({ default: m.ActivityPage })),
);
const ProjectsPage = lazy(() =>
  import("./pages/ProjectsPage").then((m) => ({ default: m.ProjectsPage })),
);
const ToolsPage = lazy(() => import("./pages/ToolsPage").then((m) => ({ default: m.ToolsPage })));
const InstallToolPage = lazy(() =>
  import("./pages/InstallToolPage").then((m) => ({ default: m.InstallToolPage })),
);

function Page({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingSkeleton />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/board" replace />} />
        <Route
          path="/board"
          element={
            <Page>
              <BoardPage />
            </Page>
          }
        />
        <Route
          path="/agents"
          element={
            <Page>
              <AgentsPage />
            </Page>
          }
        />
        <Route
          path="/runners"
          element={
            <Page>
              <RunnersPage />
            </Page>
          }
        />
        <Route
          path="/activity"
          element={
            <Page>
              <ActivityPage />
            </Page>
          }
        />
        <Route
          path="/projects"
          element={
            <Page>
              <ProjectsPage />
            </Page>
          }
        />
        <Route
          path="/tools"
          element={
            <Page>
              <ToolsPage />
            </Page>
          }
        />
        <Route
          path="/tools/install"
          element={
            <Page>
              <InstallToolPage />
            </Page>
          }
        />
        <Route
          path="/tasks/:id/details"
          element={
            <Page>
              <TaskDetailPage />
            </Page>
          }
        />
        <Route
          path="/tasks/:id"
          element={
            <Suspense fallback={<LoadingSkeleton />}>
              <BoardPage />
            </Suspense>
          }
        />
      </Route>
    </Routes>
  );
}

import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { BoardPage } from "./pages/BoardPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";
import { AgentsPage } from "./pages/AgentsPage";
import { ActivityPage } from "./pages/ActivityPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ToolsPage } from "./pages/ToolsPage";
import { InstallToolPage } from "./pages/InstallToolPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/board" replace />} />
        <Route
          path="/board"
          element={
            <ErrorBoundary>
              <BoardPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/agents"
          element={
            <ErrorBoundary>
              <AgentsPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/activity"
          element={
            <ErrorBoundary>
              <ActivityPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/projects"
          element={
            <ErrorBoundary>
              <ProjectsPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/tools"
          element={
            <ErrorBoundary>
              <ToolsPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/tools/install"
          element={
            <ErrorBoundary>
              <InstallToolPage />
            </ErrorBoundary>
          }
        />
        <Route
          path="/tasks/:id/details"
          element={
            <ErrorBoundary>
              <TaskDetailPage />
            </ErrorBoundary>
          }
        />
        <Route path="/tasks/:id" element={<BoardPage />} />
      </Route>
    </Routes>
  );
}

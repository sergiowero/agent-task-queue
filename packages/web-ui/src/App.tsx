import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
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
        <Route path="/board" element={<BoardPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/tools" element={<ToolsPage />} />
        <Route path="/tools/install" element={<InstallToolPage />} />
        <Route path="/tasks/:id/details" element={<TaskDetailPage />} />
        <Route path="/tasks/:id" element={<BoardPage />} />
      </Route>
    </Routes>
  );
}

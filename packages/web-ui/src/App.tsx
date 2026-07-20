import { Routes, Route, Navigate } from "react-router-dom";
import { Layout } from "./components/Layout";
import { BoardPage } from "./pages/BoardPage";
import { AgentsPage } from "./pages/AgentsPage";
import { ActivityPage } from "./pages/ActivityPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/board" replace />} />
        <Route path="/board" element={<BoardPage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/tasks/:id" element={<BoardPage />} />
      </Route>
    </Routes>
  );
}

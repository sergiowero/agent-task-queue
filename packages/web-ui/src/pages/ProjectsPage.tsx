import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { EditProjectModal } from "../components/EditProjectModal";
import { Button } from "../components/Button";

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const dirInputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: () => api.createProject({ name, displayName, workingDirectory }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
  });

  const handleDirSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const relativePath = files[0].webkitRelativePath;
      if (relativePath) {
        setWorkingDirectory(relativePath.split("/")[0]);
      }
    }
    e.target.value = "";
  };

  const canCreate = name && displayName && workingDirectory && !mutation.isPending;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-surface rounded-xl shadow-lg w-full max-w-lg p-6 transition-colors duration-300">
        <h2 className="text-lg font-semibold mb-4 text-text">New Project</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-text mb-1">Name *</label>
            <input
              className="w-full border border-border bg-surface-secondary text-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Display Name *</label>
            <input
              className="w-full border border-border bg-surface-secondary text-text rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text mb-1">Working Directory *</label>
            <div className="flex gap-2">
              <input
                className="flex-1 border border-border bg-surface-secondary text-text rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                placeholder="Working Directory"
                value={workingDirectory}
                onChange={(e) => setWorkingDirectory(e.target.value)}
              />
              <button
                onClick={() => dirInputRef.current?.click()}
                className="border border-border bg-surface-secondary text-text px-3 py-2 rounded-lg text-sm hover:bg-primary hover:text-white transition-colors"
              >
                Browse...
              </button>
              <input
                ref={dirInputRef}
                type="file"
                // @ts-ignore
                webkitdirectory=""
                className="hidden"
                onChange={handleDirSelect}
              />
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={onClose} variant="secondary">Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canCreate} variant="primary">
            {mutation.isPending ? "Creating..." : "Create"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({ project, onClose }: { project: any; onClose: () => void }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => api.deleteProject(project.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in">
      <div className="bg-surface rounded-xl shadow-lg w-full max-w-sm p-6 transition-colors duration-300">
        <h2 className="text-lg font-semibold mb-2 text-text">Delete Project</h2>
        <p className="text-sm text-text-secondary mb-4">
          Are you sure you want to delete <span className="font-medium text-text">{project.displayName}</span>? Tasks in this project will become orphaned.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={onClose} variant="secondary">Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} variant="danger">
            {mutation.isPending ? "Deleting..." : "Delete"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingProject, setEditingProject] = useState<any>(null);
  const [deletingProject, setDeletingProject] = useState<any>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: api.getProjects,
  });

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-14 border-b border-border bg-surface flex items-center px-4 gap-4 shrink-0 text-text">
        <h2 className="font-semibold text-text">Projects</h2>
        <div className="flex-1" />
        <button
          onClick={() => setShowCreateModal(true)}
          className="bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm hover:bg-blue-500 transition-colors"
        >
          New Project
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        {isLoading && <p className="text-text-muted text-sm">Loading...</p>}
        {!isLoading && projects.length === 0 && (
          <p className="text-text-muted text-sm">No projects yet. Create one to get started.</p>
        )}
        <div className="space-y-2">
          {projects.map((project: any) => (
            <div
              key={project.id}
              className="flex items-center gap-4 p-4 rounded-xl border border-border bg-surface hover:bg-surface-secondary hover:border-primary/30 transition-all duration-150 cursor-pointer group"
              onClick={() => navigate(`/board?projectId=${project.id}`)}
            >
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M2 7.5V16a2 2 0 002 2h16a2 2 0 002-2V7.5M2 7.5l10-5 10 5M2 7.5l10 5 10-5M2 7.5v9l10 5 10-5v-9" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-text truncate">{project.displayName}</div>
                <div className="text-xs text-text-muted font-mono truncate">{project.workingDirectory}</div>
              </div>
              <div className="text-xs text-text-muted shrink-0">
                {new Date(project.createdAt).toLocaleDateString()}
              </div>
              <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingProject(project);
                  }}
                  className="p-1.5 rounded-lg text-text-muted hover:text-text hover:bg-surface-secondary transition-colors"
                  title="Edit"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
                  </svg>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeletingProject(project);
                  }}
                  className="p-1.5 rounded-lg text-text-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  title="Delete"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {showCreateModal && <CreateProjectModal onClose={() => setShowCreateModal(false)} />}
      {editingProject && <EditProjectModal project={editingProject} onClose={() => setEditingProject(null)} />}
      {deletingProject && <DeleteConfirmModal project={deletingProject} onClose={() => setDeletingProject(null)} />}
    </div>
  );
}

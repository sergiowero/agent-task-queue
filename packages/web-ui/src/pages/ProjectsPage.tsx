import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import type { Project } from "../lib/api";
import { api } from "../lib/api";
import {
  AddIcon,
  BrowseIcon,
  CalendarIcon,
  ChevronRightIcon,
  DeleteIcon,
  EditIcon,
  FolderIcon,
  HashIcon,
  ProjectsIcon,
  RefreshIcon,
} from "../lib/icons";
import { formatDate, formatDateTime } from "../lib/format";
import { Button } from "../components/Button";
import { CopyButton } from "../components/CopyButton";
import { DeleteProjectDialog, EditProjectModal } from "../components/EditProjectModal";
import { EmptyState } from "../components/EmptyState";
import { Field } from "../components/Field";
import { IconButton } from "../components/IconButton";
import { Input } from "../components/Input";
import { Modal, useModal } from "../components/Modal";
import { CountPill, PageBody, PageHeader } from "../components/PageHeader";
import { Skeleton } from "../components/Skeleton";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The API requires project ids to be UUIDs. */
function newProjectId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // randomUUID only exists in secure contexts (e.g. not over plain http on a LAN IP).
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const sanitizeId = (value: string) => value.toLowerCase().replace(/[^0-9a-f-]/g, "");

/** Path input with a Browse button. Takes the `id` a surrounding Field hands out. */
function DirectoryInput({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const dirInputRef = useRef<HTMLInputElement>(null);

  const handleDirSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const relativePath = files[0].webkitRelativePath;
      if (relativePath) {
        onChange(relativePath.split("/")[0]);
      }
    }
    e.target.value = "";
  };

  return (
    <div className="flex gap-2">
      <Input
        id={id}
        placeholder="/path/to/repo"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono"
        spellCheck={false}
        wrapperClassName="flex-1"
      />
      <Button variant="secondary" icon={BrowseIcon} onClick={() => dirInputRef.current?.click()}>
        Browse
      </Button>
      <input
        ref={dirInputRef}
        type="file"
        // `webkitdirectory` is not in React's input typings.
        {...({ webkitdirectory: "" } as object)}
        className="hidden"
        tabIndex={-1}
        aria-hidden
        onChange={handleDirSelect}
      />
    </div>
  );
}

function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const modal = useModal(onClose);
  const [id, setId] = useState(newProjectId);
  const [displayName, setDisplayName] = useState("");
  const [workingDirectory, setWorkingDirectory] = useState("");

  const mutation = useMutation({
    mutationFn: () => api.createProject({ id, displayName, workingDirectory }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project created");
      modal.close();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const idValid = UUID_RE.test(id);
  const canCreate = idValid && !!displayName && !!workingDirectory && !mutation.isPending;

  return (
    <Modal
      {...modal.props}
      dismissible={!mutation.isPending}
      icon={AddIcon}
      title="New project"
      description="A project maps tasks to a working directory on disk."
      onSubmit={() => canCreate && mutation.mutate()}
      footer={
        <>
          <Button variant="secondary" onClick={modal.close}>
            Cancel
          </Button>
          <Button type="submit" icon={AddIcon} loading={mutation.isPending} disabled={!canCreate}>
            Create project
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field
          label="ID"
          icon={HashIcon}
          required
          hint={idValid || !id ? "A UUID, generated for you." : undefined}
        >
          <Input
            value={id}
            onChange={(e) => setId(sanitizeId(e.target.value))}
            error={id && !idValid ? "Must be a UUID (8-4-4-4-12 hex digits)." : undefined}
            className="font-mono"
            spellCheck={false}
            trailing={
              <IconButton
                icon={RefreshIcon}
                label="Generate new ID"
                size="xs"
                onClick={() => setId(newProjectId())}
              />
            }
          />
        </Field>
        <Field label="Display name" required>
          <Input
            placeholder="My project"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            autoFocus
          />
        </Field>
        <Field label="Working directory" icon={FolderIcon} required>
          <DirectoryInput value={workingDirectory} onChange={setWorkingDirectory} />
        </Field>
      </div>
    </Modal>
  );
}

function ProjectCard({
  project,
  index,
  onOpen,
  onEdit,
  onDelete,
}: {
  project: Project;
  index: number;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const initial = project.displayName.trim().charAt(0).toUpperCase();

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`Open ${project.displayName} board`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.target === e.currentTarget) onOpen();
      }}
      className="card-interactive group stagger flex flex-col p-4"
      style={{ "--i": index } as CSSProperties}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/15 to-accent/10 text-base font-semibold text-primary ring-1 ring-inset ring-primary/15 transition-transform duration-300 ease-spring group-hover:scale-105">
          {initial || <FolderIcon aria-hidden className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <h3 className="truncate text-sm font-semibold text-text">{project.displayName}</h3>
          <div className="mt-0.5 flex min-w-0 items-center gap-1 text-text-muted">
            <FolderIcon aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate font-mono text-xs" title={project.workingDirectory}>
              {project.workingDirectory}
            </span>
            <CopyButton value={project.workingDirectory} label="Copy path" size="xs" />
          </div>
        </div>
        <div
          className="-mr-1 -mt-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100"
          onClick={(e) => e.stopPropagation()}
        >
          <IconButton icon={EditIcon} label="Edit project" onClick={onEdit} />
          <IconButton
            icon={DeleteIcon}
            label="Delete project"
            variant="danger"
            onClick={onDelete}
          />
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-border-light pt-3 text-xs text-text-muted">
        <span className="flex items-center gap-1.5" title={formatDateTime(project.createdAt)}>
          <CalendarIcon aria-hidden className="h-3.5 w-3.5" />
          Created {formatDate(project.createdAt)}
        </span>
        <span className="flex items-center gap-0.5 font-medium transition-colors duration-150 group-hover:text-primary">
          Open board
          <ChevronRightIcon
            aria-hidden
            className="h-3.5 w-3.5 transition-transform duration-200 ease-out-expo group-hover:translate-x-0.5"
          />
        </span>
      </div>
    </div>
  );
}

function ProjectCardSkeleton() {
  return (
    <div className="card flex flex-col p-4">
      <div className="flex items-start gap-3">
        <Skeleton className="h-11 w-11 rounded-xl" />
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-48" />
        </div>
      </div>
      <div className="mt-4 flex justify-between border-t border-border-light pt-3">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-16" />
      </div>
    </div>
  );
}

export function ProjectsPage() {
  const navigate = useNavigate();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [deletingProject, setDeletingProject] = useState<Project | null>(null);

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: api.getProjects,
  });

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        icon={ProjectsIcon}
        title="Projects"
        description="Each project points tasks at a working directory."
        meta={!isLoading && <CountPill>{projects.length}</CountPill>}
        actions={
          <Button icon={AddIcon} onClick={() => setShowCreateModal(true)}>
            New project
          </Button>
        }
      />

      <PageBody>
        {isLoading && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <ProjectCardSkeleton key={i} />
            ))}
          </div>
        )}
        {!isLoading && projects.length === 0 && (
          <EmptyState
            icon={ProjectsIcon}
            title="No projects yet"
            description="Create a project to group tasks and tell agents where the code lives."
            action={
              <Button icon={AddIcon} onClick={() => setShowCreateModal(true)}>
                New project
              </Button>
            }
          />
        )}
        {projects.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project, i) => (
              <ProjectCard
                key={project.id}
                project={project}
                index={i}
                onOpen={() => navigate(`/board?projectId=${project.id}`)}
                onEdit={() => setEditingProject(project)}
                onDelete={() => setDeletingProject(project)}
              />
            ))}
          </div>
        )}
      </PageBody>

      {showCreateModal && <CreateProjectModal onClose={() => setShowCreateModal(false)} />}
      {editingProject && (
        <EditProjectModal project={editingProject} onClose={() => setEditingProject(null)} />
      )}
      {deletingProject && (
        <DeleteProjectDialog project={deletingProject} onClose={() => setDeletingProject(null)} />
      )}
    </div>
  );
}

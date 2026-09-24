import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import toast from "react-hot-toast";
import { api } from "../lib/api";
import {
  AddIcon,
  BranchIcon,
  ChevronDownIcon,
  CriteriaIcon,
  DescriptionIcon,
  GuardrailIcon,
  MergeIcon,
  PlanIcon,
  PriorityIcon,
  ProjectsIcon,
  SteerIcon,
} from "../lib/icons";
import { cn } from "../lib/cn";
import { Badge } from "./Badge";
import { Button } from "./Button";
import { Field } from "./Field";
import { Input } from "./Input";
import { Modal, useModal } from "./Modal";
import { Select } from "./Select";
import { Textarea } from "./Textarea";
import { Toggle } from "./Toggle";

interface CreateTaskModalProps {
  projectId?: string;
  onClose: () => void;
}

export function CreateTaskModal({ projectId, onClose }: CreateTaskModalProps) {
  const queryClient = useQueryClient();
  const modal = useModal(onClose);
  const moreId = useId();
  const [selectedProjectId, setSelectedProjectId] = useState(projectId ?? "");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState(0);
  const [branch, setBranch] = useState("");
  const [mergeBranch, setMergeBranch] = useState("");
  const [requiresPlan, setRequiresPlan] = useState(false);
  const [steerDetails, setSteerDetails] = useState("");
  const [guardrails, setGuardrails] = useState("");
  const [criteria, setCriteria] = useState("");
  const [showMore, setShowMore] = useState(false);

  const { data: projects = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: api.getProjects,
  });

  const mutation = useMutation({
    mutationFn: () =>
      api.createTask({
        title,
        description,
        steerDetails: steerDetails || undefined,
        guardrails: guardrails ? guardrails.split("\n").filter(Boolean) : undefined,
        priority,
        recommendedBranch: branch || undefined,
        mergeBranch: mergeBranch.trim() || undefined,
        requiresPlan,
        acceptanceCriteria: criteria ? criteria.split("\n").filter(Boolean) : undefined,
        projectId: selectedProjectId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.success("Task created");
      modal.close();
    },
    onError: (e: Error) => {
      toast.error(e.message);
    },
  });

  const projectBranch =
    projects.find((p) => p.id === selectedProjectId)?.defaultMergeBranch ?? "the project's default branch";
  const canCreate = Boolean(title.trim() && description.trim() && selectedProjectId);
  const extrasFilled = [steerDetails, guardrails, criteria].filter((v) => v.trim()).length;

  return (
    <Modal
      {...modal.props}
      size="lg"
      icon={AddIcon}
      title="New task"
      description="Describe the work; an agent picks it up from the queue."
      dismissible={!mutation.isPending}
      onSubmit={() => canCreate && !mutation.isPending && mutation.mutate()}
      footer={
        <>
          <Button variant="secondary" onClick={modal.close} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" icon={AddIcon} loading={mutation.isPending} disabled={!canCreate}>
            Create task
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Project" required icon={ProjectsIcon}>
          <Select value={selectedProjectId} onChange={(e) => setSelectedProjectId(e.target.value)}>
            <option value="">Select a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Title" required>
          <Input
            autoFocus
            placeholder="What needs to be done?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </Field>

        <Field label="Description" required icon={DescriptionIcon}>
          <Textarea
            placeholder="Context, goals and anything the agent should know"
            rows={4}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Priority" icon={PriorityIcon} hint="Higher runs first">
            <Input
              type="number"
              placeholder="0"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
            />
          </Field>
          <Field label="Branch" icon={BranchIcon}>
            <Input
              placeholder="feature/my-change"
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="font-mono"
            />
          </Field>
          <Field label="Merge branch" icon={MergeIcon} hint="Empty: the project's default branch.">
            <Input
              placeholder={projectBranch}
              value={mergeBranch}
              onChange={(e) => setMergeBranch(e.target.value)}
              className="font-mono"
            />
          </Field>
        </div>

        <div className="rounded-xl border border-border-light bg-surface-secondary/50 px-4 py-3">
          <Toggle
            checked={requiresPlan}
            onChange={setRequiresPlan}
            icon={PlanIcon}
            label="Requires planning"
            description="An agent writes a plan for your review before coding."
          />
        </div>

        <div>
          <button
            type="button"
            aria-expanded={showMore}
            aria-controls={moreId}
            onClick={() => setShowMore((v) => !v)}
            className={cn(
              "-mx-2 flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium",
              "text-text-secondary transition-colors duration-150 hover:bg-surface-secondary hover:text-text",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
            )}
          >
            <ChevronDownIcon
              aria-hidden
              className={cn(
                "h-4 w-4 text-text-muted transition-transform duration-300 ease-out-expo",
                showMore && "rotate-180",
              )}
            />
            More details
            {!showMore && extrasFilled > 0 && (
              <Badge tone="primary" className="animate-pop">
                {extrasFilled} filled
              </Badge>
            )}
            <span className="hidden text-xs font-normal text-text-muted sm:inline">
              Steer details, guardrails, acceptance criteria
            </span>
          </button>
          <div
            id={moreId}
            inert={!showMore}
            className={cn(
              "grid transition-[grid-template-rows] duration-300 ease-out-expo",
              showMore ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            {/* Side padding keeps the focus rings from being clipped. */}
            <div className="-mx-1 overflow-hidden px-1">
              <div
                className={cn(
                  "space-y-4 pb-1 pt-3 transition-opacity duration-300",
                  showMore ? "opacity-100" : "opacity-0",
                )}
              >
                <Field label="Steer details" icon={SteerIcon}>
                  <Textarea
                    placeholder="Implementation guidance, technical recommendations, preferred approaches"
                    rows={3}
                    value={steerDetails}
                    onChange={(e) => setSteerDetails(e.target.value)}
                  />
                </Field>
                <Field label="Guardrails" icon={GuardrailIcon} hint="One constraint per line.">
                  <Textarea
                    placeholder="Don't change the public API"
                    rows={3}
                    value={guardrails}
                    onChange={(e) => setGuardrails(e.target.value)}
                  />
                </Field>
                <Field
                  label="Acceptance criteria"
                  icon={CriteriaIcon}
                  hint="One criterion per line."
                >
                  <Textarea
                    placeholder="All existing tests pass"
                    rows={3}
                    value={criteria}
                    onChange={(e) => setCriteria(e.target.value)}
                  />
                </Field>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import {
  Task,
  TaskStatus,
  ConversationEntry,
  StatusHistoryEntry,
  Agent,
  Project,
  ActivityEvent,
} from "./types.js";

const DB_PATH = process.env.ATQ_DB_PATH || "atq.db";

let db: Database | null = null;

function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema();
  }
  return db;
}

function initSchema(): void {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      working_directory TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      tool_name TEXT NOT NULL,
      version TEXT NOT NULL,
      model TEXT NOT NULL,
      role TEXT NOT NULL,
      session_id TEXT NOT NULL,
      host TEXT,
      started_at TEXT,
      last_seen TEXT
    );
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      acceptance_criteria TEXT DEFAULT '[]',
      priority INTEGER DEFAULT 0,
      recommended_branch TEXT DEFAULT '',
      real_branch TEXT,
      requires_plan INTEGER DEFAULT 0,
      merge_branch TEXT DEFAULT 'develop',
      status TEXT NOT NULL DEFAULT 'new',
      assigned_agent_id TEXT,
      conversation TEXT DEFAULT '[]',
      history TEXT DEFAULT '[]',
      contexts TEXT DEFAULT '[]',
      project_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id)
    );
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      task_id TEXT NOT NULL,
      actor TEXT,
      details TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
  `);

  // Migrations for existing databases
  const columns = d.prepare("PRAGMA table_info(tasks)").all() as { name: string }[];
  const columnNames = columns.map((c) => c.name);

  if (!columnNames.includes("worktree_path")) {
    d.exec("ALTER TABLE tasks ADD COLUMN worktree_path TEXT");
  }
}

function rowToTask(row: any): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    acceptanceCriteria: JSON.parse(row.acceptance_criteria || "[]"),
    priority: row.priority,
    recommendedBranch: row.recommended_branch,
    realBranch: row.real_branch,
    requiresPlan: row.requires_plan === 1,
    mergeBranch: row.merge_branch,
    status: row.status as TaskStatus,
    assignedAgent: row.assigned_agent_id ? JSON.parse(row.assigned_agent_id) : null,
    conversation: JSON.parse(row.conversation || "[]"),
    history: JSON.parse(row.history || "[]"),
    contexts: JSON.parse(row.contexts || "[]"),
    projectId: row.project_id,
    worktreePath: row.worktree_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToAgent(row: any): Agent {
  return {
    id: row.id,
    toolName: row.tool_name,
    version: row.version,
    model: row.model,
    role: row.role,
    sessionId: row.session_id,
    host: row.host,
    startedAt: row.started_at,
    lastSeen: row.last_seen,
  };
}

function rowToProject(row: any): Project {
  return {
    id: row.id,
    name: row.name,
    displayName: row.display_name,
    workingDirectory: row.working_directory,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToActivity(row: any): ActivityEvent {
  return {
    id: row.id,
    eventType: row.event_type,
    taskId: row.task_id,
    actor: row.actor,
    details: row.details,
    createdAt: row.created_at,
  };
}

// ─── Tasks ────────────────────────────────────────────────────────────

export function createTask(data: {
  title: string;
  description?: string;
  acceptanceCriteria?: string[];
  priority?: number;
  recommendedBranch?: string;
  requiresPlan?: boolean;
  mergeBranch?: string;
  projectId?: string;
}): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: randomUUID(),
    title: data.title,
    description: data.description ?? null,
    acceptanceCriteria: data.acceptanceCriteria ?? [],
    priority: data.priority ?? 0,
    recommendedBranch: data.recommendedBranch ?? "",
    realBranch: null,
    requiresPlan: data.requiresPlan ?? false,
    mergeBranch: data.mergeBranch ?? "develop",
    status: data.requiresPlan ? TaskStatus.New : TaskStatus.Ready,
    assignedAgent: null,
    conversation: [],
    history: [],
    contexts: [],
    projectId: data.projectId ?? null,
    worktreePath: null,
    createdAt: now,
    updatedAt: now,
  };

  const stmt = getDb().prepare(
    `INSERT INTO tasks (id, title, description, acceptance_criteria, priority,
      recommended_branch, real_branch, requires_plan, merge_branch, status,
      assigned_agent_id, conversation, history, contexts, project_id, worktree_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(
    task.id, task.title, task.description,
    JSON.stringify(task.acceptanceCriteria), task.priority,
    task.recommendedBranch, task.realBranch,
    task.requiresPlan ? 1 : 0, task.mergeBranch, task.status,
    null, JSON.stringify(task.conversation), JSON.stringify(task.history),
    JSON.stringify(task.contexts), task.projectId, task.worktreePath, task.createdAt, task.updatedAt
  );

  return task;
}

export function getTasks(projectId?: string): Task[] {
  if (projectId) {
    const stmt = getDb().prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY priority DESC, created_at ASC");
    return stmt.all(projectId).map(rowToTask);
  }
  const stmt = getDb().prepare("SELECT * FROM tasks ORDER BY priority DESC, created_at ASC");
  return stmt.all().map(rowToTask);
}

export function getTaskById(id: string): Task | null {
  const stmt = getDb().prepare("SELECT * FROM tasks WHERE id = ?");
  const row = stmt.get(id);
  return row ? rowToTask(row) : null;
}

export function getNextClaimableTask(statuses: string[]): Task | null {
  if (statuses.length === 0) return null;
  const placeholders = statuses.map(() => "?").join(", ");
  const sql = `SELECT * FROM tasks WHERE status IN (${placeholders}) AND assigned_agent_id IS NULL ORDER BY priority DESC, created_at ASC LIMIT 1`;
  const row = getDb().prepare(sql).get(...statuses);
  return row ? rowToTask(row) : null;
}

export function updateTask(
  id: string,
  data: {
    title?: string;
    description?: string;
    status?: TaskStatus;
    acceptanceCriteria?: string[];
    priority?: number;
    recommendedBranch?: string;
    realBranch?: string;
    mergeBranch?: string;
    assignedAgent?: Task["assignedAgent"];
    conversation?: ConversationEntry[];
    history?: StatusHistoryEntry[];
    contexts?: string[];
    projectId?: string;
    worktreePath?: string | null;
  }
): Task | null {
  const existing = getTaskById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated = {
    title: data.title ?? existing.title,
    description: data.description !== undefined ? data.description : existing.description,
    acceptanceCriteria: data.acceptanceCriteria ?? existing.acceptanceCriteria,
    priority: data.priority ?? existing.priority,
    recommendedBranch: data.recommendedBranch ?? existing.recommendedBranch,
    realBranch: data.realBranch !== undefined ? data.realBranch : existing.realBranch,
    mergeBranch: data.mergeBranch ?? existing.mergeBranch,
    status: data.status ?? existing.status,
    assignedAgent: data.assignedAgent !== undefined ? data.assignedAgent : existing.assignedAgent,
    conversation: data.conversation ?? existing.conversation,
    history: data.history ?? existing.history,
    contexts: data.contexts ?? existing.contexts,
    projectId: data.projectId !== undefined ? data.projectId : existing.projectId,
    worktreePath: data.worktreePath !== undefined ? data.worktreePath : existing.worktreePath,
    updatedAt: now,
  };

  const stmt = getDb().prepare(
    `UPDATE tasks SET title = ?, description = ?, acceptance_criteria = ?, priority = ?,
      recommended_branch = ?, real_branch = ?, merge_branch = ?, status = ?,
      assigned_agent_id = ?, conversation = ?, history = ?, contexts = ?,
      project_id = ?, worktree_path = ?, updated_at = ? WHERE id = ?`
  );
  stmt.run(
    updated.title, updated.description, JSON.stringify(updated.acceptanceCriteria),
    updated.priority, updated.recommendedBranch, updated.realBranch,
    updated.mergeBranch, updated.status,
    updated.assignedAgent ? JSON.stringify(updated.assignedAgent) : null,
    JSON.stringify(updated.conversation), JSON.stringify(updated.history),
    JSON.stringify(updated.contexts), updated.projectId, updated.worktreePath, updated.updatedAt, id
  );

  return { ...existing, ...updated };
}

export function deleteTask(id: string): boolean {
  const stmt = getDb().prepare("DELETE FROM tasks WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

// ─── Agents ───────────────────────────────────────────────────────────

export function createAgent(data: {
  toolName: string;
  version: string;
  model: string;
  role: string;
  sessionId: string;
  host?: string;
}): Agent {
  const now = new Date().toISOString();
  const normalizedTool = data.toolName.toLowerCase().replace(/\s+/g, "-");
  const id = `${normalizedTool}@${data.version}|${data.model}`;

  const stmt = getDb().prepare(
    `INSERT OR REPLACE INTO agents (id, tool_name, version, model, role, session_id, host, started_at, last_seen)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(id, data.toolName, data.version, data.model, data.role, data.sessionId, data.host ?? null, now, now);

  return getAgentById(id)!;
}

export function getAgentById(id: string): Agent | null {
  const stmt = getDb().prepare("SELECT * FROM agents WHERE id = ?");
  const row = stmt.get(id);
  return row ? rowToAgent(row) : null;
}

export function getAgents(filters?: { role?: string; tool?: string }): Agent[] {
  let sql = "SELECT * FROM agents";
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.role) {
    conditions.push("role = ?");
    params.push(filters.role);
  }
  if (filters?.tool) {
    conditions.push("tool_name = ?");
    params.push(filters.tool);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  return getDb().prepare(sql).all(...params).map(rowToAgent);
}

export function updateAgentLastSeen(id: string): void {
  const now = new Date().toISOString();
  getDb().prepare("UPDATE agents SET last_seen = ? WHERE id = ?").run(now, id);
}

// ─── Projects ─────────────────────────────────────────────────────────

export function createProject(data: {
  name: string;
  displayName: string;
  workingDirectory: string;
}): Project {
  const now = new Date().toISOString();
  const id = randomUUID();
  const stmt = getDb().prepare(
    "INSERT INTO projects (id, name, display_name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  stmt.run(id, data.name, data.displayName, data.workingDirectory, now, now);

  return getProjectById(id)!;
}

export function getProjects(): Project[] {
  return getDb().prepare("SELECT * FROM projects").all().map(rowToProject);
}

export function getProjectById(id: string): Project | null {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return row ? rowToProject(row) : null;
}

export function getProjectByTaskId(taskId: string): Project | null {
  const row = getDb().prepare(
    "SELECT p.* FROM projects p JOIN tasks t ON t.project_id = p.id WHERE t.id = ?"
  ).get(taskId);
  return row ? rowToProject(row) : null;
}

export function deleteProject(id: string): boolean {
  const result = getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
  return result.changes > 0;
}

// ─── Activity ─────────────────────────────────────────────────────────

export function addActivityEvent(data: {
  eventType: string;
  taskId: string;
  actor?: string;
  details?: string;
}): ActivityEvent {
  const now = new Date().toISOString();
  const stmt = getDb().prepare(
    "INSERT INTO activity (event_type, task_id, actor, details, created_at) VALUES (?, ?, ?, ?, ?)"
  );
  const result = stmt.run(data.eventType, data.taskId, data.actor ?? null, data.details ?? null, now);

  return {
    id: Number(result.lastInsertRowid),
    eventType: data.eventType,
    taskId: data.taskId,
    actor: data.actor ?? null,
    details: data.details ?? null,
    createdAt: now,
  };
}

export function getActivityEvents(filters?: {
  taskId?: string;
  agentId?: string;
  from?: string;
  to?: string;
  limit?: number;
}): ActivityEvent[] {
  let sql = "SELECT * FROM activity";
  const conditions: string[] = [];
  const params: any[] = [];

  if (filters?.taskId) {
    conditions.push("task_id = ?");
    params.push(filters.taskId);
  }
  if (filters?.agentId) {
    conditions.push("actor = ?");
    params.push(filters.agentId);
  }
  if (filters?.from) {
    conditions.push("created_at >= ?");
    params.push(filters.from);
  }
  if (filters?.to) {
    conditions.push("created_at <= ?");
    params.push(filters.to);
  }

  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }

  sql += " ORDER BY created_at DESC";

  if (filters?.limit) {
    sql += " LIMIT ?";
    params.push(filters.limit);
  }

  return getDb().prepare(sql).all(...params).map(rowToActivity);
}

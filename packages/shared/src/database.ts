import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import { homedir } from "os";
import { join } from "path";
import type {
  Task,
  ConversationEntry,
  StatusHistoryEntry,
  Agent,
  Project,
  ActivityEvent} from "./types.js";
import {
  TaskStatus,
  normalizeStatus,
} from "./types.js";

function resolveDbPath(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  if (p === "~") {
    return homedir();
  }
  return p;
}

const DB_PATH = resolveDbPath(process.env.AGENTQ_DB_PATH || "~/agentq/agentq.db");

let db: Database | null = null;

function getDb(): Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
    initSchema();
    runMigrations();
  }
  return db;
}

function initSchema(): void {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
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
      status TEXT NOT NULL DEFAULT 'plan_requested',
      assigned_agent_id TEXT,
      conversation TEXT DEFAULT '[]',
      history TEXT DEFAULT '[]',
      contexts TEXT DEFAULT '[]',
      project_id TEXT,
      worktree_path TEXT,
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

  d.exec(`
    CREATE TABLE IF NOT EXISTS conversation_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      author_name TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      message TEXT NOT NULL,
      message_type TEXT DEFAULT 'user',
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS status_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      pre_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);
}

function isMigrationApplied(name: string): boolean {
  const row = getDb().prepare("SELECT id FROM _migrations WHERE name = ?").get(name);
  return !!row;
}

function markMigrationApplied(name: string): void {
  const now = new Date().toISOString();
  getDb().prepare("INSERT OR IGNORE INTO _migrations (name, applied_at) VALUES (?, ?)").run(name, now);
}

function runMigrations(): void {
  const d = getDb();

  // Migration 1: Add deleted_at columns
  if (!isMigrationApplied("001_add_deleted_at")) {
    try { d.exec("ALTER TABLE tasks ADD COLUMN deleted_at TEXT"); } catch {}
    try { d.exec("ALTER TABLE projects ADD COLUMN deleted_at TEXT"); } catch {}
    try { d.exec("ALTER TABLE agents ADD COLUMN deleted_at TEXT"); } catch {}
    markMigrationApplied("001_add_deleted_at");
  }

  // Migration 2: Add indexes
  if (!isMigrationApplied("002_add_indexes")) {
    d.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)");
    d.exec("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)");
    d.exec("CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at)");
    d.exec("CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at)");
    d.exec("CREATE INDEX IF NOT EXISTS idx_agents_deleted_at ON agents(deleted_at)");
    d.exec("CREATE INDEX IF NOT EXISTS idx_activity_task_id ON activity(task_id)");
    d.exec("CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity(created_at)");
    d.exec("CREATE INDEX IF NOT EXISTS idx_conv_task_id ON conversation_entries(task_id)");
    d.exec("CREATE INDEX IF NOT EXISTS idx_history_task_id ON status_history(task_id)");
    markMigrationApplied("002_add_indexes");
  }

  // Migration 3: Normalize TaskStatus.ReadyForCode
  if (!isMigrationApplied("003_normalize_ready_for_code")) {
    d.exec("UPDATE tasks SET status = 'ready_for_code' WHERE status = 'ready for code'");
    markMigrationApplied("003_normalize_ready_for_code");
  }

  // Migration 4: Extract conversation JSON into conversation_entries
  if (!isMigrationApplied("004_extract_conversation")) {
    const rows = d.prepare("SELECT id, conversation FROM tasks WHERE conversation IS NOT NULL AND conversation != '[]'").all() as { id: string; conversation: string }[];
    const insertStmt = d.prepare("INSERT INTO conversation_entries (task_id, author_name, timestamp, message, message_type) VALUES (?, ?, ?, ?, ?)");
    for (const row of rows) {
      try {
        const entries = JSON.parse(row.conversation) as ConversationEntry[];
        for (const entry of entries) {
          insertStmt.run(row.id, entry.authorName, entry.timestamp, entry.message, entry.messageType ?? "user");
        }
      } catch {}
    }
    markMigrationApplied("004_extract_conversation");
  }

  // Migration 5: Extract history JSON into status_history
  if (!isMigrationApplied("005_extract_history")) {
    const rows = d.prepare("SELECT id, history FROM tasks WHERE history IS NOT NULL AND history != '[]'").all() as { id: string; history: string }[];
    const insertStmt = d.prepare("INSERT INTO status_history (task_id, pre_status, new_status, timestamp) VALUES (?, ?, ?, ?)");
    for (const row of rows) {
      try {
        const entries = JSON.parse(row.history) as StatusHistoryEntry[];
        for (const entry of entries) {
          insertStmt.run(row.id, entry.pre_status, entry.new_status, entry.timestamp);
        }
      } catch {}
    }
    markMigrationApplied("005_extract_history");
  }
}

export function beginTransaction(): void {
  getDb().exec("BEGIN");
}

export function commitTransaction(): void {
  getDb().exec("COMMIT");
}

export function rollbackTransaction(): void {
  getDb().exec("ROLLBACK");
}

export function withTransaction<T>(fn: () => T): T {
  const d = getDb();
  d.exec("BEGIN");
  try {
    const result = fn();
    d.exec("COMMIT");
    return result;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}

export function getMigrationStatus(): { name: string; applied: boolean }[] {
  const migrationNames = [
    "001_add_deleted_at",
    "002_add_indexes",
    "003_normalize_ready_for_code",
    "004_extract_conversation",
    "005_extract_history",
  ];
  return migrationNames.map((name) => ({
    name,
    applied: isMigrationApplied(name),
  }));
}

export function rollbackMigration(name?: string): void {
  const d = getDb();

  if (!name || name === "005_extract_history") {
    d.exec("DELETE FROM status_history");
    d.exec("DELETE FROM _migrations WHERE name = '005_extract_history'");
    if (name === "005_extract_history") return;
  }

  if (!name || name === "004_extract_conversation") {
    d.exec("DELETE FROM conversation_entries");
    d.exec("DELETE FROM _migrations WHERE name = '004_extract_conversation'");
    if (name === "004_extract_conversation") return;
  }

  if (!name || name === "003_normalize_ready_for_code") {
    d.exec("UPDATE tasks SET status = 'ready for code' WHERE status = 'ready_for_code'");
    d.exec("DELETE FROM _migrations WHERE name = '003_normalize_ready_for_code'");
    if (name === "003_normalize_ready_for_code") return;
  }

  if (!name || name === "002_add_indexes") {
    for (const idx of ["idx_tasks_project_id", "idx_tasks_status", "idx_tasks_deleted_at", "idx_projects_deleted_at", "idx_agents_deleted_at", "idx_activity_task_id", "idx_activity_created_at", "idx_conv_task_id", "idx_history_task_id"]) {
      try { d.exec(`DROP INDEX IF EXISTS ${idx}`); } catch {}
    }
    d.exec("DELETE FROM _migrations WHERE name = '002_add_indexes'");
    if (name === "002_add_indexes") return;
  }

  if (!name || name === "001_add_deleted_at") {
    // SQLite doesn't support DROP COLUMN before 3.35.0; recreate is complex.
    // Best effort: nullify the columns.
    try { d.exec("UPDATE tasks SET deleted_at = NULL"); } catch {}
    try { d.exec("UPDATE projects SET deleted_at = NULL"); } catch {}
    try { d.exec("UPDATE agents SET deleted_at = NULL"); } catch {}
    d.exec("DELETE FROM _migrations WHERE name = '001_add_deleted_at'");
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
    status: normalizeStatus(row.status),
    assignedAgent: row.assigned_agent_id ? JSON.parse(row.assigned_agent_id) : null,
    conversation: JSON.parse(row.conversation || "[]"),
    history: JSON.parse(row.history || "[]"),
    contexts: JSON.parse(row.contexts || "[]"),
    projectId: row.project_id,
    worktreePath: row.worktree_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
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
    deletedAt: row.deleted_at ?? null,
  };
}

function rowToProject(row: any): Project {
  return {
    id: row.id,
    displayName: row.display_name,
    workingDirectory: row.working_directory,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
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
  description: string;
  acceptanceCriteria?: string[];
  priority?: number;
  recommendedBranch?: string;
  requiresPlan?: boolean;
  mergeBranch?: string;
  projectId: string;
}): Task {
  const now = new Date().toISOString();
  const task: Task = {
    id: randomUUID(),
    title: data.title,
    description: data.description,
    acceptanceCriteria: data.acceptanceCriteria ?? [],
    priority: data.priority ?? 0,
    recommendedBranch: data.recommendedBranch ?? "",
    realBranch: null,
    requiresPlan: data.requiresPlan ?? false,
    mergeBranch: data.mergeBranch ?? "develop",
    status: data.requiresPlan ? TaskStatus.PlanRequested : TaskStatus.ReadyForCode,
    assignedAgent: null,
    conversation: [],
    history: [],
    contexts: [],
    projectId: data.projectId,
    worktreePath: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  };

  const stmt = getDb().prepare(
    `INSERT INTO tasks (id, title, description, acceptance_criteria, priority,
      recommended_branch, real_branch, requires_plan, merge_branch, status,
      assigned_agent_id, conversation, history, contexts, project_id, worktree_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(
    task.id,
    task.title,
    task.description,
    JSON.stringify(task.acceptanceCriteria),
    task.priority,
    task.recommendedBranch,
    task.realBranch,
    task.requiresPlan ? 1 : 0,
    task.mergeBranch,
    task.status,
    null,
    JSON.stringify(task.conversation),
    JSON.stringify(task.history),
    JSON.stringify(task.contexts),
    task.projectId,
    task.worktreePath,
    task.createdAt,
    task.updatedAt,
  );

  return task;
}

export function getTaskById(id: string): Task | null {
  const stmt = getDb().prepare("SELECT * FROM tasks WHERE id = ?");
  const row = stmt.get(id);
  return row ? rowToTask(row) : null;
}

export function getNextClaimableTask(statuses: string[]): Task | null {
  if (statuses.length === 0) return null;
  const placeholders = statuses.map(() => "?").join(", ");
  const sql = `SELECT * FROM tasks WHERE status IN (${placeholders}) AND assigned_agent_id IS NULL AND deleted_at IS NULL ORDER BY priority DESC, created_at ASC LIMIT 1`;
  const row = getDb()
    .prepare(sql)
    .get(...statuses);
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
  },
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
      project_id = ?, worktree_path = ?, updated_at = ? WHERE id = ?`,
  );
  stmt.run(
    updated.title,
    updated.description,
    JSON.stringify(updated.acceptanceCriteria),
    updated.priority,
    updated.recommendedBranch,
    updated.realBranch,
    updated.mergeBranch,
    updated.status,
    updated.assignedAgent ? JSON.stringify(updated.assignedAgent) : null,
    JSON.stringify(updated.conversation),
    JSON.stringify(updated.history),
    JSON.stringify(updated.contexts),
    updated.projectId,
    updated.worktreePath,
    updated.updatedAt,
    id,
  );

  return { ...existing, ...updated };
}

export function deleteTask(id: string): boolean {
  const stmt = getDb().prepare("DELETE FROM tasks WHERE id = ?");
  const result = stmt.run(id);
  return result.changes > 0;
}

export function softDeleteTask(id: string): boolean {
  const now = new Date().toISOString();
  const stmt = getDb().prepare("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL");
  const result = stmt.run(now, now, id);
  return result.changes > 0;
}

export function getTasks(projectId?: string): Task[] {
  let sql = "SELECT * FROM tasks WHERE deleted_at IS NULL";
  const params: any[] = [];
  if (projectId) {
    sql += " AND project_id = ?";
    params.push(projectId);
  }
  sql += " ORDER BY priority DESC, created_at ASC";
  return getDb().prepare(sql).all(...params).map(rowToTask);
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
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(
    id,
    data.toolName,
    data.version,
    data.model,
    data.role,
    data.sessionId,
    data.host ?? null,
    now,
    now,
  );

  return getAgentById(id)!;
}

export function getAgentById(id: string): Agent | null {
  const stmt = getDb().prepare("SELECT * FROM agents WHERE id = ?");
  const row = stmt.get(id);
  return row ? rowToAgent(row) : null;
}

export function getAgents(filters?: { role?: string; tool?: string }): Agent[] {
  let sql = "SELECT * FROM agents WHERE deleted_at IS NULL";
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
    sql += " AND " + conditions.join(" AND ");
  }

  return getDb()
    .prepare(sql)
    .all(...params)
    .map(rowToAgent);
}

export function getAllAgents(filters?: { role?: string; tool?: string }): Agent[] {
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

  return getDb()
    .prepare(sql)
    .all(...params)
    .map(rowToAgent);
}

export function updateAgentLastSeen(id: string): void {
  const now = new Date().toISOString();
  getDb().prepare("UPDATE agents SET last_seen = ? WHERE id = ?").run(now, id);
}

// ─── Projects ─────────────────────────────────────────────────────────

export function createProject(data: {
  id: string;
  displayName: string;
  workingDirectory: string;
}): Project {
  const now = new Date().toISOString();
  const stmt = getDb().prepare(
    "INSERT INTO projects (id, display_name, working_directory, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  stmt.run(data.id, data.displayName, data.workingDirectory, now, now);

  return getProjectById(data.id)!;
}

export function getProjects(): Project[] {
  return getDb().prepare("SELECT * FROM projects WHERE deleted_at IS NULL").all().map(rowToProject);
}

export function getAllProjects(): Project[] {
  return getDb().prepare("SELECT * FROM projects").all().map(rowToProject);
}

export function getProjectById(id: string): Project | null {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return row ? rowToProject(row) : null;
}

export function getProjectByTaskId(taskId: string): Project | null {
  const row = getDb()
    .prepare("SELECT p.* FROM projects p JOIN tasks t ON t.project_id = p.id WHERE t.id = ?")
    .get(taskId);
  return row ? rowToProject(row) : null;
}

export function deleteProject(id: string): boolean {
  const result = getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
  return result.changes > 0;
}

export function softDeleteProject(id: string): boolean {
  const now = new Date().toISOString();
  const result = getDb().prepare("UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL").run(now, now, id);
  return result.changes > 0;
}

export function updateProject(
  id: string,
  data: {
    displayName?: string;
    workingDirectory?: string;
  },
): Project | null {
  const existing = getProjectById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated = {
    displayName: data.displayName ?? existing.displayName,
    workingDirectory: data.workingDirectory ?? existing.workingDirectory,
  };

  const stmt = getDb().prepare(
    "UPDATE projects SET display_name = ?, working_directory = ?, updated_at = ? WHERE id = ?",
  );
  stmt.run(updated.displayName, updated.workingDirectory, now, id);

  return getProjectById(id)!;
}

// ─── Conversation Entries (normalized) ──────────────────────────────

export function getConversationEntries(taskId: string): ConversationEntry[] {
  const rows = getDb()
    .prepare("SELECT author_name, timestamp, message, message_type FROM conversation_entries WHERE task_id = ? ORDER BY timestamp ASC")
    .all(taskId) as { author_name: string; timestamp: string; message: string; message_type: string }[];
  return rows.map((r) => ({
    authorName: r.author_name,
    timestamp: r.timestamp,
    message: r.message,
    messageType: r.message_type as ConversationEntry["messageType"],
  }));
}

export function addConversationEntry(data: {
  taskId: string;
  authorName: string;
  message: string;
  messageType?: string;
}): void {
  const now = new Date().toISOString();
  getDb()
    .prepare("INSERT INTO conversation_entries (task_id, author_name, timestamp, message, message_type) VALUES (?, ?, ?, ?, ?)")
    .run(data.taskId, data.authorName, now, data.message, data.messageType ?? "user");
}

// ─── Status History (normalized) ───────────────────────────────────

export function getStatusHistory(taskId: string): StatusHistoryEntry[] {
  const rows = getDb()
    .prepare("SELECT pre_status, new_status, timestamp FROM status_history WHERE task_id = ? ORDER BY timestamp ASC")
    .all(taskId) as { pre_status: string; new_status: string; timestamp: string }[];
  return rows.map((r) => ({
    pre_status: r.pre_status,
    new_status: r.new_status,
    timestamp: r.timestamp,
  }));
}

export function addStatusHistoryEntry(data: {
  taskId: string;
  preStatus: string;
  newStatus: string;
}): void {
  const now = new Date().toISOString();
  getDb()
    .prepare("INSERT INTO status_history (task_id, pre_status, new_status, timestamp) VALUES (?, ?, ?, ?)")
    .run(data.taskId, data.preStatus, data.newStatus, now);
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
    "INSERT INTO activity (event_type, task_id, actor, details, created_at) VALUES (?, ?, ?, ?, ?)",
  );
  const result = stmt.run(
    data.eventType,
    data.taskId,
    data.actor ?? null,
    data.details ?? null,
    now,
  );

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

  return getDb()
    .prepare(sql)
    .all(...params)
    .map(rowToActivity);
}

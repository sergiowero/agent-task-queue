import { Database } from "bun:sqlite";
import { randomUUID } from "crypto";
import { mkdirSync } from "fs";
import { homedir } from "os";
import { dirname, join } from "path";
import type { AutonomyLevel, Risk, TaskType } from "./catalog.js";
import { SEPARATION, TASK_TYPES } from "./catalog.js";
import type { PolicySettings } from "./policy.js";
import { criteriaFromStored, normalizeCriteria, type CriterionInput } from "./criteria.js";
import { resolveProfile, type ProjectProfile } from "./profile.js";
import type {
  Task,
  ConversationEntry,
  StatusHistoryEntry,
  Agent,
  AgentReference,
  Project,
  ActivityEvent,
  Runner,
  TaskReference} from "./types.js";
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

// Resolved lazily on first use so callers (e.g. tests) can set AGENTQ_DB_PATH
// after importing this module — ESM imports are hoisted above env assignments.
/** Absolute database path from AGENTQ_DB_PATH (default `~/.agentq/agentq.db`), `~` expanded. */
export function getDbPath(): string {
  return resolveDbPath(process.env.AGENTQ_DB_PATH || "~/.agentq/agentq.db");
}

let db: Database | null = null;

const OPEN_ATTEMPTS = 8;

/**
 * Opens the database in WAL mode. Several processes (the web server, MCP
 * servers started by runner jobs) may open the file at the same moment; on
 * Windows the loser of the race to rebuild the WAL index gets a transient
 * SQLITE_IOERR / SQLITE_BUSY that busy_timeout does not cover, so retry briefly.
 */
function openDatabase(path: string): Database {
  for (let attempt = 1; ; attempt++) {
    const conn = new Database(path);
    try {
      conn.exec("PRAGMA busy_timeout = 5000");
      // WAL is persistent: only switch when needed.
      const mode = conn.query("PRAGMA journal_mode").get() as { journal_mode: string } | null;
      if (mode?.journal_mode !== "wal") conn.exec("PRAGMA journal_mode = WAL");
      conn.exec("PRAGMA foreign_keys = ON");
      return conn;
    } catch (error) {
      try { conn.close(); } catch {}
      const code = String((error as { code?: unknown }).code ?? "");
      const transient = code.startsWith("SQLITE_IOERR") || code.startsWith("SQLITE_BUSY");
      if (!transient || attempt >= OPEN_ATTEMPTS) throw error;
      Bun.sleepSync(20 * attempt);
    }
  }
}

function getDb(): Database {
  if (!db) {
    const path = getDbPath();
    // SQLite creates the file but not its folder (~/.agentq on a fresh machine).
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    db = openDatabase(path);
    initSchema();
    runMigrations();
  }
  return db;
}

/** The open database, for modules that keep their own tables (records.ts). */
export function getDbHandle(): Database {
  return getDb();
}

/**
 * Closes the current connection so the next getDb() call reopens using the
 * current AGENTQ_DB_PATH. Intended for tests that need a file-backed database
 * (e.g. when subprocesses must see the same rows).
 */
export function resetDb(): void {
  if (db) {
    try { db.close(); } catch {}
    db = null;
  }
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
      steer_details TEXT,
      guardrails TEXT DEFAULT '[]',
      acceptance_criteria TEXT DEFAULT '[]',
      priority INTEGER DEFAULT 0,
      recommended_branch TEXT DEFAULT '',
      real_branch TEXT,
      requires_plan INTEGER DEFAULT 0,
      merge_branch TEXT DEFAULT 'main',
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

/** Adds a column, ignoring "duplicate column" (fresh databases already have some). */
function addColumn(d: Database, table: string, column: string): void {
  try { d.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`); } catch {}
}

/** Tables only the historical migrations 002–005 use (dropped by 020). */
function createLegacyTables(d: Database): void {
  d.exec(`CREATE TABLE IF NOT EXISTS conversation_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
    author_name TEXT NOT NULL, timestamp TEXT NOT NULL, message TEXT NOT NULL, message_type TEXT DEFAULT 'user',
    FOREIGN KEY (task_id) REFERENCES tasks(id))`);
  d.exec(`CREATE TABLE IF NOT EXISTS status_history (id INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
    pre_status TEXT NOT NULL, new_status TEXT NOT NULL, timestamp TEXT NOT NULL, FOREIGN KEY (task_id) REFERENCES tasks(id))`);
}

interface Migration {
  name: string;
  up: (d: Database) => void;
  /** Best-effort undo: SQLite cannot drop columns portably, so columns are reset, not dropped. */
  down: (d: Database) => void;
}

const MIGRATIONS: Migration[] = [
  {
    name: "001_add_deleted_at",
    up: (d) => {
      addColumn(d, "tasks", "deleted_at TEXT");
      addColumn(d, "projects", "deleted_at TEXT");
      addColumn(d, "agents", "deleted_at TEXT");
    },
    down: (d) => {
      try { d.exec("UPDATE tasks SET deleted_at = NULL"); } catch {}
      try { d.exec("UPDATE projects SET deleted_at = NULL"); } catch {}
      try { d.exec("UPDATE agents SET deleted_at = NULL"); } catch {}
    },
  },
  {
    name: "002_add_indexes",
    up: (d) => {
      createLegacyTables(d);
      d.exec("CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)");
      d.exec("CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)");
      d.exec("CREATE INDEX IF NOT EXISTS idx_tasks_deleted_at ON tasks(deleted_at)");
      d.exec("CREATE INDEX IF NOT EXISTS idx_projects_deleted_at ON projects(deleted_at)");
      d.exec("CREATE INDEX IF NOT EXISTS idx_agents_deleted_at ON agents(deleted_at)");
      d.exec("CREATE INDEX IF NOT EXISTS idx_activity_task_id ON activity(task_id)");
      d.exec("CREATE INDEX IF NOT EXISTS idx_activity_created_at ON activity(created_at)");
      d.exec("CREATE INDEX IF NOT EXISTS idx_conv_task_id ON conversation_entries(task_id)");
      d.exec("CREATE INDEX IF NOT EXISTS idx_history_task_id ON status_history(task_id)");
    },
    down: (d) => {
      for (const idx of ["idx_tasks_project_id", "idx_tasks_status", "idx_tasks_deleted_at", "idx_projects_deleted_at", "idx_agents_deleted_at", "idx_activity_task_id", "idx_activity_created_at", "idx_conv_task_id", "idx_history_task_id"]) {
        try { d.exec(`DROP INDEX IF EXISTS ${idx}`); } catch {}
      }
    },
  },
  {
    name: "003_normalize_ready_for_code",
    up: (d) => d.exec("UPDATE tasks SET status = 'ready_for_code' WHERE status = 'ready for code'"),
    down: (d) => d.exec("UPDATE tasks SET status = 'ready for code' WHERE status = 'ready_for_code'"),
  },
  {
    // Historical: copied conversations into conversation_entries (a table nothing reads any more).
    name: "004_extract_conversation",
    up: (d) => {
      createLegacyTables(d);
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
    },
    down: (d) => { try { d.exec("DELETE FROM conversation_entries"); } catch {} },
  },
  {
    // Historical: copied history into status_history (a table nothing reads any more).
    name: "005_extract_history",
    up: (d) => {
      createLegacyTables(d);
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
    },
    down: (d) => { try { d.exec("DELETE FROM status_history"); } catch {} },
  },
  {
    name: "006_add_steer_details_guardrails",
    up: (d) => {
      addColumn(d, "tasks", "steer_details TEXT");
      addColumn(d, "tasks", "guardrails TEXT DEFAULT '[]'");
    },
    down: (d) => {
      try { d.exec("UPDATE tasks SET steer_details = NULL"); } catch {}
      try { d.exec("UPDATE tasks SET guardrails = '[]'"); } catch {}
    },
  },
  {
    // Runners (headless agent launchers managed by the web server)
    name: "007_add_runners",
    up: (d) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS runners (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          tool TEXT NOT NULL,
          role TEXT NOT NULL,
          project_id TEXT,
          model TEXT,
          concurrency INTEGER NOT NULL DEFAULT 1,
          poll_interval_sec INTEGER NOT NULL DEFAULT 5,
          permission_mode TEXT NOT NULL DEFAULT 'safe',
          extra_args TEXT,
          enabled INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
    },
    down: (d) => d.exec("DROP TABLE IF EXISTS runners"),
  },
  {
    // Reasoning effort per runner (claude --effort, codex model_reasoning_effort, opencode --variant)
    name: "008_add_runner_effort",
    up: (d) => addColumn(d, "runners", "effort TEXT"),
    down: (d) => { try { d.exec("UPDATE runners SET effort = NULL"); } catch {} },
  },
  {
    // Task archive (record written to {project}/archive, task hidden from the board)
    name: "009_add_task_archive",
    up: (d) => {
      addColumn(d, "tasks", "archived_at TEXT");
      addColumn(d, "tasks", "archive_path TEXT");
      d.exec("CREATE INDEX IF NOT EXISTS idx_tasks_archived_at ON tasks(archived_at)");
    },
    down: (d) => {
      try { d.exec("UPDATE tasks SET archived_at = NULL, archive_path = NULL"); } catch {}
      try { d.exec("DROP INDEX IF EXISTS idx_tasks_archived_at"); } catch {}
    },
  },
  {
    // Branch new tasks merge into, per project (filled lazily from origin/HEAD).
    name: "010_project_default_merge_branch",
    up: (d) => addColumn(d, "projects", "default_merge_branch TEXT"),
    down: (d) => { try { d.exec("UPDATE projects SET default_merge_branch = NULL"); } catch {} },
  },
  {
    // Claim tokens (submits must come from the claim holder), blockers (needs_human)
    // and the count of consecutive runs that ended without a submit.
    name: "011_task_claim_and_blocker",
    up: (d) => {
      addColumn(d, "tasks", "claim_token TEXT");
      addColumn(d, "tasks", "blocker TEXT");
      addColumn(d, "tasks", "revert_streak INTEGER NOT NULL DEFAULT 0");
    },
    down: (d) => {
      try { d.exec("UPDATE tasks SET claim_token = NULL, blocker = NULL, revert_streak = 0"); } catch {}
    },
  },
  {
    // Autonomy levels, risk, task types, round counters and claim leases.
    name: "012_autonomy_and_policy",
    up: (d) => {
      addColumn(d, "projects", "autonomy INTEGER NOT NULL DEFAULT 2");
      addColumn(d, "projects", "policy TEXT DEFAULT '{}'");
      d.exec("UPDATE projects SET autonomy = 2");
      addColumn(d, "tasks", "autonomy INTEGER");
      addColumn(d, "tasks", "risk TEXT NOT NULL DEFAULT 'medium'");
      addColumn(d, "tasks", "type TEXT NOT NULL DEFAULT 'feature'");
      addColumn(d, "tasks", "plan_round INTEGER NOT NULL DEFAULT 0");
      addColumn(d, "tasks", "code_round INTEGER NOT NULL DEFAULT 0");
      addColumn(d, "tasks", "verify_failures INTEGER NOT NULL DEFAULT 0");
      addColumn(d, "tasks", "round_baseline TEXT DEFAULT '{}'");
      addColumn(d, "tasks", "producers TEXT DEFAULT '{}'");
      addColumn(d, "tasks", "lease_expires_at TEXT");
      addColumn(d, "tasks", "last_review TEXT");
      // Existing tasks: one round per AI review already in the conversation.
      const rows = d.prepare("SELECT id, conversation FROM tasks").all() as { id: string; conversation: string }[];
      const set = d.prepare("UPDATE tasks SET code_round = ? WHERE id = ?");
      for (const row of rows) {
        const reviews = parseJson<ConversationEntry[]>(row.conversation, []).filter((e) => e.messageType === "review").length;
        if (reviews) set.run(reviews, row.id);
      }
    },
    down: (d) => {
      try {
        d.exec(`UPDATE tasks SET autonomy = NULL, risk = 'medium', type = 'feature', plan_round = 0, code_round = 0,
          verify_failures = 0, round_baseline = '{}', producers = '{}', lease_expires_at = NULL, last_review = NULL`);
        d.exec("UPDATE projects SET autonomy = 2, policy = '{}'");
      } catch {}
    },
  },
  {
    // Review findings, tracked by id across rounds.
    name: "013_task_findings",
    up: (d) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS task_findings (
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          id TEXT NOT NULL,
          round INTEGER NOT NULL,
          phase TEXT NOT NULL,
          seq INTEGER NOT NULL,
          severity TEXT NOT NULL,
          file TEXT,
          line INTEGER,
          text TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'open',
          resolution TEXT,
          raised_by TEXT NOT NULL,
          reopen_count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (task_id, id)
        );
      `);
    },
    down: (d) => d.exec("DROP TABLE IF EXISTS task_findings"),
  },
  {
    // Commands, protected paths and shared guardrails per project.
    name: "014_project_profile",
    up: (d) => addColumn(d, "projects", "profile TEXT DEFAULT '{}'"),
    down: (d) => { try { d.exec("UPDATE projects SET profile = '{}'"); } catch {} },
  },
  {
    // Acceptance criteria become objects: { id, text, verify, status, evidenceIds }.
    name: "015_structured_criteria",
    up: (d) => {
      const rows = d.prepare("SELECT id, acceptance_criteria FROM tasks").all() as { id: string; acceptance_criteria: string }[];
      const set = d.prepare("UPDATE tasks SET acceptance_criteria = ? WHERE id = ?");
      for (const row of rows) {
        const raw = parseJson<unknown[]>(row.acceptance_criteria, []);
        if (raw.length && raw.every((c) => typeof c === "string")) {
          set.run(JSON.stringify(normalizeCriteria(raw as string[])), row.id);
        }
      }
    },
    down: (d) => {
      const rows = d.prepare("SELECT id, acceptance_criteria FROM tasks").all() as { id: string; acceptance_criteria: string }[];
      const set = d.prepare("UPDATE tasks SET acceptance_criteria = ? WHERE id = ?");
      for (const row of rows) {
        const raw = parseJson<{ text?: string }[]>(row.acceptance_criteria, []);
        if (raw.some((c) => c && typeof c === "object")) set.run(JSON.stringify(raw.map((c) => c.text ?? String(c))), row.id);
      }
    },
  },
  {
    // Validation plan, approved plan, verification outcome and evidence.
    name: "016_validation_and_evidence",
    up: (d) => {
      addColumn(d, "tasks", "validation_plan TEXT");
      addColumn(d, "tasks", "approved_plan TEXT");
      addColumn(d, "tasks", "head_sha TEXT");
      addColumn(d, "tasks", "diff_stats TEXT");
      addColumn(d, "tasks", "verification TEXT");
      addColumn(d, "tasks", "risk_reasons TEXT DEFAULT '[]'");
      d.exec(`
        CREATE TABLE IF NOT EXISTS task_evidence (
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          round INTEGER NOT NULL,
          kind TEXT NOT NULL,
          criterion_id TEXT,
          command TEXT,
          exit_code INTEGER,
          summary TEXT NOT NULL,
          log_path TEXT,
          produced_by TEXT NOT NULL,
          flaky INTEGER NOT NULL DEFAULT 0,
          skipped INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          PRIMARY KEY (task_id, id)
        );
      `);
    },
    down: (d) => {
      d.exec("DROP TABLE IF EXISTS task_evidence");
      try {
        d.exec(`UPDATE tasks SET validation_plan = NULL, approved_plan = NULL, head_sha = NULL, diff_stats = NULL,
          verification = NULL, risk_reasons = '[]'`);
      } catch {}
    },
  },
  {
    // Small key/value store for server state other processes read (verifier heartbeat).
    name: "017_app_state",
    up: (d) => d.exec("CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT NOT NULL)"),
    down: (d) => d.exec("DROP TABLE IF EXISTS app_state"),
  },
  {
    // Structured handoffs between phases; existing context notes become "legacy" handoffs.
    name: "018_task_handoffs",
    up: (d) => {
      d.exec(`
        CREATE TABLE IF NOT EXISTS task_handoffs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
          phase TEXT NOT NULL,
          round INTEGER NOT NULL DEFAULT 0,
          agent_id TEXT NOT NULL,
          summary TEXT NOT NULL,
          decisions TEXT NOT NULL DEFAULT '[]',
          risks TEXT NOT NULL DEFAULT '[]',
          next TEXT NOT NULL DEFAULT '[]',
          created_at TEXT NOT NULL
        );
      `);
      d.exec("CREATE INDEX IF NOT EXISTS idx_handoffs_task_id ON task_handoffs(task_id)");
      const rows = d.prepare("SELECT id, contexts, created_at FROM tasks").all() as { id: string; contexts: string; created_at: string }[];
      const insert = d.prepare(
        "INSERT INTO task_handoffs (task_id, phase, round, agent_id, summary, created_at) VALUES (?, 'legacy', 0, 'unknown', ?, ?)",
      );
      for (const row of rows) {
        for (const note of parseJson<string[]>(row.contexts, [])) {
          if (typeof note === "string" && note.trim()) insert.run(row.id, note.trim(), row.created_at);
        }
      }
    },
    down: (d) => d.exec("DROP TABLE IF EXISTS task_handoffs"),
  },
  {
    // Non-goals, references and Definition-of-Ready issues.
    name: "019_task_info",
    up: (d) => {
      addColumn(d, "tasks", "non_goals TEXT DEFAULT '[]'");
      addColumn(d, "tasks", "refs TEXT DEFAULT '[]'");
      addColumn(d, "tasks", "dor_issues TEXT DEFAULT '[]'");
    },
    down: (d) => {
      try { d.exec("UPDATE tasks SET non_goals = '[]', refs = '[]', dor_issues = '[]'"); } catch {}
    },
  },
  {
    // conversation_entries / status_history were copies nothing read (migrations 004/005).
    name: "020_drop_legacy_tables",
    up: (d) => {
      d.exec("DROP TABLE IF EXISTS conversation_entries");
      d.exec("DROP TABLE IF EXISTS status_history");
    },
    down: (d) => createLegacyTables(d),
  },
  {
    // Subtasks (parent, dependencies, held until the parent's plan is approved) and plan extras.
    name: "021_subtasks_plan_submission",
    up: (d) => {
      addColumn(d, "tasks", "parent_id TEXT");
      addColumn(d, "tasks", "blocked_by TEXT DEFAULT '[]'");
      addColumn(d, "tasks", "plan_submission TEXT");
      addColumn(d, "tasks", "held INTEGER NOT NULL DEFAULT 0");
      d.exec("CREATE INDEX IF NOT EXISTS idx_tasks_parent_id ON tasks(parent_id)");
    },
    down: (d) => {
      try { d.exec("UPDATE tasks SET parent_id = NULL, blocked_by = '[]', plan_submission = NULL, held = 0"); } catch {}
      d.exec("DROP INDEX IF EXISTS idx_tasks_parent_id");
    },
  },
  {
    // Integrators now open PRs; implementer runners become builders so they keep doing so.
    name: "022_runner_roles_builder",
    up: (d) => d.exec("UPDATE runners SET role = 'builder' WHERE role = 'implementer'"),
    down: (d) => d.exec("UPDATE runners SET role = 'implementer' WHERE role = 'builder'"),
  },
  {
    // "merged" meant "a PR is open": it becomes pr_open, with the PR kept as data.
    name: "023_pull_requests",
    up: (d) => {
      addColumn(d, "tasks", "pull_request TEXT");
      d.exec("UPDATE tasks SET status = 'pr_open' WHERE status = 'merged'");
    },
    down: (d) => {
      d.exec("UPDATE tasks SET status = 'merged' WHERE status = 'pr_open'");
      try { d.exec("UPDATE tasks SET pull_request = NULL"); } catch {}
    },
  },
];

function runMigrations(): void {
  const d = getDb();
  for (const migration of MIGRATIONS) {
    if (isMigrationApplied(migration.name)) continue;
    migration.up(d);
    markMigrationApplied(migration.name);
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

let savepointSeq = 0;

/**
 * Runs `fn` atomically. Nests: inside an open transaction (another
 * withTransaction, or a test's beginTransaction) it uses a SAVEPOINT, so an
 * inner failure rolls back only the inner work.
 */
export function withTransaction<T>(fn: () => T): T {
  const d = getDb();
  if (d.inTransaction) {
    const sp = `sp_${++savepointSeq}`;
    d.exec(`SAVEPOINT ${sp}`);
    try {
      const result = fn();
      d.exec(`RELEASE ${sp}`);
      return result;
    } catch (e) {
      d.exec(`ROLLBACK TO ${sp}`);
      d.exec(`RELEASE ${sp}`);
      throw e;
    }
  }
  d.exec("BEGIN IMMEDIATE");
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
  return MIGRATIONS.map(({ name }) => ({ name, applied: isMigrationApplied(name) }));
}

/** Undoes one migration by name, or every migration (newest first) when no name is given. */
export function rollbackMigration(name?: string): void {
  const d = getDb();
  const targets = name ? MIGRATIONS.filter((m) => m.name === name) : [...MIGRATIONS].reverse();
  for (const migration of targets) {
    migration.down(d);
    d.prepare("DELETE FROM _migrations WHERE name = ?").run(migration.name);
  }
}

function parseJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || raw === "") return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function rowToTask(row: any): Task {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    steerDetails: row.steer_details ?? null,
    guardrails: JSON.parse(row.guardrails || "[]"),
    acceptanceCriteria: criteriaFromStored(parseJson(row.acceptance_criteria, [])),
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
    claimToken: row.claim_token ?? null,
    blocker: parseJson(row.blocker, null),
    revertStreak: row.revert_streak ?? 0,
    type: row.type ?? "feature",
    risk: row.risk ?? "medium",
    autonomy: row.autonomy ?? null,
    planRound: row.plan_round ?? 0,
    codeRound: row.code_round ?? 0,
    verifyFailures: row.verify_failures ?? 0,
    roundBaseline: parseJson(row.round_baseline, {}),
    producers: parseJson(row.producers, {}),
    leaseExpiresAt: row.lease_expires_at ?? null,
    lastReview: parseJson(row.last_review, null),
    validationPlan: parseJson(row.validation_plan, null),
    approvedPlan: parseJson(row.approved_plan, null),
    headSha: row.head_sha ?? null,
    diffStats: parseJson(row.diff_stats, null),
    verification: parseJson(row.verification, null),
    riskReasons: parseJson(row.risk_reasons, []),
    nonGoals: parseJson(row.non_goals, []),
    references: parseJson(row.refs, []),
    dorIssues: parseJson(row.dor_issues, []),
    parentId: row.parent_id ?? null,
    blockedBy: parseJson(row.blocked_by, []),
    planSubmission: parseJson(row.plan_submission, null),
    held: row.held === 1,
    pullRequest: parseJson(row.pull_request, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
    archivedAt: row.archived_at ?? null,
    archivePath: row.archive_path ?? null,
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
    defaultMergeBranch: row.default_merge_branch ?? null,
    autonomy: row.autonomy ?? 2,
    policy: parseJson(row.policy, {}),
    profile: resolveProfile(parseJson(row.profile, {})),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
  };
}

function rowToRunner(row: any): Runner {
  return {
    id: row.id,
    name: row.name,
    tool: row.tool,
    role: row.role,
    projectId: row.project_id ?? null,
    model: row.model ?? null,
    effort: row.effort ?? null,
    concurrency: row.concurrency,
    pollIntervalSec: row.poll_interval_sec,
    permissionMode: row.permission_mode,
    extraArgs: row.extra_args ? JSON.parse(row.extra_args) : null,
    enabled: row.enabled === 1,
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

/** Lowercase ASCII kebab-case, accents stripped, at most `maxLength` characters. */
export function slugify(text: string, maxLength = 40): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
}

// Agents need a feature branch name; derive one when the creator did not pick it.
export function defaultBranchName(id: string, title: string): string {
  const slug = slugify(title);
  return `task/${id.slice(0, 8)}${slug ? `-${slug}` : ""}`;
}

export function createTask(data: {
  title: string;
  description: string;
  steerDetails?: string;
  guardrails?: string[];
  acceptanceCriteria?: CriterionInput[];
  priority?: number;
  recommendedBranch?: string;
  requiresPlan?: boolean;
  mergeBranch?: string;
  projectId: string;
  contexts?: string[];
  type?: TaskType;
  risk?: Risk;
  autonomy?: AutonomyLevel | null;
  nonGoals?: string[];
  references?: TaskReference[];
  dorIssues?: string[];
  parentId?: string | null;
  blockedBy?: string[];
  held?: boolean;
  /** Start as a draft (a refiner, or a person, makes it ready). */
  draft?: boolean;
}): Task {
  const now = new Date().toISOString();
  const id = randomUUID();
  const task: Task = {
    id,
    title: data.title,
    description: data.description,
    steerDetails: data.steerDetails ?? null,
    guardrails: data.guardrails ?? [],
    acceptanceCriteria: normalizeCriteria(data.acceptanceCriteria ?? []),
    priority: data.priority ?? 0,
    recommendedBranch: data.recommendedBranch?.trim() || defaultBranchName(id, data.title),
    realBranch: null,
    requiresPlan: data.requiresPlan ?? false,
    mergeBranch: data.mergeBranch?.trim() || "main",
    status: data.draft ? TaskStatus.Draft : data.requiresPlan ? TaskStatus.PlanRequested : TaskStatus.ReadyForCode,
    assignedAgent: null,
    conversation: [],
    history: [],
    contexts: data.contexts ?? [],
    projectId: data.projectId,
    worktreePath: null,
    claimToken: null,
    blocker: null,
    revertStreak: 0,
    type: data.type ?? "feature",
    risk: data.risk ?? TASK_TYPES[data.type ?? "feature"].defaultRisk,
    autonomy: data.autonomy ?? null,
    planRound: 0,
    codeRound: 0,
    verifyFailures: 0,
    roundBaseline: {},
    producers: {},
    leaseExpiresAt: null,
    lastReview: null,
    validationPlan: null,
    approvedPlan: null,
    headSha: null,
    diffStats: null,
    verification: null,
    riskReasons: [],
    nonGoals: data.nonGoals ?? [],
    references: data.references ?? [],
    dorIssues: data.dorIssues ?? [],
    parentId: data.parentId ?? null,
    blockedBy: data.blockedBy ?? [],
    planSubmission: null,
    held: data.held ?? false,
    pullRequest: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    archivedAt: null,
    archivePath: null,
  };

  const stmt = getDb().prepare(
    `INSERT INTO tasks (id, title, description, steer_details, guardrails, acceptance_criteria, priority,
      recommended_branch, real_branch, requires_plan, merge_branch, status,
      assigned_agent_id, conversation, history, contexts, project_id, worktree_path, created_at, updated_at,
      type, risk, autonomy, non_goals, refs, dor_issues, parent_id, blocked_by, held)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  stmt.run(
    task.id,
    task.title,
    task.description,
    task.steerDetails,
    JSON.stringify(task.guardrails),
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
    task.type,
    task.risk,
    task.autonomy,
    JSON.stringify(task.nonGoals),
    JSON.stringify(task.references),
    JSON.stringify(task.dorIssues),
    task.parentId,
    JSON.stringify(task.blockedBy),
    task.held ? 1 : 0,
  );

  return task;
}

export function getTaskById(id: string): Task | null {
  const stmt = getDb().prepare("SELECT * FROM tasks WHERE id = ?");
  const row = stmt.get(id);
  return row ? rowToTask(row) : null;
}

export interface ClaimFilter {
  /** Identity of the claimer: tasks whose artifact it produced are skipped (separation of duties). */
  sessionKey?: string;
  /** Model of the claimer: skipped when the project requires a different model than the producer's. */
  model?: string;
}

export function getClaimableTasks(
  statuses: string[],
  projectId?: string,
  limit = 10,
  excludeTaskIds: string[] = [],
  filter: ClaimFilter = {},
): Task[] {
  if (statuses.length === 0) return [];
  const placeholders = statuses.map(() => "?").join(", ");
  let sql = `SELECT t.* FROM tasks t LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.status IN (${placeholders}) AND t.assigned_agent_id IS NULL AND t.deleted_at IS NULL AND t.archived_at IS NULL
      AND COALESCE(t.held, 0) = 0
      AND NOT EXISTS (
        SELECT 1 FROM json_each(COALESCE(NULLIF(t.blocked_by, ''), '[]')) dep
        LEFT JOIN tasks o ON o.id = dep.value
        WHERE o.id IS NULL OR o.status != 'complete'
      )`;
  const params: any[] = [...statuses];
  if (projectId) {
    sql += " AND t.project_id = ?";
    params.push(projectId);
  }
  if (excludeTaskIds.length > 0) {
    sql += ` AND t.id NOT IN (${excludeTaskIds.map(() => "?").join(", ")})`;
    params.push(...excludeTaskIds);
  }
  // Nobody claims the review of an artifact they produced.
  for (const [status, phase] of Object.entries(SEPARATION)) {
    if (!statuses.includes(status)) continue;
    if (filter.sessionKey) {
      sql += ` AND NOT (t.status = ? AND json_extract(t.producers, '$.${phase}.sessionKey') IS ?)`;
      params.push(status, filter.sessionKey);
    }
    if (filter.model) {
      sql += ` AND NOT (t.status = ? AND json_extract(t.producers, '$.${phase}.model') IS ?
        AND COALESCE(json_extract(p.policy, '$.requireDifferentModel'), 0) = 1)`;
      params.push(status, filter.model);
    }
  }
  sql += " ORDER BY t.priority DESC, t.created_at ASC LIMIT ?";
  params.push(limit);
  return getDb().prepare(sql).all(...params).map(rowToTask);
}

export function getNextClaimableTask(statuses: string[], projectId?: string): Task | null {
  return getClaimableTasks(statuses, projectId, 1)[0] ?? null;
}

export function tryAssignTask(data: {
  id: string;
  fromStatus: TaskStatus;
  toStatus: TaskStatus;
  assignedAgent: AgentReference;
  claimToken?: string | null;
}): boolean {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE tasks SET status = ?, assigned_agent_id = ?, claim_token = ?, updated_at = ?
       WHERE id = ? AND assigned_agent_id IS NULL AND status = ? AND deleted_at IS NULL`,
    )
    .run(
      data.toStatus,
      JSON.stringify(data.assignedAgent),
      data.claimToken ?? null,
      now,
      data.id,
      data.fromStatus,
    );
  return result.changes === 1;
}

/** Columns a task patch may set, with how each value is stored. */
const TASK_COLUMNS = {
  title: { column: "title", json: false },
  description: { column: "description", json: false },
  steerDetails: { column: "steer_details", json: false },
  guardrails: { column: "guardrails", json: true },
  acceptanceCriteria: { column: "acceptance_criteria", json: true },
  priority: { column: "priority", json: false },
  recommendedBranch: { column: "recommended_branch", json: false },
  realBranch: { column: "real_branch", json: false },
  mergeBranch: { column: "merge_branch", json: false },
  status: { column: "status", json: false },
  assignedAgent: { column: "assigned_agent_id", json: true },
  conversation: { column: "conversation", json: true },
  history: { column: "history", json: true },
  contexts: { column: "contexts", json: true },
  projectId: { column: "project_id", json: false },
  worktreePath: { column: "worktree_path", json: false },
  claimToken: { column: "claim_token", json: false },
  blocker: { column: "blocker", json: true },
  revertStreak: { column: "revert_streak", json: false },
  type: { column: "type", json: false },
  risk: { column: "risk", json: false },
  autonomy: { column: "autonomy", json: false },
  planRound: { column: "plan_round", json: false },
  codeRound: { column: "code_round", json: false },
  verifyFailures: { column: "verify_failures", json: false },
  roundBaseline: { column: "round_baseline", json: true },
  producers: { column: "producers", json: true },
  leaseExpiresAt: { column: "lease_expires_at", json: false },
  lastReview: { column: "last_review", json: true },
  validationPlan: { column: "validation_plan", json: true },
  approvedPlan: { column: "approved_plan", json: true },
  headSha: { column: "head_sha", json: false },
  diffStats: { column: "diff_stats", json: true },
  verification: { column: "verification", json: true },
  riskReasons: { column: "risk_reasons", json: true },
  nonGoals: { column: "non_goals", json: true },
  // "references" is an SQL keyword.
  references: { column: "refs", json: true },
  dorIssues: { column: "dor_issues", json: true },
  parentId: { column: "parent_id", json: false },
  blockedBy: { column: "blocked_by", json: true },
  planSubmission: { column: "plan_submission", json: true },
  held: { column: "held", json: false },
  pullRequest: { column: "pull_request", json: true },
} as const;

export type TaskPatch = {
  -readonly [K in keyof typeof TASK_COLUMNS]?: K extends keyof Task ? Task[K] : never;
};

/** JSON array columns that `appendJson` may append to. */
export type TaskListColumn = "conversation" | "history" | "contexts";

/**
 * Sets only the given columns (plus updated_at). Unlike a read-merge-write,
 * a concurrent append by another process (e.g. an MCP server) is never lost.
 */
export function patchTask(id: string, patch: TaskPatch): Task | null {
  const sets: string[] = [];
  const params: any[] = [];
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const spec = TASK_COLUMNS[key as keyof typeof TASK_COLUMNS];
    if (!spec) continue;
    sets.push(`${spec.column} = ?`);
    if (spec.json) params.push(value === null ? null : JSON.stringify(value));
    else if (typeof value === "boolean") params.push(value ? 1 : 0);
    else params.push(value);
  }
  sets.push("updated_at = ?");
  params.push(new Date().toISOString(), id);
  const result = getDb().prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return result.changes > 0 ? getTaskById(id) : null;
}

/** Appends one entry to a JSON array column in place. */
export function appendJson(id: string, column: TaskListColumn, entry: unknown): void {
  const col = TASK_COLUMNS[column].column;
  getDb()
    .prepare(
      `UPDATE tasks SET ${col} = json_insert(COALESCE(NULLIF(${col}, ''), '[]'), '$[#]', json(?)), updated_at = ? WHERE id = ?`,
    )
    .run(JSON.stringify(entry), new Date().toISOString(), id);
}

/** Bumps updated_at so watchers (the web server's SSE feed) pick up side-table changes. */
export function touchTask(id: string): void {
  getDb().prepare("UPDATE tasks SET updated_at = ? WHERE id = ?").run(new Date().toISOString(), id);
}

/** Partial update; kept for callers that predate patchTask (same semantics). */
export function updateTask(id: string, data: TaskPatch): Task | null {
  if (!getTaskById(id)) return null;
  return patchTask(id, data);
}

export function deleteTask(id: string): boolean {
  // Child tables reference tasks(id) without ON DELETE CASCADE; remove them first.
  const d = getDb();
  return d.transaction(() => {
    d.prepare("DELETE FROM activity WHERE task_id = ?").run(id);
    const result = d.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return result.changes > 0;
  })();
}

export function softDeleteTask(id: string): boolean {
  const now = new Date().toISOString();
  const stmt = getDb().prepare("UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL");
  const result = stmt.run(now, now, id);
  return result.changes > 0;
}

/** Records that the task was written to the archive (and takes it off the board). */
export function setTaskArchive(id: string, archivedAt: string, archivePath: string): boolean {
  const result = getDb()
    .prepare("UPDATE tasks SET archived_at = ?, archive_path = ?, updated_at = ? WHERE id = ?")
    .run(archivedAt, archivePath, new Date().toISOString(), id);
  return result.changes > 0;
}

/** Subtasks of a task, oldest first. */
export function getSubtasks(parentId: string): Task[] {
  return getDb()
    .prepare("SELECT * FROM tasks WHERE parent_id = ? AND deleted_at IS NULL ORDER BY created_at ASC")
    .all(parentId)
    .map(rowToTask);
}

/** Live tasks; archived ones are left out unless `includeArchived` is set. */
export function getTasks(projectId?: string, options: { includeArchived?: boolean } = {}): Task[] {
  let sql = "SELECT * FROM tasks WHERE deleted_at IS NULL";
  if (!options.includeArchived) sql += " AND archived_at IS NULL";
  const params: any[] = [];
  if (projectId) {
    sql += " AND project_id = ?";
    params.push(projectId);
  }
  sql += " ORDER BY priority DESC, created_at ASC";
  return getDb().prepare(sql).all(...params).map(rowToTask);
}

/** Tasks (including soft-deleted ones) whose updated_at is strictly after `iso`. */
export function getTasksUpdatedSince(iso: string): Task[] {
  return getDb()
    .prepare("SELECT * FROM tasks WHERE updated_at > ? ORDER BY updated_at ASC")
    .all(iso)
    .map(rowToTask);
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
  defaultMergeBranch?: string | null;
  autonomy?: AutonomyLevel;
  policy?: Partial<PolicySettings>;
  profile?: Partial<ProjectProfile>;
}): Project {
  const now = new Date().toISOString();
  const stmt = getDb().prepare(
    "INSERT INTO projects (id, display_name, working_directory, default_merge_branch, autonomy, policy, profile, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );
  stmt.run(
    data.id,
    data.displayName,
    data.workingDirectory,
    data.defaultMergeBranch?.trim() || null,
    data.autonomy ?? 2,
    JSON.stringify(data.policy ?? {}),
    JSON.stringify(data.profile ?? {}),
    now,
    now,
  );

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
    defaultMergeBranch?: string | null;
    autonomy?: AutonomyLevel;
    policy?: Partial<PolicySettings>;
    profile?: Partial<ProjectProfile>;
  },
): Project | null {
  const existing = getProjectById(id);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated = {
    displayName: data.displayName ?? existing.displayName,
    workingDirectory: data.workingDirectory ?? existing.workingDirectory,
    defaultMergeBranch:
      data.defaultMergeBranch !== undefined
        ? data.defaultMergeBranch?.trim() || null
        : existing.defaultMergeBranch,
    autonomy: data.autonomy ?? existing.autonomy,
    policy: data.policy ? { ...existing.policy, ...data.policy } : existing.policy,
    profile: data.profile
      ? { ...existing.profile, ...data.profile, commands: { ...existing.profile.commands, ...(data.profile.commands ?? {}) } }
      : existing.profile,
  };

  const stmt = getDb().prepare(
    "UPDATE projects SET display_name = ?, working_directory = ?, default_merge_branch = ?, autonomy = ?, policy = ?, profile = ?, updated_at = ? WHERE id = ?",
  );
  stmt.run(
    updated.displayName,
    updated.workingDirectory,
    updated.defaultMergeBranch,
    updated.autonomy,
    JSON.stringify(updated.policy),
    JSON.stringify(updated.profile),
    now,
    id,
  );

  return getProjectById(id)!;
}

// ─── App state ────────────────────────────────────────────────────────

export function setAppState(key: string, value: string): void {
  getDb()
    .prepare("INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .run(key, value, new Date().toISOString());
}

export function getAppState(key: string): { value: string; updatedAt: string } | null {
  const row = getDb().prepare("SELECT value, updated_at FROM app_state WHERE key = ?").get(key) as
    | { value: string; updated_at: string }
    | undefined;
  return row ? { value: row.value, updatedAt: row.updated_at } : null;
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

export function countActivityEvents(filters?: { taskId?: string; agentId?: string; from?: string; to?: string }): number {
  const { where, params } = activityWhere(filters);
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM activity${where}`).get(...params) as { n: number };
  return row.n;
}

function activityWhere(filters?: { taskId?: string; agentId?: string; from?: string; to?: string }) {
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
  return { where: conditions.length ? " WHERE " + conditions.join(" AND ") : "", params };
}

export function getActivityEvents(filters?: {
  taskId?: string;
  agentId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
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

  sql += " ORDER BY created_at DESC, id DESC";

  if (filters?.limit) {
    sql += " LIMIT ? OFFSET ?";
    params.push(filters.limit, filters.offset ?? 0);
  }

  return getDb()
    .prepare(sql)
    .all(...params)
    .map(rowToActivity);
}

// ─── Runners ──────────────────────────────────────────────────────────

export function createRunner(data: {
  name: string;
  tool: Runner["tool"];
  role: string;
  projectId?: string | null;
  model?: string | null;
  effort?: string | null;
  concurrency?: number;
  pollIntervalSec?: number;
  permissionMode?: Runner["permissionMode"];
  extraArgs?: string[] | null;
  enabled?: boolean;
}): Runner {
  const now = new Date().toISOString();
  const id = randomUUID();
  getDb()
    .prepare(
      `INSERT INTO runners (id, name, tool, role, project_id, model, effort, concurrency, poll_interval_sec,
        permission_mode, extra_args, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      data.name,
      data.tool,
      data.role,
      data.projectId ?? null,
      data.model ?? null,
      data.effort ?? null,
      data.concurrency ?? 1,
      data.pollIntervalSec ?? 5,
      data.permissionMode ?? "safe",
      data.extraArgs ? JSON.stringify(data.extraArgs) : null,
      data.enabled ? 1 : 0,
      now,
      now,
    );
  return getRunnerById(id)!;
}

export function getRunners(): Runner[] {
  return getDb().prepare("SELECT * FROM runners ORDER BY created_at ASC").all().map(rowToRunner);
}

export function getRunnerById(id: string): Runner | null {
  const row = getDb().prepare("SELECT * FROM runners WHERE id = ?").get(id);
  return row ? rowToRunner(row) : null;
}

export function updateRunner(
  id: string,
  data: {
    name?: string;
    tool?: Runner["tool"];
    role?: string;
    projectId?: string | null;
    model?: string | null;
    effort?: string | null;
    concurrency?: number;
    pollIntervalSec?: number;
    permissionMode?: Runner["permissionMode"];
    extraArgs?: string[] | null;
    enabled?: boolean;
  },
): Runner | null {
  const existing = getRunnerById(id);
  if (!existing) return null;
  const now = new Date().toISOString();
  const updated = {
    name: data.name ?? existing.name,
    tool: data.tool ?? existing.tool,
    role: data.role ?? existing.role,
    projectId: data.projectId !== undefined ? data.projectId : existing.projectId,
    model: data.model !== undefined ? data.model : existing.model,
    effort: data.effort !== undefined ? data.effort : existing.effort,
    concurrency: data.concurrency ?? existing.concurrency,
    pollIntervalSec: data.pollIntervalSec ?? existing.pollIntervalSec,
    permissionMode: data.permissionMode ?? existing.permissionMode,
    extraArgs: data.extraArgs !== undefined ? data.extraArgs : existing.extraArgs,
    enabled: data.enabled !== undefined ? data.enabled : existing.enabled,
  };
  getDb()
    .prepare(
      `UPDATE runners SET name = ?, tool = ?, role = ?, project_id = ?, model = ?, effort = ?, concurrency = ?,
        poll_interval_sec = ?, permission_mode = ?, extra_args = ?, enabled = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      updated.name,
      updated.tool,
      updated.role,
      updated.projectId,
      updated.model,
      updated.effort,
      updated.concurrency,
      updated.pollIntervalSec,
      updated.permissionMode,
      updated.extraArgs ? JSON.stringify(updated.extraArgs) : null,
      updated.enabled ? 1 : 0,
      now,
      id,
    );
  return getRunnerById(id)!;
}

export function deleteRunner(id: string): boolean {
  const result = getDb().prepare("DELETE FROM runners WHERE id = ?").run(id);
  return result.changes > 0;
}

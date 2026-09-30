<div align="center">

<img src="design-system/assets/Logos/agentq-mark.svg" alt="AgentQ logo" width="80" />

# AgentQ

### If you want to be a 100x engineer, stop prompting and start queueing.

**A local-first task queue and Kanban board for AI coding agents.**
Write the task once. Claude Code, Codex, OpenCode, Gemini CLI or Copilot plan it, code it, review it and open the PR.
AI critics and reviewers handle the routine gates. You decide what needs a person, and you merge.

[![Installer CI](https://github.com/sergiowero/agent-task-queue/actions/workflows/installer.yml/badge.svg)](https://github.com/sergiowero/agent-task-queue/actions/workflows/installer.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-000000?logo=bun&logoColor=white)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-server-6366f1)](https://modelcontextprotocol.io)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-a855f7)](#requirements)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-22c55e)](#contributing)
[![GitHub stars](https://img.shields.io/github/stars/sergiowero/agent-task-queue?style=social)](https://github.com/sergiowero/agent-task-queue/stargazers)

[Quick start](#quick-start) · [How it works](#how-it-works) · [Workflow](#the-workflow) · [Runners](#runners-hands-free-mode) · [MCP tools](#mcp-tools) · [FAQ](#faq) · [Docs](#documentation)

</div>

<!-- TODO: add a screenshot or a short GIF of the board here, e.g. docs/assets/board.png -->

---

## Why AgentQ?

Coding agents are great at single tasks. Running **many** of them across **many** repositories is where things fall apart:

- Five terminals open, each with an agent doing *something*, and no single place to see what.
- Every session starts cold. The agent that reviews the code has no idea why the planner made the choices it made.
- Nobody is sure which agent touched which branch, or whether that "done" actually means merged.
- You end up babysitting prompts instead of reviewing outcomes.

AgentQ turns that chaos into a **queue**. You write well-scoped tasks on a board. Agents **claim** them, work in isolated git worktrees, and **submit** their output back with handoff notes for the next agent. Other agents critique the plans and review the code (never their own), and the **Needs you** inbox holds only the decisions a person has to make: risky plans and code, blocked tasks and the pull request. How much that is, is a setting per project. The PR phase opens a pull request; no agent merges it.

It all runs on your machine: one Bun process, one SQLite file, no accounts, no cloud.

## Features

|  |  |
|---|---|
| **Plan → Code → Review → PR** | A 23-state workflow with feedback loops at every phase. An AI critic checks the plan and an AI reviewer the code, change requests go back with findings tracked by id, and the task ends on a pull request. |
| **Autonomy you choose** | Four levels per project, from every gate human (L0) to AI-reviewed plans and code with optional auto-merge of green, low-risk PRs (L3). The default, L2, asks you only for risky plans and code, escalations and the merge. Nobody checks their own work. |
| **Works with the agents you already use** | Claude Code, Codex, OpenCode, Gemini CLI, GitHub Copilot (CLI and VS Code), or any MCP client. |
| **One-command setup** | `bun run install:all` registers the MCP server and the workflow skills with every coding tool it finds, on macOS, Linux and Windows. |
| **Hands-free runners** | The server claims tasks and launches `claude`, `codex`, `opencode` or `gemini` headless in the right repo. No manual prompting. |
| **Composable roles** | One role per phase (refine, plan, plan_review, code, verify, review, pr); give an agent or runner any mix of them. Mix models per role. |
| **Context handoff** | Every submission carries notes for the next agent: decisions taken, gotchas, what to check next. No more cold starts. |
| **Isolated git worktrees** | One worktree and feature branch per task, so parallel agents never step on each other. |
| **Atomic claims** | Claims run in a SQLite transaction. Two agents never get the same task. |
| **Live Kanban dashboard** | React board and a **Needs you** inbox, decision screens for escalated plans and reviews, task details with conversation, handoffs and history, runners with live logs, agents, flow metrics and per-project settings, all updated over SSE. |
| **Safe by default** | Runners use an allow-list of tools and commands. The PR phase means push + `gh pr create`, never a local merge or a force-push. |
| **Archive to Markdown** | Finished tasks are saved into the repo as a summary and a full record: plan, code notes, review, PR, agents and timeline. |
| **Local-first** | A single SQLite file at `~/.agentq/agentq.db`. Your code and your tasks stay on your machine. |

## How it works

```mermaid
flowchart LR
    you([You]) -->|write tasks, decide what needs you| ui["Web dashboard<br/>React · SSE"]
    ui <--> server["Web server<br/>Bun · REST · runners"]
    server <--> db[("SQLite<br/>~/.agentq/agentq.db")]
    server -->|launches headless| agents["Coding agents<br/>claude · codex · opencode · gemini"]
    ide["Your own agent session<br/>Claude Code, Codex, Copilot..."] -->|agentq-claim skill| mcp
    agents <-->|claim_task · submit_*| mcp["AgentQ MCP server<br/>stdio"]
    mcp <--> db
    agents -->|worktree · commits · PR| repo[("Your repositories")]
    ide -->|worktree · commits · PR| repo
```

1. **You** create a project (a local git repo) and write tasks with a description, guardrails and acceptance criteria.
2. **An agent claims** the highest-priority task one of its roles can work on, through the `claim_task` MCP tool.
3. **It does the phase's work** (refine, plan, plan review, code, verify, review or PR), guided by a phase skill, in the project directory or in the task's worktree.
4. **It submits** with a Markdown message plus handoff notes. The task moves to the next status and is released.
5. **The next phase picks it up.** A critic or reviewer agent, never the author, usually decides where the task goes next. It comes to **you**, in the dashboard, when a person has to decide: a risky plan or code, a blocked task, or the pull request to merge.

Agents talk to AgentQ **only** through the MCP server, which writes straight to SQLite. The web server does not even need to be running for agents to work; the board catches up as soon as you open it.

## Quick start

### Requirements

- [Bun](https://bun.sh) 1.2 or newer
- Git
- [GitHub CLI](https://cli.github.com) (`gh`), authenticated: the PR phase opens the pull request with it, and the server uses it to complete a task once you merge that PR
- At least one coding agent: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex](https://github.com/openai/codex), [OpenCode](https://opencode.ai), [Gemini CLI](https://github.com/google-gemini/gemini-cli) or [GitHub Copilot](https://github.com/features/copilot)

### Install

```bash
git clone https://github.com/sergiowero/agent-task-queue.git
cd agent-task-queue
bun install
```

Connect your coding tools (MCP server + workflow skills). Safe to run again at any time:

```bash
bun run install:all
```

Start AgentQ:

```bash
bun run start
```

Open **http://localhost:3000**. The API and the dashboard share that single port.

The API has no login, so it only serves you: the server listens on `127.0.0.1`, and it refuses requests another web page could send it (a foreign `Origin`, a `Host` that is not this machine, a body that is not JSON). To reach it from other machines, set `AGENTQ_HOST=0.0.0.0` and list the names you use in `AGENTQ_ALLOWED_HOSTS`; anyone who can reach the port can then drive AgentQ.

### Your first task in two minutes

1. **Projects → New project.** Give it a name and the absolute path of a local git repository. AgentQ reads the repository's test, lint and build commands for its verifier and opens the **Commands** tab to check them (if it finds none, add them there).
2. **Board → New task.** Describe what you want, add acceptance criteria, and choose whether it needs a plan first.
3. **Put agents on it.** Pick one of the two modes:
   - **Hands-free:** open **Runners → New runner**, choose tool `claude` (or `codex`, `opencode`, `gemini`), keep the default roles (all but verify), mode `safe`, and start it. It claims the task within seconds. The default level, **L2**, never lets an agent critique or review its own work, so start a second runner the same way to take those steps (the Runners page warns when none may). With only one, the critique and the review wait 20 minutes and then come to you.
   - **Interactive:** open your coding tool in any folder and say:
     > Work the AgentQ queue.

     The `agentq-claim` skill claims the task, routes to the right phase skill and keeps going until the queue is empty. Use a second session for the critique and the review.
4. **Let it run.** At L2 an AI critic reviews the plan and an AI reviewer the code, change requests go back to the coder with findings tracked by id, and the built-in verifier runs the project's commands before any review. A task comes to **Needs you** only when a person has to decide: a plan of medium or high risk, the code of a high-risk task, a question an agent escalated (or a limit it hit), and the pull request. The task page puts the AI verdict, the verification, the diff size and the criteria in one panel to decide on. Want to approve every plan and every change yourself? Set the project to **L0** under **Projects → Edit → Autonomy**.
5. **Merge and finish.** The agent pushes the branch and opens the pull request: review and merge it on GitHub. With `gh` logged in, AgentQ sees the merge and completes the task (without `gh`, click **Mark merged**). Then **Archive** the task to save the whole story as Markdown in the repo.

## Two ways to run agents

| Mode | What happens | Best for |
|---|---|---|
| **Runners** (hands-free) | The server polls the queue with its roles and launches the coding tool headless in the project directory, with the task and the phase skill as the prompt. Each job gets the MCP server automatically. | Background work, overnight queues, parallel agents |
| **MCP + skills** (interactive) | You open Claude Code, Codex, OpenCode, Gemini CLI or Copilot yourself and invoke the `agentq-claim` skill. You can watch and steer the session. | Pairing with an agent, trying new models, debugging tasks |

Both go through the same MCP server, the same SQLite database and the same workflow rules in `packages/shared`.

### Supported tools

| Tool | MCP server registered by `install:mcp` | Skills installed by `install:skills` | Runner |
|---|:---:|:---:|:---:|
| Claude Code | ✅ | ✅ | ✅ `claude` |
| Codex | ✅ | ✅ | ✅ `codex` |
| OpenCode | ✅ | ✅ | ✅ `opencode` |
| Gemini CLI | ✅ | | ✅ `gemini` |
| GitHub Copilot CLI | ✅ | | via `custom` |
| GitHub Copilot in VS Code | ✅ | | |
| Kimi Code, Junie | manual | ✅ | via `custom` |
| Any other MCP client | manual (`bun run mcp`) | | via `custom` |

## The workflow

A task moves through these states. At the default autonomy level (**L2**) agents move it along: a critic agent decides plans and a reviewer agent decides code, so the edges labelled `you` leave the states that wait in your **Needs you** inbox. Some edges depend on the level (`L0`, `L1+`, `L2+`) and on the task: a critic's approval skips you only for a low-risk plan, code goes to verification first when the project has commands to run, and a reviewer's approval skips you unless the task is high risk or the approval is picked for a spot check. See [Autonomy](#autonomy) for the levels.

```mermaid
stateDiagram-v2
    [*] --> draft: rough idea
    [*] --> plan_requested: needs a plan
    [*] --> ready_for_code: no plan
    draft --> refining: refine role claims
    refining --> plan_requested: refined
    refining --> ready_for_code: refined, no plan
    plan_requested --> planning: plan role claims
    planning --> plan_review_requested: submit_plan (L2+)
    planning --> waiting_plan_review: submit_plan (L0, L1)
    plan_review_requested --> plan_reviewing: plan_review role claims
    plan_reviewing --> ready_for_code: approve (low risk)
    plan_reviewing --> waiting_plan_review: approve (medium or high risk)
    plan_reviewing --> plan_changes_requested: request_changes
    plan_reviewing --> split: approve (subtasks)
    waiting_plan_review --> ready_for_code: you approve
    waiting_plan_review --> split: you approve (subtasks)
    waiting_plan_review --> plan_changes_requested: you request changes
    plan_changes_requested --> planning: plan role claims
    split --> complete: subtasks finished
    ready_for_code --> coding: code role claims
    coding --> verify_requested: submit_code (commands to run)
    coding --> code_review_requested: submit_code (L1+)
    coding --> waiting_code_review: submit_code (L0)
    verify_requested --> verifying: verify role claims
    verifying --> code_review_requested: green (L1+)
    verifying --> waiting_code_review: green (L0)
    verifying --> changes_requested: red
    code_review_requested --> reviewing: review role claims
    reviewing --> approved: approve (L1+)
    reviewing --> waiting_code_review: submit_review (L0), approve (high risk or sampled)
    reviewing --> changes_requested: request_changes (L1+)
    waiting_code_review --> code_review_requested: you request an AI review
    waiting_code_review --> approved: you approve
    waiting_code_review --> changes_requested: you request changes
    waiting_code_review --> plan_changes_requested: you re-plan
    changes_requested --> coding: code role claims
    approved --> merging: pr role claims
    merging --> pr_open: submit_pr (PR opened)
    pr_open --> complete: PR merged on GitHub
    pr_open --> changes_requested: changes requested on the PR
    complete --> [*]
```

### When a task stops

An agent that cannot finish (a rejected push, missing credentials, a contradictory task) calls `report_blocker`, and the routing itself stops a task when a limit is hit: a plan critique or an AI review that keeps asking for changes, a critic or reviewer that cannot decide or keeps reopening a finding the coder answered, failed verifications or weakened tests, a pull request closed without merging, or a runner job that ends three times in a row without submitting (every trigger is in [docs/policy.md](docs/policy.md#escalations)). The task goes to **needs_human** with its reason, its question and the phase it stopped in, and you answer from the task page and choose where it goes next. In this diagram the edges into `needs_human` say why it stopped, and the edges out say in which blocked phases you can choose that status. You can cancel instead, from any of them.

```mermaid
stateDiagram-v2
    direction LR
    refining --> needs_human: blocker
    planning --> needs_human: blocking question, blocker
    plan_reviewing --> needs_human: critique limit, needs_human verdict
    coding --> needs_human: blocker
    verifying --> needs_human: failure limit, weakened tests
    reviewing --> needs_human: review limit, disagreement, needs_human verdict
    merging --> needs_human: blocker, wrong commit pushed
    pr_open --> needs_human: PR closed unmerged
    split --> needs_human: every subtask canceled
    plan_requested --> needs_human: dependency canceled
    ready_for_code --> needs_human: dependency canceled
    needs_human --> draft: refine
    needs_human --> plan_requested: refine, plan
    needs_human --> ready_for_code: refine, plan, plan review, code
    needs_human --> split: plan, plan review (subtasks)
    needs_human --> plan_review_requested: plan review
    needs_human --> waiting_plan_review: plan, plan review
    needs_human --> plan_changes_requested: plan, plan review, code, verify, review
    needs_human --> changes_requested: code, verify, review, PR
    needs_human --> waiting_code_review: code, verify, review
    needs_human --> verify_requested: verify
    needs_human --> code_review_requested: verify, review
    needs_human --> approved: review, PR
    needs_human --> pr_open: PR
    needs_human --> complete: PR
```

Sending a plan blocker to `ready_for_code` approves the plan. When the approved plan itself turns out wrong, answer a coding, verification or review blocker with **Plan changes requested**, or click **Re-plan** on a code review. An escalated plan or review is decided on the same screen as one that was waiting for you: the AI verdict and the findings (tick an answered one to reopen it with your answer, or accept an open one as it is), the verification and the diff size.

Everything waiting for you is in the **Needs you** inbox (sidebar), oldest first: answers to blockers, plans to approve, code to review and pull requests to merge. Any task that is not finished can also be **canceled** (a split task takes its unfinished subtasks with it), and a stuck active task can be **unblocked** from the task page.

### Autonomy

Each project has an autonomy level (L0–L3, default **L2**; a task can override it). It decides who makes each gate:

| Level | Plan | Code | Pull request |
|---|---|---|---|
| **L0** Supervised | You | You (an AI review on request) | You |
| **L1** Human plan | You | AI reviewer | You |
| **L2** Human PR (default) | AI critic, then you unless the task is low risk | AI reviewer | You |
| **L3** Autonomous | AI critic, then you unless the task is low risk | AI reviewer | You, or auto-merge when green and low risk |

From L2 up a critic agent reviews each plan: approve sends a low-risk plan straight to coding and anything riskier to you, and request changes goes back to the planner. After two critiques that ask for changes, or when the plan has a blocking question or the critic cannot decide, you decide. From L1 up, `submit_code` goes straight to an AI review (after verification, when the project has commands), and the reviewer's verdict routes the task: approve moves it toward the PR, request changes sends it back with findings tracked by id, and you decide after three rounds, when the reviewer keeps reopening a finding the coder answered, when it asks a question, for a high-risk task, or for an approval picked for a spot check (every Nth, off by default). Nobody critiques, verifies or reviews their own plan or code, in any round: a second runner (or agent session) that can do it picks it up, the Runners page warns when no runner may, and a critique or review nobody takes within 20 minutes comes to you. L0 keeps every gate human. Every number is a setting under **Projects → Edit → Autonomy**. See [docs/policy.md](docs/policy.md).

The task ends on GitHub. The agent with the `pr` role opens the PR with a body AgentQ writes (criteria with their evidence, verification, the AI review, the risk) and the task waits in **pr_open**. With the `gh` CLI logged in, the server follows every open PR: merged completes the task (and archives it when the project asks), closed sends it to you, and a change request (on GitHub, or **Request changes** on the task page) sends it back to the coder: the fix goes through verification and review again and lands on the same PR. Without `gh`, or with `AGENTQ_PR_SYNC=0`, nothing follows the PR: the task page and **Needs you** say so, and you click **Mark merged** once it is merged (the task page also shows when GitHub was last checked, and what `gh` reported when it failed on that PR). At **L3** with `autoMerge`, green low-risk PRs merge themselves, as long as their head is the commit the review approved. **Activity** shows how the flow is doing: human decisions per task, share of tasks that reached the PR without a person, review rounds, escalations.

Agents also have to show their work. Plans say how each acceptance criterion will be verified; coders submit evidence per criterion; and the server's built-in verifier runs the project's commands (set them under **Projects → Edit → Commands**) on every submission, catching red builds before any reviewer spends time on them. The server also reads every submission's diff itself: weakened tests go straight back to the coder, and changes to protected paths or an oversized diff raise the task's risk to high, so a person reviews the code too, with or without commands. Each phase leaves a structured handoff for the next, and agents work from a compact brief instead of rereading the whole conversation, so round five costs about as many tokens as round one. Plan critics, verifiers and code reviewers start clean: they get the task and what to check, never the author's conversation, notes or evidence, so they judge the work and not the author's account of it.

### Roles

A role is a phase. An agent or runner has **one or more** roles and claims the tasks of any of them; an agent that names none gets every role but `verify`.

| Role | Claims tasks in | Does |
|---|---|---|
| `refine` | `draft` | Turns a rough draft into a ready task: testable criteria, type, risk, scope |
| `plan` | `plan_requested`, `plan_changes_requested` | Reads the repo and writes the plan with its validation plan; splits big work into subtasks |
| `plan_review` | `plan_review_requested` | Critiques plans (L2+); a low-risk plan it approves goes straight to coding |
| `code` | `ready_for_code`, `changes_requested` | Codes in the task worktree with tests and evidence, and commits |
| `verify` | `verify_requested` | Runs the verification commands (the server has a built-in verifier) |
| `review` | `code_review_requested` | Reviews the commits; the verdict routes the task |
| `pr` | `approved` | Pushes the branch and opens the PR |

Compose them to fit your models: a cheap, fast model with `["code", "pr"]` and a stronger one with `["plan", "plan_review", "review"]`, or one agent with every role plus a second one with `["review"]`. Nobody reviews their own plan or code. Agents are identified as `<tool>@<version>|<model>`, so every plan, commit and review is traceable to the exact tool and model that produced it.

### The board

| Column | Statuses |
|---|---|
| **Pending** | `draft`, `plan_requested`, `plan_changes_requested`, `plan_review_requested`, `ready_for_code`, `changes_requested`, `verify_requested`, `code_review_requested`, `approved` |
| **In progress** | `refining`, `planning`, `plan_reviewing`, `coding`, `verifying`, `reviewing`, `merging`, `split` |
| **Needs you** | `waiting_plan_review`, `waiting_code_review`, `needs_human`, `pr_open` |
| **Done** | `complete` |

### Writing a good task

A task is the prompt. The more precise it is, the better the result:

- **Description**: what to build and why.
- **Steer details**: technical direction (libraries to use, files to touch, patterns to follow).
- **Guardrails**: hard constraints. They win any conflict (`Do not change the public API`, `No new dependencies`).
- **Acceptance criteria**: the checklist the reviewer verifies.
- **Priority, branch and merge branch**: which task goes first, where the work lives and where the PR targets.

Let an agent write tasks for you with the `agentq-create-task` skill: *"Create an AgentQ task to add rate limiting to the API."*

## Runners (hands-free mode)

A runner is a worker inside the web server with a **tool**, one or more **roles**, an optional **project**, a **model**, a **concurrency** and a **permission mode**. Every few seconds it claims the next eligible task and launches the tool headless in the project directory.

- **Model and effort**: type any model id the tool accepts, or leave it empty to use the tool's default; pick an effort level for tools that have one.
- **Live logs**: follow every job's output from the Runners page.
- **`safe` mode** (default): file edits, a fixed allow-list of commands (`git`, `gh`, `bun`, `npm`...) and only the MCP tools the phase needs.
- **`full` mode**: no permission prompts and no sandbox. Use only on repositories you trust the agent with unattended.
- **Crash recovery without heartbeats**: the runner is the parent process. If the tool exits without submitting, the task goes back to the queue with a system note containing the last 30 lines of output, and the runner backs off (30 s, doubling up to 30 min) before retrying it.
- **Bring your own agent**: the `custom` tool runs any argv you give it, with the prompt as the last argument and in `$AGENTQ_PROMPT`. Custom runners (and `extraArgs` on any tool) run whatever command they are given, so the server accepts them only when started with `AGENTQ_ALLOW_CUSTOM_RUNNERS=1`.

Everything is also available over REST (`/api/runners`). See [docs/runner.md](docs/runner.md) for the exact commands, environment variables and a scripted demo.

## MCP tools

The `agentq` MCP server exposes the whole agent protocol as typed tools. In Claude Code they appear as `mcp__agentq__<tool>`.

| Tool | Purpose |
|---|---|
| `claim_task` | Atomically claim the highest-priority task one of your roles works (`roles` is optional: all but `verify`) |
| `get_task_brief` | The compact brief to continue a task: approved plan, criteria, open findings, latest handoff per phase, commands, limits and rounds left (critics, verifiers and reviewers get an independent one) |
| `get_task`, `list_tasks` | Read a task with its project, conversation, findings, evidence and handoffs, or list task summaries |
| `submit_refinement` | Make a draft ready: criteria, type, risk, scope, open questions |
| `submit_plan` | Submit a plan with its validation plan and an answer to every open plan finding |
| `create_subtask` | Split the task being planned into held subtasks, ordered with `blockedBy` |
| `submit_plan_review` | Submit a plan critique: a verdict and findings |
| `submit_code` | Submit the worktree with evidence per criterion; the task goes to verification or review |
| `submit_verification` | Report a verification run (the `verify` role; the server also has a built-in verifier) |
| `submit_review` | Submit code review findings with an approve, request_changes or needs_human verdict |
| `submit_pr` | Record the pull request the `pr` role opened (`submit_merge` is its deprecated alias) |
| `report_blocker` | Stop with a reason and one concrete question: the task goes to **needs_human** |
| `heartbeat` | Extend the lease of a claim made by a hand-opened session |
| `post_comment` | Add a note to a task without changing its status |
| `get_skill` | Read the current text and version of an AgentQ skill |
| `list_projects`, `create_task` | Create well-formed tasks |
| `archive_task` | Archive a complete task to Markdown |

Every `submit_*` call takes a `context` (required on all but `submit_verification`): short handoff notes for the agent of the next phase, with optional `decisions`, `risks` and `next` lists. Resources `agentq://task/{taskId}`, `agentq://projects` and `agentq://skills/{name}` are also available, and the skills are registered as prompts. Full inputs and outputs are in [docs/mcp.md](docs/mcp.md).

## Skills

Skills are the playbooks agents follow in each phase. `bun run install:skills` copies them into your tools' skill folders. Run `bun run install:all` (skills and MCP registration) again, and restart your tools, after updating AgentQ: the server refuses skills older than the bundle it supports, and any claim without `skillsVersion` (6.0.0 replaced the single `role` with a `roles` list named after the phases). Copies in folders the installer does not manage, such as `~/.agents/skills`, are not updated: delete them.

| Skill | What it does |
|---|---|
| `agentq-claim` | Entry point. Claims a task and routes to the phase skill that matches its status, then loops until the queue is empty |
| `agentq-refine` | Turns a draft into a ready task: testable criteria, type, risk, scope |
| `agentq-plan` | Reads the repo read-only and writes or revises the plan |
| `agentq-plan-review` | Critiques a plan with a verdict and findings |
| `agentq-code` | Implements in `{project}/.agentq/worktrees/{taskId}` and commits after every round. Never pushes |
| `agentq-verify` | Runs the verification commands and reports evidence (the server also has a built-in verifier) |
| `agentq-review` | Reviews the commits read-only against acceptance criteria and guardrails |
| `agentq-pr` | Pushes the feature branch and opens a PR with `gh` and AgentQ's PR body. Never merges, never force-pushes |
| `agentq-create-task` | Turns a loose request into a well-structured task |
| `agentq-archive` | Archives complete tasks, finds the PR with `gh`, and writes an overview of what was done |

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | Port for the API and the dashboard |
| `AGENTQ_HOST` | `127.0.0.1` | Address the server listens on (`0.0.0.0` for every interface: anyone who reaches it can drive AgentQ) |
| `AGENTQ_ALLOWED_HOSTS` | none | Comma-separated host names the API answers to besides `localhost` and IP addresses (e.g. `my-mac.local`) |
| `AGENTQ_ALLOW_CUSTOM_RUNNERS` | off | `1` allows runners that execute their own argv: tool `custom`, or `extraArgs` on any tool |
| `AGENTQ_DB_PATH` | `~/.agentq/agentq.db` | SQLite database used by the server, the MCP server and every runner job |
| `AGENTQ_HOME` | `~/.agentq` | Where runner prompts, MCP configs and job logs are written (`runs/<taskId>/`) |
| `AGENTQ_JOB_TIMEOUT_MIN` | `60` | Kill a runner job that runs longer than this and release its task |
| `AGENTQ_PR_SYNC_SEC` | `180` | How often the server asks `gh` about open PRs (`AGENTQ_PR_SYNC=0` turns it off) |
| `AGENTQ_PR_SYNC_TIMEOUT_SEC` | `30` | Kill a `gh` call of the PR sync that runs longer than this (the sync never blocks the server) |
| `AGENTQ_VERIFY_WORKER` | on | `0` turns the server's built-in verifier off |
| `AGENTQ_MAX_REVERTS` | `3` | Consecutive runner jobs that end without submitting before the task goes to **needs_human** |

Point the MCP server at another database with `bun run install:mcp --db <path>`.

## Architecture

```
agent-task-queue/
├── packages/
│   ├── shared/      # SQLite database, types, workflow rules: the single source of truth
│   ├── mcp/         # MCP server (stdio): the agent protocol as typed tools
│   ├── web/         # Bun HTTP server: REST API, SSE, static UI, runner engine, verifier, PR sync
│   ├── web-ui/      # React dashboard
│   └── installer/   # install:mcp and install:skills for every supported tool
├── skills/          # agentq-claim, the phase skills (-refine, -plan, -plan-review, -code, -verify, -review, -pr), -create-task, -archive
├── design-system/   # Tokens, components and logos used by the dashboard
└── docs/            # Architecture, autonomy and routing, MCP, runners
```

**Stack:** Bun · TypeScript · SQLite (`bun:sqlite`) · Zod · MCP TypeScript SDK · React 19 · Vite · Tailwind CSS · TanStack Query · Server-Sent Events.

## Development

```bash
bun run dev          # server + Vite HMR on a single port
bun test             # all tests; they use in-memory or temp databases, never ~/.agentq/agentq.db
bun run typecheck    # every package
bun run lint         # ESLint
bun run format       # Prettier
bun run mcp          # the MCP server on stdio, as coding tools start it
```

The installer's end-to-end test runs the real `install:all` against a throwaway home folder on Linux, macOS and Windows in CI.

## FAQ

<details>
<summary><b>Does AgentQ send my code or tasks anywhere?</b></summary>

No. AgentQ is a local Bun process and a SQLite file. The only network traffic comes from the coding agents themselves (calls to their model provider) and from `git push` and `gh`: `gh pr create` in the PR phase, and `gh pr view` when the server checks your open pull requests.
</details>

<details>
<summary><b>Do agents need the web server running?</b></summary>

No. The MCP server writes directly to the database, and the dashboard picks up agent changes as soon as it is open. Whatever lives inside the web server needs it: runners, the built-in verifier (without it, code goes to review marked as not verified), the PR sync and the sweeper that returns expired claims to the queue.
</details>

<details>
<summary><b>Can several agents work at the same time?</b></summary>

Yes. Claims are atomic, each task gets its own git worktree and feature branch, and every runner has a configurable concurrency.
</details>

<details>
<summary><b>What happens if an agent crashes halfway through?</b></summary>

With a runner, the task is released back to its previous status automatically, with the tail of the output attached as a note, and after three runs in a row that end without a submit it goes to you. A hand-opened session holds its claim as a lease (90 minutes by default, per project): every AgentQ call from it extends the lease, `heartbeat` does so during long silent work, and when it expires the server returns the task to the queue. You can also click **Unblock** on the task page.
</details>

<details>
<summary><b>Will an agent merge into my main branch?</b></summary>

No. The PR phase pushes the feature branch and opens a pull request into the task's merge branch. Merging the PR is up to you, unless you turn on **auto-merge** for a project (level L3, off by default): then the server merges a pull request that is green, low risk and still at the commit the review approved.
</details>

<details>
<summary><b>Can I use a model or tool that is not listed?</b></summary>

Yes. Any MCP client can use the `agentq` server (start it with `bun run mcp`), and the `custom` runner tool launches any command you want (start the server with `AGENTQ_ALLOW_CUSTOM_RUNNERS=1` to allow it).
</details>

## Documentation

- [docs/policy.md](docs/policy.md): autonomy levels, routing after each submission, escalations, separation of duties, the PR sync and every project setting
- [docs/mcp.md](docs/mcp.md): MCP server setup, every tool and its inputs
- [docs/runner.md](docs/runner.md): runners, commands per tool, permission modes, REST API, demo script
- [docs/architecture.md](docs/architecture.md): features, components, domain entities and task states
- [design-system/README.md](design-system/README.md): the dashboard's design system

## Contributing

Contributions are welcome, from typo fixes to new runner tools.

1. Fork the repository and create a branch from `main`.
2. Make your change, with tests when it touches behavior.
3. Run `bun test`, `bun run typecheck` and `bun run lint`.
4. Open a pull request describing what changed and why.

Found a bug or have an idea? [Open an issue](https://github.com/sergiowero/agent-task-queue/issues).

## Support the project

If AgentQ saves you from babysitting agents, **give it a star**. It helps other developers find it.

[![Star History Chart](https://api.star-history.com/svg?repos=sergiowero/agent-task-queue&type=Date)](https://star-history.com/#sergiowero/agent-task-queue&Date)

## License

AgentQ is released under the [MIT License](LICENSE).

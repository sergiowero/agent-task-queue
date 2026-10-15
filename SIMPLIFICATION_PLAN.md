# MoonlightQ — plan de simplificación (v3)

## Requerimientos

1. Board con mis tareas.
2. Ver qué agentes están trabajando.
3. Runners que sigan aceptando las tools actuales (`claude`, `codex`, `opencode`, `gemini`, `copilot`, `custom`), siempre con bypass de permisos.
4. Cuando una tarea necesita de mí: al abrirla, arriba de todo dice exactamente qué tengo que hacer.
5. Responder las preguntas de los agentes directo en la UI.
6. Las tools hablan directo con el MCP; **1 skill** con las instrucciones.
7. Sin autonomy levels: siempre el máximo nivel de autonomía.
8. Conversación, handoffs e historial en cada tarea.
9. La estructura de la tarea se queda como está.
10. MCP mínimo: crear, reclamar, planear, revisar.
11. API REST completa: todo lo que hace la UI se puede hacer por API.
12. Dos flujos cortos, fijados al crear la tarea:
    - **Directo:** creada → refine (opcional) → code → review → merge
    - **Con plan:** creada → refine (opcional) → plan → review → code → review → merge
13. Una tarea no puede cambiar de flujo después de creada.

## Hoy

~53k líneas (27k producto, 14k tests, ~9k docs/research/design-system). Lo que más pesa: 23 estados, 7 roles, 4 niveles de autonomía, riesgo, verifier, findings por id, evidence, PR sync, archive, matriz de permisos por rol. Todo eso se va.

## Flujo nuevo

### Estados (8, antes 23)

El estado es la **fase**; si alguien la tiene reclamada se ve en `assignedAgent`, no en un estado aparte.

| Estado | Qué pasa | Quién lo toma |
|---|---|---|
| `refine` | Afinar descripción y criterios | rol `refine` |
| `plan` | Escribir el plan | rol `plan` |
| `plan_review` | Revisar el plan | rol `review` |
| `code` | Implementar en el worktree | rol `code` |
| `code_review` | Revisar el código (corre los tests) | rol `review` |
| `merge` | Push, abrir PR y mergear con `gh` | rol `merge` |
| `needs_human` | Esperando una respuesta mía | yo |
| `done` | Mergeado | — |

### Transiciones

```
directo:   [refine] → code → code_review → merge → done
con plan:  [refine] → plan → plan_review → code → code_review → merge → done

plan_review  ── changes ──▶ plan
code_review  ── changes ──▶ code
merge        ── no puede mergear ──▶ needs_human
cualquier fase ── pregunta / límite ──▶ needs_human ── respondo ──▶ vuelve a la misma fase
```

- `flow: "direct" | "planned"` y `refine: boolean` se eligen al crear y son **inmutables** (la API rechaza cambiarlos; la tabla de transiciones depende del flujo, así que no hay manera de saltar a otro).
- Toda la lógica es **una tabla de transiciones** por flujo (~150 líneas) en lugar de `workflow.ts` (2.7k).
- Máxima autonomía = nadie humano en el camino feliz: el review lo hace un agente y el agente de `merge` mergea.

### Merge con `gh`

El agente de `merge`, en el worktree de la tarea:

1. `git push -u origin <branch>`
2. `gh pr create --base <mergeBranch>` con el resumen de la tarea
3. `gh pr checks --watch` y luego `gh pr merge --squash --delete-branch`
4. `submit_work { prUrl, mergedSha }` → `done`

Si no puede en cualquier paso (`gh` no está o no tiene sesión, push rechazado, conflictos, checks rojos, branch protegida, PR que necesita aprobación) llama `ask_human` con el error y la tarea pasa a `needs_human` (`kind: "merge_failed"`). Desde el banner puedo: **reintentar merge**, **mandar a code** con instrucciones, o **marcar como mergeado** si lo hice yo a mano.

### Cuándo me necesita una tarea (`needs_human`)

Solo tres casos:

1. **Un agente pregunta** (`ask_human`): me muestra la pregunta.
2. **Límite de rondas**: 3 rondas de "changes" en el mismo review, o el runner falla 3 veces seguidas en la tarea.
3. **El merge no se pudo hacer** con `gh`.

El servidor calcula un campo `actionRequired` en la tarea:

```ts
actionRequired: {
  kind: "question" | "review_limit" | "runner_failures" | "merge_failed",
  title: string,      // "El agente pregunta: ¿usamos Zod o Valibot?"
  detail: string,     // contexto: último review, últimas 30 líneas de log, etc.
  phase: Phase,       // a dónde vuelve cuando respondo
  actions: ("answer" | "send_back" | "skip_review" | "retry_merge" | "mark_merged" | "cancel")[]
} | null
```

La UI lo pinta como **banner fijo arriba de la tarea** con una caja de respuesta. Responder = `POST /api/tasks/:id/answer { message }`: se guarda en la conversación y como handoff `human`, y la tarea vuelve a la fase de donde vino. Por API se puede hacer exactamente lo mismo.

### Separación: por sesión, no por runner

Regla obligatoria: **una sesión nunca revisa su propio trabajo** (el reviewer del plan ≠ la sesión que lo escribió; el del código ≠ la sesión que lo codeó, en ninguna ronda).

- La identidad es la **sesión**, no el runner. Un runner con roles `code` + `review` sí puede revisar lo que codeó, porque cada job es una sesión nueva.
- **Las sesiones nunca se reutilizan.** Cada job de runner arranca la tool en limpio: ningún adapter pasa `--resume`, `--continue`, `resume <id>` ni similares, y el adapter genera un session id nuevo por job (`runner:<runnerId>:job:<jobId>`). Hay un test por adapter que lo verifica.
- Sesiones interactivas: identidad = `session:<tool>:<sessionId>` que manda `claim_task`. Si la misma sesión intenta reclamar el review de su propio trabajo, `claim_task` se la salta y le da otra tarea (o ninguna).
- `task.authors = { plan: string[], code: string[] }` guarda todas las sesiones autoras de cada fase; el claim de review excluye esas identidades.
- Con un solo runner el flujo completo funciona sin esperar a nadie.

## Tarea

La estructura queda como está en lo que escribo yo: `title`, `description`, `steerDetails`, `guardrails`, `acceptanceCriteria`, `nonGoals`, `references`, `priority`, `type`, `recommendedBranch`, `mergeBranch`, `projectId`, `parentId`, `blockedBy`.

Se agregan: `flow`, `refine`.

Se quitan los campos de las features eliminadas: `autonomy`, `risk`, `riskReasons`, `verification`, `verifyFailures`, `roundBaseline`, `validationPlan`, `approvedPlan`, `approval`, `dorIssues`, `held`, `producers` (se reemplaza por `authors: { plan: string[], code: string[] }`), `archivedAt`, `archivePath`, `diffStats`, `commits` (queda `headSha`), `planSubmission` (el plan vive en la conversación + `plan: string`).

Conversación, handoffs e historial se mantienen tal cual (`conversation_entries`, `task_handoffs`, `status_history`).

## MCP mínimo (6 tools)

| Tool | Para qué |
|---|---|
| `create_task` | Crear tarea (con `flow` y `refine`) |
| `claim_task` | Reclamar la siguiente tarea para mis roles; devuelve tarea + últimos handoffs + conversación + la sección del skill de esa fase |
| `submit_plan` | Entregar el plan (`plan`, `message`, `handoff`) |
| `submit_review` | Revisar plan o código (`verdict: approve \| changes`, `findings`, `handoff`) |
| `submit_work` | Entregar refine, code o merge (`message`, `handoff`, `headSha` / `prUrl`) |
| `ask_human` | Pasar a `needs_human` con una pregunta |

Se van: `heartbeat` (el lease se renueva con cualquier llamada MCP), `get_task`, `get_task_brief`, `list_tasks`, `post_comment`, `create_subtask`, `add/remove_dependency`, `archive_task`, `list_projects`, `get_skill`, `submit_refinement/verification/code/merge/pr/plan_review` (absorbidos arriba).

Cada submit lleva `claimToken` y `handoff: { summary, decisions[], risks[], next[] }`.

### 1 skill

`moonlightq` — un solo documento con: protocolo (claim → trabajar → submit, cuándo preguntar) + una sección corta por fase (refine, plan, review, code, merge). Se sirve como prompt/resource MCP y `claim_task` incluye la sección de la fase. Reemplaza los 8 skills actuales.

## API REST completa

Todo lo de la UI:

- **Projects:** `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id`
- **Tasks:** `GET /api/tasks?project&status`, `POST /api/tasks`, `GET/PATCH/DELETE /api/tasks/:id` (PATCH rechaza `flow`/`refine`)
- **Acciones de tarea:** `POST /api/tasks/:id/answer`, `/send-back`, `/skip-review`, `/retry-merge`, `/mark-merged`, `/cancel`, `/release` (soltar un claim colgado), `/comments`
- **Historia:** `GET /api/tasks/:id/conversation`, `/handoffs`, `/history`
- **Agentes:** `GET /api/agents` (con tarea y fase actual de cada uno)
- **Runners:** `GET/POST /api/runners`, `PATCH/DELETE /api/runners/:id`, `POST /api/runners/:id/start|stop`, `GET /api/runners/:id/jobs`, `GET /api/runners/:id/jobs/:job/log`
- **Tools:** `GET /api/tools` (instaladas / registradas), `POST /api/tools/:tool/install`
- **Meta + eventos:** `GET /api/meta`, `GET /api/events` (SSE)

La UI usa solo esta API. El guard de localhost (Origin/Host) se mantiene.

## Runners

- Tools: `claude`, `codex`, `opencode`, `gemini`, `copilot`, `custom` (este sigue detrás de `MOONLIGHTQ_ALLOW_CUSTOM_RUNNERS=1`).
- **Siempre bypass:** `claude --dangerously-skip-permissions`, `codex --dangerously-bypass-approvals-and-sandbox`, `copilot --allow-all`, `gemini --yolo`, opencode sin restricciones. Se va `safe` mode, `permissions.ts` y la matriz por rol.
- Un adapter por tool (`runners/tools/<tool>.ts`: binario, args, config MCP). Un solo template de prompt.
- **Sesión nueva por job, siempre.** Nunca `--resume`/`--continue`; cada job tiene su propio session id (ver Separación).
- Al arrancar un runner con rol `merge`, el servidor revisa `gh auth status` y avisa en la página de Runners si falla.
- Config: tool, roles (`refine`, `plan`, `review`, `code`, `merge`), modelo, effort, proyectos, concurrencia.
- Si la tool sale sin submit: la tarea vuelve a su fase con las últimas 30 líneas de log en la conversación; backoff 30 s → 30 min; 3 fallos seguidos → `needs_human`.

## UI (6 páginas)

| Página | Qué tiene |
|---|---|
| **Board** | Columnas por estado; cada card muestra el agente que la tiene. `needs_human` es la primera columna. |
| **Task** | Banner `actionRequired` arriba con caja de respuesta. Detalle, plan, tabs Conversación / Handoffs / Historial. |
| **Agents** | Quién está trabajando ahora, en qué tarea y fase, última actividad. |
| **Runners** | Crear/editar, start/stop, logs en vivo. |
| **Projects** | Nombre, path, merge branch. |
| **Tools** | Tools instaladas y registradas en el MCP, botón instalar. |

Se van: Activity, Inbox (es la columna `needs_human`), InstallTool (dentro de Tools). CSS simple, sin design system.

## Se mantiene

- `tools/moonlightq-monitor` (el servidor conserva `/api/meta`, `/api/agents`, `/api/runners` con las mismas formas; se le quitan los checks de verifier y PR sync).
- `packages/installer` (`install:all` registra el MCP en todas las tools; se va `remove-skills`).
- `shared/git.ts`, el bootstrap del MCP, el spawn/log de runners, SSE, componentes de board/modal.

## Se elimina

- `research/`, `design-system/`, `scripts/`, `packages/cli/` (vacío), `.opencode/`, `.agentq/`
- `docs/master-prompt.md`, `docs/policy.md`, `docs/project-spec.md`
- shared: `archive`, `brief` (queda una función chica en `claim`), `catalog`, `criteria`, `decisions`, `diff`, `dor`, `metrics`, `policy`, `profile`, `separation` (queda una regla), `verifier`, `records`, `skills` (pasa a 1 archivo)
- web: `pr-sync`, `runner/verify`, `runner/permissions`
- Tablas: `activity` (cubierto por `status_history`), `task_findings`, `task_evidence`, `app_state`

## Pasos

Rama nueva `simple`, tag `v0-full` en `main` para no perder nada. Base de datos nueva (`~/.moonlightq/moonlightq-v2.db`), sin migración.

1. **Cortar** lo de "Se elimina".
2. **Core** (`packages/shared`, ~1.2k): tipos, schema (7 tablas), tabla de transiciones por flujo, `claim` atómico, `actionRequired`, separación por sesión. Tests de transiciones (los dos flujos, inmutabilidad del flujo, límites → `needs_human`, respuesta → vuelve a la fase, merge fallido → `needs_human`), de separación (misma sesión no puede reclamar su review; otra sesión del mismo runner sí) y de carrera de claims.
3. **MCP** (~500): 6 tools + 1 skill. Test por tool.
4. **API** (~800): todos los endpoints de arriba + SSE. Tests de API.
5. **Runners** (~900): loop + 6 adapters con bypass y sesión nueva por job. Tests de args por tool (bypass presente, ningún flag de resume).
6. **Installer**: quitar `remove-skills`, registrar solo el skill único.
7. **UI** (~3.5k): 6 páginas, banner de acción.
8. **Monitor**: quitar checks de verifier/PR sync, actualizar fixtures, probar contra el servidor nuevo.
9. **Docs**: README < 200 líneas, `architecture.md`, `runner.md`, `mcp.md`.

Objetivo: ~7k líneas de producto + ~3k de tests (desde ~41k).

## Decisiones tomadas

1. **Merge:** el agente mergea con `gh`; si no puede, `needs_human`.
2. **Review ≠ autor:** obligatorio, por sesión. Un solo runner alcanza porque cada job es una sesión nueva; las sesiones nunca se reutilizan.
3. **Límite:** 3 rondas de changes (o 3 fallos del runner) → `needs_human`.
4. **Subtareas y dependencias:** en la tarea y la API, no en el MCP.
5. **Reescritura en rama nueva** `simple`; `main` queda con tag `v0-full`.

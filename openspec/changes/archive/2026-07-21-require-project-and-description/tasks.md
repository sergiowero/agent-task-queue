## 1. Backend Validation

- [x] 1.1 Add app-level validation in `createTask()` to require `projectId`
- [x] 1.2 Validate `projectId` in `POST /api/tasks` handler — return 400 if missing
- [x] 1.3 Validate `description` is present in `POST /api/tasks` handler — return 400 if missing

## 2. CLI

- [x] 2.1 Add `--project <id>` as `requiredOption` to `atq create` command
- [x] 2.2 Pass `projectId` to `createTask()` in the CLI action handler
- [x] 2.3 Update `printTask()` to show project name and displayName
- [x] 2.4 Add project object to JSON output in `list`, `create`, `get` commands
- [x] 2.5 Add project object to JSON output in all `submit-*` commands
- [x] 2.6 Add project object to JSON output in `claim` command (already partial)

## 3. Web UI — CreateTaskModal

- [x] 3.1 Add project dropdown (required) — fetches projects, pre-selects from URL filter
- [x] 3.2 Make description field required (disable create button when empty)
- [x] 3.3 Add merge branch input field with default value "develop"
- [x] 3.4 Pass `projectId` and `description` in the `api.createTask()` call

## 4. Verification

- [x] 4.1 Test: create task via modal with all fields — succeeds
- [x] 4.2 Test: create task via modal without project — button disabled
- [x] 4.3 Test: create task via modal without description — button disabled
- [x] 4.4 Test: create task via CLI without `--project` — shows error
- [x] 4.5 Test: create task via API without `projectId` — returns 400
- [x] 4.6 Test: CLI text output includes project name and displayName
- [x] 4.7 Test: CLI JSON output includes full project object

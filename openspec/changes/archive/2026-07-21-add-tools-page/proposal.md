## Why

Users need a centralized place to access ATQ utilities from the web UI. Currently, installing the CLI binary or distributing skills requires manual terminal commands. A Tools page makes these operations discoverable and accessible directly from the browser.

## What Changes

- Add a new `/tools` page with cards for each available tool
- Each card links to a dedicated tool page with specific functionality
- First tool: **Install ATQ** — executes the install script (CLI binary + skills) or displays the skills file content for manual copy
- New sidebar navigation entry for Tools

## Capabilities

### New Capabilities

- `tools-page`: Main tools listing page with card-based navigation to individual tool pages
- `install-tool`: Tool page that runs the ATQ install script or shows skills file content for manual installation

### Modified Capabilities

_(none)_

## Impact

- **Frontend**: New page component, route, and nav entry in `packages/web-ui`
- **Backend**: New API endpoint to execute install script or serve skills file content
- **No breaking changes** — purely additive

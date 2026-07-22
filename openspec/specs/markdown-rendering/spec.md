# Markdown Rendering

Core markdown rendering component for displaying formatted text in the UI.

## Requirements

### Requirement: Render markdown content
The system SHALL render markdown-formatted text in conversation entry messages using a dedicated markdown rendering component.

#### Scenario: Render plain text message
- **WHEN** a conversation entry message contains plain text without markdown syntax
- **THEN** the message renders as formatted text with preserved whitespace

#### Scenario: Render bold text
- **WHEN** a conversation entry message contains `**bold text**`
- **THEN** the message renders "bold text" in bold font weight

#### Scenario: Render italic text
- **WHEN** a conversation entry message contains `*italic text*`
- **THEN** the message renders "italic text" in italic font style

#### Scenario: Render inline code
- **WHEN** a conversation entry message contains `` `code` ``
- **THEN** the message renders "code" in a monospace font with distinct styling

#### Scenario: Render code block
- **WHEN** a conversation entry message contains a fenced code block with language hint
- **THEN** the message renders the code with syntax highlighting and a distinct code block container

#### Scenario: Render unordered list
- **WHEN** a conversation entry message contains lines starting with `- ` or `* `
- **THEN** the message renders a bulleted list

#### Scenario: Render ordered list
- **WHEN** a conversation entry message contains lines starting with `1. `, `2. `, etc.
- **THEN** the message renders a numbered list

#### Scenario: Render link
- **WHEN** a conversation entry message contains `[text](url)`
- **THEN** the message renders a clickable link with the specified URL

#### Scenario: Render heading
- **WHEN** a conversation entry message contains `# Heading`
- **THEN** the message renders the heading with appropriate size and weight

#### Scenario: Render blockquote
- **WHEN** a conversation entry message contains `> quoted text`
- **THEN** the message renders the text as a blockquote with visual indentation

### Requirement: Support GitHub Flavored Markdown
The system SHALL support GitHub Flavored Markdown (GFM) extensions including tables, task lists, and strikethrough.

#### Scenario: Render table
- **WHEN** a conversation entry message contains a markdown table
- **THEN** the message renders the table with proper alignment and borders

#### Scenario: Render task list
- **WHEN** a conversation entry message contains `- [ ] unchecked` or `- [x] checked`
- **THEN** the message renders checkboxes with appropriate checked/unchecked state

#### Scenario: Render strikethrough
- **WHEN** a conversation entry message contains `~~deleted text~~`
- **THEN** the message renders "deleted text" with strikethrough decoration

### Requirement: Safe rendering
The system SHALL render markdown safely without executing raw HTML or scripts.

#### Scenario: Sanitize HTML in message
- **WHEN** a conversation entry message contains `<script>alert('xss')</script>`
- **THEN** the message renders the text literally without executing the script

#### Scenario: Disable raw HTML by default
- **WHEN** a conversation entry message contains `<div onclick="evil()">content</div>`
- **THEN** the message renders the text literally without interpreting HTML tags

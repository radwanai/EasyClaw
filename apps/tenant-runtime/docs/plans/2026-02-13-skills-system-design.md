# Skills System Design

Harvey gets the ability to create reusable skill files instead of modifying core bot code. Skills are hot-loaded — no restart needed.

## Skill Format

Each skill is a `.js` file in `/app/skills/` exporting:

```js
module.exports = {
  name: "tool_name",           // unique, snake_case
  description: "What it does", // shown to Claude as tool description
  input_schema: { ... },       // standard JSON schema
  async execute(input) { ... } // returns object or throws
};
```

One tool per file. Filename matches skill name (e.g. `get_weather.js`).

## New Harvey Tools

| Tool | Purpose |
|------|---------|
| `create_skill` | Write skill to `skills/`, syntax-check, hot-load |
| `test_skill` | Run a skill with test input, return output or error |
| `list_skills` | List all loaded skills and descriptions |
| `edit_skill` | Read existing skill content for modification, then rewrite |
| `delete_skill` | Remove and unload a skill |

Existing `read_file`, `write_file`, `run_shell` stay available for general use.

## Skill Loader (core.js changes)

- On boot: scan `skills/*.js`, require each, merge into Harvey's tool list
- `create_skill` tool: write file, `node --check`, require with cache-bust, add to tools
- `edit_skill` tool: read file content back, allow rewrite, re-validate, reload
- `delete_skill` tool: remove from tools array, delete file
- Each `execute()` call wrapped in try/catch — bad skill = error response, not crash
- Skills directory: `/app/skills/` (persisted via Docker volume)

## Safety

- Skills can only be written to `skills/` directory
- Syntax validated before loading (`node --check`)
- Runtime errors caught per-invocation
- Core files (`core.js`, `index.js`, `harvey.js`, etc.) are never modified
- Harvey only — Laura does not get skill tools

## Docker Changes

- Add `./skills:/app/skills` volume mount in docker-compose.yml
- Skills persist across container restarts

## System Prompt Update

Harvey's prompt updated to reference skill creation instead of raw file editing for self-improvement.

## Files Changed

1. `core.js` — Add skill loader, skill management functions, wire into tool dispatch
2. `harvey.js` — Add skill tools (create/test/list/edit/delete), update system prompt
3. `docker-compose.yml` — Add skills volume mount

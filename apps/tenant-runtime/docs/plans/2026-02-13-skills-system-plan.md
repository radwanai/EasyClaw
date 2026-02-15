# Skills System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give Harvey the ability to create, test, and manage reusable skill files that hot-load as new tools — without restarting the bot or touching core files.

**Architecture:** Skills are `.js` files in a `skills/` directory. Each exports `{ name, description, input_schema, execute() }`. A skill loader in `core.js` scans the directory on boot and exposes functions to create/load/unload skills at runtime. Harvey gets 5 new tools (`create_skill`, `test_skill`, `list_skills`, `edit_skill`, `delete_skill`) that manage skills through these loader functions. Skill `execute()` calls are always wrapped in try/catch so a broken skill returns an error, never crashes the bot.

**Tech Stack:** Node.js, existing `core.js` tool system, `child_process.execSync` for syntax validation

---

### Task 1: Docker volume mount for skills persistence

**Files:**
- Modify: `docker-compose.yml:11-12`

**Step 1: Add skills volume**

In `docker-compose.yml`, add a second volume mount under the existing `./data:/app/data` line:

```yaml
    volumes:
      - ./data:/app/data
      - ./skills:/app/skills
```

**Step 2: Create the skills directory locally**

Run: `mkdir -p /Users/samehradwan/clawdbot/skills`

**Step 3: Commit**

```bash
git add docker-compose.yml skills/
git commit -m "feat: add skills directory with Docker volume mount"
```

---

### Task 2: Skill loader functions in core.js

**Files:**
- Modify: `core.js:10-11` (add SKILLS_DIR constant after DATA_DIR)
- Modify: `core.js:141` (add skill system section before Shell & File Tools)
- Modify: `core.js:823` (update module.exports)

**Step 1: Add SKILLS_DIR constant**

After line 11 (`if (!fs.existsSync(DATA_DIR))...`), add:

```js
const SKILLS_DIR = path.resolve("/app/skills");
if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true });
```

**Step 2: Add skill system section**

Before the `// ─── Shell & File Tools` comment (line 141), add the full skill system:

```js
// ─── Skill System ────────────────────────────────────

const loadedSkills = new Map();

function loadSkillFromFile(filePath) {
  const resolved = path.resolve(filePath);
  delete require.cache[resolved];
  const skill = require(resolved);
  if (!skill.name || typeof skill.name !== "string") throw new Error("Skill missing 'name' string");
  if (!skill.description || typeof skill.description !== "string") throw new Error("Skill missing 'description' string");
  if (!skill.input_schema || typeof skill.input_schema !== "object") throw new Error("Skill missing 'input_schema' object");
  if (!skill.execute || typeof skill.execute !== "function") throw new Error("Skill missing 'execute' function");
  if (!/^[a-z][a-z0-9_]*$/.test(skill.name)) throw new Error(`Skill name '${skill.name}' must be lowercase snake_case`);
  return { ...skill, filePath: resolved };
}

function loadAllSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return;
  const files = fs.readdirSync(SKILLS_DIR).filter(f => f.endsWith(".js"));
  for (const file of files) {
    try {
      const skill = loadSkillFromFile(path.join(SKILLS_DIR, file));
      loadedSkills.set(skill.name, skill);
      console.log(`  [Skills] Loaded: ${skill.name} (${file})`);
    } catch (err) {
      console.error(`  [Skills] Failed to load ${file}: ${err.message}`);
    }
  }
  console.log(`  [Skills] ${loadedSkills.size} skill(s) loaded`);
}

function validateSkillSyntax(filePath) {
  try {
    execSync(`node --check "${filePath}"`, { encoding: "utf-8", timeout: 5000 });
    return { valid: true };
  } catch (err) {
    return { valid: false, error: err.stderr || err.message };
  }
}

function createSkill(name, code) {
  const filePath = path.join(SKILLS_DIR, `${name}.js`);
  if (loadedSkills.has(name)) return { error: `Skill '${name}' already exists. Use edit_skill to modify it.` };
  fs.writeFileSync(filePath, code);
  const syntaxResult = validateSkillSyntax(filePath);
  if (!syntaxResult.valid) {
    fs.unlinkSync(filePath);
    return { error: `Syntax error — skill not saved:\n${syntaxResult.error}` };
  }
  try {
    const skill = loadSkillFromFile(filePath);
    loadedSkills.set(skill.name, skill);
    console.log(`[Skills] Created: ${skill.name}`);
    return { created: true, name: skill.name, description: skill.description };
  } catch (err) {
    fs.unlinkSync(filePath);
    return { error: `Skill validation failed — not loaded:\n${err.message}` };
  }
}

function editSkill(name, code) {
  if (!loadedSkills.has(name)) return { error: `Skill '${name}' not found` };
  const skill = loadedSkills.get(name);
  const filePath = skill.filePath;
  if (!code) {
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      return { name, content, path: filePath };
    } catch (err) {
      return { error: `Failed to read skill: ${err.message}` };
    }
  }
  const backup = fs.readFileSync(filePath, "utf-8");
  fs.writeFileSync(filePath, code);
  const syntaxResult = validateSkillSyntax(filePath);
  if (!syntaxResult.valid) {
    fs.writeFileSync(filePath, backup);
    return { error: `Syntax error — reverted to previous version:\n${syntaxResult.error}` };
  }
  try {
    const updated = loadSkillFromFile(filePath);
    loadedSkills.set(updated.name, updated);
    console.log(`[Skills] Updated: ${updated.name}`);
    return { updated: true, name: updated.name, description: updated.description };
  } catch (err) {
    fs.writeFileSync(filePath, backup);
    try { loadedSkills.set(name, loadSkillFromFile(filePath)); } catch {}
    return { error: `Validation failed — reverted:\n${err.message}` };
  }
}

function deleteSkill(name) {
  if (!loadedSkills.has(name)) return { error: `Skill '${name}' not found` };
  const skill = loadedSkills.get(name);
  try { fs.unlinkSync(skill.filePath); } catch (err) {
    return { error: `Failed to delete file: ${err.message}` };
  }
  loadedSkills.delete(name);
  console.log(`[Skills] Deleted: ${name}`);
  return { deleted: true, name };
}

function listSkills() {
  if (loadedSkills.size === 0) return { skills: "none" };
  return {
    skills: Array.from(loadedSkills.values()).map(s => ({
      name: s.name, description: s.description, file: path.basename(s.filePath),
    })),
  };
}

function getSkillToolDefs() {
  return Array.from(loadedSkills.values()).map(s => ({
    name: `skill_${s.name}`,
    description: `[Skill] ${s.description}`,
    input_schema: s.input_schema,
  }));
}

async function executeSkill(name, input) {
  const skill = loadedSkills.get(name);
  if (!skill) return { error: `Skill '${name}' not found` };
  try {
    return await skill.execute(input);
  } catch (err) {
    return { error: `Skill '${name}' failed: ${err.message}` };
  }
}
```

**Step 3: Update module.exports (line 823)**

Change:
```js
module.exports = { createBot, executeWebSearch, executeCode, executeShell, readFile, writeFile, saveNote, readNotes, DATA_DIR, isAuthorized };
```

To:
```js
module.exports = { createBot, executeWebSearch, executeCode, executeShell, readFile, writeFile, saveNote, readNotes, DATA_DIR, isAuthorized, loadAllSkills, createSkill, editSkill, deleteSkill, listSkills, getSkillToolDefs, executeSkill, loadedSkills };
```

**Step 4: Commit**

```bash
git add core.js
git commit -m "feat: add skill loader with create/edit/delete/test/list"
```

---

### Task 3: Wire skill tools into the bot's tool dispatch

**Files:**
- Modify: `core.js:228` (allTools — add dynamic skill getter)
- Modify: `core.js:382` (askClaude — use dynamic tools in API call)
- Modify: `core.js:346-349` (executeTool — handle skill_ prefix)

**Step 1: Add getToolsWithSkills helper**

Change line 228:
```js
const allTools = [...sharedTools, ...agentTools];
```

To:
```js
const allTools = [...sharedTools, ...agentTools];
const getToolsWithSkills = () => [...allTools, ...getSkillToolDefs()];
```

**Step 2: Update askClaude to use dynamic tools**

In the `anthropic.messages.create` call (~line 382), change `tools: allTools` to `tools: getToolsWithSkills()`.

**Step 3: Add skill dispatch in executeTool**

Before the agent-specific fallback line (`if (agentExecuteTool)...` ~line 349), add:

```js
    // Dynamic skill dispatch
    if (toolName.startsWith("skill_")) {
      return await executeSkill(toolName.slice(6), input);
    }
```

**Step 4: Commit**

```bash
git add core.js
git commit -m "feat: wire dynamic skill tools into Claude tool dispatch"
```

---

### Task 4: Add skill management tools to Harvey

**Files:**
- Modify: `harvey.js:24-96` (add 5 skill tools to harveyTools array)
- Modify: `harvey.js:98-202` (add skill tool execution handlers)

**Step 1: Add skill tool definitions to harveyTools array**

After the `send_to_group` tool (line 95), before the closing `];`, add:

```js
  {
    name: "create_skill",
    description: "Create a new skill (auto-loaded as a tool). Write the full module.exports with name, description, input_schema, and async execute(input). Skills can use require() for node builtins and npm packages.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name in snake_case (e.g. get_weather)" },
        code: { type: "string", description: "Full JS file content with module.exports = { name, description, input_schema, execute }" },
      },
      required: ["name", "code"],
    },
  },
  {
    name: "test_skill",
    description: "Test a loaded skill by running it with sample input.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name to test" },
        input: { type: "object", description: "Test input matching the skill's input_schema" },
      },
      required: ["name", "input"],
    },
  },
  {
    name: "list_skills",
    description: "List all loaded skills with their names and descriptions.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "edit_skill",
    description: "Read or update an existing skill. Omit code to read current source. Provide code to overwrite (auto-validates and rolls back on error).",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name to edit" },
        code: { type: "string", description: "New full JS source (omit to just read current)" },
      },
      required: ["name"],
    },
  },
  {
    name: "delete_skill",
    description: "Delete a skill and unload it.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Skill name to delete" },
      },
      required: ["name"],
    },
  },
```

**Step 2: Add execution handlers in Harvey's executeTool**

Before the final `return { error: ... }` line (~line 202), add:

```js
  if (toolName === "create_skill") {
    const { createSkill } = require("./core");
    return createSkill(input.name, input.code);
  }
  if (toolName === "test_skill") {
    const { executeSkill } = require("./core");
    return await executeSkill(input.name, input.input || {});
  }
  if (toolName === "list_skills") {
    const { listSkills } = require("./core");
    return listSkills();
  }
  if (toolName === "edit_skill") {
    const { editSkill } = require("./core");
    return editSkill(input.name, input.code);
  }
  if (toolName === "delete_skill") {
    const { deleteSkill } = require("./core");
    return deleteSkill(input.name);
  }
```

**Step 3: Commit**

```bash
git add harvey.js
git commit -m "feat: add skill management tools to Harvey"
```

---

### Task 5: Update Harvey's system prompt

**Files:**
- Modify: `harvey.js:20` (tool routing in system prompt)

**Step 1: Update system prompt**

Replace the tool routing line that contains `self-improvement/code changes → read_file + write_file + run_shell` with:

```
self-improvement/new abilities → create_skill (write a JS skill that becomes a new tool, no restart needed). list_skills to see what you have. edit_skill to modify, delete_skill to remove, test_skill to verify. each skill exports { name, description, input_schema, execute }.
```

**Step 2: Commit**

```bash
git add harvey.js
git commit -m "feat: update Harvey prompt to use skills for self-improvement"
```

---

### Task 6: Load skills on boot

**Files:**
- Modify: `index.js:21-22` (call loadAllSkills before agent launch)

**Step 1: Add skill loading**

After `const agents = [];` (line 22), add:

```js
  // Load skills from skills/ directory
  const { loadAllSkills } = require("./core");
  loadAllSkills();
```

**Step 2: Commit**

```bash
git add index.js
git commit -m "feat: load skills on boot"
```

---

### Task 7: Smoke test

**Step 1: Create a test skill file**

Create `skills/hello.js`:

```js
module.exports = {
  name: "hello",
  description: "Say hello to someone by name.",
  input_schema: {
    type: "object",
    properties: {
      name: { type: "string", description: "Name to greet" },
    },
    required: ["name"],
  },
  async execute(input) {
    return { greeting: `Hello, ${input.name}!` };
  },
};
```

**Step 2: Verify loading**

Run: `cd /Users/samehradwan/clawdbot && node -e "const c = require('./core'); c.loadAllSkills(); console.log(c.listSkills());"`

Expected: Shows `hello` skill listed.

**Step 3: Verify execution**

Run: `cd /Users/samehradwan/clawdbot && node -e "const c = require('./core'); c.loadAllSkills(); c.executeSkill('hello', { name: 'Sameh' }).then(console.log);"`

Expected: `{ greeting: 'Hello, Sameh!' }`

**Step 4: Verify skill tool defs**

Run: `cd /Users/samehradwan/clawdbot && node -e "const c = require('./core'); c.loadAllSkills(); console.log(JSON.stringify(c.getSkillToolDefs(), null, 2));"`

Expected: Shows tool def with name `skill_hello`.

**Step 5: Clean up and final commit**

Run: `rm /Users/samehradwan/clawdbot/skills/hello.js`

```bash
git add -A
git commit -m "feat: skills system complete"
```

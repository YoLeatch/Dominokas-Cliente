# SKILL: Skill Router — Auto-Discovery & Dynamic Loading

> This skill governs how you find, load, and apply other skills.
> Before doing any task, you must run the skill discovery protocol below.
> This skill is always active. It runs before every other skill.

---

## 0. What This Skill Does

Before executing any task, you must:
1. Scan the project's `/skills` folder for relevant skill files.
2. Load and apply every skill that matches the current task.
3. If no skill exists for the current demand type, search for it dynamically.
4. Never proceed with a task if a directly relevant skill exists but was not loaded.

This ensures you always operate with the best available instructions for the task at hand.

---

## 1. Skill Discovery Protocol (run on every task)

### Step 1 — Identify the Demand Type
Before looking for skills, classify what the user is asking:

| Demand Category | Examples |
|---|---|
| Language | TypeScript, Python, Go, Rust, SQL, Bash |
| Framework | React, Next.js, FastAPI, Express, Flutter |
| File Type | `.md`, `.html`, `.css`, `.json`, `.yaml` |
| Domain | Auth, Database, API, UI, Testing, DevOps, AI/LLM |
| Action | Refactor, Debug, Generate, Review, Document, Optimize |

A single task can have multiple demand categories. Identify all of them.

> Example: "Fix the TypeScript error in the React component"
> → Language: TypeScript | Framework: React | Action: Debug

---

### Step 2 — Scan the `/skills` Folder

Look for skill files in this exact order:

```
/skills/
  ├── languages/
  │   ├── typescript.md
  │   ├── python.md
  │   ├── go.md
  │   └── ...
  ├── frameworks/
  │   ├── react.md
  │   ├── nextjs.md
  │   ├── fastapi.md
  │   └── ...
  ├── domains/
  │   ├── auth.md
  │   ├── database.md
  │   ├── api.md
  │   ├── ui.md
  │   └── ...
  ├── actions/
  │   ├── refactor.md
  │   ├── debug.md
  │   ├── document.md
  │   └── ...
  └── index.md  ← master list of all available skills
```

**Always check `index.md` first** if it exists — it is the source of truth for what skills are available and their file paths.

---

### Step 3 — Match Skills to Demand

For each demand category identified in Step 1:
- Look for an exact match in `/skills` (e.g. `languages/typescript.md`).
- If no exact match → look for a partial match (e.g. `react.md` covers React + JSX + hooks).
- If no match at all → trigger the **New Skill Search Protocol** (Section 3).

Load **all** matched skills. They stack — multiple skills apply simultaneously.

> Rule: When two loaded skills conflict on a rule, the more specific skill wins.
> Example: `react.md` overrides `typescript.md` on JSX-specific patterns.

---

### Step 4 — Load and Internalize

When you load a skill file:
- Read it fully. Do not skim.
- Extract the rules, patterns, constraints, and checklists it defines.
- Apply them as hard constraints on your output for this task.
- Do not override a skill's rules with your default behavior.

> Rule: A loaded skill's instructions take priority over your general tendencies.

---

### Step 5 — Confirm Loaded Skills (optional but recommended)

At the start of your response, briefly state which skills are active:

```
[Skills loaded: typescript.md, react.md, debug.md]
```

This helps the user know you are operating with the right context and makes it easy to spot if a skill is missing.

---

## 2. Skill Application Rules

### Stacking
Multiple skills apply at once. When working on a React component written in TypeScript:
- `languages/typescript.md` governs types, interfaces, generics.
- `frameworks/react.md` governs component structure, hooks, state.
- Both apply simultaneously. Neither is ignored.

### Priority Order (when skills conflict)
1. **Action skill** (what you're doing) — highest priority.
2. **Framework skill** (what environment you're in).
3. **Language skill** (what language you're writing).
4. **Domain skill** (what problem space you're in).
5. **General engineering skill** (fallback baseline).

### Scope
Skills apply only to the task at hand. Do not let a skill loaded for one task bleed into the next unless the demand type is the same.

---

## 3. New Skill Search Protocol

Triggered when: a demand type is identified but **no matching skill exists** in `/skills`.

### Step 1 — Announce the Gap
Tell the user clearly:
```
No skill found for: [demand type]
Searching for best practices to fill this gap...
```

### Step 2 — Construct a Temporary Skill
From your training knowledge, assemble the key rules for this demand type:
- What are the established best practices?
- What are the common pitfalls?
- What patterns are idiomatic vs. anti-patterns?
- What does "correct" output look like for this type?

### Step 3 — State the Temporary Skill Explicitly
Before executing the task, output the temporary rules you are applying:

```
[Temporary skill constructed for: Rust]
Rules applied:
- Ownership rules: no value used after move
- Error handling: use Result<T, E>, never unwrap() in production
- Lifetimes: explicit where the compiler cannot infer
- Formatting: cargo fmt conventions
- No unsafe blocks without documented justification
```

This keeps your behavior transparent and lets the user correct wrong assumptions.

### Step 4 — Recommend Creating a Permanent Skill
After completing the task, suggest:
```
Recommendation: This project would benefit from a permanent skill file at:
/skills/languages/rust.md

Would you like me to generate it based on the rules I applied here?
```

### Step 5 — Generate the Skill File on Request
If the user says yes, produce a complete, well-structured `.md` skill file following the same format as existing skills in the project, ready to be saved to `/skills`.

---

## 4. Skill File Format Standard

All skill files in `/skills` must follow this structure so they are discoverable and loadable correctly:

```markdown
# SKILL: [Name]

## Applies To
- Language: [e.g. TypeScript]
- Framework: [e.g. React] (if applicable)
- Domain: [e.g. UI] (if applicable)
- Action: [e.g. Debug] (if applicable)

## When This Skill Activates
[Describe exactly what demand types trigger this skill]

## Core Rules
[The actual constraints, patterns, and standards]

## Anti-Patterns (never do these)
[What to avoid and why]

## Checklist
- [ ] ...
- [ ] ...

## Examples
[Concrete before/after code examples where applicable]
```

> Rule: Any skill file that does not follow this format may not be parsed correctly. When generating new skill files, always use this structure.

---

## 5. Index File (`/skills/index.md`)

The index is the master registry. It must be kept up to date.

### Format
```markdown
# Skills Index

## Languages
- [TypeScript](languages/typescript.md) — TS types, interfaces, generics, strict mode
- [Python](languages/python.md) — PEP8, type hints, async patterns
- [Go](languages/go.md) — idiomatic Go, error handling, goroutines

## Frameworks
- [React](frameworks/react.md) — hooks, state, component patterns, JSX
- [Next.js](frameworks/nextjs.md) — routing, SSR, API routes, App Router

## Domains
- [Auth](domains/auth.md) — JWT, OAuth, session management
- [Database](domains/database.md) — query patterns, migrations, indexing
- [UI](domains/ui.md) — design systems, accessibility, responsive design

## Actions
- [Debug](actions/debug.md) — root cause analysis, error tracing
- [Refactor](actions/refactor.md) — safe refactoring patterns
- [Document](actions/document.md) — JSDoc, README, inline comments
```

### Maintenance Rule
Whenever a new skill file is created, its entry must be added to `index.md` immediately. A skill that is not in the index does not officially exist.

---

## 6. Edge Cases

### No `/skills` Folder Exists
If the project has no `/skills` folder at all:
```
No /skills folder found in this project.
Operating on general engineering principles.
Recommendation: Initialize a /skills folder to enable skill-based guidance.
Would you like me to scaffold the folder structure and index?
```

### Skill File is Empty or Malformed
If a skill file exists but cannot be parsed:
```
Skill file found but could not be loaded: /skills/[name].md
Reason: [malformed / empty / unreadable]
Falling back to general knowledge for this demand type.
```

### Ambiguous Demand Type
If the task could map to multiple skills and it is unclear which applies:
- Load all plausible skills.
- State which ones you loaded.
- If they conflict on a specific rule, apply the priority order from Section 2.

---

## 7. Self-Check Before Every Task

- [ ] I identified all demand categories in this task.
- [ ] I scanned `/skills` for matching files.
- [ ] I loaded every matching skill.
- [ ] If no skill matched, I ran the New Skill Search Protocol.
- [ ] I stated which skills are active.
- [ ] I am applying all loaded skills as hard constraints.
- [ ] If a new skill type was needed, I offered to generate the permanent file.

# SDLC agent configuration guide

How to author and customize the agent, prompt, and instruction files. For what the agents
are and how to invoke them, see `copilot-agents.md`.

This document explains how the agent ecosystem is structured and how to customize or extend it.

## Directory Structure

```text
.github/
├── copilot-instructions.md          # Repository-wide conventions
├── agents/
│   ├── planner.agent.md             # Planning phase
│   ├── architect.agent.md           # Design phase
│   ├── developer.agent.md           # Implementation phase
│   ├── tester.agent.md              # Testing phase
│   ├── code-reviewer.agent.md       # Code review phase
│   ├── security-engineer.agent.md   # Security phase
│   └── orchestrator.agent.md        # Full lifecycle coordination
├── copilot-agents.md                # What the agents are and how to invoke them
├── instructions/
│   └── services.instructions.md     # src/services/** rules
└── prompts/
    ├── generate-tests.prompt.md     # Generate unit tests
    ├── test-edge-cases.prompt.md    # Add edge case coverage
    ├── code-review.prompt.md        # Request code review
    ├── security-audit.prompt.md     # Run security audit
    └── deliver-feature.prompt.md    # Full SDLC workflow
```

## Agent File Format

Each agent file (`.agent.md`) has two parts:

### 1. YAML Front Matter

```yaml
---
name: agent-name
description: What this agent does
tools: ["edit", "search", "read"]
handoffs:
- agent: next-agent-name
  label: "Button label in chat"
  prompt: "Pre-filled prompt for the next agent"
  send: false
---
```

| Field | Required | Purpose |
|-------|----------|---------|
| `name` | Yes | Display name in agent dropdown |
| `description` | Yes | Describes what the agent does |
| `tools` | No | ["edit", "search", "read"] - controls agent capabilities |
| `handoffs` | No | List of next agents with pre-filled prompts |

### 2. Markdown Body

The body (after `---`) is the agent's system prompt. It tells Copilot:
- **Role**: What persona the agent takes
- **Process**: Step-by-step workflow
- **Rules**: Constraints and guidelines

## Prompt File Format

Each prompt file (`.prompt.md`) has two parts:

### 1. YAML Front Matter

```yaml
---
description: "Label shown in / command list"
agent: tester
argument-hint: "Path to file to test"
---
```

| Field | Required | Purpose |
|-------|----------|---------|
| `description` | Yes | Shown when user types `/` |
| `agent` | No | Which agent runs this prompt (default: Ask mode) |
| `argument-hint` | No | Placeholder text for argument input |

### 2. Markdown Body

The body is the workflow definition. Include:
- Step-by-step instructions
- Focus areas and goals
- Input/output expectations
- Examples

## Path-Specific Instruction Format

Each instruction file (`.instructions.md`) targets a directory with glob patterns:

```yaml
---
applyTo: "src/services/**"
---

# Service File Instructions

- Export a single class per file
- ...more rules...
```

The `applyTo` field uses glob patterns:
- `src/services/**` - All files in src/services/ and subdirectories
- `src/**/*.ts` - All .ts files under src/
- `tests/**/*.test.ts` - All test files

When Copilot works on a matching file, all matching instruction files load automatically.

## Customization Guide

### Add a New Agent

1. Create a file: `.github/agents/my-agent.agent.md`
2. Add YAML front matter with `name` and `description`
3. Write the Markdown body describing the agent's role and process
4. Reload VS Code
5. Agent appears in the dropdown

Example:
```yaml
---
name: my-agent
description: Does something specific
tools: ["edit", "search"]
---

You are a [role]. Your job is to [mission].

## Process

1. Read input
2. Process
3. Generate output

## Rules

- Follow conventions
- Be specific
```

### Add a New Prompt File

1. Create a file: `.github/prompts/my-workflow.prompt.md`
2. Add YAML front matter with `description`
3. Write the Markdown body with step-by-step instructions
4. Reload VS Code
5. Prompt appears when user types `/`

Example:
```yaml
---
description: "Do something useful"
agent: my-agent
argument-hint: "What to do"
---

# My Workflow

## Steps

1. First step
2. Second step
```

### Add Path-Specific Instructions

1. Create a file: `.github/instructions/my-rules.instructions.md`
2. Add YAML front matter with `applyTo` glob pattern
3. Write rules for that directory
4. Reload VS Code
5. Rules auto-load when editing matching files

Example:
```yaml
---
applyTo: "src/controllers/**"
---

# Controller File Instructions

- Export async route handlers
- Validate all request inputs
```

### Update Repository-Wide Conventions

Edit `.github/copilot-instructions.md` to change project-wide standards. Changes apply to all agents immediately.

## Agent Handoff Patterns

Handoffs create buttons in Copilot Chat to switch between agents. Three patterns:

### 1. Sequential Workflow (Linear)
```
Planner → Architect → Developer → Tester → Code Reviewer → Security Engineer
```

Each agent has one handoff to the next:
```yaml
handoffs:
- agent: architect
  label: "Design the architecture"
  prompt: "Read #file:docs/project-plan.md and ..."
  send: false
```

### 2. Orchestrator Pattern (Hub)
```
              ↓
Orchestrator ← Planner
  ↓            ↑
  └→ Architect
     ↓
     └→ Developer
        ↓
        └→ Tester
```

The Orchestrator calls each agent in sequence and collects results.

### 3. Multi-Path Pattern (Conditional)
Agents can have multiple handoffs for different next steps:
```yaml
handoffs:
- agent: tester
  label: "Test the code"
  prompt: "..."
- agent: security-engineer
  label: "Check security"
  prompt: "..."
```

## Tips for Effective Agents

### 1. Be Specific in Rules
```yaml
# Good
- Validate all constructor arguments with typeof checks
- Throw TypeError with message: "Expected [type], got [actual]"

# Vague
- Validate inputs
- Throw errors
```

### 2. Use Process Steps
```markdown
## Process

1. Read the input file
2. Identify all [things]
3. Generate [output] for each
4. Run [verification step]
5. Fix errors and re-run
```

### 3. Reference Other Files
```markdown
Follow the conventions in `.github/copilot-instructions.md`.
Match the data model in `docs/schema.md`.
Use the error handling pattern from `src/errors/handler.ts`.
```

### 4. Include Examples
```markdown
## Example

Input: `src/services/player-pool.ts`
Output: Test file at `tests/models/user.test.ts`
with 80%+ coverage
```

### 5. Set Success Criteria
```markdown
## Done When

- [ ] All files generated
- [ ] Tests run without errors
- [ ] Coverage meets 80% target
- [ ] Code follows project conventions
```

## Testing Your Configuration

### Reload VS Code
After any changes to agents, prompts, or instructions:
1. Press `Ctrl+Shift+P`
2. Type "Reload Window"
3. Press Enter

### Verify Agents Load
1. Open Copilot Chat
2. Check the agent dropdown
3. Your agents should appear

### Verify Prompts Load
1. Type `/` in Copilot Chat
2. Your prompts should appear in the list

### Test Path-Specific Instructions
1. Edit a file in a specific directory (e.g., `src/services/draft-board.ts`)
2. Open Copilot Chat
3. Ask: "What are the code conventions for this file?"
4. Check "Reviewed n files" to see which instruction files loaded

## Common Patterns

### Pattern 1: Read Schema, Then Implement
```
User: "Implement the schema"
Developer reads: docs/schema.md
Developer generates: src/ files
Developer runs: node src/index.js
Developer iterates: Until it works
```

### Pattern 2: Generate Tests, Then Add Coverage
```
User: "Test this module"
Tester generates: tests/module.test.ts
Tester runs: jest tests/
User: "Add edge case tests"
Tester adds: Edge case scenarios
Tester runs: jest tests/ again
```

### Pattern 3: Orchestrator Runs All Phases
```
User: "Deliver this feature"
Orchestrator calls: Planner → Architect → Developer → Tester → Code Reviewer → Security Engineer
Each agent: Generates artifacts and passes to next
Result: End-to-end feature delivery
```

## Debugging Issues

### Agent doesn't appear
- Check file is at `.github/agents/name.agent.md`
- Check file has `.agent.md` extension
- Check YAML front matter has `name` and `description`
- Reload VS Code

### Agent doesn't follow instructions
- Open Copilot Chat
- Use "Reviewed n files" to see which instructions loaded
- Check instruction files are in `.github/instructions/` with `.instructions.md` extension
- Check `applyTo` pattern matches your file path

### Prompt doesn't appear
- Check file is at `.github/prompts/name.prompt.md`
- Check file has `.prompt.md` extension
- Check YAML front matter starts on line 1
- Reload VS Code

### Handoff doesn't work
- Check the target agent exists
- Check the `agent` field matches the agent's `name` field
- Reload VS Code

## Version Control

Commit these configuration files to your repository:

```bash
git add .github/
git commit -m "Add SDLC agent ecosystem"
```

Share agents across your team. They'll load automatically when teammates open the repo.

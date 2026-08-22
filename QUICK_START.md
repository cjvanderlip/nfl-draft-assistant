# Quick Reference: SDLC Agent Commands

## Accessing Agents in VS Code

### Method 1: Agent Dropdown
1. Open Copilot Chat (`Ctrl+Alt+I`)
2. Click the agent dropdown at the top
3. Select an agent
4. Type your prompt

### Method 2: Prompt Files (Shortcuts)
1. Open Copilot Chat
2. Type `/` and select a prompt
3. Follow the workflow

### Method 3: Handoff Buttons
After an agent generates output, click blue buttons to switch agents with pre-filled prompts.

---

## The 7 Agents

### 1. **Planner** - Planning Phase
*Creates project plans and user stories*

- **Agent name**: `planner`
- **Use case**: Starting a new feature
- **Example prompt**:
  ```
  Create a plan for adding draft pick analytics.
  Include user stories, data model, and implementation phases.
  Save to docs/project-plan.md
  ```

---

### 2. **Architect** - Design Phase
*Designs data schemas and file structures*

- **Agent name**: `architect`
- **Use case**: Designing before implementation
- **Example prompt**:
  ```
  Read #file:docs/project-plan.md
  Design the data schema and file structure.
  Save to docs/schema.md
  ```

---

### 3. **Developer** - Implementation Phase
*Writes working code from schemas*

- **Agent name**: `developer`
- **Use case**: Building features
- **Example prompt**:
  ```
  Read #file:docs/schema.md
  Implement the analytics feature in src/
  Run the code and fix any errors
  ```

---

### 4. **Tester** - Testing Phase
*Creates and runs comprehensive tests*

- **Agent name**: `tester`
- **Use case**: Testing code
- **Example prompt**:
  ```
  Read all source files in src/
  Generate tests in tests/
  Run tests and fix failures
  ```
- **Prompt shortcuts**:
  - `/generate-tests` - Generate tests for a module
  - `/test-edge-cases` - Add edge case coverage

---

### 5. **Code Reviewer** - Code Review Phase
*Reviews code for quality and conventions*

- **Agent name**: `code-reviewer`
- **Use case**: Quality assurance
- **Example prompt**:
  ```
  Review src/ for code quality, testing, and conventions.
  Provide specific feedback and suggestions.
  ```
- **Prompt shortcut**: `/code-review`

---

### 6. **Security Engineer** - Security Phase
*Audits code for vulnerabilities*

- **Agent name**: `security-engineer`
- **Use case**: Security audits
- **Example prompt**:
  ```
  Audit src/ for security vulnerabilities,
  input validation, and dependency issues.
  ```
- **Prompt shortcut**: `/security-audit`

---

### 7. **Orchestrator** - Full Lifecycle
*Coordinates all agents for end-to-end delivery*

- **Agent name**: `orchestrator`
- **Use case**: Delivering complete features
- **Example prompt**:
  ```
  Deliver a feature to add draft pick filtering by team.
  Run the full SDLC workflow.
  ```
- **Prompt shortcut**: `/deliver-feature`

---

## Prompt Files (Quick Workflows)

| Prompt | Purpose | Agent | Usage |
|--------|---------|-------|-------|
| `/generate-tests` | Generate unit tests | tester | Type `/` then select |
| `/test-edge-cases` | Add edge cases to tests | tester | Type `/` then select |
| `/code-review` | Review code quality | code-reviewer | Type `/` then select |
| `/security-audit` | Audit for vulnerabilities | security-engineer | Type `/` then select |
| `/deliver-feature` | Full SDLC workflow | orchestrator | Type `/` then select |

---

## Common Workflows

### Workflow 1: Quick Feature Delivery
```
1. Open Copilot Chat
2. Type `/deliver-feature`
3. Describe your feature
4. Wait for orchestrator to complete
5. Review the artifacts
```

**Duration**: 5-10 minutes
**Output**: Plan, schema, code, tests, reviews, security audit

### Workflow 2: Just Generate Tests
```
1. Open Copilot Chat
2. Type `/generate-tests`
3. Provide file path: src/models/draft.ts
4. Wait for tests to be generated and run
```

**Duration**: 2-5 minutes
**Output**: Test file with 80%+ coverage

### Workflow 3: Code Review + Security Audit
```
1. Type `/code-review`
2. Specify directory: src/
3. Click handoff to security-engineer
4. Review both reports
```

**Duration**: 5-10 minutes
**Output**: Quality feedback + security issues

### Workflow 4: Plan → Design → Implement
```
1. Select planner agent
2. Ask to plan the feature
3. Click handoff to architect
4. Ask to design the schema
5. Click handoff to developer
6. Ask to implement
```

**Duration**: 10-15 minutes
**Output**: Plan, schema, implementation

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+Alt+I` | Open Copilot Chat |
| `Ctrl+I` | Inline Chat at cursor |
| `/` | List prompt files |
| `Escape` | Close chat or cancel |
| `Ctrl+Shift+P` | VS Code Command Palette |

---

## File References in Prompts

Use these to provide context:

```
#file:docs/project-plan.md         # Reference a specific file
#selection                          # Reference selected code
#terminal                           # Reference terminal output
```

Example:
```
Read #file:docs/schema.md and implement the feature.
```

---

## Tips & Tricks

### Tip 1: Use Handoffs
Don't manually switch agents. Click the blue handoff buttons to maintain context.

### Tip 2: Iterate in Same Chat
Don't create new threads. Follow up in the same conversation:
```
[Agent generates response]
> Add more validation
> Include error handling
> Add performance optimization
```

### Tip 3: Review Generated Files
After each agent runs:
1. Open the generated file
2. Review for correctness
3. Ask agent to refine if needed

### Tip 4: Path-Specific Instructions Auto-Load
When editing files in:
- `src/models/` → Models instructions load
- `src/services/` → Services instructions load  
- `src/utils/` → Utils instructions load

Keep them open in the editor for automatic instruction loading.

### Tip 5: Verify Instructions Loaded
1. Open Copilot Chat
2. Check the "Reviewed n files" link
3. You should see both repository-wide and path-specific instructions

---

## Configuration Files (Where to Find Them)

| File | Location | Purpose |
|------|----------|---------|
| **Conventions** | `.github/copilot-instructions.md` | Project-wide standards |
| **Path Rules** | `.github/instructions/*.md` | Directory-specific rules |
| **Agents** | `.github/agents/*.agent.md` | Agent definitions |
| **Prompts** | `.github/prompts/*.prompt.md` | Quick workflows |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Agents don't appear | Reload VS Code: `Ctrl+Shift+P` → "Reload Window" |
| Prompts don't appear | Reload VS Code, check files in `.github/prompts/` |
| Instructions not loaded | Check file in editor matches `applyTo` pattern |
| Agent fails to generate files | Switch to agent and paste the error into chat |
| Handoff doesn't work | Reload VS Code, verify target agent exists |

---

## Next Steps

1. **Start small**: Use `/generate-tests` to get comfortable
2. **Try a workflow**: Use `/deliver-feature` for a complete feature
3. **Customize**: Edit `.github/copilot-instructions.md` for your project
4. **Share**: Commit agents to git, share with your team
5. **Extend**: Add new agents in `.github/agents/` for custom workflows

---

## More Information

- **Full guide**: See [AGENTS.md](AGENTS.md) for detailed documentation
- **Configuration**: See [.github/AGENT_CONFIGURATION.md](.github/AGENT_CONFIGURATION.md) for customization
- **GitHub Docs**: [Copilot Documentation](https://docs.github.com/en/copilot)

# NFL Draft Assistant - SDLC Agent Suite

## Overview

This project uses a comprehensive suite of AI agents to automate the software development lifecycle (SDLC). The agents work together to deliver features end-to-end: from planning through security audits.

## Agent Architecture

### The 7 Agents

| Agent | Phase | Purpose | How to Use |
|-------|-------|---------|-----------|
| **Planner** | Planning | Generates project plans, user stories, and requirements | Select from agent dropdown in Copilot Chat |
| **Architect** | Design | Creates data schemas and file structure blueprints | Select from agent dropdown |
| **Developer** | Implementation | Generates working code from schemas | Select from agent dropdown |
| **Tester** | Testing | Creates and runs comprehensive tests | Select from agent dropdown or use `/` commands |
| **Code Reviewer** | Code Review | Reviews code for quality, security, conventions | Select from agent dropdown or use `/` commands |
| **Security Engineer** | Security | Audits code for vulnerabilities and compliance | Select from agent dropdown or use `/` commands |
| **Orchestrator** | Full Lifecycle | Coordinates all agents for end-to-end delivery | Select from agent dropdown or use `/deliver-feature` |

## How to Use the Agents

### Method 1: Direct Agent Selection

1. Open Copilot Chat in VS Code (`Ctrl+Alt+I`)
2. Click the agent dropdown at the top
3. Select an agent (e.g., "planner", "developer", "tester")
4. Type your prompt and press Enter

### Method 2: Prompt Files (Quick Shortcuts)

Prompt files provide pre-configured workflows. Use them with `/` in Copilot Chat:

- `/generate-tests` - Generate unit tests for a module
- `/test-edge-cases` - Add edge case coverage to existing tests
- `/code-review` - Request a code review
- `/security-audit` - Run a security audit
- `/deliver-feature` - Run the full SDLC workflow

Example:
```
Type `/` in Copilot Chat → Select "generate-tests" → Provide file path → Press Enter
```

## Common Workflows

### Workflow 1: Plan a New Feature

```
1. Open Copilot Chat
2. Select "planner" agent
3. Describe your feature
4. Agent generates docs/project-plan.md
5. Review and iterate in the same conversation
```

Example prompt:
```
Create a plan for adding NFL draft analytics: 
- Show average pick position by team
- Compare draft performance across years
- Identify team strengths and weaknesses

Save the plan to docs/project-plan.md
```

### Workflow 2: Design the Architecture

```
1. Open Copilot Chat
2. Select "architect" agent
3. Ask to design based on the project plan
4. Agent generates docs/schema.md with data model and file structure
5. Review the schema and iterate
```

Example prompt:
```
Read #file:docs/project-plan.md and design the data schema 
and file structure for NFL draft analytics.

Save the design to docs/schema.md.
```

### Workflow 3: Implement a Feature

```
1. Open Copilot Chat
2. Select "developer" agent
3. Ask to implement based on the schema
4. Agent generates code under src/
5. Agent runs the code and fixes errors
```

Example prompt:
```
Read #file:docs/schema.md and implement the draft analytics feature.

Create the files specified in the schema and run the entry point 
to verify everything works.
```

### Workflow 4: Generate Tests

Use either method:

**Method A - Direct agent:**
```
1. Select "tester" agent
2. Ask to generate tests for src/
3. Agent creates test suite under tests/
4. Agent runs tests and fixes failures
```

**Method B - Prompt file (quicker):**
```
1. Type `/` in Copilot Chat
2. Select "generate-tests"
3. Provide the file path: src/models/draft.ts
4. Agent generates and runs tests
```

### Workflow 5: Full End-to-End Delivery

Use the orchestrator to run the entire SDLC:

```
1. Type `/` in Copilot Chat
2. Select "deliver-feature"
3. Describe your feature
4. Orchestrator runs all 7 agents in sequence
5. Review the final output
```

The orchestrator will:
- Plan the feature
- Design the schema
- Implement the code
- Generate and run tests
- Review for code quality
- Audit for security issues
- Summarize all changes

## Configuration Files

### `.github/copilot-instructions.md`
Repository-wide conventions that apply to ALL Copilot requests. Defines:
- Language and runtime (Node.js 20+, TypeScript/JavaScript)
- Code style (2-space indentation, single quotes, const by default)
- Error handling patterns
- Testing approach
- Security practices

### `.github/instructions/*.instructions.md`
Path-specific instructions that apply when editing files in specific directories:
- `models.instructions.md` - Rules for model classes in `src/models/`
- `services.instructions.md` - Rules for service functions in `src/services/`
- `utils.instructions.md` - Rules for utility functions in `src/utils/`

When you edit a file, Copilot automatically loads the matching path-specific instructions.

### `.github/prompts/*.prompt.md`
Reusable workflow templates invoked with `/` in Copilot Chat:
- `generate-tests.prompt.md` - Generate unit tests
- `test-edge-cases.prompt.md` - Add edge case coverage
- `code-review.prompt.md` - Request code review
- `security-audit.prompt.md` - Run security audit
- `deliver-feature.prompt.md` - Full SDLC workflow

### `.github/agents/*.agent.md`
Custom agent definitions. Each agent has:
- YAML front matter with `name`, `description`, `tools`, and `handoffs`
- Markdown body describing the agent's role, process, and rules
- Handoffs to the next agent in the workflow

## Agent Handoffs

Agents can hand off to the next agent in the workflow. For example:

- **Planner** → **Architect**: "Design the architecture"
- **Architect** → **Developer**: "Implement the feature"
- **Developer** → **Tester**: "Test the feature"
- **Tester** → **Code Reviewer**: "Review the code"
- **Code Reviewer** → **Security Engineer**: "Check for security issues"

Handoffs appear as blue buttons in Copilot Chat. Click a button to switch agents with a pre-filled prompt.

## Best Practices

### 1. Use Handoffs for Workflows
Instead of manually switching agents, use the blue handoff buttons. They automatically pass context between phases.

### 2. Keep Prompts Specific
- Be clear about what you want
- Reference files with `#file:` for context
- Break large tasks into smaller prompts

### 3. Iterate Within Conversations
Don't start a new chat thread. Follow up in the same conversation:
```
[Agent generates first response]
> Add validation for edge cases
> Include error handling examples
```

### 4. Review Generated Artifacts
After each agent runs:
- Open the generated files (e.g., `docs/project-plan.md`, `src/models/draft.ts`)
- Review for completeness and correctness
- Ask the agent to refine if needed

### 5. Use Path-Specific Instructions
When editing files in `src/models/`, `src/services/`, or `src/utils/`, the matching instructions automatically load. This ensures:
- Models follow class-based patterns
- Services follow function-based patterns
- Utils follow pure function patterns

### 6. Test Coverage
Always use the Tester Agent to generate tests. Targets:
- 80%+ line coverage for critical paths
- Both success and failure scenarios
- Edge cases and boundary conditions

## Troubleshooting

### Agents Don't Appear in Dropdown
- Reload VS Code: `Ctrl+Shift+P` → "Reload Window"
- Confirm agent files are in `.github/agents/` with `.agent.md` extension
- Check YAML front matter has `name` and `description`

### Prompt Files Don't Appear with `/`
- Confirm files are in `.github/prompts/` with `.prompt.md` extension
- Check YAML front matter starts on line 1 (no blank lines above `---`)
- Reload the VS Code window

### Copilot Doesn't Follow Path-Specific Instructions
- Make sure the file is in the correct directory (e.g., `src/models/`)
- Open the file in the editor (instructions only load for open files)
- Check the instruction file's `applyTo` glob pattern matches your file path
- Use the "Reviewed n files" link in Copilot Chat to verify instructions were loaded

### Generated Code Doesn't Run
- Paste the error into Copilot Chat with the agent selected
- Agent will read the error and fix the issue
- Let the agent iterate until all tests pass

## Next Steps

1. **Start with Planning**: Use the Planner Agent to outline your feature
2. **Design First**: Use the Architect Agent to create the schema
3. **Implement**: Use the Developer Agent to write the code
4. **Test**: Use the Tester Agent to create comprehensive tests
5. **Review**: Use the Code Reviewer Agent to check quality
6. **Secure**: Use the Security Engineer Agent to audit for vulnerabilities
7. **Orchestrate**: Use the Orchestrator Agent to automate the entire process

## Additional Resources

- [GitHub Copilot Documentation](https://docs.github.com/en/copilot)
- [Prompt Engineering Guide](https://docs.github.com/en/copilot/using-github-copilot/copilot-chat/prompt-engineering-for-github-copilot)
- [Custom Instructions Guide](https://docs.github.com/en/copilot/customizing-copilot/adding-repository-custom-instructions-for-github-copilot)

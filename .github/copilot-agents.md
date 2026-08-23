# Copilot SDLC agent suite

Seven Copilot agents configured for this repository, covering planning through security
review. This describes the tooling, not the application — for that, see the root `README.md`.

## The agents

| Agent | Phase | Purpose |
| --- | --- | --- |
| `planner` | Planning | Project plans, user stories, acceptance criteria |
| `architect` | Design | Data schemas and file-structure blueprints from a plan |
| `developer` | Implementation | Implementation code from a schema, following repo conventions |
| `tester` | Testing | Generates and runs tests, iterating until they pass |
| `code-reviewer` | Review | Quality, security, and convention adherence |
| `security-engineer` | Security | Vulnerability and compliance audit |
| `orchestrator` | Full lifecycle | Coordinates the others end to end |

Definitions live in `.github/agents/*.agent.md`, one file per agent. Those files are the
source of truth; this table is a summary.

## Invoking them

- **Agent dropdown** — open Copilot Chat (`Ctrl+Alt+I`), pick an agent from the dropdown,
  type the prompt.
- **Prompt files** — type `/` in Copilot Chat and choose one of the workflows below.
- **Handoff buttons** — after an agent replies, the buttons in its output switch to the next
  agent with the prompt pre-filled.

## Prompt files

`.github/prompts/*.prompt.md`:

| Prompt | Runs |
| --- | --- |
| `/deliver-feature` | Full orchestrated workflow: plan → design → implement → test → review |
| `/generate-tests` | Tester against a chosen file or feature |
| `/test-edge-cases` | Tester focused on boundary and failure cases |
| `/code-review` | Code reviewer against the current changes |
| `/security-audit` | Security engineer against the current changes |

## How the configuration fits together

| Path | Applies |
| --- | --- |
| `.github/copilot-instructions.md` | Repository-wide conventions, every request |
| `.github/instructions/*.instructions.md` | Path-scoped rules, via each file's `applyTo` glob |
| `.github/agents/*.agent.md` | One agent definition each |
| `.github/prompts/*.prompt.md` | Reusable workflow shortcuts |

Path-scoped instruction files only take effect if their `applyTo` glob matches real
directories. Two of them once pointed at `src/models/**` and `src/utils/**`, neither of which
has ever existed here, so they were silently inert — worth checking when adding one.

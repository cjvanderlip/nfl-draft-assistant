# docs

| File | What it is |
| --- | --- |
| `ci.md` | Branch protection, the PR workflows, and the required checks. |

## Agent working documents

The Copilot agents in `.github/agents/` read and write `docs/project-plan.md` and
`docs/schema.md` as their scratch space: the planner writes a plan, the architect turns it
into a schema, the developer implements from it. Those two files are **generated output, not
maintained documentation** — they describe whatever was last planned, which may never have
been built.

Both were deleted in August 2026 because they still described the prototype stack that was
removed from the codebase, and a planner reading a stale plan plans against a product that no
longer exists. They will reappear the next time an agent runs. Read them as a proposal, and
trust `README.md` and the code for what is actually true.

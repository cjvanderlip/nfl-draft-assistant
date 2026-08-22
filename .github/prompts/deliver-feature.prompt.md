---
description: Run the full SDLC workflow to deliver a feature end-to-end
agent: orchestrator
argument-hint: Feature description (e.g., Add draft pick filtering by team)
---

# Deliver Feature End-to-End

Use the orchestrator to execute the complete software development lifecycle for a new feature.

## What Happens

The orchestrator coordinates six agents across these phases:

1. **Planning** - Planner generates user stories and requirements
2. **Design** - Architect updates the data schema and file structure
3. **Implementation** - Developer writes the code
4. **Testing** - Tester creates and runs comprehensive tests
5. **Code Review** - Code Reviewer checks quality and conventions
6. **Security** - Security Engineer audits for vulnerabilities

## Input

Provide a clear feature description. Example:

```
Add the ability to filter draft picks by team name and year.
Users should be able to see all picks for a specific team in a given year.
Include error handling for invalid team names and years.
```

## Output

- Updated `docs/project-plan.md` and `docs/schema.md`
- Implemented feature in `src/`
- Comprehensive test suite in `tests/`
- Code review feedback
- Security audit results
- Summary of all changes

---
description: Review code for quality, security, and conventions
agent: code-reviewer
argument-hint: Directory or file path to review (e.g., src/models)
---

# Review Code Quality

Request a comprehensive code review of specific files or directories.

The code reviewer will analyze:

1. **Code Quality** - style, naming, complexity, duplication
2. **Testing** - test coverage, meaningful assertions
3. **Security** - input validation, secret handling, error messages
4. **Performance** - async usage, bottlenecks
5. **Documentation** - JSDoc, README, clarity

## Input

Specify which files or directories to review:
- Single file: `src/models/draft.ts`
- Directory: `src/models/`
- Pattern: `src/**/*.ts`

## Output

- Detailed feedback on each area
- Specific, actionable suggestions
- References to project conventions
- Code examples where helpful

---
description: Generate unit tests for a source module
agent: tester
argument-hint: Path to the source file to test (e.g., src/models/draft.ts)
---

# Generate Unit Tests

Your goal is to generate comprehensive unit tests for the module the user specifies.

## Steps

1. Read the target source file.
2. Identify all exported functions and classes.
3. Generate tests that cover:
   - Normal inputs with expected outputs
   - Edge cases (empty strings, zero, negative numbers, null, undefined)
   - Error conditions (invalid types, missing required fields)
4. Use the appropriate testing framework (Jest, Vitest, or Node.js test runner).
5. Save the test file to `tests/` using the convention `<module>.test.ts`.
6. Run the tests and fix any failures.

## Coverage Goals

- Aim for minimum 80% line coverage
- Test all public methods and exported functions
- Include both positive and negative test cases
- Test type validation and error handling

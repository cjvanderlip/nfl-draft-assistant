# NFL Draft Assistant - Project Conventions

## Language and Runtime

- JavaScript/TypeScript, Node.js 20+.
- Use ES module syntax (`import`/`export`), not CommonJS (`require`).
- TypeScript preferred for type safety and maintainability.

## Code Style

- Use 2-space indentation.
- Use single quotes for strings.
- Use `const` by default; use `let` only when reassignment is needed. Never use `var`.
- Add JSDoc comments to all exported functions and classes.
- Follow clean code principles: single responsibility, DRY, meaningful names.

## Error Handling

- Use `try/catch` blocks around operations that may fail.
- Throw `Error` objects with descriptive messages. Do not throw plain strings.
- Log errors with `console.error`, not `console.log`.
- Provide helpful error messages that guide users to solutions.

## Data Model

- Design schemas with clear entity relationships.
- Validate all inputs at entry points.
- Use consistent naming conventions for properties and methods.
- Include timestamps (createdAt, updatedAt) for audit trails.

## Testing

- Use a testing framework appropriate to the project (Jest, Vitest, or Node.js assert).
- Test files end with `.test.ts` or `.test.js`.
- Each test function tests exactly one behavior.
- Achieve minimum 80% code coverage for critical paths.

## Dependencies

- Use well-maintained, popular packages only.
- Minimize external dependencies; prefer built-in Node.js modules where feasible.
- Document all dependencies and their versions in package.json.
- Regularly audit dependencies for security vulnerabilities.

## Documentation

- Write clear README.md with setup instructions.
- Document API endpoints or exported functions with JSDoc.
- Include examples in documentation.
- Keep comments focused on "why," not "what" the code does.

## Version Control

- Commit messages should be clear and descriptive.
- Use conventional commit format: `type(scope): description`.
- Keep commits atomic and logical.

## Performance & Security

- Minimize blocking operations; use async/await appropriately.
- Validate and sanitize all user inputs.
- Never hardcode secrets; use environment variables.
- Implement proper authentication and authorization checks.

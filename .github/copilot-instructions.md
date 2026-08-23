# War Room Wingman — project conventions

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

## Data

- There is no database. Everything the draft board needs is read from `data/`, written
  ahead of time by `npm run draft:prep`.
- Prefer plain records over classes. Nothing in the draft path mutates a domain object or
  asks it to validate itself.
- Validate inputs at entry points — route handlers and exported service functions — using
  the helpers in `validators.ts`. Throw `TypeError`; the API layer maps it to a 400.

## Testing

- Vitest. Test files sit beside the code as `<name>.test.ts`.
- Each test asserts one behaviour, and its name says what that behaviour is.
- Tests must not touch the network. The cached files in `data/` are the fixtures.
- Anything touching the draft-day path needs a test that would fail if it broke — this
  runs live, once a year, with no second chance.

## Dependencies

- The project has **no runtime dependencies** and should keep it that way. The server is
  Node's own `http`; the UI is one static file with no build step.
- Dev dependencies are TypeScript and Vitest. Adding to either list needs a reason that
  survives the question "what happens if this breaks at 7pm on draft night?"

## Documentation

- Write clear README.md with setup instructions.
- Document API endpoints or exported functions with JSDoc.
- Include examples in documentation.
- Keep comments focused on "why," not "what" the code does.

## Version Control

- Commit messages should be clear and descriptive.
- Use conventional commit format: `type(scope): description`.
- Keep commits atomic and logical.

## Performance

- The board re-simulates on every pick. Keep that path under ~150ms; it is the only
  latency budget that matters.
- Escape anything rendered into the DOM. The UI builds HTML strings, so `escapeHtml` is
  not optional.
- The server binds localhost and has no auth by design: it is a second screen on one
  laptop, not a service.

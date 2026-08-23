# Copilot PR Review Notes

Copilot pull request review is configured in GitHub repository or organization settings.

- Native Copilot PR review is requested by assigning Copilot as a reviewer, or by enabling automatic code review.
- Reusable workflows are still useful for CI checks (lint, test, security scan) and can run on each pull request.
- Copilot review comments are informational and do not replace required human approvals in branch protection.

This repository includes:

- Caller workflow: .github/workflows/reusable-caller.yml
- Reusable workflow: .github/workflows/reusable-pr-checks.yml

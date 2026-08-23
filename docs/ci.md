# CI and pull requests

`main` is protected: changes land through a pull request, and a direct push is rejected.

## Workflows

| File | Role |
| --- | --- |
| `.github/workflows/reusable-caller.yml` | Caller that runs on each pull request. |
| `.github/workflows/reusable-pr-checks.yml` | Local reusable workflow. |

The caller currently targets the shared workflow in the dedicated workflow repository:

```yaml
uses: cjvanderlip/github-workflows/.github/workflows/reusable-pr-checks.yml@main
```

Point it elsewhere by editing that `uses:` line, passing whatever inputs and secrets the
target expects. The cross-repository form is always
`OWNER/REPO/.github/workflows/FILE.yml@REF`.

## Required checks

CodeQL runs three checks on every pull request — `Analyze (actions)`,
`Analyze (javascript-typescript)`, and `CodeQL`. All three must pass before a merge is
allowed, so a PR sits in `BLOCKED` until they finish.

## Copilot review

Copilot pull request review is configured in the GitHub repository or organization settings,
not in this repository. Request it by assigning Copilot as a reviewer, or enable automatic
review in settings. Its comments are informational and do not satisfy the human approval that
branch protection requires.

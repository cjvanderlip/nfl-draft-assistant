# Reusable Workflow Caller

This repository now includes a starter reusable workflow caller at `.github/workflows/reusable-caller.yml`.

Update the `uses:` line to point at your real reusable workflow, for example:

```yaml
uses: cjvanderlip/some-repo/.github/workflows/reusable-ci.yml@main
```

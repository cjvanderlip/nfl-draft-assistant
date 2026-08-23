# Reusable Workflow Usage

## Cross-repository reusable workflow

Use this pattern when your reusable workflow lives in another repository:

uses: OWNER/REPO/.github/workflows/FILE.yml@REF

Current setup:

uses: cjvanderlip/github-workflows/.github/workflows/reusable-pr-checks.yml@main

# Reusable Workflow Usage

## Local reusable workflow (same repository)

Use this in a caller workflow job:

uses: ./.github/workflows/reusable-pr-checks.yml

## Cross-repository reusable workflow

Use this pattern when your reusable workflow lives in another repository:

uses: OWNER/REPO/.github/workflows/FILE.yml@REF

Example:

uses: cjvanderlip/platform-workflows/.github/workflows/reusable-pr-checks.yml@main

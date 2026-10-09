---
name: release
description: Cut a versioned release of rmod by bumping plugin.json, finalising CHANGELOG.md, running the full gate and security review, and tagging. Only the user triggers this.
disable-model-invocation: true
argument-hint: "[patch|minor|major]"
---

# Release ($ARGUMENTS, default `patch`)

1. Confirm the working tree is clean (`git status`) and that you're on the main branch.
2. Run `/docs-check`. If the Claude Code version changed since the last release, rerun all tests against the new build.
3. Run `/verify`. It must be PASS.
4. Run `/security-review all`. The verdict must be SHIP.
5. Run the manual acceptance checklist in `docs/TESTING.md` §5 with the user, in the terminal and in the Desktop app. Record the Claude Code, Ollama and LM Studio versions tested.
6. Bump `version` in `.claude-plugin/plugin.json` (semver). Move `## [Unreleased]` entries in `CHANGELOG.md` under the new version with today's date, and add the line "Tested with Claude Code X, Ollama Y, LM Studio Z, macOS N".
7. If it doesn't exist yet, create `.claude-plugin/marketplace.json`, following the current docs at `https://code.claude.com/docs/en/plugins/create-marketplace.md` (fetch it, don't recall it). Run `claude plugin validate .` again.
8. Show the user the diff. After they approve, commit `chore(release): vX.Y.Z` and tag `vX.Y.Z`. Pushing is the user's decision. Never force-push.

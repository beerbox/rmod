# Changelog

All notable changes to rmod are documented here. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [Unreleased]

### Added
- Project guidance: CLAUDE.md, path-scoped rules, development skills (`/docs-check`, `/verify`, `/implement-milestone`, `/probe-local-servers`, `/security-review`, `/release`), `mod-reviewer` and `qa-tester` subagents, the spec, architecture, plan, testing, security and reference docs, the secret-scanning pre-commit hook, and `.gitignore`.
- Dev tooling: `package.json` with TypeScript 7.0.2 pinned exactly (dev-only, no runtime deps), committed lockfile, and `tsconfig.json` per the 2.1.295 types header.
- Sanitized test fixtures for Ollama 0.40.2 (`/api/version`, `/api/tags`, `/api/ps`) and LM Studio (`/api/v1/models`, `/v1/models`, shapes from the live docs).
- Skeleton mod: manifest with the full `userConfig` (FR-6.2), the `$.state` contract in `types/index.d.ts`, and a hooks module that registers `/rmod-status` (FR-6.1).

### Fixed
- Docs and dev instructions point to the actual repo path (`/path/to/rmod`).

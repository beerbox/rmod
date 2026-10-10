# References: always use the LATEST version

Last verified: 2026-10-10
Claude Code version verified: 2.1.296 (mods require ≥ 2.1.287)
Ollama / LM Studio versions verified: Ollama 0.40.2 (live probe 2026-10-09) · LM Studio not running at M0.3, shape taken from live docs (re-probe pending)

**Policy:** these links are where to look, not what to believe. Fetch the page (the `.md` form for code.claude.com) each time you rely on it. Precedence: generated types of the installed build > live docs > this repo's notes > memory (never).

## Claude Code: core
- Docs index (discover new or renamed pages): https://code.claude.com/docs/llms.txt
- Memory / CLAUDE.md / `.claude/rules/`: https://code.claude.com/docs/en/memory.md
- Skills: https://code.claude.com/docs/en/skills.md
- Subagents: https://code.claude.com/docs/en/sub-agents.md
- Settings: https://code.claude.com/docs/en/settings.md · all keys: https://code.claude.com/docs/en/settings-reference.md
- Permissions: https://code.claude.com/docs/en/permissions.md · modes: https://code.claude.com/docs/en/permission-modes.md
- Settings hooks: https://code.claude.com/docs/en/hooks.md · guide: https://code.claude.com/docs/en/hooks-guide.md
- Sandboxing: https://code.claude.com/docs/en/sandboxing.md
- Security: https://code.claude.com/docs/en/security.md
- Best practices: https://code.claude.com/docs/en/best-practices.md
- What's new (weekly): see `whats-new/` entries in the index

## Claude Code: mods and plugins
- Mods overview (trust, where mods run, built-ins): https://code.claude.com/docs/en/plugins/mods/overview.md
- Create a mod (layout, validate, types, dev loop): https://code.claude.com/docs/en/plugins/mods/create.md
- Mods reference (events, `$` methods, render sites, elements, limits): https://code.claude.com/docs/en/plugins/mods/reference.md
- Draw in the interface (pane, band, state): https://code.claude.com/docs/en/plugins/mods/interface.md
- Interface gallery (example sites and elements): https://code.claude.com/docs/en/plugins/mods/gallery.md
- React to events (tool.call, turn.step, order, failure): https://code.claude.com/docs/en/plugins/mods/events.md
- Use the mods API (commands, timers, http, store): https://code.claude.com/docs/en/plugins/mods/api.md
- Test a mod (kit, stubs, mock clock, mount): https://code.claude.com/docs/en/plugins/mods/test.md
- Troubleshoot a mod: https://code.claude.com/docs/en/plugins/mods/troubleshoot.md
- Mods admin policy: https://code.claude.com/docs/en/plugins/mods/admin.md
- Plugin manifest (userConfig, sensitive): https://code.claude.com/docs/en/plugins/manifest-reference.md
- Plugin CLI commands: https://code.claude.com/docs/en/plugins/cli-reference.md
- Plugin security and trust: https://code.claude.com/docs/en/plugins/security.md
- Marketplaces: https://code.claude.com/docs/en/plugins/create-marketplace.md
- Published API declarations (match against your version's first line): https://github.com/anthropics/claude-code/blob/main/mods/types/claude-code.d.ts
- Built-in mod sources with tests (good patterns): https://github.com/anthropics/claude-code/tree/main/mods
- Sample mods: https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods
- Local, build-exact: the `/plugin-authoring` skill (reference.md + examples) and `.claude-plugin/types/` after the first load

## Ollama
- API: https://docs.ollama.com/api · tags: https://docs.ollama.com/api/tags · ps: https://docs.ollama.com/api/ps
- Anthropic compatibility (Claude Code → Ollama): https://docs.ollama.com/api/anthropic-compatibility

## LM Studio
- REST API: https://lmstudio.ai/docs/developer/rest · list models: https://lmstudio.ai/docs/developer/rest/list
- Anthropic compatibility: https://lmstudio.ai/docs/developer/anthropic-compat
- API changelog: https://lmstudio.ai/docs/developer/api-changelog

## Tooling
- gitleaks: https://github.com/gitleaks/gitleaks

## Drift log
<!-- /docs-check appends: YYYY-MM-DD · source · what changed · files updated -->
- 2026-10-09 · initial · docs written against Claude Code 2.1.295 types and live docs · (none)
- 2026-10-09 · Ollama 0.40.2 probe · `/api/tags` entries add `capabilities[]` and `details.runner`; MLX models report `parameter_size` and `quantization_level` as `""` (treat as unknown) · LOCAL_SERVERS.md, tests/fixtures/
- 2026-10-09 · lmstudio.ai list-models page · `quantization` may be null and its fields nullable; `params_string` nullable; embedding entries omit `architecture`, `capabilities`, `description` · LOCAL_SERVERS.md, tests/fixtures/
- 2026-10-09 · ollama envconfig.Host() source · `OLLAMA_HOST` with an explicit scheme and no port defaults to 80 (http) or 443 (https), not 11434 · url-guard.ts, LOCAL_SERVERS.md
- 2026-10-10 · Claude Code 2.1.296 types vs 2.1.295 · only `autoCompactWindow` on agent definitions and `$.mcp.connect` wording changed; nothing rmod uses. tsc, 249 tests and validate are green on 2.1.296. New docs page: mods/gallery.md. No What's-new entries since 2026-09-11. Ollama /api/ps unchanged. LM Studio changelog has no dated entries after 2025-10 · REFERENCES.md

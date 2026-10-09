---
name: implement-milestone
description: Implement one milestone or task from docs/PLAN.md test-first, from reading the spec through the verify gate, review, and updating the plan. Use when the user says "next step", "implement M3", "continue the plan", or names a PLAN item.
argument-hint: "[milestone-id, e.g. M2 or M2.3]"
---

# Implement milestone $ARGUMENTS

If no ID was given, take the first unchecked item in `docs/PLAN.md` and say which one you picked.

## 0. Ground yourself (don't skip this)

- Read the milestone in `docs/PLAN.md`, the SPEC IDs it covers in `docs/SPEC.md`, and the relevant sections of `docs/ARCHITECTURE.md`.
- If `docs/REFERENCES.md` "Last verified" is more than 14 days old, or `claude --version` differs from the recorded version, run `/docs-check` first.
- Grep `.claude-plugin/types/claude-code/index.d.ts` for every event and method this milestone uses. If anything differs from ARCHITECTURE.md, stop and reconcile it before coding.

## 1. Plan briefly

List the files you'll create or change and the tests you'll add, by SPEC ID. If the milestone is larger than about 300 changed lines, split it and tell the user.

## 2. Test first

Write the tests in `tests/` (kit tests) or next to the pure modules (unit tests), following `.claude/rules/testing.md`. Run `claude plugin test` and confirm the new tests **fail for the right reason**.

## 3. Implement

Implement following `.claude/rules/mod-code.md`. Keep pure logic in `hooks/lib/` and the `$` calls in `hooks/register.tsx` or `hooks/ui/`. Declare new `$.state` keys in `types/index.d.ts`.

## 4. Gate

Run `/verify`. Fix the issues it reports and repeat until it passes. Never weaken a test or the allowlist to get a pass.

## 5. Independent review

Delegate to the `mod-reviewer` subagent with the diff (`git diff`) and the SPEC IDs. Fix every High or Medium finding, or explain to the user why you won't. For UI or behaviour milestones, also run the `qa-tester` subagent.

## 6. Manual check (UI milestones)

Ask the user to look at the result in their second terminal (`claude --plugin-dir /path/to/rmod`), which hot-reloads on save, and in the Desktop app's Code tab if the milestone draws anything. Give them the exact steps from docs/TESTING.md §5 for this milestone.

## 7. Close out

- Tick the item in `docs/PLAN.md` and add an entry under `## [Unreleased]` in `CHANGELOG.md`.
- Stage the files and propose a Conventional Commit message. Commit only if the user agrees, and never use `--no-verify`.

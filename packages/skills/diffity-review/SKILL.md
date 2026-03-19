---
name: diffity-review
description: Review current diff and leave comments using diffity agent commands
user-invocable: true
---

# Diffity Review Skill

You are reviewing a diff and leaving inline comments using the `{{binary}} agent` CLI.

## Arguments

- `ref` (optional): Git ref to review (e.g. `main..feature`, `HEAD~3`). Defaults to working tree changes. When both `ref` and `focus` are provided, use both (e.g. `/diffity-review main..feature security`).
- `focus` (optional): Focus the review on a specific area. One of: `security`, `performance`, `naming`, `errors`, `types`, `logic`. If omitted, review everything.

## CLI Reference

```
{{binary}} agent list [--status open|resolved|dismissed] [--json]
{{binary}} agent comment --file <path> --line <n> [--end-line <n>] [--side new|old] --body "<text>"
{{binary}} agent general-comment --body "<text>"
{{binary}} agent resolve <id> [--summary "<text>"]
{{binary}} agent dismiss <id> [--reason "<text>"]
{{binary}} agent reply <id> --body "<text>"
```

- `--file`, `--line`, `--body` are required for `comment`
- `--end-line` defaults to `--line` (single-line comment)
- `--side` defaults to `new`
- `general-comment` creates a diff-level comment not tied to any file or line
- `<id>` accepts full UUID or 8-char prefix

## Prerequisites

1. Check that `{{binary}}` is available: run `which {{binary}}`. If not found, {{install_hint}}.

## Instructions

### Step 1: Ensure diffity is running for the correct ref (without opening browser)

The review needs a running session whose ref matches the requested ref. A ref mismatch causes "file not in current diff" errors when adding comments.

1. Run `{{binary}} list --json` to get all running instances. Parse the JSON output and find the entry whose `repoRoot` matches the current repo.
2. If a matching entry exists, compare its `ref` field against the requested ref:
   - The registry stores `"work"` for working-tree sessions and the user-provided ref string (e.g. `"main"`, `"HEAD~3"`) for named refs.
   - If refs **match** → reuse the session, note the port, and continue to Step 2.
   - If refs **don't match** → restart: run `{{binary}} <ref> --no-open --new` (or `{{binary}} --no-open --new` if no ref). The `--new` flag kills the old session and starts a fresh one. Use Bash tool with `run_in_background: true`. Wait 2 seconds, then verify with `{{binary}} list --json` and note the port.
   - If **no ref was requested** and the running session's ref is not `"work"` → restart with `{{binary}} --no-open --new` (the running session is for a named ref, but we need working-tree).
3. If **no session is running** for this repo, start one in the background:
   - Command: `{{binary}} <ref> --no-open` (or `{{binary}} --no-open` if no ref)
   - Use Bash tool with `run_in_background: true`
   - Wait 2 seconds, then verify with `{{binary}} list --json` and note the port.

### Step 2: Review the diff

1. **Get the resolved diff args from diffity's API**, then run `git diff` yourself — do NOT construct the diff ref manually, as diffity uses merge-base resolution:
   ```
   curl -s 'http://localhost:<port>/api/diff/ref?ref=<ref>'
   ```
   If no ref was provided, omit the `ref` query parameter. The response is JSON with an `args` field (e.g. `"abc123def"`). Run `git diff <args>` to get the unified diff. Line numbers are in the `@@` hunk headers.
2. For each changed file, read the **entire file** (not just the diff hunks) to understand the full context. This prevents false positives from missing surrounding code.
3. Analyze the code changes thoroughly. If a `focus` argument was provided, concentrate on that area. Otherwise look for:
   - Bugs, logic errors, off-by-one errors
   - Security issues (injection, XSS, auth bypass)
   - Performance problems
   - Missing error handling at system boundaries
   - Race conditions
   - API contract violations
   - Unclear or misleading naming
4. **Only comment on code that was changed in the diff.** Do not flag pre-existing issues in unchanged code — this is a review of the diff, not an audit of the entire file. The only exception is if a change in the diff introduces a bug in combination with existing code.
5. **Prioritize signal over volume.** A clean diff should get a clean review. Do not manufacture findings to appear thorough. If a diff with 5 changed lines only has 1 real issue, leave 1 comment.
6. **Do not repeat the same issue across files.** If the same pattern appears in multiple places, leave one inline comment on the first occurrence and mention it in the general summary instead of commenting on every instance.

### Step 3: Leave comments

1. Categorize each finding with a severity prefix in the comment body:
   - `[must-fix]` — Bugs, security issues, data loss risks. These must be addressed.
   - `[suggestion]` — Improvements that would meaningfully improve the code.
   - `[nit]` — Style or preference. Fine to ignore.
   - `[question]` — Something unclear that needs clarification from the author.
2. For each finding, leave an inline comment using:
   ```
   {{binary}} agent comment --file <path> --line <n> [--end-line <n>] [--side new] --body "<comment>"
   ```
   - Use `--side new` (default) for comments on added/modified code
   - Use `--side old` for comments on removed code
   - Use `--end-line` when the issue spans multiple lines
   - Be specific and actionable — lead with the point, skip filler
3. After leaving all inline comments, decide whether a general comment is needed:
   - **Skip the general comment** if the inline comments already cover everything — a single finding doesn't need a summary restating the same thing.
   - **Leave a general comment** when there are cross-cutting concerns that don't belong on any single line (architecture, naming consistency, missing tests), when there are 3+ findings worth summarizing, or when the diff is clean and has no inline findings (e.g. "LGTM — clean diff, no issues found").
   - **Do not use severity prefixes in the general comment** — prefixes are only for inline findings.
   - Lead with the verdict, be direct and concise — no compliments, no filler, no narrating what the code does.
   ```
   {{binary}} agent general-comment --body "<overall review summary>"
   ```

### Step 4: Open the browser

1. Open the browser now that comments are ready:
   ```
   {{binary}} open <ref>
   ```
   Pass the ref argument if one was provided (e.g. `{{binary}} open HEAD~3`). Omit it to open the default view.
2. Tell the user the review is ready and they can check the browser. Example:

   > Review complete — check your browser.
   >
   > Found: 2 must-fix, 3 suggestions, 1 nit
   >
   > When you're ready, run **{{slash}}resolve** to fix them.

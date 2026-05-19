---
name: diffagent-diff
description: Open the diffagent diff viewer in the browser to see your changes
user-invocable: true
---

# Diffagent Diff Skill

You are opening the diffagent diff viewer so the user can see their changes in the browser.

## Arguments

- `ref` (optional): Git ref to diff (e.g. `main..feature`, `HEAD~3`) or a GitHub PR URL (e.g. `https://github.com/owner/repo/pull/123`). Defaults to working tree changes.

## Instructions

1. Check that `diffagent` is available: run `which diffagent`. If not found, install it with `npm install -g diffagent`.
2. Run `diffagent <ref>` (or just `diffagent` if no ref) using the Bash tool with `run_in_background: true`:
   - The CLI handles everything: if an instance is already running for this repo it reuses it and opens the browser, otherwise it starts a new server and opens the browser.
   - Do NOT use `&` or `--quiet` — let the Bash tool handle backgrounding.
3. Wait 2 seconds, then run `diffagent list --json` to get the port.
4. Tell the user diffagent is running. Print the URL and keep it short — don't show session IDs, hashes, or other internals. Example:

   > Diffagent is running at http://localhost:5391
   >
   > When you're ready:
   > - Leave comments on the diff in your browser, then run **/diffagent-resolve** to fix them
   > - Or run **/diffagent-review** to get an AI code review

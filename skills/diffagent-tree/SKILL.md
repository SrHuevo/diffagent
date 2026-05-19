---
name: diffagent-tree
description: Open the diffagent file tree browser to browse and comment on repository files
user-invocable: true
---

# Diffagent Tree Skill

You are opening the diffagent file tree browser so the user can browse repository files in the browser.

## Instructions

1. Check that `diffagent` is available: run `which diffagent`. If not found, install it with `npm install -g diffagent`.
2. Run `diffagent tree` using the Bash tool with `run_in_background: true`:
   - The CLI handles everything: if an instance is already running for this repo it reuses it and opens the browser, otherwise it starts a new server and opens the browser.
   - Do NOT use `&` or `--quiet` — let the Bash tool handle backgrounding.
3. Wait 2 seconds, then run `diffagent list --json` to get the port.
4. Tell the user diffagent tree is running. Print the URL and keep it short — don't show session IDs, hashes, or other internals. Example:

   > Diffagent tree is running at http://localhost:5391
   >
   > When you're ready:
   > - Leave comments on any file in your browser, then run **/diffagent-resolve-tree** to fix them

---
description: Show live receipts status (tests ✔ build ⏳ lint ✗) in the Claude Code status line
allowed-tools: Bash(node:*), Read, Edit
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/receipts.js" install-statusline`

The JSON above contains a status line shim path and the `settings` snippet to enable it.

1. Read the user's `~/.claude/settings.json` (create it as `{}` if missing).
2. If it has no `statusLine`, add the `statusLine` from the snippet.
3. If it already has a `statusLine` command, keep it: set the command to the `wrapExample` form with their existing command in place of `<your existing statusLine command>`, so both are shown.
4. Tell the user what you changed and that the status line updates on their next message.

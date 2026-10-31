---
description: Generate a Markdown verification receipt for a PR description — what actually ran, not what was claimed
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/receipts.js" report --md --session "${CLAUDE_SESSION_ID}"`

The Markdown above is a verification receipt built from this session's transcript. Show it to the user in a fenced `markdown` block so they can copy it. If a pull request for the current branch is being written or already exists and the user asked for it, add this block to the end of its description; otherwise just show it. Do not edit the table's results.

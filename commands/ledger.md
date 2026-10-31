---
description: Show the evidence ledger — what was actually verified in this session, what's stale, what failed
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/receipts.js" report --session "${CLAUDE_SESSION_ID}"`

Show the ledger above to the user exactly as printed, inside a code block. Then, in one or two sentences, say which checks are missing, failed or stale relative to the latest edits, and offer to run them. Do not run anything unless the user asks.

---
description: Replay your past Claude Code sessions and count the unbacked "tests pass" claims receipts would have caught
argument-hint: "[--days N] [--here] [--examples N]"
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/receipts.js" scan $ARGUMENTS`

Show the scan above to the user exactly as printed, inside a code block. Then summarise in two sentences: how often claims were unbacked, and the most common reason. Everything was computed locally from their own transcripts; nothing was sent anywhere.

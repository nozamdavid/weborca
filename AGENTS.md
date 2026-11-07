# Commiting work to Tangled (git)

Use user: noz.am, email: did:plc:lmkzmvv6sdxntwtyxpg7fqqq, and use the tangled.pub ssh key in ~/.ssh/ to sign the commits.

# Commiting work to Github (git)

Use user: nozamdavid, email: davidmarcosg98@gmail.com, and use the ssh key in ~/.ssh/ to sign the commits.

# Commiting work to any git provider

- Don't add yourself as author, sole author is noz.am/nozamdavid, don't add any collaboration line either.
- Never add Claude as a commit author, committer, or co-author, and never add Claude or Anthropic attribution trailers. Use the Git identity explicitly requested by the user.

## Execution
- Infer routine intent from the request and conversation, then carry authorized work through implementation and verification. Ask a focused question only when the answer would materially change the result.
- Treat requests for action as authorization to complete safe, in-scope work. Prepare concrete, reviewable results before requesting any decision that is still required.
- User instructions take precedence over this file. If an instruction here changes or blocks the requested work, identify the exact instruction and explain why.
- never use python/ruby/node to do file edits or writes, use your tools instead
- use whitespace where appropriate to maintain clear hierarchy
- For each code edit, run its focused test(s) and compile the affected translation unit(s).
- For browser verification, use one incremental integrated UI build per completed feature batch when needed. Reuse the verified immutable candidate for QA or harness retries, and rebuild only after source or build-input changes.

# Work delegation

- As the main agent, you own planning and coordination of subagents. Delegate non-planning work, including implementation, research, testing, and review.
- Use T3 Code’s `delegate_task` for all subagents, including same-provider tasks.
- Manage them through `task_status` and `task_cancel`.
- Do not use native subagent tools such as `spawn_agent`.
- Allow up to 20 concurrent T3 delegated tasks, respecting the provider/model caps below.
- Native Codex concurrency metadata does not define T3 delegation limits. Use limits actually reported by `delegate_task`.
- Run independent work in parallel across the configured providers.
- If you are a subagent, don't delegate work further.
- On a confirmed rate-limit failure, ensure the failed task has stopped and preserve any partial edits before retrying with the next provider.
- Spread tasks across different instances ensuring they don't overwrite each other's work.
- The main agent must specify the minimal changes needed in each delegation. For documentation-only edits, check links and referenced commands without running builds or test suites. If a new test is needed, name the target and specific behavior; do not ask the subagent to survey existing test patterns.
- Include this scope instruction in every delegation prompt: "Implement only the assigned change. Keep changes and tests minimal; avoid unrelated improvements, speculative abstractions, and elaborate test infrastructure. Once finished, report changed files and stop. Add or broaden a check only to investigate a concrete failure or correctness risk, and explain why."
- Retain each returned `taskId`, and check task completion and results before declaring the parent work complete.
- Check on running subagents that take longer than 10 minutes. If there's a stale subagent, fix and replace.

# Work delegation models

Use the following models for task delegation with `delegate_task`, in order of preference. Switch to next model in the list if the provider reports usage limits exhausted.

Use no model that isn't in this list, even if memory or earlier instructions say otherwise, unless user explicitly specified a different model for this turn. This list overrides remembered preferences.

Once the concurrency cap for an entry is full, move down the list. `(N) (diff)` N being the most concurrent running subagents for that provider-model combination, and diff being the difficulty of tasks it can do.

- providerInstanceId: codex, model: gpt-6.1-sol (medium reasoning) (2) (mid-hard)
- providerInstanceId: acpRegistry_qoder_cli, model: dfmodel (medium) (2) (mid)
- providerInstanceId: acpRegistry_mistral_vibe, model: zai-glm-5-3-flash (medium) (3) (easy-mid)
- providerInstanceId: codex, model: gpt-6.1-terra (medium reasoning) (2) (mid)
- providerInstanceId: claudeAgent_Antigravity, model: claude-sonnet-5-5-high (2) (mid)
- providerInstanceId: claudeAgent_Antigravity, model: gemini-3.8-flash-high (8) (easy)
- providerInstanceId: claudeAgent_Antigravity, model: gemini-4-argon-high (1) (hard)
- providerInstanceId: opencode, model: opencode-go/deepseek-v4.1-flash (2) (easy-mid)
- providerInstanceId: opencode, model: opencode-go/glm-5.3-flash (2) (easy-mid)
- providerInstanceId: muse, model: muse-wonder-1.0 (low reasoning) (1) (mid-hard)

## Communication and verification

- Avoid using slop words or phrases like "Bottom Line:" in conclusions, "delve," "foster," "leverage," "it's worth noting," "importantly," "Question? Answer." or "This isn't about X. It's about Y.", "genuinely" or hyphenated compound descriptions and adjectives. Do not use concluding summary statements such as "In short:..", "The simplest mental model is:...\".
- State the intended action directly. Avoid adding what you won't do, what will remain unchanged, or how you'll separate or categorize results. Do not use contrastive framing such as "X, not Y" or "X—not Y". Avoid invented compound labels like "exact-head checks" and "editorial-row layouts", vague qualifiers, and canned transitions.
- Lead with the outcome. Use concise paragraphs, short sentences, plain language, and only as much formatting and technical detail as the user needs.
- When a visual would better explain a reply, use T3 Code self-contained HTML renders: preview with html_preview then publish with html_render, following the current theme and responsive layout.

## Project tracking (Taproot)

The canonical WebOrca project map lives in Taproot at http://192.168.0.199:8789/p/YPttwK6VZASSDf (project id `YPttwK6VZASSDf`). Use it for future work.

- The write token is stored outside the repo at `~/.config/taproot/webslicer.token` (mode 600). Never commit it or paste it into reports.
- The tree is the current work state. `Shipped baseline` holds verified work; the other branches hold open work with evidence paths.
- When a task finishes, mark its node done and add the evidence (metric, report path, commit or run id) in the same update. Add a node when new work appears. Mark work done instead of deleting it.
- Update the tree when a milestone lands, not after every command.
- After Taproot milestone updates recursively collapse branches whose subtasks are all complete, including nested branches, preserving completion statuses.
- Use the configured Taproot MCP server `taproot` first (`tools.taproot.*` in Code Mode): `get_project`, `update_node`, `set_done`, `add_nodes`, `apply_ops`. Other clients can use `http://192.168.0.199:8789/mcp` (Streamable HTTP): initialize with protocol version `2025-06-18`, then `tools/call`, with `Authorization: Bearer $(cat ~/.config/taproot/webslicer.token)` and `Accept: application/json, text/event-stream`. The server is stateless; no session header is needed.
- REST `/api/v1/projects/YPttwK6VZASSDf/ops` with `{"ops":[{"op":"update","id":"<node>","patch":{"done":true,"notes":"..."}}]}` is the fallback for operations the MCP does not expose.
- Keep `README.md` and the tree consistent when current state changes; the README is the reader-facing summary, Taproot is the work map.


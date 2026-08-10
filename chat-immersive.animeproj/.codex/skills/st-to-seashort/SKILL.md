---
name: st-to-seashort
description: Migrate or adapt SillyTavern character cards into the current SeaShort role-world web project. Use when Codex needs to inspect an ST/ccv3 card, port regex scripts, world books, MVU/JSONPatch variables, HTML panels, slash-command interactions, profile forms, status bars, or other ST-specific behavior into src/card.json, src/App.tsx, src/styles.css, and project components.
---

# ST To SeaShort

Use this skill to adapt SillyTavern cards into the current `.animeproj` project without assuming a fixed local path or a specific sample project.

## Default Workflow

1. Read `.seashort/knowledge.md` first.
2. Inspect the current project files that matter for the task:
   - `src/card.json` for ccv3 card data, world book entries, regex scripts, prompts, and presets.
   - `src/App.tsx` and `src/styles.css` for the role-world UI.
   - `src/engine.ts` only when runtime wiring is relevant.
3. Inspect the source ST card or exported ccv3 JSON. If the source is a PNG card, extract or locate its embedded ccv3 data before editing.
4. Classify the source card:
   - L1/L2: mostly prompt/world-book migration.
   - L3: state bar, variables, regex hiding/rendering, or update blocks.
   - L4: interactive HTML panels, profile forms, slash commands, maps, mini apps, or custom JS.
5. Apply the smallest faithful migration:
   - Keep card truth in `src/card.json`.
   - Port ST frontend calls to SeaShort-compatible React/runtime bridges.
   - Keep visual/project code in `src/App.tsx`, `src/styles.css`, and `src/components/`.
6. Run `bun run card:validate` after editing `src/card.json`.
7. Run `bun run build` after substantial UI/runtime changes.
8. For live preview verification, use the local `$seashort-cdp-debug` skill when available.

## Migration Rules

- Preserve the original card's roleplay logic, prompt contract, world-book intent, and regex semantics where practical.
- Replace ST browser globals and slash-command dependencies with project-owned bridges:
  - `triggerSlash(...)`, direct Tavern DOM writes, or `send_textarea` writes should become `window.parent.postMessage({ type: 'st-bridge', action: 'send', text }, '*')` or an equivalent app-local bridge.
  - ST variable formatting such as `{{format_message_variable::stat_data}}` should become SeaShort variable reads such as `{{getvar::stat_data_yaml}}` when the project maintains that variable.
- Keep hidden update blocks hidden. Every LLM contract that emits `<UpdateVariable>`, `<Analysis>`, `<JSONPatch>`, or similar data blocks needs a matching hide/cleanup path.
- Use React components for persistent UI such as status bars when the UI should update from runtime state rather than static regex output.
- Use iframe/srcdoc rendering for untrusted or script-bearing HTML panels. Use inline rendering only for trusted display-only fragments.
- Do not add new framework dependencies unless the migration genuinely requires them.

## Reference Routing

Read `references/methodology.md` when the card has ST-specific complexity such as regex panels, MVU/JSONPatch variables, status bars, profile forms, or interactive HTML.

For simple L1/L2 prompt-only cards, this `SKILL.md` is usually enough.

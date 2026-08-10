# SillyTavern To SeaShort Methodology

Use this reference for complex ST card migrations. It is written for seedable `.animeproj` projects, so it avoids fixed local paths and sample-project assumptions.

## Architecture Mapping

| SillyTavern Mechanism | SeaShort Project Pattern |
|---|---|
| ccv3 card metadata | `src/card.json` remains the card SSOT |
| Regex HTML panels | `@seashort/world-render` regex rendering plus `MessageBody` iframe/inline/prose segmentation |
| Slash commands / Tavern DOM writes | `postMessage` bridge handled in `src/App.tsx` |
| MVU / MagVarUpdate JSONPatch | project script or runtime helper applies RFC6902 updates into engine variables |
| `{{format_message_variable::stat_data}}` | `{{getvar::stat_data_yaml}}` or another project-owned serialized variable |
| jQuery status panel polling | React component subscribed to `uiBridge` or engine variables |
| ST profile/world-book form writes | store structured profile data in variables and let world-book entries read it |

## Regex Rendering

Preserve the original regex array when possible, then adapt output rendering.

Typical rendering strategy:

```ts
import { renderTurn } from '@seashort/world-render';

const rendered = renderTurn(message.content, CARD.regexScripts ?? []);
```

For mixed content, split assistant output into:

- iframe segments for fenced HTML or script-bearing panels.
- inline HTML segments for trusted static fragments.
- prose segments for ordinary roleplay text.

If a regex emits a stable placeholder, keep the placeholder contract and render it with a dedicated regex or React component. Make sure `system_prompt` and `regex_scripts.findRegex` agree exactly.

## MVU / JSONPatch Variables

Many ST cards emit update blocks like:

```xml
<UpdateVariable>
<Analysis>...</Analysis>
<JSONPatch>
[
  { "op": "replace", "path": "/scene/day", "value": 2 }
]
</JSONPatch>
</UpdateVariable>
```

Port this with a project-owned parser/applier:

- Extract complete `<UpdateVariable>` blocks from assistant messages.
- Parse `<JSONPatch>` as JSON, with limited tolerance for common LLM mistakes such as trailing commas.
- Support only the operations the card contract requires, usually `add`, `replace`, and `remove`.
- Decode JSON Pointer paths (`~1` to `/`, `~0` to `~`).
- Clamp bounded values such as affection, love, stamina, progress, or money when the source card expects clamps.
- Persist both machine-readable state and LLM-readable state when needed, for example `stat_data` and `stat_data_yaml`.
- Emit UI updates through a local event bridge when React components need to update immediately.

Every update block should also be hidden from user display and prompt replay unless the card intentionally exposes it.

## HTML Panel Interaction

Replace ST-specific interactions:

```js
triggerSlash('/send 我选择A');
document.getElementById('send_textarea').value = '...';
```

with a frame-to-app bridge:

```js
window.parent.postMessage({
  type: 'st-bridge',
  action: 'send',
  text: '我选择A'
}, '*');
```

Handle the message in `src/App.tsx`:

```ts
useEffect(() => {
  const onMessage = (event: MessageEvent) => {
    const data = event.data as { type?: string; action?: string; text?: string; profile?: unknown };
    if (!data || data.type !== 'st-bridge') return;
    if (data.action === 'send' && typeof data.text === 'string') {
      engine.send(data.text);
    }
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}, [engine]);
```

For profile forms, use a distinct action such as `profile-submit`, store the profile in an engine variable, and trigger the card's next scene with a concise system instruction.

## Status Bars

If the ST card renders a constantly updating status bar with regex and jQuery, prefer a React component when:

- the panel needs live updates from variables,
- the panel has tabs, drawers, progress bars, or derived values,
- the original regex output is noisy or duplicates state in the message stream.

Disable the old visual-only status regex in `src/card.json` only after the React replacement is wired and verified. Keep data-hiding regexes enabled.

## World Book And Variables

When ST world-book entries depend on formatted variable dumps:

1. Store the source variable tree in a local engine variable.
2. Serialize a readable copy as YAML or compact JSON.
3. Reference that value in the world book with `{{getvar::name}}`.
4. Keep constant entries only for information required every turn; otherwise use keyword-triggered entries.

Profile forms should usually write one structured variable such as `user_profile`; the corresponding world-book entry can read it directly.

## Migration Checklist

1. Inspect source card:
   - ccv3 fields.
   - regex script count, order, disabled flags, and prompt/display flags.
   - world-book entries and activation keys.
   - first message, profile forms, status bar, and custom HTML panels.
   - ST-only calls such as `triggerSlash`, `TavernHelper`, jQuery selectors, and direct textarea writes.
2. Edit card data:
   - Move final card truth to `src/card.json`.
   - Keep prompt contracts explicit.
   - Add or update hide/render regexes as needed.
3. Edit UI/runtime only when the card needs it:
   - `src/App.tsx` for bridge and layout.
   - `src/styles.css` for visual tokens and component styling.
   - `src/components/` for reusable panels/status bars/renderers.
4. Validate:
   - `bun run card:validate` after card edits.
   - `bun run build` after substantial UI/runtime edits.
   - `$seashort-cdp-debug` for live preview automation and screenshots when available.

## Common Failures

- Regex does not render: check JSON escaping, disabled flags, regex order, and whether the placeholder text matches exactly.
- Update variables leak into chat: add or fix the hidden cleanup regex and strip partial streaming blocks in display code.
- HTML panel clicks do nothing: check `postMessage` payload shape, iframe sandbox permissions, and the app-side listener.
- React input automation changes DOM but not state: use the native input/textarea value setter and dispatch `input` plus `change`.
- World-book variable reads stay empty: check that the variable is set before prompt assembly and that the world-book entry is constant or triggered.

## Validation Evidence

Keep evidence local and concrete:

- `bun run card:validate` output.
- `bun run build` output when applicable.
- screenshots under `.verify-shots/`.
- DOM/runtime snapshots from `$seashort-cdp-debug inspect` or `eval`.

Do not claim a live preview is correct from a green build alone; runtime rendering, iframe behavior, and bridge interactions should be checked in the embedded preview for L3/L4 cards.

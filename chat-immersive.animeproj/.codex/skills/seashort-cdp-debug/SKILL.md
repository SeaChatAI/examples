---
name: seashort-cdp-debug
description: Debug and automate the SeaShort Electron WebIDE preview for this .animeproj project through Chromium DevTools Protocol. Use when Codex needs to inspect the live Vite preview, query DOM, run JavaScript in the preview frame, scroll, type into fields, collect console/runtime evidence, or save verification screenshots from the Electron app instead of using Computer Use or a separate browser.
---

# SeaShort CDP Debug

Use Chromium DevTools Protocol as the primary live-preview debug path for this project. Attach to the SeaShort Electron renderer, inspect the current targets/frames, then operate on the frame that serves this `.animeproj` preview. Common local ports are only hints; discover the actual frame URL with `inspect`.

## Default Workflow

1. Read `.seashort/knowledge.md` before changing project files.
2. Confirm the Electron app has CDP enabled:
   ```bash
   node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs check
   ```
3. Inspect targets and frames:
   ```bash
   node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs inspect
   ```
4. For debugging, start with `doctor` to collect descriptor, frame, console/runtime/network, layout, and engine-state evidence in one output.
5. Operate on the preview frame with `eval`, `html`, `snap`, `net`, `logs`, `click`, `type`, `viewport`, `viewport-suite`, `audit-layout`, `engine-state`, `flow`, `screenshot`, `demo`, or `lifecycle`.
6. Save verification images under `.verify-shots/` and report exact paths.

## Script Routing

- Use `scripts/cdp-preview.mjs check` to verify the configured CDP endpoint.
- Use `scripts/cdp-preview.mjs descriptor` to read `.seashort/runtime.json`, environment overrides, and effective CDP/preview targeting.
- Use `scripts/cdp-preview.mjs inspect` to list the Electron page target, frames, focused inputs, and basic preview DOM state.
- Use `scripts/cdp-preview.mjs eval --expr '<js>'` to run JavaScript in the Vite preview frame.
- Use `scripts/cdp-preview.mjs html [--selector '<css>']` to inspect rendered markup in the preview frame.
- Use `scripts/cdp-preview.mjs snap` to capture an accessibility-tree snapshot for UI structure.
- Use `scripts/cdp-preview.mjs net` to collect resource timing from the preview frame.
- Use `scripts/cdp-preview.mjs logs [--duration 3000]` to collect console calls, runtime exceptions, CDP log entries, failed requests, HTTP error responses, and Vite overlay text.
- Use `scripts/cdp-preview.mjs doctor [--duration 1500]` as the default health probe for preview frame, logs, network, layout, and engine state.
- Use `scripts/cdp-preview.mjs click --selector '<css>'` for DOM clicks in the preview frame.
- Use `scripts/cdp-preview.mjs clickxy --x <n> --y <n>` and `scripts/cdp-preview.mjs type --text '<text>'` for raw CDP input events.
- Use `scripts/cdp-preview.mjs viewport --preset mobile --name '<file.png>'` for one viewport screenshot.
- Use `scripts/cdp-preview.mjs viewport-suite --presets desktop,tablet,mobile` for repeatable responsive screenshot coverage.
- Use `scripts/cdp-preview.mjs audit-layout --preset mobile` to detect overflow, clipped content, small click targets, possible fixed overlaps, unlabeled inputs, and raw CSS colors.
- Use `scripts/cdp-preview.mjs engine-state` to dump `window.__SEASHORT_DEBUG__` / engine snapshot evidence.
- Use `scripts/cdp-preview.mjs flow --file '.verify-flows/main.json'` to run a reusable JSON interaction flow.
- Use `scripts/cdp-preview.mjs evalraw --method '<CDP.method>' [--params '{}']` for custom CDP commands.
- Use `scripts/cdp-preview.mjs screenshot --name '<file.png>'` to capture the preview frame or full Electron viewport.
- Use `scripts/cdp-preview.mjs demo --text '<text>'` to scroll the preview, fill the chat textarea without sending, and capture a screenshot.
- Use `scripts/cdp-preview.mjs lifecycle --text '<text>'` to fill the composer, send, wait for an assistant response, and save a final screenshot.

Do not read the script into context unless you need to patch it. Execute it directly.

## CDP Assumptions

- SeaShort Electron dev mode should expose CDP on `127.0.0.1`. Read `.seashort/runtime.json` or run `descriptor`; common ports are only hints.
- If the port is different, pass `--port <number>` or set `SEASHORT_CDP_PORT`.
- The SeaShort WebIDE writes `.seashort/runtime.json` with current preview/CDP information when it starts a preview. Treat it as runtime evidence, not as seed documentation.
- If `check` cannot connect, restart SeaShort after enabling `remote-debugging-port` in the Electron main process.
- Do not use Computer Use for normal preview automation; use it only as a fallback when CDP is unavailable and the user accepts UI-level control.

## References

Read `references/cdp-workflow.md` only when you need implementation details, troubleshooting, or custom CDP commands.

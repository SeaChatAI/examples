# Player source ownership (embedded Experience)

This directory is **project-owned Player UI**, originally vendored from the shared player surface:

```text
@seachat/sdk/play  (mirror: sdks/seachat-sdk/play/src/player/**)
```

## Contract

| Layer | Owner |
| --- | --- |
| `src/player/**` | **This Experience** — edit freely (copy, layout, chrome) |
| `@seachat/sdk/render` | Protocol / ActorEngine |
| `@seachat/sdk` | Auth / worldcompute URL |
| `@seashort/card-kit` | Shared session drawer primitives |

Shared player (`chat-immersive` / platform `immersive-chat`) still uses the package.
Embedded custom worlds ship its own UI tree so creators can customize without forking the monorepo SDK.

## Upgrade (opt-in)

Re-copy from the SDK when you want upstream UI fixes; resolve conflicts yourself.
There is no silent framework overwrite of `src/player/**` on open.

## Skin syncs

| Date | Source | Scope |
| --- | --- | --- |
| 2026-07-18 | SDK `649fed188` (深空画框 · 香槟金) | Visual layer only: `styles.css` token 换血 (深空 + 香槟) + serif `--display` + `.microlabel` + portrait 引言化; `card-presentation.ts` accent 回退链 (`presentation.accent` → clamp `img_primary_color` → `#d6b57c`); `@fontsource/playfair-display` + `@fontsource/noto-serif-sc`. Layout / copy / mobile soft-keyboard forks preserved. |

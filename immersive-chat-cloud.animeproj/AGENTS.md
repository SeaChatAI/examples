# Cloud Actor Experience · conventions

This `.animeproj` is a **publishable embedded Experience**: single card + cloud worldcompute + **project-owned** TS render.
When changing this project, prioritize **`bun run build` + live seachat.ai**, then local dogfood.

**Not** a multi-card host / catalog shell.

## Sources of truth

| Path | Role |
| --- | --- |
| `src/card.json` | ccv3 + Play seed (cover / tags / category / gender / nsfw); top mirrors `data` |
| `src/engine.ts` | `ActorEngine` + `actorPlayerRuntime` (bound injected by caller) |
| `src/actor-transport.ts` | transport: `worldcomputeBaseUrl()` → `/api/worldcompute` |
| `src/main.tsx` | sole boot: install transport → bind card → mount local PlayerCore |
| `src/player/**` | **This Experience's Player UI** (edit copy / layout / chrome freely) |

Protocol and auth stay on packages: `@seachat/sdk/render`, `@seachat/sdk`, `@seashort/card-kit`.
`src/player` started as a vendor of `@seashort/runtime-immersive-chat`; see `src/player/ORIGIN.md`.

Product UI copy and the seed card are **English**.

## Pre-publish checks

```bash
bun run check
# Studio publish gates also need: cover file, non-empty blurb, tags, category, gender, nsfw declaration
```

- Production build defaults to **live**; no Vite proxy required
- Command bodies must not carry card / snapshot / llmApiKey
- Do not start local `world_compute_actor`
- Do not maintain `public/catalog`

## Discipline

- Do not patch sibling examples / Electron / bun-server to "fix this card"
- Do not commit `node_modules`, `dist`, `.accept/`, screenshots
- Do not put SDK unit tests / re-export shells back into this project
- Do not re-bind `src/player/**` to `@seashort/runtime-immersive-chat` (shared host still uses the package)

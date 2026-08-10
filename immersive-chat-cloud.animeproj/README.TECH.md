# Technical appendix (embedded Experience)

| Layer | Backend |
| --- | --- |
| Compute + state + LLM | `worldcomputeBaseUrl()` → seagate `/api/worldcompute` |
| Render client | `@seachat/sdk/render` `ActorEngine` |
| UI | **project-owned** `src/player/PlayerCore` (vendored; editable) |
| Character | This project's `src/card.json` only |

## Source roles

| Path | Role |
| --- | --- |
| `src/card.json` | ccv3 + Play seed |
| `src/engine.ts` | re-export `./player` Actor runtime + transport helper |
| `src/actor-transport.ts` | browser transport → `/api/worldcompute` |
| `src/main.tsx` | mount local PlayerCore (single bind + install) |
| `src/player/**` | Experience-owned Player UI / session / models |

No `public/catalog`, no multi-card `?cardId=` path.

## URL

```ts
import { worldcomputeBaseUrl } from '@seachat/sdk';
worldcomputeBaseUrl() // https://seachat.ai/api/worldcompute
```

Optional dogfood: `VITE_WORLD_COMPUTE_BROWSER_BASE=/__worldcompute` + Vite rewrite (not product default).

## Auth

Browser → seagate unified login; LLM billing via `model:invoke` delegation. No separate worldcompute account.

## Scripts

```bash
bun run accept:cloud-live
bun run accept:cloud-ui
bun run accept:hard
bun run ./scripts/probe-leo-live.ts   # optional multi-turn persona probe
```

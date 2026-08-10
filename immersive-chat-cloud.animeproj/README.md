# Love That Won't Collapse · Cloud Actor Experience

**Embedded** single-card world: `src/card.json` is the character SSOT (Leo Deoraphly). Dialogue **compute / state / LLM** run at
`https://seachat.ai/api/worldcompute` (platform `seachatUrl` SSOT). The browser only does command + SSE + render.

```text
card.json → ActorEngine → src/player/PlayerCore
              Authorization → seagate → worldcompute
```

This project is an **embedded custom world**, not a multi-card catalog shell.
Player UI lives in `src/player/**` (project-owned) and can be customized without forking the monorepo SDK.

## Publish (Studio)

1. Open this project in SeaShort
2. Confirm cover / blurb / tags / category / gender / NSFW are ready (seeded in the card)
3. **Build** → **Publish to Play** (full embedded `dist/` bundle)
4. Players open `https://{slug}.play.seachat.ai` → sign in → chat

No local Actor process. Auth and billing match other SeaChat capabilities.

## Local development

```bash
bun install && bun run dev         # default :5288 (WEBIDE_PORT overrides)
bun run check                      # test + tsc + build + card:validate
```

**Blank screen / Vite ENOENT `.vite/deps_temp_*`**: usually an old hybrid `link-deps` left `node_modules/.vite` pointing at a dead sibling path.
Fix: `rm -rf node_modules && bun install && bun run dev` (avoid `dev:hybrid` unless the sibling is installed).

- `?debug=1`: show debug chip
- `?stub`: **dev only** stub LLM; production build forces live
- same-origin dogfood: `VITE_WORLD_COMPUTE_BROWSER_BASE=/__worldcompute` (optional)

## Acceptance scripts (optional)

```bash
bun run accept:cloud-live   # SEACHAT_PROD_EMAIL_LOGIN_*
bun run accept:cloud-ui
bun run accept:hard
# Leo multi-turn persona probe (not CI): bun run ./scripts/probe-leo-live.ts
```

Env: `ACCEPT_CLOUD_MODEL` / `ACCEPT_CLOUD_MESSAGE` / `ACCEPT_CLOUD_UI_MESSAGE`.

Conventions: `AGENTS.md`. Tech notes: `README.TECH.md`.

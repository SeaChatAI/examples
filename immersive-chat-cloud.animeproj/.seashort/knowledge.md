# Project knowledge

## Architecture

- **embedded** single-card Experience: full bundle to `*.play.seachat.ai`
- Actor base = platform SSOT `worldcomputeBaseUrl()` (`https://seachat.ai/api/worldcompute`)
- Browser sends pure commands + `Authorization` only
- Production build forces `llmMode=live`; stub only when `import.meta.env.DEV`
- Character SSOT: `src/card.json` (top mirrors `data`; no catalog)
- Product UI is English; seed card narrative is **Chinese**.

## Publish seed (in card)

- `description`: storefront blurb
- `tags`: OC / Fictional / Dominant / Mafia / Arranged Marriage / …
- character prose: Chinese (maintext + Status content)
- `extensions.seashort.cover` / `category=roleplay` / `gender=male` / `nsfw=false`

## Non-goals

- multi-card host / `public/catalog` / `?cardId=`
- local Redis / Actor process
- re-export or unit-test SDK internals inside this project

## Card quality

- Leo card v2 tuned for **deepseek-v4-flash**: hard rules first, short WI, protocol triple (PHI + examples + regex), tighter sampling.
- Live rubric: `bun run ./scripts/probe-leo-live.ts` → `.accept/leo-probe-live.json`

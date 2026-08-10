# 项目知识（本网站的记忆）

> 这里记录本网站的架构决策、设计约定、别动的东西、用户偏好。
> Agent 每轮开工前应先读本文件；做出重要架构/设计决策后，把要点追加进来。

## 架构决策
- .animeproj 根目录就是 Vite Web 工程。
- 角色卡数据是 src/card.json；生成素材放在 public/assets/*。
- 当前卡「Kieran Vale」走 shared immersive-chat 运行时：项目壳薄封装，UI/会话由 `@seachat/sdk/play` 驱动。
- 封面资产：`public/assets/characters/kieran-vale-cover.webp`，由 `data.extensions.seashort.cover` 绑定。

## 设计约定
- 一切颜色/间距/圆角走 shared player 的 CSS tokens；保持 light/dark 双主题可用。
- 展示文案优先 `extensions.seashort.presentation`，不要直接把长 description 塞进资料卡。
- 显示管线：shared player 的 `message-display` 跑 markdownOnly 正则并格式化消息 HTML。

## 别动的东西（红线）
- 框架文件（vite.config.ts / main.tsx / package.json 等）由平台同步，勿手改。
- `engine.ts` 仅允许导出 runtime 所需的 `engineOptions` / `createLlmClient` 之类薄封装，不改装配语义。
- `src/card.json` 的创作内容（角色设定/世界书/开场等）未经创作者要求不得改动。

## 已知限制
- 封面目前为占位图，路径固定为 `public/assets/characters/kieran-vale-cover.webp`。

## 用户偏好
- （随对话逐步补充）

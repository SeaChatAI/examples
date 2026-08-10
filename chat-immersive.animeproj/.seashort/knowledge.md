# 项目知识（本网站的记忆）

> 这里记录本网站的架构决策、设计约定、别动的东西、用户偏好。
> Agent 每轮开工前应先读本文件；做出重要架构/设计决策后，把要点追加进来。

## 架构决策
- .animeproj 根目录就是 Vite Web 工程。
- 角色卡数据是 src/card.json；生成素材放在 public/assets/*。
- 当前卡「蔚轶」是 ST L4 regex 协议卡：开场主页 + 状态栏 + 双面人格面板 + 手机 msg/rednote 标记。
- 交互面板经 iframe srcdoc 渲染；ST 的 `triggerSlash` / `getChatMessages` 已改成 `window.parent.postMessage({ type: 'st-bridge', ... })`。
- App 监听 `st-bridge`：`send` 发消息，`select-opening` 用 `greetingIndex` 重建引擎切入 alternate_greetings。

## 设计约定
- 一切颜色/间距/圆角走 styles.css 的 CSS 变量 tokens；保持 light/dark 双主题可用。
- 侧栏文案优先 `extensions.seashort.presentation.blurb`，不要直接把 YAML 长 description 塞进资料卡。
- 显示管线：`message-display.ts` 跑 markdownOnly 正则 → 分段 prose / iframe / msg / rednote。

## 别动的东西（红线）
- 框架文件（vite.config.ts / main.tsx / package.json 等）由平台同步，勿手改。
- `engine.ts` 仅允许导出 runtime 所需的 `engineOptions` / `createLlmClient` 之类薄封装，不改装配语义。

## 已知限制
- 柏柏小手机（tavern_helper 外链 CDN）未完整移植；`<msg>` / `<rednote>` 在 Web 里用本地卡片样式呈现。
- 「妻子的诱惑」世界书默认关闭；需要时在卡里启用对应 constant 条目。

## 用户偏好
- （随对话逐步补充）

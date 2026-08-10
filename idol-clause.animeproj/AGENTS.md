# 角色世界 Web 工程 — Agent 制卡指南

这是 **SeaShort 的角色世界 Web 工程**。`.animeproj` 根目录本身就是一个 Vite + React + TypeScript 项目，用来打造专属、可交互的 AI 角色世界。Agent 会话默认在本 `.animeproj` 根目录工作，可以直接读写工程文件。

本文件会作为新项目 seed 的一部分。所有说明必须保持项目相对化：使用相对路径，不写死本机绝对路径、用户目录、具体示例项目名或固定端口；端口、预览 frame 和宿主页面以实际运行时探测结果为准。

## 使命

你是 SeaShort 的内嵌创作智能体，为本 `.animeproj` 角色世界工程的创作者工作。使命：把创作者的想法变成超高质量、真实可玩、可发布上线的互动角色世界。质量标准是真实验收——真卡、真模型、真预览跑通才算完成；出错修根因到绿，不交半成品，不把失败留给用户。

## 所处环境

- 你运行在 SeaShort 桌面 App（Electron）的智能体面板里；用户在同一窗口看到 WebIDE 文件树、实时预览和无限画布，你改的文件用户即刻可见。
- 会话 cwd 就是本工程根。预览由宿主管理、存盘即热更，不要自己另起 dev server。
- LLM 与图/视频/音频生成统一走 SeaChat 网关（`https://seachat.ai`），卡运行时经宿主代理接入，无需配置任何 key。
- 宿主能力入口 env：`$SEASHORT_RPC_BASE`（bun-server 地址）、`$SEASHORT_RPC_TOKEN`（鉴权 token）、`$SEASHORT_CDP_PORT`（CDP 调试端口，可能为空）。

## 宿主能力（RPC）

宿主 bun-server 暴露统一 RPC：`POST $SEASHORT_RPC_BASE/rpc`，header `x-seashort-token`，body `{"command","args"}`，响应 `{ok,data}` 或 `{ok,error}`：

```bash
curl -s -X POST "$SEASHORT_RPC_BASE/rpc" \
  -H "content-type: application/json" \
  -H "x-seashort-token: $SEASHORT_RPC_TOKEN" \
  -d '{"command":"webide_status","args":{"projectPath":"'"$(pwd)"'"}}'
```

关键命令（`projectPath` 一律传本工程根的绝对路径）：

| 命令 | 用途 |
|---|---|
| `webide_status` | 预览 dev server 状态（running/port/url） |
| `webide_get_logs`（`onlyErrors?: true`） | 读宿主侧 vite 日志——预览异常排错第一入口 |
| `webide_validate_card` / `webide_build` | 等价 `bun run card:validate` / `bun run build` 的宿主侧入口 |
| `import_character_card` / `export_character_card` | ccv3 PNG 卡导入 / 导出 |
| `read_project_card` / `save_project_card` | 读写 `src/card.json`（写入含规整） |
| `import_oai_preset` / `export_oai_preset` | OAI 预设导入 / 导出 |
| `canvas_bridge_status` / `canvas_bridge_get_state` / `canvas_bridge_apply_ops` | 无限画布桥：查在线画布、读快照、下发节点/生成操作。用法详见 `$canvas-ops` 技能 |
| `webide_publish_play` | 发布上线，产出 `https://<slug>.play.seachat.ai`（见「发布纪律」） |

## 素材生成

图、视频、音频生成经画布桥完成（`$canvas-ops` 技能的 `run_generation`），默认模型：图 `gpt-image-2`、视频 `seedance-2`、音频 `mureka-latest`；完整白名单以运行时 `/canvas-llm/v1/models` 为准。生成产物自动落 `public/assets/canvas/`，可直接在 `src/App.tsx` 中引用为角色世界的素材。

## 发布纪律

发布是外向动作：仅当用户明确要求「发布 / 上线」时才执行 `webide_publish_play`；发布前 `bun run card:validate` 与 `bun run build` 必须全绿；发布完成后把线上地址回报给用户。

## 核心心智模型

- Web 工程是主产品：`src/App.tsx` 和 `src/styles.css` 决定角色世界的界面、布局、状态栏、玩法和交互。
- 角色卡是核心资产：`src/card.json` 是本项目唯一角色卡真相源，格式是 ccv3 信封 `{ "spec": "chara_card_v3", "spec_version": "3.0", "data": { ... } }`。
- 制卡是核心职责之一。用户要求改角色设定、世界书、状态栏、正则、预设或开场时，应该直接编辑 `src/card.json`。
- 运行时由 `@seachat/sdk/render` 提供：提示组装、世界书扫描、宏、变量、正则渲染、协议解析、记忆和 tokenizer 都已经接好。
- 平台能力由 `@seachat/sdk` 提供；不要假设存在未声明的本地生成 CLI。
- 工程基建由 `@seashort/card-kit` 提供：vite 预设（SDK 源码直吃、代理、data-webide-loc 注入、预览桥注入）走 `@seashort/card-kit/vite`，运行时 facade 与通用组件走 `@seashort/card-kit/react`。改 card-kit 源码后需在本项目重装依赖才生效。

## 每轮开工

1. 先读 `.seashort/knowledge.md`，把里面的设计约定、红线和用户偏好当硬约束。
2. 根据任务读取相关文件：
   - 改体验：先看 `src/App.tsx` / `src/styles.css`。
   - 改卡：先看 `src/card.json`。
   - 调运行时：再看 `src/engine.ts`（card-kit 参数层）和 `@seashort/card-kit` 源码。
   - 迁移 ST 卡：使用项目内 `$st-to-seashort` 技能。
   - 调试嵌入预览：使用项目内 `$seashort-cdp-debug` 技能。
3. 只改用户请求相关的文件。优先做局部修改，确实需要整文件重写时再重写。
4. 修改 `src/card.json` 后必须运行：

```bash
bun run card:validate
```

验卡失败必须继续修到通过；不要把失败留给用户。

5. 完成一轮较大改动后必须运行：

```bash
bun run build
```

较大改动包括新增依赖、改 `vite.config.ts`、大改组件结构、修改运行时接线等。构建错误必须继续修到通过；不要把失败留给用户。

## 项目内技能

- `.codex/skills/seashort-cdp-debug/`：通过 Chromium DevTools Protocol 调试 SeaShort Electron 内嵌预览。需要 inspect DOM、输入、点击、滚动、等待回复、收集 console/runtime/network 证据、跑可配置交互流、多视口截图、布局审计或状态快照时使用。
- `.codex/skills/st-to-seashort/`：迁移或适配 SillyTavern/ccv3 角色卡。需要处理 ST 正则、MVU/JSONPatch 变量、HTML 面板、状态栏、profile 表单或 slash-command 交互时使用。
- `.codex/skills/canvas-ops/`：操作 SeaShort 无限画布，创建/编辑/连接节点、读取画布状态或触发素材生成时使用。

技能也是 seed 内容的一部分。维护技能时以 Codex 规范为源：`.codex/skills/<skill-name>/` 下放 `SKILL.md`、`references/`、`scripts/`、`agents/openai.yaml` 等标准结构。Claude Code 兼容入口只做软链接，不维护第二份副本。

兼容关系：

- `CLAUDE.md` 应软链接到 `AGENTS.md`。
- `.claude/skills` 应软链接到 `../.codex/skills`。

## 主要可编辑面

- `src/card.json`：角色卡 SSOT。角色名、描述、人格、世界设定、世界书、正则、预设都在这里。
- `src/App.tsx`：角色世界的主画布。界面布局、状态栏承载、消息流、按钮、玩法组件通常在这里改。
- `src/styles.css`：视觉系统。颜色、阴影、圆角、间距、主题变量都走这里。
- `src/components/`：需要拆组件时可新增文件。
- `.seashort/knowledge.md`：影响后续设计/架构决策的简短项目记忆。

## 框架文件红线

以下文件由 SeaShort 模板同步，通常不要改，除非用户明确要求修框架接线，或构建/运行错误证明必须改：

- `vite.config.ts`
- `tsconfig.json`
- `index.html`
- `src/main.tsx`
- `src/engine.ts`
- `package.json`

`src/App.tsx`、`src/styles.css` 和 `src/card.json` 不会被模板同步覆盖，是主要创作面。

## 路径与环境纪律

- 使用相对路径描述项目内文件，例如 `src/card.json`、`.verify-shots/foo.png`。
- 不在 seed 文件里写死本机绝对路径、用户目录、下载目录、具体示例项目名或固定工作区路径。
- 不把某次运行观察到的端口当成永久事实；预览端口、CDP 端口和宿主端口必须通过 `.seashort/runtime.json`、CDP `descriptor`/`inspect` 或运行时信息确认。
- 不默认另起 `bun run dev`。SeaShort 通常会在 Electron/WebIDE 内启动并嵌入预览；只有当前预览不可用且任务需要时，才考虑单独启动开发服务。
- 不默认用 Computer Use 或外部 Chrome 调试预览；优先用项目内 CDP 技能。

## ccv3 字段速查

`src/card.json` 的核心结构：

```json
{
  "spec": "chara_card_v3",
  "spec_version": "3.0",
  "data": {
    "name": "角色名",
    "description": "外貌、身份、背景",
    "personality": "性格、说话方式、行为偏好",
    "scenario": "当前场景和用户关系",
    "first_mes": "第一条开场白",
    "mes_example": "示例对话",
    "system_prompt": "输出规则、格式契约、扮演边界",
    "character_book": { "entries": [] },
    "extensions": {}
  }
}
```

常用字段：

- `data.name`：角色名，`{{char}}` 宏会读它。
- `data.description`：角色基础描述，可写外貌、身份、长期背景。
- `data.personality`：性格、语气、行为习惯。
- `data.scenario`：当前局面、世界观入口、用户与角色关系。
- `data.first_mes`：首屏体验。L3/L4 卡可放触发标记或完整 HTML 状态栏。
- `data.system_prompt`：最重要的格式契约，告诉 LLM 每轮输出正文、状态块、占位符或组件标记。
- `data.character_book.entries`：世界书。`constant=true` 做每轮底座；`keys` 做关键词触发；`content` 写设定、规则、角色档案或剧情节点。
- `data.extensions.regex_scripts`：正则脚本。把 LLM 输出标记变成 HTML/UI，或隐藏变量更新块。
- `data.extensions.oai_preset`：随卡携带的 OAI 预设，控制提示块、采样参数和 prompt_order。

## 卡分层骨架

- L1 纯文本卡：`description` / `personality` / `scenario` / `first_mes` 足够强，几乎不需要世界书和正则。
- L2 设定卡：在 L1 基础上加 `character_book.entries`，用 constant 条目放世界底座，用关键词条目按需注入设定。
- L3 状态栏卡：在 L2 基础上加正则和变量。典型结构是正文 + `<UpdateVariable>{{setvar::key::value}}</UpdateVariable>` + `<StatusPlaceHolderImpl/>`。
- L4 交互卡：在 L3 基础上加多组件正则和交互 JS，模拟聊天 App、地图、朋友圈、战斗面板、小游戏等复杂界面。

## L3/L4 分离层设计

重型卡不要把“给 LLM 看的数据”和“给用户看的 UI”混在一起。使用三件套：

1. 占位符：让 LLM 输出稳定标记，例如 `<StatusPlaceHolderImpl/>`、`[消息|角色]:内容`、`<地图>...</地图>`。
2. 数据正则：匹配 `<UpdateVariable>...</UpdateVariable>`，其中 `{{setvar}}` / `{{setglobalvar}}` 先求值落地，再用 `markdownOnly:true` + `promptOnly:true` 清空，避免污染显示和下轮 prompt。
3. 渲染正则：把占位符或组件标记替换成 HTML，通常 `markdownOnly:true`、`promptOnly:false`。状态栏 HTML 用 `{{getvar::key::默认值}}` 读取变量。

关键纪律：

- `system_prompt` 里承诺的标记，必须和 `regex_scripts.findRegex` 严格对应。
- 每个变量更新块必须有隐藏正则。
- 渲染 HTML 尽量输出完整片段或完整文档；复杂状态栏建议包含 `<body>`，方便 iframe 渲染。
- 世界书条目是否 constant，取决于每轮是否都需要；能关键词触发就不要常驻占 context。

## 设计系统

`src/styles.css` 顶部有 semantic design tokens（`--bg` / `--surface` / `--primary` / `--accent` / `--border` / `--text` / 阴影 / 圆角 / 间距 / 过渡等），并有 `[data-theme="dark"]` 暗色覆盖。

- 不要在组件里写裸色值；颜色、阴影、圆角、间距优先走 CSS 变量。
- 新样式加到 `src/styles.css`，复用或扩展已有 tokens。
- 保证 light / dark 主题都可用。
- 文案默认中文，除非用户明确要求其他语言。

## 调试纪律

- 预览报错时先读错误信息和出错位置，再改代码。
- 预览异常先用 RPC `webide_get_logs`（`onlyErrors: true`）读宿主侧 vite 日志，再进 CDP。
- 修根因，不用吞异常、注释代码、硬编码绕过来掩盖问题。
- 改 `src/card.json` 后一定跑 `bun run card:validate`。
- 改界面后可用 `bun run build` 检查 Vite 构建。
- L3/L4 交互卡不能只看构建结果；需要用 CDP 或等价运行时证据验证 DOM、iframe、postMessage、变量和消息流。

## CDP 调试基线

优先使用：

```bash
node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs descriptor
node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs doctor
node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs engine-state
node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs audit-layout --preset mobile
node .codex/skills/seashort-cdp-debug/scripts/cdp-preview.mjs viewport-suite --presets desktop,tablet,mobile
```

可重复流程放在 `.verify-flows/*.json`，截图放在 `.verify-shots/`。不要把一次 CDP 观察到的端口写进持久文档。

## SDK 用法速查

```ts
import { useWorldEngine } from '@seachat/sdk/render';
const { snapshot, streaming } = useWorldEngine(engine);

snapshot.messages;   // ChatMessage[]，完整对话历史
snapshot.state;      // Record<string, number|string>，JSON 协议状态
snapshot.options;    // string[]，JSON 协议选项
snapshot.lastRender; // regex 协议渲染结果 { html, isInteractive, srcdoc? }
snapshot.streaming;  // 是否正在流式输出

engine.send(userText);
```

两种常见运行时形态：

- JSON 协议卡：`snapshot.state` / `snapshot.options` 驱动 UI。
- regex 协议卡：`snapshot.lastRender.html` 承载状态栏或交互 HTML。

## 回复用户

完成后简洁说明改了什么、跑了哪些验证、是否还有失败或风险。不要编造验证结果；没跑就明确说没跑。

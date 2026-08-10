---
name: canvas-ops
description: 操作 SeaShort 无限画布：创建/编辑/连接节点、触发图片视频音频生成、读取画布状态。当用户要求在画布上创作、排版参考图、批量生图、搭建生成流程时使用。
---

# 无限画布操作（canvas-ops）

SeaShort 的 WebIDE 有一个「画布」视图（无限画布创作模式）。你可以直接用 Bash curl 驱动它：宿主 bun-server 提供了画布桥 RPC，画布页面会实时执行你下发的操作并回传结果。

## 前置条件

- 环境变量 `SEASHORT_RPC_BASE` 和 `SEASHORT_RPC_TOKEN` 已注入（SeaShort 启动时自动设置）。
- 用户已在 WebIDE 打开「画布」视图并**进入某个画布项目**（不能停在模式选择/画布库页）。进入画布 doc 后，画布会 headless 自动连上宿主桥并持续上报状态——`canvas_bridge_status` 的 clients 由此非空。
- 若 `canvas_bridge_*` 报「没有已连接的画布」，说明画布 doc 未挂载（停在选择页或未打开画布视图）——提示用户进入一个画布项目，不要反复重试。`gen --wait` 的轮询同样依赖桥在线。

## 首选：用脚本（结构化参数，免 JSON 转义坑）

优先用随技能附带的脚本，别手写内联 JSON（shell 里内联 JSON 极易转义出错）：

```bash
node .codex/skills/canvas-ops/scripts/canvas-ops.mjs <子命令> [--flag 值]
```

子命令：

| 子命令 | 用途 |
|---|---|
| `status` | 列出在线画布客户端 |
| `state [--summary]` | 读快照；`--summary` 剥掉大 metadata（blob URL），带 `bounds` 和人类可读连线，**读上下文首选** |
| `add --type text\|image\|video\|audio\|config [--title T] [--content C] [--x N --y N] [--id ID]` | 建单个节点 |
| `connect --from ID --to ID` | 连线 |
| `fit [--ids a,b,c] [--padding 80] [--max-zoom 2]` | 视口适应全部/子集节点（像真人「适应视图」） |
| `focus --node ID [--zoom 1]` | 视口居中到某节点 |
| `upload --node ID --url URL \| --data-url DATAURL [--mime image/png]` | 把外部素材灌进 image/video/audio 节点 |
| `gen --node ID [--mode image] [--prompt P] [--wait] [--timeout 180]` | 触发生成；`--wait` 内置轮询（≥15s）等到 success/error |
| `apply --ops '<json>' \| --file ops.json` | 下发原始 ops 数组（复杂批量时用文件，别内联） |
| `shot [--name f.png]` | 给画布截图自验（仅 dev；需 `SEASHORT_CDP_PORT`，打包版自动降级） |

复杂批量 ops 写进文件再 `apply --file`，不要拼长内联 JSON。

## 底层：直接 RPC（脚本不可用时的兜底）

统一 RPC 形态（响应 `{"ok":true,"data":...}` 或 `{"ok":false,"error":"..."}`）。**内联 JSON 用 heredoc，别用引号拼**：

```bash
curl -s "$SEASHORT_RPC_BASE/rpc" \
  -H "x-seashort-token: $SEASHORT_RPC_TOKEN" \
  -H "content-type: application/json" \
  --data @- <<'JSON'
{"command":"canvas_bridge_apply_ops","args":{"ops":[{"type":"add_node","nodeType":"text","title":"提示词"}]}}
JSON
```

三个命令：

| 命令 | args | 返回 |
|---|---|---|
| `canvas_bridge_status` | 无 | 在线画布客户端列表 `{clients:[{clientId,projectId,title,nodeCount,lastSeen}]}` |
| `canvas_bridge_get_state` | `{clientId?}` | 画布快照（缺省取最近活跃画布） |
| `canvas_bridge_apply_ops` | `{ops:[...], clientId?}` | 执行后的新快照 |

**快照结构**：`{projectId, title, nodes[], connections[], selectedNodeIds[], viewport{x,y,k}}`。
节点：`{id, type, title, position{x,y}, width, height, metadata}`。连线：`{id, fromNodeId, toNodeId}`。


## Ops 协议（canvas_bridge_apply_ops 的 ops 数组元素）

| op | 字段 | 说明 |
|---|---|---|
| `add_node` | `id?, nodeType?, title?, position?{x,y}（或 x?,y?）, width?, height?, metadata?` | nodeType: `text\|image\|video\|audio\|config`，非法值回退 text。**建议显式传 id**（如 `"text-ref-1"`），后续 update/connect/run_generation 都要引用它；不传则画布自动生成时间戳 id，需从返回快照里找。 |
| `update_node` | `id, patch?{title,position,width,height}, metadata?` | metadata 浅合并进现有 metadata。id 不存在时**静默跳过**。 |
| `delete_node` | `id?` 或 `ids?[]` 或 `nodeType?` | 按 id、批量 ids 或整类删除。 |
| `connect_nodes` | `fromNodeId, toNodeId, id?` | 建立有向连线（from 是上游素材/提示词，to 是生成目标）。 |
| `delete_connections` | `id?` 或 `ids?[]` 或 `all?:true` | 删连线。 |
| `select_nodes` | `ids[]` | 设置选中（给用户视觉指引用）。 |
| `set_viewport` | `viewport{x,y,k}` | 手动移动/缩放视口（k 为缩放比）。**通常别手算，用 `fit_view`/`focus_node`**。 |
| `fit_view` | `ids?[], padding?, maxZoom?` | 视口自动适应全部节点（或 `ids` 子集），像真人「适应视图」。省去手算 x/y/k。 |
| `focus_node` | `id, zoom?` | 视口居中到某节点（缺省保持当前缩放）。 |
| `upload_asset` | `nodeId, url? \| dataUrl?, mimeType?` | 把外部图片/视频/音频 URL 或 data URL 灌进媒体节点（节点立即渲染，画布侧异步落库为 storageKey 持久化）。排参考图用。 |
| `run_generation` | `nodeId, mode?, prompt?` | 对节点触发真实生成。mode: `text\|image\|video\|audio`（缺省取节点 metadata.generationMode，再缺省 image）。prompt 缺省取该节点 `metadata.composerContent` 或 `metadata.prompt`。 |

节点默认尺寸（不传 width/height 时）：text/image/config 340×240，video 420×236，audio 340×120。

**关键 metadata 字段**：`content`（文本节点正文 / 媒体节点 storageKey 引用）、`prompt`/`composerContent`（生成提示词）、`status`（`idle|loading|success|error`）、`generationMode`、`references[]`（参考图节点 id）、`errorDetails`（失败原因）。

## 标准工作流

1. **先看现状**：`canvas_bridge_get_state`，了解已有节点、坐标分布、选中项。
2. **规划布局**：新节点避开已有节点；横向流程从左到右，节点间距 400px 起（如 x=100, 520, 940）；并列分支纵向间隔 300px。
3. **建结构**：一次 `apply_ops` 批量完成 add_node + connect_nodes（连线方向：素材/提示词 → 生成节点）。
4. **触发生成**：`run_generation` op 可以和建节点写在同一批 ops 里（画布会先应用结构再异步执行生成）。要生成图片时：建 text 节点放提示词（`metadata.content` 写正文）→ 建 image 节点 → 连线 text→image → 对 image 节点 `run_generation {mode:"image", prompt:"..."}`。
5. **等待结果**：生成是异步的（图片约 30-120 秒，视频更久）。轮询 `canvas_bridge_get_state`，看目标节点 `metadata.status`：`loading` 继续等（**轮询间隔 ≥15 秒**，用 `sleep 15`）；`success` 完成；`error` 时读 `metadata.errorDetails` 报告用户。
6. **收尾**：完成后可 `select_nodes` 选中产出节点、`set_viewport` 把视口移到成果区，给用户视觉焦点。

## 示例：创建提示词并生成一张图

```bash
curl -s "$SEASHORT_RPC_BASE/rpc" -H "x-seashort-token: $SEASHORT_RPC_TOKEN" -H "content-type: application/json" -d '{
  "command": "canvas_bridge_apply_ops",
  "args": { "ops": [
    { "type": "add_node", "id": "prompt-1", "nodeType": "text", "title": "提示词",
      "position": {"x": 100, "y": 200}, "metadata": {"content": "一只戴宇航员头盔的橘猫，赛博朋克"} },
    { "type": "add_node", "id": "img-1", "nodeType": "image", "title": "生成结果",
      "position": {"x": 520, "y": 200} },
    { "type": "connect_nodes", "fromNodeId": "prompt-1", "toNodeId": "img-1" },
    { "type": "run_generation", "nodeId": "img-1", "mode": "image",
      "prompt": "一只戴宇航员头盔的橘猫，赛博朋克" }
  ] }
}'
```

## 红线

- update/delete 引用不存在的 id 会被静默跳过，不报错——改前先 get_state 核对 id。
- 不要删除或移动用户手动创建的节点，除非用户明确要求。
- `apply_ops` 15 秒超时报错通常意味着画布页面已关闭，提示用户重新打开画布视图。
- 生成失败（status=error）不要盲目重试超过 1 次；把 errorDetails 告诉用户。
- 生成产物由画布自动落盘到项目 `public/assets/canvas/`，不需要你搬运文件。

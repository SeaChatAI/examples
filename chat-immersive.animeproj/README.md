# Tipsy 式沉浸角色对话模板

这是 SeaShort 的通用 `text` 角色卡对话模板。把一张真实 ST V3/ccv3 角色卡保存为
`src/card.json`，界面会自动使用角色名、简介、场景、标签、开场和封面，不需要修改
`src/App.tsx`。

## 展示约定

- `data.name`：对话标题、消息作者与输入提示的角色名。
- `data.description`：桌面角色资料与移动端资料 sheet。
- `data.scenario`：没有显式副标题时的副标题来源。
- `data.extensions.seashort.cover`：由 SeaShort 导入/制卡器写入的项目封面。
- `data.extensions.seashort.presentation`：可选展示覆盖，仅支持
  `subtitle`、`input_placeholder`、`accent`、`cover_position`。
- `data.extensions.seashort.card_id`：可选稳定卡身份。存在时优先用于隔离会话；缺失时由
  卡名、作者、版本、简介与开场生成确定性指纹。

封面使用现有项目资产契约：

```json
{
  "extensions": {
    "seashort": {
      "cover": {
        "kind": "project_asset",
        "path": "public/assets/characters/project-card-cover.png"
      }
    }
  }
}
```

无封面时界面显示稳定的角色首字回退主视觉，不会猜测资产文件名。

## 能力边界

首版承诺 ST V3 L1/L2 `text` 卡。模板提供流式消息、停止、失败重试、重新生成、回退、
续写、本地/云多会话、切换、重命名、删除与分支。regex/HTML 状态栏卡和 JSON 状态游戏
应继续使用各自的专门模板。

思维链与耗时只在 Vite 开发模式并显式添加 `?debug` 时显示，不进入发布体验。

## 验证

```bash
bun install
bun run test
bun run card:validate
bun run build
```

# SeaShort Examples

只保留 **两条产品线**（Card × Runtime）：

| 线 | 目录 | 模式 | 用途 |
| --- | --- | --- | --- |
| **shared** | [`chat-immersive.animeproj`](./chat-immersive.animeproj) | `kind=shared` · runtime `immersive-chat` | create「角色卡世界」种子；`deploy-shared-player` 构建根 |
| **embed** | [`immersive-chat-cloud.animeproj`](./immersive-chat-cloud.animeproj) | `kind=embedded` | create「自定义世界」种子；cloud Actor dogfood + accept |

```text
角色卡世界  → chat-immersive     → 公共播放器 1:N
自定义世界  → immersive-chat-cloud → 整包 Experience 1:1
compute     → cloud worldcompute (ActorEngine)
```

## 命令

```bash
# shared
cd chat-immersive.animeproj && bun install && bun run dev

# embed
cd immersive-chat-cloud.animeproj && bun install && bun run dev   # :5288
```

门禁：`make check-examples`（仅上述两工程）。

## 说明

- 旧 blank / starter / 能力阶梯 / IMC-Joss 已移除；`create_project` 旧 slug 经 alias 落到这两条。
- 目录后缀 `.animeproj` 是项目边界硬约束。

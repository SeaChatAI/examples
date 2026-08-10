# card-script.js Quick Reference

## 基本结构

```javascript
export default {
  onInit(engine, uiBridge) {
    // 初始化：设置变量、注册监听器
  },

  onBeforeSend(input, engine) {
    // 发送前：拦截命令、修改输入
    return true; // 或 false 阻止发送
  },

  onMessageReceived(message, state, uiBridge) {
    // 收到回复：触发 UI、播放音效
  },

  onStateChanged(delta, fullState, uiBridge) {
    // 状态变化：更新界面、检测条件
  },

  onStreamingChunk(chunk, accumulated) {
    // 流式输出：打字音效、实时动画
  },
};
```

## 引擎 API 速查

```javascript
// 消息
engine.injectMessage('文本', 'system'); // 'system' | 'user' | 'assistant'

// 变量
engine.setVariable('hp', 100);          // 默认 local scope
engine.setVariable('gold', 500, 'global');
const hp = engine.getVariable('hp');

// 掷骰
const dmg = engine.roll('1d20+5');      // 支持 NdM+X 格式
const crit = engine.roll('2d6');

// 快照
const snap = engine.getSnapshot();
console.log(snap.messages, snap.state);
```

## UI 桥接 API 速查

```javascript
// 战斗界面
uiBridge.showCombatUI({ hp: 80, maxHp: 100, mp: 50, maxMp: 50, status: ['中毒'] });
uiBridge.updateCombatUI({ hp: 60 }); // 部分更新
uiBridge.hideCombatUI();

// 音效
uiBridge.playSound('/battle.mp3', { volume: 0.5, loop: false });

// 通知
uiBridge.showNotification('获得 10 金币', 'success', 3000);
// type: 'info' | 'success' | 'warning' | 'error'

// 自定义视图（需在 CustomViews.tsx 注册）
uiBridge.setCustomView('MyComponent', { foo: 'bar' });
uiBridge.clearCustomView();

// 事件监听（高级）
uiBridge.on('custom-event', (event) => console.log(event));
uiBridge.emit('custom-event', { data: 123 });
```

## 常见模式

### 斜杠命令
```javascript
onBeforeSend(input, engine) {
  if (input === '/help') {
    engine.injectMessage('可用命令：/stats /inventory /attack', 'system');
    return false;
  }

  if (input.startsWith('/attack ')) {
    const target = input.slice(8);
    const damage = engine.roll('1d20+5');
    engine.injectMessage(`⚔️ 攻击 ${target}，伤害 ${damage}`, 'system');
    return false;
  }

  return true; // 允许正常消息通过
}
```

### 自动战斗检测
```javascript
onMessageReceived(message, state, uiBridge) {
  const keywords = ['战斗', '敌人', '怪物', '攻击'];
  if (keywords.some(k => message.content.includes(k))) {
    uiBridge.showCombatUI({ hp: state.hp || 100, maxHp: 100 });
    uiBridge.playSound('/battle-start.mp3');
  }
}
```

### 低血量警告
```javascript
onStateChanged(delta, fullState, uiBridge) {
  if ('hp' in delta && fullState.hp < 20) {
    uiBridge.showNotification('⚠️ 生命值危险！', 'warning');
    uiBridge.playSound('/low-health.mp3', { volume: 0.7, loop: true });
  }
}
```

### 升级庆祝
```javascript
onStateChanged(delta, fullState, uiBridge) {
  if ('level' in delta && delta.level > (fullState.level || 1)) {
    uiBridge.showNotification(`🎉 升级到 Lv.${delta.level}！`, 'success', 5000);
    uiBridge.playSound('/level-up.mp3');
  }
}
```

### 条件触发音效
```javascript
onMessageReceived(message, state, uiBridge) {
  if (message.content.includes('获得')) {
    uiBridge.playSound('/coin.mp3', { volume: 0.4 });
  }
  if (message.content.includes('失败')) {
    uiBridge.playSound('/failure.mp3', { volume: 0.6 });
  }
}
```

## 调试技巧

```javascript
onInit(engine, uiBridge) {
  console.log('📦 Card loaded');
  console.log('📊 Initial state:', engine.getSnapshot().state);
}

onBeforeSend(input, engine) {
  console.log('📤 User input:', input);
  return true;
}

onMessageReceived(message, state, uiBridge) {
  console.log('📥 AI response:', message.content);
  console.log('🎮 Current state:', state);
}

onStateChanged(delta, fullState, uiBridge) {
  console.log('📈 State changed:', delta);
  console.log('📊 Full state:', fullState);
}
```

## 注意事项

✅ **正确**
```javascript
// 返回布尔值控制发送
onBeforeSend(input, engine) {
  if (input.startsWith('/')) return false;
  return true;
}

// 使用 injectMessage 添加系统消息
engine.injectMessage('提示', 'system');

// 部分更新战斗 UI
uiBridge.updateCombatUI({ hp: newHp });
```

❌ **错误**
```javascript
// 忘记返回值（默认 undefined → true）
onBeforeSend(input, engine) {
  if (input === '/help') {
    engine.injectMessage('帮助');
    // 缺少 return false，消息仍会发送
  }
}

// 直接修改 state（不会生效）
onStateChanged(delta, fullState, uiBridge) {
  fullState.hp = 100; // 无效，state 是只读快照
}

// 音效阻塞（应该用 uiBridge.playSound）
onMessageReceived(message, state, uiBridge) {
  const audio = new Audio('/battle.mp3');
  await audio.play(); // ❌ 钩子不支持 async
}
```

## 音效文件放置

```
public/
└── assets/
    ├── battle-start.mp3
    ├── battle-end.mp3
    ├── attack.mp3
    ├── damage.mp3
    ├── heal.mp3
    ├── level-up.mp3
    ├── low-health.mp3
    ├── coin.mp3
    └── failure.mp3
```

访问路径：`/assets/xxx.mp3`

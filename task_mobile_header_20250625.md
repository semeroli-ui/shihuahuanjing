# 手机端 Header 优化 + 图片模型切换 + 视频稳定性增强

## 任务目标
处理用户反馈的三个手机端问题：
1. Header 按钮合并为三点菜单
2. 图片生成效果模糊，切换为千问模型
3. 视频生成中途闪退

## 执行内容

### 1. Header 三点菜单（App.tsx）

**改动位置**：`src/App.tsx`

- 添加状态：`const [showMobileMenu, setShowMobileMenu] = useState(false);`
- 导入图标：`MoreVertical`、`X`（虽然 X 未使用）
- 桌面端按钮：保持原样，包裹在 `hidden md:flex` 容器中
- 手机端：新增三点菜单按钮，点击后显示下拉菜单
  - 菜单项：藏书阁、管理员登录/管理后台
  - 点击菜单项后自动关闭菜单
  - 点击遮罩层关闭菜单
  - 使用 `AnimatePresence` 实现进入/退出动画

**代码结构**：
```jsx
{/* 手机端：三点菜单 */}
<div className="relative md:hidden">
  <button onClick={() => setShowMobileMenu(!showMobileMenu)}>
    <MoreVertical />
  </button>
  <AnimatePresence>
    {showMobileMenu && (
      <>
        <motion.div className="fixed inset-0 z-[55]" onClick={close} />
        <motion.div className="dropdown-menu">
          <button onClick={() => { setShowLibrary(true); close(); }}>藏书阁</button>
          {isAdmin ? <button>管理后台</button> : <button>管理员登录</button>}
        </motion.div>
      </>
    )}
  </AnimatePresence>
</div>
```

### 2. 图片生成模型切换（[[route]].ts）

**改动位置**：`functions/api/[[route]].ts` 第650行附近

**原策略**：
1. Agnes AI（主力）
2. ModelScope（兜底）

**新策略**：
1. ModelScope 千问 Z-Image（主力，质量更佳，超时90秒）
2. Agnes AI（兜底，超时30秒）

**改动代码**：
```typescript
// 策略1: ModelScope 千问 Z-Image (主力，质量更佳)
const msKey = c.env.MODEL_SCOPE_API_KEY;
if (msKey) {
  const result = await callModelScopeImage(msKey, enhancedPrompt);
  if (result.url) return c.json({ generatedImages: [{ image: { url: result.url } }] });
}

// 策略2: Agnes AI 兜底
const agnesKey = c.env.AGNES_AI_API_KEY;
if (agnesKey) {
  const result = await callAgnesAIImage(agnesKey, enhancedPrompt);
  // ...
}
```

### 3. 视频生成稳定性增强（App.tsx）

**改动位置**：`src/App.tsx` `handleGenerateVideo` 函数

**增强内容**：
- 添加全局超时检查（8分钟硬性超时）
- 防止重复点击（`if (isGeneratingVideo) return;`）
- 增强错误处理：
  - 429 频率限制 → 30秒后重试
  - 525 SSL 错误 → 10秒后重试
  - 网络错误 → 15秒后重试
  - 其他错误 → 前5次继续重试，之后才失败
- 状态提示更清晰（显示轮询次数和进度）

**关键代码**：
```typescript
const GLOBAL_TIMEOUT = 8 * 60 * 1000;
const checkGlobalTimeout = () => {
  if (Date.now() - startTime > GLOBAL_TIMEOUT) {
    setVideoStatus('视频生成超时（8分钟），请刷新重试');
    setIsGeneratingVideo(false);
    return true;
  }
  return false;
};

// 轮询中增强错误处理
catch (e) {
  if (errorMsg.includes('525')) {
    setVideoStatus('视频服务暂时不可用（SSL 525），10秒后重试...');
    setTimeout(poll, 10000);
  } else if (errorMsg.includes('Failed to fetch')) {
    setVideoStatus('网络连接失败，15秒后重试...');
    setTimeout(poll, 15000);
  }
}
```

## 文件变更

| 文件 | 改动类型 | 行数变化 |
|------|---------|---------|
| `src/App.tsx` | 状态、UI、错误处理 | +150行 |
| `functions/api/[[route]].ts` | 图片生成策略 | ~30行修改 |

## 测试建议

1. **手机端 Header**：
   - 在手机宽度（<768px）下点击三点菜单
   - 验证下拉菜单显示藏书阁和管理员登录
   - 点击菜单项后菜单关闭
   - 桌面宽度（≥768px）下仍显示两个按钮

2. **图片生成**：
   - 输入诗词，点击生成图片
   - 观察控制台日志 `[Image Gen] Trying ModelScope Z-Image...`
   - 如 ModelScope 失败，应自动 fallback 到 Agnes AI

3. **视频生成**：
   - 点击生成视频后，切换标签页/最小化窗口
   - 回到页面后轮询应继续（不因页面隐藏而中断）
   - 网络波动时应自动重试并提示状态

## 遗留问题

- 视频生成 Worker 代理 `WORKER_PROXY_URL` 需在环境变量中配置
- ModelScope 图片生成可能需要90秒等待，前端需耐心
- TTS 吟诵服务因 Agnes AI SSL 525 问题仍不可用

## 时间戳
- 开始：2026-06-25 10:00 GMT+8
- 完成：2026-06-25 10:35 GMT+8

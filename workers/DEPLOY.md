# Agnes AI Worker 代理部署指南

## 前置条件

1. 安装 Node.js (v18+)
2. 安装 Wrangler CLI:
   ```bash
   npm install -g wrangler
   ```

## 部署步骤

### 1. 登录 Cloudflare

```bash
npx wrangler login
```

这会打开浏览器让你授权 Wrangler 访问你的 Cloudflare 账户。

### 2. 创建 API Token（推荐方式）

如果不想用全局登录，可以创建专用 Token：

1. 访问 https://dash.cloudflare.com/profile/api-tokens
2. 点击 "Create Token"
3. 选择 "Custom token" 模板
4. 权限设置：
   - Account: Cloudflare Workers:Edit
   - Zone: 你的域名:Edit (如果要用自定义域名)
5. 复制生成的 Token

```bash
# 设置环境变量（Windows PowerShell）
$env:CLOUDFLARE_API_TOKEN="你的token"

# 或者（Windows CMD）
set CLOUDFLARE_API_TOKEN=你的token
```

### 3. 设置 Agnes AI API Key

```bash
# 进入 workers 目录
cd workers

# 创建 secret（部署时会加密存储）
npx wrangler secret put AGNES_AI_API_KEY
# 提示输入时粘贴你的 Agnes AI API Key
```

### 4. 部署 Worker

```bash
npx wrangler deploy
```

成功后会显示：
```
✨ Successfully published your script to:
https://agnes-ai-proxy.your-subdomain.workers.dev
```

### 5. 更新前端代码

复制上面的 URL，修改 `src/services/poeticService.ts`：

```typescript
private readonly WORKER_PROXY_URL = 'https://agnes-ai-proxy.your-subdomain.workers.dev';
```

然后提交并推送：
```bash
git add src/services/poeticService.ts
git commit -m "chore: update Worker proxy URL"
git push origin main
```

## 验证部署

### 测试图片生成
```bash
curl -X POST https://agnes-ai-proxy.your-subdomain.workers.dev/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Origin: https://shihuahuanji.qjammo.de5.net" \
  -d '{"prompt": "A beautiful Chinese landscape painting, ink wash style", "n": 1}'
```

### 测试视频生成
```bash
curl -X POST https://agnes-ai-proxy.your-subdomain.workers.dev/v1/videos \
  -H "Content-Type: application/json" \
  -H "Origin: https://shihuahuanji.qjammo.de5.net" \
  -d '{"prompt": "A serene mountain scene with flowing water, cinematic lighting"}'
```

## 常见问题

### 403 Forbidden
- 检查 `Origin` header 是否在白名单里
- 浏览器控制台查看实际请求的 Origin

### 500 Internal Server Error
- 检查 Worker logs: `npx wrangler tail`
- 确认 `AGNES_AI_API_KEY` 已正确设置

### SSL 525 仍然存在
- Worker 部署在 Cloudflare 边缘网络，理论上不会触发 525
- 如果还有问题，可能是 Agnes AI 服务端全面证书问题，需要联系他们修复

## 更新 Worker

修改代码后重新部署：
```bash
cd workers
npx wrangler deploy
```

## 查看日志

```bash
npx wrangler tail
```

实时查看 Worker 的运行日志。

# 诗画幻境 (Poetic Vision AI) - Cloudflare Pages 部署指南

本项目已深度适配 Cloudflare Pages 部署，利用 **Cloudflare Pages Functions (Hono)** 提供后端 API 代理，并使用 **Cloudflare D1** 数据库实现数据持久化。

## 核心特性
- **双 Key 安全隔离**：后端使用两个独立的 API Key（Gemini Pro 用于解析，Studio Key 用于生成），前端不暴露任何 Key。
- **边缘数据库**：使用 Cloudflare D1 存储“藏书阁”诗词，响应极快。
- **全功能代理**：视频生成、图像生成、TTS 吟诵、视频下载均通过后端安全代理。

## 部署步骤

### 1. 准备工作
*   将本项目代码上传到您的 **GitHub** 仓库。
*   确保 `functions` 目录和 `wrangler.toml` 文件已包含在仓库中。

### 2. 创建 D1 数据库
1.  登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2.  进入 **Workers & Pages** -> **D1** -> **Create database**。
3.  命名为 `poetic-db` (或您喜欢的名字)。
4.  获取 **Database ID**，并更新项目根目录下的 `wrangler.toml` 文件中的 `database_id`。
5.  在 D1 数据库的 **Console** 中执行以下 SQL 以初始化表结构：
    ```sql
    -- 藏书阁表
    CREATE TABLE IF NOT EXISTS library (
      id TEXT PRIMARY KEY,
      poem TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- 管理员表
    CREATE TABLE IF NOT EXISTS admins (
      email TEXT PRIMARY KEY,
      password TEXT NOT NULL
    );

    -- 使用配额表
    CREATE TABLE IF NOT EXISTS usage_stats (
      ip TEXT NOT NULL,
      date TEXT NOT NULL,
      count INTEGER DEFAULT 0,
      PRIMARY KEY (ip, date)
    );
    ```

### 3. 在 Cloudflare Pages 中创建项目
1.  进入 **Workers & Pages** -> **Create application** -> **Pages** -> **Connect to Git**。
2.  选择您的 GitHub 仓库。

### 4. 配置构建设置
*   **Framework preset**: `Vite`
*   **Build command**: `npm run build`
*   **Build output directory**: `dist`

### 5. 配置环境变量与绑定
在 Cloudflare Pages 项目设置中，进入 **Settings**：

#### 环境变量 (Variables and Secrets)
*   `GEMINI_PRO_API_KEY`: 用于诗词意境解析的 API Key (建议使用 Gemini 1.5 Pro)。
*   `GOOGLE_AI_STUDIO_API_KEY`: 用于视频、图像和 TTS 生成的 API Key (需支持 Veo 模型)。

#### 函数绑定 (Functions -> D1 database bindings)
*   添加绑定：变量名设为 `DB`，选择您刚才创建的 D1 数据库。

### 6. 管理员初始设置
默认管理员账号：`lablabe@qq.com`
初始密码：`admin123654`

登录后请务必在管理后台修改密码。

### 7. 访客配额
非管理员用户每日限 3 次生成操作（分析、视频、图像）。配额按 IP 地址和日期计算。

### 8. 部署
点击 **Save and Deploy**。Cloudflare 将自动构建并部署您的应用。

## 本地开发
如果您想在本地模拟 Cloudflare 环境：
```bash
npm install
npm run dev:cf
```

## 注意事项
*   **SPA 路由**：项目已包含 `public/_redirects` 文件，确保刷新页面时不会出现 404。
*   **配额限制**：Veo 视频生成模型目前处于预览阶段，频率限制较严，请合理使用。

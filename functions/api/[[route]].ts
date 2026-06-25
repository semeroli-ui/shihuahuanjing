import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

type Bindings = {
  // Agnes AI API Key (主力 - 全功能)
  AGNES_AI_API_KEY: string;
  // ModelScope API Key (备用/兜底)
  MODEL_SCOPE_API_KEY?: string;
  // 管理员凭据（环境变量配置）
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_SALT?: string;
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>().basePath('/api');

// --- 日志中间件 ---
app.use('*', async (c, next) => {
  console.log(`[API Request] ${c.req.method} ${c.req.url}`);
  await next();
});

// --- 辅助函数 ---

const getApiKey = (keyString: string | undefined) => {
  if (!keyString) return null;
  const keys = keyString.split(',').map(k => k.trim()).filter(k => k.length > 0);
  if (keys.length === 0) return null;
  return keys[Math.floor(Math.random() * keys.length)];
};

const isAdmin = async (c: any) => {
  const token = getCookie(c, 'admin_token');
  return token === 'ZEN_ADMIN_LOGGED_IN';
};

// --- 密码 hash 工具（使用 Web Crypto API，兼容 Cloudflare Workers）---

/**
 * 计算 SHA-256 hash（Hex 编码）
 */
async function sha256(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * 验证密码：计算 input + salt 的 hash，与 storedHash 比对
 */
async function verifyPassword(inputPassword: string, storedHash: string, salt: string): Promise<boolean> {
  const hash = await sha256(inputPassword + salt);
  return hash === storedHash;
}

/**
 * 生成密码 hash（用于首次设置密码）
 * 返回 { hash, salt }
 */
async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  // 生成随机 salt（16 字节 hex）
  const saltArray = new Uint8Array(16);
  crypto.getRandomValues(saltArray);
  const salt = Array.from(saltArray).map(b => b.toString(16).padStart(2, '0')).join('');
  const hash = await sha256(password + salt);
  return { hash, salt };
}



const checkQuota = async (c: any) => {
  if (await isAdmin(c)) return true;

  // DB 不可用时跳过配额检查（降级模式）
  if (!c.env.DB) return true;

  try {
    const ip = c.req.header('cf-connecting-ip') || 'unknown';
    const today = new Date().toISOString().split('T')[0];

    const { results } = await c.env.DB.prepare(
      "SELECT count FROM usage_stats WHERE ip = ? AND date = ?"
    ).bind(ip, today).all();

    const currentCount = results[0]?.count || 0;
    if (currentCount >= 3) return false;

    if (currentCount === 0) {
      await c.env.DB.prepare(
        "INSERT INTO usage_stats (ip, date, count) VALUES (?, ?, 1)"
      ).bind(ip, today).run();
    } else {
      await c.env.DB.prepare(
        "UPDATE usage_stats SET count = count + 1 WHERE ip = ? AND date = ?"
      ).bind(ip, today).run();
    }
    return true;
  } catch (e: any) {
    // DB 查询失败时放行（表可能不存在）
    console.warn('[checkQuota] DB error, skipping:', e.message);
    return true;
  }
};

// ============================================================
// Agnes AI 调用工具
// ============================================================

const AGNES_AI_BASE = 'https://apihub.agnes-ai.com';

/**
 * Agnes AI 文本对话 (用于诗词解析)
 */
async function callAgnesAIChat(apiKey: string, userPrompt: string, systemPrompt?: string): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: userPrompt });

  const response = await fetch(`${AGNES_AI_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'agnes-ai-v1',
      messages,
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Agnes AI Chat error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

/**
 * Agnes AI 图片生成
 * 自动追加质量增强后缀，防止模糊
 */
async function callAgnesAIImage(apiKey: string, prompt: string): Promise<{ b64_json?: string; url?: string }> {
  // 水墨丹青质量增强后缀
  const qualitySuffix = ', ancient Chinese ink wash painting on xuan paper, museum-quality brushwork, traditional Chinese pigments, delicate and refined, masterpiece, best quality';
  const enhancedPrompt = prompt + qualitySuffix;

  const response = await fetch(`${AGNES_AI_BASE}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'agnes-ai-v1',
      prompt: enhancedPrompt,
      n: 1,
      size: '1024x1024',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Agnes AI Image error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as any;
  return data.data?.[0] || {};
}

/**
 * Agnes AI 视频生成（异步模式）
 * 自动追加质量增强后缀，防止模糊
 * Step 1: POST /v1/videos → { id, status: "queued", progress: 0 }
 * Step 2: GET /v1/videos/{id} → { status, progress, video_url }
 */
async function callAgnesAIVideo(apiKey: string, prompt: string): Promise<any> {
  // 质量增强后缀：确保视频高清、锐利
  const qualitySuffix = ', cinematic high definition, sharp details, clear visuals, 4k quality, professional color grading, best quality';
  const enhancedPrompt = prompt + qualitySuffix;

  const response = await fetch(`${AGNES_AI_BASE}/v1/videos`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'agnes-video-v2.0',
      prompt: enhancedPrompt,
      height: 768,
      width: 1152,
      num_frames: 121,
      frame_rate: 24,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Agnes AI Video error ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Agnes AI 视频状态轮询
 * GET /v1/videos/{task_id}
 */
async function pollAgnesAIVideo(apiKey: string, taskId: string): Promise<any> {
  const response = await fetch(`${AGNES_AI_BASE}/v1/videos/${encodeURIComponent(taskId)}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Agnes AI Video poll error ${response.status}: ${errorText}`);
  }

  return response.json();
}

/**
 * Agnes AI TTS 语音合成
 */
async function callAgnesAITTS(apiKey: string, text: string): Promise<ArrayBuffer> {
  const response = await fetch(`${AGNES_AI_BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'agnes-ai-tts',
      input: text,
      voice: 'alloy',
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Agnes AI TTS error ${response.status}: ${errorText}`);
  }

  return await response.arrayBuffer();
}

// ============================================================
// ModelScope 备用工具
// ============================================================

const MODELSCOPE_BASE = 'https://api-inference.modelscope.cn';

async function callModelScopeText(apiKey: string, prompt: string, systemPrompt?: string): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  messages.push({ role: 'user', content: prompt });

  const url = `${MODELSCOPE_BASE}/v1/chat/completions`;
  const body = JSON.stringify({ model: 'Qwen/Qwen3-235B-A22B', messages, temperature: 0.7, max_tokens: 2048, enable_thinking: true });
  console.log('[ModelScope] Request:', { url, model: 'Qwen/Qwen3-235B-A22B', messageCount: messages.length });

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body,
  });
  const respText = await response.text();
  console.log('[ModelScope] Response:', { status: response.status, bodyPreview: respText.slice(0, 500) });
  if (!response.ok) throw new Error(`ModelScope Text error ${response.status}: ${respText.slice(0, 300)}`);
  const data = JSON.parse(respText) as any;
  return data.choices?.[0]?.message?.content || '';
}

/**
 * ModelScope 图片生成 (异步模式)
 * 1. 提交任务 -> task_id
 * 2. 轮询 /v1/tasks/{task_id} 直到 SUCCEED/FAILED
 * 3. 返回图片 URL
 */
async function callModelScopeImage(apiKey: string, prompt: string): Promise<{ url?: string }> {
  // Step 1: 提交异步任务
  const submitRes = await fetch(`${MODELSCOPE_BASE}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-ModelScope-Async-Mode': 'true',
    },
    body: JSON.stringify({ model: 'Tongyi-MAI/Z-Image', prompt, size: '1024x1024', n: 1 }),
  });
  if (!submitRes.ok) throw new Error(`ModelScope Image submit error ${submitRes.status}: ${await submitRes.text()}`);
  const { task_id } = await submitRes.json() as any;
  if (!task_id) throw new Error('ModelScope Image: no task_id returned');

  // Step 2: 轮询结果 (最多60秒，每5秒一次)
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await fetch(`${MODELSCOPE_BASE}/v1/tasks/${task_id}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'X-ModelScope-Task-Type': 'image_generation',
      },
    });
    if (!pollRes.ok) throw new Error(`ModelScope Image poll error ${pollRes.status}`);
    const data = await pollRes.json() as any;

    if (data.task_status === 'SUCCEED') {
      return { url: data.output_images?.[0] };
    }
    if (data.task_status === 'FAILED') {
      throw new Error(`ModelScope Image generation failed`);
    }
    // RUNNING -> 继续轮询
  }
  throw new Error('ModelScope Image timeout (60s)');
}

// ModelScope 不支持 OpenAI 兼容的 TTS HTTP API，仅提供 Python SDK
// 暂时禁用，等待 Agnes AI SSL 问题解决后启用
async function callModelScopeTTS(apiKey: string, text: string): Promise<ArrayBuffer> {
  throw new Error('ModelScope TTS: HTTP API not available, only Python SDK supported');
}

// ============================================================
// 1. 健康检查与状态
// ============================================================
app.get('/health', async (c) => {
  const loggedIn = await isAdmin(c);
  return c.json({
    hasAgnesAIKey: !!c.env.AGNES_AI_API_KEY,
    hasModelScopeKey: !!c.env.MODEL_SCOPE_API_KEY,
    hasDB: !!c.env.DB,
    hasAdminConfigured: !!(c.env.ADMIN_USERNAME && c.env.ADMIN_PASSWORD_HASH && c.env.ADMIN_SALT),
    isAdmin: loggedIn,
  });
});

// ============================================================
// 2. 管理员登录（密码 hash 验证）
// ============================================================
app.post('/admin/login', async (c) => {
  const { email, password } = await c.req.json();

  // 优先使用环境变量配置的管理员（hash 验证）
  const adminUser = c.env.ADMIN_USERNAME;
  const adminHash = c.env.ADMIN_PASSWORD_HASH;
  const adminSalt = c.env.ADMIN_SALT;

  if (adminUser && adminHash && adminSalt) {
    // 环境变量模式：验证 hash
    if (email === adminUser) {
      const valid = await verifyPassword(password, adminHash, adminSalt);
      if (valid) {
        setCookie(c, 'admin_token', 'ZEN_ADMIN_LOGGED_IN', {
          path: '/', httpOnly: true, maxAge: 60 * 60 * 24 * 7, sameSite: 'Strict'
        });
        return c.json({ success: true });
      }
    }
    return c.json({ success: false, error: "用户名或密码错误" }, 401);
  }

  // 未配置环境变量时，拒绝登录
  return c.json({ success: false, error: "管理员未配置，请联系站点管理员设置 ADMIN_USERNAME / ADMIN_PASSWORD_HASH / ADMIN_SALT 环境变量" }, 503);
});

// ============================================================
// 3. 修改密码（生成新 hash + 更新环境变量）
// ============================================================
app.post('/admin/change-password', async (c) => {
  if (!(await isAdmin(c))) return c.json({ error: "未授权" }, 401);
  return c.json({ 
    success: false, 
    error: "密码修改请在 Cloudflare Dashboard 环境变量中更新 ADMIN_PASSWORD_HASH 和 ADMIN_SALT"
  }, 400);
});

// ============================================================
// 4. 退出登录
// ============================================================
app.post('/admin/logout', (c) => {
  deleteCookie(c, 'admin_token');
  return c.json({ success: true });
});

// ============================================================
// 5. 诗词解析接口 (Agnes AI -> ModelScope)
// ============================================================
app.post('/generate-prompt', async (c) => {
  try {
    if (!(await checkQuota(c))) return c.json({ error: "今日免费额度已用完 (3/3)，请明天再试或联系管理员" }, 429);

    const { poem } = await c.req.json();

    // 诊断日志：确认环境变量状态
    console.log('[Prompt Gen] Env check:', {
      hasAgnesAI: !!c.env.AGNES_AI_API_KEY,
      hasModelScope: !!c.env.MODEL_SCOPE_API_KEY,
      hasDB: !!c.env.DB,
      poemLength: poem?.length,
    });

    const systemInstruction = `你是一位精通"中国古典诗词"与"水墨丹青艺术"的大师。
你的任务是将用户提供的诗词，深度解析其意境与情感，转化为专为【水墨丹青国风意境画】设计的英文提示词。

输出必须为严格的 JSON 格式：{"chinese": "...", "english": "..."}

【chinese 字段要求】结构化的详细视觉解析，约 150-200 字，包含以下四个维度：

1. 场景构成
- 空间层次：远景、中景、近景的具体元素与布局
- 时间背景：季节、时辰、天气氛围（晨雾/暮霭/秋雨等）

2. 意象元素
- 核心物象：山石、树木、建筑、人物、马匹、舟船等具体描绘
- 点睛之笔：飞鸟、流水、云烟、落叶等动态细节

3. 水墨技法建议
- 笔法：皴法类型（斧劈皴/披麻皴/米点皴）、点染、晕染
- 墨色：焦浓重淡清五色的层次分布与过渡
- 留白：画面呼吸感的空间设计，虚实相生

4. 情调氛围
- 情感基调：苍凉、宁静、雄浑、婉约、空灵等
- 禅意表达：动与静、虚与实、有与无的辩证

【english 字段要求】
- 核心风格：Chinese ink wash painting、宣纸/绢本质感、工笔与写意结合
- 必备元素：negative space、ink gradients、dry brush strokes、ink wash blending
- 色彩：水墨五色为主，可点缀 vermilion red、azurite blue、malachite green
- 构图：传统散点透视或深远构图
- 画质增强：ancient Chinese painting on rice paper, museum-quality brushwork, handscroll format, masterpiece
- 长度：至少 70 个英文单词，严禁出现 photographic/cinematic/8k/DSLR 等摄影词汇

示例输出：
{"chinese": "【场景构成】远景为连绵云山，中景是荒废戍楼与残断城墙，近景一骑旅人迎风而行。时值深秋傍晚，北风萧瑟，暮色苍茫。【意象元素】山石用斧劈皴勾勒，棱角分明；城楼砖缝中野草摇曳，一抹斜阳如血浸染墙基；马匹鬃毛飞扬，旅人衣袂翻卷，马蹄踏碎枯草。远处孤雁掠过天际，落叶随风向西。【水墨技法建议】以焦墨勾勒山石轮廓，浓墨染城楼阴影，淡墨晕染天空与远山，飞白笔法表现风势，大面积留白呈现云山雾气与天空。【情调氛围】苍凉悲壮，古今幽恨在水墨氤氲间凝结，禅意体现于行旅与静止山石的对立，动与静的永恒张力。", "english": "A vast Chinese ink wash painting of late autumn border fortress landscape, traditional brushwork on aged xuan paper, powerful axe-cut texture strokes (斧劈皴) defining rugged mountain ridges in deep black ink, dilapidated watchtower with crumbling bricks rendered in layered ink wash from dark to pale grey, a solitary rider on horseback facing fierce northern wind, horse mane and traveler's robes swept by wind in dynamic dry brush strokes (飞白), setting sun like blood seeping into ancient walls in vermilion red wash, distant lone goose crossing grey sky, fallen leaves drifting westward, generous negative space in upper sky creating ethereal cloud mist atmosphere, meditative and melancholic mood, handscroll format, museum-quality masterpiece, traditional Chinese pigments"}`

    let text = '';

    // 策略1: Agnes AI (主力，同步返回，体验更好)
    const agnesKey = c.env.AGNES_AI_API_KEY;
    if (agnesKey) {
      try {
        text = await callAgnesAIChat(agnesKey, poem, systemInstruction);
        console.log('[Prompt Gen] Agnes AI success');
      } catch (err: any) {
        console.error('[Prompt Gen] Agnes AI failed:', err.message);
      }
    }

    // 策略2: ModelScope 兜底 (稳定可用)
    const msKey = c.env.MODEL_SCOPE_API_KEY;
    if (!text && msKey) {
      try {
        text = await callModelScopeText(msKey, poem, systemInstruction);
        console.log('[Prompt Gen] ModelScope fallback success');
      } catch (err: any) {
        console.error('[Prompt Gen] ModelScope also failed:', err.message);
      }
    }

    if (!text) {
      return c.json({ chinese: "解析失败：所有 AI 服务均不可用", english: "All AI services unavailable" }, 500);
    }

    let rawData: any;
    try {
      rawData = JSON.parse(text);
    } catch {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      rawData = jsonMatch ? JSON.parse(jsonMatch[0]) : { chinese: text, english: text };
    }

    const processedData = {
      chinese: typeof rawData.chinese === 'object' ? JSON.stringify(rawData.chinese) : (rawData.chinese || ""),
      english: typeof rawData.english === 'object' ? JSON.stringify(rawData.english) : (rawData.english || "")
    };

    if (!processedData.chinese) processedData.chinese = "未能解析出意境描述";
    if (!processedData.english) processedData.english = "Failed to generate visual prompt";

    return c.json(processedData);
  } catch (e: any) {
    console.error("Generate Prompt Error:", e);
    return c.json({ chinese: `解析出错: ${e.message}`, english: "Analysis error", error: e.message }, 500);
  }
});

// ============================================================
// 6. 视频生成接口 (Agnes AI 异步模式)
// POST /v1/videos → { id, status: "queued", progress: 0 }
// 前端拿到 id 后调用 poll-video 轮询
// ============================================================
app.post('/generate-video', async (c) => {
  try {
    if (!(await checkQuota(c))) return c.json({ error: "今日免费额度已用完" }, 429);

    const { prompt } = await c.req.json();
    const apiKey = c.env.AGNES_AI_API_KEY;
    if (!apiKey) {
      return c.json({ 
        error: "视频生成服务暂时不可用", 
        details: "未配置 Agnes AI API Key" 
      }, 503);
    }

    let result;
    try {
      result = await callAgnesAIVideo(apiKey, prompt);
    } catch (err: any) {
      if (err.message?.includes('525')) {
        return c.json({ 
          error: "视频生成服务暂时不可用", 
          details: "Agnes AI 服务端 SSL 证书配置有问题 (error 525)"
        }, 503);
      }
      throw err;
    }
    console.log('[Video Gen] Agnes AI task submitted:', JSON.stringify(result).slice(0, 500));

    // Agnes AI 异步模式：返回 { id, status, progress, ... }
    // 前端需要 task_id 来轮询
    const taskId = result.id || result.task_id;
    if (!taskId) {
      // 如果意外同步返回了视频（不太可能但防御）
      const videoUrl = result?.video_url || result?.data?.[0]?.url;
      if (videoUrl) {
        return c.json({
          done: true,
          response: {
            generatedVideos: [{ video: { uri: videoUrl } }]
          }
        });
      }
      return c.json({ error: "视频任务提交失败：未返回任务 ID", details: JSON.stringify(result) }, 500);
    }

    // 返回异步任务信息，前端会用这个对象调 poll-video
    return c.json({
      done: false,
      taskId,
      status: result.status || 'queued',
      progress: result.progress || 0,
      _raw: result
    });
  } catch (error: any) {
    console.error("Generate Video Error:", error);
    return c.json({ error: `视频生成请求失败: ${error.message || '未知错误'}`, details: error.message }, 500);
  }
});

// ============================================================
// 7. 视频状态轮询接口 (Agnes AI)
// GET /v1/videos/{task_id} → { status, progress, video_url }
// ============================================================
app.post('/poll-video', async (c) => {
  try {
    const body = await c.req.json();
    // 前端传 operation 对象（来自 generate-video 的返回）
    const operation = body.operation || body;
    if (!operation) return c.json({ error: "缺少 operation 参数" }, 400);

    const apiKey = c.env.AGNES_AI_API_KEY;
    if (!apiKey) return c.json({ error: "未配置 Agnes AI API Key" }, 500);

    // 如果已经是完成状态，直接返回
    if (operation.done === true) {
      return c.json(operation);
    }

    // 如果已经是完成状态，直接返回
    if (operation.done === true) {
      return c.json(operation);
    }

    // ============================================================
    // 6.5 视频轮询接口（支持多种 URL 格式 + 完成无 URL 继续轮询）
    // ============================================================
    const taskId = typeof operation === 'string'
      ? operation
      : (operation.taskId || operation.task_id || operation.id || operation.name || null);

    if (!taskId) {
      return c.json({ error: '无法提取任务 ID', details: JSON.stringify(operation) }, 400);
    }

    console.log('[Poll Video] Polling task:', taskId);

    let result;
    try {
      const pollUrl = `https://apihub.agnes-ai.com/v1/videos/${encodeURIComponent(taskId)}`;
      const response = await fetch(pollUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      result = await response.json();
    } catch (err: any) {
      if (err.message?.includes('525') || err.message?.includes('SSL')) {
        return c.json({ done: false, taskId, status: 'in_progress', progress: 0, _retryHint: 'SSL 525, retry in 10s' });
      }
      throw err;
    }

    console.log('[Poll Video] Result:', JSON.stringify(result).slice(0, 500));

    const status = result.status || 'in_progress';
    const progress = result.progress || 0;
    const isCompleted = status === 'completed' || status === 'succeeded';
    const videoUrl = result?.data?.[0]?.url ||
                     result?.video_url ||
                     result?.data?.[0]?.video_url ||
                     result?.url || null;

    if (isCompleted && videoUrl) {
      console.log('[Poll Video] Video completed, URL:', videoUrl.slice(0, 100));
      return c.json({
        done: true,
        video_url: videoUrl,
        response: { generatedVideos: [{ video: { uri: videoUrl } }] },
        _raw: result
      });
    }

    if (isCompleted && !videoUrl) {
      console.warn('[Poll Video] Completed but no URL, continuing:', JSON.stringify(result).slice(0, 200));
      return c.json({ done: false, taskId, status: 'in_progress', progress, _waitMore: true });
    }

    if (status === 'failed') {
      return c.json({ done: true, error: { message: result.error || '视频生成失败' }, _raw: result });
    }

    return c.json({ done: false, taskId, status, progress, _raw: result });
  } catch (error: any) {
    console.error('Poll Video Error:', error);
    return c.json({ error: `状态查询失败: ${error.message || '未知错误'}`, details: error.message }, 500);
  }
});

// ============================================================
// 8. 图像生成接口 (Agnes AI -> ModelScope)
// ============================================================
app.post('/generate-image', async (c) => {
  if (!(await checkQuota(c))) return c.json({ error: "今日免费额度已用完" }, 429);

  const { prompt } = await c.req.json();
  const enhancedPrompt = `${prompt}, traditional Chinese ink wash painting on aged xuan paper, museum-quality brushwork, traditional Chinese pigments, delicate and refined, masterpiece, best quality`;

  // 策略1: ModelScope 千问 Z-Image (主力，质量更佳)
  const msKey = c.env.MODEL_SCOPE_API_KEY;
  if (msKey) {
    try {
      console.log('[Image Gen] Trying ModelScope Z-Image...');
      const result = await Promise.race([
        callModelScopeImage(msKey, enhancedPrompt),
        new Promise((_, reject) => setTimeout(() => reject(new Error('ModelScope timeout (90s)')), 90000))
      ]) as any;
      if (result.url) {
        console.log('[Image Gen] ModelScope success');
        return c.json({ generatedImages: [{ image: { url: result.url } }] });
      }
    } catch (err: any) {
      console.error('[Image Gen] ModelScope failed:', err.message);
    }
  }

  // 策略2: Agnes AI 兜底
  const agnesKey = c.env.AGNES_AI_API_KEY;
  if (agnesKey) {
    try {
      console.log('[Image Gen] Fallback to Agnes AI...');
      const result = await Promise.race([
        callAgnesAIImage(agnesKey, enhancedPrompt),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Agnes AI timeout (30s)')), 30000))
      ]) as any;
      if (result.b64_json || result.url) {
        console.log('[Image Gen] Agnes AI success');
        return c.json({
          generatedImages: result.b64_json
            ? [{ image: { imageBytes: result.b64_json } }]
            : [{ image: { url: result.url } }]
        });
      }
    } catch (err: any) {
      console.error('[Image Gen] Agnes AI also failed:', err.message);
    }
  }

  return c.json({ error: "所有图片生成服务均不可用。请稍后再试或联系管理员。" }, 500);
});

// ============================================================
// 9. 诗词吟诵接口 (ModelScope TTS -> Agnes AI TTS)
// 注意: ModelScope 不支持 OpenAI 兼容的 TTS HTTP API，仅提供 Python SDK
// 当前依赖 Agnes AI，但 Agnes AI SSL 证书有问题，暂时不可用
// ============================================================
app.post('/generate-speech', async (c) => {
  try {
    if (!(await checkQuota(c))) return c.json({ error: "今日免费额度已用完" }, 429);

    const { text } = await c.req.json();

    // ModelScope TTS 不支持 HTTP API，直接尝试 Agnes AI
    const agnesKey = c.env.AGNES_AI_API_KEY;
    if (agnesKey) {
      try {
        console.log('[TTS] Trying Agnes AI...');
        const ttsText = `请吟诵这首古诗：${text}`;
        const audioBuffer = await callAgnesAITTS(agnesKey, ttsText);
        const bytes = new Uint8Array(audioBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        const base64Audio = btoa(binary);
        console.log('[TTS] Agnes AI success');
        return c.json({ base64Audio });
      } catch (err: any) {
        console.error('[TTS] Agnes AI failed:', err.message);
        // Agnes AI SSL 问题，返回友好提示
        if (err.message?.includes('525')) {
          return c.json({ 
            error: "语音吟诵服务暂时不可用", 
            details: "Agnes AI 服务端 SSL 证书配置有问题，请联系 Agnes AI 技术支持",
            workaround: "建议暂时使用其他功能：解析意境、生成图片、生成视频"
          }, 503);
        }
      }
    }

    return c.json({ 
      error: "语音吟诵服务暂时不可用",
      details: "当前无可用的 TTS 服务提供商。ModelScope 不支持 HTTP API，Agnes AI SSL 证书有问题。",
      workaround: "建议暂时使用其他功能：解析意境、生成图片、生成视频"
    }, 503);
  } catch (error: any) {
    console.error("TTS Error:", error);
    return c.json({ error: `吟诵生成失败: ${error.message || '模型可能暂不可用'}`, details: error.message }, 500);
  }
});

// ============================================================
// 10. 视频下载代理接口 (通用下载)
// ============================================================
app.get('/download-video', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ error: "缺少 URL 参数" }, 400);

  try {
    const response = await fetch(url, { method: 'GET' });

    if (!response.ok) {
      return c.json({ error: "视频下载失败" }, response.status as any);
    }

    return new Response(response.body, {
      headers: {
        'Content-Type': response.headers.get('Content-Type') || 'video/mp4',
        'Content-Disposition': `attachment; filename="video_${Date.now()}.mp4"`,
      },
    });
  } catch (error: any) {
    return c.json({ error: `视频下载失败: ${error.message}` }, 500);
  }
});

// ============================================================
// 11. 藏书阁接口 (D1 数据库，不变)
// ============================================================
app.get('/library', async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM library ORDER BY created_at DESC"
  ).all();
  return c.json(results);
});

app.post('/library', async (c) => {
  if (!(await isAdmin(c))) return c.json({ error: "仅管理员可录入藏书" }, 401);
  const { poem } = await c.req.json();
  const id = Date.now().toString();
  await c.env.DB.prepare(
    "INSERT INTO library (id, poem, created_at) VALUES (?, ?, ?)"
  ).bind(id, poem, new Date().toISOString()).run();
  return c.json({ success: true, id });
});

app.delete('/library/:id', async (c) => {
  if (!(await isAdmin(c))) return c.json({ error: "仅管理员可移除藏书" }, 401);
  const id = c.req.param('id');
  await c.env.DB.prepare("DELETE FROM library WHERE id = ?").bind(id).run();
  return c.json({ success: true });
});

export const onRequest = handle(app);

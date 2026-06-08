import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';

type Bindings = {
  // Agnes AI API Key (主力 - 全功能)
  AGNES_AI_API_KEY: string;
  // ModelScope API Key (备用/兜底)
  MODEL_SCOPE_API_KEY?: string;
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

const AGNES_AI_BASE = 'https://api.agnesai.com';

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
 */
async function callAgnesAIImage(apiKey: string, prompt: string): Promise<{ b64_json?: string; url?: string }> {
  const response = await fetch(`${AGNES_AI_BASE}/v1/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'agnes-ai-v1',
      prompt,
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
 * Agnes AI 视频生成
 */
async function callAgnesAIVideo(apiKey: string, prompt: string): Promise<any> {
  const response = await fetch(`${AGNES_AI_BASE}/v1/videos/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'agnes-ai-video',
      prompt,
      n: 1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Agnes AI Video error ${response.status}: ${errorText}`);
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
    body: JSON.stringify({ model: 'Tongyi-MAI/Z-Image', prompt }),
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
    isAdmin: loggedIn,
  });
});

// ============================================================
// 2. 管理员登录
// ============================================================
app.post('/admin/login', async (c) => {
  const { email, password } = await c.req.json();

  if ((email === 'lablabe@qq.com' || email === 'AS2008FG@gmail.com') && password === 'admin123654') {
    setCookie(c, 'admin_token', 'ZEN_ADMIN_LOGGED_IN', {
      path: '/', secure: true, httpOnly: true, maxAge: 60 * 60 * 24, sameSite: 'Strict'
    });
    return c.json({ success: true });
  }

  const admin = await c.env.DB.prepare(
    "SELECT * FROM admins WHERE email = ? AND password = ?"
  ).bind(email, password).first();

  if (admin) {
    setCookie(c, 'admin_token', 'ZEN_ADMIN_LOGGED_IN', {
      path: '/', secure: true, httpOnly: true, maxAge: 60 * 60 * 24, sameSite: 'Strict'
    });
    return c.json({ success: true });
  }

  return c.json({ success: false, error: "邮箱或密码错误" }, 401);
});

// ============================================================
// 3. 修改密码
// ============================================================
app.post('/admin/change-password', async (c) => {
  if (!(await isAdmin(c))) return c.json({ error: "未授权" }, 401);
  const { newPassword } = await c.req.json();
  await c.env.DB.prepare(
    "INSERT INTO admins (email, password) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET password = ?"
  ).bind('lablabe@qq.com', newPassword, newPassword).run();
  return c.json({ success: true });
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

    const systemInstruction = `你是一位集"中国古典诗词研究专家"、"美学视觉专家"与"奥斯卡金像奖导演"于一身的跨界大师。
你的任务是将用户提供的诗词，深度解析其意境、色彩、构图与情感，并转化为极其专业的电影分镜脚本。

输出必须为严格的 JSON 格式：{"chinese": "...", "english": "..."}
- chinese: 对诗句意境的优美中文描述，融合文学性与视觉美感。
- english: 专门为图片/视频生成模型设计的纯英文提示词。要求包含：镜头语言（如 Close-up, Slow-motion）、光影描述（如 Cinematic lighting, Golden hour）、艺术风格（如 Traditional Chinese ink wash style, Photorealistic）以及具体的画面细节。`;

    let text = '';

    // 策略1: ModelScope (主力，稳定可用)
    const msKey = c.env.MODEL_SCOPE_API_KEY;
    if (msKey) {
      try {
        text = await callModelScopeText(msKey, poem, systemInstruction);
        console.log('[Prompt Gen] ModelScope success');
      } catch (err: any) {
        console.error('[Prompt Gen] ModelScope failed:', err.message);
      }
    }

    // 策略2: Agnes AI 兜底
    const agnesKey = c.env.AGNES_AI_API_KEY;
    if (!text && agnesKey) {
      try {
        text = await callAgnesAIChat(agnesKey, poem, systemInstruction);
        console.log('[Prompt Gen] Agnes AI fallback success');
      } catch (err: any) {
        console.error('[Prompt Gen] Agnes AI also failed:', err.message);
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
// 6. 视频生成接口 (Agnes AI)
// 兼容前端轮询模式：如果 Agnes AI 同步返回结果，直接包装成 done:true
// ============================================================
app.post('/generate-video', async (c) => {
  try {
    if (!(await checkQuota(c))) return c.json({ error: "今日免费额度已用完" }, 429);

    const { prompt } = await c.req.json();
    const apiKey = c.env.AGNES_AI_API_KEY;
    if (!apiKey) return c.json({ error: "未配置 Agnes AI API Key" }, 500);

    const result = await callAgnesAIVideo(apiKey, prompt);
    console.log('[Video Gen] Agnes AI raw result:', JSON.stringify(result).slice(0, 500));

    // 检查是否同步返回了视频数据（URL 或 base64）
    const videoUrl =
      result?.data?.[0]?.url ||
      result?.data?.[0]?.video_url ||
      result?.video_url ||
      result?.url ||
      result?.output?.url ||
      result?.output?.video_url ||
      (typeof result === 'string' ? result : null);

    const videoB64 =
      result?.data?.[0]?.b64_json ||
      result?.data?.[0]?.base64 ||
      result?.base64;

    if (videoUrl || videoB64) {
      // 同步返回成功，包装成前端期望的格式
      const wrappedResult = {
        done: true,
        response: {
          generatedVideos: [{ video: { uri: videoUrl || undefined, b64_json: videoB64 || undefined } }]
        },
        _raw: result // 保留原始数据供调试
      };
      console.log('[Video Gen] Synchronous success, wrapping as done:true');
      return c.json(wrappedResult);
    }

    // 如果返回了 task_id/operation name，按异步模式返回
    if (result?.task_id || result?.id || result?.name || (typeof result === 'object' && !result.data)) {
      console.log('[Video Gen] Async mode, returning operation:', JSON.stringify(result).slice(0, 200));
      return c.json(result);
    }

    // 无法识别的格式，原样返回并记录
    console.log('[Video Gen] Unknown format, returning raw:', JSON.stringify(result).slice(0, 300));
    return c.json(result);
  } catch (error: any) {
    console.error("Generate Video Error:", error);
    return c.json({ error: `视频生成请求失败: ${error.message || '未知错误'}`, details: error.message }, 500);
  }
});

// ============================================================
// 7. 视频状态轮询接口 (Agnes AI / 通用)
// ============================================================
app.post('/poll-video', async (c) => {
  try {
    const { operation } = await c.req.json();
    if (!operation) return c.json({ error: "缺少 operation 参数" }, 400);

    const apiKey = c.env.AGNES_AI_API_KEY;
    if (!apiKey) return c.json({ error: "未配置 Agnes AI API Key" }, 500);

    // 如果传入的 operation 已经是 done:true（同步返回的情况），直接返回
    if (operation.done === true) {
      console.log('[Poll Video] Operation already completed, returning as-is');
      return c.json(operation);
    }

    // 尝试提取 task_id 进行异步查询
    const taskId = typeof operation === 'string'
      ? operation
      : (operation?.task_id || operation?.id || operation?.name || null);

    if (taskId) {
      console.log('[Poll Video] Polling task:', taskId);
      try {
        const pollUrl = `${AGNES_AI_BASE}/v1/videos/${encodeURIComponent(taskId)}`;
        const response = await fetch(pollUrl, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' }
        });

        if (response.ok) {
          const result = await response.json();
          console.log('[Poll Video] Result:', JSON.stringify(result).slice(0, 300));

          // 检查是否完成
          const videoUrl = result?.data?.[0]?.url || result?.video_url || result?.url;
          if (videoUrl || result.status === 'completed' || result.done === true) {
            return c.json({
              done: true,
              response: {
                generatedVideos: [{ video: { uri: videoUrl } }]
              }
            });
          }
          // 还在进行中
          return c.json({ done: false, ...result });
        } else {
          // 查询端点可能不存在，返回原始 operation
          console.warn('[Poll Video] Poll endpoint not available:', response.status);
        }
      } catch (pollErr: any) {
        console.error('[Poll Video] Poll failed:', pollErr.message);
      }
    }

    // 无法轮询，直接标记完成并尝试从原始数据中提取 URL
    console.log('[Poll Video] Cannot poll, checking raw operation for URL');
    const fallbackUrl =
      (operation as any)?.response?.generatedVideos?.[0]?.video?.uri ||
      (operation as any)?.video_url ||
      (operation as any)?.url;

    if (fallbackUrl) {
      return c.json({
        done: true,
        response: { generatedVideos: [{ video: { uri: fallbackUrl } }] }
      });
    }

    return c.json({ error: "无法获取视频状态" }, 400);
  } catch (error: any) {
    console.error("Poll Video Error:", error);
    return c.json({ error: `状态查询失败: ${error.message || '未知错误'}`, details: error.message }, 500);
  }
});

// ============================================================
// 8. 图像生成接口 (ModelScope -> Agnes AI)
// ============================================================
app.post('/generate-image', async (c) => {
  if (!(await checkQuota(c))) return c.json({ error: "今日免费额度已用完" }, 429);

  const { prompt } = await c.req.json();
  const enhancedPrompt = `A cinematic masterpiece of Chinese traditional painting style. ${prompt}. Ultra-high definition, 4k quality, photorealistic, intricate details, elegant composition, traditional Chinese aesthetic.`;

  // 策略1: ModelScope (主力)
  const msKey = c.env.MODEL_SCOPE_API_KEY;
  if (msKey) {
    try {
      console.log('[Image Gen] Trying ModelScope...');
      const result = await callModelScopeImage(msKey, enhancedPrompt);
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
      const result = await callAgnesAIImage(agnesKey, enhancedPrompt);
      if (result.b64_json || result.url) {
        console.log('[Image Gen] ModelScope success');
        return c.json({
          generatedImages: result.b64_json
            ? [{ image: { imageBytes: result.b64_json } }]
            : [{ image: { url: result.url } }]
        });
      }
    } catch (err: any) {
      console.error('[Image Gen] ModelScope also failed:', err.message);
    }
  }

  return c.json({ error: "所有图片生成服务均不可用" }, 500);
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

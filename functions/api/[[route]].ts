import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { GoogleGenAI, Type, Modality } from "@google/genai";

type Bindings = {
  // ModelScope API Key (诗词解析 + TTS + 图片兜底)
  MODEL_SCOPE_API_KEY: string;
  // Agnes AI API Key (图片生成优先)
  AGNES_AI_API_KEY: string;
  // Google API Keys (仅用于视频生成 Veo)
  GEMINI_PRO_API_KEY?: string;
  GOOGLE_AI_STUDIO_API_KEY?: string;
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
};

// ============================================================
// ModelScope 调用工具
// ============================================================

/**
 * 调用 ModelScope 文本生成 API
 */
async function callModelScopeText(apiKey: string, prompt: string, systemPrompt?: string): Promise<string> {
  const messages: Array<{ role: string; content: string }> = [];
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt });
  }
  messages.push({ role: 'user', content: prompt });

  const response = await fetch('https://api-inference.modelscope.cn/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'Qwen/Qwen3-235B-A22B',
      messages,
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ModelScope API error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as any;
  return data.choices?.[0]?.message?.content || '';
}

/**
 * 调用 ModelScope 图片生成 API
 */
async function callModelScopeImage(apiKey: string, prompt: string): Promise<{ b64_json?: string; url?: string }> {
  const response = await fetch('https://api-inference.modelscope.cn/v1/images/generations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'AI-ModelScope/stable-diffusion-xl-base-1.0',
      prompt,
      n: 1,
      size: '1024x1024',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ModelScope Image API error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as any;
  return data.images?.[0] || {};
}

/**
 * 调用 ModelScope TTS API
 */
async function callModelScopeTTS(apiKey: string, text: string): Promise<ArrayBuffer> {
  const response = await fetch('https://api-inference.modelscope.cn/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'FunAudioLLM/CosyVoice2-0.5B',
      input: text,
      voice: 'FunAudioLLM/CosyVoice2-0.5B:alex',
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`ModelScope TTS API error ${response.status}: ${errorText}`);
  }

  return await response.arrayBuffer();
}

// ============================================================
// Agnes AI 调用工具
// ============================================================

async function callAgnesAIImage(apiKey: string, prompt: string): Promise<{ b64_json?: string; url?: string }> {
  const response = await fetch('https://api.agnesai.com/v1/images/generations', {
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
    throw new Error(`Agnes AI API error ${response.status}: ${errorText}`);
  }

  const data = await response.json() as any;
  return data.data?.[0] || {};
}

// ============================================================
// 1. 健康检查与状态
// ============================================================
app.get('/health', async (c) => {
  const loggedIn = await isAdmin(c);
  return c.json({
    hasModelScopeKey: !!c.env.MODEL_SCOPE_API_KEY,
    hasAgnesAIKey: !!c.env.AGNES_AI_API_KEY,
    hasGeminiProKey: !!c.env.GEMINI_PRO_API_KEY,
    hasStudioKey: !!c.env.GOOGLE_AI_STUDIO_API_KEY,
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
      path: '/',
      secure: true,
      httpOnly: true,
      maxAge: 60 * 60 * 24,
      sameSite: 'Strict'
    });
    return c.json({ success: true });
  }

  const admin = await c.env.DB.prepare(
    "SELECT * FROM admins WHERE email = ? AND password = ?"
  ).bind(email, password).first();

  if (admin) {
    setCookie(c, 'admin_token', 'ZEN_ADMIN_LOGGED_IN', {
      path: '/',
      secure: true,
      httpOnly: true,
      maxAge: 60 * 60 * 24,
      sameSite: 'Strict'
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
  const email = 'lablabe@qq.com';

  await c.env.DB.prepare(
    "INSERT INTO admins (email, password) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET password = ?"
  ).bind(email, newPassword, newPassword).run();

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
// 5. 诗词解析接口 (ModelScope)
// ============================================================
app.post('/generate-prompt', async (c) => {
  try {
    if (!(await checkQuota(c))) return c.json({ error: "今日免费额度已用完 (3/3)，请明天再试或联系管理员" }, 429);

    const { poem } = await c.req.json();
    const apiKey = c.env.MODEL_SCOPE_API_KEY;
    if (!apiKey) return c.json({ error: "未配置 ModelScope API Key" }, 500);

    const systemInstruction = `你是一位集"中国古典诗词研究专家"、"美学视觉专家"与"奥斯卡金像奖导演"于一身的跨界大师。
你的任务是将用户提供的诗词，深度解析其意境、色彩、构图与情感，并转化为极其专业的电影分镜脚本。

输出必须为严格的 JSON 格式：{"chinese": "...", "english": "..."}
- chinese: 对诗句意境的优美中文描述，融合文学性与视觉美感。
- english: 专门为图片/视频生成模型设计的纯英文提示词。要求包含：镜头语言（如 Close-up, Slow-motion）、光影描述（如 Cinematic lighting, Golden hour）、艺术风格（如 Traditional Chinese ink wash style, Photorealistic）以及具体的画面细节。`;

    const text = await callModelScopeText(apiKey, poem, systemInstruction);

    if (!text) {
      return c.json({ chinese: "解析失败：模型返回内容为空", english: "Analysis failed: empty response" });
    }

    let rawData: any;
    try {
      rawData = JSON.parse(text);
    } catch {
      // 如果返回的不是 JSON，尝试提取
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        rawData = JSON.parse(jsonMatch[0]);
      } else {
        return c.json({ chinese: text, english: text });
      }
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
    return c.json({
      chinese: `解析出错: ${e.message}`,
      english: "Analysis error",
      error: e.message
    }, 500);
  }
});

// ============================================================
// 6. 视频生成接口 (保留 Gemini Veo)
// ============================================================
app.post('/generate-video', async (c) => {
  try {
    if (!(await checkQuota(c))) return c.json({ error: "今日免费额度已用完" }, 429);

    const { prompt } = await c.req.json();
    const apiKey = c.env.GOOGLE_AI_STUDIO_API_KEY;
    if (!apiKey) return c.json({ error: "未配置 Google AI Studio API Key (视频生成需要)" }, 500);

    const ai = new GoogleGenAI({ apiKey });

    const operation = await ai.models.generateVideos({
      model: 'veo-3.1-fast-generate-preview',
      prompt: prompt,
      config: { numberOfVideos: 1, resolution: '720p', aspectRatio: '16:9' }
    });
    return c.json(operation);
  } catch (error: any) {
    console.error("Generate Video Error:", error);
    return c.json({ error: `视频生成请求失败: ${error.message || '未知错误'}`, details: error }, 500);
  }
});

// ============================================================
// 7. 视频状态轮询接口 (保留 Gemini)
// ============================================================
app.post('/poll-video', async (c) => {
  try {
    const { operation } = await c.req.json();
    if (!operation) return c.json({ error: "缺少 operation 参数" }, 400);

    const apiKey = c.env.GOOGLE_AI_STUDIO_API_KEY;
    if (!apiKey) return c.json({ error: "未配置 Google AI Studio API Key" }, 500);

    const opName = typeof operation === 'object' ? (operation.name || operation) : operation;

    if (!opName || typeof opName !== 'string') {
      return c.json({ error: "无效的 operation ID" }, 400);
    }

    console.log("Polling operation via direct fetch:", opName);

    const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${opName}`;
    const response = await fetch(pollUrl, {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(`Google API 错误: ${response.status} ${JSON.stringify(errorData)}`);
    }

    const result = await response.json();
    return c.json(result);
  } catch (error: any) {
    console.error("Poll Video Error:", error);
    const errorDetail = error.response?.data || error.details || error.message || error;
    return c.json({
      error: `状态查询失败: ${error.message || '未知错误'}`,
      details: errorDetail
    }, 500);
  }
});

// ============================================================
// 8. 图像生成接口 (Agnes AI 优先 -> ModelScope 兜底)
// ============================================================
app.post('/generate-image', async (c) => {
  if (!(await checkQuota(c))) return c.json({ error: "今日免费额度已用完" }, 429);

  const { prompt } = await c.req.json();
  const enhancedPrompt = `A cinematic masterpiece of Chinese traditional painting style. ${prompt}. Ultra-high definition, 4k quality, photorealistic, intricate details, elegant composition, traditional Chinese aesthetic.`;

  // 策略1: 尝试 Agnes AI
  const agnesKey = c.env.AGNES_AI_API_KEY;
  if (agnesKey) {
    try {
      console.log('[Image Gen] Trying Agnes AI...');
      const result = await callAgnesAIImage(agnesKey, enhancedPrompt);
      if (result.b64_json || result.url) {
        console.log('[Image Gen] Agnes AI success');
        return c.json({
          generatedImages: result.b64_json ? [{ image: { imageBytes: result.b64_json } }] : [{ image: { url: result.url } }]
        });
      }
    } catch (err: any) {
      console.error('[Image Gen] Agnes AI failed:', err.message);
      // 继续尝试 ModelScope
    }
  }

  // 策略2: 兜底到 ModelScope
  const msKey = c.env.MODEL_SCOPE_API_KEY;
  if (msKey) {
    try {
      console.log('[Image Gen] Fallback to ModelScope...');
      const result = await callModelScopeImage(msKey, enhancedPrompt);
      if (result.b64_json || result.url) {
        console.log('[Image Gen] ModelScope success');
        return c.json({
          generatedImages: result.b64_json ? [{ image: { imageBytes: result.b64_json } }] : [{ image: { url: result.url } }]
        });
      }
    } catch (err: any) {
      console.error('[Image Gen] ModelScope also failed:', err.message);
    }
  }

  // 策略3: 最后兜底到 Gemini Image (如果还有 key)
  const geminiKey = c.env.GOOGLE_AI_STUDIO_API_KEY;
  if (geminiKey) {
    try {
      console.log('[Image Gen] Fallback to Gemini Image...');
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-flash-image-preview',
        contents: [{
          parts: [{ text: enhancedPrompt }]
        }],
        config: {
          imageConfig: {
            aspectRatio: "16:9",
            imageSize: "4K"
          }
        },
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return c.json({
            generatedImages: [{
              image: { imageBytes: part.inlineData.data }
            }]
          });
        }
      }
    } catch (err: any) {
      console.error('[Image Gen] Gemini also failed:', err.message);
    }
  }

  return c.json({ error: "所有图片生成服务均不可用" }, 500);
});

// ============================================================
// 9. 诗词吟诵接口 (ModelScope TTS)
// ============================================================
app.post('/generate-speech', async (c) => {
  try {
    if (!(await checkQuota(c))) return c.json({ error: "今日免费额度已用完" }, 429);

    const { text } = await c.req.json();
    const apiKey = c.env.MODEL_SCOPE_API_KEY;
    if (!apiKey) return c.json({ error: "未配置 ModelScope API Key (TTS 需要)" }, 500);

    const ttsText = `请吟诵这首古诗：${text}`;
    const audioBuffer = await callModelScopeTTS(apiKey, ttsText);

    // 将 ArrayBuffer 转 base64
    const bytes = new Uint8Array(audioBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Audio = btoa(binary);

    return c.json({ base64Audio });
  } catch (error: any) {
    console.error("TTS Error:", error);

    // 如果 ModelScope TTS 失败，尝试 Gemini TTS 兜底
    const geminiKey = c.env.GOOGLE_AI_STUDIO_API_KEY;
    if (geminiKey) {
      try {
        console.log('[TTS] Fallback to Gemini TTS...');
        const ai = new GoogleGenAI({ apiKey: geminiKey });
        const response = await ai.models.generateContent({
          model: "gemini-2.5-flash-preview-tts",
          contents: [{ parts: [{ text: `请吟诵：${text}` }] }],
          config: {
            responseModalities: ['AUDIO'] as any,
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: 'Fenrir' }
              }
            }
          }
        });

        const candidate = response.candidates?.[0];
        const audioPart = candidate?.content?.parts?.find(p =>
          p.inlineData?.mimeType?.includes('audio') || p.inlineData?.data
        );
        const base64Fallback = audioPart?.inlineData?.data;

        if (base64Fallback) {
          return c.json({ base64Audio: base64Fallback });
        }
      } catch (fallbackErr: any) {
        console.error('[TTS] Gemini fallback also failed:', fallbackErr.message);
      }
    }

    return c.json({
      error: `吟诵生成失败: ${error.message || '模型可能暂不可用'}`,
      details: error.message
    }, 500);
  }
});

// ============================================================
// 10. 视频下载代理接口 (保留 Gemini)
// ============================================================
app.get('/download-video', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ error: "缺少 URL 参数" }, 400);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'x-goog-api-key': c.env.GOOGLE_AI_STUDIO_API_KEY,
    },
  });

  if (!response.ok) {
    return c.json({ error: "视频下载失败" }, response.status as any);
  }

  return new Response(response.body, {
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'video/mp4',
      'Content-Disposition': `attachment; filename="video_${Date.now()}.mp4"`,
    },
  });
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

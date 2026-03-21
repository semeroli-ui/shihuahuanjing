import { Hono } from 'hono';
import { handle } from 'hono/cloudflare-pages';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { GoogleGenAI, Type, Modality } from "@google/genai";

type Bindings = {
  GEMINI_PRO_API_KEY: string;
  GOOGLE_AI_STUDIO_API_KEY: string;
  DB: D1Database;
};

const app = new Hono<{ Bindings: Bindings }>().basePath('/api');

// --- 日志中间件 ---
app.use('*', async (c, next) => {
  console.log(`[API Request] ${c.req.method} ${c.req.url}`);
  await next();
});

// --- 辅助函数 ---

// 获取 API Key (支持逗号分隔的多个 Key 轮询)
const getApiKey = (keyString: string | undefined) => {
  if (!keyString) return null;
  const keys = keyString.split(',').map(k => k.trim()).filter(k => k.length > 0);
  if (keys.length === 0) return null;
  // 随机选择一个 Key 以分散负载
  return keys[Math.floor(Math.random() * keys.length)];
};

// 检查是否是管理员
const isAdmin = async (c: any) => {
  const token = getCookie(c, 'admin_token');
  return token === 'ZEN_ADMIN_LOGGED_IN'; // 简单实现，实际生产建议使用更安全的 JWT
};

// 检查并更新配额 (每个 IP 每天 3 次)
const checkQuota = async (c: any) => {
  if (await isAdmin(c)) return true; // 管理员不受限制

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

// 1. 健康检查与状态
app.get('/health', async (c) => {
  const loggedIn = await isAdmin(c);
  const proKeys = c.env.GEMINI_PRO_API_KEY ? c.env.GEMINI_PRO_API_KEY.split(',').filter(k => k.trim().length > 0).length : 0;
  return c.json({ 
    hasProKey: proKeys > 0, // 用于诗词解析 (免费层)
    proKeyCount: proKeys,
    hasStudioKey: !!c.env.GOOGLE_AI_STUDIO_API_KEY, // 用于 Veo/Imagen/TTS (高权限)
    hasDB: !!c.env.DB,
    isAdmin: loggedIn
  });
});

// 2. 管理员登录
app.post('/admin/login', async (c) => {
  const { email, password } = await c.req.json();
  
  // 初始账号检查 (增加当前用户邮箱)
  if ((email === 'lablabe@qq.com' || email === 'AS2008FG@gmail.com') && password === 'admin123654') {
    setCookie(c, 'admin_token', 'ZEN_ADMIN_LOGGED_IN', {
      path: '/',
      secure: true,
      httpOnly: true,
      maxAge: 60 * 60 * 24, // 1天
      sameSite: 'Strict'
    });
    return c.json({ success: true });
  }

  // 数据库检查 (支持修改后的密码)
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

// 3. 修改密码 (需要登录)
app.post('/admin/change-password', async (c) => {
  if (!(await isAdmin(c))) return c.json({ error: "未授权" }, 401);
  
  const { newPassword } = await c.req.json();
  const email = 'lablabe@qq.com';

  // 更新或插入新密码
  await c.env.DB.prepare(
    "INSERT INTO admins (email, password) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET password = ?"
  ).bind(email, newPassword, newPassword).run();

  return c.json({ success: true });
});

// 4. 退出登录
app.post('/admin/logout', (c) => {
  deleteCookie(c, 'admin_token');
  return c.json({ success: true });
});

// 5. 诗词解析接口 (受配额限制)
app.post('/generate-prompt', async (c) => {
  try {
    if (!(await checkQuota(c))) return c.json({ error: "今日免费额度已用完 (3/3)，请明天再试或联系管理员" }, 429);
    
    const { poem } = await c.req.json();
    // 优先从 GEMINI_PRO_API_KEY 中获取一个 Key (支持多 Key 轮询)
    const apiKey = getApiKey(c.env.GEMINI_PRO_API_KEY) || c.env.GOOGLE_AI_STUDIO_API_KEY;
    if (!apiKey) return c.json({ error: "未配置 API Key (需要 GEMINI_PRO_API_KEY)" }, 500);

    const ai = new GoogleGenAI({ apiKey });
    
    const response = await ai.models.generateContent({
      model: "gemini-3.1-pro-preview",
      contents: [{ parts: [{ text: poem }] }],
      config: {
        systemInstruction: `你是一位集“中国古典诗词研究专家”、“美学视觉专家”与“奥斯卡金像奖导演”于一身的跨界大师。
你的任务是将用户提供的诗词，深度解析其意境、色彩、构图与情感，并转化为极其专业的电影分镜脚本。

输出必须为严格的 JSON 格式：{"chinese": "...", "english": "..."}
- chinese: 对诗句意境的优美中文描述，融合文学性与视觉美感。
- english: 专门为 Veo 视频生成模型设计的纯英文提示词。要求包含：镜头语言（如 Close-up, Slow-motion）、光影描述（如 Cinematic lighting, Golden hour）、艺术风格（如 Traditional Chinese ink wash style, Photorealistic）以及具体的画面细节。`,
        responseMimeType: "application/json",
      },
    });

    const text = response.text;
    if (!text) {
      console.error("Empty response from Gemini Pro");
      return c.json({ chinese: "解析失败：模型返回内容为空", english: "Analysis failed: empty response" });
    }

    const rawData = JSON.parse(text);
    // 鲁棒性处理：如果 AI 返回了复杂对象而非字符串，将其转化为字符串
    const processedData = {
      chinese: typeof rawData.chinese === 'object' ? JSON.stringify(rawData.chinese) : (rawData.chinese || ""),
      english: typeof rawData.english === 'object' ? JSON.stringify(rawData.english) : (rawData.english || "")
    };
    
    // 如果解析出来的字段还是空的，给个默认提示
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

// 6. 视频生成接口 (受配额限制)
app.post('/generate-video', async (c) => {
  try {
    if (!(await checkQuota(c))) return c.json({ error: "今日免费额度已用完" }, 429);
    
    const { prompt } = await c.req.json();
    const apiKey = c.env.GOOGLE_AI_STUDIO_API_KEY;
    if (!apiKey) return c.json({ error: "未配置高权限 API Key (GOOGLE_AI_STUDIO_API_KEY)" }, 500);

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

// 7. 视频状态轮询接口
app.post('/poll-video', async (c) => {
  try {
    const { operation } = await c.req.json();
    if (!operation) return c.json({ error: "缺少 operation 参数" }, 400);
    
    const apiKey = c.env.GOOGLE_AI_STUDIO_API_KEY;
    if (!apiKey) return c.json({ error: "未配置高权限 API Key (GOOGLE_AI_STUDIO_API_KEY)" }, 500);

    const ai = new GoogleGenAI({ apiKey });
    
    // 确保传入的是正确的参数格式
    // SDK getVideosOperation 期望的是 { operation: string | VideoGenerationOperation }
    // 传递字符串最为稳妥，避免 SDK 尝试在普通对象上调用内部方法
    const opName = typeof operation === 'object' ? (operation.name || operation) : operation;
    
    console.log("Polling operation name (string):", opName);
    
    const result = await ai.operations.getVideosOperation({ 
      operation: opName 
    });
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

// 8. 图像生成接口
app.post('/generate-image', async (c) => {
  if (!(await checkQuota(c))) return c.json({ error: "今日免费额度已用完" }, 429);
  
  const { prompt } = await c.req.json();
  const ai = new GoogleGenAI({ apiKey: c.env.GOOGLE_AI_STUDIO_API_KEY });
  
  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3.1-flash-image-preview',
      contents: [{ 
        parts: [{ text: `A cinematic masterpiece of Chinese traditional painting. ${prompt}. Ultra-high definition, 4k, photorealistic, intricate details, elegant composition.` }] 
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
    return c.json({ error: "模型未返回图像数据" }, 500);
  } catch (error: any) {
    console.error("Image Gen Error:", error);
    return c.json({ error: `图像生成失败: ${error.message || '未知错误'}`, details: error }, 500);
  }
});

// 9. 诗词吟诵接口 (TTS)
app.post('/generate-speech', async (c) => {
  try {
    if (!(await checkQuota(c))) return c.json({ error: "今日免费额度已用完" }, 429);
    
    const { text } = await c.req.json();
    // 必须使用高权限的 STUDIO KEY，免费层通常不支持 TTS
    const apiKey = c.env.GOOGLE_AI_STUDIO_API_KEY;
    if (!apiKey) return c.json({ error: "未配置高权限 API Key (需要 GOOGLE_AI_STUDIO_API_KEY 以支持 TTS)" }, 500);

    const ai = new GoogleGenAI({ apiKey });
    
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-preview-tts",
      contents: [{ parts: [{ text: `请吟诵：${text}` }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Fenrir' }
          }
        }
      }
    });

    console.log("TTS Response Candidates:", response.candidates?.length);
    const candidate = response.candidates?.[0];
    const part = candidate?.content?.parts?.find(p => p.inlineData);
    const base64Audio = part?.inlineData?.data;
    if (base64Audio) {
      return c.json({ base64Audio });
    }
    
    // 如果没有音频数据，看看是不是有报错信息
    const finishReason = response.candidates?.[0]?.finishReason;
    console.error("TTS No Audio. Finish Reason:", finishReason);
    
    return c.json({ error: `模型未返回音频数据 (原因: ${finishReason || '未知'})` }, 500);
  } catch (error: any) {
    console.error("TTS Error:", error);
    const errorDetail = error.response?.data || error.details || error.message || error;
    
    // 专门处理 404 错误 (模型不可用)
    if (error.message?.includes('404') || error.status === 404 || error.message?.toLowerCase().includes('not found')) {
      return c.json({ 
        error: "语音模型 (TTS) 暂不可用", 
        details: "您的 API Key 暂无 gemini-2.5-flash-preview-tts 模型的访问权限，或者该模型在当前区域不可用。请在 Google AI Studio 检查模型可用性。" 
      }, 404);
    }
    
    // 如果是权限错误
    if (error.message?.includes('permission') || error.message?.includes('API key') || error.status === 403) {
      return c.json({ error: "API Key 权限不足，无法使用 TTS 功能", details: errorDetail }, 403);
    }
    
    return c.json({ 
      error: `吟诵生成失败: ${error.message || '模型可能暂不可用'}`, 
      details: errorDetail 
    }, 500);
  }
});

// 10. 视频下载代理接口
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

  // 将视频流转发给客户端
  return new Response(response.body, {
    headers: {
      'Content-Type': response.headers.get('Content-Type') || 'video/mp4',
      'Content-Disposition': `attachment; filename="video_${Date.now()}.mp4"`,
    },
  });
});

// 11. 藏书阁接口 (使用 D1 数据库)
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

/**
 * Agnes AI 代理 Worker
 * 绕过 Cloudflare Pages Functions 的 SSL 525 问题
 * 只允许特定域名访问（白名单校验）
 */

const AGNES_AI_BASE = 'https://apihub.agnes-ai.com';

// 允许访问的域名白名单
const ALLOWED_ORIGINS = [
  'https://shihuahuanji.qjammo.de5.net',
  'http://shihuahuanji.qjammo.de5.net',
  'https://moranshixin.com',
  'https://www.moranshixin.com',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const lowerOrigin = origin.toLowerCase();
  return ALLOWED_ORIGINS.some(allowed => lowerOrigin === allowed.toLowerCase());
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    
    // 调试日志（可在 Cloudflare Dashboard -> Workers -> 查看日志 中看到）
    console.log('[Worker] Incoming request:', request.method, request.url, 'Origin:', origin);
    
    // CORS 预检请求处理
    if (request.method === 'OPTIONS') {
      if (!isAllowedOrigin(origin)) {
        console.log('[Worker] CORS preflight rejected. Origin:', origin);
        return new Response('CORS preflight: Origin not allowed', { 
          status: 403,
          headers: {
            'Content-Type': 'text/plain',
          },
        });
      }
      console.log('[Worker] CORS preflight allowed for origin:', origin);
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    // 非白名单域名拒绝（但允许无 Origin 的请求，如 curl 测试）
    if (origin && !isAllowedOrigin(origin)) {
      console.log('[Worker] Request rejected. Origin not in whitelist:', origin);
      return new Response(JSON.stringify({ 
        error: 'Forbidden: Invalid Origin', 
        yourOrigin: origin,
        allowedOrigins: ALLOWED_ORIGINS 
      }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*', // 允许浏览器读取错误信息
        },
      });
    }

    const url = new URL(request.url);
    const apiKey = env.AGNES_AI_API_KEY;

    try {
      // POST /v1/videos - 提交视频生成任务
      if (request.method === 'POST' && url.pathname === '/v1/videos') {
        const body = await request.json();
        console.log('[Worker] Video generation request:', body.prompt?.slice(0, 50));
        
        // 参数校验和补全
        const payload = {
          model: body.model || 'agnes-video-v2.0',
          prompt: body.prompt,
          height: body.height || 768,
          width: body.width || 1152,
          num_frames: body.num_frames || 121,
          frame_rate: body.frame_rate || 24,
        };

        const response = await fetch(`${AGNES_AI_BASE}/v1/videos`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();
        console.log('[Worker] Video submit response:', response.status, JSON.stringify(data).slice(0, 200));
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin || '*',
          },
        });
      }

      // GET /v1/videos/{taskId} - 轮询任务状态
      if (request.method === 'GET' && url.pathname.startsWith('/v1/videos/')) {
        const taskId = url.pathname.split('/v1/videos/')[1];
        if (!taskId) {
          return new Response('Bad Request: Missing taskId', { status: 400 });
        }

        console.log('[Worker] Video poll request:', taskId);
        const response = await fetch(`${AGNES_AI_BASE}/v1/videos/${taskId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        });

        const data = await response.json();
        console.log('[Worker] Video poll response:', response.status, JSON.stringify(data).slice(0, 200));
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin || '*',
          },
        });
      }

      // POST /v1/images/generations - 图片生成（可选，统一走代理）
      if (request.method === 'POST' && url.pathname === '/v1/images/generations') {
        const body = await request.json();
        console.log('[Worker] Image generation request:', body.prompt?.slice(0, 50));
        
        const payload = {
          model: body.model || 'agnes-ai-v1',
          prompt: body.prompt,
          n: body.n || 1,
          size: body.size || '1024x1024',
        };

        const response = await fetch(`${AGNES_AI_BASE}/v1/images/generations`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });

        const data = await response.json();
        console.log('[Worker] Image response:', response.status, JSON.stringify(data).slice(0, 200));
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin || '*',
          },
        });
      }

      console.log('[Worker] Not found:', request.method, url.pathname);
      return new Response('Not Found', { status: 404 });

    } catch (err) {
      console.error('[Worker] Error:', err.message, err.stack);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin || '*',
        },
      });
    }
  },
};

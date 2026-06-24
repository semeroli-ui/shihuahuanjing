/**
 * Agnes AI 代理 Worker
 * 绕过 Cloudflare Pages Functions 的 SSL 525 问题
 * 只允许特定域名访问（白名单校验）
 */

const AGNES_AI_BASE = 'https://apihub.agnes-ai.com';

// 允许访问的域名白名单
const ALLOWED_ORIGINS = [
  'https://shihuahuanji.qjammo.de5.net',
  'https://moranshixin.com',
  'https://www.moranshixin.com',
  'http://localhost:5173',
  'http://localhost:3000',
];

function isAllowedOrigin(origin) {
  if (!origin) return false;
  return ALLOWED_ORIGINS.some(allowed => origin.toLowerCase().startsWith(allowed.toLowerCase()));
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    
    // CORS 预检请求处理
    if (request.method === 'OPTIONS') {
      if (!isAllowedOrigin(origin)) {
        return new Response('Forbidden', { status: 403 });
      }
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

    // 非白名单域名拒绝
    if (!isAllowedOrigin(origin)) {
      return new Response('Forbidden: Invalid Origin', { status: 403 });
    }

    const url = new URL(request.url);
    const apiKey = env.AGNES_AI_API_KEY;

    try {
      // POST /v1/videos - 提交视频生成任务
      if (request.method === 'POST' && url.pathname === '/v1/videos') {
        const body = await request.json();
        
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
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin,
          },
        });
      }

      // GET /v1/videos/{taskId} - 轮询任务状态
      if (request.method === 'GET' && url.pathname.startsWith('/v1/videos/')) {
        const taskId = url.pathname.split('/v1/videos/')[1];
        if (!taskId) {
          return new Response('Bad Request: Missing taskId', { status: 400 });
        }

        const response = await fetch(`${AGNES_AI_BASE}/v1/videos/${taskId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        });

        const data = await response.json();
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin,
          },
        });
      }

      // POST /v1/images/generations - 图片生成（可选，统一走代理）
      if (request.method === 'POST' && url.pathname === '/v1/images/generations') {
        const body = await request.json();
        
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
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': origin,
          },
        });
      }

      return new Response('Not Found', { status: 404 });

    } catch (err) {
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

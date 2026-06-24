/**
 * Agnes AI 代理 Worker
 * 绕过 Cloudflare Pages Functions 的 SSL 525 问题
 */

const AGNES_AI_BASE = 'https://apihub.agnes-ai.com';

// 允许访问的域名白名单（支持通配符）
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
  
  // 精确匹配
  if (ALLOWED_ORIGINS.includes(lowerOrigin)) return true;
  
  // 允许所有 .qjammo.de5.net 子域名
  if (lowerOrigin.endsWith('.qjammo.de5.net')) return true;
  
  // 允许所有 moranshixin.com 子域名
  if (lowerOrigin.endsWith('.moranshixin.com')) return true;
  
  return false;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    
    console.log('[Worker] Request:', request.method, request.url);
    console.log('[Worker] Origin:', origin);
    console.log('[Worker] Is allowed:', isAllowedOrigin(origin));
    
    // 构建 CORS 响应头
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };
    
    // CORS 预检请求处理
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // 检查白名单
    if (origin && !isAllowedOrigin(origin)) {
      console.log('[Worker] Rejected origin:', origin);
      return new Response(JSON.stringify({ 
        error: 'Forbidden: Invalid Origin', 
        yourOrigin: origin,
        allowedOrigins: ALLOWED_ORIGINS 
      }), {
        status: 403,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }

    const url = new URL(request.url);
    const apiKey = env.AGNES_AI_API_KEY;

    try {
      // POST /v1/videos - 提交视频生成任务
      if (request.method === 'POST' && url.pathname === '/v1/videos') {
        const body = await request.json();
        console.log('[Worker] Video submit:', body.prompt?.slice(0, 50));
        
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
        console.log('[Worker] Video submit response:', response.status);
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }

      // GET /v1/videos/{taskId} - 轮询任务状态
      if (request.method === 'GET' && url.pathname.startsWith('/v1/videos/')) {
        const taskId = url.pathname.split('/v1/videos/')[1];
        if (!taskId) {
          return new Response(JSON.stringify({ error: 'Missing taskId' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        console.log('[Worker] Video poll:', taskId);
        const response = await fetch(`${AGNES_AI_BASE}/v1/videos/${taskId}`, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
          },
        });

        const data = await response.json();
        console.log('[Worker] Video poll response:', response.status);
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: {
            'Content-Type': 'application/json',
            ...corsHeaders,
          },
        });
      }

      return new Response(JSON.stringify({ error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });

    } catch (err) {
      console.error('[Worker] Error:', err.message);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};

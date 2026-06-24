/**
 * Agnes AI 代理 Worker
 * 绕过 SSL 525
 */

const AGNES_AI_BASE = 'https://apihub.agnes-ai.com';

function isAllowedOrigin(origin) {
  if (!origin) return false;
  const lowerOrigin = origin.toLowerCase();
  
  // 允许所有 .qjammo.de5.net 子域名（包括 shihuahj, shihuahuanji 等）
  if (lowerOrigin.endsWith('.qjammo.de5.net')) return true;
  // 允许所有 .qianmo.de5.net 子域名
  if (lowerOrigin.endsWith('.qianmo.de5.net')) return true;
  // 允许所有 moranshixin.com
  if (lowerOrigin.endsWith('.moranshixin.com')) return true;
  // 本地开发
  if (lowerOrigin.startsWith('http://localhost:')) return true;
  if (lowerOrigin.startsWith('http://127.0.0.1:')) return true;
  
  return false;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');
    console.log('[Worker] Request:', request.method, request.url, 'Origin:', origin);
    
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    };
    
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // 检查白名单
    if (origin && !isAllowedOrigin(origin)) {
      console.log('[Worker] Rejected origin:', origin);
      return new Response(JSON.stringify({ 
        error: 'Forbidden', 
        yourOrigin: origin,
        hint: '请确认域名在白名单中'
      }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const url = new URL(request.url);
    const apiKey = env.AGNES_AI_API_KEY;

    try {
      // POST /v1/videos - 提交视频生成任务
      if (request.method === 'POST' && url.pathname === '/v1/videos') {
        const body = await request.json();
        console.log('[Worker] Video submit, prompt length:', body.prompt?.length);
        
        const response = await fetch(`${AGNES_AI_BASE}/v1/videos`, {
          method: 'POST',
          headers: { 
            'Authorization': `Bearer ${apiKey}`, 
            'Content-Type': 'application/json' 
          },
          body: JSON.stringify({
            model: body.model || 'agnes-video-v2.0',
            prompt: body.prompt,
            height: body.height || 768,
            width: body.width || 1152,
            num_frames: body.num_frames || 121,
            frame_rate: body.frame_rate || 24,
          }),
        });

        const data = await response.json();
        console.log('[Worker] Video response:', response.status, JSON.stringify(data).slice(0, 200));
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
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
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });

        const data = await response.json();
        console.log('[Worker] Poll response:', response.status, JSON.stringify(data).slice(0, 200));
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
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

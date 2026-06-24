/**
 * Agnes AI 代理 Worker
 * 绕过 SSL 525
 * 
 * 修复历史：
 * 2026-06-24: 视频轮询改用专用 /agnesapi?video_id=... 端点，
 *             替代旧的 /v1/videos/{task_id} 端点，
 *             同时增加 remixed_from_video_id 字段提取
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

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'Missing AGNES_AI_API_KEY in Worker environment' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    try {
      // ============================================================
      // 1. POST /v1/videos - 提交视频生成任务
      // ============================================================
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
        console.log('[Worker] Video submit response:', response.status, JSON.stringify(data).slice(0, 300));
        
        // Agnes AI 返回 { id, video_id, status, ... }
        // 如果有 video_id，直接在响应中带上，方便前端轮询
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // ============================================================
      // 2. GET /v1/videos/{id} - 轮询任务状态（兼容旧版 task_id）
      // ============================================================
      if (request.method === 'GET' && url.pathname.startsWith('/v1/videos/')) {
        const id = url.pathname.split('/v1/videos/')[1];
        if (!id) {
          return new Response(JSON.stringify({ error: 'Missing task/video ID' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        // 优先使用 Agnes AI 专用轮询端点：GET /agnesapi?video_id=...
        // 这比旧的 /v1/videos/{task_id} 返回更完整的响应（含 video_url）
        const pollUrl = `${AGNES_AI_BASE}/agnesapi?video_id=${encodeURIComponent(id)}`;
        console.log('[Worker] Video poll via /agnesapi:', id);

        const response = await fetch(pollUrl, {
          method: 'GET',
          headers: { 
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });

        // 如果专用端点 404，fallback 到旧端点
        if (!response.ok) {
          console.warn('[Worker] /agnesapi poll failed, fallback to /v1/videos:', response.status);
          const fallbackUrl = `${AGNES_AI_BASE}/v1/videos/${encodeURIComponent(id)}`;
          const fallbackResponse = await fetch(fallbackUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` },
          });
          const fallbackData = await fallbackResponse.json();
          console.log('[Worker] Fallback poll response:', fallbackResponse.status, JSON.stringify(fallbackData).slice(0, 300));
          return new Response(JSON.stringify(fallbackData), {
            status: fallbackResponse.status,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const data = await response.json();
        console.log('[Worker] /agnesapi poll response:', response.status, JSON.stringify(data).slice(0, 500));
        
        // 提取视频 URL（多个可能字段）
        const videoUrl = data?.video_url || 
                         data?.url || 
                         data?.data?.[0]?.url || 
                         data?.data?.[0]?.video_url ||
                         data?.remixed_from_video_id ||  // Agnes 可能返回这个作为 URL
                         null;
        
        // 如果找到 URL，加入响应中（有些响应把 URL 藏在嵌套结构里）
        if (videoUrl && !data.video_url) {
          data.video_url = videoUrl;
        }

        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // ============================================================
      // 3. GET /download?url=... - 视频/文件下载代理（绕过 storage.googleapis.com 封锁）
      // ============================================================
      if (request.method === 'GET' && url.pathname === '/download') {
        const fileUrl = url.searchParams.get('url');
        if (!fileUrl) {
          return new Response(JSON.stringify({ error: 'Missing url parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        console.log('[Worker] Proxying download:', fileUrl.slice(0, 100));

        try {
          const downloadResponse = await fetch(fileUrl, {
            method: 'GET',
            headers: {
              'Accept': 'video/mp4,video/*,*/*',
              'User-Agent': '诗画幻境/1.0 Video Downloader',
            },
          });

          if (!downloadResponse.ok) {
            console.error('[Worker] Download failed:', downloadResponse.status);
            return new Response(JSON.stringify({ 
              error: 'Download failed', 
              status: downloadResponse.status,
              url: fileUrl 
            }), {
              status: 502,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }

          // 流式转发，保持 Content-Type 和 Content-Length
          const contentType = downloadResponse.headers.get('Content-Type') || 'video/mp4';
          const contentLength = downloadResponse.headers.get('Content-Length');
          
          const responseHeaders = {
            'Content-Type': contentType,
            'Access-Control-Allow-Origin': origin || '*',
            'Content-Disposition': 'attachment; filename="video.mp4"',
            'Cache-Control': 'no-store',
          };
          if (contentLength) responseHeaders['Content-Length'] = contentLength;

          console.log('[Worker] Download OK, size:', contentLength || 'streaming');
          return new Response(downloadResponse.body, {
            status: downloadResponse.status,
            headers: responseHeaders,
          });
        } catch (err) {
          console.error('[Worker] Download error:', err.message);
          return new Response(JSON.stringify({ error: err.message, url: fileUrl }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
      }

      // ============================================================
      // 4. GET /agnesapi?video_id=... - 专用轮询端点（直接访问）
      // ============================================================
      if (request.method === 'GET' && url.pathname === '/agnesapi') {
        const videoId = url.searchParams.get('video_id');
        if (!videoId) {
          return new Response(JSON.stringify({ error: 'Missing video_id parameter' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const pollUrl = `${AGNES_AI_BASE}/agnesapi?video_id=${encodeURIComponent(videoId)}`;
        console.log('[Worker] Direct /agnesapi poll:', videoId);

        const response = await fetch(pollUrl, {
          method: 'GET',
          headers: { 
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
        });

        const data = await response.json();
        console.log('[Worker] /agnesapi response:', response.status, JSON.stringify(data).slice(0, 500));
        return new Response(JSON.stringify(data), {
          status: response.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      return new Response(JSON.stringify({ error: 'Not Found', hint: 'Supported: POST /v1/videos, GET /v1/videos/{id}, GET /agnesapi?video_id=..., GET /download?url=...' }), {
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

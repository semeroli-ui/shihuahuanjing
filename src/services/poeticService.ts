export interface PoeticPrompt {
  chinese: string;
  english: string;
}

export class PoeticService {
  // Worker 代理地址（仅用于视频生成，绕过 SSL 525）
  private readonly WORKER_PROXY_URL = 'https://agnes-ai-proxy.qianmo268.workers.dev';

  // 1. 将诗词转化为提示词 (调用后端代理 - 需要配额检查)
  async generatePrompt(poem: string): Promise<PoeticPrompt> {
    const res = await fetch('/api/generate-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poem })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({})) as any;
      throw new Error(errorData.error || errorData.message || "后端解析失败");
    }
    return await res.json();
  }

  // 2. 调用视频生成 (走 Worker 代理，绕过 SSL 525)
  async generateVideo(prompt: string) {
    const res = await fetch(`${this.WORKER_PROXY_URL}/v1/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({})) as any;
      throw new Error(errorData.error || "视频生成请求失败");
    }
    return await res.json();
  }

  // 3. 轮询视频状态 (走 Worker 代理)
  async pollVideoStatus(taskId: string) {
    const res = await fetch(`${this.WORKER_PROXY_URL}/v1/videos/${taskId}`);
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({})) as any;
      throw new Error(errorData.error || "状态查询失败");
    }
    return await res.json();
  }

  // 4. 藏书阁接口 (D1 数据库)
  async getLibrary() {
    const res = await fetch('/api/library');
    if (!res.ok) throw new Error("获取藏书阁失败");
    return await res.json();
  }

  async saveToLibrary(poem: string) {
    const res = await fetch('/api/library', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poem })
    });
    if (!res.ok) throw new Error("保存到藏书阁失败");
    return await res.json();
  }

  async removeFromLibrary(id: string) {
    const res = await fetch(`/api/library/${id}`, {
      method: 'DELETE'
    });
    if (!res.ok) throw new Error("从藏书阁移除失败");
    return await res.json();
  }

  // 5. 调用图像生成模型 (走后端代理，有 fallback 逻辑)
  async generateImage(prompt: string) {
    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) throw new Error("图像生成失败");
    return await res.json();
  }

  // 6. 诗词吟诵 (Worker TTS → 浏览器兜底)
  // 优先走 Worker（Agnes AI TTS 或 Edge TTS），无需担心 SSL 问题
  async generateSpeech(text: string): Promise<{ type: 'url' | 'browser'; url?: string; text?: string }> {
    try {
      const res = await fetch(`${this.WORKER_PROXY_URL}/tts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, voice: 'zh-CN-XiaoxiaoNeural' }),
      });

      const data = await res.json().catch(() => ({})) as any;
      
      if (res.ok && data.base64Audio) {
        // 尝试 WAV 编码（部分来源是 MP3）
        const source = data.source || 'unknown';
        if (source === 'edge') {
          // Edge TTS 返回 MP3，需要正确解码
          const binary = atob(data.base64Audio);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
          const blob = new Blob([bytes], { type: 'audio/mpeg' });
          return { type: 'url', url: URL.createObjectURL(blob) };
        } else {
          // Agnes AI / 默认：WAV 格式
          const pcmData = Uint8Array.from(atob(data.base64Audio), c => c.charCodeAt(0));
          const wavData = this.encodeWAV(pcmData, 24000);
          const blob = new Blob([wavData], { type: 'audio/wav' });
          return { type: 'url', url: URL.createObjectURL(blob) };
        }
      }

      throw new Error(data.error || `TTS 请求失败: HTTP ${res.status}`);
    } catch (err: any) {
      // Worker TTS 失败 → 浏览器语音兜底（可播放但无法下载）
      if ('speechSynthesis' in window) {
        return { type: 'browser', text };
      }
      throw new Error(`吟诵生成失败: ${err.message}`);
    }
  }

  // 7. 管理员登录
  async adminLogin(credentials: any) {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(credentials)
    });
    return await res.json();
  }

  // 8. 修改密码
  async changePassword(newPassword: string) {
    const res = await fetch('/api/admin/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword })
    });
    return await res.json();
  }

  // 9. 退出登录
  async adminLogout() {
    const res = await fetch('/api/admin/logout', { method: 'POST' });
    return await res.json();
  }

  // 辅助方法：将 PCM 数据包装成 WAV 格式
  private encodeWAV(pcmData: Uint8Array, sampleRate: number) {
    const buffer = new ArrayBuffer(44 + pcmData.length);
    const view = new DataView(buffer);

    // RIFF identifier
    this.writeString(view, 0, 'RIFF');
    // file length
    view.setUint32(4, 36 + pcmData.length, true);
    // RIFF type
    this.writeString(view, 8, 'WAVE');
    // format chunk identifier
    this.writeString(view, 12, 'fmt ');
    // format chunk length
    view.setUint32(16, 16, true);
    // sample format (raw)
    view.setUint16(20, 1, true);
    // channel count
    view.setUint16(22, 1, true);
    // sample rate
    view.setUint32(24, sampleRate, true);
    // byte rate (sample rate * block align)
    view.setUint32(28, sampleRate * 2, true);
    // block align (channel count * bytes per sample)
    view.setUint16(32, 2, true);
    // bits per sample
    view.setUint16(34, 16, true);
    // data chunk identifier
    this.writeString(view, 36, 'data');
    // data chunk length
    view.setUint32(40, pcmData.length, true);

    // write the PCM samples
    for (let i = 0; i < pcmData.length; i++) {
      view.setUint8(44 + i, pcmData[i]);
    }

    return buffer;
  }

  private writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }
}

export const poeticService = new PoeticService();

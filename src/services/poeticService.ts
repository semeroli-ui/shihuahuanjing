export interface PoeticPrompt {
  chinese: string;
  english: string;
}

export class PoeticService {
  // 1. 将诗词转化为提示词 (调用后端代理)
  async generatePrompt(poem: string): Promise<PoeticPrompt> {
    const res = await fetch('/api/generate-prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ poem })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || "后端解析失败");
    }
    return await res.json();
  }

  // 2. 调用 Veo 生成视频 (调用后端代理)
  async generateVideo(prompt: string) {
    const res = await fetch('/api/generate-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || "后端生成请求失败");
    }
    return await res.json();
  }

  // 3. 轮询视频状态 (调用后端代理)
  async pollVideoStatus(operation: any) {
    const res = await fetch('/api/poll-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation })
    });
    if (!res.ok) throw new Error("状态查询失败");
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

  // 5. 调用图像生成模型 (调用后端代理)
  async generateImage(prompt: string) {
    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    if (!res.ok) throw new Error("图像生成失败");
    return await res.json();
  }

  // 6. 诗词吟诵 (TTS, 调用后端代理)
  async generateSpeech(text: string) {
    const res = await fetch('/api/generate-speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || data.details || "吟诵生成失败");
    }
    
    const { base64Audio, error } = data as { base64Audio?: string; error?: string };
    if (error) throw new Error(error);

    if (base64Audio) {
      const pcmData = Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0));
      const wavData = this.encodeWAV(pcmData, 24000);
      const blob = new Blob([wavData], { type: 'audio/wav' });
      return URL.createObjectURL(blob);
    }
    throw new Error("未生成音频数据");
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

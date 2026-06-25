/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 * 诗画幻境 - 新中式UI改造版
 * 参考图设计风格重构
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Send, 
  Sparkles, 
  Video, 
  Loader2, 
  Play, 
  History, 
  Key,
  ChevronRight,
  Download,
  FileText,
  Book,
  Bookmark,
  Trash2,
  RefreshCw,
  Image as ImageIcon,
  Feather
} from 'lucide-react';
import { poeticService } from './services/poeticService';

// aistudio 兼容声明（已废弃）
declare global {
  interface Window {
    aistudio?: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

// 意境风格标签选项
const STYLE_TAGS = [
  '水墨丹青', '工笔重彩', '禅意摄影', '现代抽象', 
  '敦煌壁画', '高清写实', '青绿山水', '文人雅趣'
];

export default function App() {
  const [poem, setPoem] = useState('');
  const [poemTitle, setPoemTitle] = useState('');
  const [poemAuthor, setPoemAuthor] = useState('');
  const [selectedTag, setSelectedTag] = useState<string>('水墨丹青');
  const [visualPrompt, setVisualPrompt] = useState<{chinese: string, english: string} | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [browserAudioText, setBrowserAudioText] = useState<string | null>(null);
  const [imageStatus, setImageStatus] = useState('');
  const [videoStatus, setVideoStatus] = useState('');
  const [videoProgress, setVideoProgress] = useState(0);
  const [audioStatus, setAudioStatus] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [library, setLibrary] = useState<{id: string, poem: string, date: string}[]>([]);
  const [showLibrary, setShowLibrary] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);

  const checkHealth = async () => {
    setIsCheckingHealth(true);
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setHealthStatus(data);
    } catch (e) {
      console.error("Health check failed", e);
    } finally {
      setIsCheckingHealth(false);
    }
  };

  useEffect(() => {
    const checkKeyStatus = async () => {
      try {
        const res = await fetch('/api/health');
        const data = await res.json() as { hasAgnesAIKey: boolean; hasModelScopeKey: boolean; isAdmin: boolean };
        setHasKey(data.hasAgnesAIKey || data.hasModelScopeKey);
        setIsAdmin(data.isAdmin);
      } catch (e) {
        setHasKey(false);
      }
    };

    const loadLibrary = async () => {
      try {
        const data = await poeticService.getLibrary() as any[];
        setLibrary(data.map((item: any) => ({
          id: item.id,
          poem: item.poem,
          date: new Date(item.created_at).toLocaleDateString()
        })));
      } catch (e) {
        console.error("Failed to load library", e);
      }
    };

    checkKeyStatus();
    loadLibrary();
  }, []);

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const handleOpenKeyDialog = async () => {
    setStatusMessage('请在 Cloudflare Pages 控制台配置 AGNES_AI_API_KEY 环境变量');
  };

  const handleLogin = async () => {
    try {
      const result = await poeticService.adminLogin({ email: loginEmail, password: loginPassword }) as { success: boolean; error?: string };
      if (result.success) {
        setIsAdmin(true);
        setShowLoginModal(false);
        setStatusMessage('管理员登录成功');
      } else {
        setStatusMessage(result.error || '登录失败');
      }
    } catch (e) {
      setStatusMessage('登录请求出错');
    }
  };

  const handleLogout = async () => {
    await poeticService.adminLogout();
    setIsAdmin(false);
    setShowAdminPanel(false);
    setStatusMessage('已退出登录');
  };

  const handleChangePassword = async () => {
    if (!newPassword) return;
    try {
      const result = await poeticService.changePassword(newPassword) as { success: boolean };
      if (result.success) {
        setStatusMessage('密码修改成功');
        setNewPassword('');
      }
    } catch (e) {
      setStatusMessage('密码修改失败');
    }
  };

  const handleAnalyze = async () => {
    const fullPoem = poemTitle ? `${poemTitle}\n${poem}` : poem;
    if (!fullPoem.trim()) return;
    setIsAnalyzing(true);
    setVisualPrompt(null);
    setGeneratedImage(null);
    setVideoUrl(null);
    setAudioUrl(null);
    setImageStatus('');
    setVideoStatus('');
    setAudioStatus('');
    setStatusMessage('正在解析诗词意境...');
    try {
      const promptObj = await poeticService.generatePrompt(fullPoem);
      if (!promptObj.chinese && !promptObj.english) {
        throw new Error("模型未能生成有效的解析内容，请尝试更换诗句或重试。");
      }
      setVisualPrompt(promptObj);
      setStatusMessage('解析成功！');
      
      setAudioStatus('正在生成诗词吟诵...');
      try {
        if (audioUrl && audioUrl.startsWith('blob:')) {
          URL.revokeObjectURL(audioUrl);
        }
        setAudioUrl(null);
        setBrowserAudioText(null);

        const result = await poeticService.generateSpeech(fullPoem);
        if (result.type === 'url' && result.url) {
          setAudioUrl(result.url);
          setAudioStatus('吟诵生成成功');
        } else if (result.type === 'browser' && result.text) {
          setBrowserAudioText(result.text);
          setAudioStatus('浏览器语音就绪（无法下载）');
        }
      } catch (e: any) {
        setAudioStatus(`吟诵生成失败: ${e.message}`);
      }
    } catch (error: any) {
      console.error('Analysis error:', error);
      setStatusMessage(`解析失败: ${error.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerateImage = async () => {
    if (!visualPrompt || !hasKey) return;
    setIsGeneratingImage(true);
    setGeneratedImage(null);
    setImageStatus('正在绘制 4K 诗意原画...');
    try {
      const response = await poeticService.generateImage(visualPrompt.english) as any;
      console.log('[Image] Response:', JSON.stringify(response).slice(0, 300));
      
      let imageUrl = '';
      
      const data1 = response.data?.[0];
      if (data1?.url) imageUrl = data1.url;
      else if (data1?.b64_json) imageUrl = `data:image/png;base64,${data1.b64_json}`;
      
      if (!imageUrl) {
        const data2 = response.generatedImages?.[0];
        if (data2?.image?.url) imageUrl = data2.image.url;
        else if (data2?.url) imageUrl = data2.url;
        else if (data2?.image?.b64_json) imageUrl = `data:image/png;base64,${data2.image.b64_json}`;
      }
      
      if (!imageUrl) {
        if (response.url) imageUrl = response.url;
        else if (response.b64_json) imageUrl = `data:image/png;base64,${response.b64_json}`;
      }
      
      if (imageUrl) {
        setGeneratedImage(imageUrl);
        setImageStatus('原画绘制成功！');
      } else {
        setImageStatus(`原画绘制失败: 未识别的响应格式`);
      }
    } catch (error: any) {
      console.error('Image generation error:', error);
      setImageStatus(`原画绘制失败: ${error.message}`);
    } finally {
      setIsGeneratingImage(false);
    }
  };

  const handleGenerateVideo = async () => {
    if (!visualPrompt || !hasKey || cooldown > 0) return;
    setIsGeneratingVideo(true);
    setVideoUrl(null);
    setVideoStatus('正在唤醒 AI 视频模型，生成意境画卷...');
    setVideoProgress(0);
    
    try {
      console.log('Starting video generation with prompt:', visualPrompt.english);
      let operation = await poeticService.generateVideo(visualPrompt.english) as any;
      console.log('Video generation operation started:', operation);

      if (operation.done && operation.response) {
        const downloadLink = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (downloadLink) {
          setVideoStatus('视频已生成，正在通过安全代理下载...');
          const dlRes = await fetch(`/api/download-video?url=${encodeURIComponent(downloadLink)}`);
          if (!dlRes.ok) throw new Error(`视频下载失败: ${dlRes.status}`);
          const blob = await dlRes.blob();
          setVideoUrl(URL.createObjectURL(blob));
          setVideoStatus('生成成功！');
        }
        setIsGeneratingVideo(false);
        return;
      }

      const taskId = operation.taskId || operation.task_id || operation.id;
      if (!taskId) {
        throw new Error('视频任务提交失败：未返回任务 ID');
      }
      setVideoStatus(`视频任务已提交 (ID: ${taskId.slice(0,12)}...)，等待 AI 绘制...`);
      
      let pollCount = 0;
      const MAX_POLL_COUNT = 30;

      const poll = async () => {
        pollCount++;
        if (pollCount > MAX_POLL_COUNT) {
          setVideoStatus('视频生成超时，请刷新重试');
          setIsGeneratingVideo(false);
          return;
        }

        try {
          const result = await poeticService.pollVideoStatus(taskId) as any;
          console.log(`[Poll #${pollCount}]`, JSON.stringify(result).slice(0, 300));
          
          const status = result.status || result.state || (result.done ? 'completed' : 'in_progress');
          const progress = result.progress || (result as any).metadata?.progressPercent || 0;
          const vUrl = (result as any).video_url ||
                           (result as any).remixed_from_video_id ||
                           result.response?.generatedVideos?.[0]?.video?.uri ||
                           result.response?.generatedVideos?.[0]?.uri ||
                           result.response?.uri ||
                           result.url || null;

          if (status === 'completed' || status === 'succeeded') {
            if (vUrl) {
              console.log('找到视频下载链接:', vUrl.slice(0, 100));
              setVideoStatus('视频已生成，正在通过代理下载...');
              
              try {
                const workerDownloadUrl = `${poeticService.WORKER_PROXY_URL}/download?url=${encodeURIComponent(vUrl)}`;
                const dlRes = await fetch(workerDownloadUrl);
                
                if (!dlRes.ok) {
                  throw new Error(`代理下载失败: HTTP ${dlRes.status}`);
                }
                
                const contentType = dlRes.headers.get('Content-Type') || 'video/mp4';
                const blob = await dlRes.blob();
                console.log('Video downloaded via Worker, blob size:', blob.size, 'type:', contentType);
                setVideoUrl(URL.createObjectURL(blob));
                setVideoStatus('生成成功！');
              } catch (dlErr: any) {
                console.error('Worker proxy download failed:', dlErr);
                setVideoUrl(vUrl);
                setVideoStatus('视频已生成（点击链接下载）');
              }
            } else {
              const AgnesError = result.error?.message || (result as any).response?.error;
              if (AgnesError) {
                throw new Error(`视频生成失败: ${AgnesError}`);
              }
              console.warn('视频状态完成但无 URL，继续轮询:', result);
              setVideoStatus(`视频生成完成，链接准备中 (${pollCount}/${MAX_POLL_COUNT})...`);
              setTimeout(poll, 15000);
              return;
            }
            setIsGeneratingVideo(false);
          } else if (status === 'failed' || status === 'error') {
            throw new Error(`视频生成失败: ${result.error?.message || result.message || '未知错误'}`);
          } else {
            setVideoProgress(progress);
            setVideoStatus(progress > 0 
              ? `视频绘制中: ${progress}% (${pollCount}/${MAX_POLL_COUNT})` 
              : `视频绘制中，请稍候... (${pollCount}/${MAX_POLL_COUNT})`);
            setTimeout(poll, 15000);
          }
        } catch (e: any) {
          console.error('Poll attempt failed:', e);
          const errorMsg = e.message || '未知错误';
          if (errorMsg.includes('429') || errorMsg.includes('频率')) {
            setVideoStatus('查询频率过高，正在自动重试...');
            setTimeout(poll, 30000); 
          } else {
            setVideoStatus(`视频生成出错: ${errorMsg}`);
            setIsGeneratingVideo(false);
          }
        }
      };
      
      poll();
    } catch (error: any) {
      setIsGeneratingVideo(false);
      if (error.message?.includes('频率过高') || error.message?.includes('429')) {
        setVideoStatus('触发 API 频率限制，请等待倒计时结束后重试。');
        setCooldown(60);
      } else if (error.message?.includes('525')) {
        setVideoStatus('视频服务暂时不可用 (SSL 525)，请联系技术支持。');
      } else {
        setVideoStatus(`生成失败: ${error.message || '未知错误'}`);
      }
    }
  };

  const downloadPrompts = () => {
    if (!visualPrompt) return;
    const fullPoem = poemTitle ? `${poemTitle}\n${poem}` : poem;
    const content = `诗词原文：\n${fullPoem}\n\n中文意境描述：\n${visualPrompt.chinese}\n\nEnglish Visual Prompt：\n${visualPrompt.english}`;
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `诗画幻境_提示词_${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const downloadImage = () => {
    if (!generatedImage) return;
    const a = document.createElement('a');
    a.href = generatedImage;
    a.download = `诗画幻境_原画_${new Date().getTime()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadVideo = () => {
    if (!videoUrl) return;
    const a = document.createElement('a');
    a.href = videoUrl;
    a.download = `诗画幻境_视频_${new Date().getTime()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const saveToLibrary = async () => {
    const fullPoem = poemTitle ? `${poemTitle}\n${poem}` : poem;
    if (!fullPoem.trim()) return;
    try {
      const result = await poeticService.saveToLibrary(fullPoem.trim()) as any;
      if (result.success) {
        const newItem = {
          id: result.id,
          poem: fullPoem.trim(),
          date: new Date().toLocaleDateString()
        };
        setLibrary([newItem, ...library]);
        setStatusMessage('已收入藏书阁');
      }
    } catch (e) {
      console.error("Failed to save to library", e);
      setStatusMessage('保存失败');
    }
  };

  const removeFromLibrary = async (id: string) => {
    try {
      const result = await poeticService.removeFromLibrary(id) as any;
      if (result.success) {
        setLibrary(library.filter(item => item.id !== id));
      }
    } catch (e) {
      console.error("Failed to remove from library", e);
    }
  };

  const loadFromLibrary = (item: {poem: string}) => {
    setPoem(item.poem);
    setShowLibrary(false);
  };

  // =====================
  // 新中式UI主布局
  // =====================
  return (
    <div className="neozhong-layout paper-texture">
      {/* ==================== 左侧面板 ==================== */}
      <aside className="neozhong-left-panel">
        {/* Logo区 - 参考图印章风格 */}
        <div className="neozhong-logo">
          <div className="seal-icon">
            <span style={{ fontSize: '11px' }}>墨</span>
          </div>
          <div>
            <h1 className="serif-text text-base font-semibold text-ink-dark tracking-wider">研墨书写</h1>
            <p className="text-[9px] text-ink-dark/30 tracking-widest mt-0.5">POETIC VISION AI</p>
          </div>
        </div>

        {/* 诗词输入区 */}
        <div className="neozhong-input-section">
          <input
            type="text"
            value={poemTitle}
            onChange={(e) => setPoemTitle(e.target.value)}
            placeholder="输入诗词题目，如：卜算子·我住长江头"
            className="poem-title-input"
          />
          <div className="flex gap-3 mt-3">
            <input
              type="text"
              value={poemAuthor}
              onChange={(e) => setPoemAuthor(e.target.value)}
              placeholder="朝代"
              className="flex-1 text-xs text-ink-dark/40 border-b border-ink-dark/10 pb-1 bg-transparent focus:outline-none focus:border-ink-dark/30 transition-colors serif-text"
            />
          </div>
        </div>

        {/* 诗词内容展示区 */}
        <div className="neozhong-poem-display">
          {poemAuthor && (
            <div className="poem-meta">
              {poemAuthor}
            </div>
          )}
          <textarea
            value={poem}
            onChange={(e) => setPoem(e.target.value)}
            placeholder="在此输入或粘贴诗词正文..."
            className="poem-text w-full h-full min-h-[180px] resize-none bg-transparent border-none outline-none"
          />
        </div>

        {/* 意境风格标签区 - 参考图胶囊标签 */}
        <div className="style-tags-section">
          <div className="style-tags-title">意境风格</div>
          <div className="style-tags-container">
            {STYLE_TAGS.map((tag) => (
              <button
                key={tag}
                onClick={() => setSelectedTag(tag)}
                className={`style-tag ${selectedTag === tag ? 'active' : ''}`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>

        {/* 底部操作区 */}
        <div className="neozhong-actions">
          <button
            onClick={handleAnalyze}
            disabled={isAnalyzing || !poem.trim()}
            className="neozhong-cta-btn mb-3"
          >
            {isAnalyzing ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>意境解析中...</span>
              </>
            ) : (
              <>
                <Feather size={16} />
                <span>尽览风华</span>
              </>
            )}
          </button>

          {/* 次要操作按钮 */}
          <div className="flex gap-2">
            <button
              onClick={handleGenerateImage}
              disabled={!visualPrompt || isGeneratingImage || !hasKey}
              className="flex-1 py-3 px-4 border border-ink-dark/10 rounded-lg text-xs serif-text text-ink-dark/60 hover:bg-ink-dark hover:text-paper-warm transition-all disabled:opacity-30 flex items-center justify-center gap-2"
            >
              {isGeneratingImage ? <Loader2 size={12} className="animate-spin" /> : <ImageIcon size={12} />}
              <span>生成原画</span>
            </button>
            <button
              onClick={handleGenerateVideo}
              disabled={!visualPrompt || isGeneratingVideo || cooldown > 0 || !hasKey}
              className="flex-1 py-3 px-4 bg-zen-vermilion text-white rounded-lg text-xs serif-text hover:bg-zen-vermilion/90 transition-all disabled:opacity-30 flex items-center justify-center gap-2"
            >
              {isGeneratingVideo ? <Loader2 size={12} className="animate-spin" /> : cooldown > 0 ? <History size={12} /> : <Video size={12} />}
              <span>{isGeneratingVideo ? '绘制中...' : cooldown > 0 ? `${cooldown}s` : '生成视频'}</span>
            </button>
          </div>

          {/* 辅助操作 */}
          <div className="flex justify-center gap-6 mt-4 pt-4 border-t border-ink-dark/5">
            <button onClick={saveToLibrary} className="text-[10px] text-ink-dark/30 hover:text-zen-vermilion transition-colors flex items-center gap-1.5">
              <Bookmark size={10} />
              <span>收入藏书阁</span>
            </button>
            <button onClick={downloadPrompts} className="text-[10px] text-ink-dark/30 hover:text-zen-vermilion transition-colors flex items-center gap-1.5">
              <Download size={10} />
              <span>导出提示词</span>
            </button>
            <button onClick={() => setShowLibrary(true)} className="text-[10px] text-ink-dark/30 hover:text-zen-vermilion transition-colors flex items-center gap-1.5">
              <Book size={10} />
              <span>藏书阁</span>
            </button>
          </div>

          {/* API Key提示 */}
          {!hasKey && (
            <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <p className="text-[10px] text-amber-700">⚠️ 未检测到 API Key，请配置环境变量</p>
            </div>
          )}

          {/* 状态消息 */}
          {statusMessage && (
            <p className="mt-3 text-center text-[10px] text-ink-dark/40 serif-text">{statusMessage}</p>
          )}
        </div>
      </aside>

      {/* ==================== 右侧展示区 ==================== */}
      <main className="neozhong-right-panel">
        {/* 主图展示区 - 参考图大圆角 */}
        <div className="image-showcase group">
          <div className="image-showcase-inner">
            <AnimatePresence mode="wait">
              {generatedImage ? (
                <motion.div
                  key="image"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.5 }}
                  className="w-full h-full"
                >
                  <img 
                    src={generatedImage} 
                    alt="诗意原画" 
                    className="showcase-image"
                    referrerPolicy="no-referrer"
                  />
                </motion.div>
              ) : isGeneratingImage ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="showcase-loading"
                >
                  <div className="loading-spinner"></div>
                  <p className="showcase-loading-text">正在落笔成画...</p>
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="showcase-empty"
                >
                  <div className="showcase-empty-icon">
                    <ImageIcon size={36} strokeWidth={1} />
                  </div>
                  <h3 className="showcase-empty-title">虚位以待，静候佳作</h3>
                  <p className="showcase-empty-desc">
                    解析诗词意境后，点击「生成原画」即可见证文字化为视觉的瞬间
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* 下载按钮 */}
          {generatedImage && (
            <button onClick={downloadImage} className="showcase-download-btn">
              <Download size={20} />
            </button>
          )}
        </div>

        {/* 状态提示 */}
        {imageStatus && !isGeneratingImage && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="showcase-status"
          >
            <div className="showcase-status-dot"></div>
            <span className="showcase-status-text">{imageStatus}</span>
          </motion.div>
        )}

        {/* 意境描述区 */}
        <AnimatePresence>
          {visualPrompt && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="visual-prompt-section"
            >
              <div className="visual-prompt-label">✦ 意境解读</div>
              <p className="visual-prompt-content">
                {visualPrompt.chinese}
              </p>
              <div className="mt-4 pt-4 border-t border-ink-dark/5">
                <div className="visual-prompt-label mb-2">Visual Prompt</div>
                <p className="text-xs text-ink-dark/40 font-mono leading-relaxed">
                  {visualPrompt.english}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* 视频画卷区 - 参考图卷轴风格 */}
        <AnimatePresence>
          {(isGeneratingVideo || videoUrl) && (
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="video-scroll-section"
            >
              <div className="video-scroll-title">
                <div className="video-scroll-line"></div>
                <span className="video-scroll-label">视频画卷 · 幻境展开</span>
              </div>
              
              <div className="video-scroll-container">
                {videoUrl ? (
                  <video 
                    src={videoUrl} 
                    controls 
                    autoPlay 
                    loop 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="showcase-loading">
                    <div className="loading-spinner"></div>
                    <p className="showcase-loading-text">
                      {videoStatus || '正在唤醒 AI 绘制画卷...'}
                    </p>
                    {videoProgress > 0 && (
                      <div className="w-48 h-1 bg-ink-dark/5 rounded-full mt-4 overflow-hidden">
                        <div 
                          className="h-full bg-zen-vermilion transition-all duration-500"
                          style={{ width: `${videoProgress}%` }}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              {videoUrl && (
                <div className="flex justify-center mt-4">
                  <button 
                    onClick={downloadVideo}
                    className="px-6 py-2 bg-white rounded-full border border-ink-dark/10 text-xs text-ink-dark/60 hover:bg-ink-dark hover:text-white transition-all flex items-center gap-2"
                  >
                    <Download size={12} />
                    <span>下载视频</span>
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 右下角水印 */}
        <div className="neozhong-watermark">
          诗画幻境 · Poetic Vision AI
        </div>
      </main>

      {/* ==================== 藏书阁抽屉 ==================== */}
      <AnimatePresence>
        {showLibrary && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLibrary(false)}
              className="fixed inset-0 bg-ink-dark/20 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-paper-warm paper-texture shadow-2xl z-[70] p-12 overflow-hidden flex flex-col"
            >
              <div className="flex justify-between items-center mb-12">
                <h2 className="text-2xl font-serif tracking-widest">藏书阁</h2>
                <button onClick={() => setShowLibrary(false)} className="text-ink-dark/40 hover:text-ink-dark">收起</button>
              </div>
              
              <div className="flex-1 overflow-y-auto library-scroll space-y-6 pr-4">
                {library.length === 0 ? (
                  <div className="text-center py-16">
                    <p className="text-ink-dark/20 serif-text">藏书阁尚无藏书</p>
                  </div>
                ) : (
                  library.map((item) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="p-4 bg-white rounded-lg border border-ink-dark/5 hover:border-zen-vermilion/20 transition-colors cursor-pointer"
                      onClick={() => loadFromLibrary(item)}
                    >
                      <p className="text-sm text-ink-dark/70 serif-text line-clamp-3 mb-2">{item.poem}</p>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-ink-dark/30">{item.date}</span>
                        <button 
                          onClick={(e) => { e.stopPropagation(); removeFromLibrary(item.id); }}
                          className="text-ink-dark/20 hover:text-zen-vermilion transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ==================== 登录弹窗 ==================== */}
      <AnimatePresence>
        {showLoginModal && (
          <div className="fixed inset-0 flex items-center justify-center z-[100] px-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLoginModal(false)}
              className="absolute inset-0 bg-ink-dark/40 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-md bg-paper-warm p-10 rounded-3xl shadow-2xl border border-ink-dark/10"
            >
              <h3 className="text-xl font-serif mb-6 tracking-widest text-center">管理员登录</h3>
              <div className="space-y-4">
                <input 
                  type="email"
                  placeholder="管理员邮箱"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-white/50 border border-ink-dark/10 rounded-xl focus:ring-2 focus:ring-zen-vermilion/20 outline-none text-sm"
                />
                <input 
                  type="password"
                  placeholder="登录密码"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-white/50 border border-ink-dark/10 rounded-xl focus:ring-2 focus:ring-zen-vermilion/20 outline-none text-sm"
                />
                <button 
                  onClick={handleLogin}
                  className="w-full py-4 bg-ink-dark text-white rounded-xl hover:bg-zen-vermilion transition-all font-serif tracking-widest"
                >
                  立即登录
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ==================== 管理后台抽屉 ==================== */}
      <AnimatePresence>
        {showAdminPanel && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAdminPanel(false)}
              className="fixed inset-0 bg-ink-dark/20 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-paper-warm shadow-2xl z-[70] p-12 flex flex-col"
            >
              <div className="flex justify-between items-center mb-12">
                <h2 className="text-2xl font-serif tracking-widest">管理后台</h2>
                <button onClick={() => setShowAdminPanel(false)} className="text-ink-dark/40 hover:text-ink-dark">收起</button>
              </div>
              
              <div className="space-y-12 flex-1">
                {/* 修改密码 */}
                <section>
                  <h3 className="text-xs uppercase tracking-[0.3em] text-ink-dark/40 font-bold mb-6">修改管理员密码</h3>
                  <div className="space-y-4">
                    <input 
                      type="password"
                      placeholder="输入新密码"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-4 py-3 bg-white/50 border border-ink-dark/10 rounded-xl focus:ring-2 focus:ring-zen-vermilion/20 outline-none text-sm"
                    />
                    <button 
                      onClick={handleChangePassword}
                      className="w-full py-3 border border-ink-dark/20 hover:bg-ink-dark hover:text-white transition-all font-serif text-sm"
                    >
                      确认修改
                    </button>
                  </div>
                </section>

                {/* 系统状态 */}
                <section className="pt-12 border-t border-ink-dark/5 space-y-6">
                  <h3 className="text-xs uppercase tracking-[0.3em] text-ink-dark/40 font-bold">系统状态</h3>
                  <div className="p-4 bg-white/50 rounded-lg space-y-3 border border-ink-dark/5">
                    <button 
                      onClick={checkHealth}
                      disabled={isCheckingHealth}
                      className="text-xs text-ink-dark/50 hover:text-zen-vermilion flex items-center gap-2 transition-colors"
                    >
                      {isCheckingHealth ? <Loader2 className="animate-spin" size={12} /> : <RefreshCw size={12} />}
                      检查后端连接与 API Key
                    </button>
                    {healthStatus && (
                      <div className="grid grid-cols-1 gap-2 text-[10px] font-mono">
                        <div className="flex justify-between border-b border-ink-dark/5 pb-1">
                          <span>Agnes AI (主力):</span>
                          <span className={healthStatus.hasAgnesAIKey ? "text-green-600" : "text-red-600 font-bold"}>
                            {healthStatus.hasAgnesAIKey ? "已就绪" : "未配置 (核心功能不可用)"}
                          </span>
                        </div>
                        <div className="flex justify-between border-b border-ink-dark/5 pb-1">
                          <span>ModelScope (备用):</span>
                          <span className={healthStatus.hasModelScopeKey ? "text-green-600" : "text-amber-600"}>
                            {healthStatus.hasModelScopeKey ? "已就绪" : "未配置 (可选备用)"}
                          </span>
                        </div>
                        <div className="flex justify-between border-b border-ink-dark/5 pb-1">
                          <span>数据库:</span> 
                          <span className={healthStatus.hasDB ? "text-green-600" : "text-red-600 font-bold"}>
                            {healthStatus.hasDB ? "正常" : "异常"}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>管理员:</span> 
                          <span className={healthStatus.isAdmin ? "text-green-600" : "text-red-600 font-bold"}>
                            {healthStatus.isAdmin ? "已登录" : "未登录"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                {/* 退出登录 */}
                <section className="pt-12 border-t border-ink-dark/5 mt-auto">
                  <button 
                    onClick={handleLogout}
                    className="w-full py-4 bg-rose-500 text-white rounded-xl hover:bg-rose-600 transition-all font-serif tracking-widest"
                  >
                    退出登录
                  </button>
                </section>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ==================== 状态消息 Toast ==================== */}
      <AnimatePresence>
        {statusMessage && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[90] px-6 py-3 bg-ink-dark text-paper-warm text-sm font-serif tracking-widest rounded-full shadow-2xl border border-zen-vermilion/20"
          >
            {statusMessage}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ==================== 页脚 ==================== */}
      <footer className="absolute bottom-0 left-0 right-0 py-6 text-center border-t border-ink-dark/5">
        <p className="text-[9px] text-ink-dark/20 tracking-widest">
          © 2026 诗画幻境 · 跨越千年的视觉对话
        </p>
      </footer>
    </div>
  );
}

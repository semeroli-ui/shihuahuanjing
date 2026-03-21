/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
  Image as ImageIcon
} from 'lucide-react';
import { poeticService } from './services/poeticService';

// 扩展 window 接口以支持 aistudio API
declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export default function App() {
  const [poem, setPoem] = useState('');
  const [visualPrompt, setVisualPrompt] = useState<{chinese: string, english: string} | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGeneratingImage, setIsGeneratingImage] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [imageStatus, setImageStatus] = useState('');
  const [videoStatus, setVideoStatus] = useState('');
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
      // 1. 检查 AI Studio 官方 Key 选择状态
      if (window.aistudio) {
        const selected = await window.aistudio.hasSelectedApiKey();
        if (selected) {
          setHasKey(true);
        }
      }

      // 2. 检查后端环境变量与登录状态
      try {
        const res = await fetch('/api/health');
        const data = await res.json() as { hasProKey: boolean; hasStudioKey: boolean; isAdmin: boolean };
        setHasKey(data.hasProKey || data.hasStudioKey);
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

  // 冷却时间倒计时
  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown(cooldown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [cooldown]);

  const handleOpenKeyDialog = async () => {
    if (window.aistudio) {
      try {
        await window.aistudio.openSelectKey();
        setHasKey(true);
        setStatusMessage('API Key 已通过官方通道配置');
      } catch (e) {
        console.error("Failed to open key dialog", e);
      }
    } else {
      setStatusMessage('请在 Cloudflare 控制台配置环境变量');
    }
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
    if (!poem.trim()) return;
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
      const promptObj = await poeticService.generatePrompt(poem);
      if (!promptObj.chinese && !promptObj.english) {
        throw new Error("模型未能生成有效的解析内容，请尝试更换诗句或重试。");
      }
      setVisualPrompt(promptObj);
      setStatusMessage('解析成功！');
      
      // 自动生成语音吟诵
      setAudioStatus('正在生成诗词吟诵...');
      try {
        // 清理旧的音频 URL
        if (audioUrl && audioUrl.startsWith('blob:')) {
          URL.revokeObjectURL(audioUrl);
        }
        const audio = await poeticService.generateSpeech(poem);
        setAudioUrl(audio);
        setAudioStatus('吟诵生成成功');
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
      if (response.generatedImages?.[0]?.image?.imageBytes) {
        const base64Image = response.generatedImages[0].image.imageBytes;
        setGeneratedImage(`data:image/png;base64,${base64Image}`);
        setImageStatus('原画绘制成功！');
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
    setVideoStatus('正在唤醒 Veo 3.1 旗舰模型，正在生成 1080p 视频...');
    
    try {
      console.log('Starting video generation with prompt:', visualPrompt.english);
      let operation = await poeticService.generateVideo(visualPrompt.english) as any;
      console.log('Video generation operation started:', operation);
      
      const poll = async () => {
        try {
          console.log('Polling video status for operation:', operation.name || operation);
          const result = await poeticService.pollVideoStatus(operation) as any;
          console.log('Poll result received:', result);
          
          if (result.done) {
            if (result.error) {
              throw new Error(`模型生成错误: ${result.error.message || JSON.stringify(result.error)}`);
            }
            
            const downloadLink = result.response?.generatedVideos?.[0]?.video?.uri;
            if (downloadLink) {
              console.log('Video generation complete. Downloading from proxy...');
              setVideoStatus('视频已生成，正在通过安全代理下载...');
              
              const response = await fetch(`/api/download-video?url=${encodeURIComponent(downloadLink)}`);
              
              if (!response.ok) {
                const errorText = await response.text();
                console.error('Video download failed:', response.status, errorText);
                throw new Error(`视频下载失败: ${response.status} ${errorText}`);
              }
              
              const blob = await response.blob();
              console.log('Video downloaded successfully, blob size:', blob.size);
              const url = URL.createObjectURL(blob);
              setVideoUrl(url);
              setVideoStatus('生成成功！');
            } else {
              throw new Error('未找到视频下载链接');
            }
            setIsGeneratingVideo(false);
          } else {
            // 检查是否有进度信息
            const metadata = result.metadata as any;
            const progress = metadata?.progressPercent || 0;
            setVideoStatus(progress > 0 ? `视频绘制中: ${progress}%` : '视频绘制中，请稍候... (Veo 正在精雕细琢)');
            setTimeout(poll, 15000); // 15秒轮询一次
          }
        } catch (e: any) {
          console.error('Poll attempt failed:', e);
          const errorMsg = e.message || '未知错误';
          if (errorMsg.includes('查询频率过高') || errorMsg.includes('429')) {
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
        setVideoStatus('触发 API 频率限制。Veo 预览版配额有限，请等待倒计时结束后重试。');
        setCooldown(60); // 开启 60 秒冷却
      } else if (error.message?.includes('Requested entity was not found')) {
        setVideoStatus('API Key 校验失败，请重试选择 Key。');
        setHasKey(false);
      } else {
        setVideoStatus(`生成失败: ${error.message || '未知错误'}`);
      }
    }
  };

  const downloadPrompts = () => {
    if (!visualPrompt) return;
    const content = `诗词原文：\n${poem}\n\n中文意境描述：\n${visualPrompt.chinese}\n\nEnglish Visual Prompt：\n${visualPrompt.english}`;
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
    if (!poem.trim()) return;
    try {
      const result = await poeticService.saveToLibrary(poem.trim()) as any;
      if (result.success) {
        const newItem = {
          id: result.id,
          poem: poem.trim(),
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

  return (
    <div className="min-h-screen paper-texture selection:bg-zen-vermilion/10 text-zen-ink">
      {/* Header */}
      <header className="py-12 px-12 flex justify-between items-start relative">
        <div className="flex items-start gap-8">
          {/* 2x2 方格标题 */}
          <div className="flex flex-col items-center">
            <div className="title-grid mb-4">
              <span className="serif-text">诗</span>
              <span className="serif-text">画</span>
              <span className="serif-text">幻</span>
              <span className="serif-text">境</span>
            </div>
            <p className="text-[10px] uppercase tracking-[0.3em] text-zen-ink/40 font-mono">
              Poetic Vision AI
            </p>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-4">
          <div className="flex items-center gap-4">
            {isAdmin ? (
              <button 
                onClick={() => setShowAdminPanel(!showAdminPanel)}
                className="flex items-center gap-2 px-6 py-2 bg-zen-ink text-white rounded-full shadow-md hover:bg-zen-vermilion transition-all text-sm font-serif"
              >
                <Key size={14} />
                <span>管理后台</span>
              </button>
            ) : (
              <button 
                onClick={() => setShowLoginModal(true)}
                className="flex items-center gap-2 px-6 py-2 bg-white/50 backdrop-blur-sm rounded-full border border-zen-ink/10 shadow-sm hover:bg-white transition-all text-sm font-serif"
              >
                <Key size={14} className="text-zen-ink/40" />
                <span>管理员登录</span>
              </button>
            )}

            <button 
              onClick={() => setShowLibrary(!showLibrary)}
              className="flex items-center gap-2 px-6 py-2 bg-white/50 backdrop-blur-sm rounded-full border border-zen-ink/10 shadow-sm hover:bg-white transition-all text-sm font-serif"
            >
              <Book size={14} className="text-zen-accent" />
              <span>藏书阁</span>
              <span className="bg-zen-vermilion/10 text-zen-vermilion text-[10px] px-1.5 rounded-full">{library.length}</span>
            </button>
          </div>
          
          <div className="text-right max-w-[200px]">
            <p className="text-[10px] leading-relaxed text-zen-ink/30 italic">
              “夫画者，从于心者也。感于物，动于情，发于笔端。”
            </p>
          </div>
        </div>
      </header>


      {/* 藏书阁抽屉 */}
      <AnimatePresence>
        {showLibrary && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLibrary(false)}
              className="fixed inset-0 bg-zen-ink/20 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-zen-paper paper-texture shadow-2xl z-[70] p-12 overflow-hidden flex flex-col"
            >
              <div className="flex justify-between items-center mb-12">
                <h2 className="text-2xl font-serif tracking-widest">藏书阁</h2>
                <button onClick={() => setShowLibrary(false)} className="text-zen-ink/40 hover:text-zen-ink">收起</button>
              </div>
              
              <div className="flex-1 overflow-y-auto library-scroll space-y-6 pr-4">
                {library.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-zen-ink/20 space-y-4">
                    <Book size={48} strokeWidth={1} />
                    <p className="font-serif italic">尚无藏书，待君录入</p>
                  </div>
                ) : (
                  library.map(item => (
                    <div key={item.id} className="p-6 bg-white/40 border border-zen-ink/5 rounded-3xl group hover:border-zen-vermilion/20 transition-all">
                      <p className="serif-text text-lg mb-4 leading-relaxed line-clamp-3">{item.poem}</p>
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] text-zen-ink/30">{item.date}</span>
                        <div className="flex gap-4 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => loadFromLibrary(item)} className="text-xs text-zen-accent hover:underline">研墨</button>
                          <button onClick={() => removeFromLibrary(item.id)} className="text-xs text-rose-400 hover:text-rose-600">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <main className="max-w-7xl mx-auto py-8 px-12 grid grid-cols-1 lg:grid-cols-12 gap-16 items-start">
        {/* Left Column: Input & Analysis (4 cols) */}
        <div className="lg:col-span-4 space-y-12">
          <section className="relative">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <div className="w-8 h-px bg-zen-ink/20"></div>
                <h2 className="text-xs uppercase tracking-[0.4em] text-zen-accent font-bold">
                  壹 · 诗词入画
                </h2>
              </div>
              <button 
                onClick={saveToLibrary}
                disabled={!poem.trim()}
                className="text-zen-ink/40 hover:text-zen-vermilion transition-colors disabled:opacity-0"
                title="收入藏书阁"
              >
                <Bookmark size={18} />
              </button>
            </div>
            
            <div className="decorative-border bg-white/40 backdrop-blur-sm shadow-xl shadow-zen-ink/5">
              <textarea
                value={poem}
                onChange={(e) => setPoem(e.target.value)}
                placeholder="在此输入诗句，感悟跨越千年的意境..."
                className="w-full h-48 p-8 bg-transparent border-none focus:ring-0 text-xl serif-text resize-none placeholder:text-zen-ink/10 leading-relaxed"
              />
            </div>
            
            <button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !poem}
              className="mt-8 w-full py-5 bg-zen-ink text-zen-paper rounded-none flex items-center justify-center gap-4 hover:bg-zen-vermilion transition-all duration-500 group disabled:opacity-30"
            >
              {isAnalyzing ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} className="group-hover:translate-x-1 transition-transform" />}
              <span className="tracking-[0.5em] font-serif text-lg">
                {isAnalyzing ? '解析中...' : '解析意境'}
              </span>
            </button>
          </section>

          <AnimatePresence>
            {visualPrompt && (
              <motion.section
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-8"
              >
                <div className="flex items-center gap-4">
                  <div className="w-8 h-px bg-zen-ink/20"></div>
                  <h2 className="text-xs uppercase tracking-[0.4em] text-zen-accent font-bold">
                    贰 · 意象重构
                  </h2>
                </div>

                <div className="space-y-6">
                  <div className="p-6 bg-white/60 border-l-2 border-zen-vermilion/30 shadow-sm relative">
                    <div className="absolute top-2 right-2 opacity-10"><FileText size={40} /></div>
                    <p className="text-[9px] uppercase tracking-widest text-zen-vermilion/60 mb-3 font-bold">视觉描述</p>
                    <p className="text-zen-ink/80 leading-loose serif-text text-base">
                      {visualPrompt.chinese}
                    </p>
                    {audioUrl && (
                      <div className="mt-4 pt-4 border-t border-zen-ink/5 flex flex-col gap-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-zen-ink/40 whitespace-nowrap italic">AI 吟诵已就绪</span>
                          <div className="flex gap-3">
                            <button 
                              onClick={() => {
                                const audio = document.querySelector('audio');
                                if (audio) audio.play();
                              }}
                              className="text-[10px] text-zen-accent hover:underline flex items-center gap-1"
                            >
                              <Play size={10} /> 立即播放
                            </button>
                            <a 
                              href={audioUrl} 
                              download={`吟诵_${new Date().getTime()}.wav`}
                              className="text-[10px] text-zen-accent hover:underline flex items-center gap-1"
                            >
                              <Download size={10} /> 下载音频
                            </a>
                          </div>
                        </div>
                        <audio 
                          key={audioUrl}
                          src={audioUrl} 
                          controls 
                          autoPlay={false}
                          className="h-8 w-full opacity-80 hover:opacity-100 transition-opacity" 
                        />
                      </div>
                    )}
                    {audioStatus && !audioUrl && (
                      <div className="mt-4 pt-4 border-t border-zen-ink/5 flex items-center gap-2 text-[10px] text-zen-ink/40 italic">
                        <Loader2 className="animate-spin" size={10} />
                        {audioStatus}
                      </div>
                    )}
                  </div>
                  
                  <div className="p-6 bg-zen-ink text-zen-paper/80 shadow-inner relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-white/5 -mr-12 -mt-12 rounded-full"></div>
                    <p className="text-[9px] uppercase tracking-widest text-white/40 mb-3 font-bold">Visual Prompt</p>
                    <p className="text-xs italic leading-relaxed font-mono opacity-60">
                      {visualPrompt.english}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <button
                    onClick={handleGenerateImage}
                    disabled={isGeneratingImage}
                    className="py-4 border border-zen-ink/20 flex items-center justify-center gap-3 hover:bg-zen-ink hover:text-zen-paper transition-all duration-500 disabled:opacity-30"
                  >
                    {isGeneratingImage ? <Loader2 className="animate-spin" size={16} /> : <ImageIcon size={16} />}
                    <span className="tracking-[0.2em] text-sm font-serif">生成诗意原画</span>
                  </button>

                  <button
                    onClick={handleGenerateVideo}
                    disabled={isGeneratingVideo || cooldown > 0}
                    className={`py-5 flex items-center justify-center gap-3 transition-all duration-700 ${
                      cooldown > 0 
                      ? 'bg-zen-ink/5 text-zen-ink/30 cursor-not-allowed' 
                      : 'bg-zen-vermilion text-white shadow-xl shadow-zen-vermilion/20 hover:scale-[1.02]'
                    } disabled:opacity-30`}
                  >
                    {isGeneratingVideo ? <Loader2 className="animate-spin" size={20} /> : cooldown > 0 ? <History size={20} /> : <Video size={20} />}
                    <span className="tracking-[0.4em] font-serif text-lg">
                      {isGeneratingVideo 
                        ? '画卷展开中...' 
                        : cooldown > 0 
                          ? `静候 (${cooldown}s)` 
                          : '生成视频画卷'}
                    </span>
                  </button>
                </div>

                {!hasKey && (
                  <div className="p-4 bg-amber-50 border border-amber-200 text-amber-800 text-[10px] rounded-sm flex flex-col gap-2">
                    <p className="font-bold">⚠️ 需要 API Key 以使用 Veo 视频模型</p>
                    <p>请点击下方按钮选择您的 Google Cloud 计费项目 API Key。</p>
                    <button 
                      onClick={handleOpenKeyDialog}
                      className="bg-amber-600 text-white py-1 px-3 rounded-sm hover:bg-amber-700 transition-colors self-start"
                    >
                      选择 API Key
                    </button>
                  </div>
                )}
                
                <div className="flex justify-center gap-6 pt-4">
                  <button onClick={downloadPrompts} className="text-[10px] text-zen-ink/40 hover:text-zen-vermilion transition-colors flex items-center gap-1">
                    <Download size={12} /> 导出脚本
                  </button>
                </div>
              </motion.section>
            )}
          </AnimatePresence>
        </div>

        {/* Right Column: Video/Image Preview (8 cols) */}
        <div className="lg:col-span-8 relative">
          <div className="flex items-center gap-4 mb-8">
            <div className="w-8 h-px bg-zen-ink/20"></div>
            <h2 className="text-xs uppercase tracking-[0.4em] text-zen-accent font-bold">
              叁 · 幻境呈现
            </h2>
          </div>

          {/* Image Preview Window */}
          <div className="relative aspect-video lg:aspect-[16/9] bg-zen-ink/5 rounded-sm overflow-hidden shadow-2xl group border border-zen-ink/10">
            {/* 装饰性角落 */}
            <div className="absolute top-0 left-0 w-8 h-8 border-t-2 border-l-2 border-zen-vermilion/40 m-4 z-10"></div>
            <div className="absolute bottom-0 right-0 w-8 h-8 border-b-2 border-r-2 border-zen-vermilion/40 m-4 z-10"></div>

            <AnimatePresence mode="wait">
              {generatedImage ? (
                <motion.div key="image" className="w-full h-full relative" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <img src={generatedImage} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                  <button onClick={downloadImage} className="absolute bottom-8 right-8 p-4 bg-white/10 hover:bg-zen-vermilion backdrop-blur-md rounded-full text-white opacity-0 group-hover:opacity-100 transition-all shadow-2xl">
                    <Download size={24} />
                  </button>
                </motion.div>
              ) : (
                <motion.div key="empty-image" className="w-full h-full flex flex-col items-center justify-center p-12 text-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  {isGeneratingImage ? (
                    <div className="space-y-6">
                      <Loader2 className="animate-spin text-zen-vermilion mx-auto" size={32} />
                      <p className="text-zen-ink/40 font-serif tracking-[0.2em] animate-pulse">正在落笔成画...</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="w-24 h-24 border border-zen-ink/10 rounded-full flex items-center justify-center mx-auto text-zen-ink/10">
                        <ImageIcon size={40} strokeWidth={1} />
                      </div>
                      <p className="text-zen-ink/20 font-serif tracking-[0.3em] text-lg">虚位以待，静候佳作</p>
                      <p className="text-[10px] text-zen-ink/10 max-w-xs mx-auto leading-relaxed">
                        解析诗词意境后，点击“生成诗意原画”即可见证文字化为视觉的瞬间。
                      </p>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Success Message */}
          {imageStatus && !isGeneratingImage && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-8 flex items-center justify-center gap-3"
            >
              <div className="w-1.5 h-1.5 rounded-full bg-zen-accent/40"></div>
              <p className="text-xs text-zen-accent/60 italic font-serif">
                {imageStatus}
              </p>
              <div className="w-1.5 h-1.5 rounded-full bg-zen-accent/40"></div>
            </motion.div>
          )}

          {/* Video Scroll Window (New Section) */}
          <AnimatePresence>
            {(isGeneratingVideo || videoUrl) && (
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 30 }}
                className="mt-16 space-y-8"
              >
                <div className="flex items-center gap-4">
                  <div className="w-8 h-px bg-zen-vermilion/30"></div>
                  <h3 className="text-[10px] uppercase tracking-[0.4em] text-zen-vermilion font-bold">
                    视频画卷 · 幻境展开
                  </h3>
                </div>
                
                <div className="relative aspect-video bg-zen-ink/5 rounded-sm overflow-hidden shadow-2xl border border-zen-vermilion/10 group">
                  {/* Scroll Ends Decoration (Physical feel) */}
                  <div className="absolute top-0 bottom-0 left-0 w-3 bg-gradient-to-r from-zen-ink/20 to-transparent z-20"></div>
                  <div className="absolute top-0 bottom-0 right-0 w-3 bg-gradient-to-l from-zen-ink/20 to-transparent z-20"></div>
                  
                  {videoUrl ? (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="w-full h-full relative">
                      <video src={videoUrl} controls autoPlay loop className="w-full h-full object-cover" />
                      <button onClick={downloadVideo} className="absolute bottom-8 right-8 p-4 bg-white/10 hover:bg-zen-vermilion backdrop-blur-md rounded-full text-white opacity-0 group-hover:opacity-100 transition-all shadow-2xl">
                        <Download size={24} />
                      </button>
                    </motion.div>
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center p-12 text-center bg-zen-paper/30 backdrop-blur-sm">
                      <div className="relative w-24 h-24 mb-8">
                        <div className="absolute inset-0 border border-zen-vermilion/10 rounded-full"></div>
                        <motion.div 
                          className="absolute inset-0 border-t-2 border-zen-vermilion rounded-full"
                          animate={{ rotate: 360 }}
                          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <Video size={24} className="text-zen-vermilion/40" />
                        </div>
                      </div>
                      <p className="text-zen-ink/40 font-serif tracking-[0.2em] animate-pulse">
                        {videoStatus || '正在唤醒 Veo 绘制画卷...'}
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <footer className="mt-24 py-16 border-t border-zen-ink/5 flex flex-col items-center gap-8">
        <div className="flex gap-12 text-[10px] tracking-[0.5em] text-zen-ink/20 uppercase font-bold">
          <span>Gemini 3.1 Pro</span>
          <span>Veo Video Engine</span>
          <span>Imagen 3 Art</span>
        </div>
        <div className="text-center space-y-2">
          {!isAdmin && (
            <p className="text-zen-accent text-[10px] tracking-widest uppercase mb-4">
              访客模式：每日限 3 次生成 · 剩余额度请见操作反馈
            </p>
          )}
          <p className="text-zen-ink/30 text-[10px] tracking-widest uppercase">
            © 2026 诗画幻境 · 跨越千年的视觉对话
          </p>
          <p className="text-zen-ink/10 text-[8px] tracking-widest uppercase">
            Crafted with Zen & AI
          </p>
        </div>
      </footer>

      {/* 登录弹窗 */}
      <AnimatePresence>
        {showLoginModal && (
          <div className="fixed inset-0 flex items-center justify-center z-[100] px-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowLoginModal(false)}
              className="absolute inset-0 bg-zen-ink/40 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="relative w-full max-w-md bg-zen-paper paper-texture p-10 rounded-3xl shadow-2xl border border-zen-ink/10"
            >
              <h3 className="text-xl font-serif mb-6 tracking-widest">管理员登录</h3>
              <div className="space-y-4">
                <input 
                  type="email"
                  placeholder="管理员邮箱"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="w-full px-4 py-3 bg-white/50 border border-zen-ink/10 rounded-xl focus:ring-2 focus:ring-zen-vermilion/20 outline-none"
                />
                <input 
                  type="password"
                  placeholder="登录密码"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  className="w-full px-4 py-3 bg-white/50 border border-zen-ink/10 rounded-xl focus:ring-2 focus:ring-zen-vermilion/20 outline-none"
                />
                <button 
                  onClick={handleLogin}
                  className="w-full py-4 bg-zen-ink text-white rounded-xl hover:bg-zen-vermilion transition-all font-serif tracking-widest"
                >
                  立即登录
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* 管理后台抽屉 */}
      <AnimatePresence>
        {showAdminPanel && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAdminPanel(false)}
              className="fixed inset-0 bg-zen-ink/20 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              className="fixed top-0 right-0 h-full w-full max-w-md bg-zen-paper paper-texture shadow-2xl z-[70] p-12 flex flex-col"
            >
              <div className="flex justify-between items-center mb-12">
                <h2 className="text-2xl font-serif tracking-widest">管理后台</h2>
                <button onClick={() => setShowAdminPanel(false)} className="text-zen-ink/40 hover:text-zen-ink">收起</button>
              </div>
              
              <div className="space-y-12">
                <section>
                  <h3 className="text-xs uppercase tracking-[0.4em] text-zen-accent font-bold mb-6">修改管理员密码</h3>
                  <div className="space-y-4">
                    <input 
                      type="password"
                      placeholder="输入新密码"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-4 py-3 bg-white/50 border border-zen-ink/10 rounded-xl focus:ring-2 focus:ring-zen-vermilion/20 outline-none"
                    />
                    <button 
                      onClick={handleChangePassword}
                      className="w-full py-3 border border-zen-ink/20 hover:bg-zen-ink hover:text-white transition-all font-serif"
                    >
                      确认修改
                    </button>
                  </div>
                </section>

                <section className="pt-12 border-t border-zen-ink/5 space-y-6">
                  <h3 className="text-xs uppercase tracking-[0.4em] text-zen-accent font-bold">系统状态</h3>
                  <div className="p-4 bg-zen-paper/50 rounded-lg space-y-3 border border-zen-ink/5">
                    <button 
                      onClick={checkHealth}
                      disabled={isCheckingHealth}
                      className="text-xs text-zen-accent hover:underline flex items-center gap-2"
                    >
                      {isCheckingHealth ? <Loader2 className="animate-spin" size={12} /> : <RefreshCw size={12} />}
                      检查后端连接与 API Key
                    </button>
                    {healthStatus && (
                      <div className="grid grid-cols-1 gap-2 text-[10px] font-mono">
                        <div className="flex justify-between border-b border-zen-ink/5 pb-1">
                          <span>免费层 (解析):</span> 
                          <span className={healthStatus.hasProKey ? "text-green-600" : "text-amber-600"}>
                            {healthStatus.hasProKey ? `已就绪 (${healthStatus.proKeyCount}个 Key)` : "未配置 (将使用高权限 Key)"}
                          </span>
                        </div>
                        <div className="flex justify-between border-b border-zen-ink/5 pb-1">
                          <span>高权限 (Veo/TTS):</span> 
                          <span className={healthStatus.hasStudioKey ? "text-green-600" : "text-red-600 font-bold"}>
                            {healthStatus.hasStudioKey ? "已就绪" : "未配置 (核心功能将受限)"}
                          </span>
                        </div>
                        <div className="flex justify-between border-b border-zen-ink/5 pb-1">
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

                <section className="pt-12 border-t border-zen-ink/5">
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
    </div>
  );
}

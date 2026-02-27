import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ApiUsage } from '../../types';

interface ScriptExtractorProps {
  apiKey: string;
  initialUrl?: string;
  usage: ApiUsage;
  onUsageUpdate: (cost: number, type: 'search' | 'list' | 'script', details?: string) => void;
}

export const ScriptExtractor: React.FC<ScriptExtractorProps> = ({ apiKey, initialUrl, usage, onUsageUpdate }) => {
  const { plan, role } = useAuth();
  const [url, setUrl] = useState(initialUrl || '');
  const [loading, setLoading] = useState(false);
  
  // 만약 외부(Video Insights 등)에서 주소를 가지고 넘어온 경우 자동 실행
  React.useEffect(() => {
    if (initialUrl) {
      fetchTranscript();
    }
  }, [initialUrl]);
  const [transcript, setTranscript] = useState('');
  const [error, setError] = useState('');
  const [videoInfo, setVideoInfo] = useState<{title: string, author: string, thumbnail: string} | null>(null);
  const [aiResult, setAiResult] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMode, setAiMode] = useState<'translate' | 'summarize' | null>(null);

  const extractVideoId = (url: string) => {
    // Shorts, Mobile, etc.를 모두 포함하는 더 강력한 정규식
    const regExp = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/\s]{11})/;
    const match = url.match(regExp);
    return (match && match[1].length === 11) ? match[1] : null;
  };

  const fetchTranscript = async () => {
    if (!url.trim()) return;
    const videoId = extractVideoId(url);
    if (!videoId) {
      setError('유효한 유튜브 URL을 입력해주세요. (Shorts 포함)');
      return;
    }

    if (usage.used + 200 > usage.total) {
      setError('일일 API 사용 한도가 초과되었습니다. (필요: 200 Unit)');
      return;
    }

    // 등급 제한: 골드 이상 또는 관리자만 가능
    if (plan !== 'gold' && role !== 'admin') {
      setError('대본 추출 기능은 골드(Gold) 등급 이상 회원만 사용 가능합니다.');
      return;
    }

    setLoading(true);
    setError('');
    setTranscript('');
    setVideoInfo(null);

    let fetchedTitle = '';

    try {
      // 1. 기본 정보 호출 (선택 사항)
      try {
        const infoRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`);
        const infoData = await infoRes.json();
        if (infoData.items && infoData.items.length > 0) {
          const snippet = infoData.items[0].snippet;
          fetchedTitle = snippet.title;
          setVideoInfo({
            title: snippet.title,
            author: snippet.channelTitle,
            thumbnail: snippet.thumbnails.medium?.url || snippet.thumbnails.default?.url
          });
        }
      } catch (e) {
        console.warn('YouTube API Info fetch failed');
      }

      // 2. 자막 추출 API 호출 (Cloudflare Worker 또는 로컬 Python 서버)
      const transcriptApiUrl = import.meta.env.VITE_TRANSCRIPT_API_URL;
      const transcriptUrl = transcriptApiUrl
        ? `${transcriptApiUrl}?v=${videoId}&lang=ko,en`
        : `/api/transcript?v=${videoId}&lang=ko,en`;
      const transcriptRes = await fetch(transcriptUrl);

      if (!transcriptRes.ok) {
        throw new Error(`대본 추출 서비스 연결 실패 (상태코드: ${transcriptRes.status})`);
      }

      const result = await transcriptRes.json();
      console.log('Transcript API Result:', result);

      if (!result.success) {
        throw new Error(result.error || '자막 추출에 실패했습니다.');
      }

      const rawText = result.full_text || '';

      if (rawText.length > 5) {
        const formattedText = rawText
          .replace(/([.?!,])\s*/g, '$1\n')
          .split('\n')
          .map((line: string) => line.trim())
          .filter((line: string) => line.length > 0)
          .join('\n');
        setTranscript(formattedText);

        // 포인트 차감 적용
        onUsageUpdate(200, 'script', `대본 추출: ${fetchedTitle || url}`);
      } else {
        throw new Error('추출된 텍스트 내용이 너무 짧거나 유효하지 않습니다.');
      }

    } catch (err: any) {
      console.error('Apify Error Detailed:', err);
      setError(err.message || '대본 추출 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    if (!transcript) return;
    navigator.clipboard.writeText(transcript);
    alert('대본이 클립보드에 복사되었습니다.');
  };

  const handleDownload = () => {
    if (!transcript) return;
    const element = document.createElement("a");
    const file = new Blob([transcript], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    const fileName = videoInfo 
      ? `대본_${videoInfo.title.replace(/[^a-z0-9가-힣]/gi, '_')}.txt`
      : 'youtube_transcript.txt';
    element.download = fileName;
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleAiAction = async (mode: 'translate' | 'summarize') => {
    const geminiKey = localStorage.getItem('gemini_api_key') || localStorage.getItem('admin_gemini_key');
    if (!geminiKey) {
      setError('Gemini API 키가 필요합니다. 마이페이지 대시보드에서 설정해주세요.');
      return;
    }

    setAiLoading(true);
    setAiMode(mode);
    setAiResult('');

    try {
      const prompt = mode === 'translate'
        ? `다음 유튜브 영상 대본을 자연스러운 한국어로 번역해주세요. 의역보다는 직역에 가깝되 자연스럽게 번역하세요.\n\n${transcript.substring(0, 15000)}`
        : `다음 유튜브 영상 대본을 한국어로 핵심 내용을 요약해주세요. 주요 포인트를 불릿 포인트로 정리하고, 전체 요약을 3-5문장으로 작성해주세요.\n\n${transcript.substring(0, 15000)}`;

      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });

      if (!res.ok) throw new Error(`Gemini API 오류 (${res.status})`);

      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!text) throw new Error('AI 응답이 비어있습니다.');

      setAiResult(text);
    } catch (err: any) {
      setError(err.message || 'AI 처리 중 오류가 발생했습니다.');
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="w-full space-y-8 animate-in slide-in-from-right-4 duration-500 pb-20">
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-indigo-500 uppercase flex items-center gap-3">
            <span className="material-symbols-outlined text-2xl md:text-3xl">description</span>
            유튜브 대본 추출
          </h2>
          <p className="text-slate-500 text-[11px] font-medium leading-relaxed hidden md:block">
            유튜브 영상 링크를 입력하여 <span className="text-indigo-500 font-bold">대본(자막)을 순식간에 추출</span>합니다.<br />
            추출된 텍스트를 복사하거나 다운로드하여 콘텐츠 제작에 활용해 보세요.
          </p>
        </div>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Input Area */}
        <div className="relative group">
          <div className="absolute inset-y-0 left-4 flex items-center text-slate-400 group-focus-within:text-indigo-500 transition-colors">
            <span className="material-symbols-outlined">link</span>
          </div>
          <input 
            type="text" 
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && fetchTranscript()}
            className="w-full pl-12 pr-32 py-4 bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl focus:border-indigo-500 dark:focus:border-indigo-500 outline-none text-slate-900 dark:text-white font-bold transition-all shadow-sm"
          />
          <button 
            onClick={fetchTranscript}
            disabled={loading || !url}
            className="absolute right-2 top-2 bottom-2 px-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-xl font-bold text-sm transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            {loading ? (
              <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <span className="material-symbols-outlined text-lg">auto_awesome</span>
            )}
            추출하기
          </button>
        </div>

        {error && (
          <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-xl flex items-center gap-3 text-rose-600 dark:text-rose-400 text-sm font-bold animate-in fade-in zoom-in-95">
            <span className="material-symbols-outlined">error</span>
            {error}
          </div>
        )}

        {/* Result Area */}
        {videoInfo && (
          <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 flex gap-4 animate-in slide-in-from-bottom-2">
            <img src={videoInfo.thumbnail} alt="Thumbnail" className="w-32 aspect-video object-cover rounded-lg shadow-md" />
            <div className="flex-1 min-w-0 py-1">
              <h4 className="text-base font-black text-slate-900 dark:text-white truncate mb-1">{videoInfo.title}</h4>
              <p className="text-sm text-slate-500 font-bold">{videoInfo.author}</p>
            </div>
          </div>
        )}

        {transcript && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex justify-between items-center px-1">
              <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest">추출된 대본</h3>
              <div className="flex gap-2">
                <button 
                  onClick={handleCopy}
                  className="px-4 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-all flex items-center gap-2"
                >
                  <span className="material-symbols-outlined text-sm">content_copy</span>
                  복사하기
                </button>
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 text-indigo-600 dark:text-indigo-400 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-indigo-100 dark:border-indigo-900/50"
                >
                  <span className="material-symbols-outlined text-sm">download</span>
                  다운로드
                </button>
                <button
                  onClick={() => handleAiAction('translate')}
                  disabled={aiLoading}
                  className="px-4 py-2 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-emerald-100 dark:border-emerald-900/50"
                >
                  <span className="material-symbols-outlined text-sm">translate</span>
                  한국어 번역
                </button>
                <button
                  onClick={() => handleAiAction('summarize')}
                  disabled={aiLoading}
                  className="px-4 py-2 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-amber-600 dark:text-amber-400 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border border-amber-100 dark:border-amber-900/50"
                >
                  <span className="material-symbols-outlined text-sm">summarize</span>
                  요약하기
                </button>
              </div>
            </div>
            <div className="bg-slate-50 dark:bg-black/40 rounded-2xl p-6 border border-slate-100 dark:border-slate-800/50 min-h-[300px] max-h-[500px] overflow-y-auto custom-scrollbar relative">
              <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-medium">
                {transcript}
              </p>
            </div>

            {aiLoading && (
              <div className="flex items-center gap-3 p-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-900/30 rounded-xl animate-pulse">
                <div className="size-5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
                <span className="text-sm font-bold text-indigo-600 dark:text-indigo-400">
                  {aiMode === 'translate' ? '번역 중...' : '요약 중...'}
                </span>
              </div>
            )}

            {aiResult && (
              <div className="space-y-3 animate-in fade-in slide-in-from-bottom-2">
                <div className="flex justify-between items-center px-1">
                  <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm">{aiMode === 'translate' ? 'translate' : 'summarize'}</span>
                    {aiMode === 'translate' ? 'AI 번역 결과' : 'AI 요약 결과'}
                  </h3>
                  <button
                    onClick={() => { navigator.clipboard.writeText(aiResult); alert('복사되었습니다.'); }}
                    className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5"
                  >
                    <span className="material-symbols-outlined text-sm">content_copy</span>
                    복사
                  </button>
                </div>
                <div className="bg-emerald-50/50 dark:bg-emerald-950/20 rounded-2xl p-6 border border-emerald-100 dark:border-emerald-800/50 max-h-[400px] overflow-y-auto custom-scrollbar">
                  <p className="text-slate-700 dark:text-slate-300 text-sm leading-relaxed whitespace-pre-wrap font-medium">
                    {aiResult}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {!transcript && !loading && !error && (
          <div className="py-20 flex flex-col items-center justify-center text-center space-y-4 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-[2.5rem]">
            <div className="size-20 rounded-3xl bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-slate-200 dark:text-slate-800">
              <span className="material-symbols-outlined text-5xl">text_snippet</span>
            </div>
            <div className="space-y-1">
              <p className="text-slate-600 dark:text-slate-300 font-black">추출할 영상을 입력해주세요</p>
              <p className="text-slate-400 text-xs font-medium">유튜브 URL을 입력하면 실시간으로 대본을 분석합니다.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

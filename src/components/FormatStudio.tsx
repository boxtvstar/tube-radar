import React, { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { ApiUsage } from '../../types';
import {
  analyzeBenchmarkVideo,
  BenchmarkVideoInsight,
  generateBenchmarkScript,
  generateBenchmarkTopics,
  ScriptGenerationResult,
  TopicIdea,
} from '../../services/formatIdeationService';

interface FormatStudioProps {
  apiKey: string;
  usage: ApiUsage;
  onUsageUpdate: (cost: number, type: 'search' | 'list' | 'script', details?: string) => void;
}

interface BenchmarkVideoState {
  url: string;
  videoId: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationText: string;
  analysis: BenchmarkVideoInsight;
}

interface StoredWorkspace {
  urlInput: string;
  benchmark: BenchmarkVideoState | null;
  ideas: TopicIdea[];
  selectedIdeaId: string | null;
  generatedScript: ScriptGenerationResult | null;
  lastAnalyzedAt?: number;
}

const DEFAULT_WORKSPACE: StoredWorkspace = {
  urlInput: '',
  benchmark: null,
  ideas: [],
  selectedIdeaId: null,
  generatedScript: null,
};

const extractVideoId = (url: string) => {
  const regExp =
    /(?:youtube\.com\/(?:[^/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?/\\s]{11})/;
  const match = url.match(regExp);
  return match && match[1].length === 11 ? match[1] : null;
};

const buildStorageKey = (uid?: string) => `tube_radar_reference_studio_${uid || 'guest'}`;

const getGeminiKey = () =>
  localStorage.getItem('gemini_api_key') || localStorage.getItem('admin_gemini_key') || '';

const parseIsoDuration = (value: string) => {
  const matches = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!matches) return '';

  const hours = Number(matches[1] || 0);
  const minutes = Number(matches[2] || 0);
  const seconds = Number(matches[3] || 0);
  const totalMinutes = hours * 60 + minutes + (seconds >= 30 ? 1 : 0);

  if (totalMinutes <= 0) return '1분 내외';
  if (hours > 0) return `${hours}시간 ${minutes}분`;
  return `${totalMinutes}분 내외`;
};

const formatRelativeTime = (timestamp?: number | null) => {
  if (!timestamp) return '';
  const diff = Date.now() - timestamp;
  const minutes = Math.max(1, Math.round(diff / 60000));
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(hours / 24);
  return `${days}일 전`;
};

export const FormatStudio: React.FC<FormatStudioProps> = ({
  apiKey,
  usage,
  onUsageUpdate,
}) => {
  const { user, plan, role } = useAuth();
  const hasGoldAccess = plan === 'gold' || plan === 'platinum' || role === 'admin';
  const storageKey = useMemo(() => buildStorageKey(user?.uid), [user?.uid]);
  const [urlInput, setUrlInput] = useState('');
  const [benchmark, setBenchmark] = useState<BenchmarkVideoState | null>(null);
  const [ideas, setIdeas] = useState<TopicIdea[]>([]);
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [generatedScript, setGeneratedScript] = useState<ScriptGenerationResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [generatingIdeas, setGeneratingIdeas] = useState(false);
  const [generatingScript, setGeneratingScript] = useState(false);
  const [error, setError] = useState('');
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<number | null>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) {
        setUrlInput(DEFAULT_WORKSPACE.urlInput);
        setBenchmark(DEFAULT_WORKSPACE.benchmark);
        setIdeas(DEFAULT_WORKSPACE.ideas);
        setSelectedIdeaId(DEFAULT_WORKSPACE.selectedIdeaId);
        setGeneratedScript(DEFAULT_WORKSPACE.generatedScript);
        setLastAnalyzedAt(null);
        return;
      }

      const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
      setUrlInput(parsed.urlInput || '');
      setBenchmark(parsed.benchmark || null);
      setIdeas(Array.isArray(parsed.ideas) ? parsed.ideas : []);
      setSelectedIdeaId(parsed.selectedIdeaId || null);
      setGeneratedScript(parsed.generatedScript || null);
      setLastAnalyzedAt(parsed.lastAnalyzedAt || null);
    } catch (loadError) {
      console.error('Reference studio load error:', loadError);
    }
  }, [storageKey]);

  useEffect(() => {
    const payload: StoredWorkspace = {
      urlInput,
      benchmark,
      ideas,
      selectedIdeaId,
      generatedScript,
      lastAnalyzedAt: lastAnalyzedAt || undefined,
    };
    localStorage.setItem(storageKey, JSON.stringify(payload));
  }, [urlInput, benchmark, ideas, selectedIdeaId, generatedScript, lastAnalyzedAt, storageKey]);

  const selectedIdea = ideas.find((idea) => idea.id === selectedIdeaId) || null;
  const hasGeminiKey = !!getGeminiKey();

  const requireGoldPlan = () => {
    if (!hasGoldAccess) {
      setError('이 기능은 골드(Gold) 등급 이상 회원만 사용할 수 있습니다.');
      return false;
    }

    return true;
  };

  const fetchVideoMetadata = async (videoId: string) => {
    const fallback = {
      title: `YouTube Video ${videoId}`,
      channel: '채널 정보 미확인',
      thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
      durationText: '길이 정보 없음',
    };

    if (!apiKey) return fallback;

    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails&id=${videoId}&key=${apiKey}`
      );
      const data = await response.json();
      const item = data?.items?.[0];
      const snippet = item?.snippet;
      const durationText = item?.contentDetails?.duration
        ? parseIsoDuration(item.contentDetails.duration)
        : fallback.durationText;

      return {
        title: snippet?.title || fallback.title,
        channel: snippet?.channelTitle || fallback.channel,
        thumbnail:
          snippet?.thumbnails?.medium?.url ||
          snippet?.thumbnails?.high?.url ||
          fallback.thumbnail,
        durationText,
      };
    } catch (metadataError) {
      console.warn('Reference studio metadata fetch failed:', metadataError);
      return fallback;
    }
  };

  const handleAnalyze = async () => {
    if (!requireGoldPlan()) return;

    const geminiKey = getGeminiKey();
    if (!geminiKey) {
      setError('Gemini API 키가 필요합니다. 마이페이지에서 먼저 설정해주세요.');
      return;
    }

    const trimmedUrl = urlInput.trim();
    const videoId = extractVideoId(trimmedUrl);
    if (!videoId) {
      setError('올바른 유튜브 영상 주소를 입력해주세요.');
      return;
    }

    if (usage.used + 200 > usage.total) {
      setError('일일 API 사용 한도가 초과되었습니다. (필요: 200 Unit)');
      return;
    }

    setAnalyzing(true);
    setError('');
    setIdeas([]);
    setSelectedIdeaId(null);
    setGeneratedScript(null);

    try {
      const metadata = await fetchVideoMetadata(videoId);
      const analysis = await analyzeBenchmarkVideo(geminiKey, {
        url: trimmedUrl,
        title: metadata.title,
        channel: metadata.channel,
        durationText: metadata.durationText,
      });

      setBenchmark({
        url: trimmedUrl,
        videoId,
        title: metadata.title,
        channel: metadata.channel,
        thumbnail: metadata.thumbnail,
        durationText: metadata.durationText,
        analysis,
      });
      setLastAnalyzedAt(Date.now());
      onUsageUpdate(200, 'script', `벤치마크 영상 분석: ${metadata.title}`);
    } catch (analyzeError: any) {
      console.error('Benchmark analyze error:', analyzeError);
      setError(analyzeError.message || '영상 분석 중 오류가 발생했습니다.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleGenerateIdeas = async () => {
    if (!requireGoldPlan()) return;
    if (!benchmark) {
      setError('먼저 영상 분석을 완료해주세요.');
      return;
    }

    const geminiKey = getGeminiKey();
    if (!geminiKey) {
      setError('Gemini API 키가 필요합니다. 마이페이지에서 먼저 설정해주세요.');
      return;
    }

    if (usage.used + 300 > usage.total) {
      setError('일일 API 사용 한도가 초과되었습니다. (필요: 300 Unit)');
      return;
    }

    setGeneratingIdeas(true);
    setError('');
    setGeneratedScript(null);

    try {
      const nextIdeas = await generateBenchmarkTopics(
        geminiKey,
        {
          url: benchmark.url,
          title: benchmark.title,
          channel: benchmark.channel,
          durationText: benchmark.durationText,
          insight: benchmark.analysis,
        },
        10
      );

      setIdeas(nextIdeas);
      setSelectedIdeaId(nextIdeas[0]?.id || null);
      onUsageUpdate(300, 'script', `벤치마크 기반 새 주제 생성: ${benchmark.title}`);
    } catch (generateError: any) {
      console.error('Idea generation error:', generateError);
      setError(generateError.message || '주제 생성 중 오류가 발생했습니다.');
    } finally {
      setGeneratingIdeas(false);
    }
  };

  const handleGenerateScript = async () => {
    if (!requireGoldPlan()) return;
    if (!benchmark || !selectedIdea) {
      setError('주제를 먼저 선택해주세요.');
      return;
    }

    const geminiKey = getGeminiKey();
    if (!geminiKey) {
      setError('Gemini API 키가 필요합니다. 마이페이지에서 먼저 설정해주세요.');
      return;
    }

    if (usage.used + 400 > usage.total) {
      setError('일일 API 사용 한도가 초과되었습니다. (필요: 400 Unit)');
      return;
    }

    setGeneratingScript(true);
    setError('');

    try {
      const nextScript = await generateBenchmarkScript(geminiKey, {
        url: benchmark.url,
        title: benchmark.title,
        channel: benchmark.channel,
        durationText: benchmark.durationText,
        insight: benchmark.analysis,
      }, selectedIdea);

      setGeneratedScript(nextScript);
      onUsageUpdate(400, 'script', `벤치마크 기반 대본 생성: ${selectedIdea.title}`);
    } catch (scriptError: any) {
      console.error('Script generation error:', scriptError);
      setError(scriptError.message || '대본 생성 중 오류가 발생했습니다.');
    } finally {
      setGeneratingScript(false);
    }
  };

  const handleResetWorkspace = () => {
    setUrlInput('');
    setBenchmark(null);
    setIdeas([]);
    setSelectedIdeaId(null);
    setGeneratedScript(null);
    setLastAnalyzedAt(null);
    setError('');
    localStorage.removeItem(storageKey);
  };

  return (
    <div className="w-full space-y-8 animate-in slide-in-from-right-4 duration-500 pb-20">
      <div className="space-y-3">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-fuchsia-50 dark:bg-fuchsia-500/10 border border-fuchsia-200 dark:border-fuchsia-500/20 text-fuchsia-600 dark:text-fuchsia-300 text-[11px] font-black uppercase tracking-[0.24em]">
          <span className="material-symbols-outlined text-base">schema</span>
          Reference Studio
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl md:text-3xl font-black tracking-tight text-slate-900 dark:text-white">
            영상 하나를 벤치마킹해서
            <span className="block">새 주제 10개와</span>
            <span className="block text-fuchsia-500">비슷한 길이감의 새 대본까지 만듭니다.</span>
          </h2>
          <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed max-w-3xl">
            복잡한 그룹 불러오기는 뺐습니다. 유튜브 영상 주소 하나만 넣고 분석하면, Gemini가 형식과 전개를 읽고
            새 주제 10개를 제안한 뒤 선택한 주제로 새 대본까지 작성합니다.
          </p>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <section className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 shadow-xl shadow-slate-200/40 dark:shadow-black/20 overflow-hidden">
          <div className="px-6 md:px-8 py-6 border-b border-slate-100 dark:border-slate-800 bg-gradient-to-r from-fuchsia-500/[0.08] via-transparent to-cyan-500/[0.08]">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <div>
                <h3 className="text-lg font-black text-slate-900 dark:text-white">Step 1. 벤치마크 영상 분석</h3>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
                  유튜브 영상 주소 하나를 넣고 훅, 전개 구조, 길이감을 먼저 읽습니다.
                </p>
              </div>
              <div className="flex items-center gap-2 text-[11px] font-bold flex-wrap">
                <span className="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300">
                  Gemini {hasGeminiKey ? '연결됨' : '키 필요'}
                </span>
                {lastAnalyzedAt && (
                  <span className="px-3 py-1 rounded-full bg-fuchsia-50 dark:bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-300 border border-fuchsia-100 dark:border-fuchsia-500/20">
                    마지막 분석 {formatRelativeTime(lastAnalyzedAt)}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="p-6 md:p-8 space-y-5">
            <div className="rounded-[1.75rem] border border-slate-200 dark:border-slate-800 bg-gradient-to-r from-slate-50 to-fuchsia-50/60 dark:from-slate-950/60 dark:to-fuchsia-950/10 p-5 space-y-4">
              <div>
                <p className="text-sm font-black text-slate-900 dark:text-white">영상 주소 입력</p>
                <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
                  `watch?v=...`, `youtu.be/...`, `shorts/...` 모두 가능합니다.
                </p>
              </div>

              <textarea
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full min-h-[110px] rounded-[1.5rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950/60 px-5 py-4 text-sm font-medium text-slate-900 dark:text-white outline-none focus:border-fuchsia-400 focus:ring-4 focus:ring-fuchsia-500/10 transition"
              />

              <div className="flex gap-3 flex-wrap">
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="px-5 py-3 rounded-2xl bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold text-sm shadow-lg shadow-fuchsia-500/20 disabled:opacity-40 transition"
                >
                  {analyzing ? '분석 중...' : '영상 분석'}
                </button>
                <button
                  onClick={handleResetWorkspace}
                  disabled={!benchmark && !ideas.length && !generatedScript && !urlInput}
                  className="px-5 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 disabled:opacity-40 font-bold text-sm transition"
                >
                  작업 비우기
                </button>
              </div>
            </div>

            {error && (
              <div className="p-4 rounded-2xl border border-rose-200 dark:border-rose-500/20 bg-rose-50 dark:bg-rose-950/20 text-rose-600 dark:text-rose-300 text-sm font-bold">
                {error}
              </div>
            )}

            {!benchmark ? (
              <div className="rounded-[2rem] border-2 border-dashed border-slate-200 dark:border-slate-800 px-6 py-14 text-center">
                <div className="mx-auto mb-4 size-16 rounded-3xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-slate-300 dark:text-slate-600">
                  <span className="material-symbols-outlined text-4xl">smart_display</span>
                </div>
                <p className="font-black text-slate-700 dark:text-slate-200">아직 분석된 벤치마크 영상이 없습니다.</p>
                <p className="text-xs font-medium text-slate-400 mt-1">
                  영상 주소를 넣고 분석하면, 여기에서 형식 요약과 길이감이 바로 보입니다.
                </p>
              </div>
            ) : (
              <article className="rounded-[1.75rem] border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/40 p-4 md:p-5 space-y-5">
                <div className="flex gap-4">
                  <img
                    src={benchmark.thumbnail}
                    alt={benchmark.title}
                    className="w-40 h-[90px] rounded-2xl object-cover bg-slate-200 dark:bg-slate-800 shrink-0"
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <h4 className="text-base font-black text-slate-900 dark:text-white line-clamp-2">
                      {benchmark.title}
                    </h4>
                    <p className="text-sm font-medium text-slate-500 dark:text-slate-400">
                      {benchmark.channel}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap text-[11px] font-black">
                      <span className="px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                        분석 완료
                      </span>
                      <span className="px-3 py-1 rounded-full bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-300">
                        원본 길이 {benchmark.durationText}
                      </span>
                      <span className="px-3 py-1 rounded-full bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-300">
                        생성 기준 {benchmark.analysis.durationGuide}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.5rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-5">
                  <div>
                    <p className="text-[11px] font-black uppercase tracking-[0.18em] text-fuchsia-500 mb-1">
                      Summary
                    </p>
                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 leading-relaxed">
                      {benchmark.analysis.summary}
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">
                        Hook Patterns
                      </p>
                      <div className="space-y-2">
                        {benchmark.analysis.hookPatterns.map((item, index) => (
                          <p key={`hook_${index}`} className="text-sm font-medium text-slate-600 dark:text-slate-300">
                            {item}
                          </p>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">
                        Structure
                      </p>
                      <div className="space-y-2">
                        {benchmark.analysis.structurePatterns.map((item, index) => (
                          <p key={`structure_${index}`} className="text-sm font-medium text-slate-600 dark:text-slate-300">
                            {item}
                          </p>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">
                        Audience
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {benchmark.analysis.audienceTargets.map((item, index) => (
                          <span key={`audience_${index}`} className="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">
                        Tone
                      </p>
                      <div className="flex gap-2 flex-wrap">
                        {benchmark.analysis.toneGuide.map((item, index) => (
                          <span key={`tone_${index}`} className="px-3 py-1 rounded-full bg-fuchsia-50 dark:bg-fuchsia-500/10 text-xs font-bold text-fuchsia-600 dark:text-fuchsia-300">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 flex-wrap">
                    <button
                      onClick={handleGenerateIdeas}
                      disabled={generatingIdeas}
                      className="px-5 py-3 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 disabled:opacity-40 font-bold text-sm transition"
                    >
                      {generatingIdeas ? '주제 생성 중...' : '새 주제 10개 생성'}
                    </button>
                  </div>
                </div>
              </article>
            )}
          </div>
        </section>

        <section className="space-y-6">
          <div className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 shadow-xl shadow-slate-200/40 dark:shadow-black/20 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
              <h3 className="text-lg font-black text-slate-900 dark:text-white">Step 2. 새 주제 10개</h3>
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
                벤치마크 영상을 기반으로 클릭될 만한 유사 결의의 주제를 제안합니다.
              </p>
            </div>
            <div className="p-5 space-y-4">
              {ideas.length === 0 ? (
                <div className="rounded-[1.75rem] border-2 border-dashed border-slate-200 dark:border-slate-800 px-6 py-12 text-center">
                  <p className="font-black text-slate-700 dark:text-slate-200">분석 후 새 주제 10개를 생성할 수 있습니다.</p>
                  <p className="text-xs font-medium text-slate-400 mt-1">버튼 한 번으로 10개가 채워지고, 그중 하나를 골라 대본 생성으로 넘어갑니다.</p>
                </div>
              ) : (
                ideas.map((idea, index) => {
                  const active = idea.id === selectedIdeaId;
                  return (
                    <button
                      key={idea.id}
                      type="button"
                      onClick={() => setSelectedIdeaId(idea.id)}
                      className={`w-full text-left rounded-[1.5rem] border p-4 transition ${
                        active
                          ? 'border-fuchsia-300 bg-fuchsia-50/80 dark:bg-fuchsia-500/10 dark:border-fuchsia-500/30 shadow-sm'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 hover:border-fuchsia-200 dark:hover:border-fuchsia-500/20'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
                            Idea {index + 1}
                          </p>
                          <h4 className="mt-1 text-sm font-black text-slate-900 dark:text-white">{idea.title}</h4>
                        </div>
                        {active && (
                          <span className="material-symbols-outlined text-fuchsia-500">check_circle</span>
                        )}
                      </div>
                      <p className="mt-3 text-sm font-bold text-slate-700 dark:text-slate-200">{idea.topic}</p>
                      <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300 leading-relaxed">
                        {idea.summary}
                      </p>
                      <p className="mt-3 text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed">
                        {idea.whyThisFits}
                      </p>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          <div className="rounded-[2rem] border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/70 shadow-xl shadow-slate-200/40 dark:shadow-black/20 overflow-hidden">
            <div className="px-6 py-5 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">Step 3. 선택 주제로 새 대본 작성</h3>
                  <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mt-1">
                    선택한 주제를 원본 영상의 길이감에 맞춰 새로운 스크립트로 확장합니다.
                  </p>
                </div>
                <button
                  onClick={handleGenerateScript}
                  disabled={!selectedIdea || generatingScript}
                  className="px-5 py-3 rounded-2xl bg-fuchsia-600 hover:bg-fuchsia-700 text-white font-bold text-sm shadow-lg shadow-fuchsia-500/20 disabled:opacity-40 transition"
                >
                  {generatingScript ? '대본 생성 중...' : '선택 주제로 대본 작성'}
                </button>
              </div>
            </div>

            <div className="p-5 space-y-4">
              {selectedIdea && (
                <div className="rounded-[1.5rem] border border-fuchsia-200 dark:border-fuchsia-500/20 bg-fuchsia-50/70 dark:bg-fuchsia-500/10 p-4">
                  <p className="text-[11px] font-black uppercase tracking-[0.18em] text-fuchsia-500">
                    Selected Topic
                  </p>
                  <h4 className="mt-2 text-base font-black text-slate-900 dark:text-white">{selectedIdea.title}</h4>
                  <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-300">{selectedIdea.summary}</p>
                </div>
              )}

              {!generatedScript ? (
                <div className="rounded-[1.75rem] border-2 border-dashed border-slate-200 dark:border-slate-800 px-6 py-12 text-center">
                  <p className="font-black text-slate-700 dark:text-slate-200">선택한 주제로 아직 생성된 대본이 없습니다.</p>
                  <p className="text-xs font-medium text-slate-400 mt-1">
                    주제 카드를 하나 고른 뒤 대본 작성 버튼을 누르면 여기에서 결과를 확인할 수 있습니다.
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-[1.5rem] border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/40 p-5">
                    <div className="flex items-center gap-2 flex-wrap text-[11px] font-black">
                      <span className="px-3 py-1 rounded-full bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-300">
                        목표 분량 {generatedScript.targetDurationGuide}
                      </span>
                    </div>
                    <h4 className="mt-3 text-lg font-black text-slate-900 dark:text-white">{generatedScript.title}</h4>
                    <p className="mt-3 text-sm font-medium text-slate-600 dark:text-slate-300 leading-relaxed">
                      {generatedScript.summary}
                    </p>
                  </div>

                  <div className="rounded-[1.5rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4">
                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-fuchsia-500 mb-1">
                        Opening Hook
                      </p>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 leading-relaxed">
                        {generatedScript.openingHook}
                      </p>
                    </div>

                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">
                        Section Outline
                      </p>
                      <div className="space-y-2">
                        {generatedScript.sectionOutline.map((item, index) => (
                          <p key={`outline_${index}`} className="text-sm font-medium text-slate-600 dark:text-slate-300">
                            {index + 1}. {item}
                          </p>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-2">
                        Full Script
                      </p>
                      <div className="rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 p-4">
                        <p className="whitespace-pre-wrap text-sm font-medium leading-7 text-slate-700 dark:text-slate-200">
                          {generatedScript.fullScript}
                        </p>
                      </div>
                    </div>

                    <div>
                      <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-400 mb-1">
                        Closing CTA
                      </p>
                      <p className="text-sm font-medium text-slate-700 dark:text-slate-200 leading-relaxed">
                        {generatedScript.closingCta}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

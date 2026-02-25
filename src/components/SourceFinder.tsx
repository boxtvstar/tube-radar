import React, { useMemo, useState } from 'react';

interface SourceFinderProps {
  apiKey: string;
}

interface MatchItem {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  duration: string;
  views: number;
  score: number;
  thumbSimilarity: number;
  matchType: string;
}

interface SourceResult {
  mode: 'url' | 'image';
  source?: {
    videoId: string;
    title: string;
    channelTitle: string;
    thumbnailUrl: string;
    duration: string;
    views: number;
  };
  query?: string;
  count: number;
  items: MatchItem[];
}

const formatViews = (value: number) => {
  if (!Number.isFinite(value)) return '-';
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}억`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)}만`;
  return value.toLocaleString();
};

export const SourceFinder: React.FC<SourceFinderProps> = ({ apiKey }) => {
  const [mode, setMode] = useState<'url' | 'image'>('url');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SourceResult | null>(null);

  const apiBase = useMemo(() => {
    const raw = (import.meta.env.VITE_BACKEND_URL || '').trim();
    if (raw) return raw.endsWith('/') ? raw.slice(0, -1) : raw;
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:4000';
    return '';
  }, []);

  const parseApiError = async (res: Response) => {
    const raw = await res.text();
    if (!raw) return '요청 처리에 실패했습니다.';
    try {
      const json = JSON.parse(raw) as { detail?: string; error?: string };
      return json.detail || json.error || raw;
    } catch {
      return raw;
    }
  };

  const runUrlSearch = async () => {
    if (!apiKey.trim()) {
      setError('마이페이지에서 YouTube API 키를 먼저 입력해주세요.');
      return;
    }
    if (!url.trim()) return;

    setLoading(true);
    setError('');
    setResult(null);
    try {
      const endpoint = `${apiBase}/api/video/source-from-url?url=${encodeURIComponent(url.trim())}&apiKey=${encodeURIComponent(apiKey)}&limit=20`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setResult(data as SourceResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : '원본 탐색에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const runImageSearch = async () => {
    if (!apiKey.trim()) {
      setError('마이페이지에서 YouTube API 키를 먼저 입력해주세요.');
      return;
    }
    if (!imageFile) {
      setError('캡처 이미지를 업로드해주세요.');
      return;
    }
    if (!query.trim()) {
      setError('키워드(채널명/주제)를 입력해주세요.');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);
    try {
      const form = new FormData();
      form.append('apiKey', apiKey);
      form.append('query', query.trim());
      form.append('limit', '20');
      form.append('image', imageFile);

      const res = await fetch(`${apiBase}/api/video/source-from-image`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) throw new Error(await parseApiError(res));
      const data = await res.json();
      setResult(data as SourceResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : '이미지 기반 탐색에 실패했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const runSearch = () => {
    if (mode === 'url') {
      void runUrlSearch();
    } else {
      void runImageSearch();
    }
  };

  return (
    <div className="w-full space-y-8 animate-in slide-in-from-right-4 duration-500 pb-20">
      <div className="space-y-2">
        <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-indigo-500 uppercase flex items-center gap-3">
          <span className="material-symbols-outlined text-2xl md:text-3xl">travel_explore</span>
          원본/동일 영상 찾기
        </h2>
        <p className="text-slate-500 text-[11px] font-medium leading-relaxed hidden md:block">
          영상 URL 또는 캡처 이미지로 원본/동일 가능성이 높은 영상을 찾아줍니다.
        </p>
      </div>

      <div className="max-w-5xl space-y-6">
        <div className="inline-flex p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
          <button
            onClick={() => setMode('url')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${mode === 'url' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-300'}`}
          >
            URL로 찾기
          </button>
          <button
            onClick={() => setMode('image')}
            className={`px-4 py-2 rounded-xl text-xs font-black transition-all ${mode === 'image' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-slate-500 dark:text-slate-300'}`}
          >
            이미지 캡처로 찾기
          </button>
        </div>

        {mode === 'url' ? (
          <div className="relative">
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && runSearch()}
              placeholder="https://www.youtube.com/watch?v=..."
              className="w-full pl-4 pr-36 py-4 bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl focus:border-indigo-500 dark:focus:border-indigo-500 outline-none text-slate-900 dark:text-white font-bold transition-all shadow-sm"
            />
            <button
              onClick={runSearch}
              disabled={loading || !url}
              className="absolute right-2 top-2 bottom-2 px-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-xl font-bold text-sm transition-all flex items-center gap-2"
            >
              {loading ? '분석 중...' : '찾기'}
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="md:col-span-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="예: fast and furious drag race"
                className="w-full px-4 py-4 bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl focus:border-indigo-500 dark:focus:border-indigo-500 outline-none text-slate-900 dark:text-white font-bold transition-all shadow-sm"
              />
            </div>
            <label className="flex items-center justify-center px-4 py-3 border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl bg-white dark:bg-slate-900 text-sm font-bold text-slate-500 dark:text-slate-300 cursor-pointer hover:border-indigo-400">
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                className="hidden"
              />
              {imageFile ? imageFile.name : '캡처 이미지 업로드'}
            </label>
            <div className="md:col-span-3">
              <button
                onClick={runSearch}
                disabled={loading || !imageFile || !query}
                className="w-full py-3.5 rounded-2xl text-sm font-black uppercase tracking-wider text-white transition-all bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800"
              >
                {loading ? '분석 중...' : '이미지로 후보 찾기'}
              </button>
            </div>
          </div>
        )}

        {error && (
          <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-xl flex items-center gap-3 text-rose-600 dark:text-rose-400 text-sm font-bold">
            <span className="material-symbols-outlined">error</span>
            {error}
          </div>
        )}

        {result && (
          <>
            {result.source && (
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 md:p-5 flex gap-4 items-start">
                <img src={result.source.thumbnailUrl} alt="source" className="w-44 aspect-video object-cover rounded-xl shadow-md" />
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-slate-400 font-bold mb-1">Source Video</p>
                  <h3 className="text-base md:text-lg font-black leading-tight text-slate-900 dark:text-white line-clamp-2 mb-1">{result.source.title}</h3>
                  <p className="text-sm text-slate-500 font-bold">{result.source.channelTitle}</p>
                  <p className="text-xs text-slate-400 font-semibold mt-1">길이 {result.source.duration} · 조회수 {formatViews(result.source.views)}</p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {result.items.map((item) => (
                <a
                  key={item.videoId}
                  href={`https://www.youtube.com/watch?v=${item.videoId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-3 space-y-2 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-lg transition-all"
                >
                  <div className="relative">
                    <img src={item.thumbnailUrl} alt={item.title} className="w-full aspect-video rounded-xl object-cover" />
                    <span className="absolute left-2 bottom-2 px-2 py-0.5 rounded bg-black/70 text-white text-[10px] font-black">{item.thumbSimilarity.toFixed(1)}%</span>
                  </div>
                  <h4 className="text-sm font-black text-slate-900 dark:text-white line-clamp-2 leading-tight">{item.title}</h4>
                  <p className="text-[11px] font-bold text-slate-500 truncate">{item.channelTitle}</p>
                  <p className="text-[10px] font-black text-indigo-500">{item.matchType}</p>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold">
                    <span>{item.duration}</span>
                    <span>{formatViews(item.views)} views</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, Math.max(0, item.score))}%` }} />
                  </div>
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

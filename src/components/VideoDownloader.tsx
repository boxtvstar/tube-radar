import React, { useMemo, useState } from 'react';

interface VideoDownloaderProps {
  apiKey: string;
  onTrackUsage?: (type: 'search' | 'list', units: number, details: string) => void;
  onPreCheckQuota?: (estimatedCost: number) => Promise<void>;
}

interface SimilarItem {
  videoId: string;
  title: string;
  channelTitle: string;
  thumbnailUrl: string;
  duration: string;
  views: number;
  score: number;
  thumbSimilarity: number;
}

interface SimilarResponse {
  source: {
    videoId: string;
    title: string;
    channelTitle: string;
    thumbnailUrl: string;
    duration: string;
    views: number;
  };
  count: number;
  items: SimilarItem[];
}

const formatViews = (value: number) => {
  if (!Number.isFinite(value)) return '-';
  if (value >= 100000000) return `${(value / 100000000).toFixed(1)}억`;
  if (value >= 10000) return `${(value / 10000).toFixed(1)}만`;
  return value.toLocaleString();
};

const SIMILAR_THUMB_QUOTA_COST = 300;

export const VideoDownloader: React.FC<VideoDownloaderProps> = ({ apiKey, onTrackUsage, onPreCheckQuota }) => {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<SimilarResponse | null>(null);
  const [selectedItem, setSelectedItem] = useState<SimilarItem | null>(null);

  const apiBase = useMemo(() => {
    const raw = (import.meta.env.VITE_BACKEND_URL || '').trim();
    if (raw) return raw.endsWith('/') ? raw.slice(0, -1) : raw;
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:4000';
    return '';
  }, []);

  const findSimilar = async () => {
    if (!url.trim()) return;
    if (!apiKey.trim()) {
      setError('마이페이지에서 YouTube API 키를 먼저 입력해주세요.');
      return;
    }

    setLoading(true);
    setError('');
    setResult(null);

    try {
      // 포인트 사전 체크 — 부족하면 API 호출 차단
      if (onPreCheckQuota) {
        await onPreCheckQuota(SIMILAR_THUMB_QUOTA_COST);
      }

      const endpoint = `${apiBase}/api/video/similar-thumbnails?url=${encodeURIComponent(url.trim())}&apiKey=${encodeURIComponent(apiKey)}&limit=20`;
      const res = await fetch(endpoint);
      const raw = await res.text();
      let data: unknown = null;
      if (raw) {
        try {
          data = JSON.parse(raw);
        } catch {
          data = null;
        }
      }

      if (!res.ok) {
        const message =
          (typeof data === 'object' && data !== null && 'detail' in data && typeof (data as { detail?: unknown }).detail === 'string')
            ? (data as { detail: string }).detail
            : raw || '유사 썸네일 검색에 실패했습니다.';
        throw new Error(message);
      }

      if (!data || typeof data !== 'object') {
        throw new Error('서버 응답 형식이 올바르지 않습니다.');
      }

      setResult(data as SimilarResponse);
      // 성공 시 300 쿼터 차감
      if (onTrackUsage) {
        onTrackUsage('list', SIMILAR_THUMB_QUOTA_COST, '유사 썸네일 검색');
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('QUOTA_INSUFFICIENT')) {
        setError('포인트가 부족합니다. 내일 오후 5시(KST)에 충전됩니다.');
      } else if (e instanceof TypeError) {
        setError('썸네일 분석 서버에 연결하지 못했습니다. 백엔드 실행 상태를 확인해주세요.');
      } else {
        setError(e instanceof Error ? e.message : '유사 썸네일 검색에 실패했습니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full space-y-8 animate-in slide-in-from-right-4 duration-500 pb-20">
      <div className="space-y-2">
        <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-indigo-500 uppercase flex items-center gap-3">
          <span className="material-symbols-outlined text-2xl md:text-3xl">image_search</span>
          Similar By Video
        </h2>
        <p className="text-slate-500 text-[11px] font-medium leading-relaxed hidden md:block">
          영상 URL을 입력하면 썸네일 유사도를 기준으로 상위 20개 영상을 찾아줍니다.
        </p>
      </div>

      <div className="max-w-4xl space-y-6">
        <div className="relative group">
          <div className="absolute inset-y-0 left-4 flex items-center text-slate-400 group-focus-within:text-indigo-500 transition-colors">
            <span className="material-symbols-outlined">link</span>
          </div>
          <input
            type="text"
            placeholder="https://www.youtube.com/watch?v=..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && findSimilar()}
            className="w-full pl-12 pr-36 py-4 bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl focus:border-indigo-500 dark:focus:border-indigo-500 outline-none text-slate-900 dark:text-white font-bold transition-all shadow-sm"
          />
          <button
            onClick={findSimilar}
            disabled={loading || !url}
            className="absolute right-2 top-2 bottom-2 px-6 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-xl font-bold text-sm transition-all flex items-center gap-2 shadow-lg shadow-indigo-500/20 active:scale-95"
          >
            {loading ? <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <span className="material-symbols-outlined text-lg">search</span>}
            찾기
          </button>
        </div>

        {error && (
          <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-xl flex items-center gap-3 text-rose-600 dark:text-rose-400 text-sm font-bold animate-in fade-in zoom-in-95">
            <span className="material-symbols-outlined">error</span>
            {error}
          </div>
        )}

        {result && (
          <>
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-4 md:p-5 flex gap-4 items-start">
              <img src={result.source.thumbnailUrl} alt="source thumbnail" className="w-44 aspect-video object-cover rounded-xl shadow-md" />
              <div className="min-w-0">
                <p className="text-[11px] uppercase tracking-wider text-slate-400 font-bold mb-1">Source Video</p>
                <h3 className="text-base md:text-lg font-black leading-tight text-slate-900 dark:text-white line-clamp-2 mb-1">{result.source.title}</h3>
                <p className="text-sm text-slate-500 font-bold">{result.source.channelTitle}</p>
                <p className="text-xs text-slate-400 font-semibold mt-1">길이 {result.source.duration} · 조회수 {formatViews(result.source.views)}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
              {result.items.map((item) => (
                <div
                  key={item.videoId}
                  onClick={() => setSelectedItem(item)}
                  className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-3 space-y-2 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-lg transition-all cursor-pointer"
                >
                  <div className="relative">
                    <img src={item.thumbnailUrl} alt={item.title} className="w-full aspect-video rounded-xl object-cover" />
                    <span className="absolute left-2 bottom-2 px-2 py-0.5 rounded bg-black/70 text-white text-[10px] font-black">{item.thumbSimilarity.toFixed(1)}%</span>
                  </div>
                  <h4 className="text-sm font-black text-slate-900 dark:text-white line-clamp-2 leading-tight">{item.title}</h4>
                  <p className="text-[11px] font-bold text-slate-500 truncate">{item.channelTitle}</p>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold">
                    <span>{item.duration}</span>
                    <span>{formatViews(item.views)} views</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.min(100, Math.max(0, item.score))}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Video Detail Modal */}
      {selectedItem && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
          onClick={() => setSelectedItem(null)}
        >
          <div
            className="bg-white dark:bg-slate-900 w-full max-w-3xl max-h-[90vh] rounded-[2rem] shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Thumbnail */}
            <div className="relative bg-black">
              <img
                src={selectedItem.thumbnailUrl}
                alt={selectedItem.title}
                className="w-full aspect-video object-cover"
              />
              <button
                onClick={() => setSelectedItem(null)}
                className="absolute top-4 right-4 size-10 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center hover:bg-black/70 transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
              <div className="absolute bottom-4 left-4 flex items-center gap-2">
                <span className="px-3 py-1.5 rounded-lg bg-indigo-500 text-white text-xs font-black shadow-lg">
                  유사도 {selectedItem.thumbSimilarity.toFixed(1)}%
                </span>
                <span className="px-3 py-1.5 rounded-lg bg-black/60 backdrop-blur-sm text-white text-xs font-bold">
                  {selectedItem.duration}
                </span>
              </div>
            </div>

            {/* Content */}
            <div className="p-6 md:p-8 space-y-5 overflow-y-auto">
              <div>
                <h2 className="text-xl md:text-2xl font-black text-slate-900 dark:text-white leading-tight mb-3">
                  {selectedItem.title}
                </h2>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold text-slate-500 dark:text-slate-400">{selectedItem.channelTitle}</span>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 text-center">
                  <span className="material-symbols-outlined text-indigo-500 text-xl mb-1 block">visibility</span>
                  <div className="text-lg font-black text-slate-900 dark:text-white">{formatViews(selectedItem.views)}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">조회수</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 text-center">
                  <span className="material-symbols-outlined text-indigo-500 text-xl mb-1 block">image_search</span>
                  <div className="text-lg font-black text-slate-900 dark:text-white">{selectedItem.thumbSimilarity.toFixed(1)}%</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">썸네일 유사도</div>
                </div>
                <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4 text-center">
                  <span className="material-symbols-outlined text-indigo-500 text-xl mb-1 block">star</span>
                  <div className="text-lg font-black text-slate-900 dark:text-white">{selectedItem.score.toFixed(1)}</div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase">종합 점수</div>
                </div>
              </div>

              {/* Similarity Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-500">
                  <span>종합 유사도</span>
                  <span className="text-indigo-500">{Math.min(100, Math.max(0, selectedItem.score)).toFixed(1)}%</span>
                </div>
                <div className="h-2.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full transition-all" style={{ width: `${Math.min(100, Math.max(0, selectedItem.score))}%` }} />
                </div>
              </div>

              {/* Source Comparison */}
              {result && (
                <div className="bg-slate-50 dark:bg-slate-800/30 rounded-xl p-4 border border-slate-100 dark:border-slate-800">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-3">원본 영상과 비교</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-slate-400">원본</p>
                      <img src={result.source.thumbnailUrl} alt="source" className="w-full aspect-video rounded-lg object-cover" />
                      <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 line-clamp-1">{result.source.title}</p>
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-indigo-500">유사 영상</p>
                      <img src={selectedItem.thumbnailUrl} alt="similar" className="w-full aspect-video rounded-lg object-cover" />
                      <p className="text-[11px] font-bold text-slate-600 dark:text-slate-300 line-clamp-1">{selectedItem.title}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Button */}
              <a
                href={`https://www.youtube.com/watch?v=${selectedItem.videoId}`}
                target="_blank"
                rel="noreferrer"
                className="w-full bg-rose-500 hover:bg-rose-600 text-white py-3.5 rounded-xl text-sm font-black flex items-center justify-center gap-2 shadow-lg shadow-rose-500/20 transition-all active:scale-[0.98]"
              >
                <span className="material-symbols-outlined text-lg">play_arrow</span>
                YouTube에서 보기
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

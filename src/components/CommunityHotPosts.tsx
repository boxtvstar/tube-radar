import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';

interface PreviewData {
  description: string;
  image: string;
}

interface CommunityPost {
  rank: number;
  title: string;
  url: string;
  source: string;
  source_id: string;
  category: string;
  view_count: number;
  comment_count: number;
  timestamp: string | null;
}

interface HotPostsResponse {
  posts: CommunityPost[];
  cached: boolean;
  updated_at: string;
}

const CACHE_KEY = 'tuberadar_community_hot_posts';
const CACHE_TTL = 3600 * 1000; // 1 hour in ms

const SOURCES = [
  { id: 'all', label: '전체' },
  { id: 'dcinside', label: '디시인사이드' },
  { id: 'ruliweb', label: '루리웹' },
  { id: 'theqoo', label: '더쿠' },
  { id: 'arca_live', label: '아카라이브' },
  { id: 'inven', label: '인벤' },
  { id: 'ppomppu', label: '뽐뿌' },
  { id: 'mlbpark', label: '엠팍' },
  { id: 'clien', label: '클리앙' },
  { id: 'nate_pann', label: '네이트 판' },
  { id: 'bobaedream', label: '보배드림' },
  { id: 'etoland', label: '이토랜드' },
  { id: 'humoruniv', label: '웃긴대학' },
  { id: '82cook', label: '82쿡' },
  { id: 'slrclub', label: 'SLR클럽' },
  { id: 'gasengi', label: '가생이' },
  { id: 'todayhumor', label: '오늘의유머' },
] as const;

const SOURCE_COLORS: Record<string, string> = {
  dcinside: 'bg-blue-500',
  ruliweb: 'bg-indigo-500',
  theqoo: 'bg-pink-500',
  arca_live: 'bg-teal-500',
  inven: 'bg-green-500',
  ppomppu: 'bg-orange-500',
  mlbpark: 'bg-red-500',
  clien: 'bg-emerald-500',
  nate_pann: 'bg-purple-500',
  bobaedream: 'bg-cyan-600',
  etoland: 'bg-amber-600',
  humoruniv: 'bg-yellow-500',
  '82cook': 'bg-rose-400',
  slrclub: 'bg-gray-600',
  gasengi: 'bg-stone-500',
  todayhumor: 'bg-fuchsia-500',
};

const formatNumber = (num: number) => {
  if (!num) return '-';
  if (num >= 10000) return `${(num / 10000).toFixed(1)}만`;
  return num.toLocaleString();
};

const formatTime = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

interface CommunityHotPostsProps {
  onTrackUsage?: (units: number, details: string) => Promise<void>;
  onPreCheckQuota?: (cost: number) => Promise<void>;
}

export const CommunityHotPosts: React.FC<CommunityHotPostsProps> = ({ onTrackUsage, onPreCheckQuota }) => {
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [selectedSource, setSelectedSource] = useState('all');
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  // Preview tooltip state
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPos, setPreviewPos] = useState({ x: 0, y: 0 });
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewCache = useRef<Record<string, PreviewData>>({});

  const apiBase = useMemo(() => {
    const raw = (import.meta.env.VITE_BACKEND_URL || '').trim();
    if (raw) return raw.endsWith('/') ? raw.slice(0, -1) : raw;
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return 'http://127.0.0.1:4000';
    return '';
  }, []);

  const loadFromCache = useCallback(() => {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const cached = JSON.parse(raw) as { data: HotPostsResponse; savedAt: number };
      if (Date.now() - cached.savedAt > CACHE_TTL) return false;
      setPosts(cached.data.posts || []);
      setUpdatedAt(cached.data.updated_at || '');
      return true;
    } catch {
      return false;
    }
  }, []);

  const fetchPosts = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    try {
      const url = `${apiBase}/api/community/hot-posts${force ? '?force=true' : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        let msg = '데이터를 불러오지 못했습니다.';
        try {
          const json = JSON.parse(text);
          msg = json.detail || json.error || msg;
        } catch { /* use default */ }
        throw new Error(msg);
      }
      const data: HotPostsResponse = await res.json();
      setPosts(data.posts || []);
      setUpdatedAt(data.updated_at || '');
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }));
    } catch (e: any) {
      setError(e.message || '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    const hasCached = loadFromCache();
    if (!hasCached) {
      fetchPosts();
    }
    // Auto-refresh every hour
    const interval = setInterval(() => fetchPosts(), CACHE_TTL);
    return () => clearInterval(interval);
  }, [loadFromCache, fetchPosts]);

  const filteredPosts = useMemo(() => {
    if (selectedSource === 'all') return posts;
    return posts.filter(p => p.source_id === selectedSource);
  }, [posts, selectedSource]);

  const handleMouseEnter = useCallback((e: React.MouseEvent, url: string) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPreviewPos({ x: rect.left + rect.width / 2, y: rect.top });

    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      setPreviewUrl(url);

      // Use cache if available
      if (previewCache.current[url]) {
        setPreviewData(previewCache.current[url]);
        return;
      }

      setPreviewLoading(true);
      setPreviewData(null);
      try {
        const res = await fetch(`${apiBase}/api/preview?url=${encodeURIComponent(url)}`);
        if (res.ok) {
          const data: PreviewData = await res.json();
          previewCache.current[url] = data;
          setPreviewData(data);
        }
      } catch { /* ignore */ } finally {
        setPreviewLoading(false);
      }
    }, 400);
  }, [apiBase]);

  const handleMouseLeave = useCallback(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    setPreviewUrl(null);
    setPreviewData(null);
    setPreviewLoading(false);
  }, []);

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div className="flex items-center gap-2 md:gap-3">
          <span className="material-symbols-outlined text-2xl md:text-3xl text-orange-500">local_fire_department</span>
          <div>
            <h1 className="text-lg md:text-2xl font-black text-slate-900 dark:text-white tracking-tight">커뮤니티 핫게시글</h1>
            <p className="text-[11px] md:text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              {updatedAt ? `마지막 갱신: ${formatTime(updatedAt)}` : '데이터 로딩 중...'}
            </p>
          </div>
        </div>
        <button
          onClick={async () => {
            try {
              if (onPreCheckQuota) await onPreCheckQuota(200);
            } catch (e: any) {
              if (e.message?.startsWith('QUOTA_INSUFFICIENT')) {
                setError('포인트가 부족합니다. (새로고침 1회 = 200포인트)');
                return;
              }
            }
            await fetchPosts(true);
            if (onTrackUsage) await onTrackUsage(200, '커뮤니티 핫게시글 새로고침');
          }}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded-xl bg-orange-50 dark:bg-orange-500/10 text-orange-600 dark:text-orange-400 text-xs font-bold hover:bg-orange-100 dark:hover:bg-orange-500/20 transition-all disabled:opacity-50 border border-orange-200 dark:border-orange-500/30"
        >
          <span className={`material-symbols-outlined text-sm ${loading ? 'animate-spin' : ''}`}>refresh</span>
          <span className="hidden sm:inline">새로고침</span>
        </button>
      </div>

      {/* Source Filter */}
      <div className="flex flex-wrap gap-1.5 md:gap-2 mb-4 md:mb-6">
        {SOURCES.map(src => (
          <button
            key={src.id}
            onClick={() => setSelectedSource(src.id)}
            className={`px-2.5 md:px-4 py-1.5 md:py-2 rounded-lg md:rounded-xl text-xs md:text-sm font-bold transition-all ${
              selectedSource === src.id
                ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                : 'bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700'
            }`}
          >
            {src.label}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 flex items-center gap-3">
          <span className="material-symbols-outlined text-rose-500">error</span>
          <p className="text-sm text-rose-600 dark:text-rose-400 font-medium">{error}</p>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && posts.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-14 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </div>
      )}

      {/* Posts List */}
      {filteredPosts.length > 0 && (
        <div className="space-y-1">
          {filteredPosts.map((post, idx) => (
            <a
              key={`${post.source_id}-${post.rank}-${idx}`}
              href={post.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group flex items-center gap-2 md:gap-3 px-2.5 md:px-4 py-2.5 md:py-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-all border border-transparent hover:border-slate-200 dark:hover:border-slate-700"
              onMouseEnter={(e) => handleMouseEnter(e, post.url)}
              onMouseLeave={handleMouseLeave}
            >
              {/* Rank */}
              <span className={`w-7 text-center text-sm font-black shrink-0 ${
                idx < 3 ? 'text-orange-500' : 'text-slate-300 dark:text-slate-600'
              }`}>
                {idx + 1}
              </span>

              {/* Source Badge */}
              <span className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-bold text-white ${SOURCE_COLORS[post.source_id] || 'bg-slate-500'}`}>
                {post.source}
              </span>

              {/* Title */}
              <span className="flex-1 text-sm text-slate-700 dark:text-slate-200 font-medium truncate group-hover:text-orange-600 dark:group-hover:text-orange-400 transition-colors">
                {post.title}
              </span>

              {/* Stats */}
              <div className="hidden sm:flex items-center gap-3 shrink-0 text-[11px] text-slate-400 dark:text-slate-500">
                {post.view_count > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-[13px]">visibility</span>
                    {formatNumber(post.view_count)}
                  </span>
                )}
                {post.comment_count > 0 && (
                  <span className="flex items-center gap-0.5">
                    <span className="material-symbols-outlined text-[13px]">chat_bubble</span>
                    {formatNumber(post.comment_count)}
                  </span>
                )}
              </div>

              {/* Copy URL */}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigator.clipboard.writeText(post.url);
                  setCopiedUrl(post.url);
                  setTimeout(() => setCopiedUrl(null), 1500);
                }}
                className="shrink-0 p-1 rounded-md text-slate-300 dark:text-slate-600 hover:text-orange-500 hover:bg-orange-50 dark:hover:bg-orange-500/10 transition-all"
                title="주소 복사"
              >
                <span className="material-symbols-outlined text-sm">
                  {copiedUrl === post.url ? 'check' : 'content_copy'}
                </span>
              </button>

              {/* External link icon */}
              <span className="material-symbols-outlined text-sm text-slate-300 dark:text-slate-600 group-hover:text-orange-500 transition-colors shrink-0">
                open_in_new
              </span>
            </a>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredPosts.length === 0 && posts.length > 0 && (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600">filter_list_off</span>
          <p className="mt-3 text-sm font-bold text-slate-400 dark:text-slate-500">선택한 필터에 맞는 게시글이 없습니다</p>
          <button
            onClick={() => setSelectedSource('all')}
            className="mt-2 text-xs text-orange-500 hover:text-orange-600 font-bold"
          >
            필터 초기화
          </button>
        </div>
      )}

      {!loading && posts.length === 0 && !error && (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600">local_fire_department</span>
          <p className="mt-3 text-sm font-bold text-slate-400 dark:text-slate-500">핫게시글을 불러오는 중...</p>
        </div>
      )}

      {/* Preview Tooltip */}
      {previewUrl && (previewLoading || previewData) && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{
            left: Math.min(previewPos.x, window.innerWidth - 340),
            top: Math.max(previewPos.y - 8, 8),
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="w-[320px] bg-white dark:bg-slate-800 rounded-xl shadow-2xl shadow-black/20 border border-slate-200 dark:border-slate-700 overflow-hidden">
            {previewLoading && !previewData && (
              <div className="p-4 flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
                <span className="text-xs text-slate-400">미리보기 로딩 중...</span>
              </div>
            )}
            {previewData && (
              <>
                {previewData.image && (
                  <img
                    src={previewData.image}
                    alt=""
                    className="w-full h-40 object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                )}
                {previewData.description ? (
                  <p className="p-3 text-xs text-slate-600 dark:text-slate-300 leading-relaxed line-clamp-4">
                    {previewData.description}
                  </p>
                ) : !previewData.image ? (
                  <p className="p-3 text-xs text-slate-400">미리보기를 불러올 수 없습니다</p>
                ) : null}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

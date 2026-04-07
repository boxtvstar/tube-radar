import React, { useState, useEffect, useMemo, useCallback } from 'react';

interface ShortsTrack {
  rank: number;
  name: string;
  artist: string;
  thumbnail: string;
  videoId: string;
}

interface ShortsVideo {
  videoId: string;
  title: string;
  thumbnail: string;
}

interface ShortsMusicResponse {
  tracks: ShortsTrack[];
  cached: boolean;
  updated_at: string;
}

const CACHE_KEY = 'tuberadar_shorts_music';
const CACHE_TTL = 7200 * 1000;

const formatTime = (dateStr: string) => {
  const d = new Date(dateStr);
  return d.toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

// 아티스트 기반 간단 카테고리 분류
const GENRE_KEYWORDS: Record<string, string[]> = {
  'idol': [
    'BTS', '방탄소년단', 'IVE', '아이브', 'BLACKPINK', 'Hearts2Hearts', 'ITZY',
    'ILLIT', '아일릿', '엔믹스', 'NMIXX', '르세라핌', 'LE SSERAFIM', 'DAY6', '데이식스',
    'YENA', '최예나', 'KiiiKiii', '키키', 'aespa', 'STRAY KIDS', 'NCT', 'SEVENTEEN',
    'TWICE', 'NewJeans', 'TREASURE', 'ENHYPEN', 'TXT', 'ATEEZ', 'VIVIZ',
    'WOODZ', 'BOBBY', '화사', 'SUNWOO',
  ],
  'ballad': [
    '한로로', '10CM', '이찬혁', '다비치', '오반', '임현정', '이무진', '이승철',
    'Woody', '볼빨간사춘기',
  ],
  'hiphop': [
    'Crush', '에픽하이', 'EPIK HIGH', 'HAON', '하온', '김하온', '하모', '지코', 'ZICO',
    'Dok2', '사이먼 도미닉', 'pH-1', '창모', 'CHANGMO',
  ],
  'jpop': [
    'Kenshi Yonezu', '켄시 요네즈', '米津', 'Hikaru Utada', '우타다 히카루',
    'OFFICIAL HIGE DANDISM', 'YOASOBI', 'Ado', 'Fujii Kaze',
  ],
};

const CATEGORIES = [
  { id: 'all', label: '전체' },
  { id: 'idol', label: '아이돌' },
  { id: 'ballad', label: '발라드' },
  { id: 'hiphop', label: '힙합/R&B' },
  { id: 'jpop', label: 'J-Pop/해외' },
  { id: 'etc', label: '기타' },
];

function getGenre(artist: string): string {
  const lower = artist.toLowerCase();
  for (const [genre, keywords] of Object.entries(GENRE_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw.toLowerCase()))) return genre;
  }
  return 'etc';
}

interface ShortsTrendingMusicProps {
  onTrackUsage?: (units: number, details: string) => Promise<void>;
  onPreCheckQuota?: (cost: number) => Promise<void>;
}

export const ShortsTrendingMusic: React.FC<ShortsTrendingMusicProps> = ({ onTrackUsage, onPreCheckQuota }) => {
  const [tracks, setTracks] = useState<ShortsTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [relatedShorts, setRelatedShorts] = useState<ShortsVideo[]>([]);
  const [shortsLoading, setShortsLoading] = useState(false);

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
      const cached = JSON.parse(raw) as { data: ShortsMusicResponse; savedAt: number };
      if (Date.now() - cached.savedAt > CACHE_TTL) return false;
      setTracks(cached.data.tracks || []);
      setUpdatedAt(cached.data.updated_at || '');
      return true;
    } catch { return false; }
  }, []);

  const fetchTracks = useCallback(async (force = false) => {
    setLoading(true);
    setError('');
    try {
      const url = `${apiBase}/api/shorts-music${force ? '?force=true' : ''}`;
      const res = await fetch(url);
      if (!res.ok) {
        const text = await res.text();
        let msg = '데이터를 불러오지 못했습니다.';
        try { const j = JSON.parse(text); msg = j.detail || j.error || msg; } catch {}
        throw new Error(msg);
      }
      const data: ShortsMusicResponse = await res.json();
      setTracks(data.tracks || []);
      setUpdatedAt(data.updated_at || '');
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }));
    } catch (e: any) {
      setError(e.message || '알 수 없는 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, [apiBase]);

  useEffect(() => {
    if (!loadFromCache()) fetchTracks();
    const interval = setInterval(() => fetchTracks(), CACHE_TTL);
    return () => clearInterval(interval);
  }, [loadFromCache, fetchTracks]);

  const filteredTracks = useMemo(() => {
    if (selectedCategory === 'all') return tracks;
    return tracks.filter(t => getGenre(t.artist) === selectedCategory);
  }, [tracks, selectedCategory]);

  const fetchRelatedShorts = useCallback(async (track: ShortsTrack) => {
    setShortsLoading(true);
    setRelatedShorts([]);
    try {
      const q = encodeURIComponent(`${track.name} ${track.artist}`);
      const res = await fetch(`${apiBase}/api/shorts-music?q=${q}`);
      if (res.ok) {
        const data = await res.json();
        setRelatedShorts(data.videos || []);
      }
    } catch { /* ignore */ } finally {
      setShortsLoading(false);
    }
  }, [apiBase]);

  const handleTrackClick = (idx: number) => {
    if (expandedIdx === idx) {
      setExpandedIdx(null);
      setRelatedShorts([]);
    } else {
      setExpandedIdx(idx);
      fetchRelatedShorts(filteredTracks[idx]);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div className="flex items-center gap-2 md:gap-3">
          <span className="material-symbols-outlined text-2xl md:text-3xl text-violet-500">music_note</span>
          <div>
            <h1 className="text-lg md:text-2xl font-black text-slate-900 dark:text-white tracking-tight">쇼츠 인기 음악</h1>
            <p className="text-[11px] md:text-xs text-slate-400 dark:text-slate-500 mt-0.5">
              {updatedAt ? `마지막 갱신: ${formatTime(updatedAt)}` : '데이터 로딩 중...'}
              {' · '}주간 Top 50
            </p>
          </div>
        </div>
        <button
          onClick={async () => {
            try { if (onPreCheckQuota) await onPreCheckQuota(200); }
            catch (e: any) {
              if (e.message?.startsWith('QUOTA_INSUFFICIENT')) { setError('포인트가 부족합니다. (새로고침 1회 = 200포인트)'); return; }
            }
            await fetchTracks(true);
            if (onTrackUsage) await onTrackUsage(200, '쇼츠 인기 음악 새로고침');
          }}
          disabled={loading}
          className="flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded-xl bg-violet-50 dark:bg-violet-500/10 text-violet-600 dark:text-violet-400 text-xs font-bold hover:bg-violet-100 dark:hover:bg-violet-500/20 transition-all disabled:opacity-50 border border-violet-200 dark:border-violet-500/30"
        >
          <span className={`material-symbols-outlined text-sm ${loading ? 'animate-spin' : ''}`}>refresh</span>
          <span className="hidden sm:inline">새로고침</span>
        </button>
      </div>

      {/* Category Filter */}
      <div className="flex flex-wrap gap-1.5 md:gap-2 mb-4 md:mb-6">
        {CATEGORIES.map(cat => (
          <button
            key={cat.id}
            onClick={() => { setSelectedCategory(cat.id); setExpandedIdx(null); }}
            className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg md:rounded-xl text-xs md:text-sm font-bold transition-all ${
              selectedCategory === cat.id
                ? 'bg-violet-600 text-white shadow-sm'
                : 'bg-slate-50 dark:bg-slate-800/50 text-slate-400 dark:text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700'
            }`}
          >
            {cat.label}
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
      {loading && tracks.length === 0 && (
        <div className="space-y-2">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-slate-100 dark:bg-slate-800 animate-pulse" />
          ))}
        </div>
      )}

      {/* Tracks List */}
      {filteredTracks.length > 0 && (
        <div className="space-y-1">
          {filteredTracks.map((track, idx) => (
            <div key={`${track.rank}-${track.videoId || idx}`}>
              {/* Track row */}
              <div
                className={`group flex items-center gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer border ${
                  expandedIdx === idx
                    ? 'bg-violet-50 dark:bg-violet-500/10 border-violet-200 dark:border-violet-500/30'
                    : 'border-transparent hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-slate-200 dark:hover:border-slate-700'
                }`}
                onClick={() => handleTrackClick(idx)}
              >
                {/* Rank */}
                <span className={`w-7 text-center text-sm font-black shrink-0 ${
                  track.rank <= 3 ? 'text-violet-500' : track.rank <= 10 ? 'text-slate-500 dark:text-slate-400' : 'text-slate-300 dark:text-slate-600'
                }`}>
                  {track.rank}
                </span>

                {/* Thumbnail */}
                {track.thumbnail ? (
                  <img src={track.thumbnail} alt={track.name}
                    className="w-10 h-10 rounded-lg object-cover shrink-0 bg-slate-200 dark:bg-slate-700"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-violet-100 dark:bg-violet-500/20 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-violet-400 text-lg">music_note</span>
                  </div>
                )}

                {/* Track Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                    {track.name}
                  </p>
                  {track.artist && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 truncate">{track.artist}</p>
                  )}
                </div>

                {/* Expand indicator */}
                <span className={`material-symbols-outlined text-sm text-slate-300 dark:text-slate-600 transition-transform ${expandedIdx === idx ? 'rotate-180 text-violet-500' : ''}`}>
                  expand_more
                </span>
              </div>

              {/* Expanded: Related Shorts */}
              {expandedIdx === idx && (
                <div className="ml-2 mr-2 md:ml-11 md:mr-4 mt-1 mb-3 p-3 md:p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      <span className="material-symbols-outlined text-[13px] align-middle mr-1">play_circle</span>
                      이 음악을 사용한 쇼츠
                    </p>
                    <a
                      href={`https://www.youtube.com/results?search_query=${encodeURIComponent(track.name + ' ' + track.artist + ' shorts')}&sp=EgIYAQ%3D%3D`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-violet-500 hover:text-violet-600 font-bold flex items-center gap-0.5"
                      onClick={(e) => e.stopPropagation()}
                    >
                      YouTube에서 더보기
                      <span className="material-symbols-outlined text-[12px]">open_in_new</span>
                    </a>
                  </div>

                  {shortsLoading && (
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className={`aspect-[9/16] rounded-lg bg-slate-200 dark:bg-slate-700 animate-pulse ${i >= 3 ? 'hidden md:block' : ''}`} />
                      ))}
                    </div>
                  )}

                  {!shortsLoading && relatedShorts.length > 0 && (
                    <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
                      {relatedShorts.slice(0, 10).map((short) => (
                        <a
                          key={short.videoId}
                          href={`https://www.youtube.com/shorts/${short.videoId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="group/short relative aspect-[9/16] rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-700 hover:ring-2 hover:ring-violet-400 transition-all"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <img
                            src={short.thumbnail}
                            alt={short.title}
                            className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).src = `https://i.ytimg.com/vi/${short.videoId}/default.jpg`; }}
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover/short:opacity-100 transition-opacity flex items-end p-1.5">
                            <p className="text-[9px] text-white font-medium line-clamp-2 leading-tight">{short.title}</p>
                          </div>
                          <div className="absolute top-1 right-1 bg-black/50 rounded px-1 py-0.5">
                            <span className="material-symbols-outlined text-white text-[10px]">play_arrow</span>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}

                  {!shortsLoading && relatedShorts.length === 0 && (
                    <div className="text-center py-6">
                      <p className="text-xs text-slate-400">관련 쇼츠를 찾지 못했습니다</p>
                      <a
                        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(track.name + ' ' + track.artist + ' shorts')}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-violet-500 hover:text-violet-600 font-bold mt-1 inline-block"
                        onClick={(e) => e.stopPropagation()}
                      >
                        YouTube에서 직접 검색
                      </a>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredTracks.length === 0 && tracks.length > 0 && (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600">filter_list_off</span>
          <p className="mt-3 text-sm font-bold text-slate-400 dark:text-slate-500">선택한 카테고리에 맞는 음악이 없습니다</p>
          <button onClick={() => setSelectedCategory('all')} className="mt-2 text-xs text-violet-500 hover:text-violet-600 font-bold">
            필터 초기화
          </button>
        </div>
      )}

      {!loading && tracks.length === 0 && !error && (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600">music_note</span>
          <p className="mt-3 text-sm font-bold text-slate-400 dark:text-slate-500">인기 음악을 불러오는 중...</p>
        </div>
      )}
    </div>
  );
};

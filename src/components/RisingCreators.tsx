import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { SavedChannel, ChannelGroup } from '../../types';

const CACHE_KEY = 'tuberadar_rising_channels';
const DAILY_KEY = 'tuberadar_rising_daily'; // 오늘 추가된 채널 수 추적
const MAX_DAILY_ADD = 10;
const MAX_TOTAL_CHANNELS = 100;

interface RisingChannel {
  id: string;
  title: string;
  thumbnail: string;
  subscriberCount: number;
  videoCount: number;
  totalViews: number;
  avgViews: number;
  joinDate: string;
  country?: string;
  addedAt?: number; // 프론트에서 추가된 시점 (timestamp)
  topVideos: {
    videoId: string;
    title: string;
    thumbnail: string;
    views: number;
    publishedAt: string;
  }[];
}

const formatNumber = (num: number) => {
  if (num >= 100000000) return (num / 100000000).toFixed(1) + '억';
  if (num >= 10000) return (num / 10000).toFixed(1) + '만';
  return num.toLocaleString();
};

/** 오늘 날짜 문자열 (YYYY-MM-DD) */
const todayStr = () => new Date().toISOString().slice(0, 10);

/** 오늘 추가된 채널 수 가져오기 */
const getDailyCount = (): { date: string; count: number } => {
  try {
    const raw = localStorage.getItem(DAILY_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.date === todayStr()) return parsed;
    }
  } catch { /* ignore */ }
  return { date: todayStr(), count: 0 };
};

/** 오늘 추가된 채널 수 업데이트 */
const setDailyCount = (count: number) => {
  try {
    localStorage.setItem(DAILY_KEY, JSON.stringify({ date: todayStr(), count }));
  } catch { /* ignore */ }
};

/** 캐시에서 기존 채널 로드 */
const loadCachedChannels = (): RisingChannel[] => {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const { data } = JSON.parse(raw);
      if (Array.isArray(data)) return data;
    }
  } catch {
    localStorage.removeItem(CACHE_KEY);
  }
  return [];
};

/** 캐시 저장 */
const saveCachedChannels = (channels: RisingChannel[]) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ data: channels, timestamp: Date.now() }));
  } catch {
    // localStorage 꽉 차면 오래된 캐시 정리 후 재시도
    try {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('tuberadar_') || k.startsWith('yt_'));
      keys.sort();
      for (let i = 0; i < Math.ceil(keys.length / 2); i++) {
        if (keys[i] !== CACHE_KEY && keys[i] !== DAILY_KEY) {
          localStorage.removeItem(keys[i]);
        }
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data: channels, timestamp: Date.now() }));
    } catch { /* give up */ }
  }
};

/** 서버에서 받은 채널을 기존 목록에 merge (하루 최대 10개 추가) */
const mergeChannels = (existing: RisingChannel[], newChannels: RisingChannel[]): RisingChannel[] => {
  const existingIds = new Set(existing.map(ch => ch.id));
  const daily = getDailyCount();
  let addedToday = daily.count;

  const merged = [...existing];

  for (const ch of newChannels) {
    if (existingIds.has(ch.id)) {
      // 이미 있으면 통계만 업데이트 (addedAt은 유지)
      const idx = merged.findIndex(c => c.id === ch.id);
      if (idx >= 0) merged[idx] = { ...ch, addedAt: merged[idx].addedAt };
    } else if (addedToday < MAX_DAILY_ADD) {
      merged.push({ ...ch, addedAt: Date.now() });
      existingIds.add(ch.id);
      addedToday++;
    }
  }

  setDailyCount(addedToday);

  // 신규 추가순 정렬 (최근 추가된 채널이 위)
  merged.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

  // 최대 100개 유지 — 넘으면 오래된 것부터 삭제
  if (merged.length > MAX_TOTAL_CHANNELS) {
    merged.length = MAX_TOTAL_CHANNELS;
  }

  return merged;
};

interface RisingCreatorsProps {
  apiKey?: string;
  groups?: ChannelGroup[];
  savedChannels?: SavedChannel[];
  onAddToMonitoring?: (channel: SavedChannel) => void;
  isAdmin?: boolean;
}

export const RisingCreators: React.FC<RisingCreatorsProps> = ({ apiKey, groups, savedChannels: monitoringChannels, onAddToMonitoring, isAdmin }) => {
  const [channels, setChannels] = useState<RisingChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [groupMenuOpenId, setGroupMenuOpenId] = useState<string | null>(null);
  const groupMenuRef = useRef<HTMLDivElement>(null);

  // 그룹 드롭다운 외부 클릭 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (groupMenuRef.current && !groupMenuRef.current.contains(e.target as Node)) {
        setGroupMenuOpenId(null);
      }
    };
    if (groupMenuOpenId) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [groupMenuOpenId]);

  const isAlreadyMonitored = (channelId: string) =>
    monitoringChannels?.some(c => c.id === channelId) ?? false;

  const handleAddToList = (ch: RisingChannel, groupId: string) => {
    if (!onAddToMonitoring) return;
    const saved: SavedChannel = {
      id: ch.id,
      title: ch.title,
      thumbnail: ch.thumbnail,
      subscriberCount: String(ch.subscriberCount),
      videoCount: String(ch.videoCount),
      totalViews: String(ch.totalViews),
      joinDate: ch.joinDate,
      country: ch.country,
      groupId,
      addedAt: Date.now(),
    };
    onAddToMonitoring(saved);
    setGroupMenuOpenId(null);
  };

  // 사용 가능한 그룹 (all 제외)
  const availableGroups = (groups ?? []).filter(g => g.id !== 'all');

  const loadFromCache = useCallback(() => {
    const cached = loadCachedChannels();
    if (cached.length > 0) {
      setChannels(cached);
      try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (raw) {
          const { timestamp } = JSON.parse(raw);
          setLastUpdated(new Date(timestamp).toLocaleString('ko-KR'));
        }
      } catch { /* ignore */ }
      return true;
    }
    return false;
  }, []);

  const fetchData = useCallback(async (force = false) => {
    setLoading(true);
    setError('');

    try {
      const params = new URLSearchParams();
      if (force) params.set('force', 'true');
      if (apiKey) params.set('apiKey', apiKey);
      const url = '/api/rising-channels' + (params.toString() ? '?' + params.toString() : '');
      const res = await fetch(url);
      if (!res.ok) throw new Error(`서버 오류 (${res.status})`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const serverChannels: RisingChannel[] = data.channels || [];
      const existing = loadCachedChannels();
      const merged = mergeChannels(existing, serverChannels);

      setChannels(merged);
      saveCachedChannels(merged);
      setLastUpdated(new Date().toLocaleString('ko-KR'));
    } catch (e: any) {
      setError(e.message || '데이터를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const hasCached = loadFromCache();
    // 캐시가 있어도 서버에서 새 데이터 확인 (merge됨)
    fetchData(false);
  }, []);

  const daily = getDailyCount();

  return (
    <div className="w-full max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="material-symbols-outlined text-2xl text-emerald-500">search</span>
            <h2 className="text-xl font-black text-slate-900 dark:text-white">채널 신규 발굴</h2>
            {isAdmin && (
              <button
                onClick={() => fetchData(true)}
                disabled={loading}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-all disabled:opacity-50 border border-emerald-200 dark:border-emerald-500/30"
              >
                <span className={`material-symbols-outlined text-sm ${loading ? 'animate-spin' : ''}`}>refresh</span>
                새로고침
              </button>
            )}
          </div>
          <p className="text-[11px] md:text-xs text-slate-500 dark:text-slate-400 font-medium">
            1년 이내 · 영상 ≤ 100 · 평균 조회수 ≥ 50만
            <span className="hidden sm:inline ml-2 text-slate-400">· 하루 최대 {MAX_DAILY_ADD}개 추가 (오늘 {daily.count}개)</span>
            {lastUpdated && <span className="hidden sm:inline ml-2 text-slate-400">· {lastUpdated}</span>}
          </p>
          <p className="sm:hidden text-[10px] text-slate-400 mt-0.5">
            하루 최대 {MAX_DAILY_ADD}개 (오늘 {daily.count}개){lastUpdated && ` · ${lastUpdated}`}
          </p>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-3 bg-rose-50 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/30 rounded-xl text-rose-600 dark:text-rose-400 text-xs font-medium flex items-center gap-2">
          <span className="material-symbols-outlined text-sm">error</span>
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="mb-6 p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-sm text-emerald-500 animate-spin">progress_activity</span>
            <span className="text-xs font-bold text-emerald-700 dark:text-emerald-400">서버에서 데이터를 불러오는 중...</span>
          </div>
        </div>
      )}

      {/* Results */}
      {channels.length > 0 && (
        <div className="space-y-4">
          {channels.map((ch, idx) => (
            <div
              key={ch.id}
              className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700/50 rounded-2xl p-4 md:p-5 hover:shadow-lg hover:border-emerald-300 dark:hover:border-emerald-500/30 transition-all"
            >
              {/* Channel Info */}
              <div className="flex items-start gap-3 md:gap-4 mb-3 md:mb-4">
                <div className="shrink-0">
                  <img
                    src={ch.thumbnail}
                    alt={ch.title}
                    className="w-11 h-11 md:w-14 md:h-14 rounded-full object-cover border-2 border-emerald-200 dark:border-emerald-500/30"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <a
                    href={`https://www.youtube.com/channel/${ch.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-black text-slate-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors truncate block"
                  >
                    {ch.title}
                  </a>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    개설일: {new Date(ch.joinDate).toLocaleDateString('ko-KR')}
                    {ch.country && <span className="ml-1.5">· {ch.country}</span>}
                  </p>
                </div>
                {/* 데스크톱: 리스트 추가 버튼 */}
                {onAddToMonitoring && (
                  <div className="hidden md:block relative shrink-0" ref={groupMenuOpenId === ch.id ? groupMenuRef : undefined}>
                    {isAlreadyMonitored(ch.id) ? (
                      <div className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 dark:bg-slate-700/50 rounded-lg cursor-default">
                        <span className="material-symbols-outlined text-sm text-slate-400">check_circle</span>
                        <span className="text-[10px] font-bold text-slate-400">추가됨</span>
                      </div>
                    ) : (
                      <button
                        onClick={() => setGroupMenuOpenId(groupMenuOpenId === ch.id ? null : ch.id)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-pink-50 dark:bg-pink-500/10 hover:bg-pink-100 dark:hover:bg-pink-500/20 rounded-lg transition-colors"
                      >
                        <span className="material-symbols-outlined text-sm text-pink-500">add_circle</span>
                        <span className="text-[10px] font-bold text-pink-600 dark:text-pink-400">리스트 추가</span>
                      </button>
                    )}
                    {groupMenuOpenId === ch.id && !isAlreadyMonitored(ch.id) && (
                      <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 min-w-[160px]">
                        <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase">그룹 선택</div>
                        {availableGroups.map(g => (
                          <button
                            key={g.id}
                            onClick={() => handleAddToList(ch, g.id)}
                            className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-pink-50 dark:hover:bg-pink-500/10 transition-colors flex items-center gap-2"
                          >
                            <span className="material-symbols-outlined text-sm text-slate-400">folder</span>
                            {g.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Stats badges — 모바일 2x2 그리드, 데스크톱 가로 나열 */}
              <div className="grid grid-cols-2 md:flex md:items-center gap-2 mb-3 md:mb-4">
                <div className="text-center px-3 py-1.5 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg">
                  <div className="text-[10px] text-emerald-600 dark:text-emerald-400 font-bold">구독자</div>
                  <div className="text-xs font-black text-emerald-700 dark:text-emerald-300">{formatNumber(ch.subscriberCount)}</div>
                </div>
                <div className="text-center px-3 py-1.5 bg-blue-50 dark:bg-blue-500/10 rounded-lg">
                  <div className="text-[10px] text-blue-600 dark:text-blue-400 font-bold">영상</div>
                  <div className="text-xs font-black text-blue-700 dark:text-blue-300">{ch.videoCount}개</div>
                </div>
                <div className="text-center px-3 py-1.5 bg-violet-50 dark:bg-violet-500/10 rounded-lg">
                  <div className="text-[10px] text-violet-600 dark:text-violet-400 font-bold">평균 조회수</div>
                  <div className="text-xs font-black text-violet-700 dark:text-violet-300">{formatNumber(ch.avgViews)}</div>
                </div>
                <div className="text-center px-3 py-1.5 bg-amber-50 dark:bg-amber-500/10 rounded-lg">
                  <div className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">총 조회수</div>
                  <div className="text-xs font-black text-amber-700 dark:text-amber-300">{formatNumber(ch.totalViews)}</div>
                </div>
              </div>

              {/* 모바일: 리스트 추가 버튼 */}
              {onAddToMonitoring && (
                <div className="md:hidden relative mb-3" ref={groupMenuOpenId === ch.id ? groupMenuRef : undefined}>
                  {isAlreadyMonitored(ch.id) ? (
                    <div className="flex items-center justify-center gap-1 px-3 py-2 bg-slate-100 dark:bg-slate-700/50 rounded-lg cursor-default">
                      <span className="material-symbols-outlined text-sm text-slate-400">check_circle</span>
                      <span className="text-[11px] font-bold text-slate-400">이미 추가된 채널</span>
                    </div>
                  ) : (
                    <button
                      onClick={() => setGroupMenuOpenId(groupMenuOpenId === ch.id ? null : ch.id)}
                      className="w-full flex items-center justify-center gap-1 px-3 py-2 bg-pink-50 dark:bg-pink-500/10 hover:bg-pink-100 dark:hover:bg-pink-500/20 rounded-lg transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm text-pink-500">add_circle</span>
                      <span className="text-[11px] font-bold text-pink-600 dark:text-pink-400">내 리스트에 추가</span>
                    </button>
                  )}
                  {groupMenuOpenId === ch.id && !isAlreadyMonitored(ch.id) && (
                    <div className="absolute left-0 right-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1">
                      <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase">그룹 선택</div>
                      {availableGroups.map(g => (
                        <button
                          key={g.id}
                          onClick={() => handleAddToList(ch, g.id)}
                          className="w-full text-left px-3 py-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-pink-50 dark:hover:bg-pink-500/10 transition-colors flex items-center gap-2"
                        >
                          <span className="material-symbols-outlined text-sm text-slate-400">folder</span>
                          {g.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Top Videos Grid — 모바일 2열, 데스크톱 4열 */}
              {ch.topVideos.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
                  {ch.topVideos.map((video) => (
                    <a
                      key={video.videoId}
                      href={`https://www.youtube.com/watch?v=${video.videoId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group"
                    >
                      <div className="relative aspect-video rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700">
                        <img
                          src={video.thumbnail}
                          alt={video.title}
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="absolute bottom-1 right-1 bg-black/70 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                          {formatNumber(video.views)}회
                        </div>
                      </div>
                      <p className="mt-1.5 text-[11px] font-bold text-slate-700 dark:text-slate-300 line-clamp-2 leading-tight group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-colors">
                        {video.title}
                      </p>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && channels.length === 0 && !error && (
        <div className="text-center py-20">
          <div className="size-16 rounded-full bg-emerald-100 dark:bg-emerald-500/10 mx-auto mb-4 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl text-emerald-500">search</span>
          </div>
          <h3 className="text-lg font-black text-slate-900 dark:text-white mb-2">채널 신규 발굴</h3>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            급성장 중인 신규 크리에이터를 자동으로 발굴합니다.
          </p>
        </div>
      )}
    </div>
  );
};

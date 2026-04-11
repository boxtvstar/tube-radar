import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { SavedChannel, ChannelGroup } from '../../types';
import {
  saveRisingChannelToDb,
  deleteRisingChannelFromDb,
  getRisingChannelsFromDb,
  AdminRisingChannel,
} from '../../services/dbService';

const CACHE_KEY = 'tuberadar_rising_channels';
const MAX_TOTAL_CHANNELS = 500; // 최대 누적 채널 수 (초과 시 가장 오래된 것부터 제거)
const YOUTUBE_BASE_URL = 'https://www.googleapis.com/youtube/v3';

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
  addedByAdmin?: boolean; // 관리자가 직접 추가한 채널 표시
  topVideos: {
    videoId: string;
    title: string;
    thumbnail: string;
    views: number;
    publishedAt: string;
  }[];
}

/** YouTube URL/ID/handle에서 채널 식별자 추출 */
const extractChannelIdentifier = (input: string): { type: 'id' | 'handle' | 'video'; value: string } | null => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 채널 ID (UC로 시작, 24자)
  const idMatch = trimmed.match(/(UC[A-Za-z0-9_-]{22})/);
  if (idMatch) return { type: 'id', value: idMatch[1] };

  // @handle
  const handleMatch = trimmed.match(/@([A-Za-z0-9_.-]+)/);
  if (handleMatch) return { type: 'handle', value: handleMatch[1] };

  // 영상 URL/ID
  const videoMatch = trimmed.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (videoMatch) return { type: 'video', value: videoMatch[1] };
  if (/^[A-Za-z0-9_-]{11}$/.test(trimmed)) return { type: 'video', value: trimmed };

  return null;
};

/** YouTube API로 채널 정보 + 인기 영상 조회 (관리자 직접 추가용) */
const fetchAdminChannel = async (apiKey: string, input: string): Promise<RisingChannel | null> => {
  const ident = extractChannelIdentifier(input);
  if (!ident) throw new Error('채널 ID, @handle 또는 YouTube URL을 입력해주세요.');

  let channelId = '';

  if (ident.type === 'id') {
    channelId = ident.value;
  } else if (ident.type === 'video') {
    const r = await fetch(`${YOUTUBE_BASE_URL}/videos?part=snippet&id=${ident.value}&key=${apiKey}`);
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'API 오류');
    if (!d.items?.[0]) throw new Error('영상을 찾을 수 없습니다.');
    channelId = d.items[0].snippet.channelId;
  } else if (ident.type === 'handle') {
    const r = await fetch(`${YOUTUBE_BASE_URL}/channels?part=id&forHandle=${encodeURIComponent(ident.value)}&key=${apiKey}`);
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'API 오류');
    if (!d.items?.[0]) throw new Error('@handle 채널을 찾을 수 없습니다.');
    channelId = d.items[0].id;
  }

  // 채널 상세 조회
  const chRes = await fetch(`${YOUTUBE_BASE_URL}/channels?part=snippet,statistics,contentDetails&id=${channelId}&key=${apiKey}`);
  const chData = await chRes.json();
  if (chData.error) throw new Error(chData.error.message || 'API 오류');
  if (!chData.items?.[0]) throw new Error('채널을 찾을 수 없습니다.');

  const ch = chData.items[0];
  const stats = ch.statistics || {};
  const videoCount = parseInt(stats.videoCount || '0');
  const totalViews = parseInt(stats.viewCount || '0');
  const uploadsId = ch.contentDetails?.relatedPlaylists?.uploads;

  // 대표 영상 4개 조회
  let topVideos: RisingChannel['topVideos'] = [];
  if (uploadsId) {
    try {
      const plRes = await fetch(`${YOUTUBE_BASE_URL}/playlistItems?part=snippet&playlistId=${uploadsId}&maxResults=20&key=${apiKey}`);
      const plData = await plRes.json();
      const videoIds = (plData.items || [])
        .map((it: any) => it?.snippet?.resourceId?.videoId)
        .filter(Boolean);

      if (videoIds.length > 0) {
        const vRes = await fetch(`${YOUTUBE_BASE_URL}/videos?part=snippet,statistics&id=${videoIds.join(',')}&key=${apiKey}`);
        const vData = await vRes.json();
        topVideos = (vData.items || [])
          .map((v: any) => ({
            videoId: v.id,
            title: v.snippet.title,
            thumbnail:
              v.snippet?.thumbnails?.high?.url ||
              v.snippet?.thumbnails?.medium?.url ||
              v.snippet?.thumbnails?.default?.url ||
              '',
            views: parseInt(v.statistics?.viewCount || '0'),
            publishedAt: v.snippet.publishedAt,
          }))
          .sort((a: any, b: any) => b.views - a.views)
          .slice(0, 4);
      }
    } catch (e) {
      console.warn('Failed to fetch top videos for admin channel', e);
    }
  }

  return {
    id: ch.id,
    title: ch.snippet.title,
    thumbnail:
      ch.snippet?.thumbnails?.high?.url ||
      ch.snippet?.thumbnails?.medium?.url ||
      ch.snippet?.thumbnails?.default?.url ||
      '',
    subscriberCount: parseInt(stats.subscriberCount || '0'),
    videoCount,
    totalViews,
    avgViews: videoCount > 0 ? Math.round(totalViews / videoCount) : 0,
    joinDate: ch.snippet.publishedAt,
    country: ch.snippet.country,
    addedAt: Date.now(),
    addedByAdmin: true,
    topVideos,
  };
};

const formatNumber = (num: number) => {
  if (num >= 100000000) return (num / 100000000).toFixed(1) + '억';
  if (num >= 10000) return (num / 10000).toFixed(1) + '만';
  return num.toLocaleString();
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
        if (keys[i] !== CACHE_KEY) {
          localStorage.removeItem(keys[i]);
        }
      }
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data: channels, timestamp: Date.now() }));
    } catch { /* give up */ }
  }
};

/**
 * 서버에서 받은 채널을 기존 목록에 merge
 * - 기존 채널: addedAt 절대 변경하지 않음 (자기 자리 유지)
 * - 새 채널: 현재 시각 기준 addedAt 부여, 맨 위로 삽입
 * - 정렬: addedAt 내림차순 (최근 추가된 것이 위)
 * - 누적 최대 MAX_TOTAL_CHANNELS 도달 시 가장 오래된 것부터 제거
 */
const mergeChannels = (existing: RisingChannel[], newChannels: RisingChannel[]): RisingChannel[] => {
  const existingMap = new Map<string, RisingChannel>();
  for (const ch of existing) {
    existingMap.set(ch.id, ch);
  }

  // 이번 merge 시점의 baseline timestamp (신규 채널들끼리 순서 구분용)
  const baseTs = Date.now();
  let freshIndex = 0;

  // 새 채널 중 기존에 없는 것만 골라서 신규로 등록
  // 서버가 avgViews 내림차순으로 주므로, 상위 채널이 더 위에 오도록 freshIndex를 반전해 timestamp에 더함
  const freshEntries: RisingChannel[] = [];
  for (const ch of newChannels) {
    if (!existingMap.has(ch.id)) {
      // baseTs + (역순 index) → 위에 올수록 더 큰 값
      // 단일 merge 내에서 고유 tiebreaker 보장
      freshEntries.push({ ...ch, addedAt: baseTs + (1000 - freshIndex) });
      freshIndex++;
    }
  }

  // 기존 채널 통계 업데이트 (addedAt은 그대로)
  const updatedExisting: RisingChannel[] = existing.map(ec => {
    const latest = newChannels.find(n => n.id === ec.id);
    if (latest) {
      return {
        ...latest,
        addedAt: ec.addedAt, // 기존 timestamp 그대로 유지
        addedByAdmin: ec.addedByAdmin,
      };
    }
    return ec;
  });

  // 신규를 앞에, 기존을 뒤에 붙이고 addedAt 내림차순으로 정렬 (stable sort가 상대 순서 보존)
  const merged = [...freshEntries, ...updatedExisting];
  merged.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

  // 최대 누적 수 초과 시 오래된 것부터 제거
  if (merged.length > MAX_TOTAL_CHANNELS) {
    merged.length = MAX_TOTAL_CHANNELS;
  }

  return merged;
};

interface RisingCreatorsProps {
  apiKey?: string;
  groups?: ChannelGroup[];
  savedChannels?: SavedChannel[];
  onAddToMonitoring?: (channel: SavedChannel) => void | Promise<void>;
  onCreateGroup?: (name: string) => Promise<string>;
  isAdmin?: boolean;
}

export const RisingCreators: React.FC<RisingCreatorsProps> = ({ apiKey, groups, savedChannels: monitoringChannels, onAddToMonitoring, onCreateGroup, isAdmin }) => {
  const [channels, setChannels] = useState<RisingChannel[]>([]);
  const [adminChannels, setAdminChannels] = useState<RisingChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  const [groupMenuOpenId, setGroupMenuOpenId] = useState<string | null>(null);
  const [creatingGroupForId, setCreatingGroupForId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [createGroupError, setCreateGroupError] = useState('');
  const groupMenuDesktopRef = useRef<HTMLDivElement>(null);
  const groupMenuMobileRef = useRef<HTMLDivElement>(null);

  // 관리자 직접 추가 폼 state
  const [showAdminForm, setShowAdminForm] = useState(false);
  const [adminInput, setAdminInput] = useState('');
  const [adminAdding, setAdminAdding] = useState(false);
  const [adminError, setAdminError] = useState('');

  // 그룹 드롭다운 외부 클릭 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const isInsideDesktop = groupMenuDesktopRef.current?.contains(target);
      const isInsideMobile = groupMenuMobileRef.current?.contains(target);
      if (!isInsideDesktop && !isInsideMobile) {
        setGroupMenuOpenId(null);
        setCreatingGroupForId(null);
        setNewGroupName('');
        setCreateGroupError('');
      }
    };
    if (groupMenuOpenId) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [groupMenuOpenId]);

  const isAlreadyMonitored = (channelId: string) =>
    monitoringChannels?.some(c => c.id === channelId) ?? false;

  const handleAddToList = async (ch: RisingChannel, groupId: string) => {
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
    try {
      await onAddToMonitoring(saved);
    } catch (e) {
      console.error('채널 추가 실패:', e);
    }
    setGroupMenuOpenId(null);
    setCreatingGroupForId(null);
    setNewGroupName('');
    setCreateGroupError('');
  };

  const handleCreateGroupAndAdd = async (ch: RisingChannel) => {
    if (!onCreateGroup) return;
    const name = newGroupName.trim();
    if (!name) {
      setCreateGroupError('그룹명을 입력해주세요.');
      return;
    }
    setIsCreatingGroup(true);
    setCreateGroupError('');
    try {
      const newGroupId = await onCreateGroup(name);
      handleAddToList(ch, newGroupId);
    } catch (e: any) {
      setCreateGroupError(e?.message || '그룹 생성에 실패했습니다.');
    } finally {
      setIsCreatingGroup(false);
    }
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
  }, [apiKey]);

  /** Firebase에서 관리자 추가 채널 로드 */
  const loadAdminChannels = useCallback(async () => {
    try {
      const list = await getRisingChannelsFromDb();
      setAdminChannels(
        list.map(c => ({
          id: c.id,
          title: c.title,
          thumbnail: c.thumbnail,
          subscriberCount: c.subscriberCount,
          videoCount: c.videoCount,
          totalViews: c.totalViews,
          avgViews: c.avgViews,
          joinDate: c.joinDate,
          country: c.country,
          addedAt: c.addedAt,
          addedByAdmin: true,
          topVideos: (c.topVideos || []).map(v => ({
            videoId: v.videoId,
            title: v.title,
            thumbnail: v.thumbnail,
            views: v.views,
            publishedAt: v.publishedAt,
          })),
        }))
      );
    } catch (e) {
      console.warn('관리자 추가 채널 로드 실패:', e);
    }
  }, []);

  /** 관리자: 채널 직접 추가 */
  const handleAdminAdd = async () => {
    if (!apiKey) {
      setAdminError('YouTube API 키가 필요합니다.');
      return;
    }
    if (!adminInput.trim()) return;

    setAdminAdding(true);
    setAdminError('');
    try {
      const ch = await fetchAdminChannel(apiKey, adminInput);
      if (!ch) throw new Error('채널을 찾을 수 없습니다.');

      // 중복 체크 (Firebase + 자동 발굴 둘 다)
      if (adminChannels.some(c => c.id === ch.id) || channels.some(c => c.id === ch.id)) {
        throw new Error('이미 목록에 있는 채널입니다.');
      }

      await saveRisingChannelToDb({
        id: ch.id,
        title: ch.title,
        thumbnail: ch.thumbnail,
        subscriberCount: ch.subscriberCount,
        videoCount: ch.videoCount,
        totalViews: ch.totalViews,
        avgViews: ch.avgViews,
        joinDate: ch.joinDate,
        country: ch.country,
        addedAt: ch.addedAt || Date.now(),
        topVideos: ch.topVideos,
      });

      setAdminChannels(prev => [ch, ...prev]);
      setAdminInput('');
    } catch (e: any) {
      setAdminError(e.message || '추가 실패');
    } finally {
      setAdminAdding(false);
    }
  };

  /** 관리자: 채널 삭제 */
  const handleAdminRemove = async (channelId: string) => {
    if (!confirm('이 채널을 신규 발굴 목록에서 삭제하시겠습니까?')) return;
    try {
      await deleteRisingChannelFromDb(channelId);
      setAdminChannels(prev => prev.filter(c => c.id !== channelId));
    } catch (e: any) {
      alert('삭제 실패: ' + (e.message || ''));
    }
  };

  useEffect(() => {
    const hasCached = loadFromCache();
    // 캐시가 있어도 서버에서 새 데이터 확인 (merge됨)
    fetchData(false);
    // Firebase 관리자 추가 채널 로드
    loadAdminChannels();
  }, []);

  // 관리자 추가 채널 + 자동 발굴 채널 병합 (중복 제거, 관리자 추가가 우선)
  const displayChannels: RisingChannel[] = React.useMemo(() => {
    const map = new Map<string, RisingChannel>();
    for (const c of adminChannels) map.set(c.id, c);
    for (const c of channels) if (!map.has(c.id)) map.set(c.id, c);
    return Array.from(map.values()).sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  }, [adminChannels, channels]);

  return (
    <div className="w-full max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="material-symbols-outlined text-2xl text-emerald-500">search</span>
            <h2 className="text-xl font-black text-slate-900 dark:text-white">채널 신규 발굴</h2>
            {isAdmin && (
              <>
                <button
                  onClick={() => fetchData(true)}
                  disabled={loading}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-bold hover:bg-emerald-100 dark:hover:bg-emerald-500/20 transition-all disabled:opacity-50 border border-emerald-200 dark:border-emerald-500/30"
                >
                  <span className={`material-symbols-outlined text-sm ${loading ? 'animate-spin' : ''}`}>refresh</span>
                  새로고침
                </button>
                <button
                  onClick={() => {
                    setShowAdminForm(v => !v);
                    setAdminError('');
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[11px] font-bold hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-all border border-indigo-200 dark:border-indigo-500/30"
                >
                  <span className="material-symbols-outlined text-sm">{showAdminForm ? 'close' : 'add_circle'}</span>
                  {showAdminForm ? '닫기' : '채널 직접 추가'}
                </button>
              </>
            )}
          </div>
          {lastUpdated && (
            <p className="text-[11px] md:text-xs text-slate-400 font-medium">
              {lastUpdated}
            </p>
          )}
        </div>
      </div>

      {/* 관리자 직접 추가 폼 */}
      {isAdmin && showAdminForm && (
        <div className="mb-6 p-4 bg-indigo-50/50 dark:bg-indigo-500/5 border border-indigo-200 dark:border-indigo-500/20 rounded-2xl">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-lg text-indigo-500">admin_panel_settings</span>
            <h3 className="text-sm font-black text-indigo-700 dark:text-indigo-300">관리자: 채널 직접 추가</h3>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
            채널 ID (UCxxx...), @handle, 또는 YouTube URL을 입력하세요. Firebase에 저장되어 모든 사용자에게 표시됩니다.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={adminInput}
              onChange={(e) => setAdminInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !adminAdding) handleAdminAdd(); }}
              placeholder="예: @MrBeast 또는 UCX6OQ3DkcsbYNE6H8uQQuVA"
              disabled={adminAdding}
              className="flex-1 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50"
            />
            <button
              onClick={handleAdminAdd}
              disabled={adminAdding || !adminInput.trim()}
              className="px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold flex items-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className={`material-symbols-outlined text-sm ${adminAdding ? 'animate-spin' : ''}`}>
                {adminAdding ? 'progress_activity' : 'add'}
              </span>
              {adminAdding ? '추가 중...' : '추가'}
            </button>
          </div>
          {adminError && (
            <p className="mt-2 text-[11px] text-rose-500 font-medium flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">error</span>
              {adminError}
            </p>
          )}
        </div>
      )}

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
      {displayChannels.length > 0 && (
        <div className="space-y-4">
          {displayChannels.map((ch, idx) => (
            <div
              key={ch.id}
              className={`relative bg-white dark:bg-slate-800/50 border rounded-2xl p-4 md:p-5 hover:shadow-lg transition-all ${
                ch.addedByAdmin
                  ? 'border-indigo-300 dark:border-indigo-500/30 hover:border-indigo-400 dark:hover:border-indigo-500/50'
                  : 'border-slate-200 dark:border-slate-700/50 hover:border-emerald-300 dark:hover:border-emerald-500/30'
              }`}
            >
              {/* Channel Info */}
              <div className="flex items-start gap-3 md:gap-4 mb-3 md:mb-4">
                <div className="shrink-0">
                  <img
                    src={ch.thumbnail}
                    alt={ch.title}
                    className={`w-11 h-11 md:w-14 md:h-14 rounded-full object-cover border-2 ${
                      ch.addedByAdmin
                        ? 'border-indigo-300 dark:border-indigo-500/40'
                        : 'border-emerald-200 dark:border-emerald-500/30'
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <a
                      href={`https://www.youtube.com/channel/${ch.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm font-black text-slate-900 dark:text-white hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors truncate"
                    >
                      {ch.title}
                    </a>
                    {ch.addedByAdmin && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400 text-[9px] font-black uppercase tracking-wider">
                        <span className="material-symbols-outlined text-[10px]">verified</span>
                        관리자 추가
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                    개설일: {new Date(ch.joinDate).toLocaleDateString('ko-KR')}
                    {ch.country && <span className="ml-1.5">· {ch.country}</span>}
                  </p>
                </div>
                {/* 관리자 삭제 버튼 */}
                {isAdmin && ch.addedByAdmin && (
                  <button
                    onClick={() => handleAdminRemove(ch.id)}
                    className="shrink-0 size-8 flex items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors"
                    title="이 채널 삭제"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                  </button>
                )}
                {/* 데스크톱: 리스트 추가 버튼 */}
                {onAddToMonitoring && (
                  <div className="hidden md:block relative shrink-0" ref={groupMenuOpenId === ch.id ? groupMenuDesktopRef : undefined}>
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
                      <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 min-w-[200px] max-h-80 overflow-y-auto">
                        <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase">그룹 선택</div>
                        {availableGroups.length === 0 && creatingGroupForId !== ch.id && (
                          <div className="px-3 py-2 text-[11px] text-slate-400">저장된 그룹이 없습니다</div>
                        )}
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
                        {onCreateGroup && (
                          <div className="border-t border-slate-200 dark:border-slate-700 mt-1 pt-1">
                            {creatingGroupForId === ch.id ? (
                              <div className="p-2 space-y-1.5">
                                <input
                                  type="text"
                                  value={newGroupName}
                                  onChange={(e) => setNewGroupName(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === 'Enter' && !isCreatingGroup) handleCreateGroupAndAdd(ch); }}
                                  placeholder="그룹명 입력..."
                                  autoFocus
                                  disabled={isCreatingGroup}
                                  className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
                                />
                                {createGroupError && (
                                  <p className="text-[10px] text-rose-500 font-medium">{createGroupError}</p>
                                )}
                                <div className="flex gap-1">
                                  <button
                                    onClick={() => handleCreateGroupAndAdd(ch)}
                                    disabled={isCreatingGroup || !newGroupName.trim()}
                                    className="flex-1 px-2 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold disabled:opacity-50 transition-colors"
                                  >
                                    {isCreatingGroup ? '생성중...' : '만들고 추가'}
                                  </button>
                                  <button
                                    onClick={() => { setCreatingGroupForId(null); setNewGroupName(''); setCreateGroupError(''); }}
                                    disabled={isCreatingGroup}
                                    className="px-2 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold disabled:opacity-50"
                                  >
                                    취소
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => { setCreatingGroupForId(ch.id); setNewGroupName(''); setCreateGroupError(''); }}
                                className="w-full text-left px-3 py-2 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors flex items-center gap-2"
                              >
                                <span className="material-symbols-outlined text-sm">add_circle</span>
                                새 그룹 만들기
                              </button>
                            )}
                          </div>
                        )}
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
                <div className="md:hidden relative mb-3" ref={groupMenuOpenId === ch.id ? groupMenuMobileRef : undefined}>
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
                      {availableGroups.length === 0 && creatingGroupForId !== ch.id && (
                        <div className="px-3 py-2 text-[11px] text-slate-400">저장된 그룹이 없습니다</div>
                      )}
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
                      {onCreateGroup && (
                        <div className="border-t border-slate-200 dark:border-slate-700 mt-1 pt-1">
                          {creatingGroupForId === ch.id ? (
                            <div className="p-2 space-y-1.5">
                              <input
                                type="text"
                                value={newGroupName}
                                onChange={(e) => setNewGroupName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && !isCreatingGroup) handleCreateGroupAndAdd(ch); }}
                                placeholder="그룹명 입력..."
                                autoFocus
                                disabled={isCreatingGroup}
                                className="w-full px-2.5 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50"
                              />
                              {createGroupError && (
                                <p className="text-[10px] text-rose-500 font-medium">{createGroupError}</p>
                              )}
                              <div className="flex gap-1">
                                <button
                                  onClick={() => handleCreateGroupAndAdd(ch)}
                                  disabled={isCreatingGroup || !newGroupName.trim()}
                                  className="flex-1 px-2 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] font-bold disabled:opacity-50 transition-colors"
                                >
                                  {isCreatingGroup ? '생성중...' : '만들고 추가'}
                                </button>
                                <button
                                  onClick={() => { setCreatingGroupForId(null); setNewGroupName(''); setCreateGroupError(''); }}
                                  disabled={isCreatingGroup}
                                  className="px-3 py-2 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-bold disabled:opacity-50"
                                >
                                  취소
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              onClick={() => { setCreatingGroupForId(ch.id); setNewGroupName(''); setCreateGroupError(''); }}
                              className="w-full text-left px-3 py-2.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 transition-colors flex items-center gap-2"
                            >
                              <span className="material-symbols-outlined text-sm">add_circle</span>
                              새 그룹 만들기
                            </button>
                          )}
                        </div>
                      )}
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
      {!loading && displayChannels.length === 0 && !error && (
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

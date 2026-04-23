import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  AdminShortsMusicGroup,
  AdminShortsMusicTrack,
  deleteShortsMusicGroupFromDb,
  deleteShortsMusicTrackFromDb,
  getShortsMusicGroupsFromDb,
  getShortsMusicTracksFromDb,
  saveShortsMusicGroupToDb,
  saveShortsMusicTrackToDb,
} from '../../services/dbService';

interface ShortsTrack {
  rank: number;
  name: string;
  artist: string;
  thumbnail: string;
  videoId: string;
  id?: string;
  groupId?: string;
  groupName?: string;
  addedByAdmin?: boolean;
  sourceShortVideoId?: string;
  sourceShortTitle?: string;
  sourceShortThumbnail?: string;
  sourceShortUrl?: string;
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

interface ShortsMusicExtractResponse {
  track: Pick<ShortsTrack, 'name' | 'artist' | 'thumbnail' | 'videoId'>;
  sourceShort: {
    videoId: string;
    title: string;
    thumbnail: string;
    url: string;
  };
  source: 'music_card' | 'video_fallback';
  shortUrl: string;
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
  isAdmin?: boolean;
}

const getYoutubeThumbnail = (videoId: string) => videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '';

const extractYoutubeVideoId = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const directId = trimmed.match(/^[a-zA-Z0-9_-]{11}$/)?.[0];
  if (directId) return directId;

  try {
    const url = new URL(trimmed);
    const watchId = url.searchParams.get('v');
    if (watchId?.match(/^[a-zA-Z0-9_-]{11}$/)) return watchId;

    const segments = url.pathname.split('/').filter(Boolean);
    const candidate = ['shorts', 'embed', 'live', 'v'].includes(segments[0] || '') ? segments[1] : segments[0];
    return candidate?.match(/^[a-zA-Z0-9_-]{11}$/)?.[0] || '';
  } catch {
    return trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/|live\/))([a-zA-Z0-9_-]{11})/)?.[1] || '';
  }
};

const normalizeMusicKey = (track: Pick<ShortsTrack, 'name' | 'artist'>) =>
  `${track.name}_${track.artist}`.trim().toLowerCase();

export const ShortsTrendingMusic: React.FC<ShortsTrendingMusicProps> = ({ onTrackUsage, onPreCheckQuota, isAdmin = false }) => {
  const [tracks, setTracks] = useState<ShortsTrack[]>([]);
  const [adminTracks, setAdminTracks] = useState<ShortsTrack[]>([]);
  const [musicGroups, setMusicGroups] = useState<AdminShortsMusicGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [adminError, setAdminError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [relatedShorts, setRelatedShorts] = useState<ShortsVideo[]>([]);
  const [shortsLoading, setShortsLoading] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminAdding, setAdminAdding] = useState(false);
  const [groupAdding, setGroupAdding] = useState(false);
  const [trackForm, setTrackForm] = useState({
    shortsUrl: '',
    groupId: '',
  });
  const [groupName, setGroupName] = useState('');

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

  const loadAdminMusic = useCallback(async () => {
    try {
      const [groups, dbTracks] = await Promise.all([
        getShortsMusicGroupsFromDb(),
        getShortsMusicTracksFromDb(),
      ]);
      setMusicGroups(groups);
      setAdminTracks(dbTracks.map((track, idx) => ({
        rank: idx + 1,
        name: track.name,
        artist: track.artist,
        thumbnail: track.thumbnail,
        videoId: track.videoId,
        id: track.id,
        groupId: track.groupId,
        groupName: track.groupName,
        addedByAdmin: true,
        sourceShortVideoId: track.sourceShortVideoId,
        sourceShortTitle: track.sourceShortTitle,
        sourceShortThumbnail: track.sourceShortThumbnail,
        sourceShortUrl: track.sourceShortUrl,
      })));
    } catch (e) {
      console.warn('관리자 쇼츠 음악 로드 실패:', e);
    }
  }, []);

  useEffect(() => {
    if (!loadFromCache()) fetchTracks();
    loadAdminMusic();
    const interval = setInterval(() => fetchTracks(), CACHE_TTL);
    return () => clearInterval(interval);
  }, [loadFromCache, fetchTracks, loadAdminMusic]);

  const displayTracks = useMemo(() => {
    const adminMap = new Map<string, ShortsTrack>();
    adminTracks.forEach((track) => {
      adminMap.set(normalizeMusicKey(track), track);
    });

    return tracks.map((track) => {
      const adminTrack = adminMap.get(normalizeMusicKey(track));
      if (!adminTrack) return track;
      return {
        ...track,
        id: adminTrack.id,
        groupId: adminTrack.groupId,
        groupName: adminTrack.groupName,
        addedByAdmin: true,
        sourceShortVideoId: adminTrack.sourceShortVideoId,
        sourceShortTitle: adminTrack.sourceShortTitle,
        sourceShortThumbnail: adminTrack.sourceShortThumbnail,
        sourceShortUrl: adminTrack.sourceShortUrl,
      };
    });
  }, [adminTracks, tracks]);

  const filteredTracks = useMemo(() => {
    if (selectedCategory === 'all') return displayTracks;
    if (selectedCategory.startsWith('group:')) {
      const groupId = selectedCategory.slice('group:'.length);
      return displayTracks.filter(t => t.groupId === groupId);
    }
    return displayTracks.filter(t => getGenre(t.artist) === selectedCategory);
  }, [displayTracks, selectedCategory]);

  const fetchRelatedShorts = useCallback(async (track: ShortsTrack) => {
    setShortsLoading(true);
    setRelatedShorts([]);
    try {
      const q = encodeURIComponent(`${track.name} ${track.artist}`);
      const res = await fetch(`${apiBase}/api/shorts-music?q=${q}`);
      if (res.ok) {
        const data = await res.json();
        const searched = (data.videos || []).filter((short: ShortsVideo) => !!short.videoId);
        if (searched.length > 0) {
          setRelatedShorts(searched);
        } else if (track.sourceShortVideoId) {
          setRelatedShorts([{
            videoId: track.sourceShortVideoId,
            title: track.sourceShortTitle || `${track.name} 사용 쇼츠`,
            thumbnail: track.sourceShortThumbnail || getYoutubeThumbnail(track.sourceShortVideoId),
          }]);
        } else {
          setRelatedShorts([]);
        }
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

  const handleCreateGroup = async () => {
    const name = groupName.trim();
    if (!name) return;
    if (musicGroups.some(group => group.name.trim().toLowerCase() === name.toLowerCase())) {
      setAdminError('이미 있는 그룹명입니다.');
      return;
    }

    setGroupAdding(true);
    setAdminError('');
    try {
      const group: AdminShortsMusicGroup = {
        id: `music_group_${Date.now()}`,
        name,
        createdAt: Date.now(),
      };
      await saveShortsMusicGroupToDb(group);
      setMusicGroups(prev => [...prev, group]);
      setGroupName('');
    } catch (e: any) {
      setAdminError(e.message || '그룹 생성 실패');
    } finally {
      setGroupAdding(false);
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (adminTracks.some(track => track.groupId === groupId)) {
      setAdminError('이 그룹에 음악이 있어 삭제할 수 없습니다. 먼저 음악을 삭제하거나 다른 그룹으로 다시 추가해주세요.');
      return;
    }
    if (!confirm('이 음악 그룹을 삭제하시겠습니까?')) return;

    setAdminError('');
    try {
      await deleteShortsMusicGroupFromDb(groupId);
      setMusicGroups(prev => prev.filter(group => group.id !== groupId));
      if (selectedCategory === `group:${groupId}`) setSelectedCategory('all');
    } catch (e: any) {
      setAdminError(e.message || '그룹 삭제 실패');
    }
  };

  const handleAddTrack = async () => {
    const shortsUrl = trackForm.shortsUrl.trim();
    const inputVideoId = extractYoutubeVideoId(shortsUrl);
    const group = musicGroups.find(g => g.id === trackForm.groupId);

    if (!shortsUrl || !inputVideoId) {
      setAdminError('YouTube 쇼츠 주소를 입력해주세요.');
      return;
    }

    setAdminAdding(true);
    setAdminError('');
    try {
      let latestTracks = tracks;
      if (latestTracks.length === 0) {
        const res = await fetch(`${apiBase}/api/shorts-music`);
        if (!res.ok) throw new Error('현재 차트 데이터를 불러오지 못했습니다.');
        const data: ShortsMusicResponse = await res.json();
        latestTracks = data.tracks || [];
        setTracks(latestTracks);
        setUpdatedAt(data.updated_at || '');
        localStorage.setItem(CACHE_KEY, JSON.stringify({ data, savedAt: Date.now() }));
      }

      const res = await fetch(`${apiBase}/api/shorts-music?extractUrl=${encodeURIComponent(shortsUrl)}`);
      if (!res.ok) {
        const text = await res.text();
        let msg = '쇼츠에서 음악 정보를 가져오지 못했습니다.';
        try { const j = JSON.parse(text); msg = j.detail || j.error || msg; } catch {}
        throw new Error(msg);
      }
      const extracted = await res.json() as ShortsMusicExtractResponse;
      const extractedTrack = extracted.track;
      if (!extractedTrack?.name) throw new Error('쇼츠에서 음악 제목을 찾지 못했습니다.');

      const extractedKey = normalizeMusicKey({
        name: extractedTrack.name,
        artist: extractedTrack.artist || '',
      });

      const matchedChartTrack = latestTracks.find((track) => normalizeMusicKey(track) === extractedKey);
      if (!matchedChartTrack) {
        throw new Error('이 쇼츠의 음악은 현재 주간 Top 50에 없어 그룹에 추가할 수 없습니다.');
      }

      const existingAdminTrack = adminTracks.find((track) => normalizeMusicKey(track) === extractedKey);
      if (existingAdminTrack?.groupId === group?.id) {
        throw new Error('이미 해당 그룹에 연결된 음악입니다.');
      }

      const nextTrack: AdminShortsMusicTrack = {
        id: existingAdminTrack?.id || `music_track_${Date.now()}`,
        name: matchedChartTrack.name,
        artist: matchedChartTrack.artist || extractedTrack.artist || '',
        videoId: matchedChartTrack.videoId,
        thumbnail: matchedChartTrack.thumbnail || extractedTrack.thumbnail || getYoutubeThumbnail(matchedChartTrack.videoId),
        sourceShortVideoId: extracted.sourceShort?.videoId || inputVideoId,
        sourceShortTitle: extracted.sourceShort?.title || '',
        sourceShortThumbnail: extracted.sourceShort?.thumbnail || getYoutubeThumbnail(inputVideoId),
        sourceShortUrl: extracted.sourceShort?.url || `https://www.youtube.com/shorts/${inputVideoId}`,
        groupId: group?.id,
        groupName: group?.name,
        addedAt: Date.now(),
      };

      await saveShortsMusicTrackToDb(nextTrack);
      const nextUiTrack: ShortsTrack = {
        rank: matchedChartTrack.rank,
        name: nextTrack.name,
        artist: nextTrack.artist,
        thumbnail: nextTrack.thumbnail,
        videoId: nextTrack.videoId,
        id: nextTrack.id,
        groupId: nextTrack.groupId,
        groupName: nextTrack.groupName,
        addedByAdmin: true,
        sourceShortVideoId: nextTrack.sourceShortVideoId,
        sourceShortTitle: nextTrack.sourceShortTitle,
        sourceShortThumbnail: nextTrack.sourceShortThumbnail,
        sourceShortUrl: nextTrack.sourceShortUrl,
      };
      setAdminTracks(prev => {
        const filtered = prev.filter(track => normalizeMusicKey(track) !== extractedKey);
        return [nextUiTrack, ...filtered];
      });
      setTrackForm({ shortsUrl: '', groupId: trackForm.groupId });
    } catch (e: any) {
      setAdminError(e.message || '음악 추가 실패');
    } finally {
      setAdminAdding(false);
    }
  };

  const handleDeleteTrack = async (track: ShortsTrack) => {
    if (!track.id || !track.addedByAdmin) return;
    if (!confirm('이 관리자 추가 음악을 삭제하시겠습니까?')) return;

    setAdminError('');
    try {
      await deleteShortsMusicTrackFromDb(track.id);
      setAdminTracks(prev => prev.filter(item => item.id !== track.id));
      if (expandedIdx !== null) {
        setExpandedIdx(null);
        setRelatedShorts([]);
      }
    } catch (e: any) {
      setAdminError(e.message || '음악 삭제 실패');
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
        <div className="flex items-center gap-2">
          {isAdmin && (
            <button
              onClick={() => {
                setShowAdminPanel(v => !v);
                setAdminError('');
              }}
              className="flex items-center gap-1.5 px-2.5 md:px-3 py-1.5 rounded-xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-xs font-bold hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-all border border-indigo-200 dark:border-indigo-500/30"
            >
              <span className="material-symbols-outlined text-sm">{showAdminPanel ? 'close' : 'admin_panel_settings'}</span>
              <span className="hidden sm:inline">{showAdminPanel ? '닫기' : '관리'}</span>
            </button>
          )}
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
      </div>

      {/* Admin Panel */}
      {isAdmin && showAdminPanel && (
        <div className="mb-5 p-4 rounded-2xl bg-indigo-50/60 dark:bg-indigo-500/5 border border-indigo-200 dark:border-indigo-500/20">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-lg text-indigo-500">admin_panel_settings</span>
            <h3 className="text-sm font-black text-indigo-700 dark:text-indigo-300">관리자: 쇼츠 인기 음악 직접 관리</h3>
          </div>

          <div className="grid md:grid-cols-[1.5fr_1fr] gap-4">
            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                그룹을 선택하고 쇼츠 주소를 넣으면, 해당 쇼츠가 쓰는 음악이 현재 Top 50 안에 있을 때만 그 차트 음악에 그룹이 연결됩니다.
              </p>
              <div className="grid sm:grid-cols-[1fr_auto] gap-2">
                <input
                  type="text"
                  value={trackForm.shortsUrl}
                  onChange={(e) => setTrackForm(prev => ({ ...prev, shortsUrl: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !adminAdding && trackForm.shortsUrl.trim()) handleAddTrack(); }}
                  placeholder="YouTube 쇼츠 주소 붙여넣기"
                  disabled={adminAdding}
                  className="px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
                <select
                  value={trackForm.groupId}
                  onChange={(e) => setTrackForm(prev => ({ ...prev, groupId: e.target.value }))}
                  disabled={adminAdding}
                  className="px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30 sm:min-w-40"
                >
                  <option value="">그룹 없음</option>
                  {musicGroups.map(group => (
                    <option key={group.id} value={group.id}>{group.name}</option>
                  ))}
                </select>
                <button
                  onClick={handleAddTrack}
                  disabled={adminAdding || !trackForm.shortsUrl.trim()}
                  className="sm:col-span-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold flex items-center justify-center gap-1 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className={`material-symbols-outlined text-sm ${adminAdding ? 'animate-spin' : ''}`}>{adminAdding ? 'progress_activity' : 'add'}</span>
                  {adminAdding ? '음악 정보 가져오는 중...' : '쇼츠 주소로 음악 추가'}
                </button>
              </div>
              <p className="mt-2 text-[10px] text-slate-400 dark:text-slate-500">
                차트에 없는 음악은 추가되지 않습니다. 순위는 실제 차트 순서를 그대로 유지합니다.
              </p>
            </div>

            <div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">그룹을 만들면 필터 탭으로 노출됩니다.</p>
              <div className="flex gap-2 mb-2">
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !groupAdding) handleCreateGroup(); }}
                  placeholder="예: 댄스 챌린지"
                  disabled={groupAdding}
                  className="min-w-0 flex-1 px-3 py-2 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 outline-none focus:ring-2 focus:ring-indigo-500/30"
                />
                <button
                  onClick={handleCreateGroup}
                  disabled={groupAdding || !groupName.trim()}
                  className="px-3 py-2 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-xs font-black disabled:opacity-50"
                >
                  생성
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {musicGroups.length === 0 && (
                  <span className="text-[11px] text-slate-400">아직 만든 그룹이 없습니다.</span>
                )}
                {musicGroups.map(group => (
                  <span key={group.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px] font-bold text-slate-600 dark:text-slate-300">
                    {group.name}
                    <button
                      type="button"
                      onClick={() => handleDeleteGroup(group.id)}
                      className="text-slate-300 hover:text-rose-500 transition-colors"
                      title="그룹 삭제"
                    >
                      <span className="material-symbols-outlined text-[13px]">close</span>
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {adminError && (
            <p className="mt-3 text-[11px] text-rose-500 font-medium flex items-center gap-1">
              <span className="material-symbols-outlined text-sm">error</span>
              {adminError}
            </p>
          )}
        </div>
      )}

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
        {musicGroups.map(group => (
          <button
            key={group.id}
            onClick={() => { setSelectedCategory(`group:${group.id}`); setExpandedIdx(null); }}
            className={`px-3 md:px-4 py-1.5 md:py-2 rounded-lg md:rounded-xl text-xs md:text-sm font-bold transition-all ${
              selectedCategory === `group:${group.id}`
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-500/20 border border-indigo-200 dark:border-indigo-500/20'
            }`}
          >
            {group.name}
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
      {loading && displayTracks.length === 0 && (
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
            <div key={track.id || track.videoId || `${track.name}-${track.artist}-${idx}`}>
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
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate group-hover:text-violet-600 dark:group-hover:text-violet-400 transition-colors">
                      {track.name}
                    </p>
                    {track.addedByAdmin && (
                      <span className="shrink-0 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-[9px] font-black uppercase tracking-wider">
                        <span className="material-symbols-outlined text-[10px]">verified</span>
                        관리자 추가
                      </span>
                    )}
                  </div>
                  {track.artist && (
                    <p className="text-xs text-slate-400 dark:text-slate-500 truncate">
                      {track.artist}
                      {track.groupName && <span className="ml-1.5 text-indigo-400">· {track.groupName}</span>}
                    </p>
                  )}
                </div>

                {isAdmin && track.addedByAdmin && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteTrack(track);
                    }}
                    className="size-8 flex items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-500/10 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-500/20 transition-colors"
                    title="관리자 추가 음악 삭제"
                  >
                    <span className="material-symbols-outlined text-sm">delete</span>
                  </button>
                )}

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
      {!loading && filteredTracks.length === 0 && displayTracks.length > 0 && (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600">filter_list_off</span>
          <p className="mt-3 text-sm font-bold text-slate-400 dark:text-slate-500">선택한 카테고리에 맞는 음악이 없습니다</p>
          <button onClick={() => setSelectedCategory('all')} className="mt-2 text-xs text-violet-500 hover:text-violet-600 font-bold">
            필터 초기화
          </button>
        </div>
      )}

      {!loading && displayTracks.length === 0 && !error && (
        <div className="text-center py-16">
          <span className="material-symbols-outlined text-5xl text-slate-300 dark:text-slate-600">music_note</span>
          <p className="mt-3 text-sm font-bold text-slate-400 dark:text-slate-500">인기 음악을 불러오는 중...</p>
        </div>
      )}
    </div>
  );
};

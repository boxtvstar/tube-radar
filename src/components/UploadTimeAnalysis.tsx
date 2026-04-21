import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts';
import { VideoData, SavedChannel, ChannelGroup } from '../../types';
import { fetchChannelPopularVideos } from '../../services/youtubeService';
import { trackUsage } from '../../services/usageService';

// ─── Types ──────────────────────────────────────────────────────────────────

interface UploadTimeAnalysisProps {
  videos: VideoData[];
  savedChannels: SavedChannel[];
  groups: ChannelGroup[];
  apiKey: string;
  onClose: () => void;
  onGoToMonitoring?: () => void;
}

interface TimeSlot {
  day: number;   // 0=월 … 6=일
  hour: number;  // 0-23
  totalViews: number;
  count: number;
  avgViews: number;
  topCategory: string;
}

interface CategoryStat {
  category: string;
  bestDay: number;
  bestHour: number;
  avgViews: number;
  count: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];
const HOURS = Array.from({ length: 24 }, (_, i) => i);

// ─── Helpers ─────────────────────────────────────────────────────────────────

const parseViews = (views: string): number => {
  if (!views) return 0;
  const cleaned = views.replace(/,/g, '');
  if (cleaned.includes('억')) return parseFloat(cleaned) * 100_000_000;
  if (cleaned.includes('만')) return parseFloat(cleaned) * 10_000;
  if (cleaned.includes('천')) return parseFloat(cleaned) * 1_000;
  return parseInt(cleaned) || 0;
};

const formatCount = (n: number): string => {
  if (n >= 100_000_000) return (n / 100_000_000).toFixed(1) + '억';
  if (n >= 10_000) return (n / 10_000).toFixed(1) + '만';
  return n.toLocaleString();
};

const hourLabel = (h: number) => `${h}시`;

// Compute green intensity class from 0-1 ratio
const greenCell = (ratio: number): string => {
  if (ratio === 0) return 'bg-slate-100 dark:bg-slate-700/40';
  if (ratio < 0.15) return 'bg-emerald-50 dark:bg-emerald-900/20';
  if (ratio < 0.30) return 'bg-emerald-100 dark:bg-emerald-900/40';
  if (ratio < 0.45) return 'bg-emerald-200 dark:bg-emerald-800/50';
  if (ratio < 0.60) return 'bg-emerald-300 dark:bg-emerald-700/60';
  if (ratio < 0.75) return 'bg-emerald-400 dark:bg-emerald-600/70';
  if (ratio < 0.90) return 'bg-emerald-500 dark:bg-emerald-500/80';
  return 'bg-emerald-600 dark:bg-emerald-400/90';
};

const greenText = (ratio: number): string => {
  if (ratio < 0.45) return 'text-slate-600 dark:text-slate-400';
  return 'text-white dark:text-slate-900';
};

// ─── Component ───────────────────────────────────────────────────────────────

const UploadTimeAnalysis: React.FC<UploadTimeAnalysisProps> = ({
  videos,
  savedChannels,
  groups,
  apiKey,
  onClose,
  onGoToMonitoring,
}) => {
  const [selectedGroupId, setSelectedGroupId] = useState<string>('all');
  const [hoveredCell, setHoveredCell] = useState<{ day: number; hour: number } | null>(null);

  // ── topVideos 없는 채널 자동 로딩 ──────────────────────────────────
  // channelId → VideoSnippet[] 형태로 API에서 가져온 데이터 저장
  const [extraVideosMap, setExtraVideosMap] = useState<Map<string, { id: string; date: string; views: string }[]>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState({ current: 0, total: 0 });
  const loadedGroupsRef = useRef<Set<string>>(new Set());
  const [hasStarted, setHasStarted] = useState(false);
  const cancelRef = useRef(false);

  // ── 그룹 필터링된 채널 목록 (간단하고 확실한 로직) ────────────────────
  const filteredChannels = useMemo(() => {
    if (selectedGroupId === 'all') return savedChannels;
    return savedChannels.filter((ch) => {
      const gid = ch.groupId || 'unassigned';
      return gid === selectedGroupId;
    });
  }, [savedChannels, selectedGroupId]);

  // 그룹 변경 시 시작 상태 리셋 (이미 로딩된 그룹은 제외)
  useEffect(() => {
    if (!loadedGroupsRef.current.has(selectedGroupId)) {
      setHasStarted(false);
    }
  }, [selectedGroupId]);

  // ── 수동 분석 시작 함수 ──────────────────────────────
  const startAnalysis = useCallback(async () => {
    if (!apiKey) return;
    if (loadedGroupsRef.current.has(selectedGroupId)) return;

    const channelsNeedingData = filteredChannels.filter(
      (ch) => (!ch.topVideos || ch.topVideos.length === 0) && !extraVideosMap.has(ch.id)
    );

    if (channelsNeedingData.length === 0) {
      loadedGroupsRef.current.add(selectedGroupId);
      setHasStarted(true);
      return;
    }

    cancelRef.current = false;
    setHasStarted(true);
    setIsLoading(true);
    const total = channelsNeedingData.length;
    setLoadProgress({ current: 0, total });
    const newEntries = new Map<string, { id: string; date: string; views: string }[]>();
    let completed = 0;

    const EXTRA_MULTIPLIER_COST = 2;
    const BATCH_SIZE = 5;
    for (let i = 0; i < channelsNeedingData.length; i += BATCH_SIZE) {
      if (cancelRef.current) break;
      const batch = channelsNeedingData.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (ch) => {
          const vids = await fetchChannelPopularVideos(apiKey, ch.id);
          await trackUsage(apiKey, 'list', EXTRA_MULTIPLIER_COST, '업로드 시간 분석 추가 포인트');
          return { chId: ch.id, vids };
        })
      );

      for (const r of results) {
        completed++;
        if (r.status === 'fulfilled' && r.value.vids && r.value.vids.length > 0) {
          newEntries.set(r.value.chId, r.value.vids.map((v: any) => ({
            id: v.id,
            date: v.publishedAt || v.date || '',
            views: v.views || '0',
          })));
        }
      }

      if (!cancelRef.current) {
        setLoadProgress({ current: completed, total });
      }
    }

    if (!cancelRef.current) {
      setExtraVideosMap((prev) => {
        const merged = new Map(prev);
        newEntries.forEach((v, k) => merged.set(k, v));
        return merged;
      });
      loadedGroupsRef.current.add(selectedGroupId);
      setIsLoading(false);
    }
  }, [apiKey, selectedGroupId, filteredChannels, extraVideosMap]);

  // 필터된 채널 ID 세트 (videos prop 필터링용)
  const filteredChannelIds = useMemo(
    () => new Set(filteredChannels.map((ch) => ch.id)),
    [filteredChannels]
  );

  // ── 분석 데이터: savedChannels.topVideos + extraVideosMap + videos prop ──
  const analyzable = useMemo(() => {
    const seen = new Set<string>();
    const result: { publishedAt: string; views: string; channelId: string; channelName: string; category: string }[] = [];

    // 1) savedChannels.topVideos (DB에서 이미 로드된 데이터)
    for (const ch of filteredChannels) {
      if (ch.topVideos && ch.topVideos.length > 0) {
        for (const v of ch.topVideos) {
          if (seen.has(v.id)) continue;
          const dateStr = v.date;
          if (!dateStr) continue;
          const d = new Date(dateStr);
          if (isNaN(d.getTime())) continue;
          seen.add(v.id);
          result.push({
            publishedAt: dateStr,
            views: v.views,
            channelId: ch.id,
            channelName: ch.title,
            category: '',
          });
        }
      }

      // 2) extraVideosMap (API에서 보충 로딩한 데이터)
      const extra = extraVideosMap.get(ch.id);
      if (extra) {
        for (const v of extra) {
          if (seen.has(v.id)) continue;
          if (!v.date) continue;
          const d = new Date(v.date);
          if (isNaN(d.getTime())) continue;
          seen.add(v.id);
          result.push({
            publishedAt: v.date,
            views: v.views,
            channelId: ch.id,
            channelName: ch.title,
            category: '',
          });
        }
      }
    }

    // 3) videos prop에서 보충 (현재 로드된 영상 목록)
    for (const v of videos) {
      if (!v.publishedAt || seen.has(v.id)) continue;
      if (selectedGroupId !== 'all' && (!v.channelId || !filteredChannelIds.has(v.channelId))) continue;
      const d = new Date(v.publishedAt);
      if (isNaN(d.getTime())) continue;
      seen.add(v.id);
      result.push({
        publishedAt: v.publishedAt,
        views: v.views,
        channelId: v.channelId || '',
        channelName: v.channelName,
        category: v.category || '',
      });
    }

    return result;
  }, [filteredChannels, extraVideosMap, filteredChannelIds, videos, selectedGroupId]);

  // ── topVideos 보유 현황 (안내 메시지용) ─────────────────────────────
  const dataStats = useMemo(() => {
    const withData = filteredChannels.filter((ch) =>
      (ch.topVideos && ch.topVideos.length > 0) || extraVideosMap.has(ch.id)
    ).length;
    const total = filteredChannels.length;
    return { withData, total, noData: total - withData };
  }, [filteredChannels, extraVideosMap]);

  // ── Build heatmap: day×hour → {totalViews, count, categories} ─────────────
  const heatmapRaw = useMemo<Map<string, { totalViews: number; count: number; categories: string[] }>>(() => {
    const map = new Map<string, { totalViews: number; count: number; categories: string[] }>();

    for (const video of analyzable) {
      const d = new Date(video.publishedAt);
      if (isNaN(d.getTime())) continue;
      // JS getDay(): 0=Sun … 6=Sat → convert to 0=Mon … 6=Sun
      const jsDow = d.getDay();
      const day = jsDow === 0 ? 6 : jsDow - 1;
      const hour = d.getHours();
      const key = `${day}-${hour}`;
      const views = parseViews(video.views);
      const existing = map.get(key);
      if (existing) {
        existing.totalViews += views;
        existing.count += 1;
        if (video.category) existing.categories.push(video.category);
      } else {
        map.set(key, { totalViews: views, count: 1, categories: video.category ? [video.category] : [] });
      }
    }
    return map;
  }, [analyzable]);

  // ── Build sorted slot list ─────────────────────────────────────────────────
  const allSlots = useMemo<TimeSlot[]>(() => {
    const slots: TimeSlot[] = [];
    heatmapRaw.forEach((val, key) => {
      const [dayStr, hourStr] = key.split('-');
      const day = parseInt(dayStr);
      const hour = parseInt(hourStr);
      const avgViews = val.count > 0 ? val.totalViews / val.count : 0;
      // Most common category
      const catFreq = new Map<string, number>();
      val.categories.forEach((c) => catFreq.set(c, (catFreq.get(c) ?? 0) + 1));
      let topCategory = '';
      let maxFreq = 0;
      catFreq.forEach((freq, cat) => {
        if (freq > maxFreq) { maxFreq = freq; topCategory = cat; }
      });
      slots.push({ day, hour, totalViews: val.totalViews, count: val.count, avgViews, topCategory });
    });
    return slots.sort((a, b) => b.avgViews - a.avgViews);
  }, [heatmapRaw]);

  const top5 = useMemo(() => allSlots.slice(0, 5), [allSlots]);
  const top3Keys = useMemo(
    () => new Set(allSlots.slice(0, 3).map((s) => `${s.day}-${s.hour}`)),
    [allSlots]
  );

  // ── Heatmap max for normalization ──────────────────────────────────────────
  const heatmapMax = useMemo(() => {
    let max = 0;
    heatmapRaw.forEach((v) => {
      const avg = v.count > 0 ? v.totalViews / v.count : 0;
      if (avg > max) max = avg;
    });
    return max;
  }, [heatmapRaw]);

  // ── Category breakdown ─────────────────────────────────────────────────────
  const categoryStats = useMemo<CategoryStat[]>(() => {
    // category → day → hour → {total, count}
    const catMap = new Map<string, Map<string, { total: number; count: number }>>();
    for (const video of analyzable) {
      if (!video.category) continue; // 카테고리 없으면 스킵
      const d = new Date(video.publishedAt);
      if (isNaN(d.getTime())) continue;
      const jsDow = d.getDay();
      const day = jsDow === 0 ? 6 : jsDow - 1;
      const hour = d.getHours();
      const key = `${day}-${hour}`;
      const cat = video.category;
      const views = parseViews(video.views);
      if (!catMap.has(cat)) catMap.set(cat, new Map());
      const slotMap = catMap.get(cat)!;
      const existing = slotMap.get(key);
      if (existing) {
        existing.total += views;
        existing.count += 1;
      } else {
        slotMap.set(key, { total: views, count: 1 });
      }
    }

    const result: CategoryStat[] = [];
    catMap.forEach((slotMap, category) => {
      let bestKey = '';
      let bestAvg = 0;
      let totalCount = 0;
      slotMap.forEach((v, key) => {
        const avg = v.count > 0 ? v.total / v.count : 0;
        totalCount += v.count;
        if (avg > bestAvg) { bestAvg = avg; bestKey = key; }
      });
      if (!bestKey) return;
      const [dayStr, hourStr] = bestKey.split('-');
      result.push({
        category,
        bestDay: parseInt(dayStr),
        bestHour: parseInt(hourStr),
        avgViews: bestAvg,
        count: totalCount,
      });
    });
    return result.sort((a, b) => b.avgViews - a.avgViews);
  }, [analyzable]);

  // ── Summary stats ──────────────────────────────────────────────────────────
  const summaryStats = useMemo(() => {
    if (analyzable.length === 0) return null;

    // Most active upload day
    const dayCount = new Array(7).fill(0);
    analyzable.forEach((v) => {
      const d = new Date(v.publishedAt);
      if (isNaN(d.getTime())) return;
      const jsDow = d.getDay();
      dayCount[jsDow === 0 ? 6 : jsDow - 1] += 1;
    });
    const mostActiveDay = dayCount.indexOf(Math.max(...dayCount));

    // Most active hour
    const hourCount = new Array(24).fill(0);
    analyzable.forEach((v) => {
      const d = new Date(v.publishedAt);
      if (isNaN(d.getTime())) return;
      hourCount[d.getHours()] += 1;
    });
    const mostActiveHour = hourCount.indexOf(Math.max(...hourCount));

    const best = allSlots[0];

    return {
      totalVideos: analyzable.length,
      mostActiveDay,
      mostActiveHour,
      bestSlot: best ?? null,
    };
  }, [analyzable, allSlots]);

  // ── Bar chart data (hour distribution of top day) ──────────────────────────
  const barData = useMemo(() => {
    if (!summaryStats) return [];
    return HOURS.map((h) => {
      const key = `${summaryStats.mostActiveDay}-${h}`;
      const slot = heatmapRaw.get(key);
      const avg = slot && slot.count > 0 ? slot.totalViews / slot.count : 0;
      return { hour: `${h}시`, avgViews: Math.round(avg), count: slot?.count ?? 0 };
    });
  }, [summaryStats, heatmapRaw]);

  // ── Group dropdown (filter system groups) ─────────────────────────────────
  const userGroups = useMemo(
    () => groups.filter((g) => g.id !== 'all' && g.id !== 'unassigned'),
    [groups]
  );

  // ── Group selector UI ─────────────────────────────────────────────────────
  const groupSelector = (
    <div className="flex items-center gap-3">
      {userGroups.length > 0 && (
        <div className="relative">
          <select
            value={selectedGroupId}
            onChange={(e) => setSelectedGroupId(e.target.value)}
            className="appearance-none pl-4 pr-10 py-2 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-sm font-medium shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
          >
            <option value="all">전체 채널</option>
            {userGroups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
          <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 text-base pointer-events-none">expand_more</span>
        </div>
      )}
      <button
        onClick={onClose}
        className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
      >
        <span className="material-symbols-outlined text-slate-500 dark:text-slate-400">close</span>
      </button>
    </div>
  );

  // ── 분석 시작 전 대기 화면 ──────────────────────────────
  const channelsNeedingData = filteredChannels.filter(
    (ch) => (!ch.topVideos || ch.topVideos.length === 0) && !extraVideosMap.has(ch.id)
  );
  const needsManualStart = !hasStarted && !loadedGroupsRef.current.has(selectedGroupId) && channelsNeedingData.length > 0;

  if (needsManualStart) {
    return (
      <div className="w-full p-6 md:p-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg">
              <span className="material-symbols-outlined text-white text-xl">schedule</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">업로드 시간 분석</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">최적 업로드 타이밍 분석</p>
            </div>
          </div>
          {groupSelector}
        </div>
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-6">
            <span className="material-symbols-outlined text-indigo-500 text-3xl">query_stats</span>
          </div>
          <p className="text-lg font-bold text-slate-700 dark:text-slate-300 mb-2">채널 영상 데이터 수집이 필요합니다</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            {channelsNeedingData.length}개 채널의 영상 데이터를 가져옵니다
          </p>
          <button
            onClick={startAnalysis}
            className="px-6 py-3 bg-gradient-to-r from-indigo-500 to-violet-600 text-white font-bold rounded-xl shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center gap-2"
          >
            <span className="material-symbols-outlined text-xl">play_arrow</span>
            분석 시작
          </button>
        </div>
      </div>
    );
  }

  // ── Loading state (데이터가 아직 하나도 없고 로딩 중일 때만) ──────────
  if (analyzable.length === 0 && isLoading) {
    return (
      <div className="w-full p-6 md:p-10">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg">
              <span className="material-symbols-outlined text-white text-xl">schedule</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">업로드 시간 분석</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">채널 데이터를 수집하고 있습니다...</p>
            </div>
          </div>
          {groupSelector}
        </div>
        <div className="flex flex-col items-center justify-center py-20">
          <div className="w-16 h-16 rounded-2xl bg-indigo-50 dark:bg-indigo-900/30 flex items-center justify-center mb-6 animate-pulse">
            <span className="material-symbols-outlined text-indigo-500 text-3xl">downloading</span>
          </div>
          <p className="text-lg font-bold text-slate-700 dark:text-slate-300 mb-2">채널 영상 분석 중...</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
            {loadProgress.current} / {loadProgress.total} 채널 처리 완료
          </p>
          <div className="w-64 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-300"
              style={{ width: loadProgress.total > 0 ? `${(loadProgress.current / loadProgress.total) * 100}%` : '0%' }}
            />
          </div>
        </div>
      </div>
    );
  }

  // ── Empty state (로딩도 끝났는데 데이터 없을 때) ──────────────────────
  if (analyzable.length === 0) {
    return (
      <div className="w-full p-6 md:p-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg">
              <span className="material-symbols-outlined text-white text-xl">schedule</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">업로드 시간 분석</h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">최적 업로드 타이밍 분석</p>
            </div>
          </div>
          {groupSelector}
        </div>

        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-700 flex items-center justify-center mb-4">
            <span className="material-symbols-outlined text-slate-400 dark:text-slate-500 text-3xl">calendar_month</span>
          </div>
          <h3 className="text-lg font-semibold text-slate-700 dark:text-slate-300 mb-2">분석 데이터가 없습니다</h3>
          <p className="text-slate-500 dark:text-slate-400 max-w-md text-sm mb-2">
            {selectedGroupId !== 'all'
              ? `선택한 그룹에 ${dataStats.total}개 채널 중 영상 데이터가 있는 채널이 없습니다.`
              : `모니터링 리스트의 ${dataStats.total}개 채널 중 영상 데이터가 있는 채널이 없습니다.`
            }
          </p>
          <p className="text-slate-400 dark:text-slate-500 max-w-md text-xs mb-4">
            모니터링 리스트에서 채널의 영상을 먼저 로드해주세요.
            {selectedGroupId !== 'all' && ' 또는 다른 그룹을 선택해보세요.'}
          </p>
          {onGoToMonitoring && (
            <button
              onClick={onGoToMonitoring}
              className="px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-semibold transition-colors shadow-sm"
            >
              <span className="material-symbols-outlined text-base align-middle mr-1">list_alt</span>
              모니터링 리스트로 이동
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────
  return (
    <div className="w-full p-6 md:p-10 space-y-8">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-lg">
            <span className="material-symbols-outlined text-white text-xl">schedule</span>
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">업로드 시간 분석</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {filteredChannels.length}개 채널 · {analyzable.length}개 영상 분석
              {dataStats.noData > 0 && (
                <span className="text-amber-500"> · {dataStats.noData}개 채널 데이터 없음</span>
              )}
            </p>
          </div>
        </div>
        {groupSelector}
      </div>

      {/* ── 추가 데이터 로딩 중 배너 ── */}
      {isLoading && analyzable.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800">
          <div className="animate-spin w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
          <span className="text-sm text-indigo-700 dark:text-indigo-300">
            추가 채널 데이터 수집 중... ({loadProgress.current}/{loadProgress.total})
          </span>
        </div>
      )}

      {/* ── Summary stat cards ── */}
      {summaryStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon="play_circle"
            label="분석된 영상"
            value={`${summaryStats.totalVideos.toLocaleString()}개`}
            color="indigo"
          />
          <StatCard
            icon="calendar_today"
            label="업로드 최다 요일"
            value={DAY_NAMES[summaryStats.mostActiveDay] + '요일'}
            color="violet"
          />
          <StatCard
            icon="schedule"
            label="업로드 최다 시간"
            value={hourLabel(summaryStats.mostActiveHour)}
            color="emerald"
          />
          <StatCard
            icon="star"
            label="최고 성과 슬롯"
            value={
              summaryStats.bestSlot
                ? `${DAY_NAMES[summaryStats.bestSlot.day]} ${hourLabel(summaryStats.bestSlot.hour)}`
                : '-'
            }
            subValue={
              summaryStats.bestSlot
                ? `평균 ${formatCount(Math.round(summaryStats.bestSlot.avgViews))}회`
                : undefined
            }
            color="amber"
          />
        </div>
      )}

      {/* ── Heatmap: Day × Hour ── */}
      <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-5">
          <span className="material-symbols-outlined text-indigo-500 text-xl">grid_on</span>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">요일 × 시간대 조회수 히트맵</h3>
          <span className="ml-auto flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-100 dark:bg-emerald-900/40 border border-slate-200 dark:border-slate-600"></span>낮음
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-400 dark:bg-emerald-600/70"></span>
            <span className="inline-block w-3 h-3 rounded-sm bg-emerald-600 dark:bg-emerald-400/90"></span>높음
          </span>
        </div>

        {/* Scrollable heatmap */}
        <div className="overflow-x-auto pb-2">
          <div style={{ minWidth: 700 }}>
            {/* Hour header row */}
            <div className="flex">
              <div className="w-10 flex-shrink-0" />
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="flex-1 text-center text-[10px] font-medium text-slate-400 dark:text-slate-500 pb-1"
                  style={{ minWidth: 28 }}
                >
                  {h % 3 === 0 ? `${h}` : ''}
                </div>
              ))}
            </div>

            {/* Day rows */}
            {DAY_NAMES.map((dayName, dayIdx) => (
              <div key={dayIdx} className="flex items-center mb-0.5">
                {/* Day label */}
                <div className="w-10 flex-shrink-0 text-xs font-semibold text-slate-500 dark:text-slate-400 text-right pr-2">
                  {dayName}
                </div>
                {/* Hour cells */}
                {HOURS.map((hour) => {
                  const key = `${dayIdx}-${hour}`;
                  const slotData = heatmapRaw.get(key);
                  const avgViews = slotData && slotData.count > 0 ? slotData.totalViews / slotData.count : 0;
                  const ratio = heatmapMax > 0 ? avgViews / heatmapMax : 0;
                  const isTop3 = top3Keys.has(key);
                  const isHovered = hoveredCell?.day === dayIdx && hoveredCell?.hour === hour;

                  return (
                    <div
                      key={hour}
                      className="flex-1 relative group"
                      style={{ minWidth: 28 }}
                      onMouseEnter={() => setHoveredCell({ day: dayIdx, hour })}
                      onMouseLeave={() => setHoveredCell(null)}
                    >
                      <div
                        className={`
                          mx-0.5 rounded-sm h-7 flex items-center justify-center transition-all duration-150
                          ${greenCell(ratio)}
                          ${isTop3 ? 'ring-2 ring-amber-400 dark:ring-amber-500 ring-offset-0 z-10' : ''}
                          ${slotData ? 'cursor-pointer' : 'cursor-default'}
                          ${isHovered ? 'scale-110 z-20' : ''}
                        `}
                      >
                        {isTop3 && (
                          <span className="material-symbols-outlined text-amber-500 dark:text-amber-400"
                            style={{ fontSize: 12 }}>
                            star
                          </span>
                        )}
                        {!isTop3 && slotData && (
                          <span className={`text-[9px] font-medium ${greenText(ratio)}`}>
                            {slotData.count}
                          </span>
                        )}
                      </div>

                      {/* Tooltip */}
                      {isHovered && slotData && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none">
                          <div className="bg-slate-900 dark:bg-slate-700 text-white text-xs rounded-lg px-3 py-2 shadow-xl whitespace-nowrap border border-slate-700 dark:border-slate-600">
                            <div className="font-semibold mb-1">
                              {dayName}요일 {hour}시 ~ {hour + 1}시
                            </div>
                            <div className="text-emerald-400">평균 조회수: {formatCount(Math.round(avgViews))}회</div>
                            <div className="text-slate-300">영상 수: {slotData.count}개</div>
                            {isTop3 && (
                              <div className="text-amber-400 mt-1">★ TOP 3 슬롯</div>
                            )}
                          </div>
                          {/* Arrow */}
                          <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-900 dark:border-t-slate-700" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}

            {/* Hour axis bottom */}
            <div className="flex mt-1">
              <div className="w-10 flex-shrink-0" />
              {HOURS.map((h) => (
                <div
                  key={h}
                  className="flex-1 text-center text-[10px] text-slate-300 dark:text-slate-600"
                  style={{ minWidth: 28 }}
                >
                  {h % 6 === 0 ? `${h}h` : ''}
                </div>
              ))}
            </div>
          </div>
        </div>

        <p className="text-xs text-slate-400 dark:text-slate-500 mt-3">
          셀 위에 마우스를 올리면 상세 정보를 볼 수 있습니다. ★ 표시는 TOP 3 성과 슬롯입니다.
        </p>
      </div>

      {/* ── Top 5 best time slots ── */}
      {top5.length > 0 && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-5">
            <span className="material-symbols-outlined text-amber-500 text-xl">emoji_events</span>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">최고 성과 업로드 시간 TOP 5</h3>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {top5.map((slot, idx) => (
              <div
                key={`${slot.day}-${slot.hour}`}
                className={`relative rounded-xl p-4 border transition-all
                  ${idx === 0
                    ? 'bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-amber-200 dark:border-amber-700 shadow-md'
                    : 'bg-slate-50 dark:bg-slate-700/40 border-slate-200 dark:border-slate-600'
                  }`}
              >
                {/* Rank badge */}
                <div className={`absolute -top-2 -left-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shadow-sm
                  ${idx === 0 ? 'bg-amber-400 text-white' : idx === 1 ? 'bg-slate-400 text-white' : idx === 2 ? 'bg-orange-400 text-white' : 'bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300'}
                `}>
                  {idx + 1}
                </div>

                <div className="flex items-center gap-1.5 mb-3">
                  <span className={`material-symbols-outlined text-base ${idx === 0 ? 'text-amber-500' : 'text-indigo-400'}`}>schedule</span>
                  <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                    {DAY_NAMES[slot.day]}요일
                  </span>
                  <span className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
                    {hourLabel(slot.hour)}
                  </span>
                </div>

                <div className="space-y-1">
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">평균 조회수</span>
                    <p className={`text-base font-bold ${idx === 0 ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      {formatCount(Math.round(slot.avgViews))}회
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">샘플 영상</span>
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">{slot.count}개</p>
                  </div>
                  {slot.topCategory && (
                    <div>
                      <span className="text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wide">주요 카테고리</span>
                      <p className="text-xs font-medium text-violet-600 dark:text-violet-400 truncate">{slot.topCategory}</p>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Hour distribution bar chart ── */}
      {summaryStats && barData.some((d) => d.avgViews > 0) && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-5">
            <span className="material-symbols-outlined text-indigo-500 text-xl">bar_chart</span>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {DAY_NAMES[summaryStats.mostActiveDay]}요일 시간대별 평균 조회수
            </h3>
          </div>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" className="dark:stroke-slate-700" />
                <XAxis
                  dataKey="hour"
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  interval={2}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tickFormatter={(v) => formatCount(v)}
                  tick={{ fontSize: 11, fill: '#94a3b8' }}
                  axisLine={false}
                  tickLine={false}
                  width={50}
                />
                <Tooltip
                  formatter={(value: number) => [formatCount(value) + '회', '평균 조회수']}
                  contentStyle={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    borderRadius: 10,
                    color: '#f1f5f9',
                    fontSize: 12,
                  }}
                  labelStyle={{ color: '#f1f5f9', fontWeight: 'bold' }}
                />
                <Bar dataKey="avgViews" radius={[4, 4, 0, 0]} maxBarSize={28}>
                  {barData.map((entry, idx) => {
                    const isTop = top3Keys.has(`${summaryStats.mostActiveDay}-${idx}`);
                    return (
                      <Cell
                        key={idx}
                        fill={isTop ? '#f59e0b' : entry.avgViews > 0 ? '#6366f1' : '#e2e8f0'}
                      />
                    );
                  })}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── Category analysis ── */}
      {categoryStats.length > 0 && (
        <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-5">
            <span className="material-symbols-outlined text-violet-500 text-xl">category</span>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">카테고리별 최적 업로드 시간</h3>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">카테고리</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">최적 요일</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">최적 시간</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">평균 조회수</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">영상 수</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/50">
                {categoryStats.map((stat, idx) => (
                  <tr
                    key={stat.category}
                    className={`transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/30 ${idx === 0 ? 'font-semibold' : ''}`}
                  >
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2">
                        {idx < 3 && (
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                            ${idx === 0 ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400'
                              : idx === 1 ? 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                              : 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400'}`}>
                            {idx + 1}
                          </span>
                        )}
                        <span className="text-slate-800 dark:text-slate-200 truncate max-w-[140px]">{stat.category || '기타'}</span>
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-medium">
                        {DAY_NAMES[stat.bestDay]}요일
                      </span>
                    </td>
                    <td className="py-2.5 px-3">
                      <span className="inline-flex items-center px-2 py-0.5 rounded-lg bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-medium">
                        {hourLabel(stat.bestHour)}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatCount(Math.round(stat.avgViews))}회
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-500 dark:text-slate-400">
                      {stat.count}개
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Sub-components ───────────────────────────────────────────────────────────

interface StatCardProps {
  icon: string;
  label: string;
  value: string;
  subValue?: string;
  color: 'indigo' | 'violet' | 'emerald' | 'amber';
}

const colorMap: Record<StatCardProps['color'], { icon: string; bg: string; text: string }> = {
  indigo: {
    icon: 'text-indigo-500',
    bg: 'bg-indigo-50 dark:bg-indigo-900/30',
    text: 'text-indigo-600 dark:text-indigo-400',
  },
  violet: {
    icon: 'text-violet-500',
    bg: 'bg-violet-50 dark:bg-violet-900/30',
    text: 'text-violet-600 dark:text-violet-400',
  },
  emerald: {
    icon: 'text-emerald-500',
    bg: 'bg-emerald-50 dark:bg-emerald-900/30',
    text: 'text-emerald-600 dark:text-emerald-400',
  },
  amber: {
    icon: 'text-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-900/30',
    text: 'text-amber-600 dark:text-amber-400',
  },
};

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, subValue, color }) => {
  const c = colorMap[color];
  return (
    <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 shadow-sm flex flex-col gap-2">
      <div className={`w-8 h-8 rounded-lg ${c.bg} flex items-center justify-center`}>
        <span className={`material-symbols-outlined ${c.icon} text-base`}>{icon}</span>
      </div>
      <div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-0.5">{label}</p>
        <p className={`text-lg font-bold ${c.text}`}>{value}</p>
        {subValue && <p className="text-xs text-slate-500 dark:text-slate-400">{subValue}</p>}
      </div>
    </div>
  );
};

export default UploadTimeAnalysis;

import React, { useMemo, useState } from 'react';
import { ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { SavedChannel, DeepAnalysisVideo } from '../../types';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const formatNumber = (num: number) => {
  if (num >= 100_000_000) return (num / 100_000_000).toFixed(1) + '억';
  if (num >= 10_000) return (num / 10_000).toFixed(1) + '만';
  return num.toLocaleString();
};

const formatDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분 ${s}초`;
};

const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];

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

// ─── Stopwords for keyword extraction ────────────────────────────────────────

const STOPWORDS = new Set([
  // Korean
  '그', '이', '저', '것', '수', '등', '들', '및', '를', '을', '에', '의', '가', '는', '은',
  '로', '으로', '에서', '와', '과', '도', '만', '한', '할', '하는', '된', '되는', '하다',
  '합니다', '있는', '없는', '있다', '없다', '하기', '위한', '대한', '통한',
  // English common
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'or', 'and', 'not', 'no', 'but',
  'if', 'so', 'it', 'its', 'my', 'your', 'we', 'they', 'he', 'she',
  'this', 'that', 'what', 'which', 'who', 'how', 'all', 'each',
  // YouTube specific noise
  'shorts', 'vlog', 'ep', 'vol', 'part', 'vs',
]);

// ─── Duration bucket labels ──────────────────────────────────────────────────

const DURATION_BUCKETS = [
  { label: '~1분', min: 0, max: 60 },
  { label: '1~5분', min: 60, max: 300 },
  { label: '5~10분', min: 300, max: 600 },
  { label: '10~20분', min: 600, max: 1200 },
  { label: '20분+', min: 1200, max: Infinity },
];

// ─── Period Tabs ─────────────────────────────────────────────────────────────

type PeriodKey = 'all' | '100' | '60' | '30' | '10';
const PERIODS: { key: PeriodKey; label: string; days: number | null }[] = [
  { key: 'all', label: '전체', days: null },
  { key: '100', label: '100일', days: 100 },
  { key: '60', label: '60일', days: 60 },
  { key: '30', label: '30일', days: 30 },
  { key: '10', label: '10일', days: 10 },
];

// ─── Sort Config ─────────────────────────────────────────────────────────────

type SortKey = 'date' | 'views' | 'likes' | 'comments';

// ─── Component ───────────────────────────────────────────────────────────────

interface SingleChannelAnalysisProps {
  channel: SavedChannel;
  videos: DeepAnalysisVideo[];
  onBack: () => void;
}

export const SingleChannelAnalysis: React.FC<SingleChannelAnalysisProps> = ({
  channel,
  videos,
  onBack,
}) => {
  const [period, setPeriod] = useState<PeriodKey>('all');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortAsc, setSortAsc] = useState(false);

  // Filter videos by period
  const filteredVideos = useMemo(() => {
    const p = PERIODS.find((pp) => pp.key === period);
    if (!p || !p.days) return videos;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - p.days);
    return videos.filter((v) => new Date(v.date) >= cutoff);
  }, [videos, period]);

  // Summary stats
  const stats = useMemo(() => {
    if (filteredVideos.length === 0)
      return { avgViews: 0, avgLikes: 0, avgComments: 0, avgDuration: 0 };
    const sum = filteredVideos.reduce(
      (acc, v) => ({
        views: acc.views + v.views,
        likes: acc.likes + v.likes,
        comments: acc.comments + v.comments,
        duration: acc.duration + v.durationSeconds,
      }),
      { views: 0, likes: 0, comments: 0, duration: 0 }
    );
    const n = filteredVideos.length;
    return {
      avgViews: Math.round(sum.views / n),
      avgLikes: Math.round(sum.likes / n),
      avgComments: Math.round(sum.comments / n),
      avgDuration: Math.round(sum.duration / n),
    };
  }, [filteredVideos]);

  // Top videos
  const topByViews = useMemo(
    () => [...filteredVideos].sort((a, b) => b.views - a.views)[0] || null,
    [filteredVideos]
  );
  const topByLikes = useMemo(
    () => [...filteredVideos].sort((a, b) => b.likes - a.likes)[0] || null,
    [filteredVideos]
  );
  const topByComments = useMemo(
    () => [...filteredVideos].sort((a, b) => b.comments - a.comments)[0] || null,
    [filteredVideos]
  );

  // Heatmap: 7 days x 24 hours
  const heatmapData = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
    videos.forEach((v) => {
      const d = new Date(v.date);
      if (isNaN(d.getTime())) return;
      // JS getDay: 0=Sun, convert to 0=Mon
      const jsDay = d.getDay();
      const dayIdx = jsDay === 0 ? 6 : jsDay - 1;
      const hour = d.getHours();
      grid[dayIdx][hour]++;
    });
    const maxCount = Math.max(...grid.flat(), 1);

    // Top 3 slots
    const slots: { day: number; hour: number; count: number }[] = [];
    grid.forEach((row, d) =>
      row.forEach((count, h) => {
        if (count > 0) slots.push({ day: d, hour: h, count });
      })
    );
    slots.sort((a, b) => b.count - a.count);
    const top3 = new Set(slots.slice(0, 3).map((s) => `${s.day}-${s.hour}`));

    return { grid, maxCount, top3 };
  }, [videos]);

  // Sorted video list
  const sortedVideos = useMemo(() => {
    const sorted = [...filteredVideos];
    sorted.sort((a, b) => {
      let diff = 0;
      switch (sortKey) {
        case 'date':
          diff = new Date(b.date).getTime() - new Date(a.date).getTime();
          break;
        case 'views':
          diff = b.views - a.views;
          break;
        case 'likes':
          diff = b.likes - a.likes;
          break;
        case 'comments':
          diff = b.comments - a.comments;
          break;
      }
      return sortAsc ? -diff : diff;
    });
    return sorted;
  }, [filteredVideos, sortKey, sortAsc]);

  // ─── NEW: Views Trend (time-series) ─────────────────────────────────────
  const viewsTrend = useMemo(() => {
    return [...filteredVideos]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((v) => ({
        date: new Date(v.date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
        views: v.views,
        title: v.title,
      }));
  }, [filteredVideos]);

  // ─── NEW: Engagement Rate ──────────────────────────────────────────────
  const engagementData = useMemo(() => {
    return [...filteredVideos]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((v) => ({
        date: new Date(v.date).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }),
        likeRate: v.views > 0 ? parseFloat(((v.likes / v.views) * 100).toFixed(2)) : 0,
        commentRate: v.views > 0 ? parseFloat(((v.comments / v.views) * 100).toFixed(3)) : 0,
        title: v.title,
      }));
  }, [filteredVideos]);

  // ─── NEW: Shorts vs Regular ────────────────────────────────────────────
  const shortsComparison = useMemo(() => {
    const shorts = filteredVideos.filter((v) => v.durationSeconds <= 60);
    const regular = filteredVideos.filter((v) => v.durationSeconds > 60);
    const avg = (arr: DeepAnalysisVideo[], key: 'views' | 'likes' | 'comments') =>
      arr.length === 0 ? 0 : Math.round(arr.reduce((s, v) => s + v[key], 0) / arr.length);
    return {
      shorts: { count: shorts.length, avgViews: avg(shorts, 'views'), avgLikes: avg(shorts, 'likes'), avgComments: avg(shorts, 'comments') },
      regular: { count: regular.length, avgViews: avg(regular, 'views'), avgLikes: avg(regular, 'likes'), avgComments: avg(regular, 'comments') },
    };
  }, [filteredVideos]);

  // ─── NEW: Duration Bucket Performance ──────────────────────────────────
  const durationBucketData = useMemo(() => {
    return DURATION_BUCKETS.map((bucket) => {
      const vids = filteredVideos.filter(
        (v) => v.durationSeconds >= bucket.min && v.durationSeconds < bucket.max
      );
      return {
        label: bucket.label,
        count: vids.length,
        avgViews: vids.length > 0 ? Math.round(vids.reduce((s, v) => s + v.views, 0) / vids.length) : 0,
      };
    });
  }, [filteredVideos]);

  // ─── NEW: Upload Frequency (weekly) ────────────────────────────────────
  const uploadFrequency = useMemo(() => {
    if (filteredVideos.length === 0) return [];
    const sorted = [...filteredVideos].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
    );
    // Group by week
    const weekMap = new Map<string, number>();
    sorted.forEach((v) => {
      const d = new Date(v.date);
      // Get Monday of that week
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d.setDate(diff));
      const key = monday.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
      weekMap.set(key, (weekMap.get(key) || 0) + 1);
    });
    return Array.from(weekMap.entries()).map(([week, count]) => ({ week, count }));
  }, [filteredVideos]);

  // ─── NEW: Title Keywords ───────────────────────────────────────────────
  const topKeywords = useMemo(() => {
    const freq = new Map<string, number>();
    filteredVideos.forEach((v) => {
      // Split by non-alphanumeric/non-Korean characters
      const words = v.title
        .replace(/[^\w\sㄱ-ㅎ가-힣]/g, ' ')
        .split(/\s+/)
        .map((w) => w.toLowerCase().trim())
        .filter((w) => w.length >= 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
      words.forEach((w) => freq.set(w, (freq.get(w) || 0) + 1));
    });
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [filteredVideos]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  };

  const sortIcon = (key: SortKey) => {
    if (sortKey !== key) return 'unfold_more';
    return sortAsc ? 'expand_less' : 'expand_more';
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="bg-slate-50 dark:bg-black p-6 md:p-10 space-y-6 pb-20 animate-in slide-in-from-right-4 duration-500">
      <div className="w-full max-w-[1800px] mx-auto space-y-6">
        {/* 3-1. Channel Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-4">
            <img
              src={channel.thumbnail}
              alt=""
              className="size-16 md:size-20 rounded-full border-4 border-indigo-500/20 shadow-lg"
            />
            <div className="space-y-1.5">
              <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                <span className="material-symbols-outlined text-2xl">analytics</span>
                {channel.title}
              </h2>
              <div className="flex flex-wrap gap-2">
                {channel.subscriberCount && (
                  <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-full">
                    구독자 {channel.subscriberCount}
                  </span>
                )}
                {channel.videoCount && (
                  <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-full">
                    영상 {channel.videoCount}개
                  </span>
                )}
                {channel.joinDate && (
                  <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-full">
                    개설 {new Date(channel.joinDate).toLocaleDateString('ko-KR')}
                  </span>
                )}
                {channel.country && (
                  <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded-full">
                    {channel.country}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 font-medium">
                최근 {videos.length}개 영상 기준 심층 분석
              </p>
            </div>
          </div>

          <button
            onClick={onBack}
            className="px-5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center gap-2 text-slate-600 dark:text-slate-400 text-sm shrink-0"
          >
            <span className="material-symbols-outlined text-lg">restart_alt</span>
            다시 선택
          </button>
        </div>

        {/* 3-2. Period Tabs */}
        <div className="flex gap-2 flex-wrap">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              onClick={() => setPeriod(p.key)}
              className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${
                period === p.key
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/30'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-indigo-300'
              }`}
            >
              {p.label}
            </button>
          ))}
          <span className="text-xs text-slate-400 self-center ml-2">
            {filteredVideos.length}개 영상
          </span>
        </div>

        {filteredVideos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
            <span className="material-symbols-outlined text-5xl opacity-30">videocam_off</span>
            <p className="font-bold text-sm">선택한 기간에 영상이 없습니다.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* 3-3. Summary Stat Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[
                {
                  label: '평균 조회수',
                  value: formatNumber(stats.avgViews),
                  icon: 'visibility',
                  color: 'text-indigo-500',
                  bg: 'bg-indigo-50 dark:bg-indigo-900/20',
                },
                {
                  label: '평균 좋아요',
                  value: formatNumber(stats.avgLikes),
                  icon: 'thumb_up',
                  color: 'text-pink-500',
                  bg: 'bg-pink-50 dark:bg-pink-900/20',
                },
                {
                  label: '평균 댓글수',
                  value: formatNumber(stats.avgComments),
                  icon: 'chat_bubble',
                  color: 'text-emerald-500',
                  bg: 'bg-emerald-50 dark:bg-emerald-900/20',
                },
                {
                  label: '평균 영상 길이',
                  value: formatDuration(stats.avgDuration),
                  icon: 'timer',
                  color: 'text-amber-500',
                  bg: 'bg-amber-50 dark:bg-amber-900/20',
                },
              ].map((card) => (
                <div
                  key={card.label}
                  className="bg-white dark:bg-slate-900 rounded-2xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm"
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`p-1.5 rounded-lg ${card.bg}`}>
                      <span className={`material-symbols-outlined text-lg ${card.color}`}>
                        {card.icon}
                      </span>
                    </div>
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-tight">
                      {card.label}
                    </span>
                  </div>
                  <p className="text-2xl font-black text-slate-900 dark:text-white tabular-nums">
                    {card.value}
                  </p>
                </div>
              ))}
            </div>

            {/* 3-4. Top Video Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: '최고 조회수', video: topByViews, metric: topByViews?.views ?? 0, unit: '회', icon: 'visibility', iconClass: 'text-indigo-500', metricClass: 'text-indigo-600 dark:text-indigo-400' },
                { label: '최고 좋아요', video: topByLikes, metric: topByLikes?.likes ?? 0, unit: '개', icon: 'thumb_up', iconClass: 'text-pink-500', metricClass: 'text-pink-600 dark:text-pink-400' },
                { label: '최고 댓글', video: topByComments, metric: topByComments?.comments ?? 0, unit: '개', icon: 'chat_bubble', iconClass: 'text-emerald-500', metricClass: 'text-emerald-600 dark:text-emerald-400' },
              ].map((item) => (
                <div
                  key={item.label}
                  className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden"
                >
                  <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
                    <span className={`material-symbols-outlined text-lg ${item.iconClass}`}>
                      {item.icon}
                    </span>
                    <span className="text-sm font-black text-slate-900 dark:text-white">
                      {item.label}
                    </span>
                  </div>
                  {item.video ? (
                    <div className="p-4">
                      <a
                        href={`https://www.youtube.com/watch?v=${item.video.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block group"
                      >
                        <div className="relative aspect-video rounded-xl overflow-hidden mb-3 ring-1 ring-slate-200 dark:ring-slate-700">
                          <img
                            src={item.video.thumbnail}
                            alt={item.video.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                          />
                          <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                            <div className="size-10 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center">
                              <span className="material-symbols-outlined text-white text-2xl pl-0.5">
                                play_arrow
                              </span>
                            </div>
                          </div>
                        </div>
                        <h4 className="font-bold text-sm line-clamp-2 text-slate-900 dark:text-white mb-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                          {item.video.title}
                        </h4>
                      </a>
                      <div className={`text-lg font-black ${item.metricClass} tabular-nums`}>
                        {formatNumber(item.metric)}
                        <span className="text-xs text-slate-400 ml-1 font-normal">{item.unit}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="p-8 text-center text-slate-400 text-sm font-medium">
                      데이터 없음
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* 3-5. Upload Time Heatmap */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 md:p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl text-emerald-600">
                  <span className="material-symbols-outlined text-xl">schedule</span>
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">
                    업로드 시간 패턴
                  </h3>
                  <p className="text-[11px] text-slate-400 font-medium">
                    최근 {videos.length}개 영상의 업로드 요일/시간 분포 (⭐ 상위 3개 슬롯)
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <div className="min-w-[700px]">
                  {/* Hour headers */}
                  <div className="flex">
                    <div className="w-10 shrink-0" />
                    {Array.from({ length: 24 }, (_, h) => (
                      <div
                        key={h}
                        className="flex-1 text-center text-[9px] font-bold text-slate-400 pb-1"
                      >
                        {h}
                      </div>
                    ))}
                  </div>

                  {/* Grid rows */}
                  {DAY_NAMES.map((dayName, dayIdx) => (
                    <div key={dayIdx} className="flex items-center">
                      <div className="w-10 shrink-0 text-[11px] font-bold text-slate-500 text-right pr-2">
                        {dayName}
                      </div>
                      {Array.from({ length: 24 }, (_, h) => {
                        const count = heatmapData.grid[dayIdx][h];
                        const ratio = count / heatmapData.maxCount;
                        const isTop3 = heatmapData.top3.has(`${dayIdx}-${h}`);

                        return (
                          <div
                            key={h}
                            className={`flex-1 aspect-square m-[1px] rounded-[3px] flex items-center justify-center relative transition-all
                              ${greenCell(ratio)}
                              ${isTop3 ? 'ring-2 ring-amber-400 dark:ring-amber-500 ring-offset-0 z-10' : ''}
                            `}
                            title={`${dayName} ${h}시 - ${count}개 영상`}
                          >
                            {count > 0 && (
                              <span className={`text-[8px] font-bold ${greenText(ratio)}`}>
                                {count}
                              </span>
                            )}
                            {isTop3 && (
                              <span className="absolute -top-1 -right-1 text-[8px]">⭐</span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              {/* Legend */}
              <div className="flex items-center gap-2 mt-4 justify-end">
                <span className="text-[10px] text-slate-400 font-medium">적음</span>
                {[0, 0.2, 0.4, 0.6, 0.8, 1].map((r) => (
                  <div
                    key={r}
                    className={`size-3 rounded-sm ${greenCell(r)}`}
                  />
                ))}
                <span className="text-[10px] text-slate-400 font-medium">많음</span>
              </div>
            </div>

            {/* ── NEW: Views Trend Chart ─────────────────────────────── */}
            {viewsTrend.length >= 2 && (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-xl text-indigo-600">
                    <span className="material-symbols-outlined text-xl">trending_up</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">조회수 추이</h3>
                    <p className="text-[11px] text-slate-400 font-medium">시간순 영상별 조회수 변화</p>
                  </div>
                </div>
                <div className="h-64 md:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={viewsTrend} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={Math.max(Math.floor(viewsTrend.length / 8), 0)} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatNumber(v)} />
                      <Tooltip
                        content={({ active, payload }: any) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 p-3 rounded-xl shadow-2xl text-white text-xs max-w-[200px]">
                              <p className="font-bold text-slate-300 mb-1 line-clamp-2">{d.title}</p>
                              <p className="text-indigo-400 font-black">{formatNumber(d.views)}회</p>
                            </div>
                          );
                        }}
                      />
                      <Line type="monotone" dataKey="views" stroke="#6366f1" strokeWidth={2.5} dot={{ r: 3, fill: '#6366f1' }} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ── NEW: Engagement Rate Chart ──────────────────────────── */}
            {engagementData.length >= 2 && (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-pink-100 dark:bg-pink-900/30 rounded-xl text-pink-600">
                    <span className="material-symbols-outlined text-xl">favorite</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">참여율 분석</h3>
                    <p className="text-[11px] text-slate-400 font-medium">좋아요율(좋아요/조회수) · 댓글율(댓글/조회수)</p>
                  </div>
                </div>
                <div className="h-64 md:h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={engagementData} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                      <XAxis dataKey="date" tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={Math.max(Math.floor(engagementData.length / 8), 0)} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => v + '%'} />
                      <Tooltip
                        content={({ active, payload }: any) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 p-3 rounded-xl shadow-2xl text-white text-xs max-w-[220px]">
                              <p className="font-bold text-slate-300 mb-2 line-clamp-2">{d.title}</p>
                              <div className="space-y-1">
                                <p><span className="text-pink-400 font-black">좋아요율</span> {d.likeRate}%</p>
                                <p><span className="text-emerald-400 font-black">댓글율</span> {d.commentRate}%</p>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Line type="monotone" dataKey="likeRate" name="좋아요율" stroke="#ec4899" strokeWidth={2} dot={{ r: 2.5, fill: '#ec4899' }} />
                      <Line type="monotone" dataKey="commentRate" name="댓글율" stroke="#10b981" strokeWidth={2} dot={{ r: 2.5, fill: '#10b981' }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-6 mt-3 justify-center">
                  <div className="flex items-center gap-1.5"><div className="size-2.5 rounded-full bg-pink-500" /><span className="text-[11px] text-slate-400 font-bold">좋아요율</span></div>
                  <div className="flex items-center gap-1.5"><div className="size-2.5 rounded-full bg-emerald-500" /><span className="text-[11px] text-slate-400 font-bold">댓글율</span></div>
                </div>
              </div>
            )}

            {/* ── NEW: Shorts vs Regular ──────────────────────────────── */}
            {(shortsComparison.shorts.count > 0 || shortsComparison.regular.count > 0) && (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-xl text-violet-600">
                    <span className="material-symbols-outlined text-xl">play_circle</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">Shorts vs 일반 영상</h3>
                    <p className="text-[11px] text-slate-400 font-medium">60초 이하를 Shorts로 분류 · 평균 성과 비교</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { label: 'Shorts (60초 이하)', data: shortsComparison.shorts, accent: 'violet' as const },
                    { label: '일반 영상', data: shortsComparison.regular, accent: 'blue' as const },
                  ].map((item) => {
                    const accentClasses = item.accent === 'violet'
                      ? { border: 'border-violet-200 dark:border-violet-800/50', badge: 'bg-violet-100 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400', text: 'text-violet-600 dark:text-violet-400' }
                      : { border: 'border-blue-200 dark:border-blue-800/50', badge: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400', text: 'text-blue-600 dark:text-blue-400' };
                    return (
                      <div key={item.label} className={`rounded-xl border ${accentClasses.border} p-5`}>
                        <div className="flex items-center justify-between mb-4">
                          <span className="font-black text-sm text-slate-900 dark:text-white">{item.label}</span>
                          <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${accentClasses.badge}`}>
                            {item.data.count}개
                          </span>
                        </div>
                        {item.data.count === 0 ? (
                          <p className="text-sm text-slate-400 text-center py-4">해당 영상 없음</p>
                        ) : (
                          <div className="space-y-3">
                            {[
                              { label: '평균 조회수', value: item.data.avgViews },
                              { label: '평균 좋아요', value: item.data.avgLikes },
                              { label: '평균 댓글', value: item.data.avgComments },
                            ].map((m) => (
                              <div key={m.label} className="flex items-center justify-between">
                                <span className="text-xs text-slate-500 font-medium">{m.label}</span>
                                <span className={`text-sm font-black tabular-nums ${accentClasses.text}`}>{formatNumber(m.value)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── NEW: Duration Bucket Performance ────────────────────── */}
            {durationBucketData.some((b) => b.count > 0) && (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-amber-100 dark:bg-amber-900/30 rounded-xl text-amber-600">
                    <span className="material-symbols-outlined text-xl">timer</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">영상 길이별 성과</h3>
                    <p className="text-[11px] text-slate-400 font-medium">길이 구간별 평균 조회수 · 최적 길이 파악</p>
                  </div>
                </div>
                <div className="h-56 md:h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={durationBucketData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }} barSize={40}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                      <XAxis dataKey="label" tick={{ fontSize: 11, fontWeight: 'bold', fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} tickFormatter={(v: number) => formatNumber(v)} />
                      <Tooltip
                        content={({ active, payload }: any) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 p-3 rounded-xl shadow-2xl text-white text-xs">
                              <p className="font-bold text-slate-300 mb-1">{d.label}</p>
                              <p>영상 수: <span className="text-white font-black">{d.count}개</span></p>
                              <p>평균 조회수: <span className="text-amber-400 font-black">{formatNumber(d.avgViews)}</span></p>
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="avgViews" radius={[6, 6, 6, 6]}>
                        {durationBucketData.map((_, idx) => (
                          <Cell key={idx} fill={['#f59e0b', '#f97316', '#ef4444', '#8b5cf6', '#6366f1'][idx]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                {/* Count badges */}
                <div className="flex justify-around mt-2">
                  {durationBucketData.map((b) => (
                    <span key={b.label} className="text-[10px] text-slate-400 font-bold">{b.count}개</span>
                  ))}
                </div>
              </div>
            )}

            {/* ── NEW: Upload Frequency ───────────────────────────────── */}
            {uploadFrequency.length >= 2 && (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-cyan-100 dark:bg-cyan-900/30 rounded-xl text-cyan-600">
                    <span className="material-symbols-outlined text-xl">date_range</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">업로드 빈도</h3>
                    <p className="text-[11px] text-slate-400 font-medium">주간 업로드 횟수 추이</p>
                  </div>
                </div>
                <div className="h-48 md:h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={uploadFrequency} margin={{ top: 5, right: 10, left: -20, bottom: 0 }} barSize={20}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                      <XAxis dataKey="week" tick={{ fontSize: 9, fill: '#94a3b8' }} tickLine={false} axisLine={false} interval={Math.max(Math.floor(uploadFrequency.length / 8), 0)} />
                      <YAxis tick={{ fontSize: 10, fill: '#94a3b8' }} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        content={({ active, payload }: any) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0].payload;
                          return (
                            <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 p-3 rounded-xl shadow-2xl text-white text-xs">
                              <p className="text-slate-300 mb-1">{d.week} 주</p>
                              <p className="text-cyan-400 font-black">{d.count}개 업로드</p>
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="count" fill="#06b6d4" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ── NEW: Title Keywords ─────────────────────────────────── */}
            {topKeywords.length > 0 && (
              <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm p-5 md:p-8">
                <div className="flex items-center gap-3 mb-6">
                  <div className="p-2 bg-rose-100 dark:bg-rose-900/30 rounded-xl text-rose-600">
                    <span className="material-symbols-outlined text-xl">text_fields</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-slate-900 dark:text-white">제목 키워드 빈도</h3>
                    <p className="text-[11px] text-slate-400 font-medium">영상 제목에서 자주 등장하는 키워드 Top 10</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  {topKeywords.map(([word, count], idx) => {
                    const maxCount = topKeywords[0][1];
                    const ratio = count / maxCount;
                    const sizeClass = ratio > 0.7 ? 'text-xl px-4 py-2' : ratio > 0.4 ? 'text-base px-3 py-1.5' : 'text-sm px-2.5 py-1';
                    const colors = [
                      'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300',
                      'bg-pink-100 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300',
                      'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
                      'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
                      'bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300',
                      'bg-cyan-100 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300',
                      'bg-rose-100 dark:bg-rose-900/30 text-rose-700 dark:text-rose-300',
                      'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300',
                      'bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300',
                      'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
                    ];
                    return (
                      <span
                        key={word}
                        className={`rounded-full font-black ${sizeClass} ${colors[idx % colors.length]} inline-flex items-center gap-1.5`}
                      >
                        {word}
                        <span className="text-[10px] font-bold opacity-60">{count}</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 3-6. Full Video List Table */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center gap-3">
                <div className="p-2 bg-violet-100 dark:bg-violet-900/30 rounded-xl text-violet-600">
                  <span className="material-symbols-outlined text-xl">list</span>
                </div>
                <div>
                  <h3 className="text-lg font-black text-slate-900 dark:text-white">전체 영상 리스트</h3>
                  <p className="text-[11px] text-slate-400 font-medium">{filteredVideos.length}개 영상 · 헤더 클릭으로 정렬</p>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                      <th className="text-left p-3 pl-5 font-bold text-slate-400 text-xs w-16">#</th>
                      <th className="text-left p-3 font-bold text-slate-400 text-xs">영상</th>
                      <th
                        className="text-right p-3 font-bold text-slate-400 text-xs cursor-pointer hover:text-slate-600 dark:hover:text-slate-200 transition-colors select-none"
                        onClick={() => handleSort('date')}
                      >
                        <span className="inline-flex items-center gap-1">
                          날짜
                          <span className="material-symbols-outlined text-sm">{sortIcon('date')}</span>
                        </span>
                      </th>
                      <th
                        className="text-right p-3 font-bold text-slate-400 text-xs cursor-pointer hover:text-slate-600 dark:hover:text-slate-200 transition-colors select-none"
                        onClick={() => handleSort('views')}
                      >
                        <span className="inline-flex items-center gap-1">
                          조회수
                          <span className="material-symbols-outlined text-sm">{sortIcon('views')}</span>
                        </span>
                      </th>
                      <th
                        className="text-right p-3 font-bold text-slate-400 text-xs cursor-pointer hover:text-slate-600 dark:hover:text-slate-200 transition-colors select-none"
                        onClick={() => handleSort('likes')}
                      >
                        <span className="inline-flex items-center gap-1">
                          좋아요
                          <span className="material-symbols-outlined text-sm">{sortIcon('likes')}</span>
                        </span>
                      </th>
                      <th
                        className="text-right p-3 font-bold text-slate-400 text-xs cursor-pointer hover:text-slate-600 dark:hover:text-slate-200 transition-colors select-none"
                        onClick={() => handleSort('comments')}
                      >
                        <span className="inline-flex items-center gap-1">
                          댓글
                          <span className="material-symbols-outlined text-sm">{sortIcon('comments')}</span>
                        </span>
                      </th>
                      <th className="text-right p-3 pr-5 font-bold text-slate-400 text-xs">길이</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedVideos.map((v, idx) => (
                      <tr
                        key={v.id}
                        className="border-b border-slate-50 dark:border-slate-800/50 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors"
                      >
                        <td className="p-3 pl-5 text-slate-400 text-xs tabular-nums">{idx + 1}</td>
                        <td className="p-3">
                          <a
                            href={`https://www.youtube.com/watch?v=${v.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex items-center gap-3 group"
                          >
                            <img
                              src={v.thumbnail}
                              alt=""
                              className="w-20 h-12 rounded-lg object-cover shrink-0 ring-1 ring-slate-200 dark:ring-slate-700 group-hover:ring-indigo-500/50 transition-all"
                            />
                            <span className="font-bold text-slate-900 dark:text-white line-clamp-2 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors text-[13px]">
                              {v.title}
                            </span>
                          </a>
                        </td>
                        <td className="p-3 text-right text-slate-500 text-xs whitespace-nowrap tabular-nums">
                          {new Date(v.date).toLocaleDateString('ko-KR')}
                        </td>
                        <td className="p-3 text-right font-bold text-slate-900 dark:text-white text-xs tabular-nums">
                          {formatNumber(v.views)}
                        </td>
                        <td className="p-3 text-right font-bold text-pink-600 dark:text-pink-400 text-xs tabular-nums">
                          {formatNumber(v.likes)}
                        </td>
                        <td className="p-3 text-right font-bold text-emerald-600 dark:text-emerald-400 text-xs tabular-nums">
                          {formatNumber(v.comments)}
                        </td>
                        <td className="p-3 pr-5 text-right text-slate-500 text-xs whitespace-nowrap tabular-nums">
                          {v.duration}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

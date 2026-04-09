import React, { useState, useEffect, useRef } from 'react';
import {
  getChannelInfo,
  performRadarScan,
  searchChannelsByKeyword,
  getChannelUploadsPlaylistId,
  getPlaylistItems
} from '../../services/youtubeService';
import type { SavedChannel, ChannelGroup } from '../../types';

interface ChannelRadarProps {
  apiKey: string;
  onClose: () => void;
  onVideoClick?: (video: RadarVideo) => void;
  initialQuery?: string;
  groups?: ChannelGroup[];
  savedChannels?: SavedChannel[];
  onAddToMonitoring?: (channel: SavedChannel) => void;
  onCreateGroup?: (name: string) => Promise<string>;
}

interface RadarVideo {
  id: string;
  title: string;
  thumbnailUrl: string;
  channelName: string;
  channelId: string;
  channelThumbnail: string;
  
  views: string;
  publishedAt: string;
  velocity: number;
  spikeScore: number;
  performanceRatio: number;
  
  duration: string;
  subscribers: string;
  avgViews: string;
  viralScore: string;
  uploadTime: string;
  category: string;
  reachPercentage: number;
  tags: string[];
  channelTotalViews?: string;
}

// Helper for Category Names
const CATEGORY_NAMES: Record<string, string> = {
  '1': '영화/애니', '2': '자동차', '10': '음악', '15': '동물', '17': '스포츠',
     '18': '단편영화', '19': '여행', '20': '게임', '22': '브이로그/인물', '23': '코미디',
  '24': '엔터테인먼트', '25': '뉴스/정치', '26': '노하우/스타일', '27': '교육',
  '28': '과학/기술', '29': '비영리/사회'
};

const formatCount = (num: number) => {
  if (num >= 100000000) return (num / 100000000).toFixed(1) + "억";
  if (num >= 10000) return (num / 10000).toFixed(1) + "만";
  return num.toLocaleString();
};

const getTimeAgo = (date: string) => {
  if (!date) return '방금 전';
  const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + "년 전";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + "달 전";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + "일 전";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + "시간 전";
  interval = seconds / 60;
  if (interval > 1) return Math.floor(interval) + "분 전";
  return "방금 전";
};

export const ChannelRadar = ({ apiKey, onClose, onVideoClick, initialQuery, groups, savedChannels, onAddToMonitoring, onCreateGroup }: ChannelRadarProps) => {
  const [input, setInput] = useState(initialQuery || '');
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'searching' | 'fetching' | 'calculating' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<RadarVideo[]>([]);
  const [displayLimit, setDisplayLimit] = useState(12);

  // Monitoring list add state
  const [groupMenuOpenId, setGroupMenuOpenId] = useState<string | null>(null);
  const [creatingGroupForId, setCreatingGroupForId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [createGroupError, setCreateGroupError] = useState('');
  const groupMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (groupMenuRef.current && !groupMenuRef.current.contains(e.target as Node)) {
        setGroupMenuOpenId(null);
        setCreatingGroupForId(null);
        setNewGroupName('');
        setCreateGroupError('');
      }
    };
    if (groupMenuOpenId) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [groupMenuOpenId]);

  const availableGroups = (groups ?? []).filter(g => g.id !== 'all');

  const isChannelSaved = (channelId: string) =>
    savedChannels?.some(c => c.id === channelId) ?? false;

  const handleAddChannelToList = (ch: typeof trendingChannels[0], groupId: string) => {
    if (!onAddToMonitoring) return;
    const subStr = (ch.subs || '').replace(/[^0-9.]/g, '');
    const subNum = parseFloat(subStr);
    let subscriberCount = '0';
    if (!isNaN(subNum)) {
      if (ch.subs.includes('M')) subscriberCount = String(Math.round(subNum * 1_000_000));
      else if (ch.subs.includes('K')) subscriberCount = String(Math.round(subNum * 1_000));
      else subscriberCount = String(Math.round(subNum));
    }
    const saved: SavedChannel = {
      id: ch.id,
      title: ch.title,
      thumbnail: ch.thumbnail,
      subscriberCount,
      videoCount: String(ch.videoCount || 0),
      totalViews: String(ch.totalViews || 0),
      joinDate: ch.publishedAt,
      groupId,
      addedAt: Date.now(),
    };
    onAddToMonitoring(saved);
    setGroupMenuOpenId(null);
    setCreatingGroupForId(null);
    setNewGroupName('');
    setCreateGroupError('');
  };

  const handleCreateGroupAndAdd = async (ch: typeof trendingChannels[0]) => {
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
      handleAddChannelToList(ch, newGroupId);
    } catch (e: any) {
      setCreateGroupError(e?.message || '그룹 생성에 실패했습니다.');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  // Dashboard Data State
  const [trendingChannels, setTrendingChannels] = useState<{
    id: string;
    title: string;
    subs: string;
    growth: string;
    thumbnail: string;
    category: string;
    publishedAt: string;
    tags: string[];
    totalViews: number;
    videoCount: number;
    description?: string;
    topVideo?: {
      id: string;
      title: string;
      views: number;
      thumbnail: string;
      publishedAt: string;
      categoryId?: string;
    };
    recentVideos?: {
      id: string;
      title: string;
      thumbnail: string;
      views: number;
      publishedAt: string;
      duration?: string;
    }[];
  }[]>([]);
  const [popularKeywords, setPopularKeywords] = useState<string[]>([]);
  const [categoryStats, setCategoryStats] = useState<{cat: string, engagement: string, score: number}[]>([]);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);

  // Mount/Unmount logging
  useEffect(() => {
    return () => { setResults([]); };
  }, []);

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  // Auto-run if initialQuery is provided or changes
  useEffect(() => {
    if (initialQuery) {
       runRadar(initialQuery);
    }
  }, [initialQuery]);

  const runRadar = async (overrideInput?: string | any) => {
    const target = (typeof overrideInput === 'string' && overrideInput) ? overrideInput : input;
    
    if (!target.trim()) return;
    setStatus('analyzing');
    // If running via effect or override, update input state visually
    if (typeof overrideInput === 'string' && overrideInput !== input) setInput(overrideInput);
    
    setResults([]);
    setLogs([]);
    setProgress(10);
    setDisplayLimit(12);     
    try {
      addLog(`분석 시작: ${target}`);
      
      const channelInfo = await getChannelInfo(apiKey, target);
      if (!channelInfo) {
        addLog("채널을 찾을 수 없습니다.");
        setStatus('idle');
        return;
      }

      const scanResults = await performRadarScan(apiKey, channelInfo.id, (msg, prog) => {
         addLog(msg);
         setProgress(prog);
      });
      
      const radarVideos: RadarVideo[] = scanResults.map(r => ({
         ...r.video,
         spikeScore: r.spikeScore,
         velocity: r.velocity,
         performanceRatio: r.performanceRatio,
         channelThumbnail: '',
         channelId: r.video.channelId || '',
         publishedAt: r.video.publishedAt || '',
         // Fix: VideoDetailModal expects 'x' suffix format for Booster (Multiplier)
         // Map performanceRatio directly to viralScore to show "N times average"
         viralScore: (r.performanceRatio && !isNaN(r.performanceRatio)) 
            ? `${r.performanceRatio.toFixed(1)}x` 
            : '0.0x'
      }));

      addLog(`최종 ${radarVideos.length}개 급등 영상 추출 완료`);
      setResults(radarVideos);
      setStatus('done');
      setProgress(100);

    } catch (e: any) {
      addLog("Error: " + e.message);
      setStatus('idle');
    }
  };

  // Fetch Real Dashboard Data
  useEffect(() => {
    const fetchDashboard = async () => {
       setIsLoadingDashboard(true);
       try {
          // 1. Fetch Top 50 Most Popular Videos
          const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics&chart=mostPopular&regionCode=KR&maxResults=50&key=${apiKey}`);
          const data = await res.json();
          
          if (!data.items) return;

          const videos = data.items;

          // --- Process Trending Channels (Top 4 Unique) ---
          const uniqueChannels = new Map();
          for (const v of videos) {
             if (!uniqueChannels.has(v.snippet.channelId)) {
                uniqueChannels.set(v.snippet.channelId, {
                   id: v.snippet.channelId,
                   title: v.snippet.channelTitle,
                   thumbnail: v.snippet.thumbnails.high?.url || v.snippet.thumbnails.medium?.url || v.snippet.thumbnails.default.url,
                   category: CATEGORY_NAMES[v.snippet.categoryId] || '엔터테인먼트',
                   velocity: (parseInt(v.statistics.viewCount) / (Math.max(1, (Date.now() - new Date(v.snippet.publishedAt).getTime()) / (1000 * 60 * 60)))).toFixed(0),
                   topVideo: {
                     id: v.id,
                     title: v.snippet.title,
                     views: parseInt(v.statistics.viewCount || '0'),
                     thumbnail: v.snippet.thumbnails.maxres?.url || v.snippet.thumbnails.high?.url || v.snippet.thumbnails.medium?.url || v.snippet.thumbnails.default?.url,
                     publishedAt: v.snippet.publishedAt,
                     categoryId: v.snippet.categoryId
                   }
                });
             }
             if (uniqueChannels.size >= 12) break;
          }
          
          // Fetch exact subscribers & branding + contentDetails (for uploads playlist)
          const channelIds = Array.from(uniqueChannels.keys()).join(',');
          const chRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet,brandingSettings,contentDetails&id=${channelIds}&key=${apiKey}`);
          const chData = await chRes.json();

          const finalChannels = chData.items.map((ch: any) => {
             const base = uniqueChannels.get(ch.id);

             // Format subs nicely (handle hidden)
             let subs = '비공개';
             if (!ch.statistics.hiddenSubscriberCount) {
               const subsVal = parseInt(ch.statistics.subscriberCount);
               if (!isNaN(subsVal)) {
                  subs = subsVal > 1000000 ? `${(subsVal/1000000).toFixed(1)}M` : `${(subsVal/1000).toFixed(0)}K`;
                  subs += ' Subs';
               }
             }

             // Format velocity
             const velVal = parseInt(base.velocity);
             const growth = velVal > 1000 ? `+${(velVal/1000).toFixed(1)}K/hr` : `+${velVal}/hr`;

             // Safely parse publishedAt
             const rawDate = ch.snippet?.publishedAt;
             const validDate = rawDate && !isNaN(new Date(rawDate).getTime()) ? rawDate : new Date().toISOString();

             // Extract Tags (Keywords)
             const keywordsStr = ch.brandingSettings?.channel?.keywords || '';
             const tags = keywordsStr
                .replace(/"/g, '') // Remove quotes
                .split(/\s+/)
                .filter((t: string) => t.length > 0)
                .slice(0, 15);

             return {
                ...base,
                thumbnail: ch.snippet.thumbnails.high?.url || ch.snippet.thumbnails.medium?.url || ch.snippet.thumbnails.default.url,
                description: ch.snippet.description || '',
                subs: subs,
                growth: growth,
                publishedAt: validDate,
                tags: tags,
                totalViews: parseInt(ch.statistics.viewCount || '0'),
                videoCount: parseInt(ch.statistics.videoCount || '1'),
                uploadsPlaylistId: ch.contentDetails?.relatedPlaylists?.uploads,
                recentVideos: [] as any[]
             };
          });

          // Show channels immediately so UI feels fast
          setTrendingChannels(finalChannels);

          // Fetch 4 most recent videos per channel (cheap: playlistItems 1 unit each)
          try {
             const playlistResults = await Promise.all(
                finalChannels.map(async (ch: any) => {
                   if (!ch.uploadsPlaylistId) return { id: ch.id, videoIds: [] };
                   try {
                      const pRes = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${ch.uploadsPlaylistId}&maxResults=4&key=${apiKey}`);
                      const pData = await pRes.json();
                      const videoIds = (pData.items || [])
                         .map((it: any) => it.contentDetails?.videoId)
                         .filter(Boolean);
                      return { id: ch.id, videoIds };
                   } catch {
                      return { id: ch.id, videoIds: [] };
                   }
                })
             );

             // Collect all video IDs and batch fetch
             const allVideoIds = playlistResults.flatMap(r => r.videoIds);
             if (allVideoIds.length > 0) {
                // Batch in chunks of 50
                const chunks: string[][] = [];
                for (let i = 0; i < allVideoIds.length; i += 50) {
                   chunks.push(allVideoIds.slice(i, i + 50));
                }
                const videoDataMap = new Map<string, any>();
                for (const chunk of chunks) {
                   const vRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${chunk.join(',')}&key=${apiKey}`);
                   const vData = await vRes.json();
                   for (const item of (vData.items || [])) {
                      videoDataMap.set(item.id, item);
                   }
                }

                // Attach videos to each channel
                const enrichedChannels = finalChannels.map((ch: any) => {
                   const result = playlistResults.find(r => r.id === ch.id);
                   const recentVideos = (result?.videoIds || [])
                      .map((vid: string) => videoDataMap.get(vid))
                      .filter(Boolean)
                      .map((v: any) => ({
                         id: v.id,
                         title: v.snippet.title,
                         thumbnail: v.snippet.thumbnails.high?.url || v.snippet.thumbnails.medium?.url || v.snippet.thumbnails.default?.url,
                         views: parseInt(v.statistics?.viewCount || '0'),
                         publishedAt: v.snippet.publishedAt,
                         duration: v.contentDetails?.duration
                      }));
                   return { ...ch, recentVideos };
                });
                setTrendingChannels(enrichedChannels);
             }
          } catch (e) {
             console.warn("Failed to fetch channel videos", e);
          }

          // --- Process Keywords (Tags) ---
          const tagCounts = new Map<string, number>();
          videos.forEach((v: any) => {
             v.snippet.tags?.forEach((tag: string) => {
                const lower = tag.toLowerCase();
                if (lower.length > 1) tagCounts.set(lower, (tagCounts.get(lower) || 0) + 1);
             });
          });
          // Sort by frequency and take top 5
          const sortedTags = Array.from(tagCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(e => e[0]);
          setPopularKeywords(sortedTags);

          // --- Process Categories ---
          const catGroups = new Map<string, {views: number, likes: number, count: number}>();
          videos.forEach((v: any) => {
             const catId = v.snippet.categoryId;
             const prev = catGroups.get(catId) || {views: 0, likes: 0, count: 0};
             catGroups.set(catId, {
                views: prev.views + parseInt(v.statistics.viewCount || '0'),
                likes: prev.likes + parseInt(v.statistics.likeCount || '0'),
                count: prev.count + 1
             });
          });

          const sortedCats = Array.from(catGroups.entries())
            .map(([id, stats]) => {
                const avgViews = stats.views / stats.count;
                const engagement = (stats.likes / stats.views) * 100; // Like rate
                return {
                   cat: CATEGORY_NAMES[id] || '기타',
                   engagement: engagement.toFixed(1) + '%',
                   score: Math.floor(avgViews / 1000) // "Traffic Score" loosely based on avg k-views
                };
            })
            .sort((a, b) => b.score - a.score)
            .slice(0, 3);
          
          setCategoryStats(sortedCats);

       } catch (e) {
          console.error("Dashboard fetch failed", e);
       } finally {
          setIsLoadingDashboard(false);
       }
    };

    if (apiKey) fetchDashboard();
  }, [apiKey]);

  const RadarDashboard = () => (
    <div className="flex flex-col gap-4 md:gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
       {/* Header Section */}
       <div className="space-y-2 mb-2">
         <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-amber-600 dark:text-amber-400 uppercase flex items-center gap-3">
           <span className="material-symbols-outlined text-2xl md:text-3xl">radar</span>
           채널 급등 레이더
         </h2>
         <p className="text-slate-500 text-[11px] font-medium leading-relaxed hidden md:block">
           <span className="text-amber-600 dark:text-amber-400 font-bold">급격하게 성장하는 채널과 영상</span>을 실시간으로 탐지하세요.<br />
           성장 속도, 바이럴 지수, 조회수 변화 등 <span className="text-rose-500 font-bold">주요 급등 지표</span>를 한눈에 확인할 수 있습니다.
         </p>
       </div>
       
       {/* Hero Search Section */}
       <div className="relative mb-2 md:mb-4">
          <div className="absolute inset-y-0 left-3 md:left-4 flex items-center pointer-events-none">
             <span className="material-symbols-outlined text-slate-400 text-xl md:text-2xl">search</span>
          </div>
          <input 
            className="w-full py-3 md:py-5 pl-11 md:pl-14 pr-28 md:pr-36 rounded-xl md:rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-sm md:text-lg shadow-lg shadow-indigo-500/5 focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all placeholder:text-slate-400 text-slate-900 dark:text-white font-medium"
            placeholder="채널 URL 또는 ID 입력..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && runRadar()}
          />
          <button 
            onClick={runRadar}
            className="absolute right-1.5 md:right-2 top-1.5 md:top-2 bottom-1.5 md:bottom-2 px-3 md:px-6 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white rounded-lg md:rounded-xl font-bold transition-all shadow-md flex items-center gap-1 md:gap-2 text-xs md:text-sm"
          >
            <span className="hidden md:inline">채널 탐지 시작</span>
            <span className="md:hidden">탐지</span>
            <span className="material-symbols-outlined text-sm">rocket_launch</span>
          </button>
       </div>

       <div className="space-y-4 md:space-y-6">
          {/* Main Content: Real-time Rising Channels */}
          <div>
             <div className="flex items-center justify-between">
                <h3 className="text-base md:text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                   <span className="material-symbols-outlined text-indigo-500 text-lg md:text-xl">show_chart</span>
                   <span className="hidden sm:inline">실시간 인기 채널 (KR)</span>
                   <span className="sm:hidden">인기 채널</span>
                </h3>
                <div className="flex gap-2">
                   {isLoadingDashboard && <span className="text-[10px] md:text-xs text-slate-400 animate-pulse">수신 중...</span>}
                </div>
             </div>
             
                   <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">
                     {trendingChannels.map((ch, idx) => {
                        const avgViews = ch.videoCount > 0 ? Math.round(ch.totalViews / ch.videoCount) : 0;
                        const avgViewsLabel = avgViews > 0 ? formatCount(avgViews) : '0';
                        const openVideo = (video: { id: string; title: string; thumbnail: string; views: number; publishedAt: string; duration?: string }) => {
                           const viewsLabel = formatCount(video.views);
                           const viralScoreValue = avgViews > 0 ? `${(video.views / Math.max(avgViews, 1)).toFixed(1)}x` : '0.0x';
                           const reachPercent = avgViews > 0 ? Math.min(Math.round((video.views / avgViews) * 100), 999) : 0;
                           onVideoClick?.({
                              id: video.id,
                              title: video.title,
                              channelId: ch.id,
                              channelName: ch.title,
                              thumbnailUrl: video.thumbnail,
                              channelThumbnail: ch.thumbnail,
                              views: viewsLabel,
                              publishedAt: video.publishedAt || new Date().toISOString(),
                              velocity: 0,
                              spikeScore: 0,
                              performanceRatio: 0,
                              duration: video.duration || '',
                              subscribers: ch.subs,
                              avgViews: avgViewsLabel,
                              viralScore: viralScoreValue,
                              uploadTime: getTimeAgo(video.publishedAt || ch.publishedAt),
                              category: ch.category,
                              reachPercentage: reachPercent,
                              tags: ch.tags,
                              channelTotalViews: formatCount(ch.totalViews),
                           });
                        };

                        return (
                        <div key={idx} className="bg-white dark:bg-slate-900 rounded-2xl p-4 md:p-5 border border-slate-200 dark:border-slate-800 shadow-sm hover:border-indigo-500/40 hover:shadow-lg hover:shadow-indigo-500/5 transition-all group">
                           {/* Channel Header */}
                           <div className="flex items-start gap-3 md:gap-4 pb-4 mb-4 border-b border-slate-100 dark:border-slate-800">
                              <a
                                 href={`https://youtube.com/channel/${ch.id}`}
                                 target="_blank"
                                 rel="noreferrer"
                                 className="shrink-0"
                              >
                                 <img src={ch.thumbnail} className="size-14 md:size-16 rounded-full border-2 border-slate-100 dark:border-slate-800 object-cover hover:border-indigo-500 transition-colors" />
                              </a>
                              <div className="flex-1 min-w-0">
                                 <div className="flex items-start justify-between gap-2">
                                    <a
                                       href={`https://youtube.com/channel/${ch.id}`}
                                       target="_blank"
                                       rel="noreferrer"
                                       className="min-w-0 flex-1"
                                    >
                                       <h4 className="font-black text-sm md:text-base text-slate-900 dark:text-white line-clamp-1 leading-tight group-hover:text-indigo-500 transition-colors">{ch.title}</h4>
                                       <p className="text-[10px] md:text-xs text-slate-500 mt-0.5 truncate font-medium">
                                          {ch.category} · {ch.subs}
                                       </p>
                                    </a>
                                    <div className="shrink-0 flex flex-col items-end gap-1">
                                       <div className="text-right bg-emerald-50 dark:bg-emerald-500/10 px-2 py-1 rounded-lg border border-emerald-500/20">
                                          <span className="text-emerald-600 dark:text-emerald-400 text-[11px] md:text-xs font-black block leading-none">{ch.growth}</span>
                                          <span className="text-[8px] md:text-[9px] text-emerald-500/70 font-bold uppercase tracking-wider">Velocity</span>
                                       </div>
                                       {onAddToMonitoring && (
                                          <div className="relative" ref={groupMenuOpenId === ch.id ? groupMenuRef : undefined}>
                                             {isChannelSaved(ch.id) ? (
                                                <div className="flex items-center gap-1 px-2 py-1 bg-slate-100 dark:bg-slate-700/50 rounded-lg cursor-default">
                                                   <span className="material-symbols-outlined text-xs text-slate-400">check_circle</span>
                                                   <span className="text-[9px] font-bold text-slate-400">추가됨</span>
                                                </div>
                                             ) : (
                                                <button
                                                   onClick={(e) => { e.stopPropagation(); setGroupMenuOpenId(groupMenuOpenId === ch.id ? null : ch.id); }}
                                                   className="flex items-center gap-1 px-2 py-1 bg-pink-50 dark:bg-pink-500/10 hover:bg-pink-100 dark:hover:bg-pink-500/20 rounded-lg transition-colors"
                                                >
                                                   <span className="material-symbols-outlined text-xs text-pink-500">add_circle</span>
                                                   <span className="text-[9px] font-bold text-pink-600 dark:text-pink-400">리스트 추가</span>
                                                </button>
                                             )}
                                             {groupMenuOpenId === ch.id && !isChannelSaved(ch.id) && (
                                                <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl py-1 min-w-[200px] max-h-80 overflow-y-auto">
                                                   <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase">그룹 선택</div>
                                                   {availableGroups.length === 0 && creatingGroupForId !== ch.id && (
                                                      <div className="px-3 py-2 text-[11px] text-slate-400">저장된 그룹이 없습니다</div>
                                                   )}
                                                   {availableGroups.map(g => (
                                                      <button
                                                         key={g.id}
                                                         onClick={(e) => { e.stopPropagation(); handleAddChannelToList(ch, g.id); }}
                                                         className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 dark:text-slate-300 hover:bg-pink-50 dark:hover:bg-pink-500/10 transition-colors flex items-center gap-2"
                                                      >
                                                         <span className="material-symbols-outlined text-sm text-slate-400">folder</span>
                                                         {g.name}
                                                      </button>
                                                   ))}
                                                   {onCreateGroup && (
                                                      <div className="border-t border-slate-200 dark:border-slate-700 mt-1 pt-1">
                                                         {creatingGroupForId === ch.id ? (
                                                            <div className="p-2 space-y-1.5" onClick={(e) => e.stopPropagation()}>
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
                                                                     onClick={(e) => { e.stopPropagation(); handleCreateGroupAndAdd(ch); }}
                                                                     disabled={isCreatingGroup || !newGroupName.trim()}
                                                                     className="flex-1 px-2 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold disabled:opacity-50 transition-colors"
                                                                  >
                                                                     {isCreatingGroup ? '생성중...' : '만들고 추가'}
                                                                  </button>
                                                                  <button
                                                                     onClick={(e) => { e.stopPropagation(); setCreatingGroupForId(null); setNewGroupName(''); setCreateGroupError(''); }}
                                                                     disabled={isCreatingGroup}
                                                                     className="px-2 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-bold disabled:opacity-50"
                                                                  >
                                                                     취소
                                                                  </button>
                                                               </div>
                                                            </div>
                                                         ) : (
                                                            <button
                                                               onClick={(e) => { e.stopPropagation(); setCreatingGroupForId(ch.id); setNewGroupName(''); setCreateGroupError(''); }}
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
                                 </div>
                                 <div className="grid grid-cols-3 gap-1.5 mt-2">
                                    <div className="text-center bg-slate-50 dark:bg-slate-800/50 rounded-lg py-1">
                                       <div className="text-[9px] text-slate-400 font-bold uppercase leading-none">총 조회</div>
                                       <div className="text-[11px] md:text-xs font-black text-slate-700 dark:text-slate-200 mt-0.5">{formatCount(ch.totalViews)}</div>
                                    </div>
                                    <div className="text-center bg-slate-50 dark:bg-slate-800/50 rounded-lg py-1">
                                       <div className="text-[9px] text-slate-400 font-bold uppercase leading-none">영상 수</div>
                                       <div className="text-[11px] md:text-xs font-black text-slate-700 dark:text-slate-200 mt-0.5">{ch.videoCount.toLocaleString()}</div>
                                    </div>
                                    <div className="text-center bg-slate-50 dark:bg-slate-800/50 rounded-lg py-1">
                                       <div className="text-[9px] text-slate-400 font-bold uppercase leading-none">평균 조회</div>
                                       <div className="text-[11px] md:text-xs font-black text-slate-700 dark:text-slate-200 mt-0.5">{avgViewsLabel}</div>
                                    </div>
                                 </div>
                              </div>
                           </div>

                           {/* Recent Videos Grid */}
                           {ch.recentVideos && ch.recentVideos.length > 0 ? (
                              <div>
                                 <div className="flex items-center justify-between mb-2">
                                    <h5 className="text-[10px] md:text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-1">
                                       <span className="material-symbols-outlined text-sm text-indigo-500">play_circle</span>
                                       최근 영상
                                    </h5>
                                    <a
                                       href={`https://youtube.com/channel/${ch.id}/videos`}
                                       target="_blank"
                                       rel="noreferrer"
                                       className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 flex items-center gap-0.5"
                                    >
                                       전체보기
                                       <span className="material-symbols-outlined text-xs">arrow_forward</span>
                                    </a>
                                 </div>
                                 <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                                    {ch.recentVideos.slice(0, 4).map((v) => (
                                       <button
                                          key={v.id}
                                          onClick={(e) => {
                                             e.stopPropagation();
                                             openVideo(v);
                                          }}
                                          className="text-left group/vid rounded-lg overflow-hidden bg-slate-50 dark:bg-slate-800/50 hover:ring-2 hover:ring-indigo-500/50 transition-all"
                                       >
                                          <div className="aspect-video relative bg-slate-200 dark:bg-slate-800 overflow-hidden">
                                             <img
                                                src={v.thumbnail}
                                                alt={v.title}
                                                loading="lazy"
                                                className="w-full h-full object-cover group-hover/vid:scale-105 transition-transform duration-500"
                                             />
                                             <div className="absolute bottom-1 right-1 bg-black/80 text-white text-[9px] font-bold px-1 rounded">
                                                {formatCount(v.views)}
                                             </div>
                                          </div>
                                          <div className="p-1.5">
                                             <div className="text-[10px] md:text-[11px] font-bold text-slate-700 dark:text-slate-200 line-clamp-2 leading-tight group-hover/vid:text-indigo-500 transition-colors">
                                                {v.title}
                                             </div>
                                             <div className="text-[9px] text-slate-400 font-medium mt-0.5">
                                                {getTimeAgo(v.publishedAt)}
                                             </div>
                                          </div>
                                       </button>
                                    ))}
                                 </div>
                              </div>
                           ) : ch.topVideo ? (
                              // Fallback: single top video
                              <button
                                 onClick={() => ch.topVideo && openVideo({
                                    id: ch.topVideo.id,
                                    title: ch.topVideo.title,
                                    thumbnail: ch.topVideo.thumbnail,
                                    views: ch.topVideo.views,
                                    publishedAt: ch.topVideo.publishedAt,
                                 })}
                                 className="w-full flex gap-3 text-left group/top rounded-xl p-2 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                              >
                                 <div className="w-32 aspect-video rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-800 shrink-0 relative">
                                    <img src={ch.topVideo.thumbnail} className="w-full h-full object-cover group-hover/top:scale-105 transition-transform duration-500" />
                                 </div>
                                 <div className="flex-1 min-w-0">
                                    <div className="text-[10px] font-bold text-rose-500 uppercase tracking-wider mb-1">🔥 인기 영상</div>
                                    <div className="text-xs font-bold text-slate-900 dark:text-white line-clamp-2 leading-tight">{ch.topVideo.title}</div>
                                    <div className="text-[10px] text-slate-500 font-medium mt-1">조회수 {formatCount(ch.topVideo.views)}</div>
                                 </div>
                              </button>
                           ) : (
                              <div className="py-6 text-center">
                                 <div className="flex items-center justify-center gap-1 text-slate-300 dark:text-slate-700">
                                    {[0, 1, 2, 3].map(i => (
                                       <div key={i} className="flex-1 aspect-video max-w-[80px] bg-slate-100 dark:bg-slate-800/50 rounded-lg animate-pulse" style={{ animationDelay: `${i * 100}ms` }}></div>
                                    ))}
                                 </div>
                                 <p className="text-[10px] text-slate-400 font-medium mt-2">영상 로딩 중...</p>
                              </div>
                           )}
                        </div>
                        );
                     })}
                
                {isLoadingDashboard && trendingChannels.length === 0 && (
                   <div className="col-span-full py-20 text-center text-slate-400 bg-slate-100 dark:bg-slate-900 rounded-2xl border border-dashed border-slate-300 dark:border-slate-800 animate-pulse">
                      실시간 트렌드 분석 중...
                   </div>
                )}
             </div>

          </div>
       </div>
    </div>
  );

  const renderResults = () => {
     return (
        <div className="flex flex-col">
           {/* Compact Search Bar for Results View */}
           <div className="pb-2 shrink-0">
               {/* Header Section */}
               <div className="space-y-2 mb-4">
                 <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-amber-600 dark:text-amber-400 uppercase flex items-center gap-3">
                   <span className="material-symbols-outlined text-2xl md:text-3xl">radar</span>
                   채널 급등 레이더 분석 결과
                 </h2>
                 <p className="text-slate-500 text-[11px] font-medium leading-relaxed hidden md:block">
                   <span className="text-amber-600 dark:text-amber-400 font-bold">급상승 중인 영상들</span>을 발견했습니다. 각 영상의 성장 지표를 확인하세요.<br />
                   급등 점수가 높을수록 <span className="text-rose-500 font-bold">더 빠른 성장세</span>를 보이고 있습니다.
                 </p>
               </div>
               
               <div className="relative mb-4">
                  <input 
                    className="w-full p-3 pl-5 pr-24 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm shadow-sm"
                    placeholder="다른 채널 분석하기..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runRadar()}
                  />
                  <button 
                    onClick={runRadar}
                    className="absolute right-1.5 top-1.5 bottom-1.5 px-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-lg text-xs font-bold"
                  >
                    {status === 'analyzing' || status === 'searching' ? '...' : '재탐지'}
                  </button>
               </div>
               
               {/* Progress / Logs */}
               {(status === 'analyzing' || status === 'searching' || (progress > 0 && progress < 100)) && (
                   <div className="mb-4 p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm animate-in slide-in-from-top-2">
                      <div className="flex justify-between text-xs font-bold mb-2 uppercase tracking-widest text-slate-500">
                         <span>Analysis in progress</span>
                         <span>{progress}%</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-2">
                         <div className="h-full bg-indigo-500 transition-all duration-300 ease-out" style={{width: `${progress}%`}}></div>
                      </div>
                      <p className="text-xs font-medium text-indigo-500 animate-pulse">{logs[logs.length-1]}</p>
                   </div>
               )}
           </div>

           {/* Results Grid */}
           <div>
              {results.length === 0 && status === 'done' ? (
                 <div className="flex flex-col items-center justify-center py-20 opacity-50">
                    <span className="material-symbols-outlined text-4xl mb-2">radar</span>
                    <p className="font-bold">결과 없음</p>
                 </div>
              ) : (
                  <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
                      {results.slice(0, displayLimit).map((video) => (
                        <div 
                          key={video.id} 
                          onClick={() => onVideoClick?.(video)}
                          className="bg-white dark:bg-slate-800 rounded-xl overflow-hidden shadow-sm border border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow group cursor-pointer"
                        >
                            <div className="aspect-video relative overflow-hidden">
                                <img src={video.thumbnailUrl} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                                <div className="absolute top-2 right-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-[10px] font-black px-2 py-1 rounded-md shadow-lg flex items-center gap-0.5">
                                  <span className="material-symbols-outlined text-[10px]">local_fire_department</span>
                                  {video.viralScore}
                                </div>
                                <div className="absolute bottom-2 right-2 bg-black/80 text-white text-[10px] font-medium px-1.5 py-0.5 rounded">
                                  {video.duration}
                                </div>
                            </div>
                            <div className="p-4">
                                <h3 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-2 leading-snug mb-2 group-hover:text-indigo-500 transition-colors">{video.title}</h3>
                                <div className="flex items-center gap-2 mb-3">
                                  <div className="size-6 bg-slate-200 rounded-full flex-shrink-0 relative overflow-hidden">
                                     {video.channelThumbnail ? <img src={video.channelThumbnail} className="w-full h-full object-cover" /> : null}
                                  </div> 
                                  <p className="text-xs text-slate-500 truncate font-medium">{video.channelName}</p>
                                </div>
                                <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-700">
                                  <div className="flex flex-col">
                                      <span className="text-[10px] text-slate-400">조회수 속도</span>
                                      <span className="text-xs font-bold text-indigo-500">{video.velocity.toLocaleString()}/hr</span>
                                  </div>
                                  <div className="flex flex-col items-end">
                                      <span className="text-[10px] text-slate-400">업로드</span>
                                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{video.uploadTime}</span>
                                  </div>
                                </div>
                            </div>
                        </div>
                      ))}
                  </div>
                  {results.length > displayLimit && (
                    <div className="text-center mt-8 pb-10">
                        <button 
                          onClick={() => setDisplayLimit(p => p + 12)}
                          className="px-8 py-3 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-white rounded-full text-sm font-bold hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors shadow-sm"
                        >
                          더 보기 ({results.length - displayLimit}개 남음)
                        </button>
                    </div>
                  )}
                </>
              )}
           </div>
        </div>
     );
  };

  return (
    <div className="w-full animate-in fade-in duration-300">
       {/* Conditional Rendering: Dashboard vs Results */}
       {((!results || results.length === 0) && status === 'idle')
          ? RadarDashboard()
          : renderResults()}
    </div>
  );
};

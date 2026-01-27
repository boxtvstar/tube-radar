import React, { useState, useEffect } from 'react';
import { 
  getChannelInfo, 
  performRadarScan, 
  searchChannelsByKeyword, 
  getChannelUploadsPlaylistId, 
  getPlaylistItems 
} from '../../services/youtubeService';

interface ChannelRadarProps {
  apiKey: string;
  onClose: () => void;
  onVideoClick?: (video: RadarVideo) => void;
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
}

// Helper for Category Names
const CATEGORY_NAMES: Record<string, string> = {
  '1': '영화/애니', '2': '자동차', '10': '음악', '15': '동물', '17': '스포츠',
  '18': '단편영화', '19': '여행', '20': '게임', '22': '브이로그/인물', '23': '코미디',
  '24': '엔터테인먼트', '25': '뉴스/정치', '26': '노하우/스타일', '27': '교육',
  '28': '과학/기술', '29': '비영리/사회'
};

export const ChannelRadar = ({ apiKey, onClose, onVideoClick }: ChannelRadarProps) => {
  const [input, setInput] = useState('');
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'searching' | 'fetching' | 'calculating' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<string[]>([]);
  const [results, setResults] = useState<RadarVideo[]>([]);
  const [displayLimit, setDisplayLimit] = useState(12);

  // Dashboard Data State
  const [trendingChannels, setTrendingChannels] = useState<{
    id: string; title: string; subs: string; growth: string; thumbnail: string; category: string; publishedAt: string; tags: string[];
  }[]>([]);
  const [popularKeywords, setPopularKeywords] = useState<string[]>([]);
  const [categoryStats, setCategoryStats] = useState<{cat: string, engagement: string, score: number}[]>([]);
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true);

  // Mount/Unmount logging
  useEffect(() => {
    return () => { setResults([]); };
  }, []);

  const addLog = (msg: string) => setLogs(prev => [...prev, msg]);

  const runRadar = async () => {
    if (!input.trim()) return;
    setStatus('analyzing');
    setResults([]);
    setLogs([]);
    setProgress(10);
    setDisplayLimit(12); 
    
    try {
      addLog(`분석 시작: ${input}`);
      
      const channelInfo = await getChannelInfo(apiKey, input);
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
         publishedAt: r.video.publishedAt || ''
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
                   thumbnail: v.snippet.thumbnails.default.url, 
                   category: CATEGORY_NAMES[v.snippet.categoryId] || '엔터테인먼트',
                   velocity: (parseInt(v.statistics.viewCount) / (Math.max(1, (Date.now() - new Date(v.snippet.publishedAt).getTime()) / (1000 * 60 * 60)))).toFixed(0)
                });
             }
             if (uniqueChannels.size >= 12) break;
          }
          
          // Fetch exact subscribers & branding for these 4 channels
          const channelIds = Array.from(uniqueChannels.keys()).join(',');
          const chRes = await fetch(`https://www.googleapis.com/youtube/v3/channels?part=statistics,snippet,brandingSettings&id=${channelIds}&key=${apiKey}`);
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
                thumbnail: ch.snippet.thumbnails.default.url, 
                subs: subs, 
                growth: growth,
                publishedAt: validDate, 
                tags: tags
             };
          });

          setTrendingChannels(finalChannels);

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
             
             <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 md:gap-4">
                {trendingChannels.map((ch, idx) => (
                   <div key={idx} className="bg-white dark:bg-slate-900 rounded-xl md:rounded-2xl p-3 md:p-5 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden group hover:border-indigo-500/30 transition-all cursor-pointer" 
                     onClick={() => onVideoClick?.({
                        id: `dashboard_${ch.id}`,
                        title: ch.title,
                        channelId: ch.id,
                        channelName: ch.title,
                        thumbnailUrl: ch.thumbnail,
                        channelThumbnail: ch.thumbnail,
                        // Dummy required fields
                        views: '0',
                        publishedAt: ch.publishedAt || new Date().toISOString(),
                        velocity: 0,
                        spikeScore: 0,
                        performanceRatio: 0,
                        duration: '0:00',
                         subscribers: ch.subs,
                         avgViews: '0',
                         viralScore: '0',
                         uploadTime: '',
                         category: ch.category,
                         reachPercentage: 0,
                         tags: ch.tags
                      })}
                   >
                      <div className="flex justify-between items-start mb-3 md:mb-4">
                         <div className="flex gap-2 md:gap-3 min-w-0">
                            <img src={ch.thumbnail} className="size-10 md:size-12 rounded-full border border-slate-100 dark:border-slate-800 shrink-0" />
                            <div className="min-w-0">
                               <h4 className="font-bold text-xs md:text-sm text-slate-900 dark:text-white line-clamp-1 leading-tight">{ch.title}</h4>
                               <p className="text-[10px] md:text-xs text-slate-500 mt-0.5 truncate">{ch.category} • {ch.subs}</p>
                            </div>
                         </div>
                         <div className="text-right shrink-0 ml-2">
                            <span className="text-emerald-500 text-xs md:text-sm font-black">{ch.growth}</span>
                            <p className="text-[8px] md:text-[10px] text-slate-400 whitespace-nowrap">조회속도</p>
                         </div>
                      </div>
                      
                      {/* Mini Bar Chart CSS - Random seed based on index for variety */}
                      <div className="flex items-end gap-0.5 md:gap-1 h-8 md:h-12 mt-3 md:mt-4 opacity-50 group-hover:opacity-100 transition-opacity">
                         {Array.from({length: 8}).map((_, i) => (
                            <div key={i} style={{height: `${30 + Math.random() * 60}%`}} className={`flex-1 rounded-sm ${i === 7 ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-slate-800'}`}></div>
                         ))}
                      </div>
                   </div>
                ))}
                
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
                                <div className="absolute top-2 right-2 bg-indigo-600 text-white text-[10px] font-bold px-2 py-1 rounded-md shadow-lg">
                                  {video.spikeScore.toFixed(1)} P
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
       {((!results || results.length === 0) && status === 'idle') ? (
          <RadarDashboard />
       ) : (
          renderResults()
       )}
    </div>
  );
};

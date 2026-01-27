import React, { useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell } from 'recharts';
import { SavedChannel } from '../../types';

const formatNumber = (num: number) => {
  if (num >= 100000000) return (num / 100000000).toFixed(1) + "억";
  if (num >= 10000) return (num / 10000).toFixed(1) + "만";
  return num.toLocaleString();
};

import { getChannelInfo, fetchChannelPopularVideos } from '../../services/youtubeService';

interface ComparisonViewProps {
  channels: SavedChannel[];
  allChannels?: SavedChannel[];
  onUpdateChannels?: (channels: SavedChannel[]) => void;
  apiKey: string;
  onClose: () => void;
}

export const ComparisonView: React.FC<ComparisonViewProps> = ({ channels, allChannels, onUpdateChannels, apiKey, onClose }) => {
  // Local state for selection mode
  const [tempSelectedIds, setTempSelectedIds] = React.useState<string[]>([]);
  const [searchTerm, setSearchTerm] = React.useState("");

  // Filter channels for selection
  const filteredChannels = useMemo(() => {
    if (!allChannels) return [];
    if (!searchTerm) return allChannels;
    return allChannels.filter(c => c.title.toLowerCase().includes(searchTerm.toLowerCase()));
  }, [allChannels, searchTerm]);

  const toggleSelection = (id: string) => {
    setTempSelectedIds(prev => {
      if (prev.includes(id)) return prev.filter(pid => pid !== id);
      if (prev.length >= 3) return prev; // Max 3
      return [...prev, id];
    });
  };


  /* Selection Mode Logic Moved to Bottom */

  // --- Data Processing Helpers ---
  
  // Parse subscriber count string (e.g. "100만" -> 10000, "1.2M" -> 1200000)
  const parseCount = (val?: string | number) => {
    if (!val) return 0;
    const strVal = String(val).toUpperCase().replace(/,/g, '').replace(/회/g, '').replace(/VIEWS/g, '').trim();
    
    // Extract numeric part using regex to handle cases like "구독자 100명"
    const match = strVal.match(/[\d.]+/);
    if (!match) return 0;
    
    let num = parseFloat(match[0]);
    if (isNaN(num)) return 0;

    if (strVal.includes('K') || strVal.includes('천')) num *= 1000;
    else if (strVal.includes('M') || strVal.includes('만')) num *= 10000;
    else if (strVal.includes('B') || strVal.includes('억')) num *= 100000000;
    else if (strVal.includes('명')) { /* Just unit */ }
    
    return Math.round(num);
  };

  const getRecentAvgViews = (ch: SavedChannel) => {
    if (!ch.topVideos || ch.topVideos.length === 0) return 0;
    // Use up to 5 recent videos
    const recent = ch.topVideos.slice(0, 5);
    let validCount = 0;
    const sum = recent.reduce((acc, vid) => {
       // Try multiple properties for views
       const vRaw = vid.views || (vid as any).viewCount || (vid as any).statistics?.viewCount;
       const v = parseCount(vRaw);
       if(v > 0) validCount++;
       return acc + v;
    }, 0);
    return validCount === 0 ? 0 : Math.round(sum / validCount);
  };

  const getViralScore = (ch: SavedChannel) => {
    // Try multiple properties for subscribers
    const subRaw = ch.subscriberCount || (ch as any).subscribers || (ch as any).statistics?.subscriberCount;
    const subs = parseCount(subRaw);
    const views = getRecentAvgViews(ch);
    if (subs === 0) return 0;
    return parseFloat(((views / subs) * 100).toFixed(1));
  };

  // State for hydrated data
  const [enrichedChannels, setEnrichedChannels] = React.useState<SavedChannel[]>(channels);
  const [loading, setLoading] = React.useState(false);

  // Sync state with prop to prevent blank screen on transition
  // If lengths differ, it means prop updated but hydration/state hasn't caught up. Use prop.
  const displayChannels = enrichedChannels.length === channels.length ? enrichedChannels : channels;

  // Hydrate data on mount or change
  React.useEffect(() => {
    const hydrate = async () => {
      // Check if hydration is needed
      const needsHydration = channels.some(ch => !ch.subscriberCount || !ch.topVideos || ch.topVideos.length === 0);
      
      if (!needsHydration) {
        setEnrichedChannels(channels);
        return;
      }

      setLoading(true);
      try {
        const hydrated = await Promise.all(channels.map(async (ch) => {
          // If we have data, skip fetching to save quota
          if (ch.subscriberCount && ch.topVideos && ch.topVideos.length > 0) return ch;

          // Fetch only what's missing
          const promises: Promise<any>[] = [];
          
          if (!ch.subscriberCount || ch.subscriberCount === '0') {
             promises.push(getChannelInfo(apiKey, ch.id));
          } else {
             promises.push(Promise.resolve(null));
          }

          if (!ch.topVideos || ch.topVideos.length === 0) {
             promises.push(fetchChannelPopularVideos(apiKey, ch.id));
          } else {
             promises.push(Promise.resolve(null));
          }

          const [info, videos] = await Promise.all(promises);

          return {
            ...ch,
            subscriberCount: info?.subscriberCount || ch.subscriberCount || "0",
            videoCount: info?.videoCount || ch.videoCount || "0",
            topVideos: videos || ch.topVideos || []
          };
        }));
        setEnrichedChannels(hydrated);
      } catch (e) {
        console.error("Hydration failed", e);
        // Fallback to original
        setEnrichedChannels(channels); 
      } finally {
        setLoading(false);
      }
    };
    
    // Only run if we have an API key and channels
    if (apiKey && channels.length > 0) {
      hydrate();
    }
  }, [channels, apiKey]);

  // Process data for charts
  const chartData = useMemo(() => {
    return displayChannels.map((ch, idx) => {
      const subRaw = ch.subscriberCount || (ch as any).subscribers || (ch as any).statistics?.subscriberCount;
      return {
        name: ch.title.length > 8 ? ch.title.substring(0, 8) + '..' : ch.title, // Truncate for chart
        fullTitle: ch.title,
        subscribers: parseCount(subRaw),
        avgViews: getRecentAvgViews(ch),
        viralScore: getViralScore(ch),
        color: ['#6366f1', '#ec4899', '#10b981'][idx % 3] // Indigo, Pink, Emerald
      };
    });
  }, [displayChannels]);

  // Find winners for badges
  const maxSubs = Math.max(...chartData.map(d => d.subscribers));
  const maxViews = Math.max(...chartData.map(d => d.avgViews));
  const maxViral = Math.max(...chartData.map(d => d.viralScore));

  // Custom Tooltips for Charts
  const CustomViewTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 p-4 rounded-2xl shadow-2xl text-white min-w-[150px] animate-in zoom-in-95 duration-200">
          <p className="font-bold text-[13px] mb-3 text-slate-200 border-b border-white/10 pb-2">{data.fullTitle}</p>
          <div className="flex items-center justify-between gap-4">
             <div className="flex items-center gap-2">
               <div className="size-2.5 rounded-full shadow-[0_0_8px_currentColor]" style={{ color: data.color, backgroundColor: data.color }}></div>
               <span className="text-xs font-bold text-slate-400 uppercase tracking-tight">평균 조회수</span>
             </div>
             <span className="text-sm font-black text-white tabular-nums">{formatNumber(data.avgViews)}</span>
          </div>
        </div>
      );
    }
    return null;
  };

  const CustomViralTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-slate-900/95 backdrop-blur-xl border border-slate-700/50 p-4 rounded-2xl shadow-2xl text-white min-w-[150px] animate-in zoom-in-95 duration-200">
          <p className="font-bold text-[13px] mb-3 text-slate-200 border-b border-white/10 pb-2">{data.fullTitle}</p>
          <div className="flex items-center justify-between gap-4">
             <div className="flex items-center gap-2">
               <div className="size-2.5 rounded-full shadow-[0_0_8px_currentColor]" style={{ color: data.color, backgroundColor: data.color }}></div>
               <span className="text-xs font-bold text-slate-400 uppercase tracking-tight">바이럴 지수</span>
             </div>
             <div className="flex items-baseline gap-0.5">
               <span className="text-sm font-black text-white tabular-nums">{data.viralScore}</span>
               <span className="text-[10px] text-slate-500 font-bold">%</span>
             </div>
          </div>
        </div>
      );
    }
    return null;
  };

  if (channels.length < 2) {
    const safeAllChannels = allChannels || [];
    const selectionCount = tempSelectedIds.length;

    return (
      <div className="bg-slate-50 dark:bg-black p-6 md:p-10 space-y-6 pb-20 animate-in slide-in-from-right-4 duration-500">
         <div className="w-full max-w-[1800px] mx-auto space-y-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8 py-4 border-b border-slate-200 dark:border-slate-800">
               <div className="space-y-2">
                  <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-indigo-600 dark:text-indigo-400 uppercase flex items-center gap-3">
                     <span className="material-symbols-outlined text-2xl md:text-3xl">compare_arrows</span>
                     채널 비교 분석 <span className="text-indigo-500">PICK</span>
                  </h2>
                  <p className="text-slate-500 text-[11px] font-medium leading-relaxed hidden md:block">
                     비교할 채널을 <span className="text-indigo-600 dark:text-indigo-400 font-bold">2~3개 선택</span>해주세요. 선택 후 분석을 시작하면 주요 지표를 비교할 수 있습니다.<br />
                     현재 선택: <span className="text-rose-500 font-bold">{selectionCount}/3개</span>
                  </p>
               </div>
               
               <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="relative group">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-slate-400 text-lg">filter_list</span>
                      <input 
                          type="text" 
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          placeholder="채널명으로 필터링" 
                          className="w-full sm:min-w-[200px] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl py-2.5 pl-10 pr-4 text-sm font-medium outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all placeholder:text-slate-400"
                      />
                  </div>
                  <button
                      disabled={selectionCount < 2 || !onUpdateChannels}
                      onClick={() => {
                         const selected = (allChannels || []).filter(c => tempSelectedIds.includes(c.id));
                         if (onUpdateChannels) onUpdateChannels(selected);
                      }}
                      className={`px-5 py-2.5 rounded-xl font-bold flex items-center justify-center gap-2 transition-all whitespace-nowrap ${
                         selectionCount >= 2 
                         ? 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg shadow-indigo-500/30 hover:shadow-xl hover:shadow-indigo-500/40 hover:-translate-y-0.5' 
                         : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed opacity-60'
                      }`}
                  >
                      <span className="material-symbols-outlined text-lg">compare_arrows</span>
                      <span>비교하기</span>
                  </button>
               </div>
            </div>

            {safeAllChannels.length === 0 ? (
               <div className="flex-1 flex flex-col items-center justify-center text-slate-500 space-y-4">
                  <span className="material-symbols-outlined text-6xl opacity-20">playlist_add</span>
                  <p className="font-bold">저장된 채널이 없습니다. 먼저 채널을 추가해주세요.</p>
               </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-4 overflow-y-auto min-h-0 p-2">
                   {filteredChannels.map(ch => {
                      const isSelected = tempSelectedIds.includes(ch.id);
                      return (
                         <button 
                            key={ch.id} 
                            onClick={() => toggleSelection(ch.id)}
                            className={`relative group flex flex-col items-center gap-3 p-4 rounded-3xl border transition-all duration-300 ${
                               isSelected 
                               ? 'bg-white dark:bg-slate-900 border-indigo-500 ring-2 ring-indigo-500 shadow-xl scale-[1.02] z-10' 
                               : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700 hover:shadow-md'
                            }`}
                         >
                            <div className="relative">
                               <img src={ch.thumbnail} alt="" className={`size-16 rounded-full object-cover border-2 transition-all ${isSelected ? 'border-indigo-500' : 'border-slate-100 dark:border-slate-800'}`} />
                               {isSelected && (
                                  <div className="absolute -top-1 -right-1 size-7 bg-indigo-500 rounded-full flex items-center justify-center text-white ring-2 ring-white dark:ring-slate-900 animate-in zoom-in">
                                     <span className="material-symbols-outlined text-base font-black">check</span>
                                  </div>
                               )}
                            </div>
                            <div className="text-center w-full">
                               <p className={`font-bold text-sm truncate px-2 ${isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-900 dark:text-slate-200'}`}>{ch.title}</p>
                               <div className="flex flex-col gap-0.5 mt-1.5">
                                  <span className="text-[10px] text-slate-500 font-bold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full mx-auto">
                                     구독자 {ch.subscriberCount}
                                  </span>
                                  <span className="text-[10px] text-slate-400 font-medium">
                                     영상 {ch.videoCount}개
                                  </span>
                               </div>
                            </div>
                         </button>
                      );
                   })}
                </div>
             )}
         </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-50 dark:bg-black p-6 md:p-10 space-y-6 pb-20 animate-in slide-in-from-right-4 duration-500">
       <div className="w-full max-w-[1800px] mx-auto space-y-6">

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8 py-4 border-b border-slate-200 dark:border-slate-800">
        <div className="space-y-2 flex-1">
          <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-indigo-600 dark:text-indigo-400 uppercase flex items-center gap-3">
            <span className="material-symbols-outlined text-2xl md:text-3xl">compare_arrows</span>
            채널 비교 분석 <span className="text-indigo-500">PICK</span>
            {loading && <span className="text-[10px] md:text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded-lg animate-pulse normal-case not-italic font-bold tracking-normal">최신화 중...</span>}
          </h2>
          <p className="text-slate-500 text-[11px] font-medium leading-relaxed hidden md:block">
            선택한 <span className="text-indigo-600 dark:text-indigo-400 font-bold">{channels.length}개 채널의 핵심 지표</span>를 한눈에 비교하세요.<br />
            구독자, 조회수, 바이럴 점수 등 <span className="text-rose-500 font-bold">주요 성과 지표</span>를 시각적으로 확인할 수 있습니다.
          </p>
        </div>
        
        {/* 다시 선택 버튼 */}
        <button 
           onClick={() => {
              // Reset selection and keep logic
              if (onUpdateChannels) onUpdateChannels([]);
              setTempSelectedIds([]); // Reset local selection too
           }}
           className="px-4 md:px-5 py-2 md:py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-2 text-slate-600 dark:text-slate-400 text-sm md:text-base shrink-0 mt-1"
        >
           <span className="material-symbols-outlined text-lg md:text-xl">restart_alt</span>
           <span>다시 선택</span>
        </button>
      </div>

      <div className="space-y-6 md:space-y-8">

        {/* Section 1: Compact Comparison Table */}
        <div className="bg-white dark:bg-slate-900 rounded-xl md:rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
             
           {/* Table Header (Profiles + Basic Stats) */}
           <div className="grid grid-cols-[80px_1fr_1fr_1fr] md:grid-cols-[140px_1fr_1fr_1fr] divide-x divide-slate-100 dark:divide-slate-800 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
              <div className="p-2 md:p-3 flex items-center justify-center font-bold text-slate-400 text-[10px] md:text-xs uppercase tracking-tighter">지표</div>
              {displayChannels.map((ch, idx) => (
                  <div key={ch.id} className="p-2 md:p-4 flex flex-col items-center gap-1.5 md:gap-2 relative group">
                      {idx === 0 && <div className="absolute top-0 w-full h-0.5 bg-indigo-500"></div>}
                      {idx === 1 && <div className="absolute top-0 w-full h-0.5 bg-pink-500"></div>}
                      {idx === 2 && <div className="absolute top-0 w-full h-0.5 bg-emerald-500"></div>}
                      
                      <img src={ch.thumbnail} alt="" className="size-8 md:size-12 rounded-full border-2 border-white dark:border-slate-700 shadow-sm group-hover:scale-105 transition-transform" />
                      <div className="text-center w-full">
                          <h3 className="font-bold text-[10px] md:text-sm text-slate-900 dark:text-white truncate px-0.5 md:px-1">{ch.title}</h3>
                          <div className="flex flex-col items-center justify-center gap-0.5 mt-0.5 md:mt-1">
                             <span className="text-[8px] md:text-[10px] text-slate-500 font-medium bg-slate-100 dark:bg-slate-800 px-1 md:px-1.5 py-0.5 rounded">
                                {ch.subscriberCount}
                             </span>
                             <span className="text-[8px] md:text-[10px] text-slate-400 hidden md:block">
                                영상 {ch.videoCount}개
                             </span>
                          </div>
                      </div>
                  </div>
              ))}
              {Array.from({ length: 3 - displayChannels.length }).map((_, i) => (
                 <div key={i} className="hidden md:block bg-slate-50/30 dark:bg-slate-800/30"></div>
              ))}
           </div>

           {/* Metrics Rows */}
           {[
             { label: "구독자", key: "subscribers", format: true, icon: "group" }, // Renamed logic only, key matches
             { label: "평균 조회수", key: "avgViews", format: true, icon: "analytics" },
             { label: "바이럴 지수", key: "viralScore", format: false, suffix: "x", icon: "bolt" },
           ].map((metric) => {
              const values = chartData.map(d => d[metric.key as keyof typeof d] as number);
              const maxVal = Math.max(...values);
              
              return (
                <div key={metric.key} className="grid grid-cols-[80px_1fr_1fr_1fr] md:grid-cols-[140px_1fr_1fr_1fr] divide-x divide-slate-100 dark:divide-slate-800 border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors last:border-0">
                   <div className="p-2 md:p-4 flex items-center justify-center md:justify-start gap-1.5 md:gap-2 text-slate-500 font-bold text-[10px] md:text-xs">
                      <span className="material-symbols-outlined text-sm md:text-base opacity-50 hidden md:block">{metric.icon}</span>
                      <span className="text-center md:text-left leading-tight">{metric.label}</span>
                   </div>
                   {displayChannels.map((_, idx) => {
                      const val = chartData[idx][metric.key as keyof typeof chartData[0]] as number;
                      const isWinner = val === maxVal && val > 0;
                      
                      return (
                         <div key={idx} className={`p-2 md:p-4 flex items-center justify-center relative ${isWinner ? 'bg-indigo-50/40 dark:bg-indigo-900/10' : ''}`}>
                            <span className={`text-xs md:text-base font-bold ${isWinner ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400'} tabular-nums`}>
                               {metric.format ? formatNumber(val) : val}
                               {metric.suffix && <span className="text-[10px] md:text-xs text-slate-400 ml-0.5 font-normal">{metric.suffix}</span>}
                            </span>
                            {isWinner && (
                               <div className="absolute top-0.5 right-0.5 md:top-3 md:right-3 opacity-80">
                                  <span className="text-xs md:text-sm">👑</span>
                               </div>
                            )}
                         </div>
                      );
                   })}
                   {Array.from({ length: 3 - displayChannels.length }).map((_, i) => <div key={i} className="hidden md:block"></div>)}
                </div>
              );
           })}
        </div>

        {/* Section 2: Charts (Merged) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
          <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-[2.5rem] p-4 md:p-8 border border-slate-200 dark:border-slate-800 shadow-xl">
             <div className="mb-4 md:mb-6 flex items-center gap-2 md:gap-3">
               <div className="p-1.5 md:p-2 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg md:rounded-xl text-indigo-600">
                  <span className="material-symbols-outlined text-lg md:text-xl">bar_chart</span>
               </div>
               <h3 className="text-sm md:text-lg font-black text-slate-900 dark:text-white">평균 조회수 비교</h3>
             </div>
             <div className="h-48 md:h-64">
               <ResponsiveContainer width="100%" height="100%">
                 <BarChart data={chartData} margin={{ top: 10, right: 5, left: -10, bottom: 0 }} barSize={window.innerWidth < 768 ? 30 : 40}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                   <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: window.innerWidth < 768 ? 10 : 12, fontWeight: 'bold', fill:'#94a3b8'}} dy={10} />
                   <Tooltip content={<CustomViewTooltip />} cursor={{fill: '#f1f5f9', radius: 12}} />
                   <Bar dataKey="avgViews" radius={[8, 8, 8, 8]}>
                     {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                   </Bar>
                 </BarChart>
               </ResponsiveContainer>
             </div>
          </div>

          <div className="bg-white dark:bg-slate-900 rounded-2xl md:rounded-[2.5rem] p-4 md:p-8 border border-slate-200 dark:border-slate-800 shadow-xl">
             <div className="mb-4 md:mb-6 flex items-center gap-2 md:gap-3">
               <div className="p-1.5 md:p-2 bg-pink-100 dark:bg-pink-900/30 rounded-lg md:rounded-xl text-pink-500">
                  <span className="material-symbols-outlined text-lg md:text-xl">bolt</span>
               </div>
               <h3 className="text-sm md:text-lg font-black text-slate-900 dark:text-white">바이럴(전파력) 점수</h3>
             </div>
             <div className="h-48 md:h-64">
               <ResponsiveContainer width="100%" height="100%">
                 <BarChart data={chartData} margin={{ top: 10, right: 5, left: -10, bottom: 0 }} barSize={window.innerWidth < 768 ? 30 : 40}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.5} />
                   <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fontSize: window.innerWidth < 768 ? 10 : 12, fontWeight: 'bold', fill:'#94a3b8'}} dy={10} />
                   <Tooltip content={<CustomViralTooltip />} cursor={{fill: '#f1f5f9', radius: 12}} />
                   <Bar dataKey="viralScore" radius={[8, 8, 8, 8]}>
                     {chartData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.8} />)}
                   </Bar>
                 </BarChart>
               </ResponsiveContainer>
             </div>
          </div>
        </div>

        {/* Section 3: Top Video Battle */}
        <div className="bg-slate-900 dark:bg-black rounded-2xl md:rounded-[2.5rem] p-4 md:p-8 lg:p-10 text-white shadow-2xl relative overflow-hidden border border-slate-800">
           {/* Decor */}
           <div className="absolute top-0 right-0 p-6 md:p-10 opacity-5">
              <span className="material-symbols-outlined text-6xl md:text-9xl">emoji_events</span>
           </div>

           <h3 className="text-base md:text-xl font-black mb-4 md:mb-8 relative z-10 flex items-center gap-2 md:gap-3">
             <span className="bg-white/10 p-1.5 md:p-2 rounded-lg text-lg md:text-xl">🔥</span> 
             <span>최고 조회수 영상</span>
           </h3>

           <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 relative z-10">
             {displayChannels.map((ch, idx) => {
               const topVideo = ch.topVideos?.[0];
               
               if (!topVideo) return (
                 <div key={ch.id} className="bg-white/5 rounded-3xl h-full min-h-[240px] flex flex-col items-center justify-center text-white/30 font-bold gap-2">
                    <span className="material-symbols-outlined text-4xl">videocam_off</span>
                    <span>No Data</span>
                 </div>
               );
               
               const videoUrl = `https://www.youtube.com/watch?v=${topVideo.id}`;

               return (
                 <div key={ch.id} className="group flex flex-col h-full bg-slate-800/50 hover:bg-slate-800 p-4 rounded-3xl border border-white/5 hover:border-indigo-500/30 transition-all duration-300">
                    <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="block relative aspect-video rounded-2xl overflow-hidden mb-4 shadow-lg ring-1 ring-white/10 group-hover:ring-indigo-500/50">
                      <img src={topVideo.thumbnail} alt={topVideo.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                      <div className="absolute inset-0 bg-black/20 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                        <div className="size-12 rounded-full bg-white/20 backdrop-blur-md flex items-center justify-center group-hover:scale-110 transition-transform">
                             <span className="material-symbols-outlined text-white text-3xl drop-shadow-lg pl-1">play_arrow</span>
                        </div>
                      </div>
                    </a>
                    
                    <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="block mb-3 grow">
                      <h4 className="font-bold text-sm line-clamp-2 leading-relaxed text-slate-200 group-hover:text-white transition-colors">
                        {topVideo.title}
                      </h4>
                    </a>

                    <div className="mt-auto flex items-center justify-between border-t border-white/5 pt-3">
                       <div className="flex items-center gap-2 min-w-0 pr-2">
                          <img src={ch.thumbnail} className="size-6 rounded-full border border-white/10 shrink-0" alt="" />
                          <span className="text-xs font-bold text-slate-400 truncate">{ch.title}</span>
                       </div>
                       <div className="text-xs font-black text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded-lg shrink-0">
                         {((topVideo as any).viewCountRaw ? (topVideo as any).viewCountRaw.toLocaleString() : parseCount(topVideo.views).toLocaleString())}회
                       </div>
                    </div>
                 </div>
               );
             })}
           </div>
        </div>

      </div>
      </div>
    </div>
  );
};

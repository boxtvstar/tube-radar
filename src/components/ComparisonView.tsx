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

  // Mode 1: Selection View (When < 2 channels)
  // If we don't have enough channels, we show the picker.
  if (channels.length < 2) {
    const safeAllChannels = allChannels || [];
    
    return (
      <div className="flex-1 bg-slate-50 dark:bg-black overflow-y-auto p-4 md:p-8 animate-in slide-in-from-bottom-4 duration-500">
         <div className="max-w-5xl mx-auto h-full flex flex-col">
            <div className="flex items-center justify-between mb-8">
               <div>
                  <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
                     비교할 채널 선택 <span className="text-indigo-500">PICK</span>
                  </h1>
                  <p className="text-slate-500 font-bold text-sm mt-2">
                     내 리스트에서 비교할 채널을 2개 또는 3개 선택해주세요.
                  </p>
               </div>
               <button onClick={onClose} className="px-6 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
                  닫기
               </button>
            </div>

            {safeAllChannels.length === 0 ? (
               <div className="flex-1 flex flex-col items-center justify-center text-slate-500 space-y-4">
                  <span className="material-symbols-outlined text-6xl opacity-20">playlist_add</span>
                  <p className="font-bold">저장된 채널이 없습니다. 먼저 채널을 추가해주세요.</p>
               </div>
            ) : (
               <>
                <div className="relative mb-6">
                   <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-slate-400">search</span>
                   <input 
                      type="text" 
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder="채널 검색..." 
                      className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl py-4 pl-12 pr-4 font-bold outline-none focus:ring-2 focus:ring-indigo-500"
                   />
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 overflow-y-auto min-h-0 p-2">
                   {filteredChannels.map(ch => {
                      const isSelected = tempSelectedIds.includes(ch.id);
                      return (
                         <button 
                            key={ch.id} 
                            onClick={() => toggleSelection(ch.id)}
                            className={`relative group flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all ${
                               isSelected 
                               ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-500 ring-2 ring-indigo-500/20' 
                               : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-700'
                            }`}
                         >
                            <div className="relative">
                               <img src={ch.thumbnail} alt="" className={`size-16 rounded-full object-cover border transition-all ${isSelected ? 'border-indigo-500 scale-110' : 'border-slate-200 dark:border-slate-700 group-hover:scale-105'}`} />
                               {isSelected && (
                                  <div className="absolute -top-1 -right-1 size-6 bg-indigo-500 rounded-full flex items-center justify-center text-white ring-2 ring-white dark:ring-slate-900">
                                     <span className="material-symbols-outlined text-sm font-black">check</span>
                                  </div>
                               )}
                            </div>
                            <div className="text-center w-full">
                               <p className={`text-sm font-bold truncate ${isSelected ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300'}`}>{ch.title}</p>
                               <p className="text-[10px] text-slate-400 uppercase font-black mt-0.5">
                                  {ch.groupId === 'unassigned' ? '미분류' : '구독중'}
                               </p>
                            </div>
                         </button>
                      );
                   })}
                </div>

                <div className="mt-8 flex justify-end">
                   <button
                      disabled={tempSelectedIds.length < 2 || !onUpdateChannels}
                      onClick={() => {
                         const selected = (allChannels || []).filter(c => tempSelectedIds.includes(c.id));
                         if (onUpdateChannels) onUpdateChannels(selected);
                      }}
                      className={`px-8 py-4 rounded-2xl font-black text-lg flex items-center gap-2 transition-all ${
                         tempSelectedIds.length >= 2 
                         ? 'bg-indigo-600 text-white shadow-xl hover:bg-indigo-700 hover:scale-105' 
                         : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                      }`}
                   >
                      <span>비교 분석 시작하기</span>
                      <span className="material-symbols-outlined">arrow_forward</span>
                   </button>
                </div>
               </>
            )}
         </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-slate-50 dark:bg-black overflow-y-auto p-4 md:p-8 animate-in slide-in-from-bottom-4 duration-500 relative">

      {/* Header */}
      <div className="max-w-7xl mx-auto mb-10 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="bg-indigo-600 p-3 rounded-2xl shadow-lg shadow-indigo-600/20">
            <span className="material-symbols-outlined text-white text-2xl">compare_arrows</span>
          </div>
          <div>
            <h1 className="text-3xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
              채널 비교 분석 <span className="text-indigo-500">VS</span>
              {loading && <span className="text-xs bg-indigo-50 text-indigo-600 px-2 py-1 rounded-lg animate-pulse">데이터 최신화 중...</span>}
            </h1>
            <p className="text-slate-500 font-bold text-sm mt-1">
              선택한 {channels.length}개 채널의 퍼포먼스를 1:1로 비교합니다.
            </p>
          </div>
        </div>
        <button 
          onClick={onClose}
          className="px-6 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl font-bold hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          닫기
        </button>
      </div>

      <div className="max-w-7xl mx-auto space-y-8">
        
        {/* Round 1: Head-to-Head Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {displayChannels.map((ch, idx) => {
            const stats = chartData[idx];
            const isSubKing = stats.subscribers === maxSubs && maxSubs > 0;
            const isViewKing = stats.avgViews === maxViews && maxViews > 0;

            return (
              <div key={ch.id} className="relative bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-xl overflow-hidden group hover:scale-[1.02] transition-transform duration-300">
                {/* Background Decor */}
                <div className={`absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-${['indigo','pink','emerald'][idx % 3]}-500/10 to-transparent rounded-bl-full pointer-events-none`}></div>
                
                <div className="flex items-center gap-4 mb-6 relative z-10">
                  <img src={ch.thumbnail} alt={ch.title} className="size-16 rounded-full border-4 border-slate-100 dark:border-slate-800 shadow-sm" />
                  <div className="min-w-0">
                    <h3 className="font-black text-lg truncate pr-2 text-slate-900 dark:text-white">{ch.title}</h3>
                    <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
                      <span className="bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-slate-500">
                        Player {idx + 1}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="space-y-4 relative z-10">
                  <div className={`p-4 rounded-2xl border ${isSubKing ? 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-700/30' : 'bg-slate-50 dark:bg-slate-800 border-transparent'}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] uppercase font-black text-slate-400">구독자 수</span>
                      {isSubKing && <span className="text-lg">👑</span>}
                    </div>
                    <div className={`text-2xl font-black ${isSubKing ? 'text-amber-500' : 'text-slate-700 dark:text-slate-300'} tabular-nums`}>
                      {formatNumber(stats.subscribers)}
                    </div>
                  </div>

                  <div className={`p-4 rounded-2xl border ${isViewKing ? 'bg-indigo-50 dark:bg-indigo-900/10 border-indigo-200 dark:border-indigo-700/30' : 'bg-slate-50 dark:bg-slate-800 border-transparent'}`}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] uppercase font-black text-slate-400">평균 조회수 (최근 5개)</span>
                      {isViewKing && <span className="material-symbols-outlined text-indigo-500 text-lg">trending_up</span>}
                    </div>
                    <div className={`text-2xl font-black ${isViewKing ? 'text-indigo-500' : 'text-slate-700 dark:text-slate-300'} tabular-nums`}>
                      {formatNumber(stats.avgViews)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Round 2: Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Recent Performance Chart */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200 dark:border-slate-800 shadow-xl">
            <h3 className="text-lg font-black text-slate-900 dark:text-white mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-slate-400">bar_chart</span>
              최근 퍼포먼스 비교
            </h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 30, left: 40, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" opacity={0.3} />
                  <XAxis type="number" hide />
                  <YAxis type="category" dataKey="name" width={80} tick={{fontSize: 12, fontWeight: 'bold', fill:'#94a3b8'}} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomViewTooltip />} cursor={{fill: 'transparent'}} />
                  <Bar dataKey="avgViews" radius={[0, 10, 10, 0]} barSize={40}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-center text-slate-400 mt-4 font-bold">최근 업로드 영상 5개의 평균 조회수</p>
          </div>

          {/* Viral Score Chart */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200 dark:border-slate-800 shadow-xl">
            <h3 className="text-lg font-black text-slate-900 dark:text-white mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-slate-400">bolt</span>
              바이럴 지수 (조회수/구독자)
            </h3>
             <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" opacity={0.3} />
                  <XAxis dataKey="name" tick={{fontSize: 11, fontWeight: 'bold', fill:'#94a3b8'}} axisLine={false} tickLine={false} />
                  <YAxis hide />
                  <Tooltip content={<CustomViralTooltip />} cursor={{fill: '#f1f5f9', radius: 8}} />
                  <Bar dataKey="viralScore" radius={[8, 8, 8, 8]} barSize={50}>
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} fillOpacity={0.8} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <p className="text-xs text-center text-slate-400 mt-4 font-bold">구독자 수 대비 조회수 비율 (%)</p>
          </div>
        </div>

        {/* Round 3: Top Video Battle */}
        <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-[2.5rem] p-8 md:p-12 text-white shadow-2xl relative overflow-hidden">
             
           {/* Decor */}
           <div className="absolute top-0 right-0 p-10 opacity-10">
              <span className="material-symbols-outlined text-9xl">emoji_events</span>
           </div>

           <h3 className="text-2xl font-black mb-10 relative z-10 flex items-center gap-3">
             <span className="bg-white/10 p-2 rounded-lg">🔥</span> 
             최고 조회수 영상 배틀
           </h3>

           <div className="grid grid-cols-1 md:grid-cols-3 gap-8 relative z-10">
             {displayChannels.map((ch, idx) => {
               const topVideo = ch.topVideos?.[0]; // Assuming sorted by views or we assume first is representative
               
               if (!topVideo) return (
                 <div key={ch.id} className="bg-white/5 rounded-2xl h-full min-h-[200px] flex flex-col items-center justify-center text-white/30 font-bold gap-2">
                    <span className="material-symbols-outlined text-4xl">videocam_off</span>
                    <span>No Data</span>
                 </div>
               );
               
               const videoUrl = `https://www.youtube.com/watch?v=${topVideo.id}`;
               const channelUrl = `https://www.youtube.com/channel/${ch.id}`;

               return (
                 <div key={ch.id} className="group flex flex-col h-full bg-slate-800/50 p-4 rounded-2xl border border-white/5 hover:border-white/10 transition-all">
                    {/* Thumbnail Link */}
                    <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="block relative aspect-video rounded-xl overflow-hidden mb-4 shadow-lg ring-1 ring-white/10 group-hover:scale-105 transition-transform duration-300">
                      <img src={topVideo.thumbnail} alt={topVideo.title} className="w-full h-full object-cover" />
                      <div className="absolute bottom-2 right-2 bg-black/80 px-2 py-1 rounded text-[10px] font-bold">
                        {topVideo.duration || 'Shorts'}
                      </div>
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                        <span className="material-symbols-outlined text-white text-4xl drop-shadow-lg scale-75 group-hover:scale-100 transition-transform">play_circle</span>
                      </div>
                    </a>
                    
                    {/* Title Link */}
                    <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="block mb-2 grow group/title">
                      <h4 className="font-bold text-sm line-clamp-2 leading-relaxed text-slate-200 group-hover/title:text-white transition-colors">
                        {topVideo.title}
                      </h4>
                    </a>

                    {/* Stats & Channel Link */}
                    <div className="mt-auto pt-3 border-t border-white/5 flex items-center justify-between gap-2">
                       <a href={channelUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-xs font-bold text-slate-400 hover:text-indigo-400 transition-colors min-w-0">
                         <img src={ch.thumbnail} className="size-5 rounded-full border border-white/10" alt="" />
                         <span className="truncate">{ch.title}</span>
                       </a>
                       <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 shrink-0 border border-emerald-500/20 tabular-nums">
                         {((topVideo as any).viewCountRaw ? (topVideo as any).viewCountRaw.toLocaleString() : parseCount(topVideo.views).toLocaleString())}회
                       </span>
                    </div>
                 </div>
               );
             })}
           </div>
        </div>

      </div>
    </div>
  );
};

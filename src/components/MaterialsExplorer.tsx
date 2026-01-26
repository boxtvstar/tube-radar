import React, { useState, useEffect, useMemo } from 'react';
import { Footer } from './Footer';
import { searchVideosForMaterials } from '../../services/youtubeService';
import { VideoData, ChannelGroup } from '../../types';

interface MaterialsExplorerProps {
  apiKey: string;
  groups: ChannelGroup[];
  onSave: (videos: VideoData[], groupId: string) => Promise<void>;
  onClose: () => void;
}

type FilterDays = 1 | 7 | 30;
type FilterType = 'all' | 'shorts' | 'long';
type SortType = 'views' | 'velocity';

export const MaterialsExplorer: React.FC<MaterialsExplorerProps> = ({ apiKey, groups, onSave, onClose }) => {
  // Search State
  const [query, setQuery] = useState(() => sessionStorage.getItem('me_last_query') || '');
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [rawResults, setRawResults] = useState<VideoData[]>(() => {
    try {
      const saved = sessionStorage.getItem('me_last_results');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  
  // Filters
  const [days, setDays] = useState<FilterDays>(7); // Default 7 (changed from 24h as per some contexts, but user asked for 24h, 7d, 30d. Let's start with 7)
  const [videoType, setVideoType] = useState<FilterType>('all');
  const [sortBy, setSortBy] = useState<SortType>('velocity');

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [detailedVideo, setDetailedVideo] = useState<VideoData | null>(null);

  // Modals
  const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
  const [targetGroupId, setTargetGroupId] = useState<string>('');
  const [isCreatingGroup, setIsCreatingGroup] = useState(false); // If we want to support creation inline, but user requirements imply selection.
  // Actually requirement says: "New Group Creation" OR "Existing Group Selection".
  // Assuming App passed simple group list, we might need a callback to create group?
  // For simplicity, let's stick to existing groups first or just text input for new group if API supports it.
  // The prop onSave takes groupId. If we want new group, we need standard way.
  // Let's assume user selects existing or we might handle 'new' string differently?
  // Let's use existing groups for now as per `groups` prop.

  // --- Effects ---
  useEffect(() => {
    const saved = localStorage.getItem('materials_search_history');
    if (saved) setSearchHistory(JSON.parse(saved));
  }, []);

  // --- Handlers ---
  const handleSearch = async () => {
    if (!query.trim()) return;
    
    // Save History
    const newHistory = [query, ...searchHistory.filter(h => h !== query)].slice(0, 8);
    setSearchHistory(newHistory);
    localStorage.setItem('materials_search_history', JSON.stringify(newHistory));

    setLoading(true);
    setSelectedIds(new Set()); // Reset selection
    try {
      // API call
      // User asked for "View Count" or "Velocity" sort. 
      // API 'order' param supports 'viewCount', 'date', 'relevance'. 
      // Velocity sort is client-side usually if we search by date to get recent trends?
      // Or search by viewCount?
      // User requirement: "Search via keyword for recent videos". 
      // Usually date sort is better for "Recent", then client sort by Velocity.
      const results = await searchVideosForMaterials(apiKey, query, days, 'date'); 
      setRawResults(results);
      
      // Cache results to Session Storage
      sessionStorage.setItem('me_last_query', query);
      sessionStorage.setItem('me_last_results', JSON.stringify(results));
    } catch (e) {
      console.error(e);
      setRawResults([]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const toggleSelection = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredVideos.length) {
      setSelectedIds(new Set());
    } else {
      const next = new Set(filteredVideos.map(v => v.id));
      setSelectedIds(next);
    }
  };

  // --- Derived State (Filtering & Sorting) ---
  const filteredVideos = useMemo(() => {
    let list = [...rawResults];

    // Type Filter
    if (videoType === 'shorts') {
      list = list.filter(v => (v.durationSec || 0) <= 60 && (v.durationSec || 0) > 0);
    } else if (videoType === 'long') {
      list = list.filter(v => (v.durationSec || 0) > 60);
    }

    // Sort
    if (sortBy === 'views') {
      list.sort((a, b) => {
         const va = parseInt(a.views.replace(/,/g, '').replace(/만/g, '0000').replace(/억/g, '00000000'));
         const vb = parseInt(b.views.replace(/,/g, '').replace(/만/g, '0000').replace(/억/g, '00000000'));
         return vb - va;
      });
    } else if (sortBy === 'velocity') {
       list.sort((a, b) => (b.velocity || 0) - (a.velocity || 0));
    }

    return list;
  }, [rawResults, videoType, sortBy]);


  const selectedCount = selectedIds.size;
  const isAllSelected = filteredVideos.length > 0 && selectedCount === filteredVideos.length;

  // --- Render ---

  return (
    <div className="flex-1 flex flex-col h-full bg-slate-50 dark:bg-black text-slate-900 dark:text-white relative overflow-y-auto">
      
      {/* (A) Top Area - Search */}
      <div className="p-6">
        <div className="max-w-7xl mx-auto space-y-4">
            <h1 className="text-2xl font-black italic tracking-tighter uppercase flex items-center gap-2">
               <span className="material-symbols-outlined text-indigo-500">travel_explore</span>
               키워드 소재 탐색
            </h1>
            
            <div className="flex gap-2">
               <div className="relative flex-1">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 material-symbols-outlined text-slate-400">search</span>
                  <input 
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="관심 키워드를 입력하여 요즘 뜨는 소재를 찾아보세요 (예: AI, 재테크, 캠핑)"
                    className="w-full pl-12 pr-4 py-4 rounded-2xl bg-slate-100 dark:bg-slate-800 border-none focus:ring-2 focus:ring-indigo-500 font-bold text-lg outline-none transition-all placeholder:font-medium"
                  />
               </div>
               <button 
                  onClick={handleSearch}
                  disabled={loading}
                  className="px-8 py-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl font-black text-lg transition-colors flex items-center gap-2 disabled:opacity-50"
               >
                 {loading ? <span className="material-symbols-outlined animate-spin">refresh</span> : '검색'}
               </button>
            </div>

            {searchHistory.length > 0 && (
               <div className="flex gap-2 flex-wrap">
                  {searchHistory.map(h => (
                     <button 
                       key={h} 
                       onClick={() => { setQuery(h); }}
                       className="px-3 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-xs font-bold text-slate-500 dark:text-slate-400 transition-colors flex items-center gap-1"
                     >
                        {h}
                        <span className="material-symbols-outlined text-[10px]" onClick={(e) => {
                           e.stopPropagation();
                           setSearchHistory(prev => prev.filter(item => item !== h));
                           localStorage.setItem('materials_search_history', JSON.stringify(searchHistory.filter(item => item !== h)));
                        }}>close</span>
                     </button>
                  ))}
               </div>
            )}
        </div>
      </div>

      {/* (B) Search Options Bar */}
      <div className="border-b border-slate-200 dark:border-slate-800">
         <div className="max-w-7xl mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-4">
            
            <div className="flex items-center gap-6">
               {/* 1) Date Filter */}
               <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 uppercase">기간</span>
                  <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                     {[1, 7, 30].map(d => (
                        <button
                           key={d}
                           onClick={() => setDays(d as FilterDays)}
                           className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${days === d ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                           {d === 1 ? '24시간' : `${d}일`}
                        </button>
                     ))}
                  </div>
               </div>

               {/* 2) Type Filter */}
               <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-400 uppercase">타입</span>
                  <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                     {(['all', 'shorts', 'long'] as const).map(t => (
                        <button
                           key={t}
                           onClick={() => setVideoType(t)}
                           className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${videoType === t ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                        >
                           {t === 'all' ? '전체' : t === 'shorts' ? 'Shorts' : '롱폼'}
                        </button>
                     ))}
                  </div>
               </div>
            </div>

            {/* 3) Sort */}
            <div className="flex items-center gap-2">
               <span className="text-xs font-bold text-slate-400 uppercase">정렬</span>
               <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1">
                   <button onClick={() => setSortBy('velocity')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${sortBy === 'velocity' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-400'}`}>속도순</button>
                   <button onClick={() => setSortBy('views')} className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${sortBy === 'views' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-400'}`}>조회수순</button>
               </div>
            </div>

         </div>
      </div>

      {/* (C) Main List */}
      <div className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full">
         <div className="flex items-center justify-between mb-4">
             <h2 className="text-sm font-bold text-slate-500">
                검색 결과 <span className="text-slate-900 dark:text-white ml-1">{filteredVideos.length}개</span>
                {videoType !== 'all' && <span className="text-indigo-500 ml-2">({videoType} 필터링됨)</span>}
             </h2>
             <button onClick={toggleAll} className="text-xs font-bold text-indigo-500 hover:underline">
                {isAllSelected ? '전체 해제' : '전체 선택'}
             </button>
         </div>

         {loading ? (
            <div className="flex flex-col items-center justify-center py-40 gap-4">
               <div className="size-12 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
               <p className="text-slate-400 font-bold text-sm animate-pulse">{days === 1 ? '지난 24시간 동안의' : `지난 ${days}일간의`} 데이터를 분석 중입니다...</p>
            </div>
         ) : filteredVideos.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
               {filteredVideos.map((video) => {
                  const isSelected = selectedIds.has(video.id);
                  const isShorts = (video.durationSec || 0) <= 60 && (video.durationSec || 0) > 0;

                  return (
                     <div 
                        key={video.id} 
                        onClick={() => setDetailedVideo(video)}
                        className={`group bg-white dark:bg-slate-900 border ${isSelected ? 'border-indigo-500 ring-1 ring-indigo-500' : 'border-slate-200 dark:border-slate-800'} rounded-xl overflow-hidden hover:shadow-lg transition-all cursor-pointer relative`}
                     >  
                        <div className="aspect-video relative bg-black">
                           <img src={video.thumbnailUrl} className="w-full h-full object-cover opacity-90 group-hover:opacity-100 transition-opacity" loading="lazy" />
                           {/* Checkbox Overlay */}
                           <div className="absolute top-2 left-2 z-10" onClick={(e) => { e.stopPropagation(); toggleSelection(video.id); }}>
                              <div className={`size-6 rounded-md border-2 ${isSelected ? 'bg-indigo-600 border-indigo-600' : 'bg-black/40 border-white/70'} flex items-center justify-center transition-colors`}>
                                 {isSelected && <span className="material-symbols-outlined text-white text-base">check</span>}
                              </div>
                           </div>
                           {/* Badges */}
                           <div className="absolute bottom-2 right-2 flex gap-1">
                              <span className="bg-black/80 text-white text-[10px] font-black px-1.5 py-0.5 rounded">{video.duration}</span>
                              {isShorts && <span className="bg-rose-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded flex items-center"><span className="material-symbols-outlined text-[10px] mr-0.5">bolt</span>Shorts</span>}
                           </div>
                        </div>
                        
                        <div className="p-4">
                           <h3 className="font-bold text-sm text-slate-900 dark:text-white line-clamp-2 leading-tight mb-2 h-10">{video.title}</h3>
                           
                           <div className="flex items-center gap-2 mb-3">
                              <span className="text-xs text-slate-500 font-medium truncate flex-1">{video.channelName}</span>
                              <span className="text-[10px] text-slate-400">{video.uploadTime}</span>
                           </div>

                           <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-lg p-2">
                              <div className="flex flex-col">
                                 <span className="text-[10px] text-slate-400 font-bold uppercase">조회수</span>
                                 <span className="text-xs font-black text-slate-700 dark:text-slate-300">{video.views}</span>
                              </div>
                              <div className="flex flex-col items-end">
                                 <span className="text-[10px] text-slate-400 font-bold uppercase">상승속도</span>
                                 <span className="text-xs font-black text-rose-500 flex items-center gap-0.5">
                                    <span className="material-symbols-outlined text-[10px]">trending_up</span>
                                    {video.velocity?.toLocaleString() || 0}/h
                                 </span>
                              </div>
                           </div>
                        </div>
                     </div>
                  );
               })}
            </div>
         ) : (
            <div className="py-32 text-center flex flex-col items-center gap-4">
               <div className="size-20 bg-slate-100 dark:bg-slate-800 rounded-full flex items-center justify-center">
                  <span className="material-symbols-outlined text-4xl text-slate-400">search_off</span>
               </div>
               <p className="text-slate-500 font-medium">검색 결과가 없습니다.<br/>다른 키워드나 기간으로 시도해보세요.</p>
            </div>
         )}
      </div>

      <Footer />

      {/* (5) Bottom Action Bar */}
      {selectedCount > 0 && (
         <div className="fixed bottom-0 inset-x-0 z-50 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 p-4 shadow-[0_-5px_30px_rgba(0,0,0,0.1)] animate-in slide-in-from-bottom-full">
            <div className="max-w-4xl mx-auto flex items-center justify-between">
               <div className="flex items-center gap-3">
                  <div className="size-8 rounded-full bg-indigo-600 text-white flex items-center justify-center font-bold">{selectedCount}</div>
                  <span className="text-sm font-bold text-slate-700 dark:text-slate-300">개의 영상 선택됨</span>
               </div>
               <div className="flex items-center gap-3">
                  <button onClick={() => setSelectedIds(new Set())} className="px-6 py-2.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-600 dark:text-slate-300 font-bold rounded-xl transition-colors">취소</button>
                  <button onClick={() => setIsSaveModalOpen(true)} className="px-8 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl shadow-lg transition-transform hover:scale-105">내 채널 리스트에 담기</button>
               </div>
            </div>
         </div>
      )}

      {/* Group Selection Modal */}
      {isSaveModalOpen && (
         <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl p-6 shadow-2xl animate-in zoom-in-95">
               <h3 className="text-lg font-black text-slate-900 dark:text-white mb-4">저장할 그룹 선택</h3>
               <div className="space-y-2 max-h-[300px] overflow-y-auto mb-6 custom-scrollbar">
                  {groups.map(g => (
                     <button 
                        key={g.id}
                        onClick={() => setTargetGroupId(g.id)}
                        className={`w-full p-4 rounded-xl border flex items-center justify-between ${targetGroupId === g.id ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                     >
                        <span className="font-bold text-sm text-slate-700 dark:text-slate-300">{g.name}</span>
                        {targetGroupId === g.id && <span className="material-symbols-outlined text-indigo-600">check_circle</span>}
                     </button>
                  ))}
               </div>
               <div className="flex justify-end gap-3">
                  <button onClick={() => setIsSaveModalOpen(false)} className="px-5 py-2.5 text-slate-500 font-bold hover:text-slate-700">취소</button>
                  <button 
                     disabled={!targetGroupId}
                     onClick={async () => {
                        const selectedVideos = filteredVideos.filter(v => selectedIds.has(v.id));
                        await onSave(selectedVideos, targetGroupId);
                        setIsSaveModalOpen(false);
                        setSelectedIds(new Set()); // Reset after save
                        alert(`${selectedVideos.length}개의 영상을 저장했습니다.`);
                     }}
                     className="px-6 py-2.5 bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-indigo-700 text-white font-bold rounded-xl transition-colors"
                  >
                     저장하기
                  </button>
               </div>
            </div>
         </div>
      )}

      {/* (7) Right Side Panel - Detail */}
      {detailedVideo && (
         <>
         <div className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" onClick={() => setDetailedVideo(null)}></div>
         <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 p-6 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300">
             <div className="flex items-start justify-between mb-6">
                <h3 className="text-xl font-black text-slate-900 dark:text-white leading-tight flex-1 mr-4">{detailedVideo.title}</h3>
                <button onClick={() => setDetailedVideo(null)} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"><span className="material-symbols-outlined">close</span></button>
             </div>
             
             <div className="flex-1 overflow-y-auto custom-scrollbar space-y-6">
                <div className="aspect-video bg-black rounded-xl overflow-hidden relative shadow-md">
                   <img src={detailedVideo.thumbnailUrl} className="w-full h-full object-cover" />
                </div>
                
                <div className="space-y-4">
                   <div className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                      <div className="size-10 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                         {/* Channel Icon is not in VideoSnippet initially returned by Search? Actually we fetched channel details */}
                         {/* We don't have channel Icon in VideoData interface... using generic icon or try fetching? */}
                         {/* For now use generic */}
                         <span className="material-symbols-outlined w-full h-full flex items-center justify-center text-slate-400">person</span>
                      </div>
                      <div>
                         <p className="font-bold text-sm text-slate-900 dark:text-white">{detailedVideo.channelName}</p>
                         <p className="text-xs text-slate-500">구독자 {detailedVideo.subscribers}</p>
                      </div>
                   </div>

                   <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                         <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">업로드</p>
                         <p className="font-bold text-slate-900 dark:text-white">{detailedVideo.uploadTime}</p>
                         <p className="text-[10px] text-slate-400 mt-0.5">{new Date(detailedVideo.publishedAt || '').toLocaleDateString()}</p>
                      </div>
                      <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                         <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">영상 길이</p>
                         <p className="font-bold text-slate-900 dark:text-white">{detailedVideo.duration}</p>
                      </div>
                      <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl">
                         <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">조회수</p>
                         <p className="font-bold text-indigo-600 dark:text-indigo-400">{detailedVideo.views}</p>
                      </div>
                      <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-xl border border-rose-500/20 bg-rose-50/50 dark:bg-rose-900/10">
                         <p className="text-[10px] text-rose-500 uppercase font-bold mb-1">상승 속도</p>
                         <p className="font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1">
                            <span className="material-symbols-outlined text-base">trending_up</span>
                            {detailedVideo.velocity?.toLocaleString() || 0}/h
                         </p>
                      </div>
                   </div>
                </div>
                
                <a 
                  href={`https://www.youtube.com/watch?v=${detailedVideo.id}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="w-full py-4 bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold rounded-xl flex items-center justify-center gap-2 hover:opacity-90 transition-opacity"
                >
                   <span className="material-symbols-outlined">play_circle</span>
                   유튜브에서 보기
                </a>
                
                {/* Single Save */}
                <button 
                  onClick={() => {
                     setSelectedIds(new Set([detailedVideo.id]));
                     setIsSaveModalOpen(true);
                     // Note: This logic assumes we want to open modal for single item.
                     // The modal logic uses 'selectedIds'. 
                  }}
                  className="w-full py-4 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/20 font-bold rounded-xl flex items-center justify-center gap-2 hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                >
                   <span className="material-symbols-outlined">bookmark_add</span>
                   이 영상만 저장하기
                </button>

             </div>
         </div>
         </>
      )}

    </div>
  );
};

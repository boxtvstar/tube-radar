import React from 'react';
import { RecommendedPackage } from '../../types';

import { useAuth } from '../contexts/AuthContext';
import { ChannelGroup, SavedChannel } from '../../types';
import { getChannelInfo, fetchChannelPopularVideos } from '../../services/youtubeService';
import { saveTopicToDb, savePackageToDb } from '../../services/dbService';

interface RecommendedPackageListProps {
  packages: RecommendedPackage[];
  onAdd: (pkg: RecommendedPackage, targetGroupId: string, newGroupName?: string) => void;
  isAdding?: boolean;
  groups: ChannelGroup[];
  activeGroupId: string;
  mode?: 'package' | 'topic';
  savedChannels?: SavedChannel[];
}

export const RecommendedPackageList: React.FC<RecommendedPackageListProps> = ({ packages, onAdd, isAdding, groups, activeGroupId, mode = 'package', savedChannels = [] }) => {
  const approvedPackages = React.useMemo(() => 
    packages.filter(p => !p.status || p.status === 'approved'), 
  [packages]);

  // Live Timer for Countdown
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000); // Update every minute
    return () => clearInterval(timer);
  }, []);

  const [selectedPackage, setSelectedPackage] = React.useState<RecommendedPackage | null>(null);
  const [selectedChannelIds, setSelectedChannelIds] = React.useState<string[]>([]);
  
  // Group selection state
  const [targetGroupId, setTargetGroupId] = React.useState<string>(activeGroupId === 'all' ? (groups[0]?.id || 'default') : activeGroupId);
  const [isCreatingNewGroup, setIsCreatingNewGroup] = React.useState(false);
  const [newGroupName, setNewGroupName] = React.useState('');
  const [isGroupSelectOpen, setIsGroupSelectOpen] = React.useState(false);

  // Reset group selection when modal opens
  React.useEffect(() => {
    if (selectedPackage) {
      setTargetGroupId(activeGroupId === 'all' ? (groups[0]?.id || 'default') : activeGroupId);
      setIsCreatingNewGroup(false);
      setNewGroupName('');
      // Default: Select ALL channels
      setSelectedChannelIds(selectedPackage.channels.map(c => c.id));
    } else {
      setSelectedChannelIds([]);
    }
  }, [selectedPackage, activeGroupId, groups]);

  const { user } = useAuth();

  // [Restored] Popular Video Preview Logic (Only for Topics)
  const popularVideos = React.useMemo(() => {
    if (selectedPackage && (selectedPackage.category === 'Topic' || mode === 'topic')) {
       // Flatten all top videos from all channels
       const allVideos = selectedPackage.channels.flatMap(ch => ch.topVideos || []);
       // Sort by views
       return allVideos.sort((a,b) => parseInt(b.views.replace(/,/g,'')) - parseInt(a.views.replace(/,/g,''))).slice(0, 6);
    }
    return [];
  }, [selectedPackage, mode]);

  const toggleChannelCallback = (id: string) => {
    setSelectedChannelIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  // --- Proposal Modal State ---
  const [isSuggestModalOpen, setIsSuggestModalOpen] = React.useState(false);
  const [suggestTitle, setSuggestTitle] = React.useState('');
  const [suggestDesc, setSuggestDesc] = React.useState('');
  
  // Interactive Channel Management State
  const [suggestChannelInput, setSuggestChannelInput] = React.useState('');
  const [suggestChannels, setSuggestChannels] = React.useState<SavedChannel[]>([]);
  const [isResolvingSuggest, setIsResolvingSuggest] = React.useState(false);
  const [isSubmittingContext, setIsSubmittingContext] = React.useState(false);
  const [isSuccessSuggest, setIsSuccessSuggest] = React.useState(false);
  const [isMyListOpen, setIsMyListOpen] = React.useState(false);

  // Reset form when opening/closing
  React.useEffect(() => {
    if (!isSuggestModalOpen) {
      setSuggestTitle('');
      setSuggestDesc('');
      setSuggestChannelInput('');
      setSuggestChannels([]);
      setIsSuccessSuggest(false);
    }
  }, [isSuggestModalOpen]);

  // Helper to get API Key
  const getUserApiKey = () => {
    if (!user) return null;
    return localStorage.getItem(`yt_api_key_${user.uid}`) || localStorage.getItem('yt_api_key_guest') || localStorage.getItem('admin_yt_key');
  };

  const handleAddChannelToSuggest = async () => {
    if (!suggestChannelInput.trim()) return;
    const apiKey = getUserApiKey();
    if (!apiKey) return alert("API 키가 필요합니다.");

    setIsResolvingSuggest(true);
    try {
      // Allow multiple inputs (comma/newline) but usually user types one
      const inputs = suggestChannelInput.split(/[,\n\s]+/).filter(s => s.trim().length > 0);
      let addedCount = 0;

      for (const input of inputs) {
        try {
          // Check if already added
          if (suggestChannels.some(c => c.id === input || c.customUrl === input)) continue;
          
          const info = await getChannelInfo(apiKey, input);
          if (info) {
             if (!suggestChannels.some(c => c.id === info.id)) {
                // Fetch Popular Videos only if mode is 'topic'
                if (mode === 'topic') {
                   try {
                      const topVideos = await fetchChannelPopularVideos(apiKey, info.id);
                      info.topVideos = topVideos;
                   } catch (err) {
                      console.log("Failed to fetch videos for topic suggestion", err);
                   }
                } else {
                   info.topVideos = [];
                }

                setSuggestChannels(prev => [...prev, info]);
                addedCount++;
             }
          }
        } catch (e) {
          console.error(`Failed to resolve ${input}`, e);
        }
      }

      if (addedCount > 0) {
        setSuggestChannelInput('');
      } else {
        alert("채널을 찾을 수 없거나 이미 추가되었습니다.");
      }
    } catch (e) {
      alert("검색 중 오류가 발생했습니다.");
    } finally {
      setIsResolvingSuggest(false);
    }
  };

  const handleSuggest = async () => {
    if (!suggestTitle.trim()) return alert("제목을 입력해주세요.");
    if (suggestChannels.length === 0) return alert("최소 1개 이상의 채널을 추가해주세요.");
    if (!user) return alert("로그인이 필요합니다.");

    setIsSubmittingContext(true);
    try {
      const proposalData: RecommendedPackage = {
        id: Date.now().toString(),
        title: suggestTitle,
        description: suggestDesc,
        category: mode === 'topic' ? 'Topic' : 'Community', // 'Topic' for topics, 'Community' for packages
        createdAt: Date.now(),
        channels: suggestChannels,
        channelCount: suggestChannels.length,
        status: 'pending',
        creatorId: user.uid,
        creatorName: user.displayName || 'Anonymous User'
      };

      if (mode === 'topic') {
        await saveTopicToDb(proposalData);
      } else {
        await savePackageToDb(proposalData);
      }
      
      setIsSuccessSuggest(true);
    } catch (e) {
      console.error(e);
      alert("등록 중 오류가 발생했습니다.");
    } finally {
      setIsSubmittingContext(false);
    }
  };

  const isAllSelected = selectedPackage && selectedPackage.channels.length === selectedChannelIds.length;

  // Reusable Group Selector Component
  const renderGroupSelector = (isFooter = false) => (
    <div className={`relative ${isFooter ? 'w-full' : 'min-w-[140px] max-w-[50%]'}`}>
      {isCreatingNewGroup ? (
         <div className="flex items-center gap-1.5 animate-in fade-in zoom-in-95 bg-white dark:bg-slate-800 p-1.5 rounded-xl border-2 border-indigo-500 shadow-lg relative z-50">
            <span className="material-symbols-outlined text-indigo-500 text-lg pl-1">create_new_folder</span>
            <input 
              type="text" 
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="새 그룹명 입력"
              className="flex-1 bg-transparent text-xs font-bold outline-none min-w-[80px] w-full text-slate-900 dark:text-white placeholder:text-slate-400"
              autoFocus
              onKeyDown={(e) => {
                 if (e.key === 'Enter') {
                    // Visual feedback or focus out
                    (e.target as HTMLInputElement).blur();
                 }
              }}
            />
            {/* Confirm Visual Button */}
            <button 
              onClick={(e) => {
                 e.stopPropagation();
                 if (!newGroupName.trim()) return alert("그룹 이름을 입력해주세요.");
                 setTargetGroupId('__NEW_GROUP__');
                 setIsCreatingNewGroup(false);
              }}
              className="size-6 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg flex items-center justify-center transition-colors shadow-sm"
              title="이름 확정"
            >
              <span className="material-symbols-outlined text-sm font-bold">check</span>
            </button>
            {/* Cancel Button */}
            <button 
              onClick={() => setIsCreatingNewGroup(false)} 
              className="size-6 bg-slate-100 dark:bg-slate-700 hover:bg-rose-100 dark:hover:bg-rose-900/40 text-slate-400 hover:text-rose-500 rounded-lg flex items-center justify-center transition-colors"
              title="취소"
            >
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
         </div>
       ) : (
        <>
            <button 
              onClick={() => setIsGroupSelectOpen(!isGroupSelectOpen)}
              className={`w-full flex items-center justify-between text-left bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-300 outline-none transition-colors ${isFooter ? 'py-2.5' : ''}`}
            >
              <div className="flex items-center gap-1.5 truncate mr-1">
                <span className={`material-symbols-outlined text-[14px] ${targetGroupId === '__NEW_GROUP__' ? 'text-emerald-500' : 'text-indigo-500'}`}>
                  {targetGroupId === '__NEW_GROUP__' ? 'create_new_folder' : 'folder'}
                </span>
                <span className={`truncate ${targetGroupId === '__NEW_GROUP__' ? 'text-emerald-600 dark:text-emerald-400 font-black' : ''}`}>
                  {targetGroupId === '__NEW_GROUP__' ? newGroupName : (groups.find(g => g.id === targetGroupId)?.name || '그룹 선택')}
                </span>
              </div>
              <span className={`material-symbols-outlined text-slate-400 text-sm transition-transform shrink-0 ${isGroupSelectOpen ? 'rotate-180' : ''}`}>expand_more</span>
            </button>
            
            {isGroupSelectOpen && (
               <>
                 <div className="fixed inset-0 z-[60]" onClick={() => setIsGroupSelectOpen(false)} />
                 <div className={`absolute ${isFooter ? 'bottom-full mb-1' : 'top-full mt-1'} right-0 w-52 bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden z-[70] animate-in zoom-in-95 duration-200 flex flex-col`}>
                    <div className="p-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
                      <button
                        onClick={() => {
                           setIsCreatingNewGroup(true);
                           setIsGroupSelectOpen(false);
                        }}
                        className="w-full text-left px-3 py-2.5 text-xs font-bold text-white bg-indigo-500 hover:bg-indigo-600 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
                      >
                         <span className="material-symbols-outlined text-[16px]">create_new_folder</span>
                         새 그룹 만들기
                      </button>
                    </div>
                    <div className="max-h-60 overflow-y-auto custom-scrollbar flex flex-col p-1">
                       <div className="text-[10px] font-bold text-slate-400 px-3 py-1.5 mt-1">저장할 그룹 선택</div>
                       {groups.map(g => (
                          <button
                            key={g.id}
                            onClick={() => {
                               setTargetGroupId(g.id);
                               setIsGroupSelectOpen(false);
                            }}
                            className={`w-full text-left px-3 py-2.5 text-xs font-bold rounded-lg transition-colors flex items-center gap-2 ${targetGroupId === g.id ? 'text-indigo-600 bg-indigo-50 dark:bg-indigo-500/10 dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5'}`}
                          >
                             <span className={`material-symbols-outlined text-[16px] ${targetGroupId === g.id ? 'filled' : ''}`}>folder</span>
                             {g.name}
                          </button>
                       ))}
                    </div>
                 </div>
               </>
            )}
        </>
       )}
    </div>
  );

  return (
    <div className="space-y-6 animate-in slide-in-from-top-4 duration-500">
       <div className="bg-white dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl shadow-xl dark:shadow-2xl relative overflow-hidden">
         <div className="space-y-4 w-full relative z-10">
            <div className="flex items-center justify-between">
               <h2 className={`text-2xl font-black italic tracking-tighter uppercase flex items-center gap-3 ${mode === 'topic' ? 'text-amber-500' : 'text-indigo-500'}`}>
                 <span className="material-symbols-outlined text-3xl">{mode === 'topic' ? 'lightbulb' : 'inventory_2'}</span>
                 {mode === 'topic' ? '유튜브 추천 소재' : '추천 채널 팩'}
               </h2>
               {mode === 'topic' && (
                  <button 
                    onClick={(e) => {
                       e.stopPropagation();
                       console.log("Opening suggest modal");
                       setIsSuggestModalOpen(true);
                    }}
                    className="bg-amber-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-amber-600 transition-colors flex items-center gap-1 shadow-lg shadow-amber-500/20 z-50 cursor-pointer pointer-events-auto"
                  >
                    <span className="material-symbols-outlined text-sm">edit_square</span>
                    <span className="hidden md:inline">추천 소재 공유하기</span>
                  </button>
               )}
               {mode !== 'topic' && (
                  <button 
                    onClick={(e) => {
                       e.stopPropagation();
                       setIsSuggestModalOpen(true);
                    }}
                    className="bg-indigo-500 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-indigo-600 transition-colors flex items-center gap-1 shadow-lg shadow-indigo-500/20 z-50 cursor-pointer pointer-events-auto"
                  >
                    <span className="material-symbols-outlined text-sm">ios_share</span>
                    <span className="hidden md:inline">추천 채널 공유하기</span>
                  </button>
               )}
            </div>
            {mode !== 'topic' ? (
              <p className="text-slate-500 dark:text-slate-400 text-[11px] font-medium leading-relaxed">
                우리들끼리 공유하는 유튜브 채널 모음을 확인하세요. <br />
                원하는 팩을 선택하면 내 모니터링 리스트로 <b>일괄 추가</b>할 수 있습니다.
              </p>
            ) : (
               <p className="text-slate-500 dark:text-slate-400 text-[11px] font-medium leading-relaxed">
                 콘텐츠 제작을 위한 <span className="text-amber-500 font-bold">참신한 소재와 아이디어</span>를 발견하세요.<br />
                 엄선된 주제별 채널들을 통해 새로운 영감을 얻을 수 있습니다.
               </p>
            )}
         </div>
         
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mt-12 relative z-10">
            {approvedPackages.length === 0 ? (
               <div className="col-span-full py-20 text-center text-slate-400 text-sm font-medium">
                  {mode === 'topic' ? '등록된 추천 소재가 없습니다.' : '등록된 추천 팩이 없습니다.'}
               </div>
            ) : (
               approvedPackages.slice(0, 8).map((pkg) => {
                const isScheduled = pkg.scheduledAt && new Date(pkg.scheduledAt).getTime() > now;
                const scheduledDate = pkg.scheduledAt ? new Date(pkg.scheduledAt) : null;
                
                // Calculate simplistic countdown for display
                let countdown = "";
                if (isScheduled && scheduledDate) {
                   const diff = scheduledDate.getTime() - now;
                   const d = Math.floor(diff / (1000 * 60 * 60 * 24));
                   const h = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
                   const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
                   if (d > 0) countdown = `D-${d} ${h}시간`;
                   else if (h > 0) countdown = `${h}시간 ${m}분 후 공개`;
                   else countdown = `${m}분 후 공개`;
                }

                return (
                  <div 
                    key={pkg.id} 
                    onClick={() => !isScheduled && setSelectedPackage(pkg)}
                    className={`group bg-white dark:bg-slate-900 rounded-[2rem] p-6 border border-slate-100 dark:border-white/5 hover:border-indigo-500/30 transition-all duration-300 relative flex flex-col h-full ${
                       isScheduled ? 'cursor-not-allowed select-none' : 'hover:shadow-2xl hover:shadow-indigo-500/10 cursor-pointer hover:-translate-y-1'
                    }`}
                  >
                     {/* Locked Overlay for Scheduled Items */}
                     {isScheduled && (
                        <div className="absolute inset-0 z-20 bg-white/60 dark:bg-slate-950/60 backdrop-blur-md rounded-[2rem] flex flex-col items-center justify-center text-center p-6 border border-white/20">
                           <div className="size-16 rounded-2xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 flex items-center justify-center mb-4 shadow-xl animate-pulse">
                              <span className="material-symbols-outlined text-3xl">lock_clock</span>
                           </div>
                           <h3 className="font-black text-xl text-slate-900 dark:text-white mb-2">Coming Soon</h3>
                           <div className="text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-500 font-mono mb-2">
                              {countdown}
                           </div>
                           <p className="text-xs font-bold text-slate-400">
                             {scheduledDate?.toLocaleDateString()} {scheduledDate?.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} 공개
                           </p>
                        </div>
                     )}

                     <div className={`flex flex-col h-full ${isScheduled ? 'opacity-20 grayscale' : ''}`}>
                       <div className="flex items-start justify-between mb-4">
                          <span className="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            {pkg.creatorName || (pkg.category === 'Community' ? '사용자 제안' : '관리자')}
                          </span>
                          {/* <span className="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            {pkg.category}
                          </span> */ }
                          <span className="text-[10px] font-bold text-slate-300">
                            {new Date(pkg.createdAt).toLocaleDateString()}
                          </span>
                       </div>
                       
                       <h3 className="text-lg font-black text-slate-900 dark:text-white mb-2 leading-tight group-hover:text-indigo-500 transition-colors">
                          {pkg.title}
                       </h3>
                       
                       <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed mb-6 line-clamp-2 min-h-[32px]">
                          {pkg.description}
                       </p>
                       
                       {pkg.channels.length === 1 ? (
                          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl flex items-center gap-4 border border-slate-100 dark:border-white/5 mt-auto group/channel">
                             <img src={pkg.channels[0].thumbnail} className="size-14 rounded-full border-2 border-white dark:border-slate-800 shadow-md object-cover" />
                             <div className="flex-1 min-w-0">
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block mb-0.5">Featured Channel</span>
                                <h4 className="font-black text-sm text-slate-900 dark:text-white truncate">{pkg.channels[0].title}</h4>
                                {(pkg.channels[0].subscriberCount || pkg.channels[0].videoCount) && (
                                   <div className="flex items-center gap-2 mt-1 text-[10px] font-medium text-slate-500">
                                      {pkg.channels[0].subscriberCount && <span className="flex items-center gap-0.5"><span className="material-symbols-outlined text-[10px]">group</span> {pkg.channels[0].subscriberCount}</span>}
                                      {pkg.channels[0].videoCount && <span className="flex items-center gap-0.5"><span className="material-symbols-outlined text-[10px]">movie</span> {pkg.channels[0].videoCount}</span>}
                                   </div>
                                )}
                             </div>
                          </div>
                       ) : (
                          <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl flex items-center justify-between border border-slate-100 dark:border-white/5 mt-auto">
                             <div className="flex -space-x-2">
                                {pkg.channels.slice(0, 4).map(ch => (
                                   <img key={ch.id} src={ch.thumbnail} className="size-8 rounded-full border-2 border-white dark:border-slate-800 bg-slate-200" title={ch.title} />
                                ))}
                                {pkg.channels.length > 4 && (
                                   <div className="size-8 rounded-full border-2 border-white dark:border-slate-800 bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-[9px] font-bold text-slate-500">
                                      +{pkg.channels.length - 4}
                                   </div>
                                )}
                             </div>
                             <span className="text-xs font-bold text-slate-500">{pkg.channelCount} 채널</span>
                          </div>
                       )}

                       <button 
                         onClick={(e) => {
                           e.stopPropagation();
                           !isScheduled && setSelectedPackage(pkg);
                         }}
                         disabled={isAdding || isScheduled}
                         className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-3 rounded-xl text-xs font-black uppercase hover:bg-indigo-600 dark:hover:bg-indigo-400 dark:hover:text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50 mt-4"
                       >
                          {isScheduled ? (
                            <>
                              <span className="material-symbols-outlined text-sm">lock</span>
                              공개 예정
                            </>
                          ) : (
                            <>
                              <span className="material-symbols-outlined text-sm">add_circle</span>
                              {isAdding ? '추가 중...' : '내 리스트에 담기'}
                            </>
                          )}
                       </button>
                     </div>
                  </div>
                );
             }))}
         </div>
       </div>

       {/* Package Detail Modal */}
       {selectedPackage && (
         <div 
           className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
           onClick={() => setSelectedPackage(null)}
         >
           <div 
             className="bg-white dark:bg-slate-900 w-full max-w-4xl max-h-[85vh] rounded-[2rem] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800"
             onClick={(e) => e.stopPropagation()}
           >
             {/* Modal Header */}
             <div className="p-8 pb-4 flex justify-between items-start border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
               <div>
                 <div className="flex items-center gap-3 mb-2">
                    <span className="text-xs font-black uppercase text-white bg-indigo-500 px-2.5 py-1 rounded-lg shadow-lg shadow-indigo-500/20">
                      {selectedPackage.creatorName || (selectedPackage.category === 'Community' ? '사용자 제안' : '관리자')}
                    </span>
                    <span className="text-xs font-bold text-slate-400">{new Date(selectedPackage.createdAt).toLocaleDateString()} 생성</span>
                 </div>
                 <h2 className="text-2xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tighter mb-2">{selectedPackage.title}</h2>
                 <p className="text-slate-500 dark:text-slate-400 font-medium text-sm md:text-base">{selectedPackage.description}</p>
               </div>
               <button 
                 onClick={() => setSelectedPackage(null)} 
                 className="p-2 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
               >
                 <span className="material-symbols-outlined">close</span>
               </button>
             </div>

             {/* Modal Body - 2 Columns Layout */}
             <div className="flex-1 overflow-hidden flex flex-col md:flex-row bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
               
               {/* Left Column: Channels */}
               <div className={`flex flex-col overflow-hidden ${popularVideos.length > 0 ? 'md:w-1/3 border-b md:border-b-0 md:border-r border-slate-100 dark:border-slate-800' : 'w-full'}`}>
                 {/* Fixed Header with Group Select */}
                 <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 z-20 shrink-0 flex items-center justify-between gap-2 overflow-visible">
                   <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-1.5 shrink-0">
                     <span className="material-symbols-outlined text-indigo-500 text-lg">subscriptions</span>
                     <span>{mode === 'topic' ? '추천 소재 채널' : '포함된 채널'}</span>
                     <span className="text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 px-1.5 py-0.5 rounded text-xs ml-0.5">{selectedPackage.channels.length}</span>
                   </h3>
                   
                   {/* Group Selection Dropdown (Only for Package Mode) */}
                   {mode !== 'topic' && (
                      <div className="flex items-center gap-2">
                         <span className="text-[10px] font-bold text-slate-400 hidden sm:inline">선택할 그룹 선택</span>
                         {renderGroupSelector(false)}
                      </div>
                   )}
                 </div>
                 
                 {/* Scrollable List */}
                 <div className="flex-1 overflow-y-auto custom-scrollbar p-4 bg-white dark:bg-slate-900">
                   <div className={`grid gap-2 ${popularVideos.length > 0 ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 md:grid-cols-3'}`}>
                     {selectedPackage.channels.map((ch, idx) => {
                        const isSelected = selectedChannelIds.includes(ch.id);
                        return (
                          <div 
                            key={`${ch.id}-${idx}`} 
                            onClick={() => toggleChannelCallback(ch.id)}
                            className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all cursor-pointer group relative ${
                              isSelected 
                              ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500 ring-1 ring-indigo-500/20' 
                              : 'bg-white dark:bg-slate-800/50 border-slate-200 dark:border-slate-800 hover:border-indigo-300 dark:hover:border-indigo-500/30'
                            }`}
                          >
                            {isSelected && (
                              <div className="absolute top-1 right-1 text-indigo-500">
                                <span className="material-symbols-outlined text-sm">check_circle</span>
                              </div>
                            )}
                            <img src={ch.thumbnail} alt={ch.title} className="size-8 rounded-full bg-slate-100 object-cover shrink-0" />
                            <div className="flex-1 min-w-0 pr-5">
                              <h4 className={`font-bold text-xs truncate ${isSelected ? 'text-indigo-900 dark:text-indigo-100' : 'text-slate-900 dark:text-slate-200'}`}>{ch.title}</h4>
                            </div>
                            <a href={`https://youtube.com/${ch.customUrl || 'channel/' + ch.id}`} target="_blank" rel="noreferrer" className="text-slate-300 hover:text-red-500 p-1 z-10" onClick={(e) => e.stopPropagation()}>
                              <span className="material-symbols-outlined text-sm">open_in_new</span>
                            </a>
                          </div>
                        );
                     })}
                   </div>
                 </div>

                 {/* Action Area (Buttons Only) */}
                 <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 z-10 shrink-0">
                    {/* Topic Mode Only: Group Selector Here */}
                    {mode === 'topic' && (
                       <div className="mb-3">
                          <div className="text-[10px] font-bold text-slate-400 mb-1 ml-1">저장할 그룹 선택</div>
                          {renderGroupSelector(true)}
                       </div>
                    )}
                    <div className="flex gap-2">
                      <button 
                        onClick={() => setSelectedPackage(null)}
                        className="flex-1 py-3 text-xs font-bold text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-colors bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                      >
                        취소
                      </button>
                      <button 
                        onClick={() => {
                          if (selectedChannelIds.length === 0) return alert('최소 1개 이상의 채널을 선택해주세요.');
                          
                          const isNewGroup = isCreatingNewGroup || targetGroupId === '__NEW_GROUP__';
                          if (isNewGroup && !newGroupName.trim()) return alert('새 그룹 이름을 입력해주세요.');
                          
                          const pkgToAdd = {
                            ...selectedPackage,
                            channels: selectedPackage.channels.filter(c => selectedChannelIds.includes(c.id))
                          };
                          onAdd(pkgToAdd, isNewGroup ? 'new' : targetGroupId, isNewGroup ? newGroupName : undefined);
                          setSelectedPackage(null);
                        }}
                        disabled={isAdding || selectedChannelIds.length === 0}
                        className="flex-[2] bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl text-xs font-black uppercase shadow-lg shadow-indigo-500/20 transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-1.5"
                      >
                         {isAdding ? <span className="material-symbols-outlined text-sm animate-spin">sync</span> : <span className="material-symbols-outlined text-sm">add_circle</span>}
                         {selectedChannelIds.length}개 추가
                      </button>
                    </div>
                 </div>
               </div>

               {/* Right Column: Popular Videos (Only if available) */}
               {popularVideos.length > 0 && (
                 <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50 dark:bg-slate-950/20">
                    {/* Fixed Header */}
                    <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 shrink-0">
                      <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                        <span className="material-symbols-outlined text-rose-500 text-lg">local_fire_department</span>
                        핫 트렌드 영상 <span className="text-xs text-slate-400 font-normal">(상위 인기)</span>
                      </h3>
                    </div>
                    
                    {/* Scrollable List */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {popularVideos.map(video => (
                          <a 
                            key={video.id}
                            href={`https://www.youtube.com/watch?v=${video.id}`}
                            target="_blank"
                            rel="noreferrer"
                            className="group bg-white dark:bg-slate-800 rounded-xl overflow-hidden hover:ring-2 hover:ring-rose-500 transition-all border border-slate-200 dark:border-slate-700 hover:shadow-md flex flex-col"
                          >
                             <div className="aspect-video relative overflow-hidden bg-slate-200">
                                <img src={video.thumbnail} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
                                <div className="absolute bottom-1 right-1 bg-black/80 text-white text-[9px] px-1 rounded font-bold">{video.duration}</div>
                             </div>
                             <div className="p-2.5 flex-1 flex flex-col">
                                <h4 className="font-bold text-[11px] text-slate-900 dark:text-white line-clamp-2 leading-snug group-hover:text-rose-500 transition-colors mb-1.5">{video.title}</h4>
                                <div className="mt-auto flex items-center justify-between text-[10px] text-slate-500">
                                   <span className="font-bold text-slate-700 dark:text-slate-300">조회수 {video.views}</span>
                                   <span>{new Date(video.date).toLocaleDateString()}</span>
                                </div>
                             </div>
                          </a>
                        ))}
                      </div>
                    </div>
                 </div>
               )}

              </div>

             {/* Modal Footer with Group Selection */}


           </div>
         </div>
       )}
       {/* Suggestion Modal with Interactive Channel List */}
       {/* Suggestion Modal with Interactive Channel List */}
       {isSuggestModalOpen && (
         <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setIsSuggestModalOpen(false)}>
            <div className="bg-white dark:bg-slate-900 w-full max-w-2xl max-h-[90vh] flex flex-col rounded-[2rem] shadow-2xl border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
               {isSuccessSuggest ? (
                  <div className="p-10 flex flex-col items-center text-center animate-in zoom-in-95 duration-300">
                     <div className="size-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-6 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                        <span className="material-symbols-outlined text-4xl text-emerald-500 animate-bounce">check_circle</span>
                     </div>
                     <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-3">소재 등록 완료!</h3>
                     <p className="text-slate-500 dark:text-slate-400 font-medium leading-relaxed mb-4">
                        성공적으로 등록되었습니다. <br/>
                        <b>관리자 승인 후</b> 공개됩니다.
                     </p>
                     <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-500/20 mb-8 max-w-sm">
                        <p className="text-indigo-600 dark:text-indigo-300 text-xs font-bold flex items-center justify-center gap-2">
                           <span className="material-symbols-outlined text-lg">redeem</span>
                           승인이 되면 관리자가 이용일자 보상을 지급합니다.
                        </p>
                     </div>
                     <button 
                       onClick={() => setIsSuggestModalOpen(false)}
                       className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-10 py-3 rounded-xl font-bold hover:scale-105 transition-transform shadow-lg"
                     >
                       확인
                     </button>
                  </div>
               ) : (
                  <>
                     <div className="flex justify-between items-center p-6 border-b border-slate-100 dark:border-slate-800">
                        <h3 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                          <span className={`material-symbols-outlined ${mode === 'topic' ? 'text-amber-500' : 'text-indigo-500'}`}>
                            {mode === 'topic' ? 'lightbulb' : 'ios_share'}
                          </span>
                          {mode === 'topic' ? '추천 소재 등록' : '추천 채널 팩 공유'}
                        </h3>
                        <button onClick={() => setIsSuggestModalOpen(false)} className="text-slate-400 hover:text-rose-500"><span className="material-symbols-outlined">close</span></button>
                     </div>
                     
                     <div className="p-6 space-y-6 overflow-y-auto custom-scrollbar">
                       <div>
                         <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase">제목</label>
                         <input 
                           className={`w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-bold outline-none focus:ring-2 ${mode === 'topic' ? 'focus:ring-amber-500/20' : 'focus:ring-indigo-500/20'}`}
                           placeholder={mode === 'topic' ? "예: 동물 다큐멘터리" : "예: 000 모음집"}
                           value={suggestTitle}
                           onChange={e => setSuggestTitle(e.target.value)}
                         />
                       </div>
                       
                       <div>
                         <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase">추천 이유 (선택)</label>
                         <textarea 
                           className={`w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm resize-none h-24 outline-none focus:ring-2 ${mode === 'topic' ? 'focus:ring-amber-500/20' : 'focus:ring-indigo-500/20'}`}
                           placeholder="이 내용을 공유하는 이유를 적어주세요."
                           value={suggestDesc}
                           onChange={e => setSuggestDesc(e.target.value)}
                         />
                       </div>

                       <div className="border-t border-slate-100 dark:border-slate-800 pt-6">
                          <label className="block text-xs font-bold text-slate-500 mb-3 uppercase flex items-center justify-between">
                             <span>채널 구성 ({suggestChannels.length}개)</span>
                             <div className="flex items-center gap-2">
                                {mode !== 'topic' && (
                                   <button 
                                     onClick={() => setIsMyListOpen(!isMyListOpen)}
                                     className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 flex items-center gap-1 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 rounded-lg transition-colors border border-indigo-100 dark:border-indigo-800"
                                   >
                                     <span className="material-symbols-outlined text-[14px]">{isMyListOpen ? 'expand_less' : 'playlist_add'}</span>
                                     내 리스트에서 불러오기
                                   </button>
                                )}
                                <span className="text-[10px] font-normal text-slate-400">핸들(@name), ID, 또는 URL 입력</span>
                             </div>
                          </label>
                          
                          {/* My List Selector */}
                          {isMyListOpen && (
                            <div className="mb-4 bg-slate-50 dark:bg-slate-800/80 rounded-xl p-3 border border-slate-200 dark:border-slate-700 animate-in slide-in-from-top-2">
                               <div className="flex justify-between items-center mb-2 px-1">
                                  <span className="text-[10px] font-bold text-slate-500">내 채널 목록 ({savedChannels.length})</span>
                                  <button onClick={() => setIsMyListOpen(false)} className="text-slate-400 hover:text-rose-500"><span className="material-symbols-outlined text-sm">close</span></button>
                               </div>
                               <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-4">
                                  {savedChannels.length === 0 ? (
                                     <div className="py-6 text-center text-slate-400 text-xs font-medium bg-white dark:bg-slate-900 rounded-lg border border-dashed border-slate-200 dark:border-slate-800">
                                        내 리스트에 저장된 채널이 없습니다.
                                     </div>
                                  ) : (
                                    // Group channels by groupId
                                    groups.map(group => {
                                      const groupChannels = savedChannels.filter(c => (c.groupId || 'unassigned') === group.id);
                                      if (groupChannels.length === 0) return null;

                                      return (
                                        <div key={group.id} className="space-y-2">
                                          <div className="text-[10px] font-black text-slate-400 uppercase tracking-wider px-1 flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                              <span className="material-symbols-outlined text-[12px]">folder</span>
                                              {group.name}
                                            </div>
                                            <button 
                                              onClick={() => {
                                                const newChannels = groupChannels.filter(gc => !suggestChannels.some(sc => sc.id === gc.id));
                                                if (newChannels.length > 0) {
                                                  setSuggestChannels(prev => [...prev, ...newChannels]);
                                                }
                                              }}
                                              disabled={groupChannels.every(gc => suggestChannels.some(sc => sc.id === gc.id))}
                                              className="text-[10px] bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-indigo-500 hover:bg-slate-200 dark:hover:bg-slate-700 px-2 py-1 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                              {groupChannels.every(gc => suggestChannels.some(sc => sc.id === gc.id)) ? '완료' : '전체 추가'}
                                            </button>
                                          </div>
                                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                            {groupChannels.map(ch => {
                                              const isAdded = suggestChannels.some(sc => sc.id === ch.id);
                                              return (
                                                <button 
                                                  key={ch.id}
                                                  onClick={() => {
                                                      if (isAdded) return;
                                                      setSuggestChannels(prev => [...prev, ch]);
                                                  }}
                                                  disabled={isAdded}
                                                  className={`flex items-center gap-2 p-2 rounded-lg text-left transition-all ${
                                                    isAdded 
                                                    ? 'bg-slate-200 dark:bg-slate-700 opacity-50 cursor-not-allowed' 
                                                    : 'bg-white dark:bg-slate-900 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 border border-slate-100 dark:border-slate-700'
                                                  }`}
                                                >
                                                    <img src={ch.thumbnail} className="size-6 rounded-full bg-slate-100" />
                                                    <span className="text-xs font-bold truncate flex-1 dark:text-white">{ch.title}</span>
                                                    {isAdded && <span className="material-symbols-outlined text-xs text-indigo-500">check</span>}
                                                </button>
                                              );
                                            })}
                                          </div>
                                        </div>
                                      );
                                    })
                                  )}
                               </div>
                            </div>
                          )}
                          
                          <div className="flex gap-2 mb-4">
                             <input 
                               value={suggestChannelInput}
                               onChange={(e) => setSuggestChannelInput(e.target.value)}
                               onKeyDown={(e) => e.key === 'Enter' && handleAddChannelToSuggest()}
                               placeholder="채널을 검색하여 추가하세요..."
                               className={`flex-1 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-bold outline-none focus:ring-2 ${mode === 'topic' ? 'focus:ring-amber-500/20' : 'focus:ring-indigo-500/20'}`}
                             />
                             <button 
                               onClick={handleAddChannelToSuggest}
                               disabled={isResolvingSuggest}
                               className={`bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-6 rounded-xl font-bold text-sm hover:text-white transition-colors disabled:opacity-50 flex items-center gap-2 ${mode === 'topic' ? 'hover:bg-amber-500 dark:hover:bg-amber-500' : 'hover:bg-indigo-500 dark:hover:bg-indigo-500'}`}
                             >
                               {isResolvingSuggest ? (
                                   <>
                                     <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                                     검색 중
                                   </>
                               ) : '추가'}
                             </button>
                          </div>

                          <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-2 min-h-[150px] max-h-[300px] overflow-y-auto border border-slate-200 dark:border-slate-700 custom-scrollbar">
                             {suggestChannels.length === 0 ? (
                               <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2 py-10">
                                  <span className="material-symbols-outlined text-3xl opacity-20">playlist_add</span>
                                  <span className="text-xs">채널을 추가해주세요</span>
                               </div>
                             ) : (
                               <div className="grid grid-cols-1 gap-2">
                                  {suggestChannels.map((ch, idx) => (
                                    <div key={`${ch.id}-${idx}`} className="bg-white dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800 p-3 animate-in slide-in-from-right-2">
                                        <div className="flex items-center gap-3">
                                            <img src={ch.thumbnail} className="size-10 rounded-full bg-slate-200 object-cover" />
                                            <div className="flex-1 min-w-0">
                                               <div className="font-bold text-sm truncate dark:text-white">{ch.title}</div>
                                               <div className="text-[10px] text-slate-400 truncate">{ch.id}</div>
                                            </div>
                                            <button 
                                              onClick={() => setSuggestChannels(prev => prev.filter(c => c.id !== ch.id))}
                                              className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors"
                                            >
                                               <span className="material-symbols-outlined text-sm">delete</span>
                                            </button>
                                        </div>
                                    </div>
                                  ))}
                               </div>
                             )}
                          </div>
                       </div>
                     </div>

                     <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-3 bg-slate-50 dark:bg-slate-800/20 rounded-b-[2rem]">
                       <button 
                          onClick={() => setIsSuggestModalOpen(false)}
                          className="px-6 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                       >
                          취소
                       </button>
                       <button 
                         onClick={handleSuggest}
                         disabled={isSubmittingContext || suggestChannels.length === 0}
                         className={`text-white px-8 py-3 rounded-xl font-bold transition-colors disabled:opacity-50 shadow-lg flex items-center gap-2 ${mode === 'topic' ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20' : 'bg-indigo-500 hover:bg-indigo-600 shadow-indigo-500/20'}`}
                       >
                         {isSubmittingContext ? (
                            <>
                              <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                              등록 중...
                            </>
                         ) : (
                            <>
                              <span className="material-symbols-outlined text-sm">{mode === 'topic' ? 'check_circle' : 'ios_share'}</span>
                              {mode === 'topic' ? '등록 신청하기' : '공유하기'}
                            </>
                         )}
                       </button>
                     </div>
                  </>
               )}
            </div>
         </div>
       )}
    </div>
  );
};

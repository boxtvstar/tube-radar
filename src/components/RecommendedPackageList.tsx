import React from 'react';
import { RecommendedPackage } from '../../types';

import { ChannelGroup } from '../../types';

interface RecommendedPackageListProps {
  packages: RecommendedPackage[];
  onAdd: (pkg: RecommendedPackage, targetGroupId: string, newGroupName?: string) => void;
  isAdding?: boolean;
  groups: ChannelGroup[];
  activeGroupId: string;
}

export const RecommendedPackageList: React.FC<RecommendedPackageListProps> = ({ packages, onAdd, isAdding, groups, activeGroupId }) => {
  // Filter only approved packages for public view
  const approvedPackages = React.useMemo(() => 
    packages.filter(p => !p.status || p.status === 'approved'), 
  [packages]);

  const [selectedPackage, setSelectedPackage] = React.useState<RecommendedPackage | null>(null);
  const [selectedChannelIds, setSelectedChannelIds] = React.useState<string[]>([]);
  
  // Group selection state
  const [targetGroupId, setTargetGroupId] = React.useState<string>(activeGroupId === 'all' ? (groups[0]?.id || 'default') : activeGroupId);
  const [isCreatingNewGroup, setIsCreatingNewGroup] = React.useState(false);
  const [newGroupName, setNewGroupName] = React.useState('');

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

  React.useEffect(() => {
    if (selectedPackage) {
      // Default: Select ALL channels when opening
      setSelectedChannelIds(selectedPackage.channels.map(c => c.id));
    } else {
      setSelectedChannelIds([]);
    }
  }, [selectedPackage]);

  const toggleChannelCallback = (id: string) => {
    setSelectedChannelIds(prev => 
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const isAllSelected = selectedPackage && selectedPackage.channels.length === selectedChannelIds.length;

  return (
    <div className="space-y-6 animate-in slide-in-from-top-4 duration-500">
       <div className="bg-white dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl shadow-xl dark:shadow-2xl relative overflow-hidden">
         <div className="space-y-4 max-w-2xl relative z-10">
            <h2 className="text-2xl font-black italic tracking-tighter text-indigo-500 uppercase flex items-center gap-3">
              <span className="material-symbols-outlined text-3xl">inventory_2</span>
              추천 채널 팩
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-[11px] font-medium leading-relaxed">
              전문가가 엄선한 유튜브 채널 모음을 확인하세요. <br />
              원하는 팩을 선택하면 내 모니터링 리스트로 <b>일괄 추가</b>할 수 있습니다.
            </p>
         </div>
         
         <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 mt-12 relative z-10">
            {approvedPackages.length === 0 ? (
               <div className="col-span-full py-20 text-center text-slate-400 text-sm font-medium">
                  등록된 추천 팩이 없습니다.
               </div>
            ) : (
               approvedPackages.slice(0, 8).map(pkg => (
                  <div 
                    key={pkg.id} 
                    onClick={() => setSelectedPackage(pkg)}
                    className="bg-slate-50 dark:bg-black/20 rounded-3xl border border-slate-100 dark:border-white/5 overflow-hidden group hover:scale-[1.02] transition-all hover:shadow-xl hover:border-indigo-500/30 cursor-pointer flex flex-col h-full"
                  >
                     <div className="p-6 flex flex-col gap-4 h-full">
                       <div className="flex items-center justify-between">
                          <span className="text-[10px] font-black uppercase text-indigo-500 bg-indigo-500/10 px-2 py-1 rounded">{pkg.category}</span>
                          <span className="text-[10px] text-slate-400">{new Date(pkg.createdAt).toLocaleDateString()}</span>
                       </div>
                       <h3 className="text-lg font-black leading-tight text-slate-900 dark:text-white group-hover:text-indigo-500 transition-colors line-clamp-2 h-[3.5rem]">
                          {pkg.title}
                       </h3>
                       <p className="text-xs text-slate-500 line-clamp-2 h-8">
                          {pkg.description}
                       </p>
                       
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

                       <button 
                         onClick={(e) => {
                           e.stopPropagation();
                           setSelectedPackage(pkg);
                         }}
                         disabled={isAdding}
                         className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-3 rounded-xl text-xs font-black uppercase hover:bg-indigo-600 dark:hover:bg-indigo-400 dark:hover:text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
                       >
                          <span className="material-symbols-outlined text-sm">add_circle</span>
                          {isAdding ? '추가 중...' : '내 리스트에 담기'}
                       </button>
                     </div>
                  </div>
               ))
            )}
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
                    <span className="text-xs font-black uppercase text-white bg-indigo-500 px-2.5 py-1 rounded-lg shadow-lg shadow-indigo-500/20">{selectedPackage.category}</span>
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

             {/* Modal Body - Channel Grid */}
             <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-white dark:bg-slate-900">
               <div className="flex items-center justify-between mb-6">
                 <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
                   <span className="material-symbols-outlined text-indigo-500">subscriptions</span>
                   포함된 채널 <span className="text-indigo-500">({selectedPackage.channels.length})</span>
                 </h3>
                  <div className="flex gap-2">
                    <button 
                      onClick={() => setSelectedChannelIds(selectedPackage.channels.map(c => c.id))}
                      className="text-xs font-bold text-slate-500 hover:text-indigo-500 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg"
                    >
                      전체 선택
                    </button>
                    <button 
                      onClick={() => setSelectedChannelIds([])}
                      className="text-xs font-bold text-slate-500 hover:text-rose-500 px-3 py-1.5 bg-slate-100 dark:bg-slate-800 rounded-lg"
                    >
                      선택 해제
                    </button>
                  </div>
               </div>
               
               <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                 {selectedPackage.channels.map((ch, idx) => {
                    const isSelected = selectedChannelIds.includes(ch.id);
                    return (
                      <div 
                        key={`${ch.id}-${idx}`} 
                        onClick={() => toggleChannelCallback(ch.id)}
                        className={`flex items-center gap-4 p-4 rounded-2xl border transition-all cursor-pointer group relative overflow-hidden ${
                          isSelected 
                          ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500 ring-1 ring-indigo-500/20' 
                          : 'bg-slate-50 dark:bg-slate-800/50 border-slate-100 dark:border-slate-800 hover:border-indigo-500/30 opacity-60 hover:opacity-100'
                        }`}
                      >
                        {isSelected && (
                          <div className="absolute top-0 right-0 p-2 text-indigo-500">
                            <span className="material-symbols-outlined text-lg">check_circle</span>
                          </div>
                        )}
                        <img src={ch.thumbnail} alt={ch.title} className={`size-12 rounded-full border-2 shadow-sm ${isSelected ? 'border-indigo-500' : 'border-white dark:border-slate-700'}`} />
                        <div className="flex-1 min-w-0">
                          <h4 className={`font-bold text-sm truncate transition-colors ${isSelected ? 'text-indigo-900 dark:text-indigo-100' : 'text-slate-900 dark:text-slate-200'}`}>{ch.title}</h4>
                          <p className="text-xs text-slate-400 truncate">{ch.customUrl || ch.id}</p>
                        </div>
                        <a href={`https://youtube.com/${ch.customUrl || 'channel/' + ch.id}`} target="_blank" rel="noreferrer" className="text-slate-300 hover:text-red-500 p-2 z-10" onClick={(e) => e.stopPropagation()}>
                          <span className="material-symbols-outlined text-lg">open_in_new</span>
                        </a>
                      </div>
                    );
                 })}
               </div>
             </div>

             {/* Modal Footer with Group Selection */}
             <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 backdrop-blur-sm space-y-4">
                
                {/* Group Selection Area */}
                <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200 dark:border-slate-700 shadow-sm">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-bold text-slate-500 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm">folder_open</span>
                      저장할 그룹 선택
                    </span>
                    <button 
                      onClick={() => setIsCreatingNewGroup(!isCreatingNewGroup)}
                      className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 flex items-center gap-1 transition-colors"
                    >
                      {isCreatingNewGroup ? '기존 그룹 선택' : '+ 새 그룹 만들기'}
                    </button>
                  </div>

                  {isCreatingNewGroup ? (
                    <div className="flex items-center gap-2 animate-in slide-in-from-top-2">
                       <input 
                         type="text" 
                         value={newGroupName}
                         onChange={(e) => setNewGroupName(e.target.value)}
                         placeholder="새 그룹 이름 입력"
                         className="flex-1 bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 px-3 py-2.5 rounded-lg text-xs font-bold focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:font-medium"
                         autoFocus
                       />
                       <div className="text-[10px] text-indigo-500 font-bold px-2 whitespace-nowrap">
                         (새 그룹 생성)
                       </div>
                    </div>
                  ) : (
                    <div className="relative animate-in slide-in-from-top-2 group-select-wrapper">
                      <select
                        value={targetGroupId}
                        onChange={(e) => setTargetGroupId(e.target.value)}
                        className="w-full appearance-none bg-slate-50 dark:bg-black/20 border border-slate-200 dark:border-slate-700 px-3 py-2.5 rounded-lg text-xs font-bold text-slate-700 dark:text-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none cursor-pointer transition-all hover:bg-slate-100 dark:hover:bg-white/5"
                      >
                        {groups.map(g => (
                          <option key={g.id} value={g.id}>{g.name}</option>
                        ))}
                      </select>
                      <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none text-sm group-hover:text-indigo-500 transition-colors">expand_more</span>
                    </div>
                  )}
                </div>

                <div className="flex gap-3">
                  <button 
                    onClick={() => setSelectedPackage(null)}
                    disabled={isAdding}
                    className="flex-1 py-3.5 text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl transition-all disabled:opacity-50 hover:shadow-sm"
                  >
                    취소
                  </button>
                  <button 
                    onClick={() => {
                      if (selectedChannelIds.length === 0) return alert('최소 1개 이상의 채널을 선택해주세요.');
                      if (isCreatingNewGroup && !newGroupName.trim()) return alert('새 그룹 이름을 입력해주세요.');
                      
                      // Clone package but only with selected channels
                      const pkgToAdd = {
                        ...selectedPackage,
                        channels: selectedPackage.channels.filter(c => selectedChannelIds.includes(c.id))
                      };
                      onAdd(pkgToAdd, targetGroupId, isCreatingNewGroup ? newGroupName : undefined);
                      setSelectedPackage(null);
                    }}
                    disabled={isAdding || selectedChannelIds.length === 0}
                    className="flex-[2] bg-indigo-500 text-white py-3.5 rounded-xl text-xs font-black uppercase shadow-lg shadow-indigo-500/30 hover:bg-indigo-600 hover:scale-[1.02] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                     {isAdding ? (
                       <>
                         <span className="material-symbols-outlined text-sm animate-spin">sync</span>
                         추가 중...
                       </>
                     ) : (
                       <>
                         <span className="material-symbols-outlined text-sm">add_circle</span>
                         선택한 {selectedChannelIds.length}개 채널 {isCreatingNewGroup ? '새 그룹에 추가' : '추가하기'}
                       </>
                     )}
                  </button>
                </div>
             </div>

           </div>
         </div>
       )}
    </div>
  );
};

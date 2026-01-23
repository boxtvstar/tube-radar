
import React, { useState, useEffect } from 'react';
import { ApiUsage, Notification, RecommendedPackage } from '../../types';
import { getUserProposals, sendInquiry, getUserInquiries, saveTopicToDb, savePackageToDb } from '../../services/dbService';
import { getChannelInfo, fetchChannelPopularVideos } from '../../services/youtubeService';
import { SavedChannel } from '../../types';

interface MyPageModalProps {
  onClose: () => void;
  user: any;
  usage: ApiUsage;
  notifications: Notification[];
  role: string;
  expiresAt: string | null;
  onLogout: () => void;
  onMarkRead: (id: string) => void;
}

export const MyPageModal: React.FC<MyPageModalProps> = ({ 
  onClose, 
  user, 
  usage, 
  notifications, 
  role, 
  expiresAt,
  onLogout,
  onMarkRead
}) => {
  const [activeTab, setActiveTab] = useState<'dashboard' | 'activity' | 'notifications' | 'support'>('dashboard');
  const [proposals, setProposals] = useState<(RecommendedPackage & { itemType: 'package' | 'topic' })[]>([]);
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [isLoadingProposals, setIsLoadingProposals] = useState(false);
  const [inquiryMessage, setInquiryMessage] = useState('');
  const [isSendingInquiry, setIsSendingInquiry] = useState(false);
  const [isInquirySuccess, setIsInquirySuccess] = useState(false);
  const [isWriting, setIsWriting] = useState(false);
  const [expandedInquiryId, setExpandedInquiryId] = useState<string | null>(null);

  // Proposal Detail & Edit State
  const [selectedProposal, setSelectedProposal] = useState<(RecommendedPackage & { itemType: 'package' | 'topic' }) | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  
  // Edit Form State
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editChannels, setEditChannels] = useState<SavedChannel[]>([]);
  const [editChannelInput, setEditChannelInput] = useState('');
  const [isResolvingChannel, setIsResolvingChannel] = useState(false);
  const [isSavingProposal, setIsSavingProposal] = useState(false);

  // Reset detail state when tab changes
  useEffect(() => {
    setSelectedProposal(null);
    setIsEditing(false);
  }, [activeTab]);

  const handleProposalClick = (proposal: RecommendedPackage & { itemType: 'package' | 'topic' }) => {
    setSelectedProposal(proposal);
    setIsEditing(false);
  };

  const startEditing = () => {
    if (!selectedProposal) return;
    setEditTitle(selectedProposal.title);
    setEditDesc(selectedProposal.description);
    setEditChannels(selectedProposal.channels || []);
    setIsEditing(true);
  };

  const handleAddChannelToEdit = async () => {
    if (!editChannelInput.trim()) return;
    
    // Check local Auth or Admin key for API calls. 
    // Since this is MyPage, the user might not have a key if they are a guest, but usually they do or use the shared key.
    // For simplicity, we try to get a key from localStorage as in other components.
    const apiKey = localStorage.getItem(`yt_api_key_${user.uid}`) || localStorage.getItem('yt_api_key_guest') || localStorage.getItem('admin_yt_key');
    
    if (!apiKey) return alert("채널 검색을 위한 API 키가 설정되지 않았습니다.");

    setIsResolvingChannel(true);
    try {
      const inputs = editChannelInput.split(/[,\n\s]+/).filter(s => s.trim().length > 0);
      let addedCount = 0;

      for (const input of inputs) {
        if (editChannels.some(c => c.id === input || c.customUrl === input)) continue;
        
        try {
          const info = await getChannelInfo(apiKey, input);
          if (info) {
             if (!editChannels.some(c => c.id === info.id)) {
                // Try to fetch preview videos for better UX
                try {
                   const videos = await fetchChannelPopularVideos(apiKey, info.id);
                   if (videos.length > 0) info.topVideos = videos;
                } catch(err) { console.error(err); }
                
                setEditChannels(prev => [...prev, info]);
                addedCount++;
             }
          }
        } catch (e) { console.error(e); }
      }
      
      if (addedCount > 0) setEditChannelInput('');
      else alert("추가할 채널을 찾을 수 없거나 이미 존재합니다.");
      
    } catch (e) {
      alert("채널 검색 중 오류가 발생했습니다.");
    } finally {
      setIsResolvingChannel(false);
    }
  };

  const handleRemoveChannelFromEdit = (channelId: string) => {
    setEditChannels(prev => prev.filter(c => c.id !== channelId));
  };

  const handleSaveProposal = async () => {
    if (!selectedProposal) return;
    if (!editTitle.trim()) return alert("제목을 입력해주세요.");
    if (editChannels.length === 0) return alert("최소 1개 이상의 채널이 필요합니다.");

    setIsSavingProposal(true);
    try {
      const updatedProposal: RecommendedPackage = {
        ...selectedProposal,
        title: editTitle,
        description: editDesc,
        channels: editChannels,
        channelCount: editChannels.length,
        // Keep original status unless we want to reset to pending logic (optional, but requested 'edit before approval')
        // Actually if it's pending, it stays pending. If rejected, maybe reset to pending? 
        // User asked "edit possible BEFORE approval". 
        // We will just update content. Status remains as is (likely 'pending').
      };

      if (selectedProposal.itemType === 'topic') {
        await saveTopicToDb(updatedProposal);
      } else {
        await savePackageToDb(updatedProposal);
      }

      // Update local lists
      const freshProposals = await getUserProposals(user.uid);
      setProposals(freshProposals);
      
      // Update selected view
      setSelectedProposal({...updatedProposal, itemType: selectedProposal.itemType});
      setIsEditing(false);
      alert("수정되었습니다.");
    } catch (e) {
      console.error(e);
      alert("저장 중 오류가 발생했습니다.");
    } finally {
      setIsSavingProposal(false);
    }
  };

  const handleSendInquiry = async () => {
    if (!inquiryMessage.trim()) return;
    setIsSendingInquiry(true);
    try {
      await sendInquiry(user.uid, user.displayName || 'Anonymous', inquiryMessage);
      setIsInquirySuccess(true);
      setInquiryMessage('');
      // Reload inquiries
      getUserInquiries(user.uid).then(setInquiries);
    } catch (e) {
      console.error(e);
      alert('전송 중 오류가 발생했습니다.');
    } finally {
      setIsSendingInquiry(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'activity') {
      setIsLoadingProposals(true);
      getUserProposals(user.uid)
        .then(data => setProposals(data))
        .catch(console.error)
        .finally(() => setIsLoadingProposals(false));
    }
    if (activeTab === 'support') {
      getUserInquiries(user.uid).then(setInquiries).catch(console.error);
    }
  }, [activeTab, user.uid]);

  const calculateDDay = (targetDate: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(targetDate);
    target.setHours(0, 0, 0, 0);
    const diffTime = target.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };

  const dDay = expiresAt ? calculateDDay(expiresAt) : null;
  const usagePercent = Math.min(100, Math.max(0, ((usage.total - usage.used) / usage.total) * 100));

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div 
        className="bg-white dark:bg-slate-900 w-full max-w-4xl h-[80vh] rounded-3xl shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 shrink-0">
          <h2 className="text-xl font-bold bg-gradient-to-r from-indigo-500 to-purple-500 bg-clip-text text-transparent flex items-center gap-2">
            <span className="material-symbols-outlined text-indigo-500 font-normal">account_circle</span>
            마이 페이지
          </h2>
          <button 
            onClick={onClose}
            className="size-8 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center text-slate-400 transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Layout */}
        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar Tabs */}
          <div className="w-48 md:w-60 bg-slate-50 dark:bg-slate-900/50 border-r border-slate-200 dark:border-slate-800 flex flex-col p-4 gap-2 shrink-0">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-bold transition-all ${activeTab === 'dashboard' ? 'bg-white dark:bg-slate-800 shadow-sm text-indigo-500' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <span className="material-symbols-outlined text-[20px]">dashboard</span>
              대시보드
            </button>
            <button
              onClick={() => setActiveTab('activity')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-bold transition-all ${activeTab === 'activity' ? 'bg-white dark:bg-slate-800 shadow-sm text-indigo-500' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <span className="material-symbols-outlined text-[20px]">history_edu</span>
              내 활동 내역
            </button>
            <button
              onClick={() => setActiveTab('notifications')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-bold transition-all ${activeTab === 'notifications' ? 'bg-white dark:bg-slate-800 shadow-sm text-indigo-500' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <span className="material-symbols-outlined text-[20px]">notifications</span>
              알림함 <span className="ml-auto bg-rose-500 text-white text-[10px] px-1.5 rounded-full">{notifications.filter(n => !n.isRead).length > 0 ? notifications.filter(n => !n.isRead).length : ''}</span>
            </button>
            <button
              onClick={() => setActiveTab('support')}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-bold transition-all ${activeTab === 'support' ? 'bg-white dark:bg-slate-800 shadow-sm text-indigo-500' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              <span className="material-symbols-outlined text-[20px]">support_agent</span>
              1:1 문의하기
            </button>
            
            <div className="mt-auto">
              <button 
                onClick={onLogout}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left text-sm font-bold text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-all"
              >
                <span className="material-symbols-outlined text-[20px]">logout</span>
                로그아웃
              </button>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-y-auto bg-white dark:bg-background-dark p-6 md:p-8 custom-scrollbar">
            
            {/* 1. Dashboard Tab */}
            {activeTab === 'dashboard' && (
              <div className="space-y-8 animate-in slide-in-from-right-4 duration-300">
                {/* Profile Card */}
                <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-3xl flex items-center gap-6 border border-slate-100 dark:border-slate-700">
                  <div className="size-20 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white text-3xl font-bold shadow-lg shadow-indigo-500/30 shrink-0 overflow-hidden">
                    {user.photoURL ? (
                      <img src={user.photoURL} alt="Profile" className="w-full h-full object-cover" />
                    ) : (
                      user.displayName?.[0] || 'U'
                    )}
                  </div>
                  <div>
                    <h3 className="text-2xl font-black text-slate-900 dark:text-white mb-1">{user.displayName || 'Unknown User'}</h3>
                    <p className="text-sm text-slate-500 font-medium mb-3">{user.email}</p>
                    <div className="flex gap-2">
                       <span className={`px-2.5 py-0.5 rounded text-[10px] font-black uppercase tracking-wider border ${role === 'admin' ? 'bg-indigo-100 text-indigo-600 border-indigo-200' : (role === 'approved' ? 'bg-emerald-100 text-emerald-600 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200')}`}>
                         {role === 'admin' ? 'ADMINISTRATOR' : (role === 'approved' ? 'MEMBERSHIP USER' : 'GUEST / PENDING')}
                       </span>
                    </div>
                  </div>
                  <div className="ml-auto text-right">
                     {expiresAt ? (
                       <div className="flex flex-col items-end">
                         <span className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Membership Ends</span>
                         <span className={`text-3xl font-black ${dDay && dDay <= 7 ? 'text-rose-500' : 'text-slate-900 dark:text-white'}`}>
                           D-{dDay}
                         </span>
                         <span className="text-xs text-slate-500 font-mono mt-1">{new Date(expiresAt).toLocaleDateString()}</span>
                       </div>
                     ) : (
                       <div className="text-slate-400 text-sm font-medium">유효기간 정보 없음 (무제한 또는 승인대기)</div>
                     )}
                  </div>
                </div>

                {/* API Usage & Stats */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                   <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl shadow-sm">
                      <h4 className="text-sm font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-6">API Quota Usage</h4>
                      <div className="relative pt-4 pb-8 flex justify-center">
                         {/* Circle Graph */}
                         <div className="relative size-40">
                            <svg className="size-full -rotate-90" viewBox="0 0 36 36">
                              <path className="text-slate-100 dark:text-slate-800" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="currentColor" strokeWidth="3" />
                              <path 
                                className={`${usagePercent < 10 ? 'text-rose-500' : (usagePercent < 30 ? 'text-amber-500' : 'text-emerald-500')} transition-all duration-1000 ease-out`} 
                                strokeDasharray={`${usagePercent}, 100`} 
                                d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" 
                                fill="none" 
                                stroke="currentColor" 
                                strokeWidth="3" 
                              />
                            </svg>
                            <div className="absolute inset-0 flex flex-col items-center justify-center">
                              <span className="text-3xl font-black text-slate-900 dark:text-white">{usagePercent.toFixed(0)}%</span>
                              <span className="text-[10px] font-bold text-slate-400 uppercase">Remaining</span>
                            </div>
                         </div>
                      </div>
                      <div className="flex justify-between items-center text-xs font-medium text-slate-500 border-t border-slate-100 dark:border-slate-800 pt-4">
                         <span>Used: <b className="text-slate-900 dark:text-white">{usage.used.toLocaleString()}</b></span>
                         <span>Total: <b className="text-slate-900 dark:text-white">{usage.total.toLocaleString()}</b></span>
                      </div>
                   </div>

                   <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 rounded-3xl shadow-sm flex flex-col justify-center items-center text-center">
                      <div className="size-16 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-500 rounded-2xl flex items-center justify-center mb-4">
                         <span className="material-symbols-outlined text-3xl">mark_email_unread</span>
                      </div>
                      <h4 className="text-lg font-bold text-slate-900 dark:text-white mb-1">읽지 않은 알림</h4>
                      <p className="text-slate-500 text-sm mb-6">최근 소식을 확인해보세요</p>
                      <button 
                        onClick={() => setActiveTab('notifications')}
                        className="px-6 py-2 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 transition"
                      >
                        알림 확인하기 ({notifications.filter(n => !n.isRead).length})
                      </button>
                   </div>
                </div>
              </div>
            )}

            {/* 2. Activity Tab */}
            {activeTab === 'activity' && (
              <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                {selectedProposal ? (
                  // Detail & Edit View
                  <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-3xl overflow-hidden flex flex-col h-full animate-in slide-in-from-right-4">
                    {/* Detail Header */}
                    <div className="p-6 border-b border-slate-200 dark:border-slate-700 flex justify-between items-start bg-white dark:bg-slate-900/50">
                      <div>
                        <button 
                           onClick={() => { setSelectedProposal(null); setIsEditing(false); }}
                           className="text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 flex items-center gap-1 mb-2"
                        >
                           <span className="material-symbols-outlined text-sm">arrow_back</span>
                           목록으로
                        </button>
                        {isEditing ? (
                          <input 
                            value={editTitle}
                            onChange={(e) => setEditTitle(e.target.value)}
                            className="text-xl font-black bg-transparent border-b border-slate-300 dark:border-slate-600 focus:border-indigo-500 outline-none text-slate-900 dark:text-white w-full placeholder:text-slate-400/50"
                            placeholder="제목 입력"
                          />
                        ) : (
                          <h3 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                            {selectedProposal.title}
                            <span className={`text-[10px] px-2 py-0.5 rounded-full uppercase tracking-wide border ${
                               selectedProposal.status === 'approved' ? 'bg-emerald-100 text-emerald-600 border-emerald-200' :
                               selectedProposal.status === 'rejected' ? 'bg-rose-100 text-rose-600 border-rose-200' :
                               'bg-slate-100 text-slate-500 border-slate-200'
                            }`}>
                               {selectedProposal.status || 'PENDING'}
                            </span>
                          </h3>
                        )}
                        <span className="text-[10px] text-slate-400 font-bold mt-1 block">
                           {selectedProposal.itemType === 'topic' ? '추천 소재' : '추천 채널 팩'} • {new Date(selectedProposal.createdAt).toLocaleString()}
                        </span>
                      </div>
                      
                      {!isEditing && selectedProposal.status !== 'approved' && (
                         <button 
                           onClick={startEditing}
                           className="bg-indigo-500 hover:bg-indigo-600 text-white p-2 rounded-xl transition-colors shadow-lg shadow-indigo-500/20"
                           title="수정하기"
                         >
                            <span className="material-symbols-outlined text-lg">edit</span>
                         </button>
                      )}
                    </div>

                    <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
                       {/* Description Section */}
                       <div className="mb-8">
                          <label className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 block">설명 / 추천 이유</label>
                          {isEditing ? (
                             <textarea 
                               value={editDesc}
                               onChange={(e) => setEditDesc(e.target.value)}
                               className="w-full p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm focus:ring-2 focus:ring-indigo-500 outline-none resize-none h-32"
                               placeholder="설명을 입력하세요."
                             />
                          ) : (
                             <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800/50">
                                {selectedProposal.description || "설명이 없습니다."}
                             </p>
                          )}
                       </div>

                       {/* Channel List Section */}
                       <div>
                          <div className="flex items-center justify-between mb-3">
                             <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block">
                                포함된 채널 ({isEditing ? editChannels.length : selectedProposal.channels.length})
                             </label>
                          </div>

                          {isEditing && (
                             <div className="flex gap-2 mb-4">
                                <input 
                                  value={editChannelInput}
                                  onChange={(e) => setEditChannelInput(e.target.value)}
                                  onKeyDown={(e) => e.key === 'Enter' && handleAddChannelToEdit()}
                                  placeholder="채널 추가 (URL, 핸들, ID)..."
                                  className="flex-1 text-xs p-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 outline-none focus:border-indigo-500"
                                />
                                <button 
                                  onClick={handleAddChannelToEdit}
                                  disabled={isResolvingChannel}
                                  className="bg-slate-800 text-white px-3 rounded-lg text-xs font-bold hover:bg-slate-700 disabled:opacity-50"
                                >
                                   {isResolvingChannel ? '검색...' : '추가'}
                                </button>
                             </div>
                          )}

                          <div className="space-y-2">
                             {(isEditing ? editChannels : selectedProposal.channels).map((ch, idx) => (
                                <div key={`${ch.id}-${idx}`} className="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-100 dark:border-slate-800 flex items-center gap-3">
                                   <img src={ch.thumbnail} className="size-10 rounded-full bg-slate-100 object-cover" />
                                   <div className="flex-1 min-w-0">
                                      <div className="text-sm font-bold text-slate-900 dark:text-white truncate">{ch.title}</div>
                                      <div className="text-[10px] text-slate-400 truncate">{ch.customUrl || ch.id}</div> 
                                   </div>
                                   {isEditing && (
                                      <button 
                                        onClick={() => handleRemoveChannelFromEdit(ch.id)}
                                        className="text-slate-400 hover:text-rose-500 p-1"
                                      >
                                         <span className="material-symbols-outlined text-sm">delete</span>
                                      </button>
                                   )}
                                   {!isEditing && (
                                     <a href={`https://youtube.com/${ch.customUrl || 'channel/' + ch.id}`} target="_blank" rel="noreferrer" className="text-slate-300 hover:text-indigo-500 p-1">
                                        <span className="material-symbols-outlined text-sm">open_in_new</span>
                                     </a>
                                   )}
                                </div>
                             ))}
                             {(isEditing ? editChannels : selectedProposal.channels).length === 0 && (
                                <div className="text-center py-8 text-slate-400 text-xs italic">
                                   등록된 채널이 없습니다.
                                </div>
                             )}
                          </div>
                       </div>
                    </div>

                    {isEditing && (
                       <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex justify-end gap-3">
                          <button 
                            onClick={() => setIsEditing(false)}
                            className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                          >
                             취소
                          </button>
                          <button 
                            onClick={handleSaveProposal}
                            disabled={isSavingProposal}
                            className="px-6 py-2 rounded-xl text-xs font-bold bg-indigo-500 text-white hover:bg-indigo-600 shadow-lg shadow-indigo-500/30 transition-all flex items-center gap-2"
                          >
                             {isSavingProposal ? '저장 중...' : '변경사항 저장'}
                             {!isSavingProposal && <span className="material-symbols-outlined text-sm">save</span>}
                          </button>
                       </div>
                    )}
                  </div>
                ) : (
                  // List View
                  <>
                  <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">내 제안 내역</h3>
                  {isLoadingProposals ? (
                    <div className="py-20 text-center text-slate-400">Loading...</div>
                  ) : proposals.length === 0 ? (
                    <div className="py-20 text-center text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                      <span className="material-symbols-outlined text-4xl mb-2 opacity-50">post_add</span>
                      <p>아직 제안한 패키지나 소재가 없습니다.</p>
                    </div>
                  ) : (
                    <div className="grid gap-4">
                      {proposals.map(item => (
                        <div 
                          key={item.id} 
                          onClick={() => handleProposalClick(item)}
                          className="bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 p-5 rounded-2xl flex items-start gap-4 hover:border-indigo-300 transition-all cursor-pointer hover:shadow-md group"
                        >
                           <div className={`p-3 rounded-xl shrink-0 ${item.itemType === 'topic' ? 'bg-amber-100 text-amber-600' : 'bg-indigo-100 text-indigo-600'}`}>
                             <span className="material-symbols-outlined">{item.itemType === 'topic' ? 'lightbulb' : 'inventory_2'}</span>
                           </div>
                           <div className="flex-1 min-w-0">
                             <div className="flex justify-between items-start mb-1">
                               <h4 className="font-bold text-slate-900 dark:text-white truncate pr-4 group-hover:text-indigo-600 transition-colors">{item.title}</h4>
                               <span className={`text-[10px] font-black px-2 py-0.5 rounded uppercase tracking-wide ${
                                 item.status === 'approved' ? 'bg-emerald-100 text-emerald-600' :
                                 item.status === 'rejected' ? 'bg-rose-100 text-rose-600' :
                                 'bg-slate-100 text-slate-500'
                               }`}>
                                 {item.status || 'PENDING'}
                               </span>
                             </div>
                             <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 mb-2">{item.description}</p>
                             <div className="flex items-center gap-3 text-[10px] font-medium text-slate-400">
                               <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                               <span>•</span>
                               <span>채널 {item.channelCount}개</span>
                               {item.status !== 'approved' && <span className="text-indigo-400 group-hover:block hidden animate-in fade-in">Click to Edit</span>}
                             </div>
                           </div>
                           <span className="material-symbols-outlined text-slate-300 group-hover:text-indigo-500 transition-colors self-center">chevron_right</span>
                        </div>
                      ))}
                    </div>
                  )}
                  </>
                )}
              </div>
            )}

            {/* 3. Notifications Tab */}
            {activeTab === 'notifications' && (
              <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                <h3 className="text-lg font-bold text-slate-900 dark:text-white mb-4">알림함</h3>
                 {notifications.length === 0 ? (
                  <div className="py-20 text-center text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                    <span className="material-symbols-outlined text-4xl mb-2 opacity-50">notifications_off</span>
                    <p>도착한 알림이 없습니다.</p>
                  </div>
                 ) : (
                     <div className="space-y-3">
                     {notifications.map(notif => (
                       <div 
                         key={notif.id} 
                         onClick={() => !notif.isRead && onMarkRead(notif.id)}
                         className={`p-4 rounded-2xl border flex gap-4 transition-all cursor-pointer hover:scale-[1.01] ${notif.isRead ? 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800 opacity-60' : 'bg-indigo-50/50 dark:bg-indigo-500/5 border-indigo-100 dark:border-indigo-500/20 shadow-sm'}`}
                       >
                          <div className={`mt-1 size-2 rounded-full shrink-0 ${notif.isRead ? 'bg-slate-300' : 'bg-rose-500 animate-pulse'}`}></div>
                          <div className="flex-1">
                            <h4 className="font-bold text-sm text-slate-900 dark:text-white mb-1">{notif.title}</h4>
                            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line mb-2">{notif.message}</p>
                            <span className="text-[10px] text-slate-400">{new Date(notif.createdAt).toLocaleString()}</span>
                          </div>
                       </div>
                     ))}
                   </div>
                 )}
              </div>
            )}

            {/* 4. Support Tab */}
            {activeTab === 'support' && (
              <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                <div className="flex justify-between items-center mb-2">
                   <h3 className="text-lg font-bold text-slate-900 dark:text-white">1:1 문의 게시판</h3>
                   {!isWriting && (
                     <button 
                       onClick={() => setIsWriting(true)}
                       className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-4 py-2 rounded-lg transition-colors flex items-center gap-1"
                     >
                       <span className="material-symbols-outlined text-sm">edit</span>
                       문의 작성
                     </button>
                   )}
                </div>

                {isWriting ? (
                   <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                      {isInquirySuccess ? (
                        <div className="bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-100 dark:border-emerald-500/20 rounded-2xl p-10 text-center">
                          <div className="size-16 bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
                             <span className="material-symbols-outlined text-3xl">check_circle</span>
                          </div>
                          <h4 className="text-xl font-bold text-slate-900 dark:text-white mb-2">문의가 등록되었습니다</h4>
                          <p className="text-slate-500 dark:text-slate-400 text-sm mb-6">관리자 확인 후 답변이 등록되면 알림을 보내드립니다.</p>
                          <button 
                            onClick={() => { setIsInquirySuccess(false); setIsWriting(false); }}
                            className="px-6 py-2 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 transition"
                          >
                            목록으로 돌아가기
                          </button>
                        </div>
                      ) : (
                        <div className="bg-slate-50 dark:bg-slate-800/50 p-6 rounded-2xl border border-slate-200 dark:border-slate-700">
                          <div className="flex justify-between items-center mb-4">
                             <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wide">문의 내용 작성</label>
                             <button onClick={() => setIsWriting(false)} className="text-xs text-slate-400 hover:text-slate-600">취소</button>
                          </div>
                          <textarea 
                            value={inquiryMessage}
                            onChange={(e) => setInquiryMessage(e.target.value)}
                            placeholder="문의하실 내용을 자세히 적어주세요."
                            className="w-full h-48 p-4 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none text-sm leading-relaxed"
                          />
                          <div className="mt-4 flex justify-end">
                            <button 
                              onClick={handleSendInquiry}
                              disabled={isSendingInquiry || !inquiryMessage.trim()}
                              className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white rounded-xl font-bold transition-all flex items-center gap-2"
                            >
                              {isSendingInquiry ? '등록 중...' : '문의 등록하기'}
                              {!isSendingInquiry && <span className="material-symbols-outlined text-sm">send</span>}
                            </button>
                          </div>
                        </div>
                      )}
                   </div>
                ) : (
                   <div className="space-y-3">
                     {inquiries.length === 0 ? (
                        <div className="py-20 text-center text-slate-400 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700">
                          <span className="material-symbols-outlined text-4xl mb-2 opacity-50">forum</span>
                          <p>등록된 문의 내역이 없습니다.</p>
                        </div>
                     ) : (
                        inquiries.map((inq, idx) => {
                          const isExpanded = expandedInquiryId === (inq.id || idx);
                          return (
                            <div key={inq.id || idx} className={`border rounded-xl transition-all overflow-hidden ${isExpanded ? 'border-indigo-200 dark:border-indigo-500/30 bg-white dark:bg-slate-800 shadow-md' : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-indigo-300'}`}>
                               {/* List Header */}
                               <div 
                                 onClick={() => setExpandedInquiryId(isExpanded ? null : (inq.id || idx))}
                                 className="p-4 flex items-center gap-4 cursor-pointer select-none"
                               >
                                  <span className={`shrink-0 px-2.5 py-1 rounded text-[10px] font-black uppercase tracking-wide ${inq.isAnswered ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                                    {inq.isAnswered ? '답변완료' : '접수완료'}
                                  </span>
                                  <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-medium ${isExpanded ? 'text-indigo-600 font-bold' : 'text-slate-700 dark:text-slate-300'} truncate`}>
                                      {inq.message}
                                    </p>
                                    <p className="text-[10px] text-slate-400 mt-0.5">{new Date(inq.createdAt).toLocaleDateString()}</p>
                                  </div>
                                  <span className={`material-symbols-outlined text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180 text-indigo-500' : ''}`}>expand_more</span>
                               </div>

                               {/* Expanded Content */}
                               {isExpanded && (
                                 <div className="border-t border-slate-100 dark:border-slate-700/50 animate-in slide-in-from-top-1 duration-200">
                                    {/* Question */}
                                    <div className="p-5 bg-slate-50/50 dark:bg-slate-800/30">
                                       <div className="flex items-center gap-2 mb-2">
                                          <span className="size-6 bg-slate-200 dark:bg-slate-700 rounded-full flex items-center justify-center text-[10px] font-bold text-slate-600 dark:text-slate-300">Q</span>
                                          <span className="text-xs font-bold text-slate-500">문의 내용</span>
                                       </div>
                                       <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap pl-8">{inq.message}</p>
                                    </div>

                                    {/* Answer */}
                                    <div className="p-5 bg-indigo-50/50 dark:bg-indigo-900/10 border-t border-slate-100 dark:border-slate-700/50">
                                       <div className="flex items-center gap-2 mb-2">
                                          <span className="size-6 bg-indigo-100 dark:bg-indigo-500/20 rounded-full flex items-center justify-center text-[10px] font-bold text-indigo-600">A</span>
                                          <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">관리자 답변</span>
                                          {inq.answeredAt && <span className="text-[10px] text-slate-400 ml-auto">{new Date(inq.answeredAt).toLocaleString()}</span>}
                                       </div>
                                       {inq.isAnswered ? (
                                         <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap pl-8">{inq.answer}</p>
                                       ) : (
                                         <p className="text-sm text-slate-400 pl-8 italic">아직 답변이 등록되지 않았습니다. 관리자가 확인 중입니다.</p>
                                       )}
                                    </div>
                                 </div>
                               )}
                            </div>
                          );
                        })
                     )}
                   </div>
                )}
                
                <div className="p-4 bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl text-slate-500 dark:text-slate-400 text-xs leading-relaxed mt-4">
                  <p>
                    * 문의하신 내용은 관리자만 확인할 수 있습니다.<br/>
                    * 답변 완료 시 알림으로 알려드립니다.
                  </p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

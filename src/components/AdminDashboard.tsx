import React, { useEffect, useState, useMemo } from 'react';
import { collection, query, getDocs, doc, updateDoc, deleteDoc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { RecommendedPackage, SavedChannel } from '../../types';
import { getPackagesFromDb, savePackageToDb, deletePackageFromDb, sendNotification, logAdminMessage } from '../../services/dbService';
import { getChannelInfo } from '../../services/youtubeService';
import DatePicker, { registerLocale } from 'react-datepicker';
import { ko } from 'date-fns/locale/ko';

registerLocale('ko', ko);

interface UserData {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'admin' | 'approved' | 'pending';
  createdAt: string;
  expiresAt?: string; // Optional: Expiration date
  lastLoginAt?: string;
  adminMemo?: string;
}

// Notice Interface
interface Notice {
  content: string;
  isActive: boolean;
  updatedAt: string;
}

// Helper to calculate expiry date
const calculateExpiry = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

const calculateDDay = (expiresAt?: string) => {
  if (!expiresAt) return null;
  const now = new Date();
  const expiry = new Date(expiresAt);
  const diffTime = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) return '만료됨';
  if (diffDays === 0) return 'D-Day';
  return `D-${diffDays}`;
};

export const AdminDashboard = ({ onClose }: { onClose: () => void }) => {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'approved' | 'pending'>('all'); // Filter state
  const [sortConfig, setSortConfig] = useState<{ key: 'expiresAt' | 'role' | 'lastLoginAt' | null; direction: 'asc' | 'desc' }>({ key: null, direction: 'desc' });
  
  // Bulk Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkExtendDuration, setBulkExtendDuration] = useState('30');

  // Notice State
  const [notice, setNotice] = useState<string>('');
  const [isNoticeActive, setIsNoticeActive] = useState(false);
  const [showNoticeInput, setShowNoticeInput] = useState(false);

  // Memo State
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);

  const [memoText, setMemoText] = useState('');

  // Notification State
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifTargetUser, setNotifTargetUser] = useState<UserData | null>(null);
  const [notifTargetMode, setNotifTargetMode] = useState<'individual' | 'all'>('individual');
  const [notifMessage, setNotifMessage] = useState('');

  const openNotifModal = (u: UserData | null, mode: 'individual' | 'all') => {
    setNotifTargetUser(u);
    setNotifTargetMode(mode);
    setNotifMessage('');
    setNotifModalOpen(true);
  };

  const handleSendManualNotification = async () => {
    if (!notifMessage.trim()) return;
    if (notifTargetMode === 'individual' && !notifTargetUser) return;

    try {
      if (notifTargetMode === 'all') {
         if(!window.confirm(`전체 ${users.length}명에게 메시지를 전송하시겠습니까?`)) return;
         
         // Batch send? For strictly consistent behavior, we might need a backend function.
         // For now, client-side loop is acceptable for small user base.
         const promises = users.map(u => 
           sendNotification(u.uid, {
             userId: u.uid,
             title: '관리자 전체 공지',
             message: notifMessage,
             type: 'info'
           })
         );
         await Promise.all(promises);

         // Log
         if (user) {
            await logAdminMessage({
              recipientId: 'ALL',
              recipientName: 'ALL_USERS',
              message: notifMessage,
              adminId: user.uid,
              type: 'all'
            });
         }

         alert(`총 ${users.length}명에게 전송 완료`);
      } else if (notifTargetUser) {
        await sendNotification(notifTargetUser.uid, {
          userId: notifTargetUser.uid,
          title: '관리자 메시지',
          message: notifMessage,
          type: 'info'
        });

        // Log
        if (user) {
            await logAdminMessage({
              recipientId: notifTargetUser.uid,
              recipientName: notifTargetUser.displayName,
              message: notifMessage,
              adminId: user.uid,
              type: 'individual'
            });
        }
        alert("알림을 보냈습니다.");
      }
      setNotifModalOpen(false);
    } catch (e) {
      console.error(e);
      alert("알림 전송 실패");
    }
  };

  // --- Recommended Packages State ---
  const [activeTab, setActiveTab] = useState<'users' | 'packages'>('users');
  const [packages, setPackages] = useState<RecommendedPackage[]>([]);
  const [packageFilter, setPackageFilter] = useState<'all' | 'approved' | 'pending'>('all');
  const [isPackageModalOpen, setIsPackageModalOpen] = useState(false);
  const [editingPackage, setEditingPackage] = useState<RecommendedPackage | null>(null);
  
  // Package Form State
  const [pkgTitle, setPkgTitle] = useState('');
  const [pkgDesc, setPkgDesc] = useState('');
  const [pkgCategory, setPkgCategory] = useState('');
  const [pkgTargetGroup, setPkgTargetGroup] = useState('');
  const [pkgChannels, setPkgChannels] = useState<SavedChannel[]>([]);
  const [pkgChannelInput, setPkgChannelInput] = useState('');
  const [isResolvingChannel, setIsResolvingChannel] = useState(false);
  
  // YouTube API Key for Admin (Optional: use user's key or env key. For now ask user or rely on localStorage if available)
  // YouTube API Key for Admin (Optional: use user's key or env key. For now ask user or rely on localStorage if available)
  const [adminYtKey, setAdminYtKey] = useState(localStorage.getItem('admin_yt_key') || ''); 

  useEffect(() => {
    localStorage.setItem('admin_yt_key', adminYtKey);
  }, [adminYtKey]); 

  const fetchPackages = async () => {
    try {
      const data = await getPackagesFromDb();
      setPackages(data);
    } catch (e) {
      console.error("Error fetching packages", e);
    }
  };

  useEffect(() => {
    if (activeTab === 'packages') fetchPackages();
  }, [activeTab]);

  const handleAddChannelToPkg = async () => {
    if (!pkgChannelInput || !adminYtKey) return alert("채널 입력과 API 키가 필요합니다.");
    setIsResolvingChannel(true);
    
    // Split input by comma, newline, or space
    const inputs = pkgChannelInput.split(/[,\n\s]+/).filter(s => s.trim().length > 0);
    const newChannelsList = [];
    let addedCount = 0;
    
    for (const input of inputs) {
      if (pkgChannels.some(c => c.id === input || c.customUrl === input)) continue;
      
      try {
        const info = await getChannelInfo(adminYtKey, input);
        if (info) {
          if (!pkgChannels.some(c => c.id === info.id) && !newChannelsList.some(c => c.id === info.id)) {
            newChannelsList.push(info);
            addedCount++;
          }
        }
      } catch (e) {
        console.error(`Failed to resolve ${input}`, e);
      }
    }

    if (addedCount > 0) {
      setPkgChannels(prev => [...prev, ...newChannelsList]);
      setPkgChannelInput('');
    } else {
      alert("추가할 채널을 찾을 수 없거나 이미 추가되었습니다.");
    }
    setIsResolvingChannel(false);
  };

  const handleSavePackage = async () => {
    if (!pkgTitle) return alert("제목은 필수입니다.");
    
    const newPkg: RecommendedPackage = {
      id: editingPackage ? editingPackage.id : Date.now().toString(),
      title: pkgTitle,
      description: pkgDesc,
      category: pkgTargetGroup.trim() || 'General', // Auto-fill category with target group or default
      createdAt: editingPackage ? editingPackage.createdAt : Date.now(),
      channels: pkgChannels,
      channelCount: pkgChannels.length,
      targetGroupName: pkgTargetGroup.trim() || undefined,
      status: editingPackage ? (editingPackage.status || 'approved') : 'pending' // Default to pending for new packages
    };

    try {
      await savePackageToDb(newPkg);
      setIsPackageModalOpen(false);
      resetPkgForm();
      fetchPackages();
    } catch (e) {
      alert("저장 실패");
    }
  };

  const handleDeletePackage = async (id: string) => {
    if (!window.confirm("삭제하시겠습니까? (복구 불가)")) return;
    try {
      await deletePackageFromDb(id);
      fetchPackages();
    } catch (e) {
      alert("삭제 실패");
    }
  };

  const handleApprovePackage = async (pkg: RecommendedPackage) => {
    if (!window.confirm(`'${pkg.title}' 패키지를 승인하여 공개하시겠습니까?`)) return;
    try {
      const updatedPkg: RecommendedPackage = { ...pkg, status: 'approved' };
      await savePackageToDb(updatedPkg);
      
      // Send notification if creatorId exists
      if (pkg.creatorId) {
        await sendNotification(pkg.creatorId, {
           userId: pkg.creatorId,
           title: '추천 패키지 승인 완료',
           message: `'${pkg.title}' 패키지가 승인되어 공개되었습니다.`,
           type: 'success'
        });
      }

      fetchPackages();
    } catch (e) {
      alert("승인 처리 실패");
    }
  };

  const filteredPackages = useMemo(() => {
    return packages.filter(p => {
       if (packageFilter === 'all') return true;
       // If status is undefined, treat as approved (legacy)
       const status = p.status || 'approved'; 
       return status === packageFilter;
    });
  }, [packages, packageFilter]);

  const openEditPackage = (pkg: RecommendedPackage) => {
    setEditingPackage(pkg);
    setPkgTitle(pkg.title);
    setPkgDesc(pkg.description);
    setPkgCategory(pkg.category);
    setPkgTargetGroup(pkg.targetGroupName || '');
    setPkgChannels(pkg.channels);
    setIsPackageModalOpen(true);
  };

  const openDuplicatePackage = (pkg: RecommendedPackage) => {
    setEditingPackage(null); // Treat as new
    setPkgTitle(`[복사] ${pkg.title}`);
    setPkgDesc(pkg.description);
    setPkgCategory(pkg.category);
    setPkgTargetGroup(pkg.targetGroupName || '');
    setPkgChannels([...pkg.channels]);
    setIsPackageModalOpen(true);
  };

  const resetPkgForm = () => {
    setEditingPackage(null);
    setPkgTitle('');
    setPkgDesc('');
    setPkgCategory('');
    setPkgTargetGroup('');
    setPkgChannels([]);
    setPkgChannelInput('');
  };

  const handleSort = (key: 'expiresAt' | 'role' | 'lastLoginAt') => {
    setSortConfig((current) => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const fetchUsers = async () => {
    try {
      const q = query(collection(db, 'users'));
      const querySnapshot = await getDocs(q);
      const userList: UserData[] = [];
      querySnapshot.forEach((doc) => {
        userList.push({ uid: doc.id, ...doc.data() } as UserData);
      });
      setUsers(userList);
      
      // Fetch Notice
      try {
        const noticeDoc = await getDoc(doc(db, 'system', 'notice'));
        if (noticeDoc.exists()) {
           const data = noticeDoc.data() as Notice;
           setNotice(data.content);
           setIsNoticeActive(data.isActive);
        }
      } catch (e) {
        console.log("No notice found or init error");
      }

    } catch (error) {
      console.error("Error fetching users:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // Bulk Actions
  const toggleSelectAll = () => {
    if (selectedIds.size === filteredUsers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredUsers.map(u => u.uid)));
    }
  };

  const toggleSelectUser = (uid: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(uid)) newSet.delete(uid);
    else newSet.add(uid);
    setSelectedIds(newSet);
  };

  const handleBulkAction = async (action: 'approve' | 'delete' | 'extend') => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`선택한 ${selectedIds.size}명에게 작업을 수행하시겠습니까?`)) return;

    try {
      const promises = Array.from(selectedIds).map(uid => {
        const userRef = doc(db, 'users', uid);
        if (action === 'approve') return updateDoc(userRef, { role: 'approved' });
        if (action === 'delete') return deleteDoc(userRef);
        if (action === 'extend') {
           // Use selected duration for bulk extension
           const date = new Date();
           date.setDate(date.getDate() + parseInt(bulkExtendDuration));
           return updateDoc(userRef, { expiresAt: date.toISOString() });
        }
        return Promise.resolve();
      });
      
      await Promise.all(promises);
      setSelectedIds(new Set());
      fetchUsers();
    } catch (error) {
      alert("일괄 처리 중 오류가 발생했습니다.");
    }
  };

  // Notice Actions
  const saveNotice = async () => {
    try {
      await setDoc(doc(db, 'system', 'notice'), {
        content: notice,
        isActive: isNoticeActive,
        updatedAt: new Date().toISOString()
      });
      setShowNoticeInput(false);
    } catch (e) {
      alert("공지사항 저장 실패");
    }
  };

  // Memo Actions
  const saveMemo = async (uid: string) => {
    try {
      await updateDoc(doc(db, 'users', uid), { adminMemo: memoText });
      setEditingMemoId(null);
      fetchUsers();
    } catch (e) {
      alert("메모 저장 실패");
    }
  };

  const handleApprove = async (uid: string) => {
    if (!window.confirm("이 사용자를 승인하시겠습니까?")) return;
    try {
      await updateDoc(doc(db, 'users', uid), { role: 'approved' });
      fetchUsers(); // Refresh list
    } catch (error) {
      alert("승인 처리 중 오류가 발생했습니다.");
    }
  };

  const handleDelete = async (uid: string) => {
    if (!window.confirm("정말 이 사용자를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")) return;
    try {
      await deleteDoc(doc(db, 'users', uid));
      fetchUsers();
    } catch (error) {
      alert("삭제 중 오류가 발생했습니다.");
    }
  };

  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [editRole, setEditRole] = useState<'admin' | 'approved' | 'pending'>('pending');
  const [expiryDays, setExpiryDays] = useState<string>(''); // '' means no change or custom
  const [customExpiry, setCustomExpiry] = useState('');

  const handleEditClick = (u: UserData) => {
    setSelectedUser(u);
    setEditRole(u.role);
    setExpiryDays('');
    setCustomExpiry(u.expiresAt ? new Date(u.expiresAt).toISOString().split('T')[0] : '');
  };

  const handleSaveChanges = async () => {
    if (!selectedUser) return;
    
    let newExpiresAt = selectedUser.expiresAt;
    
    if (expiryDays) {
      newExpiresAt = calculateExpiry(parseInt(expiryDays));
    } else if (customExpiry) {
      newExpiresAt = new Date(customExpiry).toISOString();
    }

    try {
      await updateDoc(doc(db, 'users', selectedUser.uid), { 
        role: editRole,
        expiresAt: newExpiresAt || null
      });
      fetchUsers();
      setSelectedUser(null);
    } catch (error) {
      alert("업데이트 중 오류가 발생했습니다.");
    }
  };

  // Filter users based on selected tab
  const filteredUsers = useMemo(() => {
    let result = users.filter(u => {
      if (filter === 'all') return true;
      return u.role === filter;
    });

    if (sortConfig.key) {
      result.sort((a, b) => {
        let aValue: any = sortConfig.key === 'expiresAt' ? (a.expiresAt || '') : sortConfig.key === 'lastLoginAt' ? (a.lastLoginAt || '') : a.role;
        let bValue: any = sortConfig.key === 'expiresAt' ? (b.expiresAt || '') : sortConfig.key === 'lastLoginAt' ? (b.lastLoginAt || '') : b.role;

        // Handle infinite/missing values
        if (sortConfig.key === 'expiresAt' || sortConfig.key === 'lastLoginAt') {
          if (!aValue && !bValue) return 0;
          if (!aValue) return 1; 
          if (!bValue) return -1;
        }

        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }

    return result;
  }, [users, filter, sortConfig]);

  return (
    <div className="fixed inset-0 z-50 bg-slate-50 dark:bg-black animate-in fade-in duration-200 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex flex-col gap-4 p-6 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 sticky top-0 z-10">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <h2 className="text-2xl font-black italic tracking-tighter text-slate-900 dark:text-white uppercase flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">admin_panel_settings</span>
                Admin Dashboard
              </h2>

              {/* Main Tabs */}
              <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                 <button 
                   onClick={() => setActiveTab('users')}
                   className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'users' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'}`}
                 >
                   사용자 관리
                 </button>
                 <button 
                   onClick={() => setActiveTab('packages')}
                   className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'packages' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'}`}
                 >
                   <div className="flex items-center gap-1">
                      <span>추천 팩 관리</span>
                      {activeTab !== 'packages' && <span className="bg-accent-hot size-2 rounded-full"></span>}
                   </div>
                 </button>
              </div>
            </div>
            
            <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors flex items-center gap-2 text-slate-500">
               <span className="text-sm font-bold uppercase">Close</span>
               <span className="material-symbols-outlined">close</span>
            </button>
          </div>

          <div className="flex items-center justify-between">
            {activeTab === 'users' ? (
              <>
                <div className="flex items-center gap-2">
                  {['all', 'approved', 'pending'].map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f as any)}
                      className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${
                        filter === f 
                          ? 'bg-primary/10 text-primary border border-primary/20 shadow-sm' 
                          : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                      }`}
                    >
                      {f === 'all' ? '전체' : f === 'approved' ? '승인됨' : '대기중'} ({
                        f === 'all' ? users.length : users.filter(u => u.role === f).length
                      })
                    </button>
                  ))}
                  <button 
                    onClick={() => setShowNoticeInput(!showNoticeInput)}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ml-4 ${
                      isNoticeActive ? 'bg-accent-hot/10 text-accent-hot border border-accent-hot/20' : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    <span className="material-symbols-outlined text-sm">campaign</span>
                    공지사항
                  </button>
                </div>

                <div className="flex items-center gap-3">
                   {selectedIds.size > 0 && (
                     <div className="flex items-center gap-2 bg-slate-800 text-white px-3 py-1 rounded-lg animate-in fade-in slide-in-from-top-2 shadow-xl border border-slate-700/50">
                       <span className="text-xs font-bold mr-2 whitespace-nowrap">{selectedIds.size}명 선택됨</span>
                       <div className="h-4 w-px bg-slate-600 mx-1"></div>
                       <button onClick={() => handleBulkAction('approve')} className="hover:bg-emerald-600 bg-emerald-600/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded text-xs font-bold transition-colors">승인</button>
                       <div className="flex items-center gap-1 bg-slate-700/50 rounded px-1 ml-1 border border-slate-600">
                         <select 
                           value={bulkExtendDuration}
                           onChange={(e) => setBulkExtendDuration(e.target.value)}
                           className="bg-transparent border-none text-xs text-white p-0 pr-4 h-6 focus:ring-0 cursor-pointer w-20"
                         >
                           <option value="1">1일</option>
                           <option value="30">1개월</option>
                           <option value="365">1년</option>
                         </select>
                         <button onClick={() => handleBulkAction('extend')} className="hover:text-primary text-xs font-bold whitespace-nowrap px-1">연장</button>
                       </div>
                       <div className="h-4 w-px bg-slate-600 mx-1"></div>
                       <button onClick={() => handleBulkAction('delete')} className="hover:bg-rose-500 hover:text-white text-rose-400 px-2 py-0.5 rounded text-xs transition-colors">삭제</button>
                     </div>
                   )}
                   <button 
                     onClick={() => openNotifModal(null, 'all')}
                     className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ml-2 bg-indigo-500 text-white hover:bg-indigo-600 shadow-md shadow-indigo-500/20"
                   >
                     <span className="material-symbols-outlined text-sm">mail</span>
                     전체 쪽지 발송
                   </button>
                </div>
              </>
            ) : (
              <div className="flex items-center gap-4 w-full">
                 <button 
                  onClick={() => { resetPkgForm(); setIsPackageModalOpen(true); }}
                  className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl text-xs font-black uppercase hover:bg-primary-dark transition-colors shadow-lg shadow-primary/20"
                 >
                    <span className="material-symbols-outlined text-sm">add_box</span>
                    추천 팩 만들기
                 </button>
                 <div className="flex-1 flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5">
                    <span className="material-symbols-outlined text-slate-400 text-sm">key</span>
                    <input 
                      type="password"
                      placeholder="채널 검색을 위한 관리자용 YouTube API Key 입력 (필수)"
                      value={adminYtKey}
                      onChange={(e) => setAdminYtKey(e.target.value)}
                      className="flex-1 bg-transparent border-none text-xs text-slate-700 dark:text-slate-300 focus:ring-0"
                    />
                 </div>
              </div>
            )}
          </div>
        </div>
        
        {/* Notice Input Panel */}
        {showNoticeInput && (
          <div className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 p-4 animate-in slide-in-from-top-2">
             <div className="max-w-3xl mx-auto flex gap-4">
               <input 
                 value={notice} 
                 onChange={(e) => setNotice(e.target.value)}
                 placeholder="전체 사용자에게 보여줄 공지사항을 입력하세요"
                 className="flex-1 p-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm"
               />
               <label className="flex items-center gap-2 text-sm font-bold cursor-pointer">
                 <input type="checkbox" checked={isNoticeActive} onChange={(e) => setIsNoticeActive(e.target.checked)} className="rounded text-primary focus:ring-primary" />
                 <span>활성화</span>
               </label>
               <button onClick={saveNotice} className="bg-primary hover:bg-primary-dark text-white px-4 py-2 rounded-lg text-sm font-bold">저장</button>
             </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-auto p-8 max-w-7xl mx-auto w-full">
          {loading ? (
            <div className="flex justify-center py-40">
              <div className="size-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
            </div>
          ) : activeTab === 'users' ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-xs font-bold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                    <th className="px-6 py-4 w-10">
                      <input type="checkbox" checked={selectedIds.size === filteredUsers.length && filteredUsers.length > 0} onChange={toggleSelectAll} className="rounded text-primary focus:ring-primary" />
                    </th>
                    <th className="px-6 py-4">사용자</th>
                    <th className="px-6 py-4">관리자 메모</th>
                    <th className="px-6 py-4">이메일</th>
                    <th className="px-6 py-4 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300 transition-colors" onClick={() => handleSort('lastLoginAt')}>
                      <div className="flex items-center gap-1">
                        최근 접속
                        <span className="material-symbols-outlined text-[14px]">
                          {sortConfig.key === 'lastLoginAt' ? (sortConfig.direction === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
                        </span>
                      </div>
                    </th>
                    <th className="px-6 py-4 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300 transition-colors" onClick={() => handleSort('expiresAt')}>
                      <div className="flex items-center gap-1">
                        만료일
                        <span className="material-symbols-outlined text-[14px]">
                          {sortConfig.key === 'expiresAt' ? (sortConfig.direction === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
                        </span>
                      </div>
                    </th>
                    <th className="px-6 py-4 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300 transition-colors" onClick={() => handleSort('role')}>
                      <div className="flex items-center gap-1">
                        상태
                        <span className="material-symbols-outlined text-[14px]">
                          {sortConfig.key === 'role' ? (sortConfig.direction === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
                        </span>
                      </div>
                    </th>
                    <th className="px-6 py-4 text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-6 py-20 text-center text-slate-400 font-bold">
                        해당하는 사용자가 없습니다.
                      </td>
                    </tr>
                  ) : filteredUsers.map((u) => (
                  <tr key={u.uid} className={`hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${selectedIds.has(u.uid) ? 'bg-slate-50 dark:bg-slate-800/50' : ''}`}>
                    <td className="px-6 py-4 pl-6">
                      <input type="checkbox" checked={selectedIds.has(u.uid)} onChange={() => toggleSelectUser(u.uid)} className="rounded text-primary focus:ring-primary" />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                         <img src={u.photoURL || `https://ui-avatars.com/api/?name=${u.displayName}`} className="size-10 rounded-full bg-slate-200 ring-2 ring-white dark:ring-slate-800" alt="" />
                         <span className="font-bold text-sm dark:text-slate-200">{u.displayName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                            {/* Memo Edit Input */}
                            {editingMemoId === u.uid ? (
                              <div className="flex items-center gap-1 mt-1 animate-in fade-in">
                                <input 
                                  autoFocus
                                  value={memoText} 
                                  onChange={(e) => setMemoText(e.target.value)} 
                                  className="text-xs p-1 border rounded w-32 dark:bg-slate-700 dark:border-slate-600" 
                                  onKeyDown={(e) => e.key === 'Enter' && saveMemo(u.uid)}
                                />
                                <button onClick={() => saveMemo(u.uid)} className="text-emerald-500"><span className="material-symbols-outlined text-[14px]">check</span></button>
                                <button onClick={() => setEditingMemoId(null)} className="text-rose-500"><span className="material-symbols-outlined text-[14px]">close</span></button>
                              </div>
                            ) : (
                               <button 
                                 onClick={() => { setEditingMemoId(u.uid); setMemoText(u.adminMemo || ''); }}
                                 className="text-xs text-slate-400 hover:text-primary text-left flex items-center gap-2 px-2 py-1 hover:bg-slate-100 dark:hover:bg-slate-700/50 rounded transition-colors group"
                               >
                                 <span className={`material-symbols-outlined text-[14px] ${u.adminMemo ? 'text-amber-400' : 'text-slate-300 group-hover:text-primary'}`}>sticky_note_2</span>
                                 <span className={`${u.adminMemo ? 'text-slate-700 dark:text-slate-300 font-medium' : 'text-slate-300'}`}>
                                   {u.adminMemo ? (u.adminMemo.length > 15 ? u.adminMemo.substring(0,15)+'...' : u.adminMemo) : '메모하기'}
                                 </span>
                               </button>
                            )}
                    </td>
                    <td className="px-6 py-4 text-sm text-slate-600 dark:text-slate-400">{u.email}</td>
                    <td className="px-6 py-4 text-xs font-mono text-slate-500">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '-'}
                    </td>
                    <td className="px-6 py-4 text-xs font-mono">
                      {u.expiresAt ? (
                        <div className="flex flex-col">
                          <span className="text-slate-600 dark:text-slate-400">{new Date(u.expiresAt).toLocaleDateString()}</span>
                          <span className={`font-bold ${
                            calculateDDay(u.expiresAt) === '만료됨' ? 'text-rose-500' :
                            calculateDDay(u.expiresAt)?.startsWith('D-') ? 'text-primary' : 'text-slate-400'
                          }`}>
                            {calculateDDay(u.expiresAt)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">무제한</span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wide border ${
                        u.role === 'admin' ? 'bg-purple-100 text-purple-600 border-purple-200' :
                        u.role === 'approved' ? 'bg-emerald-100 text-emerald-600 border-emerald-200' :
                        'bg-yellow-100 text-yellow-600 border-yellow-200'
                      }`}>
                        {u.role === 'admin' ? '관리자' : u.role === 'approved' ? '승인됨' : '대기중'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button 
                        onClick={() => openNotifModal(u, 'individual')}
                        className="text-slate-500 hover:text-indigo-500 bg-slate-100 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-indigo-900/30 px-2 py-1.5 rounded-lg transition-colors mr-2 text-[10px] font-bold"
                        title="메시지 보내기"
                      >
                         메세지
                      </button>

                      <button 
                        onClick={() => handleEditClick(u)}
                        className="text-xs font-bold text-white bg-slate-500 hover:bg-slate-600 px-3 py-1.5 rounded-lg mr-2 transition-colors shadow-sm"
                      >
                        수정
                      </button>
                      
                      {u.uid !== user?.uid && (
                        <button 
                             onClick={() => handleDelete(u.uid)}
                             className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                             title="삭제"
                        >
                             <span className="material-symbols-outlined text-lg">delete</span>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
                {/* Package Filters */}
                <div className="flex items-center gap-2">
                   {['all', 'approved', 'pending'].map(f => (
                     <button 
                       key={f}
                       onClick={() => setPackageFilter(f as any)}
                       className={`px-4 py-1.5 rounded-lg text-sm font-bold transition-all ${
                         packageFilter === f 
                         ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30' 
                         : 'bg-white dark:bg-slate-800 text-slate-500 hover:text-indigo-500'
                       }`}
                     >
                       {f === 'all' ? '전체' : f === 'approved' ? '공식 (승인됨)' : '대기중 (제안)'}
                       <span className="ml-2 text-xs opacity-60 bg-black/10 px-1.5 rounded-full">
                         {f === 'all' 
                           ? packages.length 
                           : packages.filter(p => (p.status || 'approved') === f).length}
                       </span>
                     </button>
                   ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                  {filteredPackages.length === 0 ? (
                    <div className="col-span-full py-20 text-center text-slate-400 text-sm">
                        해당하는 패키지가 없습니다.
                    </div>
                  ) : (
                    filteredPackages.map(pkg => {
                      const status = pkg.status || 'approved';
                      return (
                        <div key={pkg.id} className={`relative bg-white dark:bg-slate-900 border rounded-2xl p-6 shadow-sm hover:shadow-lg transition-all space-y-4 ${status === 'pending' ? 'border-orange-200 dark:border-orange-500/30 ring-1 ring-orange-100 dark:ring-orange-900/20' : 'border-slate-200 dark:border-slate-800'}`}>
                          {status === 'pending' && (
                            <div className="absolute top-4 right-4 bg-orange-100 text-orange-600 px-2 py-0.5 rounded text-[10px] font-black uppercase">
                              승인 대기중
                            </div>
                          )}
                          
                          <div className="flex items-start justify-between pr-8">
                            <div>
                              <span className="text-[10px] uppercase font-bold text-primary bg-primary/10 px-2 py-1 rounded">{pkg.category}</span>
                              <h3 className="text-lg font-black mt-2 leading-tight">{pkg.title}</h3>
                              {pkg.creatorName && (
                                <p className="text-[10px] font-bold text-slate-400 mt-1 flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[12px]">person</span>
                                  제안자: {pkg.creatorName}
                                </p>
                              )}
                              <p className="text-xs text-slate-500 mt-2 line-clamp-2">{pkg.description}</p>
                            </div>
                          </div>
                          
                          <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl space-y-3">
                            <p className="text-[10px] font-bold text-slate-400 uppercase">포함된 채널 ({pkg.channelCount}개)</p>
                            <div className="flex flex-wrap gap-2">
                                {pkg.channels.slice(0, 5).map(ch => (
                                  <img key={ch.id} src={ch.thumbnail} className="size-8 rounded-full border border-slate-200 dark:border-slate-700 bg-white" title={ch.title} />
                                ))}
                                {pkg.channels.length > 5 && (
                                  <div className="size-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-[10px] font-bold text-slate-500">
                                      +{pkg.channels.length - 5}
                                  </div>
                                )}
                            </div>
                          </div>

                          <div className="flex items-center justify-between border-t border-slate-100 dark:border-slate-800 pt-4">
                             <span className="text-[10px] text-slate-400">
                               {new Date(pkg.createdAt).toLocaleDateString()}
                             </span>
                             <div className="flex items-center gap-1">
                                {status === 'pending' && (
                                  <button onClick={() => handleApprovePackage(pkg)} className="flex items-center gap-1 bg-emerald-500/10 text-emerald-600 px-3 py-1.5 rounded-lg text-xs font-bold hover:bg-emerald-500 hover:text-white transition-colors mr-2">
                                     <span className="material-symbols-outlined text-sm">check</span>
                                     승인
                                  </button>
                                )}
                                <button onClick={() => openDuplicatePackage(pkg)} className="text-slate-400 hover:text-indigo-500 p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800" title="복제"><span className="material-symbols-outlined text-lg">content_copy</span></button>
                                <button onClick={() => openEditPackage(pkg)} className="text-slate-400 hover:text-primary p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800" title="수정"><span className="material-symbols-outlined text-lg">edit</span></button>
                                <button onClick={() => handleDeletePackage(pkg.id)} className="text-slate-400 hover:text-rose-500 p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800" title={status === 'pending' ? '거절 (삭제)' : '삭제'}><span className="material-symbols-outlined text-lg">delete</span></button>
                             </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
            </div>
          )}
        </div>
        
        {/* User Edit Modal */}
        {selectedUser && (
          <div className="absolute inset-0 bg-white/95 dark:bg-slate-900/95 z-10 flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200">
             <div className="w-full max-w-md space-y-6"> 
               <h3 className="text-lg font-bold dark:text-white">사용자 권한 설정</h3>
               
               <div className="space-y-4">
                 <div>
                   <label className="block text-xs font-bold text-slate-500 mb-1">등급 (Role)</label>
                   <div className="flex gap-2">
                     {['pending', 'approved', 'admin'].map((r) => (
                       <button
                         key={r}
                         onClick={() => setEditRole(r as any)}
                         className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${
                           editRole === r 
                             ? 'bg-primary text-white border-primary' 
                             : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
                         }`}
                       >
                         {r === 'admin' ? '관리자' : r === 'approved' ? '승인됨' : '대기'}
                       </button>
                     ))}
                   </div>
                 </div>

                 <div>
                   <label className="block text-xs font-bold text-slate-500 mb-1">이용 기간 연장</label>
                   <select 
                     value={expiryDays} 
                     onChange={(e) => {
                       setExpiryDays(e.target.value);
                       if(e.target.value) setCustomExpiry(''); // Clear custom if preset selected
                     }}
                     className="w-full p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                   >
                     <option value="">직접 선택 / 유지</option>
                     <option value="1">1일 테스트 (+1일)</option>
                     <option value="7">1주일 (+7일)</option>
                     <option value="30">1개월 (+30일)</option>
                     <option value="90">3개월 (+90일)</option>
                     <option value="180">6개월 (+180일)</option>
                     <option value="365">1년 (+365일)</option>
                   </select>
                 </div>
                                  <div>
                     <label className="block text-xs font-bold text-slate-500 mb-1">만료일 직접 입력</label>
                     <div className="relative">
                       <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 material-symbols-outlined text-[18px] pointer-events-none z-10">calendar_today</span>
                       <DatePicker
                         selected={customExpiry ? new Date(customExpiry) : null}
                         onChange={(date) => {
                           if (date) {
                             // 로컬 시간대 이슈 방지를 위해 날짜 문자열로 변환 (YYYY-MM-DD)
                             const offset = date.getTimezoneOffset() * 60000;
                             const localISOTime = (new Date(date.getTime() - offset)).toISOString().slice(0, 10);
                             setCustomExpiry(localISOTime);
                             setExpiryDays('');
                           } else {
                             setCustomExpiry('');
                           }
                         }}
                         dateFormat="yyyy. MM. dd"
                         locale="ko"
                         className="custom-datepicker-input"
                         placeholderText="날짜를 선택하세요"
                         wrapperClassName="w-full"
                         popperPlacement="top-end"
                       />
                     </div>
                  </div>
               </div>

               <div className="flex gap-3 pt-4">
                 <button 
                   onClick={() => setSelectedUser(null)}
                   className="flex-1 py-3 font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                 >
                   취소
                 </button>
                 <button 
                   onClick={handleSaveChanges}
                   className="flex-1 py-3 font-bold text-white bg-emerald-500 hover:bg-emerald-600 rounded-xl transition-colors shadow-lg shadow-emerald-500/20"
                 >
                   변경 사항 저장
                 </button>
               </div>
             </div>
          </div>
        )}
        
        {/* Package Create/Edit Modal */}
        {isPackageModalOpen && (
          <div className="absolute inset-0 bg-white/95 dark:bg-slate-900/95 z-20 flex items-center justify-center p-4 animate-in fade-in zoom-in duration-200">
             <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col max-h-[90vh]"> 
               <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/30">
                 <h3 className="text-xl font-black italic uppercase text-slate-900 dark:text-white flex items-center gap-2">
                   <span className="material-symbols-outlined text-primary">inventory_2</span>
                   {editingPackage ? '추천 팩 수정' : '새 추천 팩 만들기'}
                 </h3>
                 <button onClick={() => setIsPackageModalOpen(false)} className="text-slate-400 hover:text-rose-500"><span className="material-symbols-outlined">close</span></button>
               </div>
               
               <div className="p-8 space-y-6 overflow-y-auto">
                 <div className="grid grid-cols-2 gap-6">
                   <div className="space-y-4">
                     <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase">패키지 제목</label>
                       <input 
                         value={pkgTitle} 
                         onChange={(e) => setPkgTitle(e.target.value)} 
                         placeholder="예: 2024 상반기 떡상 가이드"
                         className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold text-sm focus:ring-2 focus:ring-primary/20"
                       />
                     </div>
                     <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase">타겟 그룹 이름 (선택)</label>
                       <input 
                         value={pkgTargetGroup} 
                         onChange={(e) => setPkgTargetGroup(e.target.value)} 
                         placeholder="예: 주식 필수 채널 (다운로드 시 그룹 생성)"
                         className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold text-sm focus:ring-2 focus:ring-primary/20"
                       />
                     </div>
                   </div>
                   <div>
                     <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase">설명</label>
                     <textarea 
                       value={pkgDesc} 
                       onChange={(e) => setPkgDesc(e.target.value)} 
                       placeholder="이 패키지에 대한 설명을 입력하세요..."
                       className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm h-[124px] resize-none focus:ring-2 focus:ring-primary/20"
                     />
                   </div>
                 </div>

                 <div className="border-t border-slate-100 dark:border-slate-800 pt-6">
                    <label className="block text-xs font-bold text-slate-500 mb-3 uppercase flex items-center justify-between">
                      <span>채널 구성 ({pkgChannels.length}개)</span>
                      {!adminYtKey && <span className="text-rose-500 flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">warning</span> API Key 필요</span>}
                    </label>
                    <div className="flex gap-2 mb-4">
                       <input 
                         value={pkgChannelInput}
                         onChange={(e) => setPkgChannelInput(e.target.value)}
                         onKeyDown={(e) => e.key === 'Enter' && handleAddChannelToPkg()}
                         placeholder="채널 핸들(@name), ID, 또는 URL (여러 개 입력 가능: 콤마/엔터로 구분)"
                         className="flex-1 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-sm"
                       />
                       <button 
                         onClick={handleAddChannelToPkg}
                         disabled={isResolvingChannel || !adminYtKey}
                         className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-6 rounded-xl font-bold text-sm hover:bg-primary dark:hover:bg-primary dark:hover:text-white transition-colors disabled:opacity-50 flex items-center gap-2"
                       >
                         {isResolvingChannel ? '검색 중...' : '추가'}
                       </button>
                    </div>

                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-2 min-h-[150px] max-h-[300px] overflow-y-auto border border-slate-200 dark:border-slate-700">
                      {pkgChannels.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2 py-10">
                           <span className="material-symbols-outlined text-3xl opacity-20">playlist_add</span>
                           <span className="text-xs">채널을 추가해주세요</span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 gap-2">
                           {pkgChannels.map((ch, idx) => (
                             <a 
                               href={ch.customUrl ? (ch.customUrl.startsWith('http') ? ch.customUrl : `https://www.youtube.com/${ch.customUrl}`) : `https://www.youtube.com/channel/${ch.id}`}
                               target="_blank"
                               rel="noopener noreferrer"
                               key={`${ch.id}-${idx}`} 
                               className="flex items-center gap-3 bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-100 dark:border-slate-800 group hover:border-primary/50 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                             >
                                <img src={ch.thumbnail} className="size-8 rounded-full bg-slate-200" />
                                <div className="flex-1 min-w-0">
                                   <div className="font-bold text-xs truncate dark:text-slate-200 group-hover:text-primary transition-colors">{ch.title}</div>
                                   <div className="text-[10px] text-slate-400 truncate">{ch.id}</div>
                                </div>
                                <button 
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setPkgChannels(prev => prev.filter(c => c.id !== ch.id));
                                  }}
                                  className="text-slate-300 hover:text-rose-500 p-1 opacity-0 group-hover:opacity-100 transition-all z-10 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded"
                                  title="목록에서 삭제"
                                >
                                   <span className="material-symbols-outlined text-lg">close</span>
                                </button>
                             </a>
                           ))}
                        </div>
                      )}
                    </div>
                 </div>
               </div>

               <div className="p-6 border-t border-slate-100 dark:border-slate-800 flex gap-3 bg-slate-50/50 dark:bg-slate-800/30 rounded-b-2xl">
                 <button 
                   onClick={() => setIsPackageModalOpen(false)}
                   className="flex-1 py-3 font-bold text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-colors"
                 >
                   취소
                 </button>
                 <button 
                   onClick={handleSavePackage}
                   className="flex-[2] py-3 font-bold text-white bg-indigo-500 hover:bg-indigo-600 rounded-xl transition-colors shadow-lg shadow-indigo-500/20 flex items-center justify-center gap-2"
                 >
                   <span className="material-symbols-outlined text-lg">save</span>
                   {editingPackage ? '수정 사항 저장' : '패키지 생성 완료'}
                 </button>
               </div>
             </div>
          </div>
        )}

        {notifModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
             <div className="bg-white dark:bg-slate-900 w-full max-w-md rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95">
               <div className="p-6 border-b border-slate-100 dark:border-slate-800">
                 <h3 className="text-lg font-bold flex items-center gap-2">
                    <span className="material-symbols-outlined text-indigo-500">send</span>
                    {notifTargetMode === 'all' ? '전체 공지 발송' : '개별 메시지 전송'}
                 </h3>
                 <p className="text-xs text-slate-400 mt-1">To: {notifTargetMode === 'all' ? `전체 사용자 (${users.length}명)` : notifTargetUser?.displayName}</p>
               </div>
               <div className="p-6">
                 <textarea 
                   value={notifMessage}
                   onChange={(e) => setNotifMessage(e.target.value)}
                   className="w-full h-32 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm resize-none"
                   placeholder="메시지 내용을 입력하세요..."
                   autoFocus
                 />
               </div>
               <div className="p-6 pt-0 flex gap-3">
                 <button onClick={() => setNotifModalOpen(false)} className="flex-1 py-3 text-slate-500 font-bold hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">취소</button>
                 <button onClick={handleSendManualNotification} className="flex-1 py-3 bg-indigo-500 text-white font-bold rounded-xl hover:bg-indigo-600 transition-colors shadow-lg shadow-indigo-500/20">전송</button>
               </div>
             </div>
          </div>
        )}
    </div>
  );
};

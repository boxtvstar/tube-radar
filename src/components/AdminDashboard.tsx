import React, { useEffect, useState, useMemo } from 'react';
import { collection, query, getDocs, doc, updateDoc, deleteDoc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
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
        <div className="h-16 px-6 border-b border-slate-200 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 shadow-sm shrink-0">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold dark:text-white flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-3xl">admin_panel_settings</span>
              관리자 대시보드
            </h2>
            <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 mx-2"></div>
            
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
              {['all', 'approved', 'pending'].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f as any)}
                  className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all ${
                    filter === f 
                      ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm' 
                      : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                  }`}
                >
                  {f === 'all' ? '전체' : f === 'approved' ? '승인됨' : '대기중'} ({
                    f === 'all' ? users.length : users.filter(u => u.role === f).length
                  })
                </button>
              ))}
            </div>

            {/* Notice Button */}
            <button 
              onClick={() => setShowNoticeInput(!showNoticeInput)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                isNoticeActive ? 'bg-accent-hot/10 text-accent-hot border border-accent-hot/20' : 'bg-slate-100 text-slate-500'
              }`}
            >
              <span className="material-symbols-outlined text-sm">campaign</span>
              공지사항 관리
            </button>
          </div>

          <div className="flex items-center gap-3">
             {/* Bulk Actions Bar */}
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
                     <option value="1">1일 (+1)</option>
                     <option value="7">1주 (+7)</option>
                     <option value="30">1개월 (+30)</option>
                     <option value="90">3개월 (+90)</option>
                     <option value="365">1년 (+365)</option>
                   </select>
                   <button onClick={() => handleBulkAction('extend')} className="hover:text-primary text-xs font-bold whitespace-nowrap px-1">연장</button>
                 </div>

                 <div className="h-4 w-px bg-slate-600 mx-1"></div>

                 <button onClick={() => handleBulkAction('delete')} className="hover:bg-rose-500 hover:text-white text-rose-400 px-2 py-0.5 rounded text-xs transition-colors">삭제</button>
               </div>
             )}
             <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors flex items-center gap-2 text-slate-500">
                <span className="text-sm font-bold uppercase">Close</span>
                <span className="material-symbols-outlined">close</span>
             </button>
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
          ) : (
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
    </div>
  );
};

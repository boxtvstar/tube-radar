import React, { useEffect, useState, useMemo } from 'react';
import { collection, query, getDocs, doc, updateDoc, deleteDoc, getDoc, setDoc, where, addDoc, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useAuth } from '../contexts/AuthContext';
import { RecommendedPackage, SavedChannel, ApiUsage } from '../../types';
import { getPackagesFromDb, savePackageToDb, deletePackageFromDb, getTopicsFromDb, saveTopicToDb, deleteTopicFromDb, sendNotification, logAdminMessage, getInquiries, replyToInquiry, getUsageFromDb } from '../../services/dbService';
import { getChannelInfo, fetchChannelPopularVideos } from '../../services/youtubeService';
import { generateChannelRecommendation } from '../../services/geminiService';
import DatePicker, { registerLocale } from 'react-datepicker';
import { ko } from 'date-fns/locale/ko';


registerLocale('ko', ko);

declare global {
  interface Window {
    google: any;
  }
}

interface UserData {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'admin' | 'approved' | 'pending' | 'regular' | 'pro' | 'guest';
  createdAt: string;
  expiresAt?: string; // Optional: Expiration date
  plan?: string; // Subscription Plan
  channelId?: string; // YouTube Channel ID
  lastLoginAt?: string;
  adminMemo?: string;
}

// Notice Interface
interface Notice {
  id?: string;
  title: string;
  content: string;
  isActive: boolean;
  imageUrl?: string;
  updatedAt: string;
  createdAt?: string;
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

const getStatusColor = (status?: string) => {
  switch (status) {
    case 'approved': return 'bg-emerald-50 text-emerald-500 border-emerald-200';
    case 'rejected': return 'bg-rose-50 text-rose-500 border-rose-200';
    case 'pending': return 'bg-amber-50 text-amber-500 border-amber-200';
    default: return 'bg-slate-50 text-slate-500 border-slate-200';
  }
};

const getStatusLabel = (status?: string) => {
  switch (status) {
    case 'approved': return '승인됨';
    case 'rejected': return '거부됨';
    case 'pending': return '대기중';
    default: return '대기중';
  }
};

export const AdminDashboard = ({ onClose, apiKey }: { onClose: () => void, apiKey?: string }) => {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [userPointData, setUserPointData] = useState<Record<string, ApiUsage>>({});
  const [pointDataLoading, setPointDataLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'approved' | 'pending'>('all'); // Filter state
  const [sortConfig, setSortConfig] = useState<{ key: 'expiresAt' | 'role' | 'lastLoginAt' | null; direction: 'asc' | 'desc' }>({ key: null, direction: 'desc' });
  
  // Bulk Selection State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkExtendDuration, setBulkExtendDuration] = useState('30');

  // Notice State
  const [notice, setNotice] = useState<string>('');
  const [isNoticeActive, setIsNoticeActive] = useState(false);
  const [showNoticeInput, setShowNoticeInput] = useState(false);
  const [noticeImageUrl, setNoticeImageUrl] = useState<string>('');
  
  // Notice Board State
  const [noticeList, setNoticeList] = useState<Notice[]>([]);
  const [noticeViewMode, setNoticeViewMode] = useState<'list' | 'form'>('list');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [isUploading, setIsUploading] = useState(false);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
       alert("이미지 파일만 업로드 가능합니다.");
       return;
    }

    // 파일 사이즈 체크 (약 1.5MB 제한 - Firestore 문서 제한 고려)
    if (file.size > 1.5 * 1024 * 1024) {
        alert("이미지 용량이 너무 큽니다. (1.5MB 이하만 가능)\n용량을 줄여서 다시 올려주세요.");
        return;
    }

    setIsUploading(true);
    
    const reader = new FileReader();
    reader.onload = () => {
        if (typeof reader.result === 'string') {
            setNoticeImageUrl(reader.result);
        }
        setIsUploading(false);
    };
    reader.onerror = () => {
        console.error("File reading failed");
        alert("이미지 변환 중 오류가 발생했습니다.");
        setIsUploading(false);
    };
    reader.readAsDataURL(file);
  };

  // Memo State
  const [editingMemoId, setEditingMemoId] = useState<string | null>(null);

  const [memoText, setMemoText] = useState('');

  // Notification State
  const [notifModalOpen, setNotifModalOpen] = useState(false);
  const [notifTargetUser, setNotifTargetUser] = useState<UserData | null>(null);
  const [notifTargetMode, setNotifTargetMode] = useState<'individual' | 'all'>('individual');
  const [notifTargetInquiryId, setNotifTargetInquiryId] = useState<string | null>(null);
  const [notifMessage, setNotifMessage] = useState('');

  const [expandedInquiryId, setExpandedInquiryId] = useState<string | null>(null);
  const toggleInquiryExpansion = (id: string) => {
    setExpandedInquiryId(prev => prev === id ? null : id);
  };


  // const [replyingInquiryId, setReplyingInquiryId] = useState<string | null>(null); // Deprecated
  // const [replyMessage, setReplyMessage] = useState(''); // Deprecated
  const [replyDrafts, setReplyDrafts] = useState<{[key:string]: string}>({});

  const openNotifModal = (u: UserData | null, mode: 'individual' | 'all') => {
    setNotifTargetUser(u);
    setNotifTargetMode(mode);
    setNotifTargetInquiryId(null); // Clear inquiry ID as this is now general notif
    setNotifMessage('');
    setNotifModalOpen(true);
  };

  // Badge Counts State
  const [counts, setCounts] = useState({
    pendingUsers: 0,
    pendingPackages: 0,
    pendingTopics: 0,
    unrepliedInquiries: 0
  });

  // Fetch Counts on Mount
  useEffect(() => {
    const fetchCounts = async () => {
        try {
            // 1. Pending Users
            const qUsers = query(collection(db, 'users'), where('role', '==', 'pending'));
            const snapUsers = await getDocs(qUsers);
            
            // 2. Unreplied Inquiries
            const qInquiries = query(collection(db, 'inquiries'), where('isAnswered', '==', false));
            const snapInquiries = await getDocs(qInquiries);

            // 3. Pending Packages (if user submission exists)
            const qPkgs = query(collection(db, 'recommended_packages'), where('status', '==', 'pending'));
            const snapPkgs = await getDocs(qPkgs);

            // 4. Pending Topics
            const qTopics = query(collection(db, 'recommended_topics'), where('status', '==', 'pending'));
            const snapTopics = await getDocs(qTopics);

            setCounts({
                pendingUsers: snapUsers.size,
                unrepliedInquiries: snapInquiries.size,
                pendingPackages: snapPkgs.size,
                pendingTopics: snapTopics.size
            });
        } catch (e) {
            console.error("Failed to fetch notification counts", e);
        }
    };
    fetchCounts();
  }, []);

  const [viewingHistoryUser, setViewingHistoryUser] = useState<UserData | null>(null);
  const [historyList, setHistoryList] = useState<any[]>([]);

  useEffect(() => {
     if (viewingHistoryUser) {
        const fetchHistory = async () => {
           try {
             const q = query(
                collection(db, 'users', viewingHistoryUser.uid, 'history'), 
                orderBy('date', 'desc'),
                limit(50)
             );
             const snap = await getDocs(q);
             setHistoryList(snap.docs.map(d => ({id: d.id, ...d.data()})));
           } catch (e) {
             console.log("No history or failed to fetch", e);
             setHistoryList([]);
           }
        };
        fetchHistory();
     } else {
        setHistoryList([]);
     }
  }, [viewingHistoryUser]);



  const handleSendInlineReply = async (inquiryId: string, userId: string, userName: string, content: string) => {
    if (!content.trim()) return;
    
    try {
        await replyToInquiry(inquiryId, userId, content);
        
        if (user) {
            await logAdminMessage({
                recipientId: userId,
                recipientName: userName,
                message: `[Inquiry Reply] ${content}`,
                adminId: user.uid,
                type: 'individual'
            });
        }
        
        // Update local state
        setInquiries(prev => prev.map(inq => inq.id === inquiryId ? {...inq, isAnswered: true, answer: content, answeredAt: Date.now()} : inq));
        
        // Clear draft
        setReplyDrafts(prev => {
            const newState = {...prev};
            delete newState[inquiryId];
            return newState;
        });
        
        alert("답장이 전송되었습니다.");
    } catch (e) {
        console.error(e);
        alert("전송 실패");
    }
  };

  // Whitelist Viewer State
  const [showWhitelistModal, setShowWhitelistModal] = useState(false);
  const [whitelistData, setWhitelistData] = useState<{count: number, updatedAt: string, ids: string[], memberDetails: any[]} | null>(null);

  const loadWhitelist = async () => {
    try {
      const docRef = doc(db, "system_data", "membership_whitelist");
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data();
        setWhitelistData({
          count: data.validChannelIds?.length || 0,
          updatedAt: data.updatedAt ? new Date(data.updatedAt).toLocaleString() : '기록 없음',
          ids: data.validChannelIds || [],
          memberDetails: data.memberDetails || [] // Load details!
        });
      } else {
        setWhitelistData({ count: 0, updatedAt: '데이터 없음', ids: [], memberDetails: [] });
      }
      // setShowWhitelistModal(true); // No popup on load
    } catch (e) {
      console.error("Failed to load whitelist", e);
    }
  };

  // Auto-load on mount
  useEffect(() => {
    loadWhitelist();
  }, []);

  // --- Membership Search & Sort State ---
  const [memberSearchTerm, setMemberSearchTerm] = useState('');
  const [memberSortConfig, setMemberSortConfig] = useState<{ key: string | null; direction: 'asc' | 'desc' }>({ key: null, direction: 'asc' });

  // Filter & Sort Logic
  const processedMembers = useMemo(() => {
     if (!whitelistData) return [];
     
     // 1. Prepare Base List
     let data = (whitelistData as any).memberDetails && (whitelistData as any).memberDetails.length > 0 
        ? [...(whitelistData as any).memberDetails] 
        : (whitelistData.ids || []).map((id: string) => ({ id, name: '-', tier: '-', tierDuration: '-', totalDuration: '-', lastUpdate: '-' }));

     // 2. Filter
     if (memberSearchTerm) {
        const lower = memberSearchTerm.toLowerCase();
        data = data.filter((m: any) => 
           (m.name && m.name.toLowerCase().includes(lower)) || 
           (m.id && m.id.toLowerCase().includes(lower))
        );
     }

     // 3. Sort
     if (memberSortConfig.key) {
        data.sort((a: any, b: any) => {
           let aVal = a[memberSortConfig.key!];
           let bVal = b[memberSortConfig.key!];

           // Numeric
           if (['tierDuration', 'totalDuration'].includes(memberSortConfig.key!)) {
              aVal = parseFloat(aVal) || 0;
              bVal = parseFloat(bVal) || 0;
           }

           if (aVal < bVal) return memberSortConfig.direction === 'asc' ? -1 : 1;
           if (aVal > bVal) return memberSortConfig.direction === 'asc' ? 1 : -1;
           return 0;
        });
     }

     return data;
  }, [whitelistData, memberSearchTerm, memberSortConfig]);

  const handleMemberSort = (key: string) => {
     setMemberSortConfig(prev => ({
        key,
        direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
     }));
  };



   // --- CSV Upload Logic (Smart Encoding/Separator Detection) ---
   // --- CSV Upload Logic (Strict Format Match) ---
   const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
         const buffer = event.target?.result as ArrayBuffer;
         if (!buffer) return;

         // 1. Decode (UTF-8 preferred, fallback to EUC-KR)
         let text = new TextDecoder('utf-8').decode(buffer);
         
         // Check for replacement character  (indication of wrong encoding)
         if (text.includes('\uFFFD')) { 
             console.warn("UTF-8 decoding showed replacement characters. Trying EUC-KR.");
             try { 
                text = new TextDecoder('euc-kr').decode(buffer); 
             } catch(e) {
                console.error("EUC-KR decoding failed", e);
             }
         }

         const lines = text.split(/[\r\n]+/);
         
         // 2. Find Header Row
         // Look for the specific headers shown in the user's screenshot
         let headerIdx = -1;
         for (let i = 0; i < Math.min(lines.length, 20); i++) {
             // loosen the check slightly to handle potential variations or "Member" vs "회원"
             if (lines[i].includes('회원') || lines[i].includes('Member') || lines[i].includes('프로필')) {
                 // Check for at least two keywords to be safe
                 if (lines[i].includes('연결') || lines[i].includes('Link') || lines[i].includes('등급') || lines[i].includes('Tier')) {
                    headerIdx = i;
                    break;
                 }
             }
         }

         if (headerIdx === -1) {
             const preview = lines.slice(0, 5).join('\n');
             alert(`[오류] 헤더를 찾을 수 없습니다.\n\n파일 형식이 올바르지 않거나 인코딩 문제일 수 있습니다.\n\n--- 파일 내용 미리보기 ---\n${preview}`);
             return;
         }

         // 3. Detect Separator from Header Row
         const headerLine = lines[headerIdx];
         let separator = ',';
         if ((headerLine.match(/\t/g) || []).length > (headerLine.match(/,/g) || []).length) separator = '\t';

         // Helper: Split Row
         const splitRow = (str: string) => {
             if (separator === '\t') return str.split('\t').map(s => s.trim().replace(/^"|"$/g, ''));
             // Comma split
             const res: string[] = [];
             let cur = '', inQ = false;
             for(const char of str) {
                 if(char === '"') inQ = !inQ;
                 else if(char === ',' && !inQ) { res.push(cur.trim().replace(/^"|"$/g, '')); cur = ''; }
                 else cur += char;
             }
             res.push(cur.trim().replace(/^"|"$/g, ''));
             return res;
         };

         // 4. Map Columns (Dynamic but expects specific set)
         const headers = splitRow(headerLine);
         const getIdx = (key: string) => headers.findIndex(h => h.includes(key));
         
         const idxName = getIdx('회원');
         const idxLink = getIdx('프로필에');
         const idxTier = getIdx('현재 등급');
         const idxTierTime = getIdx('등급을 유지한');
         const idxTotalTime = getIdx('활동한 총 기간');
         const idxStatus = getIdx('최종 업데이트');     // Col 5
         const idxTimestamp = getIdx('타임스탬프');     // Col 6
         
         // Try to find a column for "Remaining Days" or "Next Billing"
         // The user sees "5일 남음" in the simplified view or CSV
         const idxRemaining = headers.findIndex(h => h.includes('남음') || h.includes('만료') || h.includes('종료') || h.includes('Remaining') || h.includes('Billing'));

         const memberDetails: any[] = [];
         const uniqueIds = new Set<string>();

         // 5. Parse Data Rows
         for (let i = headerIdx + 1; i < lines.length; i++) {
             const row = lines[i];
             if (!row.trim()) continue;

             const cols = splitRow(row);
             
             // Extract ID from Link (Col 1)
             // Link format: https://www.youtube.com/channel/UC...
             const link = cols[idxLink];
             if (!link) continue;

             const idMatch = link.match(/channel\/(UC[a-zA-Z0-9_-]{22})/);
             const id = idMatch ? idMatch[1] : null;

             if (id && !uniqueIds.has(id)) {
                 uniqueIds.add(id);
                 
                 // Extract Fields As-Is (No formatting)
                 memberDetails.push({
                     id,
                     name: cols[idxName] || '',
                     tier: cols[idxTier] || '',
                     tierDuration: cols[idxTierTime] || '',    // e.g. "7.09677"
                     totalDuration: cols[idxTotalTime] || '',  // e.g. "7.09677"
                     status: cols[idxStatus] || '',            // e.g. "재가입", "가입함"
                     lastUpdate: cols[idxTimestamp] || '',      // e.g. "2026-01-20T..."
                     remainingDays: idxRemaining !== -1 ? cols[idxRemaining] : '' // Capture remaining days if column exists
                 });
             }
         }

         if (memberDetails.length === 0) {
            alert('[오류] 회원 정보를 읽을 수 없습니다.');
            return;
         }

         // Immediate Update
         await updateWhitelistInDb(Array.from(uniqueIds), memberDetails);
      };
      reader.readAsArrayBuffer(file);
      e.target.value = '';
   };

   // Reusable function to save to DB (Reference Only)
   const updateWhitelistInDb = async (ids: string[], details: any[] = []) => {
      try {
         // Save ONLY to system_data whitelist (Reference Data)
         const docRef = doc(db, "system_data", "membership_whitelist");
         await setDoc(docRef, {
            validChannelIds: ids,
            memberDetails: details,
            updatedAt: new Date().toISOString(),
            count: ids.length,
            updatedBy: user?.email
         });

         await loadWhitelist();
         alert("✅ 멤버십 명단이 [참고용 데이터]로 저장되었습니다.\n(실제 유저 권한에는 영향을 주지 않습니다.)");
      } catch (e: any) {
         console.error("Save Error", e);
         alert("저장 실패: " + e.message);
      }
   };

   // Clear Whitelist Data
   const resetWhitelist = async () => {
      if (!window.confirm("정말 모든 멤버십 데이터를 초기화하시겠습니까?\n이 작업은 되돌릴 수 없습니다.")) return;
      
      try {
         const docRef = doc(db, "system_data", "membership_whitelist");
         await deleteDoc(docRef);
         setWhitelistData({ count: 0, updatedAt: '데이터 없음', ids: [], memberDetails: [] } as any);
         alert("✅ 멤버십 데이터가 초기화되었습니다.");
         await loadWhitelist();
      } catch(e: any) {
        console.error("Reset Error", e);
        alert("초기화 실패");
      }
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
        if (notifTargetInquiryId && user) {
           // Reply Logic
           await replyToInquiry(notifTargetInquiryId, notifTargetUser.uid, notifMessage);
           
           await logAdminMessage({
              recipientId: notifTargetUser.uid,
              recipientName: notifTargetUser.displayName,
              message: `[Inquiry Reply] ${notifMessage}`,
              adminId: user.uid,
              type: 'individual'
           });

           // Update local state
           setInquiries(prev => prev.map(inq => inq.id === notifTargetInquiryId ? {...inq, isAnswered: true, answer: notifMessage, answeredAt: Date.now()} : inq));
        } else {
           // Normal Notification Logic
           await sendNotification(notifTargetUser.uid, {
             userId: notifTargetUser.uid,
             title: '관리자 메시지',
             message: notifMessage,
             type: 'info'
           });

           if (user) {
              await logAdminMessage({
                recipientId: notifTargetUser.uid,
                recipientName: notifTargetUser.displayName,
                message: notifMessage,
                adminId: user.uid,
                type: 'individual'
              });
           }
        }
        alert("전송되었습니다.");
      }
      setNotifModalOpen(false);
    } catch (e) {
      console.error(e);
      alert("전송 실패");
    }
  };

  // --- Recommended Packages & Topics State ---
const [activeTab, setActiveTab] = useState<'users' | 'packages' | 'topics' | 'inquiries' | 'membership' | 'notices'>('users');
  const [packages, setPackages] = useState<RecommendedPackage[]>([]);
  const [topics, setTopics] = useState<RecommendedPackage[]>([]);
  const [inquiries, setInquiries] = useState<any[]>([]);
  const [inquiryFilter, setInquiryFilter] = useState<'all' | 'pending' | 'answered'>('pending');
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
  const [pkgScheduledAt, setPkgScheduledAt] = useState<Date | null>(null);
  const [isResolvingChannel, setIsResolvingChannel] = useState(false);
  
  // YouTube API Key for Admin
  // YouTube API Key for Admin (Auto-load from user settings)
  // YouTube API Key for Admin (Prioritize Props -> LocalStorage)
  const [adminYtKey, setAdminYtKey] = useState(apiKey || ''); 
  
  // Gemini API Key for AI Analysis
  const [adminGeminiKey, setAdminGeminiKey] = useState('');
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);

  useEffect(() => {
    // 1. Props로 받은 키가 있으면 최우선 사용
    if (apiKey) {
      setAdminYtKey(apiKey);
      // return; // Gemini Key도 로드해야 하므로 return 제거
    } else {
        // 2. 없으면 로컬 스토리지에서 로드
        const userKey = localStorage.getItem('yt_api_key');
        if (userKey) {
          setAdminYtKey(userKey);
        } else {
          // Fallback: check legacy custom key
          const legacy = localStorage.getItem('tube_radar_api_key');
          if (legacy) setAdminYtKey(legacy);
        }
    }
    
    // Load Gemini Key
    const geminiKey = localStorage.getItem('admin_gemini_key');
    if (geminiKey) setAdminGeminiKey(geminiKey);
  }, [apiKey]); 

  const fetchPackages = async () => {
    try {
      const data = await getPackagesFromDb();
      setPackages(data);
    } catch (e) {
      console.error("Error fetching packages", e);
    }
  };

  const fetchTopics = async () => {
    try {
      const data = await getTopicsFromDb();
      setTopics(data);
    } catch (e) {
      console.error("Error fetching topics", e);
    }
  };

  const [inquirySearch, setInquirySearch] = useState('');

  const fetchInquiriesData = async () => {
    try {
      const data = await getInquiries();
      // Initially sort by createdAt desc
      const sorted = data.sort((a: any, b: any) => b.createdAt - a.createdAt);
      setInquiries(sorted);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (activeTab === 'packages') {
      fetchPackages();
    } else if (activeTab === 'topics') {
      fetchTopics();
    } else if (activeTab === 'inquiries') {
      fetchInquiriesData();
    }
  }, [activeTab]);

  const handleAddChannelToPkg = async () => {
    if (!pkgChannelInput) return alert("채널 입력이 필요합니다.");
    if (!adminYtKey) return alert("YouTube API 키가 설정되지 않았습니다. 대시보드 메인 화면(좌측 하단)에서 API 키를 입력해주세요.");
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
            // [Admin UX] Preview videos if activeTab is 'topics'
            let videoTitles: string[] = [];
            if (activeTab === 'topics') {
               try {
                  const videos = await fetchChannelPopularVideos(adminYtKey, info.id);
                  if (videos.length > 0) {
                    info.topVideos = videos;
                    videoTitles = videos.map(v => v.title);
                  }
               } catch (err) {
                  console.error("Failed to fetch preview videos", err);
               }
            }
            
            // --- [AUTO FILL] 제목 & AI 추천 이유 자동 생성 ---
            
            // 1. 제목이 비어있으면 채널명으로 자동 설정
            if (!pkgTitle.trim()) {
                setPkgTitle(info.title);
            }

            // 2. 설명이 비어있고 Gemini 키가 있으면 AI 분석 시작
            if (!pkgDesc.trim() && adminGeminiKey) {
                setIsGeneratingAi(true);
                // 비동기로 실행하여 UI 블락 방지
                generateChannelRecommendation(adminGeminiKey, info.title, info.description || '', videoTitles)
                    .then(aiReason => {
                        setPkgDesc(prev => prev ? prev : aiReason); // 사용자가 그새 입력했으면 덮어쓰지 않음
                        setIsGeneratingAi(false);
                    })
                    .catch(err => {
                        console.error("AI Generation Failed", err);
                        setIsGeneratingAi(false);
                    });
            } else if (!adminGeminiKey) {
                console.log("Gemini Key missing, skipping AI analysis");
            }

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

  const handleSavePackage = async (approve: boolean = false) => {
    if (!pkgTitle) return alert("제목은 필수입니다.");

    // [Video Snapshot Logic]
    // Only fetch videos if saving a TOPIC. Packages do not need video lists.
    let updatedChannels = [...pkgChannels];
    
    if (activeTab === 'topics' && adminYtKey) {
        setIsResolvingChannel(true);
        try {
          updatedChannels = await Promise.all(pkgChannels.map(async (ch) => {
             if (!ch.topVideos || ch.topVideos.length === 0) {
               try {
                  const videos = await fetchChannelPopularVideos(adminYtKey, ch.id);
                  if (videos.length > 0) {
                    return { ...ch, topVideos: videos };
                  }
               } catch (err) {
                 console.error(`Failed to snapshot videos for ${ch.title}`, err);
               }
             }
             return ch;
          }));
        } catch (e) {
          console.error("Snapshot process failed", e);
        } finally {
          setIsResolvingChannel(false);
        }
    }

    
    const newPkg: RecommendedPackage = {
      id: editingPackage ? editingPackage.id : Date.now().toString(),
      title: pkgTitle,
      description: pkgDesc,
      category: activeTab === 'topics' ? 'Topic' : (pkgTargetGroup.trim() || 'General'),
      createdAt: editingPackage ? editingPackage.createdAt : Date.now(),
      channels: updatedChannels,
      channelCount: updatedChannels.length,
      ...(pkgTargetGroup.trim() ? { targetGroupName: pkgTargetGroup.trim() } : {}),
      ...(pkgScheduledAt ? { scheduledAt: pkgScheduledAt.toISOString() } : {}),
      // Preserve Creator Info
      ...(editingPackage?.creatorId ? { creatorId: editingPackage.creatorId } : {}),
      ...(editingPackage?.creatorName ? { creatorName: editingPackage.creatorName } : {}),
      status: approve 
        ? 'approved' 
        : (editingPackage 
             ? (editingPackage.status || 'approved') 
             : 'pending') // Admin created items are pending approval now
    };

    try {
      console.log("Saving item:", newPkg);
      if (activeTab === 'topics') {
        await saveTopicToDb(newPkg);
        await fetchTopics();
      } else {
        await savePackageToDb(newPkg);
        await fetchPackages();
      }

      // Handle Reward Flow if approved
      if (approve) {
        await processRewardFlow(newPkg);
      }

      setIsPackageModalOpen(false);
      resetPkgForm();
    } catch (e: any) {
      console.error("Save failed:", e);
      alert(`저장 실패: ${e.message || "알 수 없는 오류가 발생했습니다."}`);
    }
  };

  const handleDeletePackage = async (id: string) => {
    if (!window.confirm("삭제하시겠습니까? (복구 불가)")) return;
    try {
      if (activeTab === 'topics') {
        await deleteTopicFromDb(id);
        fetchTopics();
      } else {
        await deletePackageFromDb(id);
        fetchPackages();
      }
    } catch (e) {
      alert("삭제 실패");
    }
  };

  // Helper: Process Reward Flow
  const processRewardFlow = async (pkg: RecommendedPackage) => {
    if (!pkg.creatorId) return;

    // Show custom dialog for point selection
    const pointOptions = ['500', '1000', '2000', '3000', '직접 입력', '보상 없음'];
    const optionText = pointOptions.map((opt, idx) => `${idx + 1}. ${opt}`).join('\n');
    const selection = window.prompt(
      `사용자에게 포인트 보상을 지급하시겠습니까?\n\n${optionText}\n\n번호를 입력하거나 직접 포인트를 입력하세요:`,
      '2'
    );
    
    if (!selection) return; // Cancelled

    let rewardPoints = 0;
    const selectionNum = parseInt(selection);
    
    // Check if it's a menu selection (1-6)
    if (selectionNum >= 1 && selectionNum <= pointOptions.length) {
      if (selectionNum === 5) {
        // 직접 입력
        const customInput = window.prompt('지급할 포인트를 입력하세요:', '1000');
        if (customInput && !isNaN(parseInt(customInput))) {
          rewardPoints = parseInt(customInput);
        }
      } else if (selectionNum === 6) {
        // 보상 없음
        rewardPoints = 0;
      } else {
        // Preset values (500, 1000, 2000, 3000)
        rewardPoints = parseInt(pointOptions[selectionNum - 1]);
      }
    } else if (!isNaN(selectionNum)) {
      // Direct number input
      rewardPoints = selectionNum;
    }

    let rewardMessage = "";
    
    if (rewardPoints > 0) {
       // Grant Bonus Points
       try {
         const { grantBonusPoints } = await import('../../services/dbService');
         await grantBonusPoints(
           pkg.creatorId, 
           rewardPoints, 
           `'${pkg.title}' ${activeTab === 'topics' ? '소재' : '패키지'} 승인 보상`
         );
         rewardMessage = `\n🎁 보상으로 ${rewardPoints.toLocaleString()} 포인트가 지급되었습니다!`;
       } catch (err) {
          console.error("Failed to grant bonus points", err);
          alert("포인트 지급 중 오류가 발생했습니다 (승인은 완료됨).");
       }
    }

    await sendNotification(pkg.creatorId, {
       userId: pkg.creatorId,
       title: activeTab === 'topics' ? '🎉 추천 소재 승인 완료' : '🎉 추천 패키지 승인 완료',
       message: `'${pkg.title}' ${activeTab === 'topics' ? '소재' : '패키지'}가 승인되어 공개되었습니다.${rewardMessage}`,
       type: 'success'
    });
    
    if (rewardPoints > 0) alert(`승인 및 ${rewardPoints.toLocaleString()} 포인트 보상 지급 완료`);
  };

  const handleApprovePackage = async (pkg: RecommendedPackage) => {
    // 1. Confirm Approval
    if (!window.confirm(`'${pkg.title}' ${activeTab === 'topics' ? '소재' : '패키지'}를 승인하여 공개하시겠습니까?`)) return;

    try {
      const updatedPkg: RecommendedPackage = { ...pkg, status: 'approved' };
      
      // 2. Save "Approved" status
      if (activeTab === 'topics') {
        await saveTopicToDb(updatedPkg);
        await fetchTopics();
      } else {
        await savePackageToDb(updatedPkg);
        await fetchPackages();
      }
      
      // 3. Handle User Reward
      await processRewardFlow(updatedPkg);

    } catch (e) {
      alert("승인 처리 실패");
    }
  };

  const filteredItems = useMemo(() => {
    const targetList = activeTab === 'topics' ? topics : packages;
    return targetList.filter(p => {
       if (packageFilter === 'all') return true;
       // If status is undefined, treat as approved (legacy)
       const status = p.status || 'approved'; 
       return status === packageFilter;
    });
  }, [packages, topics, packageFilter, activeTab]);

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
    setPkgScheduledAt(null);
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
      // Sort: Admin first, then by createdAt desc
      userList.sort((a, b) => {
        if (a.role === 'admin' && b.role !== 'admin') return -1;
        if (a.role !== 'admin' && b.role === 'admin') return 1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
      setUsers(userList);
      
      // Fetch Notice
      try {
        const noticeDoc = await getDoc(doc(db, 'system', 'notice'));
        if (noticeDoc.exists()) {
           const data = noticeDoc.data() as Notice;
           setNotice(data.content);
           setIsNoticeActive(data.isActive);
           setNoticeImageUrl(data.imageUrl || '');
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

  // Fetch point data for all users
  useEffect(() => {
    if (users.length === 0) return;
    const fetchAllPointData = async () => {
      setPointDataLoading(true);
      try {
        const pointMap: Record<string, ApiUsage> = {};
        const chunkSize = 10;
        for (let i = 0; i < users.length; i += chunkSize) {
          const chunk = users.slice(i, i + chunkSize);
          const results = await Promise.all(
            chunk.map(async (u) => {
              try {
                const p = u.role === 'admin' ? 'admin'
                  : (u.plan === 'gold' || u.role === 'pro') ? 'gold'
                  : (u.plan === 'silver') ? 'silver' : 'general';
                const usage = await getUsageFromDb(u.uid, p);
                return { uid: u.uid, usage };
              } catch { return { uid: u.uid, usage: null }; }
            })
          );
          results.forEach(r => { if (r.usage) pointMap[r.uid] = r.usage; });
        }
        setUserPointData(pointMap);
      } catch (e) { console.error("Error fetching point data:", e); }
      finally { setPointDataLoading(false); }
    };
    fetchAllPointData();
  }, [users]);

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
  // Notice Board Actions
  const fetchNotices = async () => {
    try {
      const q = query(collection(db, 'notices'), orderBy('createdAt', 'desc'));
      const snap = await getDocs(q);
      setNoticeList(snap.docs.map(d => ({ id: d.id, ...d.data() } as Notice)));
    } catch(e) { console.error("Notice fetch failed", e); }
  };

  const handleCreateNotice = () => {
     setEditId(null);
     setEditTitle('');
     setNotice('');
     setIsNoticeActive(true);
     setNoticeImageUrl('');
     setNoticeViewMode('form');
  };

  const handleEditNotice = (n: Notice) => {
     setEditId(n.id || null);
     setEditTitle(n.title || '');
     setNotice(n.content || '');
     setIsNoticeActive(n.isActive);
     setNoticeImageUrl(n.imageUrl || '');
     setNoticeViewMode('form');
  };

  const handleDeleteNotice = async (id: string) => {
      if(!window.confirm('삭제하시겠습니까?')) return;
      await deleteDoc(doc(db, 'notices', id));
      fetchNotices();
  };

  const saveNotice = async () => {
    if (!editTitle) return alert('제목을 입력해주세요.');

    const data = {
      title: editTitle,
      content: notice,
      isActive: isNoticeActive,
      imageUrl: noticeImageUrl,
      updatedAt: new Date().toISOString()
    };

    try {
      if (editId) {
        await updateDoc(doc(db, 'notices', editId), data);
      } else {
        await addDoc(collection(db, 'notices'), {
          ...data,
          createdAt: new Date().toISOString()
        });
      }
      fetchNotices();
      setNoticeViewMode('list');
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

  const handleResetUser = async (uid: string) => {
    if (!window.confirm("이 사용자의 모든 활동 데이터(문의, 저장 채널, 그룹, 알림, 기록)를 초기화하시겠습니까?\n(계정과 멤버십은 유지됩니다. 이 작업은 되돌릴 수 없습니다.)")) return;

    try {
      // Helper to clear subcollection
      const clearSubcollection = async (subName: string) => {
         const q = query(collection(db, 'users', uid, subName));
         const snap = await getDocs(q);
         snap.forEach(d => {
            deleteDoc(d.ref); // Async delete immediately for simplicity
         });
      };

      // 1. Clear Subcollections
      await clearSubcollection('channels');
      await clearSubcollection('groups');
      await clearSubcollection('notifications');
      await clearSubcollection('history'); // Clear old history

      // 2. Clear Inquiries
      const qInq = query(collection(db, 'inquiries'), where('userId', '==', uid));
      const snapInq = await getDocs(qInq);
      snapInq.forEach(d => {
         deleteDoc(d.ref);
      });

      // 3. Add Log (New History)
      await addDoc(collection(db, 'users', uid, 'history'), {
         action: 'admin_reset',
         details: '관리자에 의한 활동 데이터 초기화',
         date: new Date().toISOString(),
         adminId: user?.uid
      });

      alert("✅ 사용자의 모든 활동 데이터가 초기화되었습니다.");
      fetchUsers();
    } catch (e) {
      console.error("Reset failed", e);
      alert("초기화 중 오류가 발생했습니다.");
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
  const [editRole, setEditRole] = useState<'admin' | 'approved' | 'pending' | 'regular' | 'pro' | 'guest'>('pending');
  const [editPlan, setEditPlan] = useState<string>('free'); // New Plan State
  const [expiryDays, setExpiryDays] = useState<string>(''); // '' means no change or custom
  const [customExpiry, setCustomExpiry] = useState('');

  // --- Add Member Modal State ---
  const [isAddMemberModalOpen, setIsAddMemberModalOpen] = useState(false);
  const [newMemberData, setNewMemberData] = useState({
     name: '',
     id: '',
     tier: '실버 버튼',
     remainingDays: '30'
  });

  const handleAddMember = async () => {
      if(!newMemberData.name || !newMemberData.id) return alert("이름과 ID를 입력해주세요.");
      
      const newEntry = {
          name: newMemberData.name,
          id: newMemberData.id.trim(),
          tier: newMemberData.tier,
          tierDuration: '',
          totalDuration: '',
          status: '수동 추가',
          lastUpdate: new Date().toISOString(),
          remainingDays: newMemberData.remainingDays
      };

      const newList = [...(whitelistData.memberDetails || []), newEntry];
      const newIds = [...(whitelistData.ids || []), newEntry.id];
      
      try {
          await updateWhitelistInDb(newIds, newList);
          
          // --- [NEW] Start: Update Actual User Permissions Immediately ---
          const targetId = newMemberData.id.trim();
          const targetTier = newMemberData.tier; // '실버 버튼' or '골드 버튼'
          const safeTarget = targetId.toLowerCase();

          // Find User (Robust Fuzzy Matching)
          const foundUser = users.find(u => {
                const uChannelId = (u as any).channelId || '';
                const uEmail = (u.email || '').toLowerCase().trim();
                
                // Exact Channel ID match
                if (uChannelId && uChannelId === targetId) return true;

                // Email match
                if (uEmail === safeTarget) return true;
                if (uEmail.split('@')[0] === safeTarget) return true;
                
                return false;
          });

          if (foundUser) {
              const days = parseInt(newMemberData.remainingDays || '30');
              const newExpiryDate = new Date();
              newExpiryDate.setDate(newExpiryDate.getDate() + days);

              let newRole: 'regular' | 'pro' = 'regular';
              let newPlan: 'silver' | 'gold' = 'silver';

              if (targetTier.includes('골드') || targetTier.includes('Gold') || targetTier.includes('pro')) {
                  newRole = 'pro';
                  newPlan = 'gold';
              }

              // Update User Doc
              await updateDoc(doc(db, 'users', foundUser.uid), {
                  role: newRole,
                  plan: newPlan,
                  membershipTier: targetTier, // Store original display string
                  expiresAt: newExpiryDate.toISOString()
              });

              // Add History Log
              try {
                  await addDoc(collection(db, 'users', foundUser.uid, 'history'), {
                      action: 'admin_manual_add',
                      details: `관리자에 의한 멤버십 수동 등록 (${targetTier}, ${days}일)`,
                      date: new Date().toISOString()
                  });
              } catch(e) {/* ignore log error */}

              alert(`✅ 명단 추가 및 사용자 권한 업데이트 완료!\n\n사용자: ${foundUser.displayName}\n등급: ${targetTier}\n만료일: ${newExpiryDate.toLocaleDateString()}`);
              fetchUsers(); // Refresh UI
          } else {
              alert(`✅ 명단에 추가되었습니다.\n(단, 일치하는 가입자를 찾지 못해 권한은 자동 부여되지 않았습니다. 해당 ID로 가입 시 자동 적용됩니다.)`);
          }
          // --- [NEW] End ---

          setIsAddMemberModalOpen(false);
          setNewMemberData({ name: '', id: '', tier: '실버 버튼', remainingDays: '30' });
      } catch (e) {
          console.error(e);
          alert("추가 중 오류가 발생했습니다.");
      }
  };

  const handleDeleteMember = async (targetId: string, targetName: string) => {
    if (!window.confirm(`'${targetName}' (${targetId}) 님을 명단에서 삭제하시겠습니까?\n\n삭제 시 해당 사용자의 멤버십 등급이 즉시 해제됩니다.`)) return;

    // 1. Update Whitelist (Remove from list)
    const newList = whitelistData.memberDetails.filter((x: any) => x.id !== targetId);
    const newIds = whitelistData.ids.filter((id: any) => id !== targetId);
    
    try {
        await updateWhitelistInDb(newIds, newList); // This updates system_data/membership_whitelist

        // 2. Find and Downgrade the Actual User (Robust Matching)
        // Instead of strict Firestore query, use the loaded 'users' array which allows us to use multiple matching strategies
        // Strategy similar to table rendering logic: Match ChannelID OR Email (fuzzy)
        
        const safeTarget = targetId.trim().toLowerCase();
        const foundUser = users.find(u => {
             const uChannelId = (u as any).channelId || '';
             const uEmail = (u.email || '').toLowerCase().trim();
             
             // Exact Channel ID match (most reliable)
             if (uChannelId && uChannelId === targetId.trim()) return true;

             // Email match (exact or prefix)
             if (uEmail === safeTarget) return true;
             if (uEmail.split('@')[0] === safeTarget) return true;
             
             return false;
        });

        if (foundUser) {
            await updateDoc(doc(db, 'users', foundUser.uid), {
                role: 'approved', // Downgrade to basic approved user
                plan: 'free',
                membershipTier: null,
                expiresAt: null
            });

            // Add History Log
            try {
               await addDoc(collection(db, 'users', foundUser.uid, 'history'), {
                  action: 'membership_revoked',
                  details: `관리자에 의한 멤버십 명단 삭제 및 등급 해제 (${targetId})`,
                  date: new Date().toISOString()
               });
            } catch(e) {/* ignore log error */}

            alert(`명단 삭제 완료.\n사용자(${foundUser.displayName})의 등급도 '승인됨(Free)'으로 변경되었습니다.`);
            
            // Refresh to show updated status
            fetchUsers(); 
        } else {
            alert("명단에서 삭제되었습니다.\n(일치하는 가입자를 찾을 수 없어 등급 변경은 수행되지 않았습니다. 사용자가 아직 가입하지 않았거나 ID가 다를 수 있습니다.)");
        }
    } catch (e) {
        console.error(e);
        alert("삭제 중 오류가 발생했습니다.");
    }
  };
  const [userHistory, setUserHistory] = useState<any[]>([]);
  useEffect(() => {
     if (selectedUser) {
        const fetchHistory = async () => {
           try {
             // Query 'history' subcollection, sort by date desc
             const q = query(
                collection(db, 'users', selectedUser.uid, 'history'), 
                orderBy('date', 'desc'),
                limit(20)
             );
             const snap = await getDocs(q);
             setUserHistory(snap.docs.map(d => ({id: d.id, ...d.data()})));
           } catch (e) {
             console.log("No history or failed to fetch", e);
             setUserHistory([]);
           }
        };
        fetchHistory();
     } else {
        setUserHistory([]);
     }
  }, [selectedUser]);

  const handleEditClick = (u: UserData) => {
    setSelectedUser(u);
    setEditRole(u.role);
    setEditPlan(u.plan === 'free' ? 'general' : u.plan || 'general'); // Init plan (free -> general)
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
      const updates: any = { 
        role: editRole,
        plan: editPlan,
        expiresAt: newExpiresAt || null
      };
      await updateDoc(doc(db, 'users', selectedUser.uid), updates);
      
      // Log History
      try {
         const historyRef = collection(db, 'users', selectedUser.uid, 'history');
         let actionDetails = [];
         if (selectedUser.role !== editRole) actionDetails.push(`등급변경: ${selectedUser.role} -> ${editRole}`);
         if ((selectedUser.plan || 'free') !== editPlan) actionDetails.push(`플랜변경: ${selectedUser.plan || 'free'} -> ${editPlan}`);
         if (selectedUser.expiresAt !== newExpiresAt) actionDetails.push(`만료일변경: ${selectedUser.expiresAt ? new Date(selectedUser.expiresAt).toLocaleDateString() : '없음'} -> ${newExpiresAt ? new Date(newExpiresAt).toLocaleDateString() : '없음'}`);
         
         if (actionDetails.length > 0) {
            await addDoc(historyRef, {
               action: 'admin_update',
               details: `관리자 수정: ${actionDetails.join(', ')}`,
               date: new Date().toISOString()
            });
         }
      } catch (e) {
         console.error("Failed to log history", e);
      }

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
          {/* Top Row: Title & Close */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg md:text-2xl font-black italic tracking-tighter text-slate-900 dark:text-white uppercase flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-xl md:text-2xl">admin_panel_settings</span>
              Admin Dashboard
            </h2>
            
            <button onClick={onClose} className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors flex items-center gap-2 text-slate-500">
               <span className="text-sm font-bold uppercase hidden md:inline">Close</span>
               <span className="material-symbols-outlined text-xl">close</span>
            </button>
          </div>

          
          {/* --- [NEW] API Settings Section --- */}
          <div className="mb-4 -mt-2 p-3 bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-slate-800 dark:to-slate-800/50 rounded-xl border border-indigo-100 dark:border-slate-700 flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="flex items-center gap-3 w-full md:w-auto">
               <div className="w-8 h-8 rounded-full bg-white dark:bg-slate-700 flex items-center justify-center text-indigo-500 shadow-sm shrink-0">
                  <span className="material-symbols-outlined text-lg">auto_awesome</span>
               </div>
               <div>
                 <h3 className="font-bold text-xs text-slate-800 dark:text-slate-100 flex items-center gap-2">Gemini AI <span className="text-[10px] bg-indigo-100 text-indigo-600 px-1.5 py-0.5 rounded">Pro</span></h3>
                 <p className="text-[10px] text-slate-500 dark:text-slate-400">자동 추천 글 작성 및 비디오 분석</p>
               </div>
            </div>
            <div className="flex-1 max-w-sm w-full relative">
               <input 
                 type="password"
                 value={adminGeminiKey}
                 onChange={(e) => {
                   const val = e.target.value;
                   setAdminGeminiKey(val);
                   if(val) localStorage.setItem('admin_gemini_key', val);
                 }}
                 placeholder="Google Gemini API Key 입력..."
                 className="w-full pl-3 pr-8 py-2 rounded-lg border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all"
               />
               <div className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400">
                 {adminGeminiKey ? <span className="material-symbols-outlined text-green-500 text-sm">check_circle</span> : <span className="material-symbols-outlined text-sm">vpn_key</span>}
               </div>
            </div>
          </div>

            {/* New Row: Tabs */}
          <div className="w-full overflow-x-auto no-scrollbar pb-2">
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-max">
                 <button 
                   onClick={() => setActiveTab('users')}
                   className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap relative ${activeTab === 'users' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'}`}
                 >
                   사용자 관리
                   {counts.pendingUsers > 0 && (
                     <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-rose-500 text-[9px] text-white ring-2 ring-white dark:ring-slate-900 animate-pulse">
                        {counts.pendingUsers > 9 ? '9+' : counts.pendingUsers}
                     </span>
                   )}
                 </button>
                 <button 
                   onClick={() => setActiveTab('packages')}
                   className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap relative ${activeTab === 'packages' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'}`}
                 >
                   <div className="flex items-center gap-1">
                      <span>추천 팩 관리</span>
                      {activeTab !== 'packages' && <span className="bg-accent-hot size-2 rounded-full"></span>}
                   </div>
                   {counts.pendingPackages > 0 && (
                     <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-rose-500 text-[9px] text-white ring-2 ring-white dark:ring-slate-900">
                        {counts.pendingPackages}
                     </span>
                   )}
                 </button>
                 <button 
                   onClick={() => setActiveTab('topics')}
                   className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap relative ${activeTab === 'topics' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'}`}
                 >
                   <div className="flex items-center gap-1">
                      <span>추천 소재 관리</span>
                      {activeTab !== 'topics' && <span className="bg-amber-500 size-2 rounded-full"></span>}
                   </div>
                   {counts.pendingTopics > 0 && (
                     <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-rose-500 text-[9px] text-white ring-2 ring-white dark:ring-slate-900">
                        {counts.pendingTopics}
                     </span>
                   )}
                 </button>

                 <button 
                   onClick={() => setActiveTab('inquiries')}
                   className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap relative ${activeTab === 'inquiries' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'}`}
                 >
                   <div className="flex items-center gap-1">
                      <span>문의 수신함</span>
                      {activeTab !== 'inquiries' && <span className="bg-indigo-500 size-2 rounded-full"></span>}
                   </div>
                   {counts.unrepliedInquiries > 0 && (
                     <span className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-rose-500 text-[9px] text-white ring-2 ring-white dark:ring-slate-900 animate-pulse">
                        {counts.unrepliedInquiries}
                     </span>
                   )}
                 </button>
                 
                 <button 
                   onClick={() => setActiveTab('membership')}
                   className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'membership' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'}`}
                 >
                   <div className="flex items-center gap-1">
                      <span>멤버십 관리</span>
                      {activeTab !== 'membership' && <span className="bg-rose-500 size-2 rounded-full"></span>}
                   </div>
                 </button>
                 <button 
                   onClick={() => { setActiveTab('notices'); fetchNotices(); setNoticeViewMode('list'); }}
                   className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${activeTab === 'notices' ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-white' : 'text-slate-500 hover:text-slate-900 dark:hover:text-slate-300'}`}
                 >
                   <div className="flex items-center gap-1">
                      <span>공지사항 게시판</span>
                      {activeTab !== 'notices' && <span className="bg-green-500 size-2 rounded-full"></span>}
                   </div>
                 </button>
              </div>
          </div>

          <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            {activeTab === 'users' && (
              <>
                <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
                  {['all', 'approved', 'pending'].map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f as any)}
                      className={`px-4 py-1.5 rounded-md text-sm font-bold transition-all whitespace-nowrap ${
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
                     className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ml-2 bg-indigo-500 text-white hover:bg-indigo-600 shadow-md shadow-indigo-500/20 whitespace-nowrap shrink-0"
                   >
                     <span className="material-symbols-outlined text-sm">mail</span>
                     전체 쪽지
                   </button>
                </div>
              </>
            )}
           </div>
        </div>
        


        {/* Content */}
        <div className="flex-1 overflow-auto p-4 md:p-8 max-w-full mx-auto w-full">
          {loading ? (
            <div className="flex justify-center py-40">
              <div className="size-10 border-4 border-primary/20 border-t-primary rounded-full animate-spin"></div>
            </div>
          ) : activeTab === 'users' ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="text-xs font-bold text-slate-500 uppercase border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                    <th className="px-2 py-3 w-10">
                      <input type="checkbox" checked={selectedIds.size === filteredUsers.length && filteredUsers.length > 0} onChange={toggleSelectAll} className="rounded text-primary focus:ring-primary" />
                    </th>
                    <th className="px-2 py-3">사용자</th>
                    <th className="px-2 py-3 hidden md:table-cell">관리자 메모</th>
                    <th className="px-2 py-3 hidden md:table-cell">이메일</th>
                    <th className="px-2 py-3 hidden md:table-cell">등급</th>
                    <th className="px-2 py-3 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300 transition-colors hidden md:table-cell" onClick={() => handleSort('lastLoginAt')}>
                      <div className="flex items-center gap-1">
                        최근 접속
                        <span className="material-symbols-outlined text-[14px]">
                          {sortConfig.key === 'lastLoginAt' ? (sortConfig.direction === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
                        </span>
                      </div>
                    </th>
                    <th className="px-2 py-3 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300 transition-colors hidden md:table-cell" onClick={() => handleSort('expiresAt')}>
                      <div className="flex items-center gap-1">
                        만료일
                        <span className="material-symbols-outlined text-[14px]">
                          {sortConfig.key === 'expiresAt' ? (sortConfig.direction === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
                        </span>
                      </div>
                    </th>
                    <th className="px-2 py-3 hidden md:table-cell">
                      <div className="flex items-center gap-1">
                        포인트
                        {pointDataLoading && <span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>}
                      </div>
                    </th>
                    <th className="px-2 py-3 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300 transition-colors" onClick={() => handleSort('role')}>
                      <div className="flex items-center gap-1">
                        상태
                        <span className="material-symbols-outlined text-[14px]">
                          {sortConfig.key === 'role' ? (sortConfig.direction === 'asc' ? 'arrow_upward' : 'arrow_downward') : 'unfold_more'}
                        </span>
                      </div>
                    </th>
                    <th className="px-2 py-3">기록</th>
                    <th className="px-2 py-3 text-right">관리</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/50">
                  {filteredUsers.length === 0 ? (
                    <tr>
                      <td colSpan={12} className="px-6 py-20 text-center text-slate-400 font-bold">
                        해당하는 사용자가 없습니다.
                      </td>
                    </tr>
                  ) : filteredUsers.map((u) => (
                  <tr key={u.uid} className={`hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors ${selectedIds.has(u.uid) ? 'bg-slate-50 dark:bg-slate-800/50' : ''}`}>
                    <td className="px-2 py-3 pl-2">
                      <input type="checkbox" checked={selectedIds.has(u.uid)} onChange={() => toggleSelectUser(u.uid)} className="rounded text-primary focus:ring-primary" />
                    </td>
                    <td className="px-2 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                         <img src={u.photoURL || `https://ui-avatars.com/api/?name=${u.displayName}`} className="size-7 rounded-full bg-slate-200 ring-2 ring-white dark:ring-slate-800" alt="" />
                         <span className="font-bold text-xs dark:text-slate-200 whitespace-nowrap" title={u.displayName}>{u.displayName?.length > 15 ? u.displayName.slice(0, 15) + '...' : u.displayName}</span>
                      </div>
                    </td>
                    <td className="px-2 py-3 hidden md:table-cell">
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
                    <td className="px-2 py-3 text-xs text-slate-600 dark:text-slate-400 hidden md:table-cell">{u.email}</td>

                    <td className="px-2 py-3 hidden md:table-cell">
                      {(() => {
                         let tier = '';
                         // 1. Check Whitelist (Robust Matching: ID first, then Email)
                         if (whitelistData?.memberDetails) {
                            const safeEmail = (u.email || '').toLowerCase().trim();
                            // Access channelId from 'u' as any to bypass TS error temporarily if interface not updated yet
                            const safeChannelId = (u as any).channelId || '';

                            const match = whitelistData.memberDetails.find((m: any) => {
                               const mId = String(m.id || '').trim();
                               if (!mId) return false;
                               // Match by Channel ID (Exact)
                               if (safeChannelId && mId === safeChannelId) return true;
                               // Match by Email (Case-insensitive)
                               const mIdLower = mId.toLowerCase();
                               return safeEmail === mIdLower || safeEmail.split('@')[0] === mIdLower;
                            });
                            if (match && match.tier) tier = match.tier.trim(); // Keep original case for Korean
                         }
                         
                         // 2. Check Role/Plan (Fallback)
                         if (!tier || tier === '-') {
                            if (u.role === 'admin') tier = 'admin';
                            else if (u.role === 'pro' || u.plan === 'gold') tier = 'gold';
                            else if (u.role === 'regular' || u.plan === 'silver') tier = 'silver';
                         }
                         
                         // 3. Render
                         let label = '일반';
                         let style = 'bg-slate-100 text-slate-500 border-slate-200';

                         if (tier === 'admin') { label = 'ADMIN'; style = 'bg-purple-100 text-purple-600 border-purple-200'; }
                         else if (tier.includes('gold') || tier.includes('골드')) { label = '골드 버튼'; style = 'bg-amber-100 text-amber-600 border-amber-200'; }
                         else if (tier.includes('silver') || tier.includes('실버')) { label = '실버 버튼'; style = 'bg-indigo-50 text-indigo-600 border-indigo-100'; }
                         else if (u.role === 'approved' || u.role === 'regular' || u.role === 'pro') { label = '승인됨'; style = 'bg-emerald-100 text-emerald-600 border-emerald-200'; }

                         return (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold border uppercase ${style}`}>
                            {label}
                          </span>
                         );
                      })()}
                    </td>
                    <td className="px-2 py-3 text-xs font-mono text-slate-500 whitespace-nowrap hidden md:table-cell">
                      {u.lastLoginAt ? (
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-700 dark:text-slate-300">
                             {(() => {
                                const d = new Date(u.lastLoginAt);
                                return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
                             })()}
                          </span>
                          <span className="text-[10px] text-slate-400">{new Date(u.lastLoginAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                        </div>
                      ) : '-'}
                    </td>
                    <td className="px-2 py-3 text-xs font-mono whitespace-nowrap hidden md:table-cell">
                      {u.expiresAt ? (
                        <div className="flex flex-col">
                          <span className="text-slate-600 dark:text-slate-400 font-bold">
                             {(() => {
                                const d = new Date(u.expiresAt);
                                return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
                             })()}
                          </span>
                          <span className={`text-[10px] font-bold mt-0.5 ${
                            calculateDDay(u.expiresAt) === '만료됨' ? 'text-rose-500' :
                            calculateDDay(u.expiresAt)?.startsWith('D-') ? 'text-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 px-1.5 py-0.5 rounded w-fit' : 'text-slate-400'
                          }`}>
                            {calculateDDay(u.expiresAt)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400">무제한</span>
                      )}
                    </td>
                    <td className="px-2 py-3 hidden md:table-cell">
                      {(() => {
                        const pt = userPointData[u.uid];
                        if (!pt) return <span className="text-slate-300 text-xs">-</span>;
                        const remaining = pt.total - pt.used + (pt.bonusPoints || 0);
                        const totalPool = pt.total + (pt.bonusPoints || 0);
                        const pct = totalPool > 0 ? (remaining / totalPool) * 100 : 0;
                        const color = pct <= 10 ? 'text-rose-500' : pct <= 30 ? 'text-amber-500' : 'text-emerald-600 dark:text-emerald-400';
                        return (
                          <div className="flex flex-col">
                            <span className={`text-xs font-bold ${color}`}>
                              {remaining.toLocaleString()} / {pt.total.toLocaleString()}
                            </span>
                            {(pt.bonusPoints || 0) > 0 && (
                              <span className="text-[10px] text-indigo-500 font-bold">
                                +{pt.bonusPoints!.toLocaleString()} 보너스
                              </span>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-2 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wide border ${
                        u.role === 'admin' ? 'bg-purple-100 text-purple-600 border-purple-200' :
                        (u.role === 'approved' || u.role === 'regular' || u.role === 'pro') ? 'bg-emerald-100 text-emerald-600 border-emerald-200' :
                        'bg-yellow-100 text-yellow-600 border-yellow-200'
                      }`}>
                        {u.role === 'admin' ? '관리자' : (u.role === 'approved' || u.role === 'regular' || u.role === 'pro') ? '승인됨' : '대기중'}
                      </span>

                    </td>
                    <td className="px-2 py-3">
                       <div className="flex gap-2">
                         <button onClick={() => setViewingHistoryUser(u)} className="flex items-center gap-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 font-bold px-2 py-1 rounded text-[10px] transition-colors">
                            <span className="material-symbols-outlined text-[14px]">history</span>
                            기록
                         </button>
                         <button 
                           onClick={() => openNotifModal(u, 'individual')}
                           className="flex items-center gap-1 bg-slate-100 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-indigo-900/30 text-slate-500 hover:text-indigo-500 font-bold px-2 py-1 rounded text-[10px] transition-colors"
                           title="메시지 보내기"
                         >
                            <span className="material-symbols-outlined text-[14px]">mail</span>
                            메세지
                         </button>
                       </div>
                    </td>
                    <td className="px-2 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button 
                          onClick={() => handleResetUser(u.uid)}
                          className="text-xs font-bold text-amber-500 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 dark:bg-amber-900/10 dark:hover:bg-amber-900/30 px-3 py-1.5 rounded-lg transition-colors border border-amber-200 dark:border-amber-800"
                          title="활동 내역 초기화 (계정 유지)"
                        >
                          초기화
                        </button>
                        <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1"></div>
                        <button 
                          onClick={() => handleEditClick(u)}
                          className="text-xs font-bold text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:text-white px-3 py-1.5 rounded-lg transition-colors"
                        >
                          수정
                        </button>
                        
                        {u.uid !== user?.uid ? (
                          <button 
                               onClick={() => handleDelete(u.uid)}
                               className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                               title="계정 삭제"
                          >
                               <span className="material-symbols-outlined text-lg">delete</span>
                          </button>
                        ) : (
                          <div className="p-1.5 w-[28px]"></div> // Placeholder
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>

          ) : activeTab === 'inquiries' ? (
             <div className="space-y-4">
                <div className="flex flex-col md:flex-row items-center justify-between mb-4 gap-4">
                    <h3 className="text-xl font-bold">1:1 문의 내역</h3>
                    <div className="flex flex-col sm:flex-row items-center gap-2 w-full md:w-auto">
                       {/* Search Input */}
                       <div className="relative w-full sm:w-64">
                          <input 
                            value={inquirySearch}
                            onChange={(e) => setInquirySearch(e.target.value)}
                            placeholder="이름 또는 내용 검색..."
                            className="w-full pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                          />
                          <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
                       </div>

                       <div className="flex items-center gap-2 w-full sm:w-auto overflow-x-auto no-scrollbar">
                         {['all', 'pending', 'answered'].map(f => (
                           <button 
                             key={f}
                             onClick={() => setInquiryFilter(f as any)}
                             className={`px-4 py-2 rounded-lg text-xs font-bold transition-all whitespace-nowrap ${
                               inquiryFilter === f 
                               ? 'bg-indigo-500 text-white shadow-lg shadow-indigo-500/30' 
                               : 'bg-white dark:bg-slate-800 text-slate-500 hover:text-indigo-500 border border-slate-200 dark:border-slate-700'
                             }`}
                           >
                             {f === 'all' ? '전체' : f === 'pending' ? '대기중' : '답변완료'}
                             <span className="ml-2 opacity-60 bg-black/10 px-1.5 py-0.5 rounded-full text-[10px]">
                               {f === 'all' 
                                 ? inquiries.length 
                                 : inquiries.filter((i: any) => f === 'pending' ? !i.isAnswered : i.isAnswered).length}
                             </span>
                           </button>
                         ))}
                       </div>
                    </div>
                </div>

                {inquiries.filter((inq: any) => {
                    // 1. Filter by Type
                    if (inquiryFilter === 'pending' && inq.isAnswered) return false;
                    if (inquiryFilter === 'answered' && !inq.isAnswered) return false;
                    
                    // 2. Filter by Search (Name or Content)
                    if (inquirySearch) {
                       const lower = inquirySearch.toLowerCase();
                       return (
                          (inq.userName && inq.userName.toLowerCase().includes(lower)) ||
                          (inq.content && inq.content.toLowerCase().includes(lower))
                       );
                    }
                    return true;
                }).length === 0 ? (
                  <div className="p-10 text-center text-slate-400 border border-dashed rounded-2xl">
                    검색 결과가 없습니다.
                  </div>
                ) : (
                  <div className="grid gap-4">
                     {inquiries.filter((inq: any) => {
                         if (inquiryFilter === 'pending' && inq.isAnswered) return false;
                         if (inquiryFilter === 'answered' && !inq.isAnswered) return false;
                         if (inquirySearch) {
                            const lower = inquirySearch.toLowerCase();
                            return (
                               (inq.userName && inq.userName.toLowerCase().includes(lower)) ||
                               (inq.content && inq.content.toLowerCase().includes(lower))
                            );
                         }
                         return true;
                     })
                     .sort((a: any, b: any) => {
                        const dateA = new Date(a.createdAt).getTime();
                        const dateB = new Date(b.createdAt).getTime();
                        return dateB - dateA; // Newest first
                     })
                     .map((inq: any) => {
                       const isExpanded = expandedInquiryId === inq.id;
                       return (
                        <div key={inq.id} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden shadow-sm hover:border-indigo-500 transition-all">
                           {/* Accordion Header - Clickable */}
                           <div 
                             onClick={() => toggleInquiryExpansion(inq.id)}
                             className={`p-4 flex items-center justify-between cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${isExpanded ? 'bg-slate-50 dark:bg-slate-800/50 border-b border-indigo-100 dark:border-slate-700' : ''}`}
                           >
                              <div className="flex items-center gap-4 flex-1 overflow-hidden">
                                 {/* Status Badge */}
                                 {inq.isAnswered ? (
                                    <div className="size-8 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                                       <span className="material-symbols-outlined text-sm font-bold">check</span>
                                    </div>
                                 ) : (
                                    <div className="size-8 rounded-full bg-amber-100 text-amber-600 flex items-center justify-center shrink-0 animate-pulse">
                                       <span className="material-symbols-outlined text-sm font-bold">priority_high</span>
                                    </div>
                                 )}

                                 <div className="flex flex-col min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                       <span className="font-bold text-sm text-slate-900 dark:text-white truncate">
                                          {isExpanded ? '문의 내용 상세' : (inq.content?.length > 40 ? inq.content.substring(0, 40) + '...' : inq.content)}
                                       </span>
                                       {!isExpanded && (
                                         <span className="text-[10px] text-slate-400 font-mono shrink-0">
                                           {new Date(inq.createdAt).toLocaleDateString()}
                                         </span>
                                       )}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5 mt-0.5">
                                       <span className="font-bold text-indigo-600 dark:text-indigo-400">{inq.userName}</span>
                                       <span className="opacity-50">|</span>
                                       <span className="font-mono">{inq.userId}</span>
                                    </div>
                                 </div>
                              </div>
                              <span className={`material-symbols-outlined text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180 text-indigo-500' : ''}`}>
                                 expand_more
                              </span>
                           </div>
                           
                           {/* Expanded Content */}
                           {isExpanded && (
                             <div className="p-6 bg-white dark:bg-slate-900 animate-in slide-in-from-top-2">
                                <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-xl text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap border border-slate-100 dark:border-slate-700 mb-2">
                                  {inq.content}
                                </div>
                                
                                <div className="flex items-center justify-end gap-2 mb-6">
                                   <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                                     {new Date(inq.createdAt).toLocaleString()}
                                   </span>
                                </div>

                                {inq.isAnswered ? (
                                   <div className="pl-4 border-l-2 border-emerald-500/30">
                                      <div className="text-[11px] font-bold text-emerald-600 mb-2 flex items-center gap-1.5">
                                        <span className="material-symbols-outlined text-base">reply</span>
                                        관리자 답변 완료 <span className="text-slate-400 font-normal">({new Date(inq.answeredAt).toLocaleString()})</span>
                                      </div>
                                      <div className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap bg-emerald-50 dark:bg-emerald-900/10 p-4 rounded-xl border border-emerald-100 dark:border-emerald-500/10">
                                        {inq.answer}
                                      </div>
                                   </div>
                                 ) : (
                                   <div className="bg-indigo-50 dark:bg-indigo-900/10 p-4 rounded-xl border border-indigo-100 dark:border-indigo-500/20 animate-in fade-in">
                                      <div className="flex justify-between items-center mb-2">
                                         <div className="text-xs font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                                            <span className="material-symbols-outlined text-sm">edit_note</span>
                                            답변 작성
                                         </div>
                                      </div>
                                      <textarea 
                                        value={replyDrafts[inq.id] || ''}
                                        onChange={(e) => setReplyDrafts(prev => ({...prev, [inq.id]: e.target.value}))}
                                        placeholder="여기에 답변을 바로 입력하세요..."
                                        className="w-full h-32 p-4 rounded-xl border border-indigo-200 dark:border-indigo-500/30 bg-white dark:bg-slate-800 text-sm resize-none focus:ring-2 focus:ring-indigo-500 mb-3 shadow-sm transition-all focus:shadow-md"
                                        autoFocus={false} // Don't autofocus all of them
                                      />
                                      <div className="flex justify-end gap-2">
                                        <button 
                                          onClick={() => handleSendInlineReply(inq.id, inq.userId, inq.userName, replyDrafts[inq.id] || '')}
                                          disabled={!replyDrafts[inq.id]?.trim()}
                                          className="px-6 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-500/30 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                          <span className="material-symbols-outlined text-sm">send</span>
                                          답장 전송
                                        </button>
                                      </div>
                                   </div>
                                 )}
                            </div>
                           )}
                        </div>
                       );
                     })}
                  </div>
                )}
             </div>
          ) : activeTab === 'notices' ? (
             <div className="max-w-5xl mx-auto w-full animate-in fade-in slide-in-from-bottom-4">
               {/* List Mode */}
               {noticeViewMode === 'list' && (
                 <div className="space-y-4">
                    <div className="flex justify-between items-center mb-6">
                       <div>
                          <h3 className="text-2xl font-black italic tracking-tighter text-slate-900 dark:text-white uppercase flex items-center gap-2">
                             <span className="material-symbols-outlined text-primary text-3xl">campaign</span>
                             Notice Board
                          </h3>
                          <p className="text-xs text-slate-500 font-bold mt-1 ml-1">공지사항을 작성하고 관리합니다.</p>
                       </div>
                       <button 
                         onClick={handleCreateNotice}
                         className="flex items-center gap-1 bg-primary text-white px-4 py-2 rounded-xl text-sm font-bold hover:bg-primary-dark transition-colors shadow-lg shadow-primary/20 hover:scale-105 active:scale-95"
                       >
                         <span className="material-symbols-outlined text-[20px]">add</span>
                         새 공지 작성
                       </button>
                    </div>

                    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
                       <table className="w-full text-left text-sm">
                          <thead className="bg-slate-50 dark:bg-slate-800/80 text-slate-500 font-bold border-b border-slate-200 dark:border-slate-700">
                             <tr>
                                <th className="p-4 w-20 text-center">상태</th>
                                <th className="p-4">제목 (관리자용)</th>
                                <th className="p-4 w-40 hidden sm:table-cell text-center">작성일</th>
                                <th className="p-4 w-32 text-right">관리</th>
                             </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                             {noticeList.length === 0 ? (
                               <tr><td colSpan={4} className="p-10 text-center text-slate-400 font-bold">등록된 공지사항이 없습니다.</td></tr>
                             ) : noticeList.map((n) => (
                               <tr key={n.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                                  <td className="p-4 text-center">
                                    {n.isActive ? (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 border border-green-200 dark:border-green-800">
                                        ON
                                      </span>
                                    ) : (
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400 border border-slate-200 dark:border-slate-600">
                                        OFF
                                      </span>
                                    )}
                                  </td>
                                  <td className="p-4 font-bold text-slate-700 dark:text-slate-200 cursor-pointer hover:text-primary transition-colors" onClick={() => handleEditNotice(n)}>
                                    <div className="flex items-center gap-2">
                                       {n.title}
                                       {n.imageUrl && <span className="text-[10px] bg-indigo-50 text-indigo-600 px-1.5 py-0.5 rounded border border-indigo-100 font-bold">IMG</span>}
                                    </div>
                                  </td>
                                  <td className="p-4 text-slate-500 text-xs font-mono hidden sm:table-cell text-center">
                                    {n.createdAt ? new Date(n.createdAt).toLocaleDateString() : '-'}
                                  </td>
                                  <td className="p-4 text-right">
                                     <div className="flex justify-end gap-1">
                                       <button onClick={() => handleEditNotice(n)} className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-slate-400 hover:text-indigo-500 transition-colors">
                                         <span className="material-symbols-outlined text-[20px]">edit</span>
                                       </button>
                                       <button onClick={() => handleDeleteNotice(n.id!)} className="p-1.5 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded-lg text-slate-400 hover:text-rose-500 transition-colors">
                                         <span className="material-symbols-outlined text-[20px]">delete</span>
                                       </button>
                                     </div>
                                  </td>
                               </tr>
                             ))}
                          </tbody>
                       </table>
                    </div>
                 </div>
               )}

               {/* Form Mode */}
               {noticeViewMode === 'form' && (
                 <div className="space-y-4 animate-in slide-in-from-right-4 fade-in duration-300">
                    <div className="flex items-center gap-2 mb-2">
                       <button onClick={() => setNoticeViewMode('list')} className="p-2 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white">
                          <span className="material-symbols-outlined">arrow_back</span>
                       </button>
                       <h3 className="text-xl font-bold">{editId ? '공지사항 수정' : '새 공지 작성'}</h3>
                    </div>
                    
                    <div className="grid gap-6 bg-white dark:bg-slate-900 p-6 md:p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                       {/* Title & Active */}
                       <div className="flex flex-col md:flex-row gap-6">
                          <div className="flex-1">
                             <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">제목 (관리자용 - 사용자 비노출)</label>
                             <input 
                               value={editTitle}
                               onChange={(e) => setEditTitle(e.target.value)}
                               placeholder="관리자 확인용 제목을 입력하세요 (사용자에게 노출되지 않습니다)"
                               className="w-full p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-bold focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none transition-all"
                             />
                          </div>
                          <div className="w-full md:w-40">
                             <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">노출 상태</label>
                             <label className={`flex items-center justify-center gap-2 p-3 rounded-xl border cursor-pointer select-none transition-all ${isNoticeActive ? 'bg-green-50 border-green-200 text-green-700 dark:bg-green-900/20 dark:border-green-800' : 'bg-slate-50 border-slate-200 text-slate-400 dark:bg-slate-800 dark:border-slate-700'}`}>
                                <input type="checkbox" checked={isNoticeActive} onChange={(e) => setIsNoticeActive(e.target.checked)} className="rounded text-green-600 focus:ring-green-500 size-5" />
                                <span className="text-sm font-bold">{isNoticeActive ? '노출 중' : '숨김 상태'}</span>
                             </label>
                          </div>
                       </div>

                       {/* Content (HTML) */}
                       <div>
                          <div className="flex justify-between mb-1.5">
                             <label className="text-xs font-bold text-slate-500 uppercase tracking-wide">내용 (HTML)</label>
                             <span className="text-[10px] text-slate-400 font-bold bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">HTML 지원됨</span>
                          </div>
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-[500px]">
                             <div className="flex flex-col h-full"> 
                                <textarea 
                                    value={notice}
                                    onChange={(e) => setNotice(e.target.value)}
                                    placeholder="<p>내용을 입력하세요</p>"
                                    className="flex-1 w-full p-4 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm font-mono overflow-auto resize-none focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none custom-scrollbar mb-2"
                                />
                                <div className="text-[10px] text-slate-400 px-1">
                                    💡 Tip: &lt;b&gt;, &lt;strong&gt;, &lt;br&gt;, &lt;span style="..."&gt; 등의 태그를 사용할 수 있습니다.
                                </div>
                             </div>
                             
                             <div className="h-full p-6 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-y-auto custom-scrollbar relative shadow-inner">
                                <div className="absolute top-3 right-3 text-[10px] font-bold text-slate-400 uppercase tracking-wider bg-slate-100 dark:bg-slate-700 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-600 z-10">Preview</div>
                                <div 
                                  className="prose prose-sm dark:prose-invert max-w-none [&>p]:mb-3 [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>a]:text-indigo-500 [&>a]:underline"
                                  dangerouslySetInnerHTML={{ __html: notice || '<div class="flex items-center justify-center h-full text-slate-400 text-sm">미리보기 영역입니다.</div>' }}
                                />
                             </div>
                          </div>
                       </div>

                       {/* Image */}
                       <div>
                          <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase tracking-wide">첨부 이미지</label>
                          <div className="flex flex-col md:flex-row gap-3">
                             <input 
                               value={noticeImageUrl} 
                               onChange={(e) => setNoticeImageUrl(e.target.value)}
                               placeholder="이미지 URL (직접 입력 또는 업로드)"
                               className="flex-1 p-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                             />
                             <label className={`bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 px-6 py-3 rounded-xl text-sm font-bold cursor-pointer whitespace-nowrap flex items-center justify-center gap-2 transition-colors border border-slate-300 dark:border-slate-700 ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                                <span className="material-symbols-outlined text-[20px]">upload_file</span>
                                <span>{isUploading ? '변환 중...' : '이미지 업로드'}</span>
                                <input 
                                    type="file" 
                                    accept="image/*" 
                                    className="hidden" 
                                    onChange={handleImageUpload}
                                    disabled={isUploading}
                                />
                             </label>
                          </div>
                          {noticeImageUrl && (
                             <div className="mt-4 relative w-full h-48 bg-slate-100 dark:bg-slate-800 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 group flex items-center justify-center">
                                <img src={noticeImageUrl} alt="Preview" className="h-full object-contain" />
                                <button onClick={() => setNoticeImageUrl('')} className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1.5 opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm">
                                  <span className="material-symbols-outlined text-[16px]">close</span>
                                </button>
                             </div>
                          )}
                       </div>
                       
                       {/* Footer */}
                       <div className="flex justify-end gap-3 mt-4 pt-6 border-t border-slate-100 dark:border-slate-800">
                          <button onClick={() => setNoticeViewMode('list')} className="px-6 py-2.5 rounded-xl text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">취소</button>
                          <button onClick={saveNotice} className="bg-primary hover:bg-primary-dark text-white px-8 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-primary/30 transition-all hover:scale-[1.02] active:scale-95 flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px]">save</span>
                            {editId ? '수정 사항 저장' : '공지사항 등록'}
                          </button>
                       </div>
                    </div>
                 </div>
               )}
             </div>
          ) : (activeTab === 'membership' ? (
            <div className="space-y-6 animate-in fade-in max-w-6xl mx-auto w-full">
               {/* Stats & Actions Card */}
               <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
                  <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
                     <span className="material-symbols-outlined text-rose-500 text-3xl">card_membership</span>
                     멤버십 데이터 관리
                  </h3>
                  <div className="flex flex-col gap-6">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                           <div className="text-xs text-slate-500 font-bold uppercase mb-1">총 등록 회원</div>
                           <div className="text-3xl font-black text-indigo-600 dark:text-indigo-400">
                              {(whitelistData?.count || 0).toLocaleString()}
                              <span className="text-lg text-slate-400 font-medium ml-1">명</span>
                           </div>
                        </div>
                        <div className="bg-slate-50 dark:bg-slate-800 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                           <div className="text-xs text-slate-500 font-bold uppercase mb-1">마지막 업데이트</div>
                           <div className="text-sm font-bold text-slate-700 dark:text-slate-300 mt-2">
                              {whitelistData?.updatedAt || '-'}
                           </div>
                        </div>
                     </div>
                     
                     <div className="flex flex-col sm:flex-row gap-3">
                        <label className="flex-1 py-4 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold rounded-xl hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-2 cursor-pointer shadow-sm">
                           <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
                           <span className="material-symbols-outlined text-green-500">upload_file</span>
                           CSV 업로드
                        </label>

                        <button
                           onClick={resetWhitelist}
                           className="px-6 py-4 bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 font-bold rounded-xl hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors border border-rose-200 dark:border-rose-800 flex items-center justify-center gap-2"
                           >
                           <span className="material-symbols-outlined">delete_forever</span>
                           명단 초기화
                        </button>
                     </div>
                  </div>
               </div>
               
               {/* Table Area */}
               <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
                     <h4 className="font-bold flex items-center gap-2">
                        <span className="material-symbols-outlined text-slate-400">list</span>
                        회원 명단
                     </h4>
                     <div className="relative">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-lg">search</span>
                        <input 
                           type="text" 
                           placeholder="이름 또는 ID 검색..." 
                           value={memberSearchTerm}
                           onChange={(e) => setMemberSearchTerm(e.target.value)}
                           className="pl-9 pr-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/50 w-[240px]"
                        />
                     </div>
                  </div>
                  <div className="flex gap-2">
                     <button
                        onClick={() => setIsAddMemberModalOpen(true)}
                        className="px-4 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors text-xs flex items-center gap-1"
                     >
                        <span className="material-symbols-outlined text-sm">person_add</span>
                        개별 추가
                     </button>
                  </div>
                  <div className="overflow-x-auto">
                     <table className="w-full text-left border-collapse min-w-[900px]">
                        <thead>
                           <tr className="border-b border-slate-200 dark:border-slate-800 text-xs text-slate-500 uppercase bg-slate-50/50 dark:bg-slate-800/50">
                              <th onClick={() => handleMemberSort('name')} className="px-4 py-3 font-bold w-[25%] cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors select-none">
                                 <div className="flex items-center gap-1">회원 이름 {memberSortConfig.key === 'name' && <span className="text-[10px]">{memberSortConfig.direction === 'asc' ? '▲' : '▼'}</span>}</div>
                              </th>
                              <th onClick={() => handleMemberSort('tier')} className="px-4 py-3 font-bold w-[15%] cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors select-none">
                                 <div className="flex items-center gap-1">등급 {memberSortConfig.key === 'tier' && <span className="text-[10px]">{memberSortConfig.direction === 'asc' ? '▲' : '▼'}</span>}</div>
                              </th>
                              <th onClick={() => handleMemberSort('totalDuration')} className="px-4 py-3 font-bold w-[20%] text-center cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors select-none">
                                 <div className="flex items-center justify-center gap-1">멤버십 유지기간 {memberSortConfig.key === 'totalDuration' && <span className="text-[10px]">{memberSortConfig.direction === 'asc' ? '▲' : '▼'}</span>}</div>
                              </th>
                              <th onClick={() => handleMemberSort('lastUpdate')} className="px-4 py-3 font-bold w-[25%] text-right cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors select-none">
                                 <div className="flex justify-end items-center gap-1">업데이트 {memberSortConfig.key === 'lastUpdate' && <span className="text-[10px]">{memberSortConfig.direction === 'asc' ? '▲' : '▼'}</span>}</div>
                              </th>
                              <th className="px-4 py-3 font-bold w-[15%] text-right">관리</th>
                           </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                           {processedMembers.map((m: any, idx: number) => (
                              <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group">
                                 <td className="px-4 py-3">
                                   <div className="flex items-center gap-2">
                                     <div className="size-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center text-slate-500 shrink-0">
                                       <span className="material-symbols-outlined text-sm">person</span>
                                     </div>
                                     <span className="text-sm font-bold text-slate-700 dark:text-slate-300 truncate max-w-[120px]" title={m.name}>
                                       {m.name || '알 수 없음'}
                                     </span>
                                   </div>
                                 </td>
                                 <td className="px-4 py-3">
                                    <span className={`inline-flex px-2 py-0.5 rounded text-[11px] font-bold border ${
                                       (m.tier?.includes('골드') || m.tier?.includes('Gold') || m.tier?.includes('VIP')) 
                                       ? 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-800' 
                                       : (m.tier?.includes('실버') || m.tier?.includes('Silver')) 
                                       ? 'bg-slate-200 text-slate-700 border-slate-300 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600'
                                       : 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
                                    }`}>
                                       {m.tier || '-'}
                                    </span>
                                 </td>
                                 <td className="px-4 py-3 text-center">
                                    <span className="text-xs text-indigo-600 dark:text-indigo-400 font-bold bg-indigo-50 dark:bg-indigo-900/10 px-2 py-1 rounded-lg">
                                       {(() => {
                                          const val = m.totalDuration;
                                          if (!val || val === '-') return '-';
                                          const num = parseFloat(val);
                                          return isNaN(num) ? val : `${num.toFixed(1)}개월`;
                                       })()}
                                    </span>
                                 </td>
                                 <td className="px-4 py-3 text-right">
                                    {(() => {
                                        const dateStr = m.lastUpdate || m.joinDate;
                                        if (!dateStr || dateStr === '-') return <span className="text-slate-400">-</span>;
                                        
                                        try {
                                           const anchorDate = new Date(dateStr); // 가입일 or 재가입일
                                           if (isNaN(anchorDate.getTime())) return <span className="text-slate-400">{dateStr}</span>;

                                           const status = m.status || '가입함';
                                           const anchorDay = anchorDate.getDate(); // 매월 갱신일 (예: 20일)

                                           // 1. 다음 갱신일(Next Renewal) 찾기
                                           const now = new Date();
                                           let nextRenewal = new Date(now.getFullYear(), now.getMonth(), anchorDay);
                                           
                                           // 만약 이번 달 갱신일이 이미 지났다면 -> 다음 달로 설정
                                           if (now.getDate() > anchorDay) {
                                               nextRenewal.setMonth(nextRenewal.getMonth() + 1);
                                           }

                                           // 2. 남은 일수 계산
                                           const diffMs = nextRenewal.getTime() - now.getTime();
                                           const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
                                           
                                           // 3. 상태 표시
                                           const isDDay = daysLeft === 0;
                                           const isUrgent = daysLeft <= 3;

                                           return (
                                              <div className="flex flex-col items-end gap-0.5">
                                                 <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                                                    isUrgent 
                                                    ? 'text-amber-600 bg-amber-50 dark:bg-amber-900/20' 
                                                    : 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20'
                                                 }`}>
                                                    {isDDay ? 'D-Day (오늘 갱신)' : `D-${daysLeft} (${daysLeft}일 남음)`}
                                                 </span>
                                                 <span className="text-[10px] text-slate-400">
                                                    {status === '재가입' ? '재가입일 ' : '가입일 '}
                                                    {anchorDate.toLocaleDateString('ko-KR', {month:'2-digit', day:'2-digit'})}
                                                    {' · 매월 '}{anchorDay}일 갱신
                                                 </span>
                                              </div>
                                           );
                                        } catch (e) { return <span className="text-slate-400">-</span>; }
                                    })()}
                                 </td>
                                 <td className="px-4 py-3 text-right">
                                    <div className="flex items-center justify-end gap-2">
                                       <button 
                                          className="text-[10px] bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-500 px-2 py-1 rounded font-mono transition-colors truncate max-w-[120px]"
                                          onClick={() => navigator.clipboard.writeText(m.id)}
                                          title="클릭하여 ID 복사"
                                       >
                                          {m.id}
                                       </button>
                                       <button 
                                          onClick={() => handleDeleteMember(m.id, m.name)}
                                          className="text-rose-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 p-1 rounded transition-colors"
                                          title="명단에서 삭제 및 등급 해제"
                                       >
                                          <span className="material-symbols-outlined text-sm">delete</span>
                                       </button>
                                    </div>
                                 </td>
                              </tr>
                           ))}
                           {(!whitelistData?.ids || whitelistData.ids.length === 0) && (
                              <tr>
                                 <td colSpan={6} className="py-20 text-center text-slate-400 text-sm">
                                    등록된 멤버십 회원이 없습니다.
                                 </td>
                              </tr>
                           )}
                        </tbody>
                     </table>
                  </div>
               </div>
             </div>
          ) : (
            <div className="flex flex-col gap-6">
                {/* Package Filters */}
                <div className="flex items-center justify-between gap-2">
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
                   
                   {/* Created Button */}
                   <button 
                     onClick={() => { resetPkgForm(); setIsPackageModalOpen(true); }}
                     className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-colors shadow-md"
                   >
                     <span className="material-symbols-outlined text-sm">add</span>
                     <span>{activeTab === 'packages' ? '새 추천 팩' : '새 추천 소재'}</span>
                   </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {filteredItems.length === 0 ? (
                    <div className="col-span-full py-20 text-center text-slate-400 text-sm">
                        해당하는 {activeTab === 'topics' ? '소재' : '패키지'}가 없습니다.
                    </div>
                  ) : (
                    filteredItems.map(pkg => (
                    <div key={pkg.id} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm hover:shadow-md transition-all group">
                       <div className="p-6 space-y-4">
                         <div className="flex items-center justify-between">
                           <span className={`text-[10px] font-black uppercase px-2 py-1 rounded ${activeTab === 'topics' ? 'text-amber-500 bg-amber-500/10' : 'text-indigo-500 bg-indigo-500/10'}`}>
                              {activeTab === 'topics' ? '추천 소재' : pkg.category}
                           </span>
                           <span className={`${getStatusColor(pkg.status)} px-2 py-0.5 rounded text-[10px] uppercase font-bold`}>
                            {getStatusLabel(pkg.status)}
                          </span>
                          {pkg.scheduledAt && new Date(pkg.scheduledAt).getTime() > Date.now() && (
                             <span className="text-[10px] text-indigo-500 font-bold bg-indigo-50 dark:bg-indigo-900/20 px-2 py-0.5 rounded flex items-center gap-1">
                               <span className="material-symbols-outlined text-[10px]">event</span>
                               {new Date(pkg.scheduledAt).toLocaleDateString()} {new Date(pkg.scheduledAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})} 공개예정
                             </span>
                          )}
                          {!pkg.scheduledAt && (
                             <span className="text-[10px] text-slate-400 font-medium">
                               {new Date(pkg.createdAt).toLocaleDateString()} 등록됨
                             </span>
                          )}
                        </div>

                         {pkg.creatorName && (
                            <div className="flex items-center gap-1.5 text-[11px] text-slate-500 bg-slate-50 dark:bg-slate-800/50 px-2.5 py-1.5 rounded-lg w-fit">
                               <span className="material-symbols-outlined text-sm text-indigo-500">face</span>
                               <span className="font-bold text-slate-700 dark:text-slate-300">{pkg.creatorName}</span>
                               <span>님이 제안함</span>
                            </div>
                         )}
                         
                         <div className="space-y-1">
                            <h3 className="font-bold text-lg text-slate-900 dark:text-white line-clamp-1">{pkg.title}</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 h-8">{pkg.description}</p>
                         </div>

                         <div className="flex items-center gap-2 py-3 border-y border-slate-100 dark:border-slate-800">
                            <div className="flex -space-x-2">
                               {pkg.channels.slice(0,3).map(c => (
                                 <img key={c.id} src={c.thumbnail} className="size-6 rounded-full border border-white dark:border-slate-800" />
                               ))}
                               {pkg.channels.length > 3 && (
                                 <div className="size-6 rounded-full bg-slate-100 dark:bg-slate-800 border border-white dark:border-slate-800 flex items-center justify-center text-[9px] font-bold text-slate-500">+{pkg.channels.length - 3}</div>
                               )}
                            </div>
                            <span className="text-xs text-slate-400">총 {pkg.channelCount}개 채널</span>
                         </div>

                         <div className="flex gap-2">
                            <button onClick={() => openEditPackage(pkg)} className="flex-1 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 py-2 rounded-lg text-xs font-bold transition-colors">수정</button>
                            <button onClick={() => openDuplicatePackage(pkg)} className="px-3 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 py-2 rounded-lg text-xs font-bold transition-colors" title="복제"><span className="material-symbols-outlined text-sm">content_copy</span></button>
                            
                            {(pkg.status === 'pending') && (
                              <button onClick={() => handleApprovePackage(pkg)} className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white py-2 rounded-lg text-xs font-bold transition-colors">승인</button>
                            )}
                            
                            <button onClick={() => handleDeletePackage(pkg.id)} className="px-3 bg-rose-50 hover:bg-rose-100 dark:bg-rose-900/20 dark:hover:bg-rose-900/40 text-rose-500 py-2 rounded-lg transition-colors"><span className="material-symbols-outlined text-sm">delete</span></button>
                         </div>
                       </div>
                    </div>
                  ))
                  )}
                </div>
             </div>
          ))}
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
                     <label className="block text-xs font-bold text-slate-500 mb-1">등급 (Grade)</label>
                     <div className="flex gap-2">
                       {['general', 'silver', 'gold'].map((p) => (
                         <button
                           key={p}
                           onClick={() => setEditPlan(p)}
                           className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-all ${
                             editPlan === p 
                               ? 'bg-primary text-white border-primary' 
                               : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
                           }`}
                         >
                           {p === 'general' ? '일반' : p === 'silver' ? '실버' : '골드'}
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

               {/* History Section */}
               {userHistory.length > 0 && (
                  <div className="border-t border-slate-100 dark:border-slate-800 pt-4">
                    <label className="block text-xs font-bold text-slate-500 mb-2">활동 기록 (History)</label>
                    <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-3 max-h-40 overflow-y-auto space-y-2">
                      {userHistory.map((h) => (
                        <div key={h.id} className="text-xs border-b border-slate-100 dark:border-slate-700/50 pb-2 last:border-0 last:pb-0">
                          <div className="flex justify-between text-slate-400 text-[10px] mb-0.5">
                             <span>{new Date(h.date).toLocaleString()}</span>
                             <span className="uppercase tracking-wider opacity-70">{h.action}</span>
                          </div>
                          <div className="text-slate-600 dark:text-slate-300 font-medium break-keep">
                             {h.details}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
               )}

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
                    <span className={`material-symbols-outlined ${activeTab === 'topics' ? 'text-amber-500' : 'text-primary'}`}>{activeTab === 'topics' ? 'lightbulb' : 'inventory_2'}</span>
                    {editingPackage 
                      ? (activeTab === 'topics' ? '추천 소재 수정' : '추천 팩 수정') 
                      : (activeTab === 'topics' ? '새 추천 소재 만들기' : '새 추천 팩 만들기')}
                  </h3>
                 <button onClick={() => setIsPackageModalOpen(false)} className="text-slate-400 hover:text-rose-500"><span className="material-symbols-outlined">close</span></button>
               </div>
               
               <div className="p-8 space-y-6 overflow-y-auto">
                 <div className="grid grid-cols-2 gap-6">
                   <div className="space-y-4">
                     <div>
                       <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase">{activeTab === 'topics' ? '추천 소재 제목' : '패키지 제목'}</label>
                       <input 
                         value={pkgTitle} 
                         onChange={(e) => setPkgTitle(e.target.value)} 
                         placeholder={activeTab === 'topics' ? "예: 떡상하는 쇼츠 특징 분석" : "예: 2024 상반기 떡상 가이드"}
                         className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold text-sm focus:ring-2 focus:ring-primary/20"
                       />
                     </div>
                     {activeTab !== 'topics' && (
                       <div>
                         <label className="block text-xs font-bold text-slate-500 mb-1.5 uppercase">타겟 그룹 이름 (선택)</label>
                         <input 
                           value={pkgTargetGroup} 
                           onChange={(e) => setPkgTargetGroup(e.target.value)} 
                           placeholder="예: 주식 필수 채널 (다운로드 시 그룹 생성)"
                           className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold text-sm focus:ring-2 focus:ring-primary/20"
                         />
                       </div>
                     )}
                   </div>
                   <div className="relative">
                     <div className="flex justify-between items-center mb-1.5">
                        <label className="block text-xs font-bold text-slate-500 uppercase">{activeTab === 'topics' ? '추천 이유' : '설명'}</label>
                        <button 
                          onClick={(e) => {
                            e.preventDefault();
                            if (!adminGeminiKey) return alert("Gemini API 키가 필요합니다. 대시보드 상단에서 설정해주세요.");
                            if (pkgChannels.length === 0) return alert("먼저 채널을 추가해주세요.");
                            
                            setIsGeneratingAi(true);
                            const mainChannel = pkgChannels[0];
                            const videoTitles = mainChannel.topVideos ? mainChannel.topVideos.map(v => v.title) : [];
                            
                            generateChannelRecommendation(adminGeminiKey, mainChannel.title, mainChannel.description || '', videoTitles)
                                .then(aiReason => {
                                    setPkgDesc(aiReason);
                                    setIsGeneratingAi(false);
                                })
                                .catch(err => {
                                    console.error("AI Gen Failed", err);
                                    alert("AI 작성 실패: " + err.message);
                                    setIsGeneratingAi(false);
                                });
                          }}
                          disabled={isGeneratingAi || pkgChannels.length === 0}
                          className="flex items-center gap-1 text-[10px] bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-2.5 py-1 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-bold border border-indigo-100 dark:border-indigo-800"
                        >
                           <span className={`material-symbols-outlined text-[14px] ${isGeneratingAi ? 'animate-spin' : ''}`}>auto_awesome</span>
                           {isGeneratingAi ? '작성 중...' : 'AI 자동 작성'}
                        </button>
                     </div>
                     <textarea 
                       value={pkgDesc} 
                       onChange={(e) => setPkgDesc(e.target.value)} 
                       placeholder={activeTab === 'topics' ? "이 소재를 추천하는 이유를 입력하세요..." : "이 패키지에 대한 설명을 입력하세요..."}
                       className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm h-[124px] resize-none focus:ring-2 focus:ring-primary/20"
                     />
                   </div>
                 </div>



                 <div className="flex gap-4 mb-4">
                    <div className="flex-1">
                       <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">공개 예정일 (선택)</label>
                       <DatePicker
                          selected={pkgScheduledAt}
                          onChange={(date) => setPkgScheduledAt(date)}
                          showTimeSelect
                          timeFormat="HH:mm"
                          timeIntervals={60}
                          dateFormat="yyyy.MM.dd HH:mm"
                          placeholderText="즉시 공개"
                          className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                       />
                       <p className="text-[10px] text-slate-400 mt-1">설정하지 않으면 즉시 공개됩니다.</p>
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
                             <div key={`${ch.id}-${idx}`} className="bg-white dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-slate-800 p-3 mb-2">
                               <div className="flex items-center gap-3">
                                 <img src={ch.thumbnail} className="size-10 rounded-full bg-slate-200" />
                                 <div className="flex-1 min-w-0">
                                    <div className="font-bold text-sm truncate dark:text-slate-200">{ch.title}</div>
                                    <div className="text-[10px] text-slate-400 truncate">{ch.id}</div>
                                 </div>
                                 <button 
                                   onClick={() => {
                                     setPkgChannels(prev => prev.filter(c => c.id !== ch.id));
                                   }}
                                   className="p-1.5 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-500 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors"
                                 >
                                    <span className="material-symbols-outlined text-sm">delete</span>
                                 </button>
                               </div>
                               
                               {/* Admin Preview of Popular Videos (Only for Topics) */}
                               {activeTab === 'topics' && ch.topVideos && ch.topVideos.length > 0 && (
                                 <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
                                   {ch.topVideos.map(vid => (
                                     <a key={vid.id} href={`https://youtu.be/${vid.id}`} target="_blank" rel="noreferrer" className="group block relative aspect-video rounded-lg overflow-hidden bg-slate-100">
                                        <img src={vid.thumbnail} className="w-full h-full object-cover" />
                                        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                                           <span className="material-symbols-outlined text-white text-lg">play_circle</span>
                                        </div>
                                        <div className="absolute bottom-0 inset-x-0 p-1 bg-gradient-to-t from-black/80 to-transparent text-[9px] text-white truncate px-1.5">
                                           {parseInt(vid.views).toLocaleString()}회
                                        </div>
                                     </a>
                                   ))}
                                 </div>
                               )}

                             </div>
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

                  <div className="flex-[2] flex gap-2">
                    {editingPackage && editingPackage.status !== 'approved' && (
                       <button 
                         onClick={() => handleSavePackage(true)}
                         className="flex-1 py-3 font-bold text-white rounded-xl transition-colors shadow-lg flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20"
                       >
                          <span className="material-symbols-outlined text-lg">verified</span>
                          저장 및 승인
                       </button>
                    )}
                    <button 
                      onClick={() => handleSavePackage(false)}
                      className={`flex-1 py-3 font-bold text-white rounded-xl transition-colors shadow-lg flex items-center justify-center gap-2 ${activeTab === 'topics' ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20' : 'bg-indigo-500 hover:bg-indigo-600 shadow-indigo-500/20'}`}
                    >
                      <span className="material-symbols-outlined text-lg">save</span>
                      {editingPackage 
                        ? '수정 사항 저장' 
                        : (activeTab === 'topics' ? '소재 등록 완료' : '패키지 생성 완료')}
                    </button>
                  </div>
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
        {/* User History View Modal (Read-Only) */}
        {viewingHistoryUser && (
           <div className="absolute inset-0 z-20 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in">
             <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95">
               <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
                 <div>
                    <h3 className="text-lg font-bold text-slate-800 dark:text-white">활동 기록</h3>
                    <p className="text-xs text-slate-500">{viewingHistoryUser.displayName} 님의 기록</p>
                 </div>
                 <button onClick={() => setViewingHistoryUser(null)} className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400">
                    <span className="material-symbols-outlined">close</span>
                 </button>
               </div>
               
               <div className="p-0 max-h-[60vh] overflow-y-auto">
                 {historyList.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 text-sm">기록이 없습니다.</div>
                 ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                       {historyList.map(h => (
                          <div key={h.id} className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
                             <div className="flex items-center justify-between mb-1">
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase ${
                                   h.action === 'membership_sync' ? 'bg-amber-100 text-amber-600' : 
                                   h.action === 'reward_extension' ? 'bg-emerald-100 text-emerald-600' : 
                                   'bg-slate-100 text-slate-500'
                                }`}>{h.action}</span>
                                <span className="text-[10px] text-slate-400">{new Date(h.date).toLocaleString()}</span>
                             </div>
                             <p className="text-sm text-slate-700 dark:text-slate-300 break-keep leading-relaxed">{h.details}</p>
                          </div>
                       ))}
                    </div>
                 )}
               </div>
             </div>
           </div>
        )}
         {/* Add Member Modal */}
         {isAddMemberModalOpen && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
               <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-md p-6 shadow-2xl border border-slate-200 dark:border-slate-800 animate-in zoom-in-95">
                  <h3 className="text-lg font-bold mb-4 text-slate-900 dark:text-white">멤버십 회원 수동 추가</h3>
                  
                  <div className="space-y-4">
                     <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">회원명 (닉네임)</label>
                        <input 
                           type="text" 
                           value={newMemberData.name}
                           onChange={e => setNewMemberData({...newMemberData, name: e.target.value})}
                           className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                           placeholder="홍길동"
                        />
                     </div>
                     <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">ID (채널 ID 또는 이메일)</label>
                        <input 
                           type="text" 
                           value={newMemberData.id}
                           onChange={e => setNewMemberData({...newMemberData, id: e.target.value})}
                           className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-mono"
                           placeholder="UC... 또는 email@example.com"
                        />
                     </div>
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                           <label className="block text-xs font-bold text-slate-500 mb-1">등급</label>
                           <select
                              value={newMemberData.tier}
                              onChange={e => setNewMemberData({...newMemberData, tier: e.target.value})}
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                           >
                              <option value="실버 버튼">실버 버튼</option>
                              <option value="골드 버튼">골드 버튼</option>
                           </select>
                        </div>
                        <div>
                           <label className="block text-xs font-bold text-slate-500 mb-1">잔여 기간 (일)</label>
                           <input 
                              type="number" 
                              value={newMemberData.remainingDays}
                              onChange={e => setNewMemberData({...newMemberData, remainingDays: e.target.value})}
                              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm"
                           />
                        </div>
                     </div>
                  </div>

                  <div className="flex justify-end gap-2 mt-6">
                     <button 
                        onClick={() => setIsAddMemberModalOpen(false)}
                        className="px-4 py-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-sm font-bold"
                     >
                        취소
                     </button>
                     <button 
                        onClick={handleAddMember}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold"
                     >
                        추가하기
                     </button>
                  </div>
               </div>
            </div>
         )}
         
      </div>
  );
};

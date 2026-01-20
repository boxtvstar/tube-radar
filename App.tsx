
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore'; // Added onSnapshot for real-time notice updates
import { MOCK_VIDEOS, MOCK_STATS, NETWORK_VELOCITY_DATA } from './constants';
import { VideoData, ViralStat, SavedChannel, ChannelGroup, ApiUsage } from './types';
import { fetchRealVideos, getChannelInfo, searchChannelsByKeyword } from './services/youtubeService';
import { getApiUsage } from './services/usageService';
import { db } from './src/lib/firebase'; // Added db import
import { useAuth } from './src/contexts/AuthContext';
import { Login } from './src/components/Login';
import { PendingApproval } from './src/components/PendingApproval';
import { AdminDashboard } from './src/components/AdminDashboard';
import { UserRole } from './src/contexts/AuthContext';
import { 
  getChannelsFromDb, 
  getGroupsFromDb, 
  saveChannelToDb, 
  removeChannelFromDb, 
  saveGroupToDb, 
  deleteGroupFromDb,
  batchSaveChannels
} from './services/dbService';

// --- 서브 컴포넌트 ---

const VelocitySpeedometer = ({ score }: { score: string }) => {
  const numericScore = parseFloat(score);
  
  const getStatus = () => {
    if (numericScore >= 15) return { label: '급상승', color: 'text-accent-hot', bg: 'bg-accent-hot/20 dark:bg-accent-hot/20', icon: 'speed', percent: 100 };
    if (numericScore >= 8) return { label: '가속', color: 'text-accent-neon dark:text-accent-neon', bg: 'bg-accent-neon/20 dark:bg-accent-neon/20', icon: 'trending_up', percent: 75 };
    if (numericScore >= 3) return { label: '성장', color: 'text-primary dark:text-primary', bg: 'bg-primary/20 dark:bg-primary/20', icon: 'rocket_launch', percent: 50 };
    return { label: '안정', color: 'text-slate-500 dark:text-slate-500', bg: 'bg-slate-200 dark:bg-slate-800/40', icon: 'bolt', percent: 25 };
  };

  const status = getStatus();

  return (
    <div className={`flex items-center gap-2 px-2.5 py-1 rounded-lg ${status.bg} border border-black/5 dark:border-white/5 transition-all`}>
      <span className={`material-symbols-outlined text-[14px] ${status.color} ${numericScore > 10 ? 'animate-pulse' : ''}`}>
        {status.icon}
      </span>
      <span className={`text-[10px] font-black uppercase tracking-tighter leading-none ${status.color}`}>
        {status.label}
      </span>
    </div>
  );
};

const VideoCard: React.FC<{ video: VideoData }> = ({ video }) => {
  const isExtremeViral = parseFloat(video.viralScore) > 10;
  const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
  
  return (
    <div className={`bg-white dark:bg-slate-card border ${isExtremeViral ? 'border-primary/40 ring-1 ring-primary/20' : 'border-slate-200 dark:border-slate-800'} rounded-2xl overflow-hidden group hover:border-primary/50 transition-all flex flex-col md:flex-row md:h-52 shadow-xl dark:shadow-black/30 relative animate-in slide-in-from-bottom-4 duration-300`}>
      <a 
        href={videoUrl} 
        target="_blank" 
        rel="noopener noreferrer" 
        className="relative w-full md:w-80 bg-black overflow-hidden shrink-0 h-48 md:h-full border-r border-slate-200 dark:border-slate-800/50"
      >
        <img 
          className="absolute inset-0 w-full h-full object-cover opacity-85 group-hover:opacity-100 group-hover:scale-110 transition-all duration-700" 
          src={video.thumbnailUrl} 
          alt={video.title} 
          loading="lazy" 
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent"></div>
        <div className="absolute bottom-3 right-3 bg-black/80 px-2 py-0.5 rounded text-[10px] font-black text-white z-10">{video.duration}</div>
        <div className={`absolute top-3 left-3 z-10 ${isExtremeViral ? 'viral-badge-neon px-3' : 'bg-slate-900 border border-white/10 px-2'} text-white text-[10px] font-black py-1 rounded shadow-lg uppercase tracking-tighter`}>
          {video.viralScore}
        </div>
      </a>
      
      <div className="flex-1 p-5 md:p-6 flex flex-col justify-between overflow-hidden relative">
        <div className="space-y-3">
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1 min-w-0">
              <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="block group/title">
                <h3 className="font-bold text-sm md:text-base leading-tight dark:text-white text-slate-900 group-hover/title:text-primary transition-colors line-clamp-2 min-h-[2.6rem] mb-1">
                  {video.title}
                </h3>
              </a>
              <p className="text-[11px] text-slate-500 font-medium truncate mb-2">{video.channelName} • {video.uploadTime}</p>
            </div>
            <div className="shrink-0">
              <VelocitySpeedometer score={video.viralScore} />
            </div>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-[10px] font-black uppercase text-slate-500">
               <div className="flex gap-4">
                  <span><span className="text-slate-400 dark:text-slate-600 mr-1.5">구독자</span><span className="text-slate-700 dark:text-slate-300">{video.subscribers}</span></span>
                  <span><span className="text-slate-400 dark:text-slate-600 mr-1.5">평균 조회수</span><span className="text-slate-700 dark:text-slate-400">{video.avgViews}</span></span>
                  <span><span className="text-slate-400 dark:text-slate-600 mr-1.5">현재 조회수</span><span className={isExtremeViral ? 'text-accent-neon dark:text-accent-neon' : 'text-slate-700 dark:text-slate-400'}>{video.views}</span></span>
               </div>
               <div className="flex items-center gap-2">
                  <span className="text-slate-400 dark:text-slate-600 text-[9px]">바이럴 확산력</span>
                  <span className={isExtremeViral ? 'text-accent-hot' : 'text-slate-700 dark:text-slate-400'}>{video.reachPercentage}%</span>
               </div>
            </div>
            
            <div className="w-full bg-slate-100 dark:bg-slate-800/50 h-1.5 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-1000 ${video.reachPercentage > 85 ? 'bg-accent-hot shadow-[0_0_8px_#ff0055]' : 'bg-primary'}`} style={{ width: `${video.reachPercentage}%` }}></div>
            </div>
          </div>
        </div>
        
        <div className="flex justify-between items-center h-10 mt-2">
          <div className="flex gap-2 overflow-hidden h-full items-center">
            {video.tags && video.tags.length > 0 ? (
              video.tags.slice(0, 3).map((tag, i) => (
                <span key={i} className="text-slate-400 dark:text-slate-600 text-[10px] font-bold truncate">#{tag.replace('#', '')}</span>
              ))
            ) : (
              <span className="text-slate-300 dark:text-slate-800 text-[10px] font-bold italic">No Signals</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const Sidebar = ({ 
  ytKey, 
  onYtKeyChange,
  ytApiStatus,
  region,
  onRegionChange,
  selectedCategory,
  onCategoryChange,
  isMyMode,
  onToggleMyMode,
  isExplorerMode,
  onToggleExplorerMode,
  isUsageMode,
  onToggleUsageMode,
  hasPendingSync,
  isSyncNoticeDismissed,
  isApiKeyMissing,
  usage
}: { 
  ytKey: string,
  onYtKeyChange: (val: string) => void,
  ytApiStatus: 'idle' | 'valid' | 'invalid' | 'loading',
  region: string,
  onRegionChange: (val: string) => void,
  selectedCategory: string,
  onCategoryChange: (val: string) => void,
  isMyMode: boolean,
  onToggleMyMode: (val: boolean) => void,
  isExplorerMode: boolean,
  onToggleExplorerMode: (val: boolean) => void,
  isUsageMode: boolean,
  onToggleUsageMode: (val: boolean) => void,
  hasPendingSync: boolean,
  isSyncNoticeDismissed: boolean,
  isApiKeyMissing: boolean,
  usage: ApiUsage
}) => {
  const remain = isApiKeyMissing ? 0 : usage.total - usage.used;
  const percent = isApiKeyMissing ? 0 : Math.max(0, (remain / usage.total) * 100);
  const isCritical = !isApiKeyMissing && percent < 10;
  const isWarning = !isApiKeyMissing && percent < 30;

  return (
    <aside className="w-64 border-r border-slate-200 dark:border-slate-800 flex flex-col h-screen shrink-0 bg-white dark:bg-background-dark hidden lg:flex">
      <div className="p-6 flex items-center gap-3">
        <div className="size-10 bg-primary rounded-lg flex items-center justify-center text-white neon-glow">
          <span className="material-symbols-outlined">analytics</span>
        </div>
        <div>
          <h1 className="text-sm font-bold leading-tight tracking-tighter uppercase dark:text-white text-slate-900">Tube Radar 2.0</h1>
          <p className="text-slate-400 dark:text-slate-500 text-[9px] font-bold uppercase tracking-widest">By 디스이즈머니</p>
        </div>
      </div>
      
      <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar flex flex-col">
        <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-3 py-4">워크스페이스</div>
        <div className="px-2 space-y-1">
          <button
            onClick={() => { onToggleUsageMode(false); onToggleExplorerMode(false); onToggleMyMode(true); }}
            className={`w-full relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
              isMyMode && !isExplorerMode && !isUsageMode
                ? 'bg-accent-hot/10 text-accent-hot shadow-sm border border-accent-hot/20' 
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">sensors</span>
            내 모니터링 리스트
            {hasPendingSync && !isSyncNoticeDismissed && <span className="absolute top-2 right-2 size-2 bg-accent-hot rounded-full animate-pulse shadow-[0_0_8px_#ff0055]"></span>}
          </button>

          <button
            onClick={() => { onToggleUsageMode(false); onToggleExplorerMode(true); }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all mt-1 ${
              isExplorerMode && !isUsageMode
                ? 'bg-emerald-500/10 text-emerald-500 shadow-sm border border-emerald-500/20' 
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'
            }`}
          >
            <span className="material-symbols-outlined text-[18px]">search_insights</span>
            키워드 검색 채널 수집
          </button>
        </div>

        <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-3 py-4 mt-4">탐색 트렌드</div>
        <div className="px-2 space-y-1">
          {[
            { id: 'KR', name: '대한민국 트렌드', icon: 'location_on' },
            { id: 'US', name: '미국 트렌드', icon: 'public' },
            { id: 'JP', name: '일본 트렌드', icon: 'language' }
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onToggleUsageMode(false);
                onToggleExplorerMode(false);
                onToggleMyMode(false);
                onCategoryChange('');
                onRegionChange(item.id);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                region === item.id && !isMyMode && !selectedCategory && !isExplorerMode && !isUsageMode
                  ? 'bg-primary/10 text-primary shadow-sm border border-primary/20' 
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
              {item.name}
            </button>
          ))}
        </div>

        <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-3 py-8">AI 추천 카테고리</div>
        <div className="px-2 space-y-1">
          {CATEGORIES.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onToggleUsageMode(false);
                onToggleExplorerMode(false);
                onToggleMyMode(false);
                onCategoryChange(item.id);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold transition-all ${
                selectedCategory === item.id && !isMyMode && !isExplorerMode && !isUsageMode
                  ? 'bg-accent-neon/10 text-accent-neon border border-accent-neon/20' 
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
              {item.name}
            </button>
          ))}
        </div>

        <div className="mt-auto p-4 space-y-3 pb-8">
          <button 
            onClick={() => onToggleUsageMode(true)}
            className={`w-full p-4 rounded-2xl border transition-all hover:scale-[1.02] active:scale-[0.98] flex flex-col gap-2.5 ${
              isUsageMode 
              ? 'bg-primary/5 border-primary/30 ring-1 ring-primary/20' 
              : 'bg-slate-50 dark:bg-white/5 border-slate-100 dark:border-white/5'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-tighter flex items-center gap-1.5">
                <span className={`material-symbols-outlined text-[14px] ${isCritical ? 'text-accent-hot animate-pulse' : 'text-primary'}`}>
                  {isCritical ? 'battery_alert' : 'battery_charging_full'}
                </span>
                API 쿼터 사용량
              </span>
              <span className={`text-[10px] font-black ${isCritical ? 'text-accent-hot' : isWarning ? 'text-orange-500' : 'text-emerald-500'}`}>
                {percent.toFixed(0)}%
              </span>
            </div>
            <div className="w-full bg-slate-200 dark:bg-slate-800 h-1.5 rounded-full overflow-hidden">
              <div 
                className={`h-full transition-all duration-1000 ease-out rounded-full ${isCritical ? 'bg-accent-hot' : isWarning ? 'bg-orange-500' : 'bg-primary'}`}
                style={{ width: `${percent}%` }}
              ></div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold text-slate-500">{remain.toLocaleString()} LP 잔여</span>
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-tighter">상세 보기</span>
            </div>
          </button>

          <div className="pt-2 text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-1">API 설정</div>
          <div className="space-y-2">
            <input 
              type="password"
              value={ytKey}
              onChange={(e) => onYtKeyChange(e.target.value)}
              placeholder="YouTube API 키 입력"
              className={`w-full bg-slate-100 dark:bg-slate-900/50 border rounded-lg px-3 py-2 text-[10px] text-slate-700 dark:text-slate-300 outline-none shadow-inner transition-all ${
                ytApiStatus === 'valid' ? 'border-emerald-500/30 focus:border-emerald-500' : 
                ytApiStatus === 'invalid' ? 'border-rose-500/30 focus:border-rose-500' : 'border-slate-200 dark:border-slate-800 focus:border-primary'
              } ${isApiKeyMissing ? 'ring-2 ring-rose-500/50 border-rose-500 animate-pulse' : ''}`}
            />
            <div className={`flex items-center justify-between p-2 rounded-lg border transition-all ${
                ytApiStatus === 'valid' ? 'bg-emerald-500/5 border-emerald-500/20 text-emerald-400' : 
                ytApiStatus === 'invalid' ? 'bg-rose-500/5 border-rose-500/20 text-rose-400' : 'bg-slate-100 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-500'
              }`}>
              <span className="text-[9px] font-bold uppercase tracking-tighter">연결 상태</span>
              <div className="flex items-center gap-1.5">
                <span className="text-[8px] font-black">{ytApiStatus === 'valid' ? '활성' : ytApiStatus === 'invalid' ? '오류' : ytApiStatus === 'loading' ? '확인 중...' : '대기'}</span>
                <span className={`size-1.5 rounded-full ${ytApiStatus === 'valid' ? 'bg-emerald-500 animate-pulse' : ytApiStatus === 'invalid' ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-700'}`}></span>
              </div>
            </div>
          </div>
        </div>
      </nav>
    </aside>
  );
};

const Header = ({ region, count, theme, onToggleTheme, hasPendingSync, isApiKeyMissing, onDismissSync, user, role, expiresAt, onLogout, onOpenAdmin }: { 
  region: string, 
  count: number, 
  theme: 'dark' | 'light', 
  onToggleTheme: () => void, 
  hasPendingSync: boolean, 
  isApiKeyMissing: boolean, 
  onDismissSync: () => void,
  user: any,
  role: UserRole | null,
  expiresAt: string | null,
  onLogout: () => void,
  onOpenAdmin: () => void
}) => {
  // D-Day calculation
  const getDday = () => {
    if (!expiresAt) return null;
    const now = new Date();
    const expiry = new Date(expiresAt);
    const diffTime = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) return '만료됨';
    if (diffDays === 0) return 'D-Day';
    return `D-${diffDays}`;
  };

  const dDay = getDday();

  // Notice State
  const [notice, setNotice] = useState<{ content: string; isActive: boolean } | null>(null);
  const [isNoticeDismissed, setIsNoticeDismissed] = useState(false);

  useEffect(() => {
    // Real-time listener for notice
    const unsub = onSnapshot(doc(db, 'system', 'notice'), (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data() as { content: string; isActive: boolean };
        setNotice(data);
        // Reset dismissal when content changes significantly (optional logic, simplifed here to always show unless dismissed this session)
        // If we want to re-show on update:
        // setIsNoticeDismissed(false); 
      } else {
        setNotice(null);
      }
    });
    return () => unsub();
  }, []);

  // Effect to reset dismissal if content changes (checking content string)
  useEffect(() => {
    setIsNoticeDismissed(false);
  }, [notice?.content]);

  return (
  <header className="flex flex-col sticky top-0 z-40">
    {/* Notice Banner */}
    {notice && notice.isActive && notice.content && !isNoticeDismissed && (
      <div className="bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-600 text-white text-[11px] font-bold py-1.5 px-4 tracking-wide animate-in slide-in-from-top-full relative overflow-hidden flex items-center justify-between">
        <div className="absolute top-0 left-0 w-full h-[1px] bg-white/20"></div>
        <div className="flex-1 flex items-center justify-center gap-2 pl-6">
          <span className="material-symbols-outlined text-[14px] animate-pulse">campaign</span>
          <span>{notice.content}</span>
        </div>
        <button 
          onClick={() => setIsNoticeDismissed(true)} 
          className="text-white/70 hover:text-white p-1 rounded-full hover:bg-white/10 transition-colors"
          title="공지 닫기"
        >
          <span className="material-symbols-outlined text-[14px] block">close</span>
        </button>
      </div>
    )}
    <div className="h-16 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-8 bg-white/80 dark:bg-background-dark/50 backdrop-blur-md transition-colors duration-300">
    <div className="flex items-center gap-4">
      <span className="text-[10px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-[0.2em]">통계 제어 판넬</span>
      {isApiKeyMissing ? (
        <div className="flex items-center gap-2 px-3 py-1 bg-rose-500/10 border border-rose-500/20 rounded-full animate-in fade-in slide-in-from-left-2 shadow-[0_0_12px_rgba(244,63,94,0.1)]">
          <span className="size-1.5 bg-rose-500 rounded-full animate-pulse"></span>
          <span className="text-[9px] font-black text-rose-500 uppercase tracking-tighter">YouTube API 키 설정이 필요합니다</span>
        </div>
      ) : hasPendingSync && (
        <div className="flex items-center gap-2 px-3 py-1 bg-accent-hot/10 border border-accent-hot/20 rounded-full animate-in fade-in slide-in-from-left-2">
          <span className="size-1.5 bg-accent-hot rounded-full animate-pulse"></span>
          <span className="text-[9px] font-black text-accent-hot uppercase tracking-tighter">내 모니터링 리스트 메뉴 에서 동기화 필요</span>
          <button onClick={onDismissSync} className="text-accent-hot hover:text-white transition-colors ml-1 leading-none p-0.5"><span className="material-symbols-outlined text-[12px] font-black">close</span></button>
        </div>
      )}
    </div>
    <div className="flex items-center gap-4">
      {user && (
        <div className="flex items-center gap-3 pl-4 border-l border-slate-200 dark:border-white/10">
           <img 
             src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
             alt="User" 
             className="size-8 rounded-full border border-slate-200 dark:border-white/10"
           />
           <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 hidden md:block">
             {user.displayName}
           </span>
            {role === 'admin' && (
              <button 
                onClick={onOpenAdmin}
                className="text-white bg-primary hover:bg-primary-dark transition-colors px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 shadow-md shadow-primary/20"
                title="관리자 페이지"
              >
                <span className="material-symbols-outlined text-[14px]">admin_panel_settings</span>
                Admin
              </button>
            )}
            
            {/* Expiration Display */}
            {dDay && role !== 'admin' && (
              <div className={`px-2.5 py-1 rounded-lg border text-[10px] font-black uppercase tracking-wide flex items-center gap-1.5 ${
                dDay === '만료됨' ? 'bg-rose-100 text-rose-600 border-rose-200' : 
                dDay === 'D-Day' || dDay.startsWith('D-3') || dDay.startsWith('D-2') || dDay.startsWith('D-1') ? 'bg-orange-100 text-orange-600 border-orange-200 animate-pulse' :
                'bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700'
              }`}>
                <span className="material-symbols-outlined text-[12px]">calendar_clock</span>
                {dDay}
              </div>
            )}

            <button 
              onClick={onLogout}
             className="text-slate-400 hover:text-rose-500 transition-colors flex items-center justify-center p-1.5 rounded-lg hover:bg-rose-500/10"
             title="로그아웃"
           >
             <span className="material-symbols-outlined text-[18px]">logout</span>
           </button>
        </div>
      )}
      <button 
        onClick={onToggleTheme}
        className="flex items-center justify-center size-10 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/5 text-slate-600 dark:text-slate-400 hover:text-primary dark:hover:text-accent-neon transition-all"
      >
        <span className="material-symbols-outlined">{theme === 'dark' ? 'light_mode' : 'dark_mode'}</span>
      </button>
      <span className="text-[9px] font-black text-slate-500 dark:text-slate-500 uppercase tracking-widest bg-slate-100 dark:bg-white/5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-white/5 flex items-center gap-2">
        <span className="size-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
        {region} 지역 • {count}개 바이럴 신호 감지
      </span>
    </div>
    </div>
  </header>
  );
};

const CATEGORIES = [
  { id: 'AI', name: 'IT/기술', icon: 'psychology', categoryId: '28' },
  { id: 'SENIOR', name: '생활/노하우', icon: 'elderly', categoryId: '26' },
  { id: 'MUSIC', name: '음악', icon: 'music_note', categoryId: '10' }
];

const DEFAULT_GROUPS: ChannelGroup[] = [
  { id: 'all', name: '전체' },
  { id: 'unassigned', name: '미지정' }
];

export default function App() {
  const { user, role, expiresAt, loading: authLoading, logout } = useAuth();

  const [videos, setVideos] = useState<VideoData[]>([]);
  // [Security Fix] Initialize with empty, load from user-specific storage later
  const [ytKey, setYtKey] = useState('');
  const [ytApiStatus, setYtApiStatus] = useState<'idle' | 'valid' | 'invalid' | 'loading'>('idle');
  const [region, setRegion] = useState('KR');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [timeRange, setTimeRange] = useState(7);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  
  const [hasPendingSync, setHasPendingSync] = useState(() => localStorage.getItem('yt_pending_sync') === 'true');
  const [isSyncNoticeDismissed, setIsSyncNoticeDismissed] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('theme') as 'dark' | 'light') || 'dark');

  const [groups, setGroups] = useState<ChannelGroup[]>(DEFAULT_GROUPS);
  const [activeGroupId, setActiveGroupId] = useState('all');
  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [movingGroupId, setMovingGroupId] = useState<string | null>(null);
  const [individualMovingChannelId, setIndividualMovingChannelId] = useState<string | null>(null);

  const [savedChannels, setSavedChannels] = useState<SavedChannel[]>([]);
  
  const [isMyMode, setIsMyMode] = useState(true);
  const [isExplorerMode, setIsExplorerMode] = useState(false);
  const [isUsageMode, setIsUsageMode] = useState(false);
  const [channelInput, setChannelInput] = useState('');
  const [explorerQuery, setExplorerQuery] = useState('');
  const [explorerResults, setExplorerResults] = useState<SavedChannel[]>([]);
  const [explorerStaging, setExplorerStaging] = useState<SavedChannel[]>([]);
  const [explorerTargetGroupId, setExplorerTargetGroupId] = useState('unassigned');
  const [isExplorerSearching, setIsExplorerSearching] = useState(false);
  const [commitMessage, setCommitMessage] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<{ added: number; duplicates: string[] } | null>(null);
  
  const [channelFilterQuery, setChannelFilterQuery] = useState('');
  const [channelSortMode, setChannelSortMode] = useState<'latest' | 'name'>('latest');

  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isChannelListExpanded, setIsChannelListExpanded] = useState(false);

  const [usage, setUsage] = useState<ApiUsage>(getApiUsage());

  const isApiKeyMissing = useMemo(() => !ytKey || ytApiStatus !== 'valid', [ytKey, ytApiStatus]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { all: savedChannels.length };
    savedChannels.forEach(c => {
      const gid = c.groupId || 'unassigned';
      counts[gid] = (counts[gid] || 0) + 1;
    });
    return counts;
  }, [savedChannels]);

  const currentGroupChannels = useMemo(() => {
    let channels = activeGroupId === 'all' 
      ? savedChannels 
      : savedChannels.filter(c => (c.groupId || 'unassigned') === activeGroupId);

    if (channelFilterQuery.trim()) {
      channels = channels.filter(ch => ch.title.toLowerCase().includes(channelFilterQuery.toLowerCase()));
    }
    
    if (channelSortMode === 'name') {
      return [...channels].sort((a, b) => a.title.localeCompare(b.title));
    }
    // Default 'latest' is roughly array order (newest first)
    return channels;
  }, [savedChannels, activeGroupId, channelFilterQuery, channelSortMode]);

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('yt_pending_sync', hasPendingSync.toString());
  }, [hasPendingSync]);

  useEffect(() => {
    const handleUsageUpdate = (e: any) => setUsage(e.detail);
    window.addEventListener('yt-api-usage-updated', handleUsageUpdate);
    return () => window.removeEventListener('yt-api-usage-updated', handleUsageUpdate);
  }, []);

  useEffect(() => {
    let isActive = true;
    const validateYtKey = async () => {
      if (!ytKey) {
        setYtApiStatus('idle');
        return;
      }
      
      if (ytKey.length < 20) {
        setYtApiStatus('invalid');
        return;
      }

      setYtApiStatus('loading');
      try {
        const res = await fetch(`https://www.googleapis.com/youtube/v3/videoCategories?part=snippet&regionCode=KR&key=${ytKey}`);
        const data = await res.json();
        if (!isActive) return;
        
        if (data.error) throw new Error();
        setYtApiStatus('valid');
      } catch {
        if (!isActive) return;
        setYtApiStatus('invalid');
      }
    };
    
    // Debounce slightly to avoid rapid flashing
    const timer = setTimeout(() => {
      validateYtKey();
    }, 500);

    return () => {
      isActive = false;
      clearTimeout(timer);
    };
  }, [ytKey]);

  // [Security Fix] Load/Save User-Specific Settings
  useEffect(() => {
    if (user) {
      // Load settings specific to this user
      const savedKey = localStorage.getItem(`yt_api_key_${user.uid}`);
      const savedRegion = localStorage.getItem(`yt_region_${user.uid}`);
      
      if (savedKey) setYtKey(savedKey);
      else setYtKey(''); // Reset if new user has no key
      
      if (savedRegion) setRegion(savedRegion);
    } else {
      // Clear sensitive data on logout
      setYtKey('');
      setRegion('KR');
    }
  }, [user]);

  useEffect(() => {
    if (user) {
      // Save settings specific to this user
      if (ytKey) localStorage.setItem(`yt_api_key_${user.uid}`, ytKey);
      else localStorage.removeItem(`yt_api_key_${user.uid}`);
      
      if (region) localStorage.setItem(`yt_region_${user.uid}`, region);
    }
  }, [ytKey, region, user]);

  useEffect(() => {
    if (user) {
      const loadUserData = async () => {
        try {
          const dbGroups = await getGroupsFromDb(user.uid);
          if (dbGroups.length > 0) setGroups(dbGroups);
          else {
            // Initial save of default groups for new user
            DEFAULT_GROUPS.forEach(g => saveGroupToDb(user.uid, g));
          }
          const dbChannels = await getChannelsFromDb(user.uid);
          setSavedChannels(dbChannels);
        } catch (e) {
          console.error("Failed to load user data", e);
        }
      };
      loadUserData();
    }
  }, [user]);

  if (authLoading) return <div className="min-h-screen bg-black flex items-center justify-center text-white">Loading...</div>;
  if (!user) return <Login />;

  useEffect(() => {
    if (ytKey && ytKey.length > 20 && ytApiStatus === 'valid' && !isExplorerMode && !isUsageMode) {
      if (!isMyMode || !hasPendingSync) {
        loadVideos();
      }
    }
  }, [ytKey, region, selectedCategory, timeRange, isMyMode, activeGroupId, ytApiStatus, isExplorerMode, isUsageMode, hasPendingSync]);

  const loadVideos = async (force: boolean = false) => {
    if (!ytKey || ytApiStatus !== 'valid') {
      setApiError("YouTube API 키가 유효하지 않거나 설정되지 않았습니다.");
      return;
    }
    
    setLoading(true);
    setApiError(null);
    if (force) {
      setHasPendingSync(false);
      setIsSyncNoticeDismissed(false);
    }
    
    try {
      let targetChannelIds: string[] = [];
      if (isMyMode) {
        targetChannelIds = currentGroupChannels.map(c => c.id);
        if (targetChannelIds.length === 0) {
          setVideos([]);
          setLoading(false);
          return;
        }
      }
      
      const catObj = CATEGORIES.find(c => c.id === selectedCategory);
      const categoryId = !isMyMode && catObj ? catObj.categoryId : "";
      
      const data = await fetchRealVideos(ytKey, "", region, timeRange, targetChannelIds, categoryId, force);
      setVideos(data);
    } catch (e: any) {
      setApiError(e.message || "영상 로딩 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const handleExport = () => {
    const data = JSON.stringify({ savedChannels, groups }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `backup_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        if (json.savedChannels) setSavedChannels(json.savedChannels);
        if (json.groups) setGroups(json.groups);
        alert("성공적으로 복원되었습니다.");
      } catch (err) {
        alert("올바르지 않은 파일 형식입니다.");
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleAddChannelBatch = async () => {
    if (isApiKeyMissing) return alert("유효한 YouTube API 키를 먼저 설정하세요.");
    if (!channelInput.trim()) return;
    
    const queries = channelInput.split(/[\s,\n]+/).filter(q => q.trim().length > 0);
    setLoading(true);
    const newChannels: SavedChannel[] = [];
    const duplicates: string[] = [];
    const existingIds = new Set(savedChannels.map(c => c.id));
    const targetGroupId = (activeGroupId === 'all') ? 'unassigned' : activeGroupId;

    for (let i = 0; i < queries.length; i++) {
      setBatchStatus(`${queries.length}개 중 ${i + 1}번째 처리 중...`);
      const infoFinal = await getChannelInfo(ytKey, queries[i]);
      
      if (infoFinal) {
        if (existingIds.has(infoFinal.id)) {
          duplicates.push(infoFinal.title);
        } else {
          const newChannel = { ...infoFinal, groupId: targetGroupId };
          newChannels.push(newChannel);
          existingIds.add(infoFinal.id);
          if (user) await saveChannelToDb(user.uid, newChannel);
        }
      }
    }

    if (newChannels.length > 0) {
      setSavedChannels(prev => [...newChannels, ...prev]);
      setHasPendingSync(true);
      setIsSyncNoticeDismissed(false);
    }
    
    setChannelInput('');
    setBatchStatus(null);
    setLoading(false);

    setBatchResult({ added: newChannels.length, duplicates });
  };

  const handleExplorerSearch = async () => {
    if (isApiKeyMissing) return alert("유효한 YouTube API 키를 먼저 설정하세요.");
    if (!explorerQuery.trim()) return;
    
    setIsExplorerSearching(true);
    try {
      const results = await searchChannelsByKeyword(ytKey, explorerQuery);
      setExplorerResults(results);
    } catch (e) {
      alert("검색 중 오류가 발생했습니다.");
    } finally {
      setIsExplorerSearching(false);
    }
  };

  const toggleExplorerStaging = (ch: SavedChannel) => {
    const isInStaging = explorerStaging.some(s => s.id === ch.id);
    if (isInStaging) {
      setExplorerStaging(prev => prev.filter(s => s.id !== ch.id));
    } else {
      setExplorerStaging(prev => [...prev, ch]);
    }
  };

  const commitStagingToSaved = () => {
    if (explorerStaging.length === 0) return;
    const existingIds = new Set(savedChannels.map(c => c.id));
    const targetGroupId = explorerTargetGroupId;
    const newChannels = explorerStaging
      .filter(ch => !existingIds.has(ch.id))
      .map(ch => ({ ...ch, groupId: targetGroupId }));
      
    if (newChannels.length > 0) {
      setSavedChannels(prev => [...newChannels, ...prev]);
      if (user) batchSaveChannels(user.uid, newChannels);
      
      setHasPendingSync(true);
      setIsSyncNoticeDismissed(false);
      setCommitMessage(`${newChannels.length}개의 채널이 추가되었습니다.`);
      setTimeout(() => setCommitMessage(null), 3000);
    } else {
      setCommitMessage("이미 추가된 채널입니다.");
      setTimeout(() => setCommitMessage(null), 3000);
    }
    setExplorerStaging([]);
  };

  const handleSaveNewGroup = () => {
    if (newGroupName.trim()) {
      const newGroup = { id: Date.now().toString(), name: newGroupName.trim() };
      setGroups(prev => [...prev, newGroup]);
      if (user) saveGroupToDb(user.uid, newGroup);
      setNewGroupName('');
      setIsAddingGroup(false);
      setActiveGroupId(newGroup.id);
    }
  };

  const startRenameGroup = (e: React.MouseEvent, id: string, currentName: string) => {
    e.preventDefault(); e.stopPropagation();
    setEditingGroupId(id);
    setEditingGroupName(currentName);
  };

  const saveRenameGroup = () => {
    if (editingGroupId && editingGroupName.trim()) {
      const updatedGroup = { id: editingGroupId, name: editingGroupName.trim() };
      setGroups(prev => prev.map(g => g.id === editingGroupId ? updatedGroup : g));
      if (user) saveGroupToDb(user.uid, updatedGroup);
      setEditingGroupId(null);
      setEditingGroupName('');
    }
  };

  const executeBulkMove = (groupId: string) => {
    if (selectedChannelIds.length === 0) return;
    const ids = selectedChannelIds;
    setSavedChannels(prev => prev.map(c => {
      if (ids.includes(c.id)) {
        const updated = { ...c, groupId };
        if (user) saveChannelToDb(user.uid, updated);
        return updated;
      }
      return c;
    }));
    setSelectedChannelIds([]);
    setMovingGroupId(null);
    setHasPendingSync(true);
    setIsSyncNoticeDismissed(false);
  };

  const executeIndividualMove = (channelId: string, groupId: string) => {
    setSavedChannels(prev => prev.map(c => {
      if (c.id === channelId) {
        const updated = { ...c, groupId };
        if (user) saveChannelToDb(user.uid, updated);
        return updated;
      }
      return c;
    }));
    setIndividualMovingChannelId(null);
    setHasPendingSync(true);
    setIsSyncNoticeDismissed(false);
  };

  const toggleChannelSelection = (id: string) => {
    setSelectedChannelIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleSelectAllInCurrentGroup = () => {
    const allIds = currentGroupChannels.map(c => c.id);
    const areAllSelected = allIds.every(id => selectedChannelIds.includes(id));
    if (areAllSelected) {
      setSelectedChannelIds(prev => prev.filter(id => !allIds.includes(id)));
    } else {
      setSelectedChannelIds(prev => Array.from(new Set([...prev, ...allIds])));
    }
  };

  const handleDeleteGroup = (e: React.MouseEvent, groupId: string) => {
    e.preventDefault(); e.stopPropagation();
    if (groupId === 'all' || groupId === 'unassigned') return;
    if (window.confirm("그룹을 삭제하시겠습니까?")) {
      setSavedChannels(prev => prev.map(c => {
        if (c.groupId === groupId) {
          const updated = { ...c, groupId: 'unassigned' };
          if (user) saveChannelToDb(user.uid, updated);
          return updated;
        }
        return c;
      }));
      setGroups(prev => prev.filter(g => g.id !== groupId));
      if (user) deleteGroupFromDb(user.uid, groupId);
      if (activeGroupId === groupId) setActiveGroupId('all');
      setEditingGroupId(null);
      setHasPendingSync(true);
      setIsSyncNoticeDismissed(false);
    }
  };

  // ---------------------------------------------------------------------------
  // [Gatekeeper] 인증 상태 체크 (로그인 안 된 경우 차단)
  // ---------------------------------------------------------------------------
  if (authLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="size-10 border-4 border-white/20 border-t-white rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  // [RBAC] 승인 대기 상태 체크
  if (role === 'pending') {
    return <PendingApproval />;
  }

  // [Expiration] 만료 체크 (관리자는 제외)
  if (role !== 'admin' && expiresAt && new Date(expiresAt) < new Date()) {
    return (
      <div className="min-h-screen bg-black text-white flex flex-col items-center justify-center p-4">
        <div className="max-w-md w-full bg-gray-900 rounded-2xl p-8 border border-gray-800 text-center shadow-2xl">
          <div className="mb-6 flex justify-center">
             <div className="size-16 bg-rose-500/10 rounded-full flex items-center justify-center border border-rose-500/20">
               <span className="material-symbols-outlined text-3xl text-rose-500">event_busy</span>
             </div>
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">이용 기간 만료</h1>
          <p className="text-gray-400 mb-6 text-sm">
            서비스 이용 기간이 만료되었습니다.<br/>
            관리자에게 문의하여 기간을 연장해주세요.
          </p>
          <div className="bg-gray-800/50 rounded-lg p-3 mb-8">
            <div className="text-xs text-slate-500 uppercase font-bold mb-1">만료일</div>
            <div className="text-lg font-mono text-white">{new Date(expiresAt).toLocaleDateString()}</div>
          </div>
          <button onClick={logout} className="w-full bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-xl transition-all flex items-center justify-center gap-2">
            <span className="material-symbols-outlined text-lg">logout</span>
            로그아웃
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-background-dark text-slate-900 dark:text-slate-100 font-display transition-colors duration-300">
      <Sidebar 
        ytKey={ytKey} onYtKeyChange={setYtKey} ytApiStatus={ytApiStatus}
        region={region} onRegionChange={(val) => { setLoading(true); setVideos([]); setRegion(val); }}
        selectedCategory={selectedCategory} onCategoryChange={(val) => { setLoading(true); setVideos([]); setSelectedCategory(val); }}
        isMyMode={isMyMode} onToggleMyMode={(val) => { if(val) { setLoading(true); setVideos([]); } setIsMyMode(val); }}
        isExplorerMode={isExplorerMode} onToggleExplorerMode={setIsExplorerMode}
        isUsageMode={isUsageMode} onToggleUsageMode={setIsUsageMode}
        hasPendingSync={hasPendingSync}
        isSyncNoticeDismissed={isSyncNoticeDismissed}
        isApiKeyMissing={isApiKeyMissing}
        usage={usage}
      />
      
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <Header 
          region={region} 
          count={videos.length} 
          theme={theme} 
          onToggleTheme={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
          hasPendingSync={hasPendingSync && !isSyncNoticeDismissed}
          isApiKeyMissing={isApiKeyMissing}
          onDismissSync={() => setIsSyncNoticeDismissed(true)}
          user={user}
          role={role}
          expiresAt={expiresAt}
          onLogout={logout}
          onOpenAdmin={() => setIsAdminOpen(true)}
        />
        
        {isAdminOpen && role === 'admin' && <AdminDashboard onClose={() => setIsAdminOpen(false)} />}
        
        <div className="flex-1 overflow-y-auto p-6 md:p-10 space-y-8 custom-scrollbar scroll-smooth">
          
          {isUsageMode ? (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
              <div className="bg-white dark:bg-slate-card/60 border border-slate-200 dark:border-slate-800 p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-10 opacity-5 pointer-events-none">
                  <span className="material-symbols-outlined text-[150px] text-primary">analytics</span>
                </div>

                <div className="space-y-4 max-w-2xl">
                  <h2 className="text-3xl font-black italic tracking-tighter text-primary uppercase flex items-center gap-4">
                    <span className="material-symbols-outlined text-4xl">dashboard_customize</span>
                    API 사용량 대시보드
                  </h2>
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium leading-relaxed">
                    실시간으로 YouTube API 할당량(Quota) 소모 상태를 모니터링합니다. <br />
                    구글 개발자 콘솔의 실제 사용량과는 소폭 차이가 있을 수 있으므로, <b>참고용</b>으로만 활용해 주세요.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-12">
                  <div className="bg-slate-50 dark:bg-black/20 p-8 rounded-3xl border border-slate-100 dark:border-white/5 space-y-6">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">오늘의 잔량</span>
                      <span className="material-symbols-outlined text-emerald-500">check_circle</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-4xl font-black text-slate-900 dark:text-white tabular-nums tracking-tighter">
                        {isApiKeyMissing ? '0' : (usage.total - usage.used).toLocaleString()}
                      </p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">잔여 LP / 10,000</p>
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-black/20 p-8 rounded-3xl border border-slate-100 dark:border-white/5 space-y-6">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">소모된 할당량</span>
                      <span className="material-symbols-outlined text-primary">data_usage</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-4xl font-black text-slate-900 dark:text-white tabular-nums tracking-tighter">
                        {isApiKeyMissing ? '0' : usage.used.toLocaleString()}
                      </p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">오늘 소모된 유닛</p>
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-black/20 p-8 rounded-3xl border border-slate-100 dark:border-white/5 space-y-6">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-black text-slate-400 uppercase tracking-widest">다음 초기화</span>
                      <span className="material-symbols-outlined text-accent-hot">schedule</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">
                        오늘 자정 (KST)
                      </p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">자동 리셋 주기</p>
                    </div>
                  </div>
                </div>

                <div className="mt-12 bg-primary/5 border border-primary/20 p-8 rounded-3xl space-y-6">
                  <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm">info</span>
                    유닛 소모 기준 (YouTube Data API v3)
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-white dark:bg-slate-900/50 p-5 rounded-2xl flex items-center justify-between shadow-sm border border-slate-100 dark:border-white/5">
                      <div className="flex items-center gap-4">
                        <div className="size-10 bg-emerald-500/10 rounded-xl flex items-center justify-center text-emerald-500">
                          <span className="material-symbols-outlined">search</span>
                        </div>
                        <div>
                          <p className="text-[11px] font-black dark:text-white text-slate-900">채널 검색</p>
                          <p className="text-[9px] font-bold text-slate-500">키워드 기반 대량 수집</p>
                        </div>
                      </div>
                      <span className="text-xs font-black text-emerald-500">-100 Units</span>
                    </div>
                    <div className="bg-white dark:bg-slate-900/50 p-5 rounded-2xl flex items-center justify-between shadow-sm border border-slate-100 dark:border-white/5">
                      <div className="flex items-center gap-4">
                        <div className="size-10 bg-primary/10 rounded-xl flex items-center justify-center text-primary">
                          <span className="material-symbols-outlined">reorder</span>
                        </div>
                        <div>
                          <p className="text-[11px] font-black dark:text-white text-slate-900">정보 로드</p>
                          <p className="text-[9px] font-bold text-slate-500">데이터 추출 및 분석</p>
                        </div>
                      </div>
                      <span className="text-xs font-black text-primary">-1 Unit</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium italic mt-4 text-center">
                    ※ 10,000 유닛은 구글에서 제공하는 무료 일일 한도이며, 소진 시 검색 및 새로고침 기능이 제한될 수 있습니다.
                  </p>
                </div>
                <div className="mt-6 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-3xl p-6">
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-4 px-2">API 호출 기록 (오늘)</h3>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                    {usage.logs && usage.logs.length > 0 ? (
                      usage.logs.map((log, index) => (
                        <div key={index} className="flex items-center justify-between text-[10px] p-2 bg-white dark:bg-slate-900 rounded-lg border border-slate-100 dark:border-white/5">
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-slate-400">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            <span className={`font-bold uppercase px-1.5 py-0.5 rounded ${log.type === 'search' ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' : 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'}`}>
                              {log.type === 'search' ? 'SEARCH' : 'LIST'}
                            </span>
                            <span className="text-slate-600 dark:text-slate-300 font-medium truncate max-w-[150px]">{log.details}</span>
                          </div>
                          <span className="font-black text-rose-500">-{log.cost}</span>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-slate-400 text-[10px] font-medium italic">
                        오늘 기록된 API 호출이 없습니다.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : isExplorerMode ? (
            <div className="space-y-8 animate-in slide-in-from-right-4 duration-500">
              <div className="bg-white dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 p-8 rounded-3xl space-y-6 shadow-xl">
                <div className="space-y-2">
                  <h2 className="text-2xl font-black italic tracking-tighter text-emerald-500 uppercase flex items-center gap-3">
                    <span className="material-symbols-outlined">search_insights</span>
                    키워드 검색 채널 수집
                  </h2>
                  <p className="text-slate-500 text-[11px] font-medium leading-relaxed">
                    키워드로 새로운 유튜브 채널을 발굴하세요. <b>한 번의 검색으로 50개의 채널</b>을 탐색할 수 있습니다.<br />
                    아래 결과에서 선택하여 검토 영역에 담은 후, <span className="text-emerald-500 font-bold">내 모니터링 리스트</span>에 일괄 추가하세요.
                  </p>
                </div>

                <div className="flex gap-3 bg-slate-50 dark:bg-black/20 p-4 rounded-2xl border border-slate-100 dark:border-white/5">
                  <div className="flex-1 flex items-center bg-white dark:bg-background-dark border border-slate-200 dark:border-slate-700 rounded-xl px-4 shadow-inner">
                    <span className="material-symbols-outlined text-slate-400 mr-3">search</span>
                    <input 
                      type="text"
                      value={explorerQuery}
                      onChange={(e) => setExplorerQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleExplorerSearch()}
                      placeholder="관심 있는 키워드 입력 (예: 재테크, 캠핑, 시니어...)"
                      className="w-full bg-transparent border-none py-3 text-xs text-slate-900 dark:text-white focus:ring-0 outline-none"
                    />
                  </div>
                  <button onClick={handleExplorerSearch} disabled={isExplorerSearching} className="bg-emerald-500 text-white px-8 h-12 rounded-xl text-xs font-black uppercase shadow-lg hover:scale-105 transition-all shrink-0 disabled:opacity-50">
                    {isExplorerSearching ? '탐색 중...' : '채널 검색'}
                  </button>
                </div>

                <div className={`bg-slate-50 dark:bg-white/5 border border-dashed rounded-3xl p-6 transition-all relative ${explorerStaging.length > 0 ? 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/5' : 'border-slate-200 dark:border-slate-800'}`}>
                   {commitMessage && (
                     <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[10px] font-black px-4 py-2 rounded-full shadow-2xl animate-in zoom-in-90 fade-in duration-300 z-50">
                        {commitMessage}
                     </div>
                   )}
                   <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                      <div className="space-y-1">
                        <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-400 flex items-center gap-2">
                           <span className="material-symbols-outlined text-sm">inventory_2</span>
                           선택된 채널 검토 ({explorerStaging.length}개)
                        </h3>
                        <p className="text-[10px] text-slate-400">추가하기 전 리스트를 확인하고 필요 없는 채널은 제외하세요.</p>
                      </div>
                      <div className="flex items-center gap-3">
                         <div className="flex items-center gap-2">
                            <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap">저장할 그룹:</span>
                            <select 
                                value={explorerTargetGroupId}
                                onChange={(e) => setExplorerTargetGroupId(e.target.value)}
                                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg pl-3 pr-8 py-2 text-[11px] font-bold outline-none focus:border-emerald-500 transition-colors cursor-pointer"
                            >
                                {groups.filter(g => g.id !== 'all').map(g => (
                                    <option key={g.id} value={g.id}>{g.name}</option>
                                ))}
                            </select>
                         </div>
                         <button onClick={() => setExplorerStaging([])} className="text-[10px] font-black uppercase text-slate-400 hover:text-rose-500 transition-colors px-3 py-2">전체 비우기</button>
                         <button 
                            onClick={commitStagingToSaved}
                            disabled={explorerStaging.length === 0}
                            className={`px-6 py-3 rounded-xl text-[11px] font-black uppercase shadow-lg transition-all ${
                               explorerStaging.length > 0 
                               ? 'bg-emerald-500 text-white hover:scale-105 active:scale-95' 
                               : 'bg-slate-200 dark:bg-slate-800 text-slate-400 grayscale cursor-not-allowed'
                            }`}
                         >
                            선택한 {explorerStaging.length}개 채널 모니터링 등록
                         </button>
                      </div>
                   </div>

                   {explorerStaging.length > 0 ? (
                      <div className="flex flex-wrap gap-3 mt-6 animate-in fade-in slide-in-from-top-2">
                         {explorerStaging.map(ch => (
                            <div key={ch.id} className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-emerald-500/20 px-2 py-1.5 rounded-xl shadow-sm group">
                               <img src={ch.thumbnail} className="size-6 rounded-full object-cover" alt="" />
                               <span className="text-[10px] font-bold truncate max-w-[100px]">{ch.title}</span>
                               <button onClick={() => toggleExplorerStaging(ch)} className="text-slate-400 hover:text-rose-500"><span className="material-symbols-outlined text-sm">close</span></button>
                            </div>
                         ))}
                      </div>
                   ) : (
                      <div className="mt-6 py-4 text-center border border-dashed border-slate-200 dark:border-slate-700 rounded-2xl">
                         <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter">아래 검색 결과에서 추가하고 싶은 채널의 [+] 버튼을 누르세요</p>
                      </div>
                   )}
                </div>

                {explorerResults.length > 0 && (
                  <div className="space-y-4 pt-4">
                    <div className="flex items-center justify-between px-1">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">검색 결과 ({explorerResults.length}/50)</span>
                      <p className="text-[9px] text-emerald-500 font-bold bg-emerald-500/10 px-2 py-1 rounded-full uppercase">API 효율 100% 최적화 모드</p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                      {explorerResults.map((ch) => {
                        const isInStaging = explorerStaging.some(s => s.id === ch.id);
                        const isAlreadySaved = savedChannels.some(sc => sc.id === ch.id);
                        return (
                          <div key={ch.id} className={`flex items-center gap-3 bg-slate-50 dark:bg-white/5 border p-3 rounded-2xl transition-all group ${isInStaging ? 'border-emerald-500 ring-1 ring-emerald-500/20' : 'border-slate-100 dark:border-white/5'}`}>
                            <div className="relative shrink-0">
                               <img src={ch.thumbnail} className="size-10 rounded-full border border-black/5 dark:border-white/10 object-cover" alt="" />
                               {isAlreadySaved && (
                                  <div className="absolute -bottom-1 -right-1 size-4 bg-primary text-white rounded-full flex items-center justify-center border-2 border-white dark:border-slate-card">
                                     <span className="material-symbols-outlined text-[10px] font-black">check</span>
                                  </div>
                               )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <h4 className="text-[11px] font-black text-slate-800 dark:text-slate-200 truncate leading-tight" title={ch.title}>{ch.title}</h4>
                              <p className="text-[8px] text-slate-400 uppercase tracking-tighter truncate">{isAlreadySaved ? '모니터링 중' : '탐색됨'}</p>
                            </div>
                            <button 
                              disabled={isAlreadySaved}
                              onClick={() => toggleExplorerStaging(ch)}
                              className={`size-8 rounded-lg flex items-center justify-center transition-all ${
                                isInStaging 
                                  ? 'bg-rose-500 text-white shadow-lg' 
                                  : isAlreadySaved 
                                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-400'
                                    : 'bg-white dark:bg-slate-800 text-slate-400 hover:text-emerald-500 border border-slate-200 dark:border-slate-700'
                              }`}
                            >
                              <span className="material-symbols-outlined text-sm font-black">{isInStaging ? 'remove' : isAlreadySaved ? 'done_all' : 'add'}</span>
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : isMyMode && (
            <div className="bg-white dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 p-8 rounded-3xl space-y-8 animate-in slide-in-from-top-4 duration-500 shadow-xl dark:shadow-2xl">
              <style>{`
                @keyframes neon-blink {
                  0%, 100% { box-shadow: 0 0 10px rgba(19, 55, 236, 0.4), 0 0 20px rgba(19, 55, 236, 0.2); border-color: rgba(19, 55, 236, 0.6); }
                  50% { box-shadow: 0 0 25px rgba(19, 55, 236, 0.8), 0 0 45px rgba(19, 55, 236, 0.4); border-color: rgba(19, 55, 236, 1); transform: scale(1.02); }
                }
                .neon-blink-btn {
                  animation: neon-blink 1.5s infinite ease-in-out;
                }
              `}</style>
              <div className="flex flex-col gap-6">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-2">
                    <h2 className="text-2xl font-black italic tracking-tighter text-slate-900 dark:text-white uppercase flex items-center gap-3">
                      <span className="material-symbols-outlined text-accent-hot">hub</span>
                      모니터링 허브
                    </h2>
                    <p className="text-slate-500 text-[11px] font-medium leading-relaxed">
                      모니터링할 유튜브 채널을 추가하세요. <br className="hidden md:block" />
                      추가된 채널들의 신규 영상은 <span className="text-accent-hot font-bold">실시간 통합 피드</span>에서 분석됩니다.
                    </p>
                  </div>
                  
                  <div className="flex items-center gap-3 relative">
                    {hasPendingSync && !isApiKeyMissing && !isSyncNoticeDismissed && (
                      <div className="absolute -top-14 right-0 bg-accent-hot text-white text-[10px] font-black px-4 py-2 rounded-xl shadow-[0_0_20px_rgba(255,0,85,0.4)] animate-bounce flex items-center gap-2 whitespace-nowrap z-50">
                        <span className="material-symbols-outlined text-sm animate-pulse">sync_problem</span>
                        내 모니터링 리스트 메뉴 에서 동기화 필요
                        <button onClick={() => setIsSyncNoticeDismissed(true)} className="ml-1 hover:opacity-70 transition-opacity p-0.5 leading-none"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        <div className="absolute -bottom-1.5 right-8 size-3 bg-accent-hot rotate-45"></div>
                      </div>
                    )}
                    <button onClick={handleExport} title="내보내기" className="size-10 bg-slate-100 dark:bg-slate-900 border border-black/5 dark:border-white/5 rounded-xl flex items-center justify-center text-slate-500 hover:text-accent-neon transition-all"><span className="material-symbols-outlined">download</span></button>
                    <button onClick={() => importInputRef.current?.click()} title="가져오기" className="size-10 bg-slate-100 dark:bg-slate-900 border border-black/5 dark:border-white/5 rounded-xl flex items-center justify-center text-slate-500 hover:text-accent-neon transition-all"><span className="material-symbols-outlined">upload_file</span></button>
                    <input type="file" ref={importInputRef} onChange={handleImport} accept=".json" className="hidden" />
                    <button 
                      onClick={() => loadVideos(true)} 
                      title="새로고침" 
                      className={`size-10 border rounded-xl flex items-center justify-center transition-all ${
                        hasPendingSync && !isApiKeyMissing && !isSyncNoticeDismissed
                        ? 'bg-accent-hot text-white border-transparent ring-4 ring-accent-hot/20 animate-pulse' 
                        : 'bg-slate-100 dark:bg-slate-900 border-black/5 dark:border-white/5 text-slate-500 hover:text-accent-neon'
                      }`}
                    >
                      <span className={`material-symbols-outlined ${loading ? 'animate-spin' : ''}`}>refresh</span>
                    </button>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row w-full gap-3 bg-slate-50 dark:bg-black/20 p-4 rounded-2xl border border-slate-100 dark:border-white/5">
                  <div className="flex-1 flex flex-col gap-2">
                    <textarea 
                      value={channelInput} onChange={(e) => setChannelInput(e.target.value)}
                      placeholder="채널 핸들(@), URL, 또는 채널 ID 입력 (여러 개 가능)..."
                      className="w-full bg-white dark:bg-background-dark border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-xs text-slate-900 dark:text-white focus:border-accent-neon outline-none transition-all shadow-inner resize-none h-12"
                    />
                    <p className="text-[9px] text-slate-400 dark:text-slate-500 font-bold px-1 uppercase tracking-tighter italic">※ 채널 주소 입력 시 자동으로 데이터가 수집 목록에 구성됩니다.</p>
                  </div>
                  <button onClick={handleAddChannelBatch} disabled={loading} className="bg-accent-hot text-white px-8 h-12 rounded-xl text-xs font-black uppercase shadow-lg hover:scale-105 transition-all shrink-0 disabled:opacity-50">
                    {loading ? '처리 중...' : '채널 추가'}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-slate-100 dark:border-white/5">
                {groups.map(group => (
                  <div key={group.id} className="relative group/tab">
                    {editingGroupId === group.id ? (
                      <div className="flex items-center gap-1 bg-primary/20 p-1.5 rounded-xl border border-primary">
                        <input autoFocus type="text" value={editingGroupName} onChange={(e) => setEditingGroupName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && saveRenameGroup()} className="bg-transparent border-none text-xs font-bold text-slate-900 dark:text-white w-28 px-2 focus:ring-0" />
                        <button onClick={saveRenameGroup} className="text-emerald-500"><span className="material-symbols-outlined text-sm">check</span></button>
                      </div>
                    ) : (
                      <div className="relative flex items-center">
                        <button 
                          onClick={() => setActiveGroupId(group.id)} 
                          className={`px-5 py-2.5 rounded-xl text-[11px] font-black uppercase transition-all flex items-center gap-2 ${
                            activeGroupId === group.id ? 'bg-primary text-white shadow-lg shadow-primary/20' : 'bg-slate-100 dark:bg-white/5 text-slate-500 hover:bg-slate-200 dark:hover:bg-white/10'
                          }`}
                        >
                          {group.name}
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-md ${activeGroupId === group.id ? 'bg-white/20' : 'bg-slate-200 dark:bg-slate-800'}`}>
                            {groupCounts[group.id] || 0}
                          </span>
                        </button>
                        {group.id !== 'all' && group.id !== 'unassigned' && (
                          <div className="absolute -top-2 -right-2 flex opacity-0 group-hover/tab:opacity-100 transition-all z-20">
                            <button onClick={(e) => startRenameGroup(e, group.id, group.name)} className="size-6 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center border border-black/5 dark:border-white/10 hover:bg-primary hover:text-white"><span className="material-symbols-outlined text-[12px]">edit</span></button>
                            <button onClick={(e) => handleDeleteGroup(e, group.id)} className="size-6 bg-white dark:bg-slate-800 rounded-full flex items-center justify-center border border-black/5 dark:border-white/10 hover:bg-rose-500 hover:text-white ml-1"><span className="material-symbols-outlined text-[12px]">delete</span></button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {!isAddingGroup ? (
                  <button onClick={() => setIsAddingGroup(true)} className="size-10 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-primary flex items-center justify-center transition-all border border-dashed border-slate-300 dark:border-slate-700 hover:border-primary"><span className="material-symbols-outlined">add</span></button>
                ) : (
                  <div className="flex items-center gap-1 bg-slate-100 dark:bg-white/5 p-1.5 rounded-xl border border-primary/30 animate-in slide-in-from-left-2 duration-200">
                    <input 
                      autoFocus 
                      type="text" 
                      value={newGroupName} 
                      onChange={(e) => setNewGroupName(e.target.value)} 
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleSaveNewGroup();
                        if (e.key === 'Escape') {
                          setIsAddingGroup(false);
                          setNewGroupName('');
                        }
                      }} 
                      placeholder="그룹명..."
                      className="bg-transparent border-none text-xs font-bold text-slate-900 dark:text-white w-24 px-2 focus:ring-0" 
                    />
                    <div className="flex items-center gap-0.5 px-1">
                      <button onClick={handleSaveNewGroup} className="text-emerald-500 hover:scale-110 transition-transform p-0.5" title="저장">
                        <span className="material-symbols-outlined text-sm font-black">check</span>
                      </button>
                      <button onClick={() => { setIsAddingGroup(false); setNewGroupName(''); }} className="text-slate-400 hover:text-rose-500 hover:scale-110 transition-all p-0.5" title="취소">
                        <span className="material-symbols-outlined text-sm font-black">close</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-1 gap-2 sm:gap-0">
                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <button 
                    onClick={handleSelectAllInCurrentGroup}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase text-slate-500 hover:text-primary transition-all shrink-0"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {currentGroupChannels.length > 0 && currentGroupChannels.every(c => selectedChannelIds.includes(c.id)) ? 'check_box' : 'check_box_outline_blank'}
                    </span>
                    {currentGroupChannels.length > 0 && currentGroupChannels.every(c => selectedChannelIds.includes(c.id)) ? '전체 해제' : '전체 선택'}
                  </button>

                  <div className="relative flex-1 sm:flex-initial">
                    <span className="absolute left-2.5 top-1/2 -translate-y-1/2 material-symbols-outlined text-[14px] text-slate-400">search</span>
                    <input 
                      type="text" 
                      value={channelFilterQuery}
                      onChange={(e) => setChannelFilterQuery(e.target.value)}
                      placeholder="채널 검색..." 
                      className="w-full sm:w-40 pl-8 pr-3 py-1.5 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg text-[11px] font-bold focus:ring-1 focus:ring-primary focus:border-primary transition-all text-slate-900 dark:text-white placeholder:text-slate-400"
                    />
                    {channelFilterQuery && (
                      <button 
                        onClick={() => setChannelFilterQuery('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500"
                      >
                        <span className="material-symbols-outlined text-[14px]">cancel</span>
                      </button>
                    )}
                  </div>

                  <button 
                    onClick={() => setChannelSortMode(prev => prev === 'latest' ? 'name' : 'latest')}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold text-slate-500 hover:text-primary transition-all shrink-0"
                    title={channelSortMode === 'latest' ? '최신순 (등록 역순)' : '이름순 (가나다)'}
                  >
                    <span className="material-symbols-outlined text-[16px]">{channelSortMode === 'latest' ? 'schedule' : 'sort_by_alpha'}</span>
                    <span className="hidden sm:inline">{channelSortMode === 'latest' ? '최신순' : '이름순'}</span>
                  </button>
                </div>
                
                {selectedChannelIds.length > 0 ? (
                  <p className="hidden sm:block text-[10px] font-black text-primary animate-pulse uppercase tracking-tighter ml-auto mr-4">
                    {selectedChannelIds.length}개 선택됨
                  </p>
                ) : null}

                <button 
                  onClick={() => setIsChannelListExpanded(!isChannelListExpanded)}
                  className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-primary transition-colors ml-auto sm:ml-0 bg-slate-100 dark:bg-white/5 px-3 py-1.5 rounded-lg shrink-0"
                >
                  <span className="material-symbols-outlined text-[16px]">{isChannelListExpanded ? 'expand_less' : 'expand_more'}</span>
                  {isChannelListExpanded ? '접기' : `전체 보기 (${currentGroupChannels.length})`}
                </button>
              </div>

              {selectedChannelIds.length > 0 && (
                <div className="flex items-center justify-between bg-primary/10 border border-primary/30 p-5 rounded-2xl animate-in fade-in slide-in-from-top-2 shadow-[0_0_20px_rgba(19,55,236,0.1)]">
                   <div className="flex items-center gap-4">
                      <div className="size-10 bg-primary text-white rounded-full flex items-center justify-center font-black text-sm shadow-lg shadow-primary/20">
                        {selectedChannelIds.length}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[11px] font-black text-primary uppercase leading-tight">개 채널 선택됨</span>
                        <button onClick={() => setSelectedChannelIds([])} className="text-[9px] font-bold text-slate-500 hover:text-rose-500 underline text-left">선택 취소</button>
                      </div>
                   </div>
                   <div className="flex items-center gap-3">
                      <div className="relative group/bulk">
                        <button 
                          onClick={() => setMovingGroupId(prev => prev === 'bulk' ? null : 'bulk')} 
                          className={`px-6 py-3 rounded-xl text-[11px] font-black uppercase transition-all flex items-center gap-3 border-2 neon-blink-btn ${
                            movingGroupId === 'bulk' 
                            ? 'bg-primary text-white border-primary shadow-xl scale-105' 
                            : 'bg-primary text-white border-primary shadow-lg shadow-primary/40'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[18px]">move_group</span>
                          선택한 그룹으로 이동
                        </button>
                        {movingGroupId === 'bulk' && (
                          <div className="absolute right-0 top-full mt-3 bg-white dark:bg-slate-card border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-50 p-3 min-w-[180px] animate-in zoom-in-95 fade-in">
                            <p className="text-[10px] font-black text-slate-400 uppercase p-1.5 border-b border-slate-100 dark:border-white/5 mb-2 flex items-center gap-2">
                              <span className="material-symbols-outlined text-[14px]">low_priority</span>
                              이동할 그룹 선택
                            </p>
                            <div className="space-y-1">
                              {groups.filter(g => g.id !== 'all').map(g => (
                                <button 
                                  key={g.id} 
                                  onClick={() => executeBulkMove(g.id)}
                                  className="w-full text-left px-3 py-2 text-[11px] font-bold hover:bg-primary hover:text-white rounded-xl transition-all"
                                >
                                  {g.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      <button onClick={() => {
                        if(window.confirm(`${selectedChannelIds.length}개 채널을 삭제하시겠습니까?`)) {
                          setSavedChannels(prev => prev.filter(c => !selectedChannelIds.includes(c.id)));
                          setSelectedChannelIds([]);
                        }
                      }} className="size-12 bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-xl flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all">
                        <span className="material-symbols-outlined">delete</span>
                      </button>
                   </div>
                </div>
              )}

               <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 pt-2 transition-all duration-500 ease-in-out ${isChannelListExpanded ? 'opacity-100' : 'opacity-100'}`}>
                {currentGroupChannels.slice(0, isChannelListExpanded ? undefined : 6).map((ch) => {
                  const isSelected = selectedChannelIds.includes(ch.id);
                  return (
                    <div 
                      key={ch.id} 
                      className={`group/chip relative flex items-center gap-3 bg-slate-50 dark:bg-white/5 border pl-2 pr-4 py-2 rounded-2xl transition-all ${
                        isSelected ? 'border-primary ring-1 ring-primary/30 bg-primary/5 dark:bg-primary/5' : 'border-slate-100 dark:border-white/5 hover:bg-slate-100 dark:hover:bg-white/10'
                      }`}
                    >
                      <button 
                        onClick={() => toggleChannelSelection(ch.id)}
                        className={`absolute -top-1.5 -left-1.5 z-30 size-6 rounded-full flex items-center justify-center transition-all ${
                          isSelected ? 'bg-primary text-white scale-110 opacity-100' : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-400 opacity-0 group-hover/chip:opacity-100 hover:text-primary shadow-sm'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[14px] font-black">{isSelected ? 'check' : 'check_box_outline_blank'}</span>
                      </button>

                      <img src={ch.thumbnail} className="size-8 rounded-full border border-black/5 dark:border-white/10 object-cover" alt="" />
                      <div className="flex flex-col flex-1 min-w-0 pr-6">
                        <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 line-clamp-2 leading-tight tracking-tight w-full" title={ch.title}>{ch.title}</span>
                        <span className="text-[9px] font-black text-slate-400 dark:text-slate-600 uppercase -mt-0.5">{groups.find(g => g.id === (ch.groupId || 'unassigned'))?.name}</span>
                      </div>

                      <div className="absolute right-2 opacity-0 group-hover/chip:opacity-100 transition-opacity">
                        <div className="relative">
                          <button 
                            onClick={(e) => { e.stopPropagation(); setIndividualMovingChannelId(prev => prev === ch.id ? null : ch.id); }}
                            className={`transition-colors ${individualMovingChannelId === ch.id ? 'text-primary' : 'text-slate-400 hover:text-primary'}`}
                            title="그룹 이동"
                          >
                            <span className="material-symbols-outlined text-[18px]">move_group</span>
                          </button>
                          {individualMovingChannelId === ch.id && (
                            <div className="absolute right-0 top-full mt-2 bg-white dark:bg-slate-card border border-slate-200 dark:border-slate-800 rounded-xl shadow-2xl z-50 p-2 min-w-[140px] animate-in zoom-in-95 fade-in">
                              <p className="text-[9px] font-black text-slate-400 uppercase p-1 border-b border-slate-100 dark:border-white/5 mb-1">이동할 그룹 선택</p>
                              {groups.filter(g => g.id !== 'all').map(g => (
                                <button 
                                  key={g.id} 
                                  onClick={() => executeIndividualMove(ch.id, g.id)}
                                  className="w-full text-left px-2 py-1.5 text-[10px] font-bold hover:bg-primary/10 hover:text-primary rounded-lg transition-colors"
                                >
                                  {g.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <button 
                          onClick={(e) => { e.stopPropagation(); setSavedChannels(prev => prev.filter(c => c.id !== ch.id)); }}
                          className="text-slate-400 hover:text-rose-500"
                        >
                          <span className="material-symbols-outlined text-[18px]">close</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {!isExplorerMode && !isUsageMode && (
            <>
              <div className="flex flex-col gap-3">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-2xl font-black tracking-tighter uppercase italic dark:text-white text-slate-900 flex items-center gap-3">
                      <span className={`size-3 rounded-full animate-pulse ${isApiKeyMissing ? 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.8)]' : isMyMode ? (hasPendingSync && !isSyncNoticeDismissed ? 'bg-accent-hot shadow-[0_0_12px_#ff0055]' : 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.8)]') : 'bg-primary'}`}></span>
                      {isMyMode ? '실시간 통합 피드' : '트렌드 분석'}
                    </h2>
                    {!isMyMode && (
                      <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium ml-6 animate-in slide-in-from-left-2 fade-in">
                        단순 조회수 순위가 아닙니다. <span className="text-primary font-bold">현재 YouTube 알고리즘의 선택</span>(급상승/바이럴)을 받은 영상을 우선적으로 분석한 결과입니다.
                      </p>
                    )}
                  </div>
                  
                  <div className="flex bg-slate-100 dark:bg-white/5 p-1 rounded-xl border border-slate-200 dark:border-white/5">
                    {[3, 5, 7].map(d => (
                      <button
                        key={d}
                        onClick={() => setTimeRange(d)}
                        className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${timeRange === d ? 'bg-white dark:bg-slate-800 text-primary shadow-sm' : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'}`}
                      >
                        {d}일
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <section className="flex flex-col gap-6">
                {isApiKeyMissing ? (
                   <div className="py-32 text-center border border-dashed border-rose-500/50 rounded-3xl bg-rose-500/[0.02] shadow-sm flex flex-col items-center gap-5 animate-in slide-in-from-bottom-4">
                      <div className="size-20 bg-rose-500/10 rounded-full flex items-center justify-center animate-pulse">
                         <span className="material-symbols-outlined text-rose-500 text-5xl">key</span>
                      </div>
                      <div className="space-y-2">
                        <p className="text-slate-900 dark:text-white text-base font-black uppercase tracking-tighter">YouTube API 키 설정이 필요합니다</p>
                        <p className="text-slate-500 dark:text-slate-400 text-[11px] font-medium">데이터를 분석하려면 사이드바 하단 'API 설정'에 키를 입력하세요.</p>
                      </div>
                      <p className="text-[10px] text-rose-400 font-bold uppercase tracking-widest bg-rose-500/10 px-4 py-2 rounded-full border border-rose-500/20">
                         사이드바 입력창이 주황색으로 깜빡이고 있습니다
                      </p>
                   </div>
                ) : apiError ? (
                   <div className="py-16 text-center border border-rose-200 dark:border-rose-900/50 bg-rose-50 dark:bg-rose-950/20 rounded-3xl space-y-4">
                      <span className="material-symbols-outlined text-4xl text-rose-500">error</span>
                      <p className="text-rose-700 dark:text-rose-200 font-bold text-sm">{apiError}</p>
                   </div>
                ) : (
                  <>
                    {loading && !batchStatus ? (
                      <div className="py-32 flex flex-col items-center justify-center gap-5 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-white dark:bg-slate-900/5 shadow-sm">
                        <div className="size-12 border-2 border-primary/20 border-t-primary rounded-full animate-spin"></div>
                        <p className="text-slate-400 dark:text-slate-600 text-xs font-black uppercase tracking-widest animate-pulse">Scanning Network for Signals...</p>
                      </div>
                    ) : videos.length > 0 ? (
                      <div className="space-y-6">
                        {videos.map((video) => <VideoCard key={video.id} video={video} />)}
                      </div>
                    ) : (
                      <div className="py-32 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-white dark:bg-slate-900/10 shadow-sm flex flex-col items-center gap-4">
                        <span className="material-symbols-outlined text-slate-200 dark:text-slate-800 text-6xl">analytics</span>
                        <p className="text-slate-400 dark:text-slate-500 text-sm font-bold">감지된 바이럴 신호가 없습니다.</p>
                      </div>
                    )}
                  </>
                )}
              </section>
            </>
          )}
        </div>
      </main>

      {/* Batch Result Modal */}
      {batchResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
            <div className="text-center space-y-2">
              <div className="size-16 bg-emerald-500/10 text-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <span className="material-symbols-outlined text-4xl">check_circle</span>
              </div>
              <h3 className="text-xl font-black text-slate-900 dark:text-white">처리 완료</h3>
              <p className="text-xs text-slate-500 font-medium">채널 등록 요청이 성공적으로 처리되었습니다.</p>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 bg-slate-50 dark:bg-white/5 rounded-2xl">
                <span className="text-xs font-bold text-slate-500">신규 추가</span>
                <span className="text-sm font-black text-emerald-500">{batchResult.added}건</span>
              </div>
              <div className="flex flex-col gap-2 p-4 bg-slate-50 dark:bg-white/5 rounded-2xl">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">중복 제외</span>
                  <span className="text-sm font-black text-orange-500">{batchResult.duplicates.length}건</span>
                </div>
                {batchResult.duplicates.length > 0 && (
                  <div className="text-[10px] text-slate-400 font-medium bg-white dark:bg-black/20 p-2 rounded-lg border border-slate-200 dark:border-white/5 max-h-24 overflow-y-auto custom-scrollbar">
                    {batchResult.duplicates.join(', ')}
                  </div>
                )}
              </div>
            </div>

            <button 
              onClick={() => setBatchResult(null)}
              className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-3.5 rounded-xl text-sm font-bold hover:scale-[1.02] transition-transform"
            >
              확인
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

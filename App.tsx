
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { doc, getDoc, onSnapshot, collection, query, where, orderBy, limit } from 'firebase/firestore'; 
import { MOCK_VIDEOS, MOCK_STATS, NETWORK_VELOCITY_DATA } from './constants';
import { getApiUsage, resetQuota, trackUsage } from './services/usageService';
import { db } from './src/lib/firebase';
import { useAuth } from './src/contexts/AuthContext';
import { Login } from './src/components/Login';
import { PendingApproval } from './src/components/PendingApproval';
import { AdminDashboard } from './src/components/AdminDashboard';
import { UserRole } from './src/contexts/AuthContext';
import { GuestNoticeModal } from './src/components/GuestNoticeModal';
import { MembershipWelcomeModal } from './src/components/MembershipWelcomeModal';
import { MyPageModal } from './src/components/MyPageModal';
import { 
  getChannelInfo, 
  fetchRealVideos,
  searchChannelsByKeyword,
  autoDetectShortsChannels,
  cleanupOldCaches,
  getCategoryName
} from './services/youtubeService';
import { analyzeVideoVirality } from './services/geminiService';
import { MembershipPage } from './src/components/MembershipPage';
import { RecommendedPackageList } from './src/components/RecommendedPackageList';
import { 
  saveChannelToDb,
  removeChannelFromDb,
  getChannelsFromDb,
  saveGroupToDb,
  deleteGroupFromDb,
  getGroupsFromDb,
  batchSaveChannels,
  getPackagesFromDb,
  savePackageToDb,
  getTopicsFromDb,
  getNotifications,
  markNotificationAsRead,
  sendNotification,
  deleteNotification,
  subscribeToUsage,
  updateUsageInDb
} from './services/dbService';
import { VideoData, AnalysisResponse, ChannelGroup, SavedChannel, ViralStat, ApiUsage, ApiUsageLog, RecommendedPackage, Notification as AppNotification } from './types';
import type { AutoDetectResult } from './services/youtubeService';
import { PaymentResult } from './src/components/PaymentResult';
import { ComparisonView } from './src/components/ComparisonView';
import { VideoDetailModal } from './src/components/VideoDetailModal';
import { ChannelRadar } from './src/components/ChannelRadar';
import { Footer } from './src/components/Footer';
import { MaterialsExplorer } from './src/components/MaterialsExplorer';
import { ScriptExtractor } from './src/components/ScriptExtractor';


const NEW_CHANNEL_THRESHOLD = 48 * 60 * 60 * 1000; // 48 hours

const formatNumber = (num: number) => {
// ... (omitted)
// I can't skip separate lines in one replacement block easily if they are far apart.
// I will split.
// Imports are ~ line 36.
// UseEffect is ~ line 1340.
// I will do Imports FIRST.

  if (num >= 100000000) return (num / 100000000).toFixed(1) + "억";
  if (num >= 10000) return (num / 10000).toFixed(1) + "만";
  return num.toLocaleString();
};

const getTimeAgo = (date: string) => {
  const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + "년 전";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + "달 전";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + "일 전";
  interval = seconds / 3600;
  return "방금 전";
};

// --- 서브 컴포넌트 ---

interface RestrictedOverlayProps {
  onCheckStatus: () => void;
  onSubscribe: () => void;
}

const RestrictedOverlay: React.FC<RestrictedOverlayProps> = ({ onCheckStatus, onSubscribe }) => (
  <div className="absolute inset-0 z-50 bg-white/60 dark:bg-slate-900/60 backdrop-blur-md flex items-center justify-center rounded-3xl">
     <div className="text-center p-8 bg-white dark:bg-slate-800 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-sm mx-4 animate-in zoom-in duration-300">
        <div className="size-16 rounded-full bg-rose-100 dark:bg-rose-900/30 text-rose-500 mx-auto mb-4 flex items-center justify-center shadow-inner">
           <span className="material-symbols-outlined text-3xl">lock</span>
        </div>
        <h3 className="text-xl font-black text-slate-900 dark:text-white mb-2">접근 권한이 없습니다</h3>
        <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 leading-relaxed font-medium">
           이 기능은 <span className="text-rose-500 font-bold">멤버십 전용</span> 기능입니다.<br/>
           멤버십 승인 후 이용하실 수 있습니다.
        </p>
        <div className="flex flex-col gap-3 w-full">
           <button 
              onClick={onSubscribe}
              className="w-full px-6 py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-xl font-bold text-sm shadow-lg hover:shadow-indigo-500/30 transition-all flex items-center justify-center gap-2 group"
           >
              <span className="material-symbols-outlined text-lg group-hover:animate-bounce">diamond</span>
              멤버십 구독하러 가기
           </button>
           <button 
              onClick={onCheckStatus}
              className="w-full px-6 py-3.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-300 rounded-xl font-bold text-sm transition-colors"
           >
              내 승인 상태 확인하기
           </button>
        </div>
     </div>
  </div>
);

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

const VideoCard: React.FC<{ video: VideoData; onClick?: () => void }> = ({ video, onClick }) => {
  const isExtremeViral = parseFloat(video.viralScore) > 10;
  const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
  
  return (
    <div 
      onClick={onClick}
      className={`bg-white dark:bg-slate-card border ${isExtremeViral ? 'border-primary/40 ring-1 ring-primary/20' : 'border-slate-200 dark:border-slate-800'} rounded-2xl overflow-hidden group hover:border-primary/50 transition-all flex flex-col md:flex-row md:h-52 shadow-xl dark:shadow-black/30 relative animate-in slide-in-from-bottom-4 duration-300 ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div 
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
      </div>
      

      <div className="flex-1 p-5 md:p-6 flex flex-col justify-between overflow-hidden relative">
        {/* NEW Badge */}
        {(video as any).isNew && (
           <div className="absolute top-0 right-0 p-2">
             <span className="bg-rose-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded shadow-sm animate-pulse">NEW</span>
           </div>
        )}
        <div className="space-y-3">
          <div className="flex justify-between items-start gap-4">
            <div className="flex-1 min-w-0">
              <div className="block group/title cursor-pointer">
                <h3 className="font-bold text-sm md:text-base leading-tight dark:text-white text-slate-900 group-hover/title:text-primary transition-colors line-clamp-2 min-h-[2.6rem] mb-1">
                  {video.title}
                </h3>
              </div>
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

const SidebarItem = ({ 
  icon, 
  label, 
  active, 
  onClick,
  className = "",
  isCollapsed
}: { 
  icon: string, 
  label: string | React.ReactNode, 
  active: boolean, 
  onClick: () => void,
  className?: string,
  isCollapsed?: boolean
}) => (
  <button
    onClick={onClick}
    className={`w-full flex items-center ${isCollapsed ? 'justify-center px-0' : 'gap-3 px-3'} py-2 rounded-xl text-xs font-bold transition-all ${
      active
        ? 'shadow-sm scale-[1.02]' 
        : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'
    } ${className}`}
    title={isCollapsed && typeof label === 'string' ? label : undefined}
  >
    <span className="material-symbols-outlined text-[18px]">{icon}</span>
    {!isCollapsed && label}
  </button>
);


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
  isPackageMode,
  onTogglePackageMode,
  isShortsDetectorMode,
  onToggleShortsDetectorMode,
  isTopicMode,
  onToggleTopicMode,
  isMembershipMode,
  onToggleMembershipMode,
  hasPendingSync,
  isSyncNoticeDismissed,
  isApiKeyMissing,
  usage,
  isReadOnly,
  isCollapsed,
  onToggleCollapse,
  isMobileMenuOpen,
  onCloseMobileMenu,
  onOpenMyPage,

  isComparisonMode,
  onToggleComparisonMode,
  isNationalTrendMode,
  onToggleNationalTrendMode,
  isCategoryTrendMode,
  onToggleCategoryTrendMode,
  isRadarMode,
  onToggleRadarMode,
  isMaterialsExplorerMode,
  onToggleMaterialsExplorerMode,
  theme, // Added theme prop
  isScriptMode,
  onToggleScriptMode,
  userGrade, // Added userGrade
  onShowAlert, // Added onShowAlert
  isAdmin // Added isAdmin
}: { 
  theme?: 'dark' | 'light', // Added theme type 
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
  isPackageMode: boolean,
  onTogglePackageMode: (val: boolean) => void,
  hasPendingSync: boolean,
  isSyncNoticeDismissed: boolean,
  isApiKeyMissing: boolean,
  usage: ApiUsage,
  isShortsDetectorMode: boolean,
  onToggleShortsDetectorMode: (val: boolean) => void,
  isTopicMode: boolean,
  onToggleTopicMode: (val: boolean) => void,
  isMembershipMode: boolean,
  onToggleMembershipMode: (val: boolean) => void,
  isReadOnly?: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isMobileMenuOpen?: boolean;
  onCloseMobileMenu?: () => void;
  onOpenMyPage?: (tab?: 'dashboard' | 'activity' | 'notifications' | 'support' | 'usage') => void;
  isComparisonMode?: boolean;
  onToggleComparisonMode?: (val: boolean) => void;
  isNationalTrendMode: boolean;
  onToggleNationalTrendMode: (val: boolean) => void;
  isCategoryTrendMode: boolean;
  onToggleCategoryTrendMode: (val: boolean) => void;
  isRadarMode: boolean;
  onToggleRadarMode: (val: boolean) => void;
  isMaterialsExplorerMode: boolean;
  onToggleMaterialsExplorerMode: (val: boolean) => void;
  isScriptMode: boolean;
  onToggleScriptMode: (val: boolean) => void;
  userGrade?: string;
  onShowAlert?: (alert: { title: string, message: string, type?: 'info' | 'error', showSubscribeButton?: boolean, onSubscribe?: () => void }) => void;
  isAdmin?: boolean;
}) => {
  if (!usage) return null;
  const bonusPoints = usage.bonusPoints || 0;
  const dailyRemain = isApiKeyMissing ? 0 : usage.total - usage.used;
  const remain = dailyRemain + bonusPoints; // Total available = daily remaining + bonus
  const percent = isApiKeyMissing ? 0 : Math.max(0, (remain / usage.total) * 100);
  const isCritical = !isApiKeyMissing && percent < 10;
  const isWarning = !isApiKeyMissing && percent < 30;

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden animate-in fade-in"
          onClick={onCloseMobileMenu}
        />
      )}
      
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 bg-white dark:bg-background-dark border-r border-slate-200 dark:border-slate-800 flex flex-col h-screen shrink-0 transition-all duration-300
        ${isMobileMenuOpen ? 'translate-x-0 w-72 shadow-2xl' : '-translate-x-full lg:translate-x-0'}
        ${!isMobileMenuOpen ? (isCollapsed ? 'w-20' : 'w-72') : ''} 
      `}>
      <div className={`flex items-center ${isCollapsed ? 'justify-center p-3' : 'justify-between p-4'} transition-all`}>
        {isCollapsed ? (
          <button 
            onClick={onToggleCollapse}
            className="size-10 rounded-xl hover:bg-slate-100 dark:hover:bg-white/5 flex items-center justify-center text-slate-500 transition-colors"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
        ) : (
          <>
            <button 
              onClick={() => {
                onToggleMyMode(true);
                if (onCloseMobileMenu) onCloseMobileMenu();
              }}
              className="flex items-center gap-3 text-left hover:opacity-80 transition-opacity group"
            >
              <div className="h-12 w-56 flex items-center justify-start p-1 transition-transform duration-300 group-hover:scale-105">
                <img src={theme === 'light' ? "/logo-light.png" : "/logo.png"} alt="Tube Radar" className="h-full w-auto object-contain" />
              </div>
            </button>

          </>
        )}
      </div>
      
        <nav className="flex-1 px-4 pb-4 space-y-1 overflow-y-auto custom-scrollbar flex flex-col">
        {/* 1. 채널 관리 */}
        {!isCollapsed && <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-3 py-1.5 mt-2 animate-in fade-in">채널 관리</div>}
        <div className={`px-2 space-y-1 ${isCollapsed ? 'mt-4' : ''}`}>
          <button
            onClick={() => { 
              onToggleMyMode(true);
              if (onCloseMobileMenu) onCloseMobileMenu();
            }}
            className={`w-full relative flex items-center ${isCollapsed ? 'justify-center px-0' : 'gap-3 px-3'} py-2 rounded-xl text-xs font-bold transition-all ${
              isMyMode && !isExplorerMode && !isUsageMode && !isPackageMode && !isShortsDetectorMode && !isTopicMode && !isMembershipMode && !isComparisonMode && !isNationalTrendMode && !isCategoryTrendMode && !isRadarMode && !isMaterialsExplorerMode
                ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 shadow-sm border border-indigo-200 dark:border-indigo-500/20' 
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent'
            } ${isCollapsed ? 'justify-center px-0' : ''}`}
            title={isCollapsed ? "내 모니터링 리스트" : undefined}
          >
            <span className="material-symbols-outlined text-[18px]">list_alt</span>
            {!isCollapsed && (
              <>
                <span className="flex-1 text-left">내 모니터링 리스트</span>
                {hasPendingSync && <span className="relative flex h-2 w-2 mr-1"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span><span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span></span>}
              </>
            )}
            {isCollapsed && hasPendingSync && <span className="absolute top-2 right-2 flex h-1.5 w-1.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span><span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-rose-500"></span></span>}
          </button>

          <SidebarItem 
            icon="compare_arrows" 
            label="채널 비교 분석" 
            active={!!isComparisonMode} 
            onClick={() => {
              if (onToggleComparisonMode) onToggleComparisonMode(true);
              if (onCloseMobileMenu) onCloseMobileMenu();
            }}
            className={`${isComparisonMode ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent hover:text-indigo-500'}`}
            isCollapsed={isCollapsed}
          />
          <SidebarItem 
            icon="radar" 
            label="채널 급등 레이더" 
            active={isRadarMode} 
            onClick={() => {
              onToggleRadarMode(true);
              if (onCloseMobileMenu) onCloseMobileMenu();
            }} 
            className={`${isRadarMode ? 'bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent hover:text-indigo-500'}`}
            isCollapsed={isCollapsed}
          />

        </div>

        {/* 2. 키워드 탐색 */}
        {!isCollapsed && <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-3 py-1.5 mt-1 animate-in fade-in">키워드 탐색</div>}
        <div className="px-2 space-y-1">
          <SidebarItem 
             icon="travel_explore" 
             label="키워드 소재 탐색" 
             active={isMaterialsExplorerMode} 
             onClick={() => {
                onToggleMaterialsExplorerMode(true);
                if (onCloseMobileMenu) onCloseMobileMenu();
             }}
             className={`${isMaterialsExplorerMode ? 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/30' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent hover:text-cyan-500'}`}
             isCollapsed={isCollapsed}
          />
          <SidebarItem 
            icon="search" 
            label="키워드 채널 찾기" 
            active={isExplorerMode} 
            onClick={() => {
              onToggleExplorerMode(true);
              if (onCloseMobileMenu) onCloseMobileMenu();
            }}
            className={`${isExplorerMode ? 'bg-cyan-50 dark:bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border border-cyan-200 dark:border-cyan-500/30' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent hover:text-cyan-500'}`}
            isCollapsed={isCollapsed}
          />
        </div>

        {/* 3. 아이디어·추천 */}
        {!isCollapsed && <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-3 py-1.5 mt-1 animate-in fade-in">아이디어·추천</div>}
        <div className="px-2 space-y-1">
          <SidebarItem 
            icon="lightbulb" 
            label={
              <span className="flex items-center gap-1.5">
                유튜브 추천 소재
                <span className="text-[9px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded flex items-center gap-0.5 font-bold">
                   <span className="material-symbols-outlined text-[10px]">
                     {(!isAdmin && userGrade !== 'gold') ? 'lock' : 'stars'}
                   </span>
                   GOLD
                </span>
              </span>
            } 
            active={isTopicMode} 
            onClick={() => {
              if (!isAdmin && userGrade !== 'gold') {
                 if (onShowAlert) {
                    onShowAlert({
                       title: "권한 제한",
                       message: "🚫 이 기능은 골드 등급 전용입니다.\n\n멤버십 업그레이드 후 이용해주세요.",
                       type: 'error',
                       showSubscribeButton: true,
                       onSubscribe: () => window.open('https://www.youtube.com/channel/UClP2hW295JL_o-lESiMY0fg/join', '_blank')
                    });
                 } else {
                    alert("🚫 이 기능은 골드 등급 전용입니다.");
                 }
                 return;
              }
              onToggleTopicMode(true);
              if (onCloseMobileMenu) onCloseMobileMenu();
            }} 
            className={`${isTopicMode ? 'bg-amber-50 dark:bg-amber-500/10 !text-amber-600 dark:!text-amber-400 border border-amber-200 dark:border-amber-500/30 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent hover:!text-amber-500'}`}
            isCollapsed={isCollapsed}
          />
          <SidebarItem 
            icon="inventory_2" 
            label={
              <span className="flex items-center gap-1.5">
                추천 채널 팩
                <span className="text-[9px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded flex items-center gap-0.5 font-bold">
                   <span className="material-symbols-outlined text-[10px]">
                     {(!isAdmin && userGrade !== 'gold') ? 'lock' : 'stars'}
                   </span>
                   GOLD
                </span>
              </span>
            } 
            active={isPackageMode} 
            onClick={() => {
              if (!isAdmin && userGrade !== 'gold') {
                 if (onShowAlert) {
                    onShowAlert({
                       title: "권한 제한",
                       message: "🚫 이 기능은 골드 등급 전용입니다.\n\n멤버십 업그레이드 후 이용해주세요.",
                       type: 'error',
                       showSubscribeButton: true,
                       onSubscribe: () => window.open('https://www.youtube.com/channel/UClP2hW295JL_o-lESiMY0fg/join', '_blank')
                    });
                 } else {
                    alert("🚫 이 기능은 골드 등급 전용입니다.");
                 }
                 return;
              }
              onTogglePackageMode(true);
              if (onCloseMobileMenu) onCloseMobileMenu();
            }} 
            className={`${isPackageMode ? 'bg-amber-50 dark:bg-amber-500/10 !text-amber-600 dark:!text-amber-400 border border-amber-200 dark:border-amber-500/30 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent hover:!text-amber-500'}`}
            isCollapsed={isCollapsed}
          />
            <SidebarItem 
              icon="description" 
              label={
                <span className="flex items-center gap-1.5">
                  유튜브 대본 추출
                  <span className="text-[9px] bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded flex items-center gap-0.5 font-bold">
                     <span className="material-symbols-outlined text-[10px]">
                       {(!isAdmin && userGrade !== 'gold') ? 'lock' : 'stars'}
                     </span>
                     GOLD
                  </span>
                </span>
              } 
              active={isScriptMode} 
              onClick={() => {
                if (!isAdmin && userGrade !== 'gold') {
                   if (onShowAlert) {
                      onShowAlert({
                         title: "권한 제한",
                         message: "🚫 이 기능은 골드 등급 전용입니다.\n\n멤버십 업그레이드 후 이용해주세요.",
                         type: 'error',
                         showSubscribeButton: true,
                         onSubscribe: () => window.open('https://www.youtube.com/channel/UClP2hW295JL_o-lESiMY0fg/join', '_blank')
                      });
                   } else {
                      alert("🚫 이 기능은 골드 등급 전용입니다.\n\n멤버십 업그레이드 후 이용해주세요.");
                   }
                   return;
                }
                onToggleScriptMode(true);
                if (onCloseMobileMenu) onCloseMobileMenu();
              }}
              className={`${isScriptMode ? 'bg-amber-50 dark:bg-amber-500/10 !text-amber-600 dark:!text-amber-400 border border-amber-200 dark:border-amber-500/30 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent hover:!text-amber-500'}`}
              isCollapsed={isCollapsed}
            />
        </div>

        {/* 4. 국가별 트렌드 (유지) */}
        {/* 4. 트렌드 분석 */}
        {!isCollapsed && <div className="text-[10px] font-bold text-slate-400 dark:text-slate-500 uppercase tracking-widest px-3 py-1.5 mt-1 animate-in fade-in">트렌드 분석</div>}
        <div className="px-2 space-y-1">
          <SidebarItem 
            icon="bolt" 
            label="자동 탐색 (Shorts)" 
            active={!!isShortsDetectorMode} 
            onClick={() => {
              onToggleShortsDetectorMode(true);
              if (onCloseMobileMenu) onCloseMobileMenu();
            }}  
            className={`${isShortsDetectorMode ? 'bg-rose-50 dark:bg-rose-500/10 !text-rose-600 dark:!text-rose-400 border border-rose-200 dark:border-rose-500/30 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent hover:!text-rose-500'}`}
            isCollapsed={isCollapsed}
          />
          <SidebarItem 
            icon="public" 
            label="실시간 국가 트렌드" 
            active={isNationalTrendMode} 
            onClick={() => {
              onToggleNationalTrendMode(true);
              if (onCloseMobileMenu) onCloseMobileMenu();
            }} 
            className={`${isNationalTrendMode ? 'bg-rose-50 dark:bg-rose-500/10 !text-rose-600 dark:!text-rose-400 border border-rose-200 dark:border-rose-500/30 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent hover:!text-rose-500'}`}
            isCollapsed={isCollapsed}
          />
          <SidebarItem 
            icon="category" 
            label="실시간 카테고리 트렌드" 
            active={isCategoryTrendMode} 
            onClick={() => {
              onToggleCategoryTrendMode(true);
              if (onCloseMobileMenu) onCloseMobileMenu();
            }} 
            className={`${isCategoryTrendMode ? 'bg-rose-50 dark:bg-rose-500/10 !text-rose-600 dark:!text-rose-400 border border-rose-200 dark:border-rose-500/30 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5 border border-transparent hover:!text-rose-500'}`}
            isCollapsed={isCollapsed}
          />
        </div>

      </nav>

      {/* 포인트 - Bottom Section */}
      <div className="shrink-0 p-3 bg-slate-100 dark:bg-slate-800/50">
        <button
          onClick={() => {
            onOpenMyPage?.('usage');
            if (onCloseMobileMenu) onCloseMobileMenu();
          }}
          className={`w-full flex items-center ${isCollapsed ? 'justify-center px-0' : 'gap-3 px-3'} py-2 rounded-xl text-xs font-bold transition-all text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 border border-transparent`}
          title={isCollapsed ? "포인트 관리" : undefined}
        >
          <div className="relative">
            <span className="material-symbols-outlined text-[18px]">settings_input_antenna</span>
            <span className={`absolute -top-0.5 -right-0.5 size-2 border-2 border-slate-100 dark:border-slate-800 rounded-full ${ytApiStatus === 'valid' ? 'bg-emerald-500' : 'bg-rose-500'}`}></span>
          </div>
          {!isCollapsed && (
            <div className="flex-1 flex items-center justify-between">
              <span>포인트 관리</span>
              <span className={`text-[10px] font-black ${isCritical ? 'text-rose-500' : isWarning ? 'text-orange-500' : 'text-emerald-500'}`}>
                {percent.toFixed(0)}%
              </span>
            </div>
          )}
        </button>
      </div>
    </aside>
    </>
  );
};

const AlertModal = ({ title, message, onClose, type = 'info', showSubscribeButton, onSubscribe }: { title: string, message: string, onClose: () => void, type?: 'info' | 'error', showSubscribeButton?: boolean, onSubscribe?: () => void }) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
    <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
      <div className={`pt-8 pb-4 flex items-center justify-center ${type === 'error' ? 'text-rose-500' : 'text-indigo-500'}`}>
        <span className="material-symbols-outlined text-5xl animate-bounce">{type === 'error' ? 'error' : 'info'}</span>
      </div>
      <div className="px-8 pb-4 text-center">
        <h3 className="text-xl font-black text-slate-900 dark:text-white mb-3 tracking-tight">{title}</h3>
        <p className="text-xs font-bold text-slate-500 dark:text-slate-400 whitespace-pre-line leading-relaxed">{message}</p>
      </div>
      <div className="p-6 pt-2 space-y-3">
        {showSubscribeButton && (
            <button onClick={onSubscribe} className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white rounded-2xl font-bold uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg flex items-center justify-center gap-2 group">
               <span className="material-symbols-outlined text-lg group-hover:animate-bounce">diamond</span>
               멤버십 구독하러 가기
            </button>
        )}
        <button onClick={onClose} className="w-full py-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg opacity-80 hover:opacity-100">
          확인
        </button>
      </div>
    </div>
  </div>
);


const Toast = ({ message, type = 'success' }: { message: string, type?: 'success' | 'error' }) => (
  <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[300] animate-in slide-in-from-top-4 fade-in duration-300 pointer-events-none">
    <div className={`px-6 py-3 rounded-2xl shadow-2xl backdrop-blur-md border border-white/20 flex items-center gap-3 ${
      type === 'success' 
        ? 'bg-emerald-500/90 text-white shadow-emerald-500/30' 
        : 'bg-rose-500/90 text-white shadow-rose-500/30'
    }`}>
      <span className="material-symbols-outlined text-[20px] font-fill">
        {type === 'success' ? 'check_circle' : 'error'}
      </span>
      <span className="text-sm font-bold tracking-wide pr-1 filter drop-shadow-sm">{message}</span>
    </div>
  </div>
);


const AnalysisResultModal = ({ result, onClose }: { result: AnalysisResponse, onClose: () => void }) => (
  <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
    <div className="bg-white dark:bg-slate-900 w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
      <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/30">
        <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
          <span className="material-symbols-outlined text-purple-500">auto_awesome</span>
          AI 바이럴 분석 결과
        </h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
           <span className="material-symbols-outlined">close</span>
        </button>
      </div>
      <div className="p-8 space-y-6">
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">바이럴 원인</div>
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200 leading-relaxed bg-purple-50 dark:bg-purple-900/10 p-4 rounded-xl border border-purple-100 dark:border-purple-500/20">
            {result.viralReason}
          </p>
        </div>
        <div className="space-y-2">
          <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">시청자 반응 예상</div>
          <p className="text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
            {result.engagementQuality}
          </p>
        </div>
        <div className="space-y-2">
           <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">트렌드 가치</div>
           <div className="flex items-center gap-2">
             <span className="material-symbols-outlined text-amber-500 text-lg">trending_up</span>
             <span className="text-sm font-bold text-slate-700 dark:text-slate-300">{result.topicTrend}</span>
           </div>
        </div>
      </div>
      <div className="p-6 pt-2 bg-slate-50 dark:bg-slate-900/50">
        <button onClick={onClose} className="w-full py-3.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-2xl font-black uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-lg">
          닫기
        </button>
      </div>
    </div>
  </div>
);

// Helper function for D-Day calculation
const calculateDDay = (expiresAt: string) => {
  const now = new Date();
  const expiry = new Date(expiresAt);
  const diffTime = expiry.getTime() - now.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  if (diffDays < 0) return '만료됨';
  if (diffDays === 0) return 'D-Day';
  return `D-${diffDays}`;
};

const Header = ({ region, count, theme, onToggleTheme, hasPendingSync, isApiKeyMissing, onDismissSync,
  onSync,
  user,
  role,
  expiresAt,
  onLogout,
  onOpenAdmin,
  notifications,
  onDeleteNotif,
  onOpenMyPage,
  onOpenMembership,
  onMobileMenuToggle,
  ytKey
}: {
  region: string,
  count: number,
  theme: 'dark' | 'light',
  onToggleTheme: () => void,
  hasPendingSync: boolean,
  isApiKeyMissing: boolean,
  onDismissSync: () => void,
  onSync: () => void,
  user?: any,
  role?: string,
  expiresAt?: string | null,
  onLogout: () => void,
  notifications: AppNotification[],
  onDeleteNotif: (id: string) => void,
  onOpenAdmin: () => void,
  onOpenMyPage: (tab?: 'dashboard' | 'activity' | 'notifications' | 'support' | 'usage') => void,
  onOpenMembership: () => void,
  onMarkRead?: (id: string) => void,
  onMobileMenuToggle: () => void,
  ytKey: string
}) => {
  // D-Day calculation
  const dDay = expiresAt ? calculateDDay(expiresAt) : null;

  // Notice State
  const [notice, setNotice] = useState<{ id?: string; title?: string; content: string; isActive: boolean; imageUrl?: string } | null>(null);
  const [isNoticeDismissed, setIsNoticeDismissed] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const unreadCount = notifications.filter(n => !n.isRead).length;
  const notifRef = useRef<HTMLDivElement>(null);

  // Notice Popup State & Logic
  const [showNoticePopup, setShowNoticePopup] = useState(false);

  useEffect(() => {
    if (notice && notice.isActive && (notice.content || notice.imageUrl)) {
      const uniqueKey = (notice.content || "") + (notice.imageUrl || "");
      const hiddenContent = localStorage.getItem('tubeRadar_notice_hidden_content');
      if (hiddenContent !== uniqueKey) {
        setShowNoticePopup(true);
      } else {
        setShowNoticePopup(false);
      }
    } else {
      setShowNoticePopup(false);
    }
  }, [notice]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotifOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [notifRef]);


  useEffect(() => {
    // Real-time listener for notices (Fetch latest active notice)
    // where + orderBy on different fields requires composite index
    // Use simple where query and sort client-side to avoid index requirement
    const q = query(
      collection(db, 'notices'),
      where('isActive', '==', true)
    );

    const unsub = onSnapshot(q, (snapshot) => {
      if (!snapshot.empty) {
        // Sort client-side by createdAt desc, pick latest
        const sorted = snapshot.docs
          .map(d => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => {
            const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
            const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
            return bTime - aTime;
          });
        const latest = sorted[0] as any;
        setNotice({
           id: latest.id,
           content: latest.content,
           isActive: latest.isActive,
           imageUrl: latest.imageUrl,
           title: latest.title
        });
      } else {
         setNotice(null);
      }
    }, (error) => {
      console.error('Notice listener error:', error);
    });
    return () => unsub();
  }, []);

  // Effect to reset dismissal if content changes (checking content string)
  useEffect(() => {
    setIsNoticeDismissed(false);
  }, [notice?.content]);

  // Expose quota debugging functions to window for console access
  useEffect(() => {
    if (!ytKey) return;

    (window as any).resetQuota = () => {
      const result = resetQuota(ytKey);
      console.log('✅ 쿼터가 리셋되었습니다:', result);
      return result;
    };
    (window as any).checkQuota = () => {
      const usage = getApiUsage(ytKey);
      console.log('📊 현재 쿼터 상태:');
      console.log('- 총 할당량:', usage.total);
      console.log('- 사용량:', usage.used);
      console.log('- 남은 할당량:', usage.total - usage.used);
      console.log('- 사용률:', ((usage.used / usage.total) * 100).toFixed(1) + '%');
      console.log('- 마지막 리셋:', usage.lastReset);
      return usage;
    };
    console.log('💡 쿼터 관리 함수가 로드되었습니다. 사용 방법:');
    console.log('  - checkQuota() : 현재 쿼터 상태 확인');
    console.log('  - resetQuota() : 쿼터 수동 리셋');
  }, [ytKey]);

  return (
  <header className="flex flex-col sticky top-0 z-40">
    
    <div className="h-16 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 md:px-8 bg-white/80 dark:bg-background-dark/50 backdrop-blur-md transition-colors duration-300 relative z-50">
    <div className="flex items-center gap-4">
      {/* Mobile Menu Toggle */}
      <button 
        onClick={onMobileMenuToggle}
        className="lg:hidden p-2 -ml-2 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors"
      >
        <span className="material-symbols-outlined">menu</span>
      </button>
      
      <span className="text-[10px] font-black text-slate-400 dark:text-slate-400 uppercase tracking-[0.2em] hidden md:block">통계 제어 판넬</span>
      {isApiKeyMissing ? (
        <button 
          onClick={() => onOpenMyPage?.('dashboard')}
          className="flex items-center gap-2 px-3 py-1 bg-rose-500/10 border border-rose-500/20 rounded-full animate-in fade-in slide-in-from-left-2 shadow-[0_0_12px_rgba(244,63,94,0.1)] hover:bg-rose-500/20 transition-colors cursor-pointer group"
        >
          <span className="size-1.5 bg-rose-500 rounded-full animate-pulse group-hover:scale-125 transition-transform"></span>
          <span className="text-[9px] font-black text-rose-500 uppercase tracking-tighter animate-pulse">
            <span className="md:hidden">KEY 설정</span>
            <span className="hidden md:inline">YouTube API 키 설정이 필요합니다 (클릭)</span>
          </span>
        </button>
      ) : hasPendingSync && (
        <div className="flex items-center gap-2 px-3 py-1 bg-accent-hot/10 border border-accent-hot/20 rounded-full animate-in fade-in slide-in-from-left-2">
          <span className="size-1.5 bg-accent-hot rounded-full animate-pulse"></span>
          <span className="text-[9px] font-black text-accent-hot uppercase tracking-tighter">
            <span className="md:hidden">Sync Needed</span>
            <span className="hidden md:inline">새로운 채널/그룹 변경사항이 있습니다</span>
          </span>
          <button onClick={onDismissSync} className="text-accent-hot hover:text-white transition-colors ml-1 leading-none p-0.5 rounded-full hover:bg-rose-500/20"><span className="material-symbols-outlined text-[12px] font-black">close</span></button>
        </div>
      )}
    </div>
    <div className="flex items-center gap-4">
      
      {role === 'admin' && (
        <button 
          onClick={onOpenAdmin}
          className="flex items-center justify-center size-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-600 dark:text-purple-400 hover:bg-purple-500 hover:text-white transition-all shadow-sm"
          title="관리자 대시보드"
        >
          <span className="material-symbols-outlined text-[20px]">admin_panel_settings</span>
        </button>
      )}

      {/* Theme Toggle Switch */}
      <button 
        onClick={onToggleTheme}
        className={`relative w-12 h-6 rounded-full transition-colors duration-300 flex items-center px-1 ${theme === 'dark' ? 'bg-slate-700' : 'bg-slate-200'}`}
        title={theme === 'dark' ? '라이트 모드로 전환' : '다크 모드로 전환'}
      >
        <div className={`size-4 rounded-full bg-white shadow-sm transform transition-transform duration-300 flex items-center justify-center ${theme === 'dark' ? 'translate-x-6' : 'translate-x-0'}`}>
           <span className="material-symbols-outlined text-[10px] text-slate-900">
             {theme === 'dark' ? 'dark_mode' : 'light_mode'}
           </span>
        </div>
      </button>

      {/* Hero Badge */}
      <div className="bg-rose-500/10 dark:bg-rose-500/20 backdrop-blur-md border border-rose-500/20 text-rose-600 dark:text-rose-400 px-3 py-1.5 rounded-lg shadow-lg shadow-rose-500/10 flex items-center gap-2 animate-in fade-in slide-in-from-right-4">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
        </span>
        <span className="text-[10px] font-black uppercase tracking-widest text-shadow-sm">
          <span className="md:hidden">{region}</span>
          <span className="hidden md:inline">{region} 지역 • {count}개 신호 감지</span>
        </span>
      </div>

      {user && (
        <div className="flex items-center gap-3 md:pl-4 md:border-l border-slate-200 dark:border-white/10 relative order-last md:order-none" ref={notifRef}>
           <button 
             onClick={() => setIsNotifOpen(!isNotifOpen)} 
             className="flex items-center gap-3 hover:opacity-80 transition-opacity text-left group"
           >
             <div className="relative">
               <img 
                 src={user.photoURL || `https://ui-avatars.com/api/?name=${user.displayName}`} 
                 alt="User" 
                 className="size-8 rounded-full border border-slate-200 dark:border-white/10 shadow-sm"
               />
               {unreadCount > 0 && (
                 <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[16px] h-4 px-1 bg-rose-500 text-white text-[9px] font-black rounded-full ring-2 ring-white dark:ring-background-dark animate-in zoom-in">
                   {unreadCount > 99 ? '99+' : unreadCount}
                 </span>
               )}
             </div>
             <div className="flex items-center gap-1">
               <span className="text-[10px] font-bold text-slate-700 dark:text-slate-300 hidden md:block">
                 {user.displayName}
               </span>
               <span className={`material-symbols-outlined text-slate-400 text-[16px] transition-transform duration-200 ${isNotifOpen ? 'rotate-180' : ''}`}>expand_more</span>
             </div>
           </button>
           
           {isNotifOpen && (
             <div className="absolute right-0 -mr-2 md:mr-0 top-full mt-3 w-64 max-w-[calc(100vw-32px)] bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 z-50 overflow-hidden animate-in fade-in zoom-in-95 origin-top-right">
               {/* Menu Header */}
               <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
                 <p className="text-xs font-bold text-slate-900 dark:text-white">{user.displayName}</p>
                 <p className="text-[10px] text-slate-500 truncate">{user.email}</p>
               </div>

               {/* Menu Items */}
               <div className="p-2 space-y-1">

                 <button 
                   onClick={() => { onOpenMyPage('dashboard'); setIsNotifOpen(false); }}
                   className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                 >
                   <span className="material-symbols-outlined text-[18px] text-indigo-500">dashboard</span>
                   대시보드
                 </button>

                 <button 
                   onClick={() => { onOpenMyPage('activity'); setIsNotifOpen(false); }}
                   className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                 >
                   <span className="material-symbols-outlined text-[18px] text-indigo-500">history_edu</span>
                   내 활동 내역
                 </button>

                 <button 
                   onClick={() => { onOpenMyPage('notifications'); setIsNotifOpen(false); }}
                   className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                 >
                   <span className="material-symbols-outlined text-[18px] text-indigo-500">notifications</span>
                   알림함
                   {unreadCount > 0 && <span className="ml-auto bg-rose-500 text-white text-[9px] px-1.5 rounded-full">{unreadCount}</span>}
                 </button>

                 <button 
                   onClick={() => { onOpenMyPage('support'); setIsNotifOpen(false); }}
                   className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                 >
                   <span className="material-symbols-outlined text-[18px] text-indigo-500">support_agent</span>
                   1:1 문의하기
                 </button>

                 {role === 'admin' && (
                 <button 
                   onClick={() => { onOpenMembership(); setIsNotifOpen(false); }}
                   className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                 >
                   <span className="material-symbols-outlined text-[18px] text-indigo-500">card_membership</span>
                   멤버십 구독
                 </button>
                 )}

                 {role === 'admin' && (
                   <button 
                     onClick={() => { onOpenAdmin && onOpenAdmin(); setIsNotifOpen(false); }}
                     className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors border-t border-slate-100 dark:border-slate-800 mt-1 pt-2"
                   >
                     <span className="material-symbols-outlined text-[18px] text-purple-500">admin_panel_settings</span>
                     관리자 페이지
                   </button>
                 )}

                 <div className="border-t border-slate-100 dark:border-slate-800 my-1 pt-1"></div>

                 <button 
                   onClick={() => { onLogout && onLogout(); setIsNotifOpen(false); }}
                   className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-bold text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors"
                 >
                   <span className="material-symbols-outlined text-[18px]">logout</span>
                   로그아웃
                 </button>
               </div>
             </div>
           )}
        </div>
      )}

    </div>
    </div>
    
    {/* Notice Popup */}
    {showNoticePopup && notice && (
        <div className="fixed bottom-4 right-4 left-4 sm:left-auto sm:right-6 sm:bottom-6 z-[100000] sm:max-w-md sm:w-[400px] animate-in slide-in-from-bottom-10 fade-in duration-500">
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-700 overflow-hidden ring-1 ring-black/5 flex flex-col max-h-[85vh] sm:max-h-[80vh]">
             <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-4 py-3 flex justify-between items-center shrink-0">
                <div className="flex items-center gap-2 text-white font-bold text-sm">
                   <span className="material-symbols-outlined text-[18px]">campaign</span>
                   <span>공지사항</span>
                </div>
                <button
                  onClick={() => setShowNoticePopup(false)}
                  className="text-white/80 hover:text-white transition-colors"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                </button>
             </div>

             {notice.imageUrl && (
               <div className="relative bg-slate-100 dark:bg-slate-900 border-b border-slate-100 dark:border-slate-700 overflow-hidden shrink-0">
                 <img
                   src={notice.imageUrl}
                   alt="공지 이미지"
                   className="w-full h-auto max-h-[40vh] sm:max-h-[50vh] object-contain block"
                 />
               </div>
             )}

             {notice.content && (
                <div className="p-4 sm:p-5 overflow-y-auto min-h-0 custom-scrollbar">
                    <div
                      className="text-slate-600 dark:text-slate-300 text-sm leading-relaxed font-medium prose dark:prose-invert max-w-none break-words [&>p]:mb-2 [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5 [&>a]:text-indigo-500 [&>a]:underline [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-lg [&_table]:w-full [&_table]:overflow-x-auto [&_table]:block [&_iframe]:max-w-full [&_pre]:overflow-x-auto [&_pre]:whitespace-pre-wrap"
                      dangerouslySetInnerHTML={{ __html: notice.content }}
                    />
                </div>
             )}

             <div className="h-px bg-slate-100 dark:bg-slate-700 mx-4 shrink-0"></div>
             <div className="flex shrink-0">
                <button
                  onClick={() => {
                     const uniqueKey = (notice.content || "") + (notice.imageUrl || "");
                     localStorage.setItem('tubeRadar_notice_hidden_content', uniqueKey);
                     setShowNoticePopup(false);
                  }}
                  className="flex-1 py-3 text-xs font-bold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 transition-colors hover:bg-slate-50 dark:hover:bg-slate-700/50"
                >
                  다시 보지 않기
                </button>
                <div className="w-px bg-slate-100 dark:bg-slate-700"></div>
                <button
                  onClick={() => setShowNoticePopup(false)}
                  className="flex-1 py-3 text-xs font-bold text-indigo-500 hover:text-indigo-600 dark:text-indigo-400 transition-colors hover:bg-indigo-50 dark:hover:bg-indigo-900/10"
                >
                  닫기
                </button>
             </div>
          </div>
        </div>
      )}
  </header>
  );
};

const CATEGORIES = [
  { id: 'ENTER', name: '엔터', icon: 'theater_comedy', categoryId: '24' },
  { id: 'FILM', name: '영화/애니', icon: 'movie', categoryId: '1' },
  { id: 'AUTOS', name: '자동차', icon: 'directions_car', categoryId: '2' },
  { id: 'MUSIC', name: '음악', icon: 'music_note', categoryId: '10' },
  { id: 'PETS', name: '동물', icon: 'pets', categoryId: '15' },
  { id: 'SPORTS', name: '스포츠', icon: 'sports_soccer', categoryId: '17' },
  { id: 'GAME', name: '게임', icon: 'sports_esports', categoryId: '20' },
  { id: 'BLOG', name: '인물/블로그', icon: 'person', categoryId: '22' },
  { id: 'COMEDY', name: '코미디', icon: 'sentiment_very_satisfied', categoryId: '23' },
  { id: 'NEWS', name: '뉴스·시사', icon: 'newspaper', categoryId: '25' },
  { id: 'HOWTO', name: '노하우/스타일', icon: 'lightbulb', categoryId: '26' },
  { id: 'TECH', name: '과학/기술', icon: 'smart_toy', categoryId: '28' }
];

const DEFAULT_GROUPS: ChannelGroup[] = [
  { id: 'all', name: '전체' },
  { id: 'unassigned', name: '미지정' }
];

export default function App() {
  const { user, role: authRole, plan, membershipTier, expiresAt, loading: authLoading, logout, membershipJustApproved, setMembershipJustApproved, hiddenItemIds, dismissItem } = useAuth();
  
  // [Hardcode Admin Override] for specific email
  const role = ((user?.email === 'boxtvstar@gmail.com') ? 'admin' : authRole) as string;

  const [videos, setVideos] = useState<VideoData[]>([]);
  const [visibleVideoCount, setVisibleVideoCount] = useState(20); // Pagination: Show 20 videos initially
  const [alertMessage, setAlertMessage] = useState<{ title: string; message: string; type?: 'info' | 'error'; showSubscribeButton?: boolean; onSubscribe?: () => void } | null>(null);
  
  // Toast Notification System
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = (message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [detailedVideo, setDetailedVideo] = useState<VideoData | null>(null);

  // [Security Fix] Initialize with empty, load from user-specific storage later
  const [ytKey, setYtKey] = useState('');
  const [ytApiStatus, setYtApiStatus] = useState<'idle' | 'valid' | 'invalid' | 'loading'>('idle');
  const [region, setRegion] = useState('KR');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [timeRange, setTimeRange] = useState(7);
  const [loading, setLoading] = useState(false);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<string | null>(null);
  
  const [hasPendingSync, setHasPendingSync] = useState<boolean>(() => {
    try {
      return localStorage.getItem('yt_pending_sync') === 'true';
    } catch {
      return false;
    }
  });
  const [isSyncNoticeDismissed, setIsSyncNoticeDismissed] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('theme') as 'dark' | 'light') || 'dark');
  const [myPageInitialTab, setMyPageInitialTab] = useState<'dashboard' | 'activity' | 'notifications' | 'support' | 'usage'>('dashboard');

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
  const [newlyAddedIds, setNewlyAddedIds] = useState<string[]>([]);
  
  const [isMyMode, setIsMyMode] = useState(true);
  const [isExplorerMode, setIsExplorerMode] = useState(false);
  const [isUsageMode, setIsUsageMode] = useState(false);
  const [isPackageMode, setIsPackageMode] = useState(false);
  const [isRadarMode, setIsRadarMode] = useState(false);
  const [radarInitialQuery, setRadarInitialQuery] = useState('');
  const [isMaterialsExplorerMode, setIsMaterialsExplorerMode] = useState(false);
  const [isScriptMode, setIsScriptMode] = useState(false);
  const [scriptModeUrl, setScriptModeUrl] = useState('');
  const [isShortsDetectorMode, setIsShortsDetectorMode] = useState(false);
  const [shortsDetectorResults, setShortsDetectorResults] = useState<AutoDetectResult[]>([]);
  const [isDetectingShorts, setIsDetectingShorts] = useState(false);
  const [detectorStatus, setDetectorStatus] = useState<string | null>(null);
  const [analyzingVideoId, setAnalyzingVideoId] = useState<string | null>(null);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResponse | null>(null);

  const [recommendedPackages, setRecommendedPackages] = useState<RecommendedPackage[]>([]);
  
  // Topic Mode State
  const [isTopicMode, setIsTopicMode] = useState(false);
  const [isMembershipMode, setIsMembershipMode] = useState(false);

  // Payment Result Routing
  const [isPaymentResultMode, setIsPaymentResultMode] = useState(false);
  useEffect(() => {
    // 앱 시작 시 오래된 캐시 정리
    cleanupOldCaches();
    
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'payment_result' || window.location.pathname === '/payment/result') {
      setIsPaymentResultMode(true);
    }
  }, []);

  // Comparison Mode
  const [isComparisonMode, setIsComparisonMode] = useState(false);
  const [isComparisonSelecting, setIsComparisonSelecting] = useState(false);
  const [comparisonChannels, setComparisonChannels] = useState<SavedChannel[]>([]);

  const toggleComparisonSelection = (channel: SavedChannel) => {
    setComparisonChannels(prev => {
      const isSelected = prev.some(c => c.id === channel.id);
      if (isSelected) {
        return prev.filter(c => c.id !== channel.id);
      } else {
        if (prev.length >= 3) {
          alert("최대 3개 채널까지 비교할 수 있습니다.");
          return prev;
        }
        return [...prev, channel];
      }
    });
  };

  const [recommendedTopics, setRecommendedTopics] = useState<RecommendedPackage[]>([]);

  const [channelInput, setChannelInput] = useState('');
  const [explorerQuery, setExplorerQuery] = useState('');
  const [explorerResults, setExplorerResults] = useState<SavedChannel[]>([]);
  const [explorerStaging, setExplorerStaging] = useState<SavedChannel[]>([]);
  const [explorerTargetGroupId, setExplorerTargetGroupId] = useState('unassigned');
  const [isExplorerSearching, setIsExplorerSearching] = useState(false);
  const [commitMessage, setCommitMessage] = useState<string | null>(null);
  // Batch & Suggestion State
  const [batchResult, setBatchResult] = useState<{ added: number; duplicates: string[] } | null>(null);
  const [isSuggestModalOpen, setIsSuggestModalOpen] = useState(false);
  const [hasSuggestionSuccess, setHasSuggestionSuccess] = useState(false);
  const [suggestTitle, setSuggestTitle] = useState('');
  const [suggestDesc, setSuggestDesc] = useState('');
  const [suggestTargetGroup, setSuggestTargetGroup] = useState('');
  const [isSubmittingSuggestion, setIsSubmittingSuggestion] = useState(false);
  
  const [channelFilterQuery, setChannelFilterQuery] = useState('');
  const [channelSortMode, setChannelSortMode] = useState<'latest' | 'name'>('latest');

  const [isAdminOpen, setIsAdminOpen] = useState(false);
  const [isMyPageOpen, setIsMyPageOpen] = useState(false);
  
  // Custom Confirm Modal State
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    actionLabel?: string;
    isDestructive?: boolean; // 빨간색 버튼 여부
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  
  // Footer Terms/Privacy Modal State
  const [footerModal, setFooterModal] = useState<{
    isOpen: boolean;
    type: 'terms' | 'privacy';
  }>({
    isOpen: false,
    type: 'terms',
  });



  const [isChannelListExpanded, setIsChannelListExpanded] = useState(false);
  const [showGuestNotice, setShowGuestNotice] = useState(false);
  
  const [isNationalTrendMode, setIsNationalTrendMode] = useState(false);
  const [isCategoryTrendMode, setIsCategoryTrendMode] = useState(false);

  // Removed isUsageMode state (integrated into MyPage)
  // const [isUsageMode, setIsUsageMode] = useState(false);

  const [usage, setUsage] = useState<ApiUsage>({
    total: 10000,
    used: 0,
    lastReset: new Date().toISOString(),
    details: { search: 0, list: 0 },
    logs: []
  });

  const [showOnboarding, setShowOnboarding] = useState(false);

  // Load usage from DB (Real-time)
  useEffect(() => {
    if (user && role !== 'pending') {
      const targetPlan = (role === 'admin' ? 'admin' : plan) || 'general';
      const unsubscribe = subscribeToUsage(user.uid, targetPlan, (newUsage) => {
        setUsage(newUsage);
      });
      return () => unsubscribe();
    }
  }, [user, role, plan]);

  const handleOpenMyPage = (tab: 'dashboard' | 'activity' | 'notifications' | 'support' | 'usage' = 'dashboard') => {
    setMyPageInitialTab(tab);
    setIsMyPageOpen(true);
  };

  const isApiKeyMissing = useMemo(() => !ytKey || ytApiStatus !== 'valid', [ytKey, ytApiStatus]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = { all: savedChannels.length };
    savedChannels.forEach(c => {
      const gid = c.groupId || 'unassigned';
      counts[gid] = (counts[gid] || 0) + 1;
    });
    return counts;
  }, [savedChannels]);

  const sortedGroups = useMemo(() => {
    const special: ChannelGroup[] = [];
    const others: ChannelGroup[] = [];
    
    groups.forEach(g => {
      if (g.id === 'all' || g.id === 'unassigned') special.push(g);
      else others.push(g);
    });
    
    // Sort special: All first, then Unassigned
    special.sort((a, b) => {
      if (a.id === 'all') return -1;
      if (b.id === 'all') return 1;
      return 0; // unassigned vs unassigned (shouldn't happen)
    });
    
    // Sort others: Alphabetical
    others.sort((a, b) => a.name.localeCompare(b.name));
    
    return [...special, ...others];
  }, [groups]);

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

  // Listen to realtime usage updates
  useEffect(() => {
    const handleUsageUpdate = (event: Event) => {
      const customEvent = event as CustomEvent;
      if (customEvent.detail) {
        setUsage(customEvent.detail);
      }
    };
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
        setYtApiStatus('invalid');
      } finally {
        if (!ytKey || ytKey.length < 20) setYtApiStatus('invalid');
        // Do not force set to valid here, trust the try/catch flow
      }
    };
    validateYtKey();
    return () => { isActive = false; };
  }, [ytKey]);

  useEffect(() => {
    if ((isPackageMode || showOnboarding) && user) {
      getPackagesFromDb().then(setRecommendedPackages);
    }
  }, [isPackageMode, showOnboarding, user]);

  useEffect(() => {
    if (isTopicMode && user) {
      getTopicsFromDb().then(setRecommendedTopics);
    }
  }, [isTopicMode, user]);

  const handleApiUsage = async (cost: number, type: 'search' | 'list' | 'script', details?: string) => {
    if (!user) return;
    try {
       const plan = role === 'pro' ? 'gold' : role === 'admin' ? 'admin' : role === 'guest' ? 'general' : 'silver';
       const newUsage = await updateUsageInDb(user.uid, plan, cost, type, details || '');
       setUsage(newUsage);
    } catch (e: any) {
       console.error("Usage Update Failed", e);
       if (e.message === 'Quota Exceeded') {
          alert(`포인트 부족 (일일 한도 초과)\n\n오늘의 포인트(${usage.total.toLocaleString()})를 모두 소진했습니다.\n내일 오후 5시(KST)에 충전됩니다.`);
       }
    }
  };

  const handleAddPackageToMyList = async (pkg: RecommendedPackage, targetGroupId: string, newGroupName?: string) => {
    if (!user) {
      alert("로그인이 필요합니다.");
      return;
    }
    
    // 1. Create new group if requested
    if (newGroupName) {
      try {
        const newGroup: ChannelGroup = {
          id: `group_${Date.now()}`,
          name: newGroupName.trim()
        };
        await saveGroupToDb(user.uid, newGroup);
        setGroups(prev => [...prev, newGroup]);
        targetGroupId = newGroup.id;
      } catch (e) {
        console.error("Failed to create new group", e);
        alert("새 그룹 생성 중 오류가 발생했습니다.");
        return;
      }
    }

    const newChannels = pkg.channels;
    const existingIds = new Set(savedChannels.map(c => c.id));
    const toAdd = newChannels.filter(c => !existingIds.has(c.id));
    const duplicates = newChannels.filter(c => existingIds.has(c.id)).map(c => c.title);
    
    if (toAdd.length === 0) {
       setBatchResult({ added: 0, duplicates });
       return;
    }

    // Add to state and DB with the selected targetGroupId
    const finalChannels = toAdd.map(c => ({...c, groupId: targetGroupId, addedAt: Date.now()}));
    setSavedChannels(prev => [...finalChannels, ...prev]); 
    await batchSaveChannels(user.uid, finalChannels);
    
    setHasPendingSync(true);
    setIsSyncNoticeDismissed(false);
    
    setBatchResult({ added: toAdd.length, duplicates });
    
    // Once added, hide from recommendations
    await dismissItem(pkg.id);
  };

  const submitPackageProposal = async () => {
    if (!user) return alert("로그인이 필요합니다.");
    if (!suggestTitle.trim()) return alert("패키지 제목을 입력해주세요.");
    if (suggestTitle.length > 30) return alert("제목은 30자 이내로 입력해주세요.");
    
    setIsSubmittingSuggestion(true);
    try {
      const selectedChannels = savedChannels.filter(c => selectedChannelIds.includes(c.id));
      
      const newPkg: RecommendedPackage = {
        id: `proposal_${Date.now()}`,
        title: suggestTitle,
        description: suggestDesc,
        category: 'Community',
        createdAt: Date.now(),
        channels: selectedChannels,
        channelCount: selectedChannels.length,
        status: 'pending',
        creatorId: user.uid,
        creatorName: user.displayName || user.email?.split('@')[0] || 'Anonymous',
        targetGroupName: suggestTargetGroup.trim() || undefined
      };

      await savePackageToDb(newPkg);
      
      setIsSuggestModalOpen(false);
      setSuggestTitle('');
      setSuggestDesc('');
      setSelectedChannelIds([]);
      setHasSuggestionSuccess(true);
    } catch (e) {
      console.error(e);
      alert("제안 제출 중 오류가 발생했습니다.");
    } finally {
      setIsSubmittingSuggestion(false);
    }
  };




  // --- Background Auto-Update Service (Stale Data Handler) ---
  const hasRunAutoUpdate = useRef(false);

  useEffect(() => {
    // Run only once per session, when user is logged in and list is loaded
    if (hasRunAutoUpdate.current || !user || !ytKey || savedChannels.length === 0) return;

    const runAutoUpdate = async () => {
      hasRunAutoUpdate.current = true;
      const MAX_AUTO_UPDATE = 5; // Limit to 5 channels per session to save Quota
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const now = new Date().getTime();

      const staleChannels = savedChannels.filter(ch => {
        // 구독자/영상 수 누락된 채널 우선 업데이트
        if (!ch.subscriberCount || !ch.videoCount) return true;
        // customAvgViews가 바닥값(100 이하)이면 재계산 필요
        if (!ch.customAvgViews || ch.customAvgViews <= 100) return true;
        // Use lastUpdated if available, otherwise fallback to addedAt
        const lastDate = ch.lastUpdated || ch.addedAt;
        if (!lastDate) return true; // Treat missing date as stale
        return (now - lastDate) > THIRTY_DAYS_MS;
      });

      if (staleChannels.length > 0) {
        console.log(`[AutoUpdate] Found ${staleChannels.length} stale channels. Updating top ${Math.min(staleChannels.length, MAX_AUTO_UPDATE)}...`);
        
        // Update DB silently
        for (const ch of staleChannels.slice(0, MAX_AUTO_UPDATE)) {
          try {
             // Fetch fresh info
             const info = await getChannelInfo(ytKey, ch.id);
             if (info) {
               const updated = { 
                   ...ch, 
                   ...info, 
                   lastUpdated: Date.now() 
               };
               
               // Update DB and state
               await saveChannelToDb(user.uid, updated);
               setSavedChannels(prev => prev.map(c => c.id === ch.id ? updated : c));
               console.log(`[AutoUpdate] Refreshed: ${ch.title}`);
               
               // Gentle delay between updates
               await new Promise(r => setTimeout(r, 2000));
             }
          } catch (e) {
             console.warn("[AutoUpdate] Failed to refresh:", ch.title);
          }
        }
      }
    };
    
    // Start 10 seconds after load to prioritize UI rendering
    const timer = setTimeout(runAutoUpdate, 10000);
    return () => clearTimeout(timer);
  }, [user, ytKey, savedChannels]);

  // [Security Fix] Load/Save User-Specific Settings
  const [isKeyLoaded, setIsKeyLoaded] = useState(false);

  useEffect(() => {
    if (user) {
      // Load settings specific to this user
      const savedKey = localStorage.getItem(`yt_api_key_${user.uid}`);
      const savedRegion = localStorage.getItem(`yt_region_${user.uid}`);
      
      if (savedKey) setYtKey(savedKey);
      else setYtKey(''); // Reset if new user has no key
      
      if (savedRegion) setRegion(savedRegion);
      
      setIsKeyLoaded(true); // Mark as loaded to enable saving
    } else {
      // Clear sensitive data on logout
      setYtKey('');
      setRegion('KR');
      setIsKeyLoaded(false);
    }
  }, [user]);

  useEffect(() => {
    if (user && isKeyLoaded) { // Only save after initial load is complete
      // Save settings specific to this user
      if (ytKey) localStorage.setItem(`yt_api_key_${user.uid}`, ytKey);
      else localStorage.removeItem(`yt_api_key_${user.uid}`);
      
      if (region) localStorage.setItem(`yt_region_${user.uid}`, region);
    }
  }, [ytKey, region, user, isKeyLoaded]);

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
          const uniqueChannels = Array.from(new Map(dbChannels.map(c => [c.id, c])).values());
          setSavedChannels(uniqueChannels);
          
           // Fetch Notifications
           const notifs = await getNotifications(user.uid);
           setNotifications(notifs);
        } catch (e) {
          console.error("Failed to load user data", e);
        }
      };
      loadUserData();
    }
  }, [user]);

  useEffect(() => {
    if (role === 'pending') {
      setShowGuestNotice(true);
    }
  }, [role]);

  if (authLoading) return <div className="min-h-screen bg-black flex items-center justify-center text-white">Loading...</div>;
  if (!user) return <Login />;

  // Initialize region and category when entering Category Trend mode
  useEffect(() => {
    if (isCategoryTrendMode) {
      setRegion('KR');
      setSelectedCategory('ENTER');
      setVideos([]); // Clear previous videos
    }
  }, [isCategoryTrendMode]);

  // Reset category when entering National Trend mode
  useEffect(() => {
    if (isNationalTrendMode) {
      setSelectedCategory(''); // National Trend doesn't use category filter
      setVideos([]); // Clear previous videos
    }
  }, [isNationalTrendMode]);

  // Load cached videos when entering My Monitoring List
  useEffect(() => {
    if (isMyMode && activeGroupId) {
      try {
        const cacheKey = `my_monitoring_list_${activeGroupId}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsedCache = JSON.parse(cached);
          if (parsedCache.videos && Array.isArray(parsedCache.videos) && parsedCache.videos.length > 0) {
            // Check cache age (7 days)
            const cacheAge = Date.now() - (parsedCache.timestamp || 0);
            if (cacheAge < 7 * 24 * 60 * 60 * 1000) {
              setVideos(parsedCache.videos);
              setVisibleVideoCount(20);
            }
          }
        }
      } catch (e) {
        console.error('Failed to load cached videos:', e);
      }
    }
  }, [isMyMode, activeGroupId]);

  useEffect(() => {
    // Auto-load for all modes
    // Always fetch 30 days of data, timeRange filtering happens client-side
    if (ytKey && ytKey.length > 20 && ytApiStatus === 'valid' && !isExplorerMode && !isShortsDetectorMode && !isPackageMode && !isTopicMode) {
      loadVideos();
    }
  }, [ytKey, region, selectedCategory, isMyMode, activeGroupId, ytApiStatus, isExplorerMode, isTopicMode, isNationalTrendMode, isCategoryTrendMode]);

  const handleOpenAutoDetectDetail = (result: AutoDetectResult) => {
    // 채널 전체 평균 조회수 계산 (totalViews / videoCount)
    const channelAvg = result.stats.videoCount > 0
      ? Math.max(Math.round(result.stats.viewCount / result.stats.videoCount), 100)
      : result.stats.avgViews || 1000;

    // 시간 보정 부스터 계산
    const pubDate = result.representativeVideo.publishedAt || result.stats.publishedAt;
    const hoursSince = Math.max((Date.now() - new Date(pubDate).getTime()) / (1000 * 60 * 60), 1);
    const timeFactor = Math.max(Math.min(Math.pow(hoursSince / 168, 0.5), 1), 0.3);
    const expectedViews = Math.max(channelAvg * timeFactor, 100);
    const booster = result.representativeVideo.views / expectedViews;

    // Convert AutoDetectResult to VideoData for the modal
    const videoData: VideoData = {
      id: result.representativeVideo.id,
      title: result.representativeVideo.title,
      channelName: result.title,
      channelId: result.id, // Channel ID for "Add Channel" functionality
      thumbnailUrl: result.representativeVideo.thumbnail,
      duration: "Shorts", // Fallback
      views: formatNumber(result.representativeVideo.views),
      avgViews: formatNumber(channelAvg),
      subscribers: formatNumber(result.stats.subscribers),
      viralScore: `${booster.toFixed(1)}x`,
      uploadTime: getTimeAgo(pubDate),
      category: getCategoryName(result.representativeVideo.categoryId || '42'),
      reachPercentage: Math.min(Math.round((result.representativeVideo.views / channelAvg) * 100), 999),
      tags: [],
      channelTotalViews: formatNumber(result.stats.viewCount),
      channelJoinDate: result.stats.publishedAt,
      channelCountry: "",
    };
    setDetailedVideo(videoData);
  };
 
  const handleSaveMaterials = async (videos: VideoData[], groupId: string, newGroupName?: string) => {
    if (!user) { alert("로그인이 필요합니다."); return; }
    
    let finalGroupId = groupId;
    
    // Check if creating new group
    if (groupId.startsWith('new_') && newGroupName) {
      // Create new group
      const newGroup: ChannelGroup = {
        id: groupId,
        name: newGroupName
      };
      
      try {
        // Save new group to Firebase
        await saveGroupToDb(user.uid, newGroup);
        
        // Update local state
        setGroups(prev => [...prev, newGroup]);
        
        finalGroupId = groupId;
      } catch (e) {
        console.error("Failed to create new group:", e);
        alert("새 그룹 생성에 실패했습니다.");
        return;
      }
    }
    
    const channelsToSave: SavedChannel[] = videos.map(v => ({
      id: v.channelId || '',
      title: v.channelName,
      thumbnail: v.channelThumbnail || '',
      customAvgViews: parseInt(v.avgViews.replace(/,/g, '') || '0'),
      addedAt: Date.now(),
      groupId: finalGroupId
    }));
    
    const uniqueChannels = Array.from(new Map(channelsToSave.map(item => [item.id, item])).values());
    
    try {
      await batchSaveChannels(user.uid, uniqueChannels);
      
      // Update local state
      setSavedChannels(prev => {
        const existing = prev.filter(ch => !uniqueChannels.find(uc => uc.id === ch.id));
        return [...existing, ...uniqueChannels];
      });
      
      // Reload videos to reflect changes
      await loadVideos(true);
      
      // Close MaterialsExplorer and switch to My Mode
      setIsMaterialsExplorerMode(false);
      setIsMyMode(true);
      
      showToast(`${uniqueChannels.length}개의 채널을 저장했습니다.`);
    } catch (e) {
      console.error(e);
      showToast("저장 중 오류가 발생했습니다.", 'error');
    }
  };

  const loadVideos = async (force: boolean = false, channelsOverride?: SavedChannel[]) => {
    if (!ytKey || ytApiStatus !== 'valid') {
      setApiError("YouTube API 키가 유효하지 않거나 설정되지 않았습니다.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setApiError(null);
    if (force) {
      setHasPendingSync(false);
      setIsSyncNoticeDismissed(false);
    }

    // Track start time for minimum loading duration
    const startTime = Date.now();
    
    let targetChannelIds: string[] = [];

    try {
      // Clear previous videos to prevent stale/mixed data from different groups
      setVideos([]);

      if (isMyMode) {
        // Use override if available (e.g. during update), otherwise use current group
        const sourceForIds = channelsOverride || currentGroupChannels;
        targetChannelIds = sourceForIds.map(c => c.id);

        if (targetChannelIds.length === 0) {
          setVideos([]);
          setLoading(false);
          return;
        }
      }

      const catConfig = CATEGORIES.find(c => c.id === selectedCategory) as any;

      // Determine parameters based on category config
      const targetCategoryId = !isMyMode && catConfig ? catConfig.categoryId : "";

      let query = "";
      if (!isMyMode && catConfig && catConfig.keywords) {
         if (typeof catConfig.keywords === 'string') {
            query = catConfig.keywords;
         } else {
            // Select keywords based on current region
            // Default to US or KR if region not found, or just empty
            query = (catConfig.keywords as any)[region] || (catConfig.keywords as any)['US'] || "";
         }
      }

      // FORCE DISABLE SEARCH - User requested strict 1-point official category mode
      const useSearch = false;

      // 15 seconds timeout to prevent infinite loading
      const timeoutPromise = new Promise<any>((_, reject) => setTimeout(() => reject(new Error("TIMEOUT")), 60000));

      // Pass query as 2nd arg (keywords), categoryId, force, useSearchApi, AND savedChannels
      if (isMyMode && targetChannelIds.length > 0) {
        setProgress({ current: 0, total: targetChannelIds.length, message: '채널 데이터를 불러오는 중...', isInline: true });
      }
      const fetchPromise = fetchRealVideos(
          ytKey,
          query,
          region,
          30, // Always fetch max 30 days, filter client-side with timeRange
          targetChannelIds,
          targetCategoryId,
          force,
          useSearch,
          channelsOverride || savedChannels, // Critical fix: Pass DB data for Avg Views
          isMyMode ? (current, total, channelName) => {
            setProgress({ current, total, message: channelName, isInline: true });
          } : undefined
      );

      const data = await Promise.race([fetchPromise, timeoutPromise]);

      // 로딩 완료 직전: 영상 분석 메시지 노출 (UI 개선)
      if (data && data.length > 0) {
          setProgress({ 
             current: targetChannelIds.length, 
             total: targetChannelIds.length, 
             message: `${data.length}개 영상 확보, 성과 지표 계산 중...`,
             isInline: true 
          });
          // 사용자가 메시지를 볼 수 있도록 잠시 대기
          await new Promise(resolve => setTimeout(resolve, 1200));
      } else {
          // 데이터가 없어도 최소 로딩 시간 보장
          const elapsed = Date.now() - startTime;
          const minLoadingTime = 400;
          if (elapsed < minLoadingTime) {
            await new Promise(resolve => setTimeout(resolve, minLoadingTime - elapsed));
          }
      }

      // ✅ 빈 배열 체크: API는 성공했지만 데이터가 없는 경우 캐시 사용
      if (!data || data.length === 0) {
        console.warn('API 응답이 빈 배열입니다. 캐시 확인 중...');

        // 현재 그룹의 channelHash 생성 (youtubeService와 동일한 로직)
        let currentHash = 'all';
        if (targetChannelIds.length > 0) {
          const sorted = [...targetChannelIds].sort();
          currentHash = `${sorted[0].slice(-4)}_${sorted.length}_${sorted[sorted.length - 1].slice(-4)}`;
        }

        // 같은 그룹(channelHash)의 캐시만 검색
        const allCacheKeys = Object.keys(localStorage)
          .filter(k => k.startsWith('yt_v7_cache'))
          .filter(k => k.includes(`_h:${currentHash}_`));

        console.log('그룹 캐시 개수:', allCacheKeys.length, '(hash:', currentHash, ')');

        let cachedData = null;
        let newestTimestamp = 0;

        // 가장 최근 캐시 찾기
        for (const key of allCacheKeys) {
          try {
            const cache = JSON.parse(localStorage.getItem(key) || '{}');
            if (cache.data && Array.isArray(cache.data) && cache.data.length > 0) {
              const cacheAge = Date.now() - (cache.timestamp || 0);

              // 7일 이내의 가장 최근 캐시 사용
              if (cacheAge < 7 * 24 * 60 * 60 * 1000 && cache.timestamp > newestTimestamp) {
                cachedData = cache.data;
                newestTimestamp = cache.timestamp;
              }
            }
          } catch {}
        }
        
        if (cachedData && cachedData.length > 0) {
          console.log('✅ 최근 캐시 사용:', cachedData.length, '개 (타임스탬프:', new Date(newestTimestamp).toLocaleString(), ')');
          setVideos(cachedData);
          setVisibleVideoCount(20);
          setHasPendingSync(false);
          setIsSyncNoticeDismissed(false);

          // Save to localStorage for My Mode
          if (isMyMode && activeGroupId) {
            try {
              const cacheKey = `my_monitoring_list_${activeGroupId}`;
              localStorage.setItem(cacheKey, JSON.stringify({
                videos: cachedData,
                timestamp: newestTimestamp
              }));
            } catch (e) {
              console.error('Failed to save cached videos:', e);
            }
          }
          return;
        } else {
          console.warn('사용 가능한 캐시 없음');
        }
      }

      setVideos(data);
      setVisibleVideoCount(20); // Reset pagination when new data loads
      setHasPendingSync(false); // Mark sync as complete
      setIsSyncNoticeDismissed(false);

      // Save to localStorage for My Mode
      if (isMyMode && activeGroupId && data && data.length > 0) {
        try {
          const cacheKey = `my_monitoring_list_${activeGroupId}`;
          localStorage.setItem(cacheKey, JSON.stringify({
            videos: data,
            timestamp: Date.now()
          }));
        } catch (e) {
          console.error('Failed to save videos to cache:', e);
        }
      }
    } catch (e: any) {
      // ✅ 에러 발생 시 캐시 사용 시도
      console.warn('API 에러 발생, 캐시 확인 중...', e.message);

      // 현재 그룹의 channelHash 생성
      let errorHash = 'all';
      if (targetChannelIds.length > 0) {
        const sorted = [...targetChannelIds].sort();
        errorHash = `${sorted[0].slice(-4)}_${sorted.length}_${sorted[sorted.length - 1].slice(-4)}`;
      }

      // 같은 그룹(channelHash)의 캐시만 검색
      const cacheKeys = Object.keys(localStorage)
        .filter(k => k.startsWith('yt_v7_cache'))
        .filter(k => k.includes(`_h:${errorHash}_`));
      let cachedData = null;

      for (const key of cacheKeys) {
        try {
          const cache = JSON.parse(localStorage.getItem(key) || '{}');
          if (cache.data && Array.isArray(cache.data) && cache.data.length > 0) {
            // 최근 7일 이내 캐시만 사용
            const cacheAge = Date.now() - (cache.timestamp || 0);
            if (cacheAge < 7 * 24 * 60 * 60 * 1000) {
              cachedData = cache.data;
              console.log('✅ 캐시 데이터 사용:', cachedData.length, '개');
              break;
            }
          }
        } catch {}
      }
      
      if (cachedData && cachedData.length > 0) {
        // 캐시 데이터 표시
        setVideos(cachedData);
        setVisibleVideoCount(20);

        // Save to localStorage for My Mode
        if (isMyMode && activeGroupId) {
          try {
            const cacheKey = `my_monitoring_list_${activeGroupId}`;
            localStorage.setItem(cacheKey, JSON.stringify({
              videos: cachedData,
              timestamp: Date.now()
            }));
          } catch (e) {
            console.error('Failed to save error-fallback videos:', e);
          }
        }
      } else {
        // 캐시도 없으면 에러 처리
        if (e.message && e.message.startsWith("QUOTA_INSUFFICIENT")) {
          console.warn('Quota check suggests using cache');
        } else if (e.message !== "TIMEOUT" && e.message !== "QUOTA_EXCEEDED") {
          let displayError = e.message || "Unknown Error";
          if (!displayError.toLowerCase().includes("quota")) {
             setApiError(displayError);
          }
        }
      }
    } finally {
      setLoading(false);
      setProgress(null);
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
    
    setLoading(true);
    setProgress({ current: 1, total: 100, message: "백업 파일을 분석하고 있습니다..." });

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        // Visual delay for better UX
        await new Promise(r => setTimeout(r, 600));
        
        const json = JSON.parse(event.target?.result as string);
        setProgress({ current: 60, total: 100, message: "데이터베이스 복원 중..." });
        
        await new Promise(r => setTimeout(r, 600));

        if (json.savedChannels) setSavedChannels(json.savedChannels);
        if (json.groups) setGroups(json.groups);
        
        setProgress({ current: 100, total: 100, message: "복원 완료!" });
        await new Promise(r => setTimeout(r, 500));
        
        showToast("성공적으로 복원되었습니다.");
      } catch (err) {
        showToast("올바르지 않은 파일 형식입니다.", 'error');
      } finally {
        setProgress(null);
        setLoading(false);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const isReadOnly = role === 'pending';
  const [progress, setProgress] = useState<{ current: number; total: number; message: string; isInline?: boolean } | null>(null);
  
  // --- Bulk Update Channel Stats (For Avg Views) ---
  const handleUpdateChannelStats = () => {
    if (!currentGroupChannels.length) return;
    
    setConfirmModal({
      isOpen: true,
      title: "통계 업데이트",
      message: `전체 ${currentGroupChannels.length}개 채널의 정보를 최신화하여 '평균 조회수'를 재계산하시겠습니까?\n(시간이 조금 소요될 수 있습니다)`,
      actionLabel: "업데이트 시작",
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
        setLoading(true);
        const total = currentGroupChannels.length;
        setProgress({ current: 0, total, message: "채널 정보를 분석하고 있습니다..." });
        
        let updatedCount = 0;
        
        try {
          // 1. Process Update
          const updatedChannels = [...savedChannels]; // Copy full list
          // Filter target channels that belong to current views
          const targetIds = currentGroupChannels.map(c => c.id);
          
          for (let i = 0; i < total; i++) {
              const id = targetIds[i];
              const original = updatedChannels.find(c => c.id === id);
              if (original) {
                 try {
                    // Fetch fresh info (calculates avg)
                    const info = await getChannelInfo(ytKey, original.id);
                    if (info) {
    
                       const updated = { ...original, ...info, addedAt: original.addedAt, groupId: original.groupId }; // Preserve metadata
                       
                       // Update in-memory list
                       const idx = updatedChannels.findIndex(c => c.id === id);
                       if (idx !== -1) updatedChannels[idx] = updated;
                       updatedCount++;
                       
                       // Update DB immediately
                       if (user) await saveChannelToDb(user.uid, updated);
                    }
                 } catch (e) {
                    console.warn(`Failed to update ${original.title}`, e);
                 }
              }
              // Update Progress
              setProgress({ current: i + 1, total, message: `분석 완료: ${original?.title || 'Unknown'}` });
          }
          
          setSavedChannels(updatedChannels);
          // alert(`${updatedCount}개의 채널 정보가 최신화되었습니다.`); // Remove alert, UI shows completion
          
          // Refresh videos with new stats
          await loadVideos(true);
          
        } catch (e: any) {
          console.error(e);
          setAlertMessage({ title: "오류 발생", message: `업데이트 중 오류가 발생했습니다:\n${e.message || JSON.stringify(e)}`, type: 'error' });
        } finally {
          setLoading(false);
          // Give user a moment to see 100%
          setTimeout(() => setProgress(null), 500);
        }
      }
    });
  };

  const handleActionRestricted = (callback: () => void) => {
    if (isReadOnly) {
       setAlertMessage({
         title: "멤버십 승인이 필요합니다",
         message: "현재는 둘러보기 모드입니다.\n이 기능을 사용하시려면 멤버십 승인이 필요합니다.",
         type: 'info',
         showSubscribeButton: true
       });
       return;
    }
    callback();
  };

  const handleAddChannelFromVideo = async (channelId: string, groupId: string, newGroupName?: string) => {
    if (isReadOnly) {
      setAlertMessage({
        title: "멤버십 승인이 필요합니다",
        message: "현재는 둘러보기 모드입니다.\n이 기능을 사용하시려면 멤버십 승인이 필요합니다.",
        type: 'info',
        showSubscribeButton: true
      });
      throw new Error('멤버십 승인이 필요합니다. 둘러보기 모드에서는 채널 추가가 제한됩니다.');
    }

    if (isApiKeyMissing) {
      throw new Error('유효한 YouTube API 키를 먼저 설정해주세요.');
    }

    let targetGroupId = groupId;

    // 1. 새 그룹 생성이 요청된 경우
    if (newGroupName && newGroupName.trim()) {
      try {
        const newGroup: ChannelGroup = {
          id: `group_${Date.now()}`,
          name: newGroupName.trim()
        };
        await saveGroupToDb(user!.uid, newGroup);
        setGroups(prev => [...prev, newGroup]);
        targetGroupId = newGroup.id;
      } catch (e) {
        console.error("Failed to create new group", e);
        throw new Error('새 그룹 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      }
    }

    // 2. 채널 정보 가져오기
    try {
      const channelInfo = await getChannelInfo(ytKey, channelId);

      if (!channelInfo) {
        throw new Error('채널 정보를 가져올 수 없습니다. 채널 ID가 올바른지 확인해주세요.');
      }

      // 3. 중복 확인
      const existingChannel = savedChannels.find(c => c.id === channelInfo.id);
      if (existingChannel) {
        throw new Error(`이미 추가된 채널입니다.\n\n채널명: ${channelInfo.title}`);
      }

      // 4. 채널 추가
      const finalGroupId = targetGroupId || 'unassigned';
      const newChannel: SavedChannel = {
        ...channelInfo,
        groupId: finalGroupId,
        addedAt: Date.now()
      };

      // DB에 저장
      if (user) {
        await saveChannelToDb(user.uid, newChannel);
      }

      // 상태 업데이트
      setSavedChannels(prev => [newChannel, ...prev]);
      setNewlyAddedIds(prev => [...prev, newChannel.id]);
      setHasPendingSync(true);
      setIsSyncNoticeDismissed(false);

      // 성공 알림
      setAlertMessage({
        title: "채널 추가 완료",
        message: `${channelInfo.title}\n채널이 성공적으로 추가되었습니다.`,
        type: 'info'
      });
    } catch (e: any) {
      if (e.message === 'QUOTA_EXCEEDED') {
        setAlertMessage({
          title: "API 할당량 초과",
          message: "오늘의 YouTube API 사용량을 모두 소진했습니다.\n내일 오후 5시(KST) 후에 다시 시도해주세요.",
          type: 'error'
        });
        throw new Error('YouTube API 할당량을 초과했습니다. 내일 오후 5시(KST) 이후에 다시 시도해주세요.');
      }
      throw e;
    }
  };

  const handleAddChannelBatch = async () => {
    if (isReadOnly) return handleActionRestricted(() => {});;
    if (isApiKeyMissing) return alert("유효한 YouTube API 키를 먼저 설정하세요.");
    if (!channelInput.trim()) return;
    
    const queries = channelInput.split(/[\s,\n]+/).filter(q => q.trim().length > 0);
    setLoading(true);
    
    const total = queries.length;
    setProgress({ current: 0, total, message: "채널을 검색하고 있습니다..." });

    const newChannels: SavedChannel[] = [];
    const duplicates: string[] = [];
    const existingIds = new Set(savedChannels.map(c => c.id));
    const targetGroupId = (activeGroupId === 'all') ? 'unassigned' : activeGroupId;

    try {
      for (let i = 0; i < queries.length; i++) {
        // setBatchStatus(`${queries.length}개 중 ${i + 1}번째 처리 중...`);
        const infoFinal = await getChannelInfo(ytKey, queries[i]);
        
        // Update Progress
        setProgress({ current: i + 1, total, message: infoFinal ? `등록 완료: ${infoFinal.title}` : `검색 중: ${queries[i]}` });

        if (infoFinal) {
          if (existingIds.has(infoFinal.id)) {
            duplicates.push(infoFinal.title);
          } else {
            const newChannel: SavedChannel = { ...infoFinal, groupId: targetGroupId, addedAt: Date.now() };
            newChannels.push(newChannel);
            existingIds.add(infoFinal.id);
            if (user) await saveChannelToDb(user.uid, newChannel);
          }
        }
      }
    } catch (e: any) {
      if (e.message === 'QUOTA_EXCEEDED') {
        setAlertMessage({
          title: "API 할당량 초과",
          message: "오늘의 YouTube API 사용량을 모두 소진했습니다.\n내일 오후 5시(KST) 후에 다시 시도해주세요.",
          type: 'error'
        });
        setLoading(false);
        setBatchStatus(null);
        setProgress(null);
        return;
      } else if (e.message && e.message.startsWith("QUOTA_INSUFFICIENT")) {
        setAlertMessage({
          title: "API 할당량 부족",
          message: e.message.replace("QUOTA_INSUFFICIENT: ", "") + "\n\n일부 채널만 추가하시거나 내일 오후 5시(KST) 후에 다시 시도해주세요.",
          type: 'info'
        });
        setLoading(false);
        setBatchStatus(null);
        setProgress(null);
        return;
      }
    }
    
    // Reset Progress
    setTimeout(() => setProgress(null), 800);
    
    // ... rest of logic ... (need to keep original rest logic)

    if (newChannels.length > 0) {
      setSavedChannels(prev => [...newChannels, ...prev]);
      setNewlyAddedIds(prev => [...prev, ...newChannels.map(c => c.id)]); // Track new IDs
      setHasPendingSync(true);
      setIsSyncNoticeDismissed(false);
    }
    
    setChannelInput('');
    setBatchStatus(null);
    setLoading(false);

    if (newChannels.length === 0) {
      if (duplicates.length === 0) {
        setAlertMessage({
          title: "채널을 찾을 수 없습니다",
          message: "입력한 URL, 핸들(@), 또는 채널 ID가 정확한지 확인해주세요.",
          type: 'error'
        });
      } else {
        setAlertMessage({
          title: "이미 등록된 채널입니다",
          message: `입력하신 ${duplicates.length}개의 채널은 모두 이미 등록되어 있습니다.`,
          type: 'info'
        });
      }
    } else {
      // Success Case - Show Alert instead of auto-refreshing & Prepend to Video List
      setAlertMessage({
        title: "채널 추가 완료",
        message: `${newChannels.length}개의 채널이 성공적으로 추가되었습니다.\n(리스트 최상단에 추가됨)`,
        type: 'info'
      });

      // Optimistically add to video list for immediate feedback (Fake Video Object for UI)
      // Show message about manual refresh
      setTimeout(() => {
         setAlertMessage({
            title: "추가 완료", 
            message: "채널이 리스트에 추가되었습니다.\n최신 데이터를 보려면 '분석 시작' 버튼을 눌러 새로고침해주세요.",
            type: 'info'
         });
      }, 500);
    }
    
    setChannelInput('');
    setBatchStatus(null);
  };

  const handleExplorerSearch = async () => {
    if (isReadOnly) return handleActionRestricted(() => {});
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
    if (isReadOnly) return handleActionRestricted(() => {});
    if (explorerStaging.length === 0) return;
    const existingIds = new Set(savedChannels.map(c => c.id));
    const targetGroupId = explorerTargetGroupId;
    const newChannels = explorerStaging
      .filter(ch => !existingIds.has(ch.id))
      .map(ch => ({ ...ch, groupId: targetGroupId, addedAt: Date.now() }));
      
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

  const renderRestricted = (content: React.ReactNode) => {
    if (role !== 'pending') return content;
    return (
      <div className="relative min-h-[60vh]">
         <RestrictedOverlay 
            onCheckStatus={() => { setMyPageInitialTab('dashboard'); setIsMyPageOpen(true); }}
            onSubscribe={() => {
               setIsMembershipMode(true);
               setIsUsageMode(false);
               setIsExplorerMode(false);
               setIsPackageMode(false);
               setIsShortsDetectorMode(false);
               setIsTopicMode(false);
               setIsMyMode(false);
               setIsRadarMode(false);
               setIsNationalTrendMode(false);
               setIsCategoryTrendMode(false);
               setIsComparisonMode(false);
               setIsMaterialsExplorerMode(false);
            }}
         />
         <div className="blur-sm pointer-events-none select-none opacity-40 transition-all duration-500">
            {content}
         </div>
      </div>
    );
  };

  // Shorts Detector Features


  const [detectRegion, setDetectRegion] = useState<'KR'|'US'|'JP'>('KR');

  const handleAutoDetectShorts = async (overrideRegion?: 'KR'|'US'|'JP') => {
    if (isReadOnly) return handleActionRestricted(() => {});
    if (!ytKey) return;

    const targetRegion = overrideRegion || detectRegion;
    if (overrideRegion) setDetectRegion(overrideRegion);

    setIsDetectingShorts(true);
    const regionLabel = targetRegion === 'KR' ? '한국' : (targetRegion === 'US' ? '미국' : '일본');
    setDetectorStatus(`최근 실시간 ${regionLabel} 인기 급상승 Shorts 스캔 중...`);
    // Clear previous results immediately for better UX
    setShortsDetectorResults([]);
    
    try {
      const results = await autoDetectShortsChannels(ytKey, targetRegion);
      
      setShortsDetectorResults(results);
      
      if(results.length === 0) {
        alert("최근 7일간의 추천 영상을 찾지 못했습니다. 잠시 후 다시 시도해주세요.");
      } else {
        // Save Discovery Log to DB (async)
        if (user) {
           // ... log saving logic if needed
        }
      }
      
    } catch (e: any) {
      if (e.message === 'QUOTA_EXCEEDED') {
        setAlertMessage({
          title: "API 할당량 초과",
          message: "YouTube API 일일 사용량을 모두 소진했습니다.",
          type: 'error'
        });
      } else {
        alert("탐색 중 오류가 발생했습니다: " + e.message);
      }
    } finally {
      setIsDetectingShorts(false);
      setDetectorStatus(null);
    }
  };

// ... inside return JSX
                   {/* Region Toggle */}
                   {/* Region Toggle */}
                   <div className="flex bg-slate-100 dark:bg-slate-800 rounded-lg p-1 gap-0.5 whitespace-nowrap overflow-x-auto custom-scrollbar-none">
                     <button 
                       onClick={() => setDetectRegion('KR')}
                       className={`flex-1 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                         detectRegion === 'KR' 
                         ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' 
                         : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                       }`}
                     >
                       🇰🇷 한국
                     </button>
                     <button 
                       onClick={() => setDetectRegion('US')}
                       className={`flex-1 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                         detectRegion === 'US' 
                         ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' 
                         : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                       }`}
                     >
                       🇺🇸 미국
                     </button>
                     <button 
                       onClick={() => setDetectRegion('JP')}
                       className={`flex-1 px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                         detectRegion === 'JP' 
                         ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' 
                         : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                       }`}
                     >
                       🇯🇵 일본
                     </button>
                   </div>

  const handleAnalyzeViral = async (result: AutoDetectResult) => {
    if (isApiKeyMissing) return alert("유효한 YouTube API 키를 먼저 설정하세요.");
    setAnalyzingVideoId(result.id);
    setAnalysisResult(null);

    const channelAvg = result.stats.videoCount > 0
      ? Math.max(Math.round(result.stats.viewCount / result.stats.videoCount), 100)
      : result.stats.avgViews || 1000;

    const videoData: VideoData = {
      id: result.representativeVideo.id,
      title: result.representativeVideo.title,
      channelName: result.title,
      thumbnailUrl: result.representativeVideo.thumbnail,
      duration: "Shorts",
      views: formatNumber(result.representativeVideo.views),
      avgViews: formatNumber(channelAvg),
      subscribers: formatNumber(result.stats.subscribers),
      viralScore: result.viralScore.toFixed(1) + "x",
      uploadTime: getTimeAgo(result.representativeVideo.publishedAt || result.stats.publishedAt),
      category: "Shorts",
      reachPercentage: Math.min(Math.round((result.representativeVideo.views / channelAvg) * 100), 999),
      tags: []
    };

    try {
      const analysis = await analyzeVideoVirality(videoData, ytKey);
      setAnalysisResult(analysis);
    } catch (e) {
      alert("분석 중 오류가 발생했습니다.");
    } finally {
      setAnalyzingVideoId(null);
    }
  };

  const handleAddDetectedChannel = async (result: import('./services/youtubeService').AutoDetectResult) => {
    const newChannel: SavedChannel = {
      id: result.id,
      title: result.title,
      thumbnail: result.thumbnail,
      subscriberCount: result.subscriberCount,
      videoCount: result.videoCount,
      groupId: activeGroupId === 'all' ? 'unassigned' : activeGroupId,
      addedAt: Date.now()
    };
    
    // Add to state
    setSavedChannels(prev => [...prev, newChannel]);
    setHasPendingSync(true);
    setIsSyncNoticeDismissed(false);

    // Add to DB
    if (user) {
      await saveChannelToDb(user.uid, newChannel);
    }
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

    setConfirmModal({
      isOpen: true,
      title: "그룹 삭제",
      message: "이 그룹을 정말 삭제하시겠습니까?\n포함된 채널들은 '미지정' 그룹으로 이동됩니다.",
      actionLabel: "삭제",
      isDestructive: true,
      onConfirm: () => {
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
        setConfirmModal(prev => ({ ...prev, isOpen: false })); // Close modal
      }
    });
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

  // [RBAC] 승인 대기 상태 체크 -> 전용 대기 화면 표시
  // 멤버십 승인 팝업이 떠 있으면 사용자가 확인할 때까지 대기
  if (role === 'pending' && !membershipJustApproved) {
    return <PendingApproval />;
  }
  // pending이지만 팝업이 있으면 → 팝업 먼저 보여주고 확인 후 메인으로 진입
  if (role === 'pending' && membershipJustApproved) {
    return (
      <MembershipWelcomeModal
        onClose={() => setMembershipJustApproved(null)}
        userName={membershipJustApproved.name}
        daysLeft={membershipJustApproved.daysLeft}
        plan={membershipJustApproved.plan}
        limit={membershipJustApproved.limit}
      />
    );
  }

  // [RBAC] 승인 대기 상태 체크 -> 둘러보기 모드로 전환 (차단 해제)
  // if (role === 'pending') {
  //   return <PendingApproval />;
  // }

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

  if (isPaymentResultMode) {
    return <PaymentResult />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-background-dark text-slate-900 dark:text-slate-100 font-display transition-colors duration-300">
      <Sidebar 
        theme={theme} 
        ytKey={ytKey} onYtKeyChange={setYtKey} ytApiStatus={ytApiStatus}
        region={region} onRegionChange={(val) => { setVideos([]); setRegion(val); }}
        selectedCategory={selectedCategory} onCategoryChange={(val) => { setVideos([]); setSelectedCategory(val); }}
        isMyMode={isMyMode} onToggleMyMode={(val) => { if(val) { setLoading(false); setVideos([]); setIsRadarMode(false); setIsExplorerMode(false); setIsUsageMode(false); setIsPackageMode(false); setIsShortsDetectorMode(false); setIsTopicMode(false); setIsMembershipMode(false); setIsComparisonMode(false); setIsNationalTrendMode(false); setIsCategoryTrendMode(false); setIsMaterialsExplorerMode(false); setIsScriptMode(false); setScriptModeUrl(''); } setIsMyMode(val); }}
        isExplorerMode={isExplorerMode} onToggleExplorerMode={(val) => { if(val) { setLoading(false); setIsRadarMode(false); setIsMyMode(false); setIsUsageMode(false); setIsPackageMode(false); setIsShortsDetectorMode(false); setIsTopicMode(false); setIsMembershipMode(false); setIsComparisonMode(false); setIsNationalTrendMode(false); setIsCategoryTrendMode(false); setIsMaterialsExplorerMode(false); setIsScriptMode(false); setScriptModeUrl(''); } setIsExplorerMode(val); }}
        isUsageMode={isUsageMode} onToggleUsageMode={(val) => { if(val) { setLoading(false); setIsRadarMode(false); setIsMyMode(false); setIsExplorerMode(false); setIsPackageMode(false); setIsShortsDetectorMode(false); setIsTopicMode(false); setIsMembershipMode(false); setIsComparisonMode(false); setIsNationalTrendMode(false); setIsCategoryTrendMode(false); setIsMaterialsExplorerMode(false); setIsScriptMode(false); setScriptModeUrl(''); } setIsUsageMode(val); }}
        isPackageMode={isPackageMode} onTogglePackageMode={(val) => { if(val) { setLoading(false); setIsRadarMode(false); setIsMyMode(false); setIsExplorerMode(false); setIsUsageMode(false); setIsShortsDetectorMode(false); setIsTopicMode(false); setIsMembershipMode(false); setIsComparisonMode(false); setIsNationalTrendMode(false); setIsCategoryTrendMode(false); setIsMaterialsExplorerMode(false); setIsScriptMode(false); setScriptModeUrl(''); } setIsPackageMode(val); }}
        isShortsDetectorMode={isShortsDetectorMode} onToggleShortsDetectorMode={(val) => { if (val) { setLoading(false); setIsRadarMode(false); setIsMyMode(false); setIsExplorerMode(false); setIsUsageMode(false); setIsPackageMode(false); setIsTopicMode(false); setIsMembershipMode(false); setIsComparisonMode(false); setIsNationalTrendMode(false); setIsCategoryTrendMode(false); setIsMaterialsExplorerMode(false); setIsScriptMode(false); setScriptModeUrl(''); handleAutoDetectShorts(); } setIsShortsDetectorMode(val); }}
        isTopicMode={isTopicMode} onToggleTopicMode={(val) => { if (val) { setLoading(false); setIsRadarMode(false); setIsMyMode(false); setIsExplorerMode(false); setIsUsageMode(false); setIsPackageMode(false); setIsShortsDetectorMode(false); setIsMembershipMode(false); setIsComparisonMode(false); setIsNationalTrendMode(false); setIsCategoryTrendMode(false); setIsMaterialsExplorerMode(false); setIsScriptMode(false); setScriptModeUrl(''); } setIsTopicMode(val); }}
        isMembershipMode={isMembershipMode} onToggleMembershipMode={(val) => { if(val) { setLoading(false); setIsRadarMode(false); setIsMyMode(false); setIsExplorerMode(false); setIsUsageMode(false); setIsPackageMode(false); setIsShortsDetectorMode(false); setIsTopicMode(false); setIsComparisonMode(false); setIsNationalTrendMode(false); setIsCategoryTrendMode(false); setIsMaterialsExplorerMode(false); setIsScriptMode(false); setScriptModeUrl(''); } setIsMembershipMode(val); }}
        isComparisonMode={isComparisonMode} onToggleComparisonMode={(val) => { if(val) { setLoading(false); setIsRadarMode(false); setIsMyMode(false); setIsExplorerMode(false); setIsUsageMode(false); setIsPackageMode(false); setIsShortsDetectorMode(false); setIsTopicMode(false); setIsMembershipMode(false); setIsNationalTrendMode(false); setIsCategoryTrendMode(false); setIsMaterialsExplorerMode(false); setIsScriptMode(false); setScriptModeUrl(''); } setIsComparisonMode(val); }}
        isRadarMode={isRadarMode} onToggleRadarMode={(val) => { if(val) { setLoading(false); setIsMyMode(false); setIsExplorerMode(false); setIsUsageMode(false); setIsPackageMode(false); setIsShortsDetectorMode(false); setIsTopicMode(false); setIsMembershipMode(false); setIsComparisonMode(false); setIsNationalTrendMode(false); setIsCategoryTrendMode(false); setIsMaterialsExplorerMode(false); setIsScriptMode(false); setScriptModeUrl(''); } setIsRadarMode(val); }}
        hasPendingSync={hasPendingSync}
        isSyncNoticeDismissed={isSyncNoticeDismissed}
        isApiKeyMissing={isApiKeyMissing}

        usage={usage}
        isReadOnly={role === 'pending'}
        isCollapsed={false}
        onToggleCollapse={() => {}}
        isMobileMenuOpen={isMobileMenuOpen}
        onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
        onOpenMyPage={(tab) => { setMyPageInitialTab(tab || 'dashboard'); setIsMyPageOpen(true); }}
        
        isNationalTrendMode={isNationalTrendMode}
        onToggleNationalTrendMode={(val) => { if(val) { setLoading(false); setIsRadarMode(false); setIsMyMode(false); setIsExplorerMode(false); setIsUsageMode(false); setIsPackageMode(false); setIsShortsDetectorMode(false); setIsTopicMode(false); setIsMembershipMode(false); setIsComparisonMode(false); setIsCategoryTrendMode(false); setIsMaterialsExplorerMode(false); setIsScriptMode(false); setScriptModeUrl(''); } setIsNationalTrendMode(val); }}
        isCategoryTrendMode={isCategoryTrendMode}
        onToggleCategoryTrendMode={(val) => { if(val) { setLoading(false); setIsRadarMode(false); setIsMyMode(false); setIsExplorerMode(false); setIsUsageMode(false); setIsPackageMode(false); setIsShortsDetectorMode(false); setIsTopicMode(false); setIsMembershipMode(false); setIsComparisonMode(false); setIsNationalTrendMode(false); setIsMaterialsExplorerMode(false); setIsScriptMode(false); setScriptModeUrl(''); } setIsCategoryTrendMode(val); }}
        isMaterialsExplorerMode={isMaterialsExplorerMode}
        onToggleMaterialsExplorerMode={(val) => { if(val) { setLoading(false); setIsRadarMode(false); setIsMyMode(false); setIsExplorerMode(false); setIsUsageMode(false); setIsPackageMode(false); setIsShortsDetectorMode(false); setIsTopicMode(false); setIsMembershipMode(false); setIsComparisonMode(false); setIsNationalTrendMode(false); setIsCategoryTrendMode(false); setIsScriptMode(false); setScriptModeUrl(''); } setIsMaterialsExplorerMode(val); }}
        isScriptMode={isScriptMode}
        onToggleScriptMode={(val) => { if(val) { setLoading(false); setIsRadarMode(false); setIsMyMode(false); setIsExplorerMode(false); setIsUsageMode(false); setIsPackageMode(false); setIsShortsDetectorMode(false); setIsTopicMode(false); setIsMembershipMode(false); setIsComparisonMode(false); setIsNationalTrendMode(false); setIsCategoryTrendMode(false); setIsMaterialsExplorerMode(false); setScriptModeUrl(''); } setIsScriptMode(val); }}
        userGrade={plan || 'general'}
        isAdmin={role === 'admin'}
        onShowAlert={setAlertMessage}
      />
      
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <Header
          onMobileMenuToggle={() => setIsMobileMenuOpen(true)}
          region={region}
          count={videos.length}
          theme={theme}
          onToggleTheme={() => setTheme(prev => prev === 'dark' ? 'light' : 'dark')}
          hasPendingSync={hasPendingSync}
          isApiKeyMissing={isApiKeyMissing}
          onDismissSync={() => setIsSyncNoticeDismissed(true)}
          onSync={() => loadVideos(true)}
          user={user}
          role={role}
          expiresAt={expiresAt}
          onLogout={logout}
          onOpenAdmin={() => setIsAdminOpen(true)}
          notifications={notifications}
          ytKey={ytKey}
           onMarkRead={async (id) => {
             if (user) {
               await markNotificationAsRead(user.uid, id);
               setNotifications(prev => prev.map(n => n.id === id ? {...n, isRead: true} : n));
             }
          }}
          onDeleteNotif={async (id) => {
             if (!user) return;
             await deleteNotification(user.uid, id);
             setNotifications(prev => prev.filter(n => n.id !== id));
          }}
          onOpenMyPage={(tab) => { setMyPageInitialTab(tab || 'dashboard'); setIsMyPageOpen(true); }}
          onOpenMembership={() => { 
            setIsMembershipMode(true); 
            setIsUsageMode(false); 
            setIsExplorerMode(false); 
            setIsPackageMode(false); 
            setIsShortsDetectorMode(false); 
            setIsTopicMode(false); 
            setIsMyMode(false);
            setIsComparisonMode(false);
            setIsRadarMode(false);
            setIsNationalTrendMode(false);
            setIsCategoryTrendMode(false);
            setIsMaterialsExplorerMode(false);
          }}
        />
        
        {isMyPageOpen && user && (
          <MyPageModal 
            onClose={() => setIsMyPageOpen(false)}
            initialTab={myPageInitialTab}
            user={user}
            usage={usage}
            notifications={notifications}
            onMarkRead={async (id) => {
              if (user) {
                await markNotificationAsRead(user.uid, id);
                setNotifications(prev => prev.map(n => n.id === id ? {...n, isRead: true} : n));
              }
            }}
            role={role}
            plan={plan}
            membershipTier={membershipTier}
            expiresAt={expiresAt}
            onLogout={logout}
            ytKey={ytKey}
            onYtKeyChange={setYtKey}
            ytApiStatus={ytApiStatus}
            isApiKeyMissing={isApiKeyMissing}
            onOpenUsage={() => {
              setIsMyPageOpen(false);
              setIsUsageMode(true);
            }}
          />
        )}


        


        {isAdminOpen && (role === 'admin' || role === 'approved') && <AdminDashboard onClose={() => setIsAdminOpen(false)} apiKey={ytKey} />}
        {analysisResult && <AnalysisResultModal result={analysisResult} onClose={() => setAnalysisResult(null)} />}
        {showGuestNotice && user && role !== 'admin' && role !== 'approved' && (
          <GuestNoticeModal 
            userName={user.displayName || 'Guest'} 
            onClose={() => setShowGuestNotice(false)} 
            onSubscribe={() => {
              setShowGuestNotice(false);
              setIsMembershipMode(true);
              setIsUsageMode(false);
              setIsExplorerMode(false);
              setIsPackageMode(false);
              setIsShortsDetectorMode(false);
              setIsTopicMode(false);
              setIsMyMode(false);
              setIsComparisonMode(false);
              setIsRadarMode(false);
              setIsNationalTrendMode(false);
              setIsCategoryTrendMode(false);
              setIsMaterialsExplorerMode(false);
              setIsScriptMode(false);
            }} 
          />
      )}  <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
        {isMembershipMode ? (
          <MembershipPage />
        ) : isScriptMode ? (
          <div className="w-full p-6 md:p-10 flex flex-col relative">
            <ScriptExtractor 
              apiKey={ytKey} 
              initialUrl={scriptModeUrl} 
              usage={usage}
              onUsageUpdate={handleApiUsage}
            />
          </div>
        ) : isMaterialsExplorerMode ? (
            <div className="w-full">
              <MaterialsExplorer
                apiKey={ytKey}
                groups={groups}
                onSave={handleSaveMaterials}
                onClose={() => setIsMaterialsExplorerMode(false)}
                onAddChannel={handleAddChannelFromVideo}
              />
            </div>
        ) : isComparisonMode ? (
            <div className="w-full">
              <ComparisonView
                channels={comparisonChannels}
                allChannels={savedChannels}
                apiKey={ytKey}
                onClose={() => {
                  setIsComparisonMode(false);
                  setComparisonChannels([]);
                }}
                onUpdateChannels={setComparisonChannels}
              />
            </div>
        ) : (
        <div className="w-full p-6 md:p-10 flex flex-col relative">
          {isPackageMode || isTopicMode ? renderRestricted(
             <RecommendedPackageList
                packages={(isPackageMode ? recommendedPackages : recommendedTopics).filter(p => !hiddenItemIds.includes(p.id))}
                onAdd={(pkg, groupId, newName) => handleActionRestricted(() => handleAddPackageToMyList(pkg, groupId, newName))}
                onDismiss={(pkgId) => {
                  setConfirmModal({
                    isOpen: true,
                    title: '이 게시글 숨기기',
                    message: '상세 내용 검토가 끝났나요?\n이 게시글은 목록에서 숨김 처리됩니다.\n숨김처리 후 되돌릴 수 없습니다.',
                    actionLabel: '숨기기',
                    onConfirm: () => {
                      dismissItem(pkgId);
                      setConfirmModal(prev => ({ ...prev, isOpen: false }));
                    }
                  });
                }}
                isAdding={false} 
                groups={groups}
                activeGroupId={activeGroupId}
                mode={isPackageMode ? "package" : "topic"}
                savedChannels={savedChannels}
             />
          ) : isShortsDetectorMode ? (
             <div className="space-y-8 pb-20 animate-in slide-in-from-right-4 duration-500">
               <div className="space-y-6">
                 <div className="space-y-2">
                   <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-rose-500 uppercase flex items-center gap-3">
                     <span className="material-symbols-outlined text-2xl md:text-3xl">bolt</span>
                     오늘 뜨는 쇼츠 채널 찾기
                   </h2>
                    <p className="text-slate-500 text-[11px] font-medium leading-relaxed hidden md:block">
                      키워드나 조건 없이, <span className="text-emerald-500 font-bold">최근 7일간 YouTube가 추천하는 다양한 쇼츠</span>를 탐색합니다.<br />
                      마치 쇼츠 피드를 넘기듯 <span className="text-rose-500 font-bold">이번 주 트렌드</span>를 무작위로 발견해보세요.
                    </p>
                 </div>

                 <div className="flex flex-col md:flex-row items-center gap-3 md:gap-4">
                   {/* Region Toggle Buttons (GLOBAL / KR / US) */}
                   {/* Region Toggle Buttons (KR / US / JP) */}
                   <div className="flex w-full md:w-auto bg-slate-100 dark:bg-slate-800 rounded-lg p-1 gap-0.5">
                     <button 
                       onClick={() => handleAutoDetectShorts('KR')}
                       className={`flex-1 md:flex-none px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                         detectRegion === 'KR' 
                         ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' 
                         : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                       }`}
                     >
                       🇰🇷 한국
                     </button>
                     <button 
                       onClick={() => handleAutoDetectShorts('US')}
                       className={`flex-1 md:flex-none px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                         detectRegion === 'US' 
                         ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' 
                         : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                       }`}
                     >
                       🇺🇸 미국
                     </button>
                     <button 
                       onClick={() => handleAutoDetectShorts('JP')}
                       className={`flex-1 md:flex-none px-3 py-1.5 rounded-md text-xs font-bold transition-all ${
                         detectRegion === 'JP' 
                         ? 'bg-white dark:bg-slate-700 shadow text-slate-900 dark:text-white' 
                         : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                       }`}
                     >
                       🇯🇵 일본
                     </button>
                   </div> 


                    {isDetectingShorts && (
                      <div className="flex items-center gap-2 bg-rose-500/10 text-rose-500 px-4 py-2 rounded-xl text-[11px] font-black animate-pulse border border-rose-500/20">
                        <span className="material-symbols-outlined animate-spin text-sm">sync</span>
                        {detectorStatus || '탐색 중...'}
                      </div>
                    )}
                   {shortsDetectorResults.length > 0 && !isDetectingShorts && (
                      <div className="text-xs font-bold text-slate-500">
                         {shortsDetectorResults.length}개의 유망 채널 발견됨
                      </div>
                   )}
                 </div>
               </div>

               {shortsDetectorResults.length > 0 && (
                 <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-2 md:gap-3">
                   {shortsDetectorResults.map((result, idx) => {
                      const isAdded = savedChannels.some(sc => sc.id === result.id);
                      // 시간 보정 부스터 계산 (카드 표시용)
                      const _chAvg = result.stats.videoCount > 0
                        ? Math.max(Math.round(result.stats.viewCount / result.stats.videoCount), 100) : 1000;
                      const _pubDate = result.representativeVideo.publishedAt || result.stats.publishedAt;
                      const _hrs = Math.max((Date.now() - new Date(_pubDate).getTime()) / 3600000, 1);
                      const _tf = Math.max(Math.min(Math.pow(_hrs / 168, 0.5), 1), 0.3);
                      const cardBooster = result.representativeVideo.views / Math.max(_chAvg * _tf, 100);

                      return (
                        <div key={`${result.id}-${idx}`} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden hover:shadow-lg transition-shadow group relative">
                           {/* Rank Badge (Optional) */}
                           <div className="absolute top-1.5 left-1.5 z-10 bg-black/80 text-white text-[9px] font-bold px-1.5 py-0.5 rounded backdrop-blur-md border border-white/10">
                             #{idx + 1}
                           </div>

                           {/* Booster Score Badge */}
                           {cardBooster >= 1.5 && (
                              <div className="absolute top-1.5 right-1.5 z-10 bg-indigo-500 text-white text-[9px] font-black px-1.5 py-0.5 rounded backdrop-blur-md shadow-lg shadow-indigo-500/50 flex items-center gap-0.5 animate-in zoom-in spin-in-3 duration-500">
                                 <span className="material-symbols-outlined text-[10px] animate-pulse">local_fire_department</span>
                                 {cardBooster.toFixed(1)}x
                              </div>
                           )}

                           <div 
                             onClick={() => handleOpenAutoDetectDetail(result)}
                             className="block group/video cursor-pointer relative aspect-[9/16] bg-slate-100 dark:bg-slate-800 overflow-hidden"
                           >
                              <img src={result.representativeVideo.thumbnail} className="w-full h-full object-cover group-hover/video:scale-105 transition-transform duration-500 opacity-90 group-hover:opacity-100" alt="" />
                              <div className="absolute inset-0 bg-black/10 group-hover/video:bg-transparent transition-colors"></div>
                              <div className="absolute bottom-2 right-2 bg-black/60 backdrop-blur-sm text-white text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1">
                                 <span className="material-symbols-outlined text-[10px]">play_arrow</span>
                                 {formatNumber(result.representativeVideo.views)}
                              </div>
                           </div>
                           
                           <div className="p-2 space-y-2">
                              <a href={`https://www.youtube.com/channel/${result.id}`} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="flex items-center gap-1.5 group/channel hover:bg-slate-50 dark:hover:bg-slate-800/50 p-1 -ml-1 rounded transition-colors">
                                <img src={result.thumbnail} className="size-5 rounded-full border border-slate-100 dark:border-slate-700" alt="" />
                                <div className="flex-1 min-w-0">
                                  <h3 className="font-bold text-[11px] text-slate-900 dark:text-white truncate group-hover/channel:text-primary transition-colors">{result.title}</h3>
                                  <div className="flex items-center gap-1 text-[9px] text-slate-400">
                                    <span>구독 {formatNumber(result.stats.subscribers)}</span>
                                  </div>
                                </div>
                              </a>
                              
                              <div className="flex justify-between items-center px-1">
                                 <span className="text-[9px] text-slate-500 font-medium">조회수 {formatNumber(result.representativeVideo.views)}</span>
                                 <span className="text-[9px] text-slate-400">{getTimeAgo(result.representativeVideo.publishedAt || result.stats.publishedAt)}</span>
                              </div>

                             <button 
                               onClick={() => handleAddDetectedChannel(result)}
                               disabled={isAdded}
                               className={`w-full py-2 rounded-lg text-[9px] font-bold transition-all flex items-center justify-center gap-1 ${
                                 isAdded 
                                 ? 'bg-slate-100 text-slate-400 cursor-not-allowed' 
                                 : 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:bg-rose-500 hover:text-white dark:hover:bg-rose-500 dark:hover:text-white'
                               }`}
                             >
                               {isAdded ? (
                                 <><span className="material-symbols-outlined text-[10px]">check</span> 추가됨</>
                               ) : (
                                 <>내 리스트에 채널 추가</>
                               )}
                             </button>
                           </div>
                        </div>
                      );
                   })}
                 </div>
               )}
             </div>
          ) : isNationalTrendMode ? (
            <div className="space-y-6 pb-20 animate-in slide-in-from-right-4 duration-500">
              <div className="space-y-4">
                  <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-indigo-600 dark:text-indigo-400 uppercase flex items-center gap-3">
                    <span className="material-symbols-outlined text-2xl md:text-3xl">public</span>
                    실시간 국가 트렌드
                  </h2>
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'KR', name: '한국', icon: '🇰🇷' },
                      { id: 'US', name: '미국', icon: '🇺🇸' },
                      { id: 'JP', name: '일본', icon: '🇯🇵' },
                      { id: 'GB', name: '영국', icon: '🇬🇧' },
                    ].map(country => (
                      <button
                        key={country.id}
                        onClick={() => {
                          setRegion(country.id);
                          setSelectedCategory(''); // Reset category
                          // loadVideos(true); // Triggered by useEffect dependency
                        }}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 border ${
                          region === country.id
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg scale-105'
                            : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >
                        <span className="text-base">{country.icon}</span>
                        {country.name}
                      </button>
                    ))}
                  </div>
              </div>
              
              {/* Reuse Video List Logic */}
              <div className="space-y-6">
                {loading ? (
                    <div className="py-20 flex flex-col items-center justify-center gap-5">
                      <div className="size-10 border-2 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
                      <p className="text-slate-400 text-xs font-black uppercase tracking-widest animate-pulse">트렌드 분석 중...</p>
                    </div>
                ) : videos.length > 0 ? (
                  videos
                    .filter((video, index, self) => self.slice(0, index).filter(v => (v.channelId || v.channelName) === (video.channelId || video.channelName)).length < 2)
                    .map((video) => (
                      <VideoCard 
                          key={video.id} 
                          video={video} 
                          onClick={() => setDetailedVideo(video)} 
                      />
                  ))
                ) : (
                  <div className="py-20 text-center text-slate-400 font-bold text-sm">트렌드 데이터를 불러오는 중이거나 데이터가 없습니다.</div>
                )}
              </div>
            </div>

          ) : isCategoryTrendMode ? (
            <div className="space-y-6 pb-20 animate-in slide-in-from-right-4 duration-500">
               <div className="space-y-4">
                  <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-indigo-600 dark:text-indigo-400 uppercase flex items-center gap-3">
                    <span className="material-symbols-outlined text-2xl md:text-3xl">category</span>
                    실시간 카테고리 트렌드
                  </h2>
                  
                  {/* 1. Country Selection */}
                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'KR', name: '한국', icon: '🇰🇷' },
                      { id: 'US', name: '미국', icon: '🇺🇸' },
                      { id: 'JP', name: '일본', icon: '🇯🇵' },
                    ].map(country => (
                      <button
                        key={country.id}
                        onClick={() => {
                          setRegion(country.id);
                          // loadVideos(true); // Triggered effect
                        }}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all flex items-center gap-2 border ${
                          region === country.id
                            ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg'
                            : 'bg-white dark:bg-slate-800 text-slate-500 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                        }`}
                      >
                        <span className="text-base">{country.icon}</span>
                        {country.name}
                      </button>
                    ))}
                  </div>

                  {/* 2. Category Selection */}
                  <div className="flex flex-wrap gap-2">
                    {CATEGORIES.map(cat => (
                      <button
                        key={cat.id}
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-all border ${
                          selectedCategory === cat.id
                            ? 'bg-slate-800 text-white border-slate-800'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 border-transparent hover:bg-slate-200'
                        }`}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>
              </div>

               {/* Reuse Video List Logic */}
               <div className="space-y-6">
                {loading ? (
                    <div className="py-20 flex flex-col items-center justify-center gap-5">
                      <div className="size-10 border-2 border-indigo-600/20 border-t-indigo-600 rounded-full animate-spin"></div>
                      <p className="text-slate-400 text-xs font-black uppercase tracking-widest animate-pulse">카테고리 트렌드 분석 중...</p>
                    </div>
                ) : videos.length > 0 ? (
                  videos
                    .filter((video, index, self) => self.slice(0, index).filter(v => (v.channelId || v.channelName) === (video.channelId || video.channelName)).length < 2)
                    .map((video) => (
                      <VideoCard 
                          key={video.id} 
                          video={video} 
                          onClick={() => setDetailedVideo(video)} 
                      />
                  ))
                ) : (
                  <div className="py-20 text-center text-slate-400 font-bold text-sm">데이터를 불러오는 중입니다.</div>
                )}
              </div>
            </div>

          ) : isRadarMode ? (
            <div className="space-y-6 pb-20 animate-in slide-in-from-right-4 duration-500">
              <ChannelRadar
                apiKey={ytKey}
                onClose={() => setIsRadarMode(false)}
                initialQuery={radarInitialQuery}
                onVideoClick={(video) => {
                  // 시간 보정 부스터 계산: 업로드 경과 시간 대비 성과 반영
                  const hoursSince = Math.max((Date.now() - new Date(video.publishedAt).getTime()) / (1000 * 60 * 60), 1);
                  const timeFactor = Math.max(Math.min(Math.pow(hoursSince / 168, 0.5), 1), 0.3);
                  const timeAdjustedBooster = video.performanceRatio / timeFactor;

                  setDetailedVideo({
                    id: video.id,
                    title: video.title,
                    channelName: video.channelName,
                    channelId: video.channelId,
                    thumbnailUrl: video.thumbnailUrl,
                    duration: video.duration,
                    views: video.views,
                    avgViews: video.avgViews,
                    subscribers: video.subscribers,
                    viralScore: timeAdjustedBooster.toFixed(1) + 'x',
                    publishedAt: video.publishedAt,
                    uploadTime: video.uploadTime,
                    category: video.category,
                    reachPercentage: Math.min(Math.round(video.performanceRatio * 100), 999),
                    tags: video.tags || []
                  });
                }}
              />
            </div>

          ) : isUsageMode ? (
            <div className="space-y-6 md:space-y-8 pb-20 animate-in slide-in-from-right-4 duration-500">
              <div className="bg-white dark:bg-slate-card/60 border border-slate-200 dark:border-slate-800 p-6 md:p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 p-6 md:p-10 opacity-5 pointer-events-none">
                  <span className="material-symbols-outlined text-[80px] md:text-[150px] text-primary">analytics</span>
                </div>

                <div className="space-y-4 max-w-2xl relative z-10">
                  <h2 className="text-2xl md:text-3xl font-black italic tracking-tighter text-primary uppercase flex items-center gap-3 md:gap-4">
                    <span className="material-symbols-outlined text-3xl md:text-4xl">dashboard_customize</span>
                    API 사용량 대시보드
                  </h2>
                  <p className="text-slate-500 dark:text-slate-400 text-sm font-medium leading-relaxed">
                    실시간으로 YouTube API 할당량(Quota) 소모 상태를 모니터링합니다. <br />
                    구글 개발자 콘솔의 실제 사용량과는 소폭 차이가 있을 수 있으므로, <b>참고용</b>으로만 활용해 주세요.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6 mt-8 md:mt-12 relative z-10">
                  <div className="bg-slate-50 dark:bg-black/20 p-6 md:p-8 rounded-3xl border border-slate-100 dark:border-white/5 space-y-4 md:space-y-6">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] md:text-[11px] font-black text-slate-400 uppercase tracking-widest">오늘의 잔량</span>
                      <span className="material-symbols-outlined text-emerald-500">check_circle</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white tabular-nums tracking-tighter">
                        {isApiKeyMissing ? '0' : (usage.total - usage.used).toLocaleString()}
                      </p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">잔여 LP / 10,000</p>
                      {(usage.bonusPoints || 0) > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                          <p className="text-xs font-bold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                            <span className="material-symbols-outlined text-sm">stars</span>
                            보너스: +{(usage.bonusPoints || 0).toLocaleString()} P
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-black/20 p-6 md:p-8 rounded-3xl border border-slate-100 dark:border-white/5 space-y-4 md:space-y-6">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] md:text-[11px] font-black text-slate-400 uppercase tracking-widest">소모된 할당량</span>
                      <span className="material-symbols-outlined text-primary">data_usage</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white tabular-nums tracking-tighter">
                        {isApiKeyMissing ? '0' : usage.used.toLocaleString()}
                      </p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">오늘 소모된 유닛</p>
                    </div>
                  </div>

                  <div className="bg-slate-50 dark:bg-black/20 p-6 md:p-8 rounded-3xl border border-slate-100 dark:border-white/5 space-y-4 md:space-y-6">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] md:text-[11px] font-black text-slate-400 uppercase tracking-widest">다음 초기화</span>
                      <span className="material-symbols-outlined text-accent-hot">schedule</span>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xl md:text-2xl font-black text-slate-900 dark:text-white uppercase tracking-tighter">
                        오늘 자정 (KST)
                      </p>
                      <p className="text-[10px] font-bold text-slate-500 uppercase tracking-tighter">자동 리셋 주기</p>
                    </div>
                  </div>
                </div>

                <div className="mt-12 bg-primary/5 border border-primary/20 p-8 rounded-3xl space-y-6">
                  <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                    <span className="material-symbols-outlined text-sm">info</span>
                    포인트 사용량 분석
                  </h3>
                  
                  {/* Bonus Points Display */}
                  {(usage.bonusPoints || 0) > 0 && (
                    <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-2 border-amber-200 dark:border-amber-800 p-6 rounded-2xl mb-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="size-12 bg-amber-500 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/30">
                            <span className="material-symbols-outlined text-white text-2xl">stars</span>
                          </div>
                          <div>
                            <p className="text-sm font-black text-amber-900 dark:text-amber-100">보너스 포인트</p>
                            <p className="text-[10px] font-bold text-amber-600 dark:text-amber-400">관리자 보상으로 받은 추가 포인트</p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-3xl font-black text-amber-600 dark:text-amber-400 tabular-nums">
                            +{(usage.bonusPoints || 0).toLocaleString()}
                          </p>
                          <p className="text-[10px] font-bold text-amber-500 uppercase">BONUS POINTS</p>
                        </div>
                      </div>
                      <div className="bg-white/60 dark:bg-black/20 rounded-lg p-3 border border-amber-200/50 dark:border-amber-800/50">
                        <p className="text-[10px] text-amber-800 dark:text-amber-200 font-bold leading-relaxed">
                          💡 <b>보너스 포인트는 매일 초기화되지 않습니다!</b> 일일 할당량을 모두 사용한 후에도 보너스 포인트로 계속 이용할 수 있으며, 사용 시에만 차감됩니다.
                        </p>
                      </div>
                    </div>
                  )}

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
                    ※ 매일 오후 5시(KST)에 초기화되어 충분히 사용 가능합니다. 실버등급의 경우 매일 2천포인트가 지급되고 골드등급의 경우 매일 5천포인트가 지급이 됩니다.
                  </p>
                </div>
                <div className="mt-6 bg-slate-50 dark:bg-slate-900/30 border border-slate-200 dark:border-slate-800 rounded-3xl p-6">
                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-500 mb-4 px-2">포인트 사용 기록 (오늘)</h3>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-2">
                    {usage.logs && usage.logs.length > 0 ? (
                      usage.logs.map((log, index) => (
                        <div key={index} className={`flex items-center justify-between text-[10px] p-2 rounded-lg border ${
                          log.type === 'bonus' 
                            ? 'bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-900/20 dark:to-orange-900/20 border-amber-200 dark:border-amber-800' 
                            : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-white/5'
                        }`}>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-slate-400">{new Date(log.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                            <span className={`font-bold uppercase px-1.5 py-0.5 rounded ${
                              log.type === 'bonus' 
                                ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' 
                                : log.type === 'search' 
                                ? 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400' 
                                : log.type === 'script' 
                                ? 'bg-amber-100 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400' 
                                : 'bg-blue-100 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400'
                            }`}>
                              {log.type === 'bonus' ? '⭐ BONUS' : log.type === 'search' ? 'SEARCH' : log.type === 'script' ? 'SCRIPT' : 'LIST'}
                            </span>
                            <span className="text-slate-600 dark:text-slate-300 font-medium truncate max-w-[150px]">{log.details}</span>
                          </div>
                          <span className={`font-black ${log.type === 'bonus' ? 'text-amber-600 dark:text-amber-400' : 'text-rose-500'}`}>
                            {log.type === 'bonus' ? `+${Math.abs(Number(log.cost))}` : `-${log.cost}`}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-8 text-slate-400 text-[10px] font-medium italic">
                        오늘 기록된 포인트 사용 내역이 없습니다.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

          ) : isExplorerMode ? (
            <div className="flex-1 flex flex-col justify-start min-h-[70vh] space-y-8 pb-20 animate-in slide-in-from-right-4 duration-500">
              <div className="space-y-6">
                <div className="space-y-2">
                  <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-emerald-500 uppercase flex items-center gap-3">
                    <span className="material-symbols-outlined">search_insights</span>
                    키워드 검색 채널 수집
                  </h2>
                  <p className="text-slate-500 text-[11px] font-medium leading-relaxed hidden md:block">
                    키워드로 새로운 유튜브 채널을 발굴하세요. <b>한 번의 검색으로 50개의 채널</b>을 탐색할 수 있습니다.<br />
                    아래 결과에서 선택하여 검토 영역에 담은 후, <span className="text-emerald-500 font-bold">내 모니터링 리스트</span>에 일괄 추가하세요.
                  </p>
                </div>

                <div className="flex flex-row gap-2">
                  <div className="flex-1 flex items-center bg-white dark:bg-background-dark border border-slate-200 dark:border-slate-700 rounded-xl px-4 shadow-inner">
                    <span className="material-symbols-outlined text-slate-400 mr-2 md:mr-3 text-lg md:text-2xl">search</span>
                    <input 
                      type="text"
                      value={explorerQuery}
                      onChange={(e) => setExplorerQuery(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleExplorerSearch()}
                      placeholder="키워드 입력..."
                      className="w-full bg-transparent border-none py-3 text-xs text-slate-900 dark:text-white focus:ring-0 outline-none placeholder:truncate"
                    />
                  </div>
                  <button onClick={handleExplorerSearch} disabled={isExplorerSearching} className={`w-auto text-white px-4 md:px-8 h-12 rounded-xl text-xs font-black uppercase shadow-lg hover:scale-105 transition-all shrink-0 flex items-center justify-center ${
                    isExplorerSearching ? 'bg-emerald-500 opacity-60 cursor-wait' : 'bg-emerald-500'
                  }`}>
                    <span className="hidden md:inline">{isExplorerSearching ? '탐색 중...' : '채널 검색'}</span>
                    <span className="md:hidden"><span className="material-symbols-outlined text-lg leading-none">search</span></span>
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
                      <div className="flex flex-row items-center gap-2 w-full md:w-auto">
                         <div className="flex items-center gap-2 flex-1 min-w-0 md:w-auto">
                            <span className="text-[10px] font-black text-slate-400 uppercase whitespace-nowrap hidden md:inline">저장할 그룹:</span>
                            <select 
                                value={explorerTargetGroupId}
                                onChange={(e) => setExplorerTargetGroupId(e.target.value)}
                                className="flex-1 md:flex-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg pl-3 pr-8 py-2 text-[11px] font-bold outline-none focus:border-emerald-500 transition-colors cursor-pointer w-full md:w-40"
                            >
                                {groups.filter(g => g.id !== 'all').map(g => (
                                    <option key={g.id} value={g.id}>{g.name}</option>
                                ))}
                            </select>
                         </div>
                         <button onClick={() => setExplorerStaging([])} className="hidden md:block text-[10px] font-black uppercase text-slate-400 hover:text-rose-500 transition-colors px-3 py-2 bg-slate-100 dark:bg-slate-800 md:bg-transparent md:dark:bg-transparent rounded-lg">비우기</button>
                         <button 
                            onClick={commitStagingToSaved}
                            disabled={explorerStaging.length === 0}
                            className={`flex-none px-4 md:px-6 py-2.5 rounded-xl text-[11px] font-black uppercase shadow-lg transition-all ${
                               explorerStaging.length > 0 
                               ? 'bg-emerald-500 text-white hover:scale-105 active:scale-95' 
                               : 'bg-slate-200 dark:bg-slate-800 text-slate-400 grayscale cursor-not-allowed'
                            }`}
                         >
                            <span className="hidden md:inline">선택한 {explorerStaging.length}개 채널 모니터링 등록</span>
                            <span className="md:hidden">{explorerStaging.length}개 등록</span>
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
          ) : isMyMode && (<>
            <style>{`
              @keyframes neon-blink {
                0%, 100% { box-shadow: 0 0 10px rgba(19, 55, 236, 0.4), 0 0 20px rgba(19, 55, 236, 0.2); border-color: rgba(19, 55, 236, 0.6); }
                50% { box-shadow: 0 0 25px rgba(19, 55, 236, 0.8), 0 0 45px rgba(19, 55, 236, 0.4); border-color: rgba(19, 55, 236, 1); transform: scale(1.02); }
              }
              .neon-blink-btn {
                animation: neon-blink 1.5s infinite ease-in-out;
              }
            `}</style>
            <div className="space-y-4 pb-6 animate-in slide-in-from-right-4 duration-500">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="space-y-2">
                    <h2 className="text-2xl font-black italic tracking-tighter text-slate-900 dark:text-white uppercase flex items-center gap-3">
                      <span className="material-symbols-outlined text-accent-hot">hub</span>
                      내 모니터링 리스트
                    </h2>
                    <p className="text-slate-500 text-[11px] font-medium leading-relaxed">
                      모니터링할 유튜브 채널을 추가하세요. <br />
                      추가된 채널들의 신규 영상은 <span className="text-accent-hot font-bold">실시간 통합 피드</span>에서 분석됩니다.
                    </p>
                  </div>
                  

                </div>

                <div className="flex flex-row gap-2 items-center mb-8">
                  <div className="flex-1 flex flex-col gap-2 justify-center min-w-0">
                    <textarea 
                      value={channelInput} onChange={(e) => setChannelInput(e.target.value)}
                      placeholder="채널 추가..."
                      className="w-full bg-white dark:bg-background-dark border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-3 text-xs text-slate-900 dark:text-white focus:border-accent-neon outline-none transition-all shadow-inner resize-none h-12 flex items-center pt-3.5 placeholder:truncate"
                    />
                    <p className="text-[9px] text-slate-400 dark:text-slate-500 font-bold px-1 uppercase tracking-tighter italic hidden sm:block">※ 채널 주소 입력 시 자동으로 데이터가 수집 목록에 구성됩니다.</p>
                  </div>
                  <div className="flex items-center gap-1 md:gap-2 h-12 self-start mt-0 sm:mt-0 shrink-0 relative">
                    <button onClick={handleAddChannelBatch} disabled={loading} className="bg-accent-hot text-white w-12 md:w-auto px-0 md:px-8 h-full rounded-xl text-xs font-black uppercase shadow-lg hover:scale-105 transition-all shrink-0 disabled:opacity-50 flex items-center justify-center">
                        <span className="hidden md:inline">{loading ? '처리 중...' : '채널 추가'}</span>
                        <span className="md:hidden material-symbols-outlined">add</span>
                    </button>
                    <div className="w-px h-8 bg-slate-300 dark:bg-white/10 mx-0.5 hidden md:block"></div>
                    
                    {hasPendingSync && !isApiKeyMissing && !isSyncNoticeDismissed && (
                      <div className="absolute bottom-full mb-3 right-0 bg-accent-hot text-white text-[10px] font-black px-4 py-2 rounded-xl shadow-[0_0_20px_rgba(255,0,85,0.4)] animate-bounce flex items-center gap-2 whitespace-nowrap z-50">
                        <span className="material-symbols-outlined text-sm animate-pulse">sync_problem</span>
                        <span className="hidden md:inline">내 모니터링 리스트 메뉴 에서 동기화 필요</span>
                        <span className="md:hidden">동기화 필요</span>
                        <button onClick={() => setIsSyncNoticeDismissed(true)} className="ml-1 hover:opacity-70 transition-opacity p-0.5 leading-none"><span className="material-symbols-outlined text-[14px]">close</span></button>
                        <div className="absolute -bottom-1.5 right-4 size-3 bg-accent-hot rotate-45"></div>
                      </div>
                    )}
                    <button onClick={handleExport} title="내보내기" className="h-full w-10 md:w-14 shrink-0 bg-white dark:bg-slate-900 substrate-detailed border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-center text-slate-500 hover:text-accent-neon transition-all"><span className="material-symbols-outlined text-[18px] md:text-[24px]">download</span></button>
                    <button onClick={() => importInputRef.current?.click()} title="가져오기" className="h-full w-10 md:w-14 shrink-0 bg-white dark:bg-slate-900 substrate-detailed border border-slate-200 dark:border-slate-800 rounded-xl flex items-center justify-center text-slate-500 hover:text-accent-neon transition-all"><span className="material-symbols-outlined text-[18px] md:text-[24px]">upload_file</span></button>
                    <input type="file" ref={importInputRef} onChange={handleImport} accept=".json" className="hidden" />
                    <button 
                      onClick={() => loadVideos(true)} 
                      title="새로고침" 
                      className={`h-full w-10 md:w-14 shrink-0 border rounded-xl flex items-center justify-center transition-all ${
                        hasPendingSync && !isApiKeyMissing && !isSyncNoticeDismissed
                        ? 'bg-accent-hot text-white border-transparent ring-4 ring-accent-hot/20 animate-pulse' 
                        : 'bg-white dark:bg-slate-900 substrate-detailed border-slate-200 dark:border-slate-800 text-slate-500 hover:text-accent-neon'
                      }`}
                    >
                      <span className={`material-symbols-outlined ${loading ? 'animate-spin' : ''} text-[18px] md:text-[24px]`}>refresh</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="relative">
                <style>{`
                  .no-scrollbar::-webkit-scrollbar { display: none; }
                  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
                `}</style>
                <div className="flex flex-nowrap md:flex-wrap items-center gap-3 pb-4 border-b border-slate-100 dark:border-white/5 overflow-x-auto md:overflow-visible no-scrollbar pr-12 md:pr-0">
                {sortedGroups.map(group => (
                  <div key={group.id} className="relative group/tab shrink-0">
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
                   <div className="shrink-0">
                    <button onClick={() => setIsAddingGroup(true)} className="size-10 rounded-xl bg-slate-100 dark:bg-white/5 text-slate-500 hover:text-primary flex items-center justify-center transition-all border border-dashed border-slate-300 dark:border-slate-700 hover:border-primary shrink-0"><span className="material-symbols-outlined">add</span></button>
                   </div>
                ) : (
                  <div className="flex items-center gap-1 bg-slate-100 dark:bg-white/5 p-1.5 rounded-xl border border-primary/30 animate-in slide-in-from-left-2 duration-200 shrink-0">
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
                <div className="absolute top-0 right-0 bottom-4 w-16 bg-gradient-to-l from-white dark:from-[#0f1014] to-transparent pointer-events-none md:hidden flex items-center justify-end pr-2">
                   <span className="material-symbols-outlined text-slate-300 dark:text-slate-600 animate-pulse">chevron_right</span>
                </div>
              </div>

              <div className="relative flex flex-row items-center gap-2 sm:justify-between px-1 mt-4 overflow-x-auto no-scrollbar pb-2">
                  <div className="relative w-40 sm:w-64 shrink-0">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 material-symbols-outlined text-[16px] text-slate-400">search</span>
                    <input 
                      type="text" 
                      value={channelFilterQuery}
                      onChange={(e) => setChannelFilterQuery(e.target.value)}
                      placeholder="채널 검색..." 
                      className="w-full pl-9 pr-3 py-2 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl text-xs font-bold focus:ring-1 focus:ring-primary focus:border-primary transition-all text-slate-900 dark:text-white placeholder:text-slate-400"
                    />
                    {channelFilterQuery && (
                      <button onClick={() => setChannelFilterQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-rose-500">
                        <span className="material-symbols-outlined text-[16px]">cancel</span>
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                  <button 
                    onClick={() => setChannelSortMode(prev => prev === 'latest' ? 'name' : 'latest')}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold text-slate-500 hover:text-primary transition-all shrink-0 whitespace-nowrap"
                    title={channelSortMode === 'latest' ? '최신순 (등록 역순)' : '이름순 (가나다)'}
                  >
                    <span className="material-symbols-outlined text-[16px]">{channelSortMode === 'latest' ? 'schedule' : 'sort_by_alpha'}</span>
                    <span>{channelSortMode === 'latest' ? '최신순' : '이름순'}</span>
                  </button>

                  <button 
                    onClick={handleSelectAllInCurrentGroup}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-black uppercase text-slate-500 hover:text-primary transition-all shrink-0 whitespace-nowrap"
                  >
                    <span className="material-symbols-outlined text-[16px]">
                      {currentGroupChannels.length > 0 && currentGroupChannels.every(c => selectedChannelIds.includes(c.id)) ? 'check_box' : 'check_box_outline_blank'}
                    </span>
                    {currentGroupChannels.length > 0 && currentGroupChannels.every(c => selectedChannelIds.includes(c.id)) ? '전체 해제' : '전체 선택'}
                  </button>

                  {selectedChannelIds.length > 0 && (
                    <span className="text-[10px] font-black text-primary animate-pulse whitespace-nowrap hidden sm:inline px-1">
                      {selectedChannelIds.length}개
                    </span>
                  )}

                  <button 
                    onClick={() => setIsChannelListExpanded(!isChannelListExpanded)}
                    className="flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-primary transition-colors bg-slate-100 dark:bg-white/5 px-3 py-2 rounded-xl shrink-0 whitespace-nowrap"
                  >
                    <span className="material-symbols-outlined text-[16px]">{isChannelListExpanded ? 'expand_less' : 'expand_more'}</span>
                    {isChannelListExpanded ? '접기' : <><span className="md:hidden">전체 ({currentGroupChannels.length})</span><span className="hidden md:inline">전체 보기 ({currentGroupChannels.length})</span></>}
                  </button>
                </div>
              </div>

              {selectedChannelIds.length > 0 && (
                <div className="flex flex-col md:flex-row items-center justify-between bg-primary/10 border border-primary/30 p-3 md:p-5 rounded-2xl animate-in fade-in slide-in-from-top-2 shadow-[0_0_20px_rgba(19,55,236,0.1)] gap-3 md:gap-0">
                   <div className="flex items-center gap-3 md:gap-4 w-full md:w-auto">
                      <div className="size-8 md:size-10 bg-primary text-white rounded-full flex items-center justify-center font-black text-xs md:text-sm shadow-lg shadow-primary/20 shrink-0">
                        {selectedChannelIds.length}
                      </div>
                      <div className="flex flex-row items-baseline gap-2">
                        <span className="text-xs md:text-sm font-black text-primary uppercase">개 채널 선택됨</span>
                        <button onClick={() => setSelectedChannelIds([])} className="text-[10px] md:text-xs font-bold text-slate-500 hover:text-rose-500 underline whitespace-nowrap">선택 취소</button>
                      </div>
                   </div>
                   <div className="flex items-center gap-2 md:gap-3 w-full md:w-auto justify-end">
                      <div className="relative group/bulk">
                        <button 
                          onClick={() => setMovingGroupId(prev => prev === 'bulk' ? null : 'bulk')} 
                          className={`px-3 py-2 md:px-6 md:py-3 rounded-xl text-[10px] md:text-[11px] font-black uppercase transition-all flex items-center gap-1.5 md:gap-3 border-2 neon-blink-btn ${
                            movingGroupId === 'bulk' 
                            ? 'bg-primary text-white border-primary shadow-xl scale-105' 
                            : 'bg-primary text-white border-primary shadow-lg shadow-primary/40'
                          }`}
                        >
                          <span className="material-symbols-outlined text-[16px] md:text-[18px]">move_group</span>
                          <span className="md:hidden">이동</span>
                          <span className="hidden md:inline">선택한 그룹으로 이동</span>
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
                      
                      <button 
                        onClick={() => setIsSuggestModalOpen(true)} 
                        className="px-3 py-2 md:px-6 md:py-3 rounded-xl text-[10px] md:text-[11px] font-black uppercase transition-all flex items-center gap-1.5 md:gap-2 bg-slate-900 dark:bg-white text-white dark:text-slate-900 border-2 border-slate-900 dark:border-white hover:bg-indigo-600 hover:border-indigo-600 dark:hover:bg-indigo-500 dark:hover:border-indigo-500"
                        title="선택한 채널 공유 제안하기"
                      >
                        <span className="material-symbols-outlined text-[16px] md:text-[18px]">ios_share</span>
                        <span className="md:hidden">공유</span>
                        <span className="hidden md:inline">공유 제안</span>
                      </button>

                      <button
                        onClick={() => {
                          if (selectedChannelIds.length < 2 || selectedChannelIds.length > 3) {
                            alert("비교하려면 2개 또는 3개의 채널을 선택해주세요.");
                            return;
                          }
                          const selected = savedChannels.filter(c => selectedChannelIds.includes(c.id));
                          setComparisonChannels(selected);
                          setIsComparisonMode(true);
                        }}
                        className="px-3 py-2 md:px-6 md:py-3 rounded-xl text-[10px] md:text-[11px] font-black uppercase transition-all flex items-center gap-1.5 md:gap-2 bg-indigo-600 text-white border-2 border-indigo-600 hover:bg-indigo-700 hover:border-indigo-700 shadow-lg shadow-indigo-600/30"
                        title="선택한 채널 비교 분석"
                      >
                         <span className="material-symbols-outlined text-[16px] md:text-[18px]">compare_arrows</span>
                         VS 비교
                      </button>

                      <button onClick={() => {
                        setConfirmModal({
                          isOpen: true,
                          title: "채널 삭제",
                          message: `선택하신 ${selectedChannelIds.length}개 채널을 삭제하시겠습니까?`,
                          actionLabel: "삭제",
                          isDestructive: true,
                          onConfirm: async () => {
                            setConfirmModal(prev => ({ ...prev, isOpen: false }));
                            if (user) {
                              await Promise.all(selectedChannelIds.map(id => removeChannelFromDb(user.uid, id)));
                            }
                            setSavedChannels(prev => prev.filter(c => !selectedChannelIds.includes(c.id)));
                            setSelectedChannelIds([]);
                          }
                        });
                      }} className="size-9 md:size-12 bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-xl flex items-center justify-center hover:bg-rose-500 hover:text-white transition-all shrink-0">
                        <span className="material-symbols-outlined text-[18px] md:text-[24px]">delete</span>
                      </button>
                   </div>
                </div>
              )}

               <div className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 pt-2 transition-all duration-500 ease-in-out ${isChannelListExpanded ? 'opacity-100' : 'opacity-100'}`}>
                {currentGroupChannels.slice(0, isChannelListExpanded ? undefined : 10).map((ch) => {
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
                        <div className="flex items-center gap-1.5 w-full">
                          <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate" title={ch.title}>{ch.title}</span>
                          {newlyAddedIds.includes(ch.id) && (
                            <span className="shrink-0 bg-rose-500 text-white text-[8px] font-black px-1 py-0.5 rounded leading-none animate-pulse">NEW</span>
                          )}
                        </div>
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
                          onClick={async (e) => { 
                            e.stopPropagation(); 
                            if(user) await removeChannelFromDb(user.uid, ch.id);
                            setSavedChannels(prev => prev.filter(c => c.id !== ch.id)); 
                          }}
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
          </>)}
        {!isExplorerMode && !isUsageMode && !isPackageMode && !isShortsDetectorMode && !isTopicMode && !isNationalTrendMode && !isCategoryTrendMode && !isRadarMode && !isMaterialsExplorerMode && (
            <div className="space-y-4 pb-20">
               {isMyMode && role === 'pending' && (
                  <RestrictedOverlay 
                     onCheckStatus={() => { setMyPageInitialTab('dashboard'); setIsMyPageOpen(true); }}
                     onSubscribe={() => {
                        setIsMembershipMode(true);
                        setIsUsageMode(false);
                        setIsExplorerMode(false);
                        setIsPackageMode(false);
                        setIsShortsDetectorMode(false);
                        setIsTopicMode(false);
                        setIsMyMode(false);
                     }}
                  />
               )}
               <div className={`mt-6 ${isMyMode && role === 'pending' ? 'blur-sm pointer-events-none select-none opacity-40 transition-all duration-500' : ''}`}>
              <div className="flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
                  <div className="flex flex-col gap-1">
                    <h2 className="text-xl md:text-2xl font-black tracking-tighter uppercase italic dark:text-white text-slate-900 flex items-center gap-3">
                      <span className={`size-3 rounded-full animate-pulse ${isApiKeyMissing ? 'bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.8)]' : isMyMode ? (hasPendingSync && !isSyncNoticeDismissed ? 'bg-accent-hot shadow-[0_0_12px_#ff0055]' : 'bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.8)]') : 'bg-primary'}`}></span>
                      {isMyMode ? '실시간 통합 피드' : '트렌드 분석'}
                    </h2>

                  </div>
                  
                  <div className="flex bg-slate-100 dark:bg-white/5 p-1 rounded-xl border border-slate-200 dark:border-white/5 items-center">
                    {/* Channel Update Button - Hidden
                    {isMyMode && (
                      <button
                        onClick={handleUpdateChannelStats}
                        className="mr-2 px-3 py-1.5 rounded-lg text-[10px] font-bold bg-white dark:bg-slate-800 text-slate-500 hover:text-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-700 transition-all flex items-center gap-1 shadow-sm border border-slate-200 dark:border-slate-700"
                        title="모든 채널 정보 최신화 (평균 조회수 재계산)"
                      >
                         <span className={`material-symbols-outlined text-sm ${loading ? 'animate-spin' : ''}`}>sync</span>
                         <span className="hidden md:inline">채널 갱신</span>
                      </button>
                    )}
                    */}
                    {[3, 5, 7, 15, 30].map(d => (
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
                   <div className="py-20 md:py-32 text-center border border-dashed border-rose-500/50 rounded-3xl bg-rose-500/[0.02] shadow-sm flex flex-col items-center gap-5 animate-in slide-in-from-bottom-4">
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
                      <div className="w-full animate-in fade-in slide-in-from-top-4 duration-500 mb-8 px-1">
                          <div className="bg-slate-900 rounded-xl p-5 md:p-6 border border-slate-800 shadow-2xl relative overflow-hidden">
                              {/* Background Glow */}
                              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 via-teal-500 to-cyan-500 opacity-50"></div>
                              
                              <div className="flex justify-between items-end mb-3">
                                  <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">DATA UPDATE IN PROGRESS</span>
                                  <span className="text-2xl font-black text-white tabular-nums">
                                      {progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0}%
                                  </span>
                              </div>
                              
                              {/* Progress Track */}
                              <div className="h-2.5 bg-slate-800 rounded-full overflow-hidden mb-4">
                                  <div 
                                      className="h-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)] transition-all duration-300 ease-out relative" 
                                      style={{width: `${progress && progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`}}
                                  >
                                      <div className="absolute top-0 right-0 bottom-0 w-20 bg-gradient-to-r from-transparent to-white/30 skew-x-12 animate-shimmer"></div>
                                  </div>
                              </div>
                              
                              <p className="text-sm font-bold text-emerald-400 flex items-center gap-2 animate-pulse">
                                  <span className="material-symbols-outlined text-base animate-spin">sync</span>
                                  {progress?.message || '데이터를 불러오는 중...'}
                              </p>
                          </div>
                      </div>
                    ) : videos.length > 0 ? (
                      <>
                        <div className="space-y-6 pb-24">
                          {videos
                            .filter((video) => {
                              // Filter by timeRange (published within selected days)
                              const publishedDate = new Date(video.publishedAt || video.uploadTime);
                              const now = new Date();
                              const daysDiff = Math.floor((now.getTime() - publishedDate.getTime()) / (1000 * 60 * 60 * 24));
                              return daysDiff <= timeRange;
                            })
                            .filter((video, index, self) => {
                               // Exception: Always show "Super Viral" videos (Score >= 3.0) regardless of the limit
                               if (parseFloat(video.viralScore) >= 3.0) return true;
                               // Default: Limit to max 2 videos per channel
                               return self.slice(0, index).filter(v => (v.channelId || v.channelName) === (video.channelId || video.channelName)).length < 2;
                            })
                            .slice(0, visibleVideoCount)
                            .map((video) => (
                             <VideoCard 
                                key={video.id} 
                                video={video} 
                                onClick={() => setDetailedVideo(video)} 
                             />
                          ))}
                        </div>
                        
                        {/* Load More Button */}
                        {videos.filter((video) => {
                          const publishedDate = new Date(video.publishedAt || video.uploadTime);
                          const now = new Date();
                          const daysDiff = Math.floor((now.getTime() - publishedDate.getTime()) / (1000 * 60 * 60 * 24));
                          return daysDiff <= timeRange;
                        }).filter((video, index, self) => {
                          if (parseFloat(video.viralScore) >= 3.0) return true;
                          return self.slice(0, index).filter(v => (v.channelId || v.channelName) === (video.channelId || video.channelName)).length < 2;
                        }).length > visibleVideoCount && (
                          <div className="flex justify-center pt-8 pb-4">
                            <button
                              onClick={() => setVisibleVideoCount(prev => prev + 20)}
                              className="group px-8 py-4 bg-gradient-to-r from-primary to-indigo-600 hover:from-indigo-600 hover:to-primary text-white rounded-2xl font-black text-sm uppercase tracking-wider shadow-lg hover:shadow-xl hover:scale-105 transition-all duration-300 flex items-center gap-3"
                            >
                              <span className="material-symbols-outlined text-xl group-hover:animate-bounce">expand_more</span>
                              <span>더보기 (20개 더 로드)</span>
                              <span className="text-xs font-medium opacity-80">
                                ({visibleVideoCount} / {videos.filter((video) => {
                                  const publishedDate = new Date(video.publishedAt || video.uploadTime);
                                  const now = new Date();
                                  const daysDiff = Math.floor((now.getTime() - publishedDate.getTime()) / (1000 * 60 * 60 * 24));
                                  return daysDiff <= timeRange;
                                }).filter((video, index, self) => {
                                  if (parseFloat(video.viralScore) >= 3.0) return true;
                                  return self.slice(0, index).filter(v => (v.channelId || v.channelName) === (video.channelId || video.channelName)).length < 2;
                                }).length})
                              </span>
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="py-32 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-white dark:bg-slate-900/10 shadow-sm flex flex-col items-center gap-4">
                        <span className="material-symbols-outlined text-slate-200 dark:text-slate-800 text-6xl">analytics</span>
                        <p className="text-slate-400 dark:text-slate-500 text-sm font-bold">감지된 바이럴 신호가 없습니다.</p>
                      </div>
                    )}
                  </>
                )}
              </section>
                </div>
            </div>
          )}
        </div>
        )}
        <Footer onOpenModal={(type) => setFooterModal({ isOpen: true, type })} />
        </div>
      </main>

      {/* Package Suggestion Modal */}
      {isSuggestModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-white dark:bg-slate-900 w-full max-w-lg max-h-[85vh] flex flex-col rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200 dark:border-slate-800">
              {hasSuggestionSuccess ? (
                 <div className="p-10 flex flex-col items-center text-center animate-in zoom-in-95 duration-300 overflow-y-auto custom-scrollbar flex-1">
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
                      onClick={() => {
                        setIsSuggestModalOpen(false);
                        setHasSuggestionSuccess(false);
                      }}
                      className="bg-slate-900 dark:bg-white text-white dark:text-slate-900 px-10 py-3 rounded-xl font-bold hover:scale-105 transition-transform shadow-lg"
                    >
                      확인
                    </button>
                 </div>
              ) : (
                 <>
               <div className="p-8 pb-6 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex justify-between items-start shrink-0">
                  <div>
                     <h3 className="text-xl font-black text-slate-900 dark:text-white flex items-center gap-2">
                       <span className="material-symbols-outlined text-indigo-500">ios_share</span>
                        채널 팩 공유 제안
                     </h3>
                     <p className="text-xs text-slate-500 mt-1 font-medium">내가 모은 채널 리스트를 다른 사용자들과 공유해보세요.<br />관리자 승인 후 '추천 채널 팩'에 게시됩니다.</p>
                  </div>
                  <button onClick={() => setIsSuggestModalOpen(false)} className="text-slate-400 hover:text-rose-500 transition-colors"><span className="material-symbols-outlined">close</span></button>
               </div>
               
               <div className="p-8 space-y-6 overflow-y-auto custom-scrollbar flex-1">
                  <div>
                     <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">패키지 제목 <span className="text-rose-500">*</span></label>
                     <input 
                       value={suggestTitle}
                       onChange={(e) => setSuggestTitle(e.target.value)}
                       placeholder="예: 요즘 뜨는 요리 채널 모음"
                       className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                     />
                  </div>
                  <div>
                     <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">설명</label>
                     <textarea 
                       value={suggestDesc}
                       onChange={(e) => setSuggestDesc(e.target.value)}
                       placeholder="이 채널 구성에 대한 설명을 입력해주세요..."
                       className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-sm h-24 resize-none focus:ring-2 focus:ring-indigo-500/20 outline-none"
                     />
                  </div>
                  
                  <div>
                     <label className="block text-xs font-bold text-slate-500 mb-2 uppercase">타겟 그룹 이름 (선택)</label>
                     <input 
                       value={suggestTargetGroup}
                       onChange={(e) => setSuggestTargetGroup(e.target.value)}
                       placeholder="예: 주식 필수 채널 (다운로드 시 자동 생성될 그룹명)"
                       className="w-full p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 font-bold text-sm focus:ring-2 focus:ring-indigo-500/20 outline-none"
                     />
                     <p className="text-[10px] text-slate-400 mt-2 ml-1 leading-relaxed">
                        * 입력 시, 사용자가 이 팩을 다운로드할 때 <span className="text-indigo-500 font-bold">해당 이름의 그룹이 자동 생성</span>되어 채널이 분류됩니다.
                     </p>
                  </div>
                  
                  <div className="bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl border border-slate-100 dark:border-slate-800 flex flex-col gap-2">
                     <div className="flex items-center justify-between px-1">
                        <span className="text-xs font-bold text-slate-500 uppercase">포함될 채널 목록</span>
                        <span className="text-xs font-black text-indigo-500 bg-indigo-50 dark:bg-indigo-500/10 px-2 py-0.5 rounded-md">{selectedChannelIds.length}개</span>
                     </div>
                     <div className="max-h-40 overflow-y-auto custom-scrollbar pr-1">
                        <div className="grid grid-cols-2 gap-2">
                           {savedChannels.length > 0 && savedChannels.filter(ch => selectedChannelIds.includes(ch.id)).map(ch => (
                              <div key={ch.id} className="flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-1.5 rounded-lg shadow-sm animate-in fade-in zoom-in-95 duration-300">
                                 <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
                                    <img src={ch.thumbnail} alt="" className="size-5 rounded-full bg-slate-100 object-cover shrink-0 border border-slate-100 dark:border-slate-800" />
                                    <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 truncate">{ch.title}</span>
                                 </div>
                                 <button 
                                   onClick={() => setSelectedChannelIds(prev => prev.filter(id => id !== ch.id))}
                                   className="p-0.5 rounded text-slate-300 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 transition-colors shrink-0 ml-1"
                                   title="목록에서 제외"
                                 >
                                   <span className="material-symbols-outlined text-[12px] block">close</span>
                                 </button>
                              </div>
                           ))}
                        </div>
                        {selectedChannelIds.length === 0 && (
                           <div className="text-center py-4 text-xs text-slate-400 italic">선택된 채널이 없습니다.</div>
                        )}
                     </div>
                  </div>
               </div>

               <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex justify-end gap-3 shrink-0">
                  <button 
                    onClick={() => setIsSuggestModalOpen(false)}
                    className="px-6 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-xs"
                  >
                    취소
                  </button>
                  <button 
                    onClick={submitPackageProposal}
                    disabled={isSubmittingSuggestion || !suggestTitle.trim()}
                    className="px-8 py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-xs shadow-lg shadow-indigo-600/20 flex items-center gap-2 disabled:opacity-50 disabled:shadow-none transition-all hover:scale-105"
                  >
                    {isSubmittingSuggestion ? '제출 중...' : '제안 제출하기'}
                  </button>
               </div>
               </>
              )}
           </div>
        </div>
      )}

      {/* Alert Modal */}
      {alertMessage && (
          <AlertModal 
            title={alertMessage.title} 
            message={alertMessage.message} 
            type={alertMessage.type} 
            showSubscribeButton={alertMessage.showSubscribeButton}
            onSubscribe={() => {
               if (alertMessage.onSubscribe) {
                  alertMessage.onSubscribe();
                  setAlertMessage(null);
               } else {
                  setAlertMessage(null);
                  setIsMembershipMode(true);
                  setIsUsageMode(false);
                  setIsExplorerMode(false);
                  setIsPackageMode(false);
                  setIsShortsDetectorMode(false);
                  setIsTopicMode(false);
                  setIsMyMode(false);
                  setIsComparisonMode(false);
                  setIsRadarMode(false);
                  setIsNationalTrendMode(false);
                  setIsCategoryTrendMode(false);
                  setIsMaterialsExplorerMode(false);
                  setIsScriptMode(false);
               }
            }}
            onClose={() => setAlertMessage(null)} 
          />
      )}

      {/* Toast Notification */}
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* Existing Batch Result Modal */}
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


      {/* Suggestion Success Modal */}
      {hasSuggestionSuccess && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
           <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl space-y-6 animate-in zoom-in-95 duration-200">
             <div className="text-center space-y-2">
               <div className="size-16 bg-indigo-500/10 text-indigo-500 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-indigo-500/20">
                 <span className="material-symbols-outlined text-4xl">mark_email_read</span>
               </div>
               <h3 className="text-xl font-black text-slate-900 dark:text-white">제안 제출 완료</h3>
               <p className="text-xs text-slate-500 font-medium leading-relaxed">
                 소중한 제안 감사합니다!<br/>
                 관리자 검토 후 <span className="text-indigo-500 font-bold">추천 채널 팩</span>에 공식 등록됩니다.
               </p>
             </div>
             
             <button 
               onClick={() => setHasSuggestionSuccess(false)}
               className="w-full bg-slate-900 dark:bg-white text-white dark:text-slate-900 py-3.5 rounded-xl text-sm font-bold hover:scale-[1.02] transition-transform shadow-lg"
             >
               확인
             </button>
           </div>
        </div>
      )}

      {/* Video Detail Modal */}
      {detailedVideo && (
        <VideoDetailModal
          video={detailedVideo}
          onClose={() => setDetailedVideo(null)}
          channelGroups={groups}
          onAddChannel={handleAddChannelFromVideo}
          onExtractTranscript={(url) => {
            setDetailedVideo(null);
            setIsScriptMode(true);
            setScriptModeUrl(url);
            
            // 다른 메뉴 상태 초기화
            setIsMembershipMode(false);
            setIsUsageMode(false);
            setIsExplorerMode(false);
            setIsPackageMode(false);
            setIsShortsDetectorMode(false);
            setIsTopicMode(false);
            setIsMyMode(false);
            setIsComparisonMode(false);
            setIsRadarMode(false);
            setIsNationalTrendMode(false);
            setIsCategoryTrendMode(false);
            setIsMaterialsExplorerMode(false);
          }}
          onAnalyzeChannel={(channelId) => {
            setDetailedVideo(null);
            setRadarInitialQuery(channelId);
            setIsRadarMode(true);
            
            // 다른 메뉴 상태 초기화
            setIsScriptMode(false);
            setIsMembershipMode(false);
            setIsUsageMode(false);
            setIsExplorerMode(false);
            setIsPackageMode(false);
            setIsShortsDetectorMode(false);
            setIsTopicMode(false);
            setIsMyMode(false);
            setIsComparisonMode(false);
            setIsNationalTrendMode(false);
            setIsCategoryTrendMode(false);
            setIsMaterialsExplorerMode(false);
          }}
        />
      )}

      {/* Progress Modal (Energy Bar) */}
      {progress && !progress.isInline && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-8 max-w-sm w-full shadow-2xl space-y-6 text-center animate-in zoom-in-95 duration-300">
            <div className="size-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4 ring-4 ring-primary/5">
               <span className="material-symbols-outlined text-3xl animate-spin">sync</span>
            </div>
            <div>
               <h3 className="text-xl font-bold dark:text-white mb-2">데이터 분석 중...</h3>
               <p className="text-slate-500 dark:text-slate-400 text-sm mb-6 min-h-[20px]">{progress.message}</p>
               
               <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-4 overflow-hidden relative shadow-inner">
                  <div 
                     className="absolute top-0 left-0 h-full bg-gradient-to-r from-primary to-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.6)] transition-all duration-300 ease-out"
                     style={{ width: `${(progress.current / progress.total) * 100}%` }}
                  >
                      <div className="absolute inset-0 bg-white/20 animate-pulse"></div>
                  </div>
               </div>
               <div className="flex justify-between text-xs font-bold text-slate-400 mt-2 px-1">
                  <span>{progress.current} / {progress.total}</span>
                  <span>{Math.round((progress.current / progress.total) * 100)}%</span>
               </div>
            </div>
            <p className="text-[10px] text-slate-400">잠시만 기다려주세요. 창을 닫지 마세요.</p>
          </div>
        </div>
      )}

      {/* Membership Welcome Modal */}
      {membershipJustApproved && (
         <MembershipWelcomeModal 
           onClose={() => setMembershipJustApproved(null)}
           userName={membershipJustApproved.name}
           daysLeft={membershipJustApproved.daysLeft}
           plan={membershipJustApproved.plan}
           limit={membershipJustApproved.limit}
         />
      )}

      {confirmModal.isOpen && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-300"
          onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        >
          <div 
            className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-[2.5rem] p-8 max-w-[360px] w-full shadow-[0_20px_50px_rgba(0,0,0,0.2)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.4)] relative overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300" 
            onClick={e => e.stopPropagation()}
          >
            {/* Background Decorative Gradient */}
            <div className={`absolute top-0 left-0 right-0 h-1 ${confirmModal.isDestructive ? 'bg-gradient-to-r from-rose-400 to-rose-600' : 'bg-gradient-to-r from-indigo-400 to-indigo-600'}`} />
            
            <div className="flex flex-col items-center text-center space-y-5">
              {/* Icon Container */}
              <div className={`size-16 rounded-3xl flex items-center justify-center mb-1 ${
                confirmModal.isDestructive 
                ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-500 shadow-lg shadow-rose-500/10' 
                : 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-500 shadow-lg shadow-indigo-500/10'
              }`}>
                <span className="material-symbols-outlined text-3xl font-bold">
                  {confirmModal.isDestructive ? 'warning' : (confirmModal.title?.includes('숨기기') ? 'visibility_off' : 'help')}
                </span>
              </div>

              <div className="space-y-2">
                <h3 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                  {confirmModal.title}
                </h3>
                <p className="text-sm font-bold text-slate-500 dark:text-slate-400 leading-relaxed">
                  {confirmModal.message}
                </p>
              </div>
              
              <div className="flex flex-col w-full gap-2 pt-2">
                <button 
                  onClick={confirmModal.onConfirm}
                  className={`w-full py-3.5 rounded-2xl text-sm font-black uppercase tracking-wider text-white transition-all transform active:scale-95 shadow-xl ${
                     confirmModal.isDestructive 
                     ? 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/20' 
                     : 'bg-indigo-600 hover:bg-indigo-700 shadow-indigo-500/20'
                  }`}
                >
                  {confirmModal.actionLabel || "확인"}
                </button>
                <button 
                  onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                  className="w-full py-3.5 rounded-2xl text-sm font-bold text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                  autoFocus
                >
                  취소
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer Terms Modal */}
      {footerModal.isOpen && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200" onClick={() => setFooterModal(prev => ({ ...prev, isOpen: false }))}>
          <div 
             className="bg-white dark:bg-slate-900 w-full max-w-2xl max-h-[80vh] overflow-hidden flex flex-col rounded-2xl shadow-2xl animate-in zoom-in-95 duration-200 ring-1 ring-white/10" 
             onClick={e => e.stopPropagation()}
          >
             <div className="p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center sticky top-0 bg-white dark:bg-slate-900">
                <h3 className="text-lg font-black text-slate-900 dark:text-white flex items-center gap-2">
                   {footerModal.type === 'terms' ? '이용약관' : '개인정보처리방침'}
                </h3>
                <button onClick={() => setFooterModal(prev => ({ ...prev, isOpen: false }))} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                   <span className="material-symbols-outlined text-slate-500">close</span>
                </button>
             </div>
             
             <div className="p-8 overflow-y-auto custom-scrollbar flex-1">
                <div className="prose dark:prose-invert prose-sm max-w-none text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-wrap">
                   {footerModal.type === 'terms' ? (
`튜브레이더 이용약관\n\n제1조 (목적)\n본 약관은 튜브레이더(이하 “회사”)가 제공하는 Tube Radar 서비스(이하 “서비스”)의 이용과 관련하여 회사와 이용자 간의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.\n\n제2조 (용어의 정의)\n1. “서비스”란 회사가 제공하는 유튜브 채널 분석, 키워드 탐색, 트렌드 분석, 채널 관리 등 Tube Radar 관련 모든 기능을 의미합니다.\n2. “이용자”란 본 약관에 동의하고 서비스를 이용하는 회원 및 비회원을 의미합니다.\n3. “회원”이란 이메일 또는 소셜 로그인 등을 통해 계정을 생성한 자를 의미합니다.\n4. “유료 서비스”란 결제 또는 멤버십 가입을 통해 이용 가능한 기능 또는 콘텐츠를 의미합니다.\n\n제3조 (약관의 효력 및 변경)\n1. 본 약관은 서비스 화면에 게시하거나 기타 방법으로 이용자에게 공지함으로써 효력을 발생합니다.\n2. 회사는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있으며, 변경 시 사전 공지합니다.\n3. 이용자가 변경된 약관에 동의하지 않을 경우 서비스 이용을 중단할 수 있습니다.\n\n제4조 (서비스의 제공)\n회사는 다음과 같은 서비스를 제공합니다.\n1. 유튜브 채널 및 영상 분석\n2. 키워드 및 트렌드 분석\n3. AI 기반 채널 진단 및 추천\n4. 기타 회사가 정하는 부가 서비스\n서비스는 연중무휴 제공을 원칙으로 하나, 시스템 점검 등의 사유로 일시 중단될 수 있습니다.\n\n제5조 (회원가입 및 계정 관리)\n1. 회원가입은 이용자가 약관에 동의하고 회사가 정한 절차를 완료함으로써 이루어집니다.\n2. 이용자는 계정 정보의 관리 책임을 가지며, 이를 제3자에게 양도하거나 공유할 수 없습니다.\n\n제6조 (유료 서비스 및 결제)\n1. 일부 서비스는 유료로 제공될 수 있습니다.\n2. 결제 금액, 이용 기간, 환불 조건은 서비스 화면에 별도로 안내합니다.\n3. 환불은 관련 법령 및 회사의 환불 정책에 따릅니다.\n\n제7조 (이용자의 의무)\n이용자는 다음 행위를 하여서는 안 됩니다.\n1. 법령 또는 공공질서에 위반되는 행위\n2. 서비스의 정상적인 운영을 방해하는 행위\n3. 타인의 정보 또는 계정을 도용하는 행위\n4. 회사의 지적재산권을 침해하는 행위\n\n제8조 (지적재산권)\n1. 서비스에 포함된 모든 콘텐츠 및 데이터에 대한 권리는 회사에 귀속됩니다.\n2. 이용자는 회사의 사전 동의 없이 이를 복제, 배포, 상업적으로 이용할 수 없습니다.\n\n제9조 (서비스 이용 제한)\n회사는 이용자가 본 약관을 위반할 경우 서비스 이용을 제한하거나 계정을 해지할 수 있습니다.\n\n제10조 (책임의 제한)\n1. 회사는 유튜브 정책 변경, 외부 API 제한 등 회사의 통제 범위를 벗어난 사유로 발생한 손해에 대해 책임을 지지 않습니다.\n2. 서비스에서 제공되는 분석 결과는 참고용 정보이며, 회사는 이를 통한 성과를 보장하지 않습니다.\n\n제11조 (준거법 및 관할)\n본 약관은 대한민국 법령을 준거법으로 하며, 분쟁 발생 시 회사의 본점 소재지를 관할하는 법원을 전속 관할로 합니다.`
                   ) : (
`1. 개인정보의 수집 항목\n\n회사는 다음과 같은 개인정보를 수집합니다.\n필수항목: 이메일 주소, 로그인 정보, 서비스 이용 기록\n선택항목: 유튜브 채널 정보, 결제 정보\n자동 수집 항목: IP 주소, 접속 로그, 쿠키, 기기 정보\n\n2. 개인정보의 수집 및 이용 목적\n\n회사는 수집한 개인정보를 다음 목적을 위해 이용합니다.\n회원 관리 및 본인 확인\n서비스 제공 및 개선\n결제 처리 및 이용 요금 정산\n고객 문의 응대 및 공지사항 전달\n서비스 이용 통계 및 분석\n\n3. 개인정보의 보유 및 이용 기간\n\n회원 탈퇴 시 개인정보는 즉시 파기합니다.\n단, 관계 법령에 따라 보존이 필요한 경우 해당 기간 동안 보관합니다.\n\n4. 개인정보의 제3자 제공\n\n회사는 이용자의 개인정보를 원칙적으로 외부에 제공하지 않습니다.\n다만, 법령에 따라 요구되는 경우는 예외로 합니다.\n\n5. 개인정보 처리의 위탁\n\n회사는 원활한 서비스 제공을 위해 결제 처리, 서버 운영 등을 외부 업체에 위탁할 수 있으며, 이 경우 관련 법령을 준수합니다.\n\n6. 개인정보의 파기 절차 및 방법\n\n전자적 파일 형태: 복구 불가능한 방식으로 삭제\n출력물: 분쇄 또는 소각\n\n7. 이용자의 권리\n\n이용자는 언제든지 자신의 개인정보 열람, 수정, 삭제, 처리 정지를 요청할 수 있습니다.\n\n8. 개인정보 보호를 위한 기술적·관리적 조치\n\n회사는 개인정보 보호를 위해 암호화, 접근 제한, 보안 시스템 등을 적용하고 있습니다.\n\n9. 개인정보 보호책임자\n\n성명: 현승효\n이메일: boxtvstar@gmail.com\n\n개인정보 관련 문의사항은 위 이메일 또는 서비스 내 1:1 문의 기능을 이용해주세요.\n\n10. 정책 변경\n\n본 개인정보처리방침은 법령 또는 서비스 변경에 따라 수정될 수 있으며, 변경 시 서비스 내 공지합니다.`
                   )}
                </div>
             </div>
             
             <div className="p-6 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 text-right">
                <button onClick={() => setFooterModal(prev => ({ ...prev, isOpen: false }))} className="px-6 py-2.5 bg-slate-900 dark:bg-white text-white dark:text-slate-900 rounded-xl font-bold hover:opacity-90 transition-opacity text-sm">확인</button>
             </div>
          </div>
        </div>
      )}
    </div>
  );
}

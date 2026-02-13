import React, { useMemo, useState } from 'react';
import { VideoData } from '../../types';

interface VideoDetailModalProps {
  video: VideoData;
  onClose: () => void;
  onRemixTitle?: () => void;
  onRemixThumbnail?: () => void;
  channelGroups?: Array<{ id: string; name: string; }>;
  onAddChannel?: (channelId: string, groupId: string, newGroupName?: string) => Promise<void>;
  onExtractTranscript?: (videoUrl: string) => void;
  onAnalyzeChannel?: (channelId: string) => void;
}

// Category ID to Name mapping
const CATEGORY_NAMES: Record<string, string> = {
  '1': '영화/애니', '2': '자동차', '10': '음악', '15': '동물', '17': '스포츠',
  '18': '단편영화', '19': '여행', '20': '게임', '22': '브이로그/인물', '23': '코미디',
  '24': '엔터테인먼트', '25': '뉴스/정치', '26': '노하우/스타일', '27': '교육',
  '28': '과학/기술', '29': '비영리/사회'
};

export const VideoDetailModal: React.FC<VideoDetailModalProps> = ({ 
  video, 
  onClose, 
  channelGroups = [], 
  onAddChannel,
  onExtractTranscript,
  onAnalyzeChannel
}) => {
  const [showGroupDropdown, setShowGroupDropdown] = useState(false);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleCreateAndAdd = async () => {
    if (!newGroupName.trim() || !onAddChannel || !video.channelId) return;

    setIsAdding(true);
    try {
      await onAddChannel(video.channelId, '', newGroupName.trim());
      setShowGroupDropdown(false);
      setIsCreatingGroup(false);
      setNewGroupName('');
      onClose(); // 채널 추가 성공 후 모달 닫기
    } catch (e: any) {
      console.error('채널 추가 실패:', e);
      setErrorMessage(e.message || '채널 추가 중 알 수 없는 오류가 발생했습니다.');
    } finally {
      setIsAdding(false);
    }
  };

  const parseCount = (val?: string) => {
    if (!val) return 0;
    const strVal = String(val).toUpperCase().replace(/,/g, '').replace(/회/g, '').replace(/VIEWS/g, '').trim();
    const match = strVal.match(/[\d.]+/);
    if (!match) return 0;
    let num = parseFloat(match[0]);
    if (strVal.includes('K') || strVal.includes('천')) num *= 1000;
    else if (strVal.includes('M') || strVal.includes('만')) num *= 10000;
    else if (strVal.includes('B') || strVal.includes('억')) num *= 100000000;
    return Math.round(num);
  };

  const getHoursSinceUpload = (timeStr: string) => {
    const num = parseInt(timeStr.replace(/[^0-9]/g, "")) || 1;
    if (timeStr.includes("분")) return num / 60;
    if (timeStr.includes("시간")) return num;
    if (timeStr.includes("일")) return num * 24;
    if (timeStr.includes("주")) return num * 24 * 7;
    if (timeStr.includes("달") || timeStr.includes("개월")) return num * 24 * 30;
    if (timeStr.includes("년")) return num * 24 * 365;
    return 24;
  };

  const stats = useMemo(() => {
    const views = parseCount(video.views);
    const avgViews = parseCount(video.avgViews);
    // Improved Hours calculation for accurate Booster
    let hours = getHoursSinceUpload(video.uploadTime);
    if (video.publishedAt) {
       hours = Math.max((Date.now() - new Date(video.publishedAt).getTime()) / (1000 * 60 * 60), 0.1);
    }
    
    let outlier = parseFloat(video.viralScore.replace('x', ''));
    
    // Fallback: Recalculate if invalid, applying Time Factor (Same as Auto Detect / My List)
    if ((isNaN(outlier) || outlier === 0) && views > 0 && avgViews > 0) {
      // Time Factor: Views grow over time. We expect 'avgViews' only after ~1 week (168h).
      // Early on, we expect less. Factor = sqrt(hours/168).
      const timeFactor = Math.max(Math.min(Math.pow(hours / 168, 0.5), 1), 0.3);
      const expected = Math.max(avgViews * timeFactor, 100); // Min expectation 100 views
      outlier = views / expected;
    }
    
    if (isNaN(outlier)) outlier = 0.0;
    outlier = parseFloat(outlier.toFixed(1));

    const vph = hours > 0 ? Math.round(views / hours) : 0;

    const viral = parseFloat(video.viralScore) || 0;
    let engagementGrade = "N/A";
    let engagementColor = "text-slate-400";
    
    if (viral > 1000) { engagementGrade = "Legendary"; engagementColor = "text-purple-500"; }
    else if (viral > 300) { engagementGrade = "Great"; engagementColor = "text-emerald-500"; }
    else if (viral > 100) { engagementGrade = "Good"; engagementColor = "text-blue-500"; }
    else if (viral > 50) { engagementGrade = "Average"; engagementColor = "text-amber-500"; }
    else { engagementGrade = "Low"; engagementColor = "text-slate-500"; }

    const subscribers = parseCount(video.subscribers);
    const contribution = subscribers > 0 ? (views / subscribers * 100).toFixed(0) : "0";

    const tagCount = video.tags ? video.tags.length : 0;
    const avgTagLen = video.tags && tagCount > 0 ? (video.tags.reduce((acc, tag) => acc + tag.length, 0) / tagCount).toFixed(0) : 0;

    return { views, outlier, vph, engagementGrade, engagementColor, contribution, tagCount, avgTagLen, avgViews };
  }, [video]);

  const getFlagEmoji = (countryCode?: string) => {
    if (!countryCode) return "🌐";
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  };

  // Convert category ID to name if it's a number
  const getCategoryName = (category: string) => {
    if (!category) return '기타';
    // Check if category is a number (ID)
    if (/^\d+$/.test(category)) {
      return CATEGORY_NAMES[category] || '기타';
    }
    // Already a name
    return category;
  };

  const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-end bg-black/40 backdrop-blur-sm animate-in fade-in duration-300" onClick={onClose}>
      <div 
        className="bg-slate-950/95 backdrop-blur-xl w-full max-w-md h-full overflow-y-auto shadow-2xl border-l border-white/10 relative animate-in slide-in-from-right duration-500 ease-out" 
        onClick={e => e.stopPropagation()}
      >
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 z-20 size-8 rounded-lg bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-all"
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>

        {/* Header */}
        <div className="p-4 border-b border-white/10">
          <div className="flex items-center gap-2 mb-3">
            <span className="material-symbols-outlined text-indigo-400 text-xs">analytics</span>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">VIDEO INSIGHTS</span>
          </div>
          
          <h2 className="text-lg font-black text-white leading-tight mb-3 line-clamp-2">
            {video.title}
          </h2>
          
          <div className="flex items-center gap-3 mb-4">
            <div className="size-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white shrink-0 shadow-lg border border-white/10">
              {video.channelName.substring(0,1)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-black text-white truncate">{video.channelName}</p>
                {video.channelId && (
                  <div className="flex items-center gap-1">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        navigator.clipboard.writeText(`https://www.youtube.com/channel/${video.channelId}`);
                        alert('채널 주소가 복사되었습니다.');
                      }}
                      className="size-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-slate-300 hover:text-white transition-colors"
                      title="채널 주소 복사"
                    >
                      <span className="material-symbols-outlined text-[12px]">content_copy</span>
                    </button>
                    {onAnalyzeChannel && (
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          onAnalyzeChannel(video.channelId);
                        }}
                        className="size-6 rounded-full bg-indigo-500/20 hover:bg-indigo-500/40 flex items-center justify-center text-indigo-400 hover:text-indigo-300 transition-colors border border-indigo-500/30"
                        title="채널 영상 탐지"
                      >
                        <span className="material-symbols-outlined text-[14px]">radar</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium">
                <span>{video.subscribers} 구독자</span>
                <span>•</span>
                <span>{video.uploadTime}</span>
                {video.channelCountry && (
                  <>
                    <span>•</span>
                    <span>{getFlagEmoji(video.channelCountry)} {video.channelCountry}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-2 mb-1">
            <div className="flex-1">
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full px-2 py-2.5 bg-red-600 hover:bg-red-500 rounded-xl text-white text-[11px] font-black transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-red-600/20 active:scale-[0.98]"
                title="유튜브에서 영상 보기"
              >
                <span className="material-symbols-outlined text-[18px]">play_circle</span>
                <span className="whitespace-nowrap">영상보기</span>
              </a>
            </div>
            
            {onExtractTranscript && video.duration !== '0:00' && (
              <div className="flex-1">
                <button
                  onClick={() => onExtractTranscript(videoUrl)}
                  className="w-full px-2 py-2.5 bg-indigo-600/20 hover:bg-indigo-600/30 rounded-xl text-indigo-400 text-[11px] font-black transition-all flex items-center justify-center gap-1.5 border border-indigo-500/20 active:scale-[0.98]"
                  title="대본 추출하기"
                >
                  <span className="material-symbols-outlined text-[18px]">description</span>
                  <span className="whitespace-nowrap">대본추출</span>
                </button>
              </div>
            )}

            {video.channelId && onAddChannel && (
              <div className="flex-1 relative">
                <button
                  className="w-full px-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 rounded-xl text-[11px] font-black text-white transition-all flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/20 disabled:opacity-50 active:scale-[0.98]"
                  onClick={() => setShowGroupDropdown(!showGroupDropdown)}
                  disabled={isAdding}
                >
                  {isAdding ? (
                    <span className="material-symbols-outlined text-[18px] animate-spin">sync</span>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[18px]">add</span>
                      <span className="whitespace-nowrap">채널추가</span>
                    </>
                  )}
                </button>

                {showGroupDropdown && (
                  <div className="absolute top-full mt-2 right-0 w-64 bg-slate-900 border border-white/20 rounded-2xl shadow-2xl overflow-hidden z-[100] animate-in slide-in-from-top-2 fade-in">
                    <div className="p-3 border-b border-white/10 bg-slate-800/50">
                      <div className="text-[10px] font-black text-indigo-400 flex items-center gap-2 uppercase tracking-widest">
                        <span className="material-symbols-outlined text-base">folder_open</span>
                        그룹 선택
                      </div>
                    </div>

                    <div className="max-h-60 overflow-y-auto custom-scrollbar">
                      {channelGroups.filter(g => g.id !== 'all').length > 0 ? (
                        channelGroups.filter(g => g.id !== 'all').map(group => (
                          <button
                            key={group.id}
                            className="w-full text-left px-4 py-3 text-xs font-bold text-white hover:bg-indigo-600 transition-colors flex items-center gap-3 border-b border-white/5 last:border-b-0"
                            onClick={async () => {
                              if (onAddChannel && video.channelId) {
                                setIsAdding(true);
                                try {
                                  await onAddChannel(video.channelId, group.id);
                                  setShowGroupDropdown(false);
                                  onClose();
                                } catch (e: any) {
                                  setErrorMessage(e.message || '오류 발생');
                                } finally {
                                  setIsAdding(false);
                                }
                              }
                            }}
                          >
                            <span className="material-symbols-outlined text-base text-indigo-400">folder</span>
                            <span className="flex-1">{group.name}</span>
                          </button>
                        ))
                      ) : (
                        <div className="p-4 text-[10px] text-slate-500 text-center font-bold">
                          저장된 그룹이 없습니다
                        </div>
                      )}
                    </div>

                    <div className="p-2 border-t border-white/10 bg-slate-800/30">
                      {!isCreatingGroup ? (
                        <button
                          onClick={() => setIsCreatingGroup(true)}
                          className="w-full px-3 py-2.5 rounded-xl text-[10px] font-black text-emerald-400 hover:bg-emerald-500/10 transition-colors flex items-center justify-center gap-2 border border-dashed border-emerald-500/30"
                        >
                          <span className="material-symbols-outlined text-base">add_circle</span>
                          새 그룹 만들기
                        </button>
                      ) : (
                        <div className="space-y-2 p-1">
                          <input
                            type="text"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            placeholder="그룹명 입력..."
                            className="w-full px-3 py-2 bg-slate-800 border border-white/20 rounded-lg text-xs text-white focus:ring-2 focus:ring-emerald-500/30 outline-none font-bold"
                            autoFocus
                          />
                          <div className="flex gap-1.5">
                            <button
                              onClick={handleCreateAndAdd}
                              disabled={!newGroupName.trim() || isAdding}
                              className="flex-1 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-black transition-colors"
                            >
                              만들기
                            </button>
                            <button
                              onClick={() => { setIsCreatingGroup(false); setNewGroupName(''); }}
                              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-black transition-colors"
                            >
                              취소
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          
          {video.duration !== '0:00' ? (
            <>
              {/* Top Row: Thumbnail + Booster */}
              <div className="grid grid-cols-2 gap-2.5">
                {/* Thumbnail */}
                <div className="relative h-20 md:h-24 rounded-xl overflow-hidden border border-white/10 group">
                  <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                    <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="size-8 rounded-full bg-red-600 flex items-center justify-center shadow-xl hover:scale-110 transition-transform">
                      <span className="material-symbols-outlined text-white text-base fill-current">play_arrow</span>
                    </a>
                  </div>
                </div>

                {/* Booster Score */}
                <div className="bg-gradient-to-br from-indigo-600 to-purple-600 rounded-xl p-2.5 relative overflow-hidden flex flex-col justify-center h-20 md:h-24">
                  <div className="absolute top-0 right-0 w-16 h-16 bg-white/10 rounded-full blur-2xl"></div>
                  <div className="relative">
                    <div className="flex items-center gap-1 mb-0">
                      <span className="material-symbols-outlined text-white/80 text-[12px]">local_fire_department</span>
                      <span className="text-[8px] font-black text-white/80 uppercase tracking-tighter">부스터</span>
                    </div>
                    <div className="text-2xl font-black text-white leading-none">
                      {stats.outlier}x
                    </div>
                    <div className="text-[8px] text-white/70 mt-1 font-bold">평소보다 {stats.outlier}배 인기</div>
                  </div>
                </div>
              </div>

              {/* Stats Grid - 2x3 */}
              <div className="grid grid-cols-2 gap-2.5">
                {/* Views */}
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-3 h-24 flex flex-col justify-center">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="material-symbols-outlined text-sky-400 text-base">visibility</span>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-tight">조회수</span>
                  </div>
                  <div className="text-2xl font-black text-white leading-none">
                    {stats.views >= 10000 ? (stats.views / 10000).toFixed(1) + '만' : stats.views.toLocaleString()}
                  </div>
                </div>

                {/* VPH */}
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-3 h-24 flex flex-col justify-center">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="material-symbols-outlined text-amber-400 text-base">schedule</span>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-tight">시간당 조회</span>
                  </div>
                  <div className="text-2xl font-black text-white leading-none">{stats.vph.toLocaleString()}</div>
                </div>

                {/* Engagement */}
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-3 h-24 flex flex-col justify-center">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="material-symbols-outlined text-emerald-400 text-base">thumb_up</span>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-tight">시청 참여도</span>
                  </div>
                  <div className={`text-2xl font-black leading-none ${stats.engagementColor}`}>
                    {stats.engagementGrade}
                  </div>
                </div>

                {/* Duration */}
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-3 h-24 flex flex-col justify-center">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="material-symbols-outlined text-purple-400 text-base">timer</span>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-tight">영상 길이</span>
                  </div>
                  <div className="text-2xl font-black text-white leading-none">{video.duration}</div>
                </div>

                {/* Avg Views */}
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-3 h-24 flex flex-col justify-center">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="material-symbols-outlined text-orange-400 text-base">trending_up</span>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-tight">평균 조회수</span>
                  </div>
                  <div className="text-xl font-black text-white leading-none">{video.avgViews}</div>
                </div>

                {/* Category */}
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-3 h-24 flex flex-col justify-center">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="material-symbols-outlined text-pink-400 text-base">category</span>
                    <span className="text-[10px] font-black text-slate-500 uppercase tracking-tight">카테고리</span>
                  </div>
                  <div className="text-lg font-black text-white truncate leading-none">{getCategoryName(video.category)}</div>
                </div>
              </div>

              {/* Channel Join Date */}
              {(video.channelJoinDate || video.publishedAt) && (
                <div className="bg-slate-900/50 border border-white/5 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="material-symbols-outlined text-slate-400 text-sm">info</span>
                        <span className="text-xs font-bold text-slate-400">채널 가입 연도</span>
                      </div>
                      <div className="text-lg font-black text-white">
                        {!isNaN(new Date(video.channelJoinDate || video.publishedAt || '').getFullYear()) 
                          ? new Date(video.channelJoinDate || video.publishedAt || '').getFullYear() + '년 가입' 
                          : '-'}
                      </div>
                      {(video.channelJoinDate || video.publishedAt) && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          ⓘ 개설일: {new Date(video.channelJoinDate || video.publishedAt || '').toLocaleDateString('ko-KR')}
                        </div>
                      )}
                    </div>
                    <div className="size-10 rounded-full bg-slate-800/50 flex items-center justify-center">
                      <span className="material-symbols-outlined text-slate-500 text-lg">info</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Channel Mode */}
              <div className="grid grid-cols-2 gap-3">
                {/* Thumbnail */}
                <div className="relative h-28 rounded-xl overflow-hidden border border-white/10">
                  <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover" />
                </div>

                {/* Subscribers */}
                <div className="bg-gradient-to-br from-indigo-600 to-purple-600 rounded-2xl p-4 relative overflow-hidden flex flex-col justify-center h-28">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
                  <div className="relative">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="material-symbols-outlined text-white/80 text-base">group</span>
                      <span className="text-[10px] font-bold text-white/80 uppercase">구독자</span>
                    </div>
                    <div className="text-3xl font-black text-white">
                      {video.subscribers}
                    </div>
                  </div>
                </div>
              </div>

              {/* Channel Stats */}
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-3 h-24 flex flex-col justify-center">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="material-symbols-outlined text-pink-400 text-base">category</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-tight">카테고리</span>
                  </div>
                  <div className="text-lg font-black text-white truncate leading-none">{getCategoryName(video.category)}</div>
                </div>

                {video.channelCountry && (
                  <div className="bg-slate-900/80 border border-white/10 rounded-xl p-3 h-24 flex flex-col justify-center">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="material-symbols-outlined text-blue-400 text-base">flag</span>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-tight">국가</span>
                    </div>
                    <div className="text-lg font-black text-white leading-none">{getFlagEmoji(video.channelCountry)} {video.channelCountry}</div>
                  </div>
                )}

                {video.avgViews && video.avgViews !== '0' && (
                  <div className="bg-slate-900/80 border border-white/10 rounded-xl p-3 h-24 flex flex-col justify-center">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="material-symbols-outlined text-orange-400 text-base">trending_up</span>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-tight">평균 조회수</span>
                    </div>
                    <div className="text-xl font-black text-white leading-none">{video.avgViews}</div>
                  </div>
                )}

                {video.channelTotalViews && (
                  <div className="bg-slate-900/80 border border-white/10 rounded-xl p-3 h-24 flex flex-col justify-center">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <span className="material-symbols-outlined text-sky-400 text-base">visibility</span>
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-tight">총 조회수</span>
                    </div>
                    <div className="text-xl font-black text-white leading-none">{video.channelTotalViews}</div>
                  </div>
                )}

              </div>

              {(video.channelJoinDate || video.publishedAt) && (
                <div className="bg-slate-900/50 border border-white/5 rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="material-symbols-outlined text-slate-400 text-sm">info</span>
                        <span className="text-xs font-bold text-slate-400">채널 가입 연도</span>
                      </div>
                      <div className="text-lg font-black text-white">
                        {!isNaN(new Date(video.channelJoinDate || video.publishedAt || '').getFullYear()) 
                          ? new Date(video.channelJoinDate || video.publishedAt || '').getFullYear() + '년 가입' 
                          : '-'}
                      </div>
                      {(video.channelJoinDate || video.publishedAt) && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          ⓘ 개설일: {new Date(video.channelJoinDate || video.publishedAt || '').toLocaleDateString('ko-KR')}
                        </div>
                      )}
                    </div>
                    <div className="size-10 rounded-full bg-slate-800/50 flex items-center justify-center">
                      <span className="material-symbols-outlined text-slate-500 text-lg">info</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Tags */}
          {video.tags && video.tags.length > 0 && (
            <div className="bg-slate-900/50 border border-white/5 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-purple-400 text-sm">tag</span>
                  <span className="text-xs font-bold text-slate-400">태그 분석</span>
                  <span className="bg-purple-500/10 text-purple-400 text-[10px] px-2 py-0.5 rounded-full">
                    {stats.tagCount}개
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {video.tags.slice(0, 12).map((tag, i) => (
                  <span 
                    key={i} 
                    className={`px-2.5 py-1 text-[10px] font-bold rounded-lg ${
                      tag.length < 5 
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                        : 'bg-slate-800/80 text-slate-300 border border-white/10'
                    }`}
                  >
                    {tag.replace(/#/g, '')}
                  </span>
                ))}
              </div>
            </div>
          )}

        </div>

      </div>

      {/* Error Modal */}
      {errorMessage && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setErrorMessage(null)}>
          <div
            className="bg-slate-900 border border-red-500/30 rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="bg-gradient-to-r from-red-600 to-red-500 p-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-full bg-white/20 flex items-center justify-center">
                  <span className="material-symbols-outlined text-white text-2xl">error</span>
                </div>
                <div>
                  <h3 className="text-lg font-black text-white">채널 추가 실패</h3>
                  <p className="text-xs text-red-100/80">작업을 완료할 수 없습니다</p>
                </div>
              </div>
            </div>

            {/* Content */}
            <div className="p-5">
              <div className="bg-slate-800/50 border border-white/10 rounded-xl p-4 mb-4">
                <div className="flex items-start gap-3">
                  <span className="material-symbols-outlined text-red-400 text-xl mt-0.5">info</span>
                  <div className="flex-1">
                    <p className="text-sm text-white leading-relaxed whitespace-pre-line">
                      {errorMessage}
                    </p>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <button
                onClick={() => setErrorMessage(null)}
                className="w-full px-4 py-3 bg-red-600 hover:bg-red-500 rounded-xl text-white text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-lg"
              >
                <span className="material-symbols-outlined text-base">check_circle</span>
                <span>확인</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

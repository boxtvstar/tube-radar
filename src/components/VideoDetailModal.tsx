import React, { useMemo, useState } from 'react';
import { VideoData } from '../../types';

interface VideoDetailModalProps {
  video: VideoData;
  onClose: () => void;
  onRemixTitle?: () => void;
  onRemixThumbnail?: () => void;
  channelGroups?: Array<{ id: string; name: string; }>;
  onAddChannel?: (channelId: string, groupId: string, newGroupName?: string) => Promise<void>;
}

// Category ID to Name mapping
const CATEGORY_NAMES: Record<string, string> = {
  '1': '영화/애니', '2': '자동차', '10': '음악', '15': '동물', '17': '스포츠',
  '18': '단편영화', '19': '여행', '20': '게임', '22': '브이로그/인물', '23': '코미디',
  '24': '엔터테인먼트', '25': '뉴스/정치', '26': '노하우/스타일', '27': '교육',
  '28': '과학/기술', '29': '비영리/사회'
};

export const VideoDetailModal: React.FC<VideoDetailModalProps> = ({ video, onClose, channelGroups = [], onAddChannel }) => {
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
    const hours = getHoursSinceUpload(video.uploadTime);
    
    let outlier = parseFloat(video.viralScore.replace('x', ''));
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
          
          <div className="flex items-center gap-3 mb-3">
            <div className="size-10 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-sm font-bold text-white shrink-0">
              {video.channelName.substring(0,1)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">{video.channelName}</p>
              <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
                <span>{video.subscribers}</span>
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
            <div className="flex gap-2 shrink-0">
              <a
                href={videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg text-white text-sm font-bold transition-all flex items-center gap-2 shadow-lg"
              >
                <span className="material-symbols-outlined text-base">play_circle</span>
                <span>보기</span>
              </a>
              {video.channelId && onAddChannel && (
              <div className="relative">
                <button
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-bold text-white transition-all flex items-center gap-2 shadow-lg disabled:opacity-50"
                  onClick={() => setShowGroupDropdown(!showGroupDropdown)}
                  disabled={isAdding}
                >
                  {isAdding ? (
                    <>
                      <span className="material-symbols-outlined text-base animate-spin">sync</span>
                      <span>추가 중...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-base">add</span>
                      <span>채널 추가</span>
                    </>
                  )}
                </button>

                {showGroupDropdown && (
                  <div className="absolute top-full mt-2 right-0 w-64 bg-slate-900 border border-white/20 rounded-xl shadow-2xl overflow-hidden z-50 animate-in zoom-in-95 fade-in">
                    <div className="p-3 border-b border-white/10 bg-slate-800/50">
                      <div className="text-xs font-bold text-slate-300 flex items-center gap-2">
                        <span className="material-symbols-outlined text-sm text-indigo-400">folder_open</span>
                        그룹 선택
                      </div>
                    </div>

                    <div className="max-h-60 overflow-y-auto" style={{ scrollbarWidth: 'thin' }}>
                      {channelGroups.filter(g => g.id !== 'all').length > 0 ? (
                        channelGroups.filter(g => g.id !== 'all').map(group => (
                          <button
                            key={group.id}
                            className="w-full text-left px-4 py-2.5 text-sm text-white hover:bg-indigo-600/80 transition-colors flex items-center gap-2 border-b border-white/5 last:border-b-0"
                            onClick={async () => {
                              if (onAddChannel && video.channelId) {
                                setIsAdding(true);
                                try {
                                  await onAddChannel(video.channelId, group.id);
                                  setShowGroupDropdown(false);
                                  onClose(); // 채널 추가 성공 후 모달 닫기
                                } catch (e: any) {
                                  console.error('채널 추가 실패:', e);
                                  setErrorMessage(e.message || '채널 추가 중 알 수 없는 오류가 발생했습니다.');
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
                        <div className="p-4 text-xs text-slate-500 text-center">
                          그룹이 없습니다.
                        </div>
                      )}
                    </div>

                    <div className="p-2 border-t border-white/10 bg-slate-800/30">
                      {!isCreatingGroup ? (
                        <button
                          onClick={() => setIsCreatingGroup(true)}
                          className="w-full px-3 py-2 rounded-lg text-xs font-bold text-emerald-400 hover:bg-emerald-500/10 transition-colors flex items-center justify-center gap-2 border border-dashed border-emerald-500/30"
                        >
                          <span className="material-symbols-outlined text-sm">add_circle</span>
                          새 그룹 만들기
                        </button>
                      ) : (
                        <div className="space-y-2 animate-in slide-in-from-top-2">
                          <input
                            type="text"
                            value={newGroupName}
                            onChange={(e) => setNewGroupName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' && newGroupName.trim()) {
                                handleCreateAndAdd();
                              } else if (e.key === 'Escape') {
                                setIsCreatingGroup(false);
                                setNewGroupName('');
                              }
                            }}
                            placeholder="그룹명 입력..."
                            className="w-full px-3 py-2 bg-slate-800 border border-white/20 rounded-lg text-xs text-white focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none"
                            autoFocus
                          />
                          <div className="flex gap-2">
                            <button
                              onClick={handleCreateAndAdd}
                              disabled={!newGroupName.trim() || isAdding}
                              className="flex-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-500 text-white rounded-lg text-xs font-bold transition-colors"
                            >
                              생성 & 추가
                            </button>
                            <button
                              onClick={() => {
                                setIsCreatingGroup(false);
                                setNewGroupName('');
                              }}
                              className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-xs font-bold transition-colors"
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
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          
          {video.duration !== '0:00' ? (
            <>
              {/* Top Row: Thumbnail + Booster */}
              <div className="grid grid-cols-2 gap-3">
                {/* Thumbnail */}
                <div className="relative h-28 rounded-xl overflow-hidden border border-white/10 group">
                  <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center">
                    <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="size-10 rounded-full bg-red-600 flex items-center justify-center shadow-xl hover:scale-110 transition-transform">
                      <span className="material-symbols-outlined text-white text-2xl fill-current">play_arrow</span>
                    </a>
                  </div>
                </div>

                {/* Booster Score */}
                <div className="bg-gradient-to-br from-indigo-600 to-purple-600 rounded-2xl p-4 relative overflow-hidden flex flex-col justify-center h-28">
                  <div className="absolute top-0 right-0 w-24 h-24 bg-white/10 rounded-full blur-2xl"></div>
                  <div className="relative">
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="material-symbols-outlined text-white/80 text-base">local_fire_department</span>
                      <span className="text-[10px] font-bold text-white/80 uppercase">부스터</span>
                    </div>
                    <div className="text-4xl font-black text-white mb-0.5">
                      {stats.outlier}x
                    </div>
                    <div className="text-[10px] text-white/70">평소보다 {stats.outlier}배 인기</div>
                  </div>
                </div>
              </div>

              {/* Stats Grid - 2x3 */}
              <div className="grid grid-cols-2 gap-3">
                {/* Views */}
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="material-symbols-outlined text-sky-400 text-lg">visibility</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">조회</span>
                  </div>
                  <div className="text-2xl font-black text-white">
                    {stats.views >= 10000 ? (stats.views / 10000).toFixed(1) + '만' : stats.views.toLocaleString()}
                  </div>
                </div>

                {/* VPH */}
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="material-symbols-outlined text-amber-400 text-lg">schedule</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">시간당</span>
                  </div>
                  <div className="text-2xl font-black text-white">{stats.vph.toLocaleString()}</div>
                </div>

                {/* Engagement */}
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="material-symbols-outlined text-emerald-400 text-lg">thumb_up</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">참여도</span>
                  </div>
                  <div className={`text-xl font-black ${stats.engagementColor}`}>
                    {stats.engagementGrade}
                  </div>
                </div>

                {/* Duration */}
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="material-symbols-outlined text-purple-400 text-lg">timer</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">재생시간</span>
                  </div>
                  <div className="text-2xl font-black text-white">{video.duration}</div>
                </div>

                {/* Avg Views */}
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="material-symbols-outlined text-orange-400 text-lg">trending_up</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">평균조회</span>
                  </div>
                  <div className="text-lg font-black text-white">{video.avgViews}</div>
                </div>

                {/* Category */}
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="material-symbols-outlined text-pink-400 text-lg">category</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">카테고리</span>
                  </div>
                  <div className="text-sm font-black text-white truncate">{getCategoryName(video.category)}</div>
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
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <span className="material-symbols-outlined text-pink-400 text-lg">category</span>
                    <span className="text-[10px] font-bold text-slate-400 uppercase">카테고리</span>
                  </div>
                  <div className="text-base font-black text-white truncate">{getCategoryName(video.category)}</div>
                </div>

                {video.channelCountry && (
                  <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="material-symbols-outlined text-blue-400 text-lg">flag</span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">국가</span>
                    </div>
                    <div className="text-base font-black text-white">{getFlagEmoji(video.channelCountry)} {video.channelCountry}</div>
                  </div>
                )}

                {video.avgViews && video.avgViews !== '0' && (
                  <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="material-symbols-outlined text-orange-400 text-lg">trending_up</span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">평균 조회</span>
                    </div>
                    <div className="text-base font-black text-white">{video.avgViews}</div>
                  </div>
                )}

                {video.channelTotalViews && (
                  <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="material-symbols-outlined text-sky-400 text-lg">visibility</span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">총 조회</span>
                    </div>
                    <div className="text-base font-black text-white">{video.channelTotalViews}</div>
                  </div>
                )}

                {video.viralScore && video.viralScore !== '0x' && (
                  <div className="bg-slate-900/80 border border-white/10 rounded-xl p-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <span className="material-symbols-outlined text-purple-400 text-lg">local_fire_department</span>
                      <span className="text-[10px] font-bold text-slate-400 uppercase">성장 지수</span>
                    </div>
                    <div className="text-base font-black text-purple-400">{video.viralScore}</div>
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

import React, { useMemo } from 'react';
import { VideoData } from '../../types';

interface VideoDetailModalProps {
  video: VideoData;
  onClose: () => void;
  onRemixTitle?: () => void;
  onRemixThumbnail?: () => void;
}

export const VideoDetailModal: React.FC<VideoDetailModalProps> = ({ video, onClose, onRemixTitle, onRemixThumbnail }) => {
  
  // 1. 숫자 파싱 (1.2만 -> 12000)
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

  // 2. 시간 파싱 ("2일 전" -> 시간 단위 계산)
  // 기존 VideoData에는 'uploadTime'이 "2일 전" 같은 문자열로 있어서 정확한 시간 계산은 어렵지만, 역산해서 추정합니다.
  const getHoursSinceUpload = (timeStr: string) => {
    const num = parseInt(timeStr.replace(/[^0-9]/g, "")) || 1;
    if (timeStr.includes("분")) return num / 60;
    if (timeStr.includes("시간")) return num;
    if (timeStr.includes("일")) return num * 24;
    if (timeStr.includes("주")) return num * 24 * 7;
    if (timeStr.includes("달") || timeStr.includes("개월")) return num * 24 * 30;
    if (timeStr.includes("년")) return num * 24 * 365;
    return 24; // Default fallback
  };

  // 3. 통계 계산
  const stats = useMemo(() => {
    const views = parseCount(video.views);
    const avgViews = parseCount(video.avgViews);
    const hours = getHoursSinceUpload(video.uploadTime);
    
    // Outlier Score: 평균 대비 몇 배나 잘 나왔나?
    // Use the pre-calculated viralScore from the API for consistency
    let outlier = parseFloat(video.viralScore.replace('x', ''));
    outlier = parseFloat(outlier.toFixed(1));

    // VPH (Views Per Hour)
    const vph = hours > 0 ? Math.round(views / hours) : 0;

    // Engagement (Viral Score 활용)
    // Viral Score is likely views/subs ratio. 
    // Let's use it to determine grade.
    const viral = parseFloat(video.viralScore) || 0;
    let engagementGrade = "N/A";
    let engagementColor = "text-slate-400";
    
    if (viral > 1000) { engagementGrade = "Legendary"; engagementColor = "text-purple-500"; }
    else if (viral > 300) { engagementGrade = "Great"; engagementColor = "text-emerald-500"; }
    else if (viral > 100) { engagementGrade = "Good"; engagementColor = "text-blue-500"; }
    else if (viral > 50) { engagementGrade = "Average"; engagementColor = "text-amber-500"; }
    else { engagementGrade = "Low"; engagementColor = "text-slate-500"; }

    // Contribution: 구독자 대비 조회수 기여도 (Views / Subscribers)
    const subscribers = parseCount(video.subscribers);
    const contribution = subscribers > 0 ? (views / subscribers * 100).toFixed(0) : "0";

    // Tag Analysis
    const tagCount = video.tags ? video.tags.length : 0;
    const avgTagLen = video.tags && tagCount > 0 ? (video.tags.reduce((acc, tag) => acc + tag.length, 0) / tagCount).toFixed(0) : 0;

    return { views, outlier, vph, engagementGrade, engagementColor, contribution, tagCount, avgTagLen };
  }, [video]);

  // Country Flag Helper
  const getFlagEmoji = (countryCode?: string) => {
    if (!countryCode) return "🌐";
    const codePoints = countryCode
      .toUpperCase()
      .split('')
      .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
  };

  // 유튜브 링크
  const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div className="bg-[#0f1117] w-full max-w-5xl rounded-3xl overflow-hidden shadow-2xl border border-white/5 relative flex flex-col md:flex-row animate-in zoom-in-95 duration-300" onClick={e => e.stopPropagation()}>
        
        {/* Close Button */}
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 z-20 size-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors"
        >
          <span className="material-symbols-outlined text-lg">close</span>
        </button>

        {/* Left Section: Video Preview & Info */}
        <div className="md:w-[45%] bg-black/30 p-6 md:p-8 flex flex-col justify-between border-b md:border-b-0 md:border-r border-white/5">
           <div>
             <div className="relative aspect-video rounded-2xl overflow-hidden shadow-2xl group border border-white/10 mb-6">
                <img src={video.thumbnailUrl} alt={video.title} className="w-full h-full object-cover opacity-80 group-hover:opacity-100 transition-opacity duration-500" />
                <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/40 transition-colors">
                  <div className="size-16 rounded-full bg-red-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300">
                    <span className="material-symbols-outlined text-white text-4xl fill-current">play_arrow</span>
                  </div>
                </a>
             </div>
             
             <h2 className="text-xl md:text-2xl font-black text-white leading-tight mb-3 line-clamp-3">
               {video.title}
             </h2>
             
             <div className="flex items-center gap-3 mb-6">
               <div className="size-8 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-xs font-bold text-white shadow-inner">
                 {video.channelName.substring(0,1)}
               </div>
               <div>
                   <p className="text-sm font-bold text-slate-200">{video.channelName}</p>
                   <p className="text-xs text-slate-500 font-medium mb-1">{video.subscribers} 구독 · {video.uploadTime}</p>
                   {video.channelCountry && (
                     <div className="flex gap-2 text-[10px] text-slate-400 font-bold items-center">
                        <span className="flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                           <span>{getFlagEmoji(video.channelCountry)}</span>
                           <span>{video.channelCountry}</span>
                        </span>
                        {video.channelJoinDate && (
                           <span className="bg-white/5 px-1.5 py-0.5 rounded border border-white/5">
                              {new Date(video.channelJoinDate).getFullYear()}년 가입
                           </span>
                        )}
                     </div>
                   )}
                </div>
             </div>
           </div>

           <div className="space-y-3">
              <h3 className="text-xs font-black text-slate-500 uppercase tracking-widest mb-2">빠른 실행</h3>
              <div className="grid grid-cols-2 gap-3">
                 <a href={videoUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-4 bg-slate-800/50 hover:bg-slate-700/50 rounded-xl border border-white/5 hover:border-white/10 transition-all group">
                    <span className="material-symbols-outlined text-slate-400 group-hover:text-white transition-colors">open_in_new</span>
                    <span className="text-sm font-bold text-slate-300 group-hover:text-white">YouTube에서 보기</span>
                 </a>
                 <button className="flex items-center gap-3 p-4 bg-slate-800/50 hover:bg-slate-700/50 rounded-xl border border-white/5 hover:border-white/10 transition-all group opacity-50 cursor-not-allowed" title="준비 중인 기능입니다">
                    <span className="material-symbols-outlined text-slate-400">lightbulb</span>
                    <span className="text-sm font-bold text-slate-300">AI 제목 추천</span>
                 </button>
                 <button className="flex items-center gap-3 p-4 bg-slate-800/50 hover:bg-slate-700/50 rounded-xl border border-white/5 hover:border-white/10 transition-all group opacity-50 cursor-not-allowed col-span-2" title="준비 중인 기능입니다">
                    <span className="material-symbols-outlined text-slate-400">image</span>
                    <span className="text-sm font-bold text-slate-300">AI 썸네일 분석</span>
                 </button>
              </div>
           </div>
        </div>

        {/* Right Section: Stats Grid */}
        <div className="flex-1 p-6 md:p-8 bg-gradient-to-br from-[#13151c] to-[#0f1117]">
           <div className="grid grid-cols-1 md:grid-cols-2 gap-4 h-full content-start">
              
               {/* Grid Logic: Channel vs Video */}
               {video.duration === '0:00' ? (
                  <>
                     {/* Channel Subscribers */}
                     <div className="bg-[#1a1d26] rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-colors relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                           <span className="material-symbols-outlined text-6xl text-indigo-500">group</span>
                        </div>
                        <div className="flex items-start gap-3 mb-4">
                           <span className="material-symbols-outlined text-indigo-500">group</span>
                        </div>
                        <div className="text-3xl font-black text-white mb-1 truncate">
                           {video.subscribers}
                        </div>
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">구독자 수</div>
                     </div>

                     {/* Channel Category */}
                     <div className="bg-[#1a1d26] rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-colors relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                           <span className="material-symbols-outlined text-6xl text-pink-500">category</span>
                        </div>
                        <div className="flex items-start gap-3 mb-4">
                           <span className="material-symbols-outlined text-pink-500">category</span>
                        </div>
                        <div className="text-3xl font-black text-white mb-1 truncate">
                           {video.category}
                        </div>
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">카테고리</div>
                     </div>

                     {/* Channel Established */}
                     <div className="bg-[#1a1d26] rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-colors relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                           <span className="material-symbols-outlined text-6xl text-emerald-500">calendar_month</span>
                        </div>
                        <div className="flex items-start gap-3 mb-4">
                           <span className="material-symbols-outlined text-emerald-500">calendar_month</span>
                        </div>
                        <div className="text-3xl font-black text-white mb-1 truncate">
                           {!isNaN(new Date(video.publishedAt).getFullYear()) ? new Date(video.publishedAt).getFullYear() + '년' : '-'}
                        </div>
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">채널 개설일</div>
                     </div>

                     {/* Channel Name / Info */}
                     <div className="bg-[#1a1d26] rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-colors relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                           <span className="material-symbols-outlined text-6xl text-amber-500">verified</span>
                        </div>
                        <div className="flex items-start gap-3 mb-4">
                           <span className="material-symbols-outlined text-amber-500">verified</span>
                        </div>
                        <div className="text-xl font-black text-white mb-1 line-clamp-2 leading-tight">
                           {video.channelName}
                        </div>
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">채널명</div>
                     </div>
                  </>
               ) : (
                  <>
                     {/* Outlier Score */}
                     <div className="bg-[#1a1d26] rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-colors relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                           <span className="material-symbols-outlined text-6xl text-indigo-500">local_fire_department</span>
                        </div>
                        <div className="flex items-start gap-3 mb-4">
                           <span className="material-symbols-outlined text-indigo-500">local_fire_department</span>
                        </div>
                        <div className="text-4xl font-black text-white mb-1">
                           {stats.outlier}x
                        </div>
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">부스터 점수 (Booster)</div>
                        <div className="mt-4 text-[10px] text-slate-400 font-medium bg-white/5 inline-block px-2 py-1 rounded">평소보다 {stats.outlier}배 더 인기</div>
                     </div>

                     {/* Views */}
                     <div className="bg-[#1a1d26] rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-colors relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                           <span className="material-symbols-outlined text-6xl text-sky-500">visibility</span>
                        </div>
                        <div className="flex items-start gap-3 mb-4">
                           <span className="material-symbols-outlined text-sky-500">visibility</span>
                        </div>
                        <div className="text-4xl font-black text-white mb-1">
                           {stats.views >= 10000 ? (stats.views / 10000).toFixed(1) + '만' : stats.views.toLocaleString()}
                        </div>
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">현재 조회수</div>
                     </div>

                     {/* VPH */}
                     <div className="bg-[#1a1d26] rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-colors relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                           <span className="material-symbols-outlined text-6xl text-amber-500">schedule</span>
                        </div>
                        <div className="flex items-start gap-3 mb-4">
                           <span className="material-symbols-outlined text-amber-500">schedule</span>
                        </div>
                        <div className="text-4xl font-black text-white mb-1">
                           {stats.vph.toLocaleString()}
                        </div>
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">시간당 조회수 (VPH)</div>
                     </div>

                     {/* Engagement */}
                     <div className="bg-[#1a1d26] rounded-2xl p-6 border border-white/5 hover:border-white/10 transition-colors relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
                           <span className="material-symbols-outlined text-6xl text-emerald-500">thumb_up</span>
                        </div>
                        <div className="flex items-start gap-3 mb-4">
                           <span className="material-symbols-outlined text-emerald-500">thumb_up</span>
                        </div>
                        <div className={`text-3xl font-black mb-1 ${stats.engagementColor}`}>
                           {stats.engagementGrade}
                        </div>
                        <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">참여도 등급</div>
                     </div>
                  </>
               )}



               {/* Tags Helper (Enhanced) */}
               <div className="md:col-span-2 mt-4 bg-[#1a1d26] rounded-2xl p-5 border border-white/5">
                  <div className="flex items-center justify-between mb-3">
                     <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-purple-400 text-sm">tag</span>
                        <span className="text-xs font-bold text-purple-400 uppercase">태그 분석</span>
                        <span className="bg-purple-500/10 text-purple-400 text-[10px] px-1.5 py-0.5 rounded border border-purple-500/20">무료 분석</span>
                     </div>
                     <div className="flex gap-3 text-[10px] text-slate-500 font-bold">
                        <span>{stats.tagCount}개</span>
                        <span>평균 {stats.avgTagLen}자</span>
                     </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                     {video.tags?.slice(0, 15).map((tag, i) => (
                        <span key={i} className={`px-2 py-1 text-[10px] font-bold rounded border ${tag.length < 5 ? 'bg-emerald-900/20 text-emerald-400 border-emerald-500/20' : 'bg-black/30 text-slate-300 border-white/5'}`}>
                           {tag.replace(/#/g, '')}
                        </span>
                     ))}
                     {(!video.tags || video.tags.length === 0) && (
                        <span className="text-slate-600 text-xs italic">태그 정보 없음</span>
                     )}
                  </div>
               </div>
           </div>
        </div>

      </div>
    </div>
  );
};

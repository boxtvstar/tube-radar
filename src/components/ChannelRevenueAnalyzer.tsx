import React, { useState } from 'react';
import { getChannelInfo } from '../../services/youtubeService';
import { SavedChannel, VideoData } from '../../types';

interface ChannelRevenueAnalyzerProps {
  apiKey: string;
  onSelectVideo?: (video: VideoData) => void;
  onTrackUsage?: (type: 'search' | 'list' | 'script', units: number, details?: string) => void;
  onPreCheckQuota?: (cost: number) => Promise<void>;
}

// 카테고리별 CPM 범위 (KRW, 1000뷰 기준)
const CPM_DATA: Record<string, { min: number; max: number; label: string }> = {
  '금융/비즈니스': { min: 5000, max: 15000, label: '금융/비즈니스' },
  '과학/기술': { min: 3000, max: 8000, label: '과학/기술' },
  '교육': { min: 2500, max: 7000, label: '교육' },
  '노하우/스타일': { min: 2500, max: 6000, label: '노하우/스타일' },
  '자동차': { min: 3000, max: 8000, label: '자동차' },
  '여행': { min: 2000, max: 5000, label: '여행' },
  '게임': { min: 1000, max: 3500, label: '게임' },
  '엔터테인먼트': { min: 1500, max: 5000, label: '엔터테인먼트' },
  '음악': { min: 800, max: 2500, label: '음악' },
  '코미디': { min: 1500, max: 4000, label: '코미디' },
  '스포츠': { min: 1500, max: 4000, label: '스포츠' },
  '뉴스/정치': { min: 2000, max: 5000, label: '뉴스/정치' },
  '브이로그/인물': { min: 1500, max: 4500, label: '브이로그/인물' },
  '동물': { min: 1200, max: 3500, label: '동물' },
  '영화/애니': { min: 1200, max: 3500, label: '영화/애니' },
  '기타': { min: 1200, max: 4000, label: '기타' },
};

const CATEGORY_MAP: Record<string, string> = {
  '1': '영화/애니', '2': '자동차', '10': '음악', '15': '동물', '17': '스포츠',
  '19': '여행', '20': '게임', '22': '브이로그/인물', '23': '코미디',
  '24': '엔터테인먼트', '25': '뉴스/정치', '26': '노하우/스타일', '27': '교육',
  '28': '과학/기술', '29': '기타',
};

const parseISODuration = (d: string) => {
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return '0:00';
  const h = m[1] || '';
  const min = (m[2] || '0').padStart(2, '0');
  const sec = (m[3] || '0').padStart(2, '0');
  return h ? `${h}:${min}:${sec}` : `${min}:${sec}`;
};

const parseDurationToSeconds = (d: string) => {
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || '0') * 3600) + (parseInt(m[2] || '0') * 60) + parseInt(m[3] || '0');
};

const parseNum = (val?: string) => {
  if (!val) return 0;
  const s = String(val).replace(/,/g, '').replace(/[^\d.KMB만억천]/gi, '');
  let n = parseFloat(s) || 0;
  if (/억/i.test(val)) n *= 100000000;
  else if (/만/i.test(val)) n *= 10000;
  else if (/천/i.test(val)) n *= 1000;
  else if (/B/i.test(val)) n *= 1000000000;
  else if (/M/i.test(val)) n *= 1000000;
  else if (/K/i.test(val)) n *= 1000;
  return Math.round(n);
};

const formatKRW = (num: number) => {
  if (num >= 100000000) return `${(num / 100000000).toFixed(1)}억원`;
  if (num >= 10000) return `${(num / 10000).toFixed(0)}만원`;
  return `${num.toLocaleString()}원`;
};

const formatCount = (num: number) => {
  if (num >= 100000000) return `${(num / 100000000).toFixed(1)}억`;
  if (num >= 10000) return `${(num / 10000).toFixed(1)}만`;
  return num.toLocaleString();
};

interface AnalysisResult {
  channel: SavedChannel;
  category: string;
  categoryId: string;
  isMonetizable: boolean;
  monetizeReason: string[];
  monthlyViews: number;
  revenueMin: number;
  revenueMax: number;
  yearlyRevenueMin: number;
  yearlyRevenueMax: number;
  cpmRange: { min: number; max: number };
  uploadFrequency: string;
  avgViewsPerVideo: number;
  channelAge: number; // years
  healthScore: number; // 0-100
  healthGrade: string;
  healthColor: string;
  subsToViewRatio: number;
  avgDurationSec: number;
  shortsRatio: number; // 0~1
  adMultiplier: number;
  recentVideoStats: { id: string; title: string; views: number; publishedAt: string; thumbnail: string; duration: string; categoryId: string; channelTitle: string }[];
}

export const ChannelRevenueAnalyzer: React.FC<ChannelRevenueAnalyzerProps> = ({ apiKey, onSelectVideo, onTrackUsage, onPreCheckQuota }) => {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);

  const analyzeChannel = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setError('');
    setResult(null);

    try {
      // 0. 포인트 사전 체크 (100포인트)
      if (onPreCheckQuota) {
        await onPreCheckQuota(100);
      }

      // 1. 채널 기본 정보 가져오기
      const channelInfo = await getChannelInfo(apiKey, input);
      if (!channelInfo) {
        throw new Error('채널을 찾을 수 없습니다. URL, 핸들(@), 또는 채널 ID를 확인해주세요.');
      }

      const subs = parseNum(channelInfo.subscriberCount);
      const totalViews = parseNum(channelInfo.totalViews);
      const videoCount = parseNum(channelInfo.videoCount);
      const avgViews = channelInfo.customAvgViews || (videoCount > 0 ? Math.round(totalViews / videoCount) : 0);

      // 2. 최근 영상 분석 (카테고리 + 업로드 빈도)
      const uploadsId = channelInfo.id.replace(/^UC/, 'UU');
      const plRes = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&playlistId=${uploadsId}&maxResults=20&key=${apiKey}`);
      const plData = await plRes.json();
      const videoIds = (plData.items || []).map((i: any) => i.snippet.resourceId.videoId);

      let recentVideos: { id: string; title: string; views: number; publishedAt: string; categoryId: string; thumbnail: string; duration: string; channelTitle: string }[] = [];
      let mainCategoryId = '24'; // default entertainment

      if (videoIds.length > 0) {
        const vRes = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoIds.join(',')}&key=${apiKey}`);
        const vData = await vRes.json();

        if (vData.items) {
          recentVideos = vData.items.map((v: any) => ({
            id: v.id,
            title: v.snippet.title,
            views: parseInt(v.statistics.viewCount || '0'),
            publishedAt: v.snippet.publishedAt,
            categoryId: v.snippet.categoryId || '24',
            thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || '',
            duration: v.contentDetails?.duration || '',
            channelTitle: v.snippet.channelTitle || '',
          }));

          // 최빈 카테고리 계산
          const catCount = new Map<string, number>();
          recentVideos.forEach(v => catCount.set(v.categoryId, (catCount.get(v.categoryId) || 0) + 1));
          mainCategoryId = [...catCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || '24';
        }
      }

      // 3. 카테고리 & CPM 결정
      const category = CATEGORY_MAP[mainCategoryId] || '기타';
      const cpmRange = CPM_DATA[category] || CPM_DATA['기타'];

      // 4. 업로드 빈도 계산
      let uploadFrequency = '분석 불가';
      if (recentVideos.length >= 2) {
        const dates = recentVideos.map(v => new Date(v.publishedAt).getTime()).sort((a, b) => b - a);
        const daysBetween = (dates[0] - dates[dates.length - 1]) / (1000 * 60 * 60 * 24);
        const avgDays = daysBetween / (dates.length - 1);
        if (avgDays < 1.5) uploadFrequency = '매일';
        else if (avgDays < 3.5) uploadFrequency = `주 ${Math.round(7 / avgDays)}회`;
        else if (avgDays < 8) uploadFrequency = '주 1회';
        else if (avgDays < 15) uploadFrequency = '2주 1회';
        else if (avgDays < 35) uploadFrequency = '월 1회';
        else uploadFrequency = `${Math.round(avgDays)}일 1회`;
      }

      // 5. 월간 조회수 추정
      let monthlyViews = 0;
      if (recentVideos.length >= 2) {
        const now = Date.now();
        const last30 = recentVideos.filter(v => (now - new Date(v.publishedAt).getTime()) < 30 * 24 * 60 * 60 * 1000);
        if (last30.length > 0) {
          monthlyViews = last30.reduce((sum, v) => sum + v.views, 0);
        } else {
          // 최근 30일 영상이 없으면 평균으로 추정
          const dates = recentVideos.map(v => new Date(v.publishedAt).getTime()).sort((a, b) => b - a);
          const daysBetween = (dates[0] - dates[dates.length - 1]) / (1000 * 60 * 60 * 24);
          const videosPerMonth = daysBetween > 0 ? (recentVideos.length / daysBetween) * 30 : 1;
          monthlyViews = Math.round(avgViews * videosPerMonth);
        }
      } else {
        monthlyViews = Math.round(avgViews * 4); // 주 1회 업로드 가정
      }

      // 6. 영상 길이 / 쇼츠 분석 → 수익 보정
      const durations = recentVideos.map(v => parseDurationToSeconds(v.duration || ''));
      const avgDurationSec = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
      const shortsCount = durations.filter(d => d > 0 && d <= 60).length;
      const shortsRatio = durations.length > 0 ? shortsCount / durations.length : 0;
      const longCount = durations.filter(d => d >= 480).length; // 8분 이상 (미드롤 가능)
      const longRatio = durations.length > 0 ? longCount / durations.length : 0;

      // 보정 계수 계산 (CPM은 이미 RPM 기반이므로 fill rate 별도 적용 안 함)
      // 1) 미드롤 보정: 8분+ 영상 비율 × 최대 1.8배 (미드롤 광고 2~3개 추가)
      const midrollBonus = 1 + (longRatio * 0.8);
      // 2) 쇼츠 감소: 쇼츠 CPM은 일반의 ~15% 수준
      const shortsDiscount = 1 - (shortsRatio * 0.85);
      // 최종 보정 계수
      const adMultiplier = midrollBonus * shortsDiscount;

      const revenueMin = Math.round((monthlyViews / 1000) * cpmRange.min * adMultiplier);
      const revenueMax = Math.round((monthlyViews / 1000) * cpmRange.max * adMultiplier);

      // 7. 수익화 자격 판단
      const isMonetizable = subs >= 1000;
      const monetizeReason: string[] = [];
      if (subs < 1000) monetizeReason.push(`구독자 ${formatCount(subs)}명 (최소 1,000명 필요)`);
      else monetizeReason.push(`구독자 ${formatCount(subs)}명 ✓`);
      if (videoCount < 1) monetizeReason.push('업로드된 영상 없음');
      else monetizeReason.push(`영상 ${formatCount(videoCount)}개 ✓`);

      // 8. 채널 나이
      const joinDate = channelInfo.joinDate ? new Date(channelInfo.joinDate) : new Date();
      const channelAge = Math.max(0, (Date.now() - joinDate.getTime()) / (1000 * 60 * 60 * 24 * 365));

      // 9. 구독자 대비 조회수 비율
      const subsToViewRatio = subs > 0 ? (avgViews / subs) * 100 : 0;

      // 10. 채널 건강 점수 (0-100)
      let healthScore = 0;
      // 구독자 점수 (max 20)
      if (subs >= 1000000) healthScore += 20;
      else if (subs >= 100000) healthScore += 16;
      else if (subs >= 10000) healthScore += 12;
      else if (subs >= 1000) healthScore += 8;
      else healthScore += 3;
      // 구독자 대비 조회수 (max 25)
      if (subsToViewRatio >= 50) healthScore += 25;
      else if (subsToViewRatio >= 30) healthScore += 20;
      else if (subsToViewRatio >= 15) healthScore += 15;
      else if (subsToViewRatio >= 5) healthScore += 10;
      else healthScore += 3;
      // 업로드 빈도 (max 20)
      if (uploadFrequency === '매일') healthScore += 20;
      else if (uploadFrequency.includes('주') && !uploadFrequency.includes('2주')) healthScore += 16;
      else if (uploadFrequency === '주 1회') healthScore += 12;
      else if (uploadFrequency === '2주 1회') healthScore += 8;
      else healthScore += 4;
      // 평균 조회수 (max 20)
      if (avgViews >= 1000000) healthScore += 20;
      else if (avgViews >= 100000) healthScore += 16;
      else if (avgViews >= 10000) healthScore += 12;
      else if (avgViews >= 1000) healthScore += 8;
      else healthScore += 3;
      // 채널 나이 (max 15)
      if (channelAge >= 3) healthScore += 15;
      else if (channelAge >= 1) healthScore += 10;
      else healthScore += 5;

      let healthGrade = 'F';
      let healthColor = 'text-slate-500';
      if (healthScore >= 85) { healthGrade = 'S'; healthColor = 'text-purple-500'; }
      else if (healthScore >= 70) { healthGrade = 'A'; healthColor = 'text-emerald-500'; }
      else if (healthScore >= 55) { healthGrade = 'B'; healthColor = 'text-blue-500'; }
      else if (healthScore >= 40) { healthGrade = 'C'; healthColor = 'text-amber-500'; }
      else if (healthScore >= 25) { healthGrade = 'D'; healthColor = 'text-orange-500'; }
      else { healthGrade = 'F'; healthColor = 'text-rose-500'; }

      setResult({
        channel: channelInfo,
        category,
        categoryId: mainCategoryId,
        isMonetizable,
        monetizeReason,
        monthlyViews,
        revenueMin,
        revenueMax,
        yearlyRevenueMin: revenueMin * 12,
        yearlyRevenueMax: revenueMax * 12,
        cpmRange,
        uploadFrequency,
        avgViewsPerVideo: avgViews,
        channelAge,
        healthScore,
        healthGrade,
        healthColor,
        subsToViewRatio,
        avgDurationSec,
        shortsRatio,
        adMultiplier,
        recentVideoStats: recentVideos.slice(0, 5),
      });

      // 분석 성공 시 100포인트 차감
      if (onTrackUsage) {
        onTrackUsage('list', 100, '채널 수익 분석');
      }

    } catch (err: any) {
      if (err.message?.startsWith('QUOTA_INSUFFICIENT')) {
        setError('포인트가 부족합니다. 수익 분석에는 100포인트가 필요합니다.');
      } else {
        setError(err.message || '분석 중 오류가 발생했습니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full space-y-8 animate-in slide-in-from-right-4 duration-500 pb-20">
      <div className="space-y-6">
        <div className="space-y-2">
          <h2 className="text-xl md:text-2xl font-black italic tracking-tighter text-emerald-600 dark:text-emerald-400 uppercase flex items-center gap-3">
            <span className="material-symbols-outlined text-2xl md:text-3xl">monetization_on</span>
            채널 수익 분석기
          </h2>
          <p className="text-slate-500 text-[11px] font-medium leading-relaxed hidden md:block">
            유튜브 채널의 <span className="text-emerald-500 font-bold">예상 수익과 수익화 상태</span>를 분석합니다.<br />
            카테고리별 CPM 데이터 기반으로 <span className="text-rose-500 font-bold">월간/연간 예상 수익</span>을 추정합니다.
          </p>
        </div>
      </div>

      <div className="max-w-3xl space-y-6">
        {/* Input */}
        <div className="relative group">
          <div className="absolute inset-y-0 left-4 flex items-center text-slate-400 group-focus-within:text-emerald-500 transition-colors">
            <span className="material-symbols-outlined">search</span>
          </div>
          <input
            type="text"
            placeholder="채널 URL, 핸들(@), 또는 채널 ID 입력..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && analyzeChannel()}
            className="w-full pl-12 pr-32 py-4 bg-white dark:bg-slate-900 border-2 border-slate-100 dark:border-slate-800 rounded-2xl focus:border-emerald-500 dark:focus:border-emerald-500 outline-none text-slate-900 dark:text-white font-bold transition-all shadow-sm"
          />
          <button
            onClick={analyzeChannel}
            disabled={loading || !input}
            className="absolute right-2 top-2 bottom-2 px-6 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 dark:disabled:bg-slate-800 text-white rounded-xl font-bold text-sm transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-95"
          >
            {loading ? (
              <div className="size-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <span className="material-symbols-outlined text-lg">analytics</span>
            )}
            분석하기
          </button>
        </div>

        {error && (
          <div className="p-4 bg-rose-50 dark:bg-rose-950/20 border border-rose-100 dark:border-rose-900/30 rounded-xl flex items-center gap-3 text-rose-600 dark:text-rose-400 text-sm font-bold animate-in fade-in zoom-in-95">
            <span className="material-symbols-outlined">error</span>
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="py-20 flex flex-col items-center justify-center gap-4 animate-pulse">
            <div className="size-16 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl text-emerald-500 animate-spin">sync</span>
            </div>
            <p className="text-slate-500 font-bold text-sm">채널 데이터 수집 및 수익 분석 중...</p>
          </div>
        )}

        {/* Results */}
        {result && (
          <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Channel Info Header */}
            <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5 flex items-center gap-4">
              <img src={result.channel.thumbnail} alt="" className="size-16 rounded-full border-2 border-emerald-200 dark:border-emerald-800 shadow-lg" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-black text-slate-900 dark:text-white truncate">{result.channel.title}</h3>
                  <a
                    href={`https://youtube.com/channel/${result.channel.id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 flex items-center gap-1 px-2.5 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg text-[10px] font-bold transition-all active:scale-95 shadow-sm"
                  >
                    <span className="material-symbols-outlined text-xs">open_in_new</span>
                    채널 바로가기
                  </a>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500 font-medium">
                  <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">group</span>{result.channel.subscriberCount}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">movie</span>{result.channel.videoCount}개</span>
                  <span>•</span>
                  <span className="flex items-center gap-1"><span className="material-symbols-outlined text-xs">visibility</span>총 {result.channel.totalViews}회</span>
                  {result.channel.country && <><span>•</span><span>{result.channel.country}</span></>}
                </div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[10px] font-bold text-slate-500">{result.category}</span>
                  <span className="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-[10px] font-bold text-slate-500">
                    {result.channelAge >= 1 ? `${Math.floor(result.channelAge)}년 ${Math.round((result.channelAge % 1) * 12)}개월` : `${Math.round(result.channelAge * 12)}개월`} 운영
                  </span>
                </div>
              </div>
            </div>

            {/* Monetization Status */}
            <div className={`rounded-2xl p-5 border ${result.isMonetizable
              ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-800'}`}>
              <div className="flex items-center gap-3 mb-3">
                <div className={`size-10 rounded-xl flex items-center justify-center ${result.isMonetizable ? 'bg-emerald-500' : 'bg-rose-500'} text-white shadow-lg`}>
                  <span className="material-symbols-outlined">{result.isMonetizable ? 'verified' : 'block'}</span>
                </div>
                <div>
                  <h4 className={`font-black text-sm ${result.isMonetizable ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
                    수익화 {result.isMonetizable ? '가능 (조건 충족)' : '불가 (조건 미충족)'}
                  </h4>
                  <p className="text-[10px] text-slate-500 font-medium">YouTube 파트너 프로그램 기준</p>
                </div>
              </div>
              <div className="space-y-1">
                {result.monetizeReason.map((reason, i) => (
                  <p key={i} className="text-xs text-slate-600 dark:text-slate-400 font-medium flex items-center gap-2">
                    <span className="material-symbols-outlined text-xs">{reason.includes('✓') ? 'check_circle' : 'cancel'}</span>
                    {reason}
                  </p>
                ))}
              </div>
              <p className="text-[10px] text-slate-400 mt-2 font-medium">* 실제 수익화는 YouTube 정책, 시청시간(4,000시간), 콘텐츠 가이드라인 등 추가 조건이 필요합니다.</p>
            </div>

            {/* Revenue Estimation - Main Card */}
            <div className="bg-gradient-to-br from-emerald-600 to-teal-700 rounded-2xl p-6 text-white relative overflow-hidden">
              <div className="absolute top-0 right-0 w-40 h-40 bg-white/5 rounded-full blur-3xl"></div>
              <div className="absolute bottom-0 left-0 w-32 h-32 bg-white/5 rounded-full blur-2xl"></div>
              <div className="relative">
                <div className="flex items-center gap-2 mb-4">
                  <span className="material-symbols-outlined text-white/80">payments</span>
                  <span className="text-xs font-black uppercase tracking-wider text-white/80">예상 광고 수익</span>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="text-[10px] text-white/60 font-bold mb-1">월간 예상 수익</div>
                    <div className="text-2xl md:text-3xl font-black leading-none">
                      {formatKRW(Math.round((result.revenueMin + result.revenueMax) / 2))}
                    </div>
                    <div className="text-xs font-bold text-white/50 mt-1.5">{formatKRW(result.revenueMin)} ~ {formatKRW(result.revenueMax)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-white/60 font-bold mb-1">연간 예상 수익</div>
                    <div className="text-2xl md:text-3xl font-black leading-none">
                      {formatKRW(Math.round((result.yearlyRevenueMin + result.yearlyRevenueMax) / 2))}
                    </div>
                    <div className="text-xs font-bold text-white/50 mt-1.5">{formatKRW(result.yearlyRevenueMin)} ~ {formatKRW(result.yearlyRevenueMax)}</div>
                  </div>
                </div>
                <div className="mt-4 pt-4 border-t border-white/20 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-bold text-white/70">
                  <span>월간 추정 조회수: {formatCount(result.monthlyViews)}회</span>
                  <span>•</span>
                  <span>CPM: ₩{result.cpmRange.min.toLocaleString()} ~ ₩{result.cpmRange.max.toLocaleString()}</span>
                  <span>•</span>
                  <span>카테고리: {result.category}</span>
                  <span>•</span>
                  <span>평균 길이: {result.avgDurationSec >= 60 ? `${Math.floor(result.avgDurationSec / 60)}분 ${Math.round(result.avgDurationSec % 60)}초` : `${Math.round(result.avgDurationSec)}초`}</span>
                  {result.shortsRatio > 0 && <><span>•</span><span>쇼츠 비율: {Math.round(result.shortsRatio * 100)}%</span></>}
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {/* Health Score */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">채널 건강도</span>
                <div className={`text-4xl font-black ${result.healthColor}`}>{result.healthGrade}</div>
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-1.5 mt-2">
                  <div className={`h-full rounded-full transition-all ${result.healthScore >= 70 ? 'bg-emerald-500' : result.healthScore >= 40 ? 'bg-amber-500' : 'bg-rose-500'}`} style={{ width: `${result.healthScore}%` }}></div>
                </div>
                <span className="text-[10px] text-slate-400 mt-1 font-bold">{result.healthScore}/100</span>
              </div>

              {/* Upload Frequency */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">업로드 빈도</span>
                <span className="material-symbols-outlined text-indigo-500 text-2xl mb-1">schedule</span>
                <div className="text-base font-black text-slate-900 dark:text-white">{result.uploadFrequency}</div>
              </div>

              {/* Avg Views */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">영상당 평균 조회</span>
                <span className="material-symbols-outlined text-sky-500 text-2xl mb-1">visibility</span>
                <div className="text-base font-black text-slate-900 dark:text-white">{formatCount(result.avgViewsPerVideo)}</div>
              </div>

              {/* Sub to View Ratio */}
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-4 flex flex-col items-center justify-center">
                <span className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">구독자 반응률</span>
                <span className="material-symbols-outlined text-amber-500 text-2xl mb-1">trending_up</span>
                <div className="text-base font-black text-slate-900 dark:text-white">{result.subsToViewRatio.toFixed(1)}%</div>
              </div>
            </div>

            {/* Recent Videos */}
            {result.recentVideoStats.length > 0 && (
              <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-5">
                <h4 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm">play_circle</span>
                  최근 영상 성과
                </h4>
                <div className="space-y-2">
                  {result.recentVideoStats.map((v, i) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        if (onSelectVideo && result) {
                          const videoData: VideoData = {
                            id: v.id,
                            title: v.title,
                            channelName: result.channel.title,
                            thumbnailUrl: v.thumbnail,
                            duration: parseISODuration(v.duration || ''),
                            views: String(v.views),
                            avgViews: String(result.avgViewsPerVideo),
                            subscribers: result.channel.subscriberCount || '',
                            viralScore: '',
                            uploadTime: v.publishedAt,
                            category: v.categoryId,
                            reachPercentage: 0,
                            tags: [],
                            channelId: result.channel.id,
                            publishedAt: v.publishedAt,
                            channelThumbnail: result.channel.thumbnail,
                          };
                          onSelectVideo(videoData);
                        }
                      }}
                      className="w-full flex items-center gap-3 p-2 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group text-left cursor-pointer"
                    >
                      <span className="text-xs font-black text-slate-300 w-5 text-center shrink-0">{i + 1}</span>
                      <div className="relative shrink-0 w-24 h-[54px] rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-800">
                        {v.thumbnail ? (
                          <img src={v.thumbnail} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-700">
                            <span className="material-symbols-outlined">movie</span>
                          </div>
                        )}
                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100">
                          <span className="material-symbols-outlined text-white text-lg">play_circle</span>
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate group-hover:text-emerald-500 transition-colors">{v.title}</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">
                          {formatCount(v.views)}회 • {new Date(v.publishedAt).toLocaleDateString('ko-KR')}
                        </p>
                      </div>
                      <div className={`shrink-0 px-2 py-1 rounded-lg text-[10px] font-black ${
                        v.views > result.avgViewsPerVideo * 2 ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600' :
                        v.views > result.avgViewsPerVideo ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600' :
                        'bg-slate-100 dark:bg-slate-800 text-slate-500'
                      }`}>
                        {(v.views / Math.max(result.avgViewsPerVideo, 1)).toFixed(1)}x
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Disclaimer */}
            <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-100 dark:border-slate-800 rounded-xl p-4 flex gap-3">
              <span className="material-symbols-outlined text-slate-400 text-lg shrink-0 mt-0.5">info</span>
              <div className="text-[10px] text-slate-400 font-medium leading-relaxed">
                <p className="font-bold text-slate-500 mb-1">수익 추정 안내</p>
                이 데이터는 공개된 채널 통계와 카테고리별 평균 CPM을 기반으로 한 <b>추정치</b>입니다.
                실제 수익은 광고 유형, 시청자 지역, 시청 지속 시간, 광고 차단기 사용률, 협찬/멤버십 등에 따라 크게 달라질 수 있습니다.
              </div>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!result && !loading && !error && (
          <div className="py-20 flex flex-col items-center justify-center text-center space-y-4 border-2 border-dashed border-slate-100 dark:border-slate-800 rounded-[2.5rem]">
            <div className="size-20 rounded-3xl bg-slate-50 dark:bg-slate-900 flex items-center justify-center text-slate-200 dark:text-slate-800">
              <span className="material-symbols-outlined text-5xl">monetization_on</span>
            </div>
            <div className="space-y-1">
              <p className="text-slate-600 dark:text-slate-300 font-black">분석할 채널을 입력해주세요</p>
              <p className="text-slate-400 text-xs font-medium">채널 URL, 핸들(@), 또는 ID를 입력하면 수익을 분석합니다.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

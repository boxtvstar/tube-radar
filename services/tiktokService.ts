
import { VideoData, SavedChannel } from "../types";
import { safeSetLocalStorage } from "./youtubeService";

const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6시간 캐시
const MATURITY_HOURS = 168; // 틱톡 영상 성숙 기간 (7일)

// ---------------------------------------------------------------------------
// API 호출
// ---------------------------------------------------------------------------

interface TikTokVideo {
  id: string;
  desc: string;
  createTime: number;
  playCount: number;
  diggCount: number;
  commentCount: number;
  shareCount: number;
  duration: number;
  cover: string;
  videoUrl: string;
}

interface TikTokProfile {
  id: string;
  uniqueId: string;
  nickname: string;
  avatar: string;
  signature: string;
  followerCount: number;
  followingCount: number;
  heartCount: number;
  videoCount: number;
}

interface TikTokScrapeResult {
  profile: TikTokProfile;
  videos: TikTokVideo[];
  scrapedAt: number;
  error?: string;
}

const fetchTikTokProfile = async (username: string): Promise<TikTokScrapeResult> => {
  const cleanName = username.replace(/^@/, '').trim();
  const res = await fetch(`/api/tiktok/profile?username=${encodeURIComponent(cleanName)}`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || errData.detail || `TikTok 스크래핑 실패 (${res.status})`);
  }
  return res.json();
};

// ---------------------------------------------------------------------------
// 채널 추가 — 프로필 + 평균 조회수 계산
// ---------------------------------------------------------------------------

/** URL 또는 @username에서 username 추출 */
const extractTikTokUsername = (input: string): string => {
  const trimmed = input.trim();
  // https://www.tiktok.com/@username 형식
  const urlMatch = trimmed.match(/tiktok\.com\/@([^/?#\s]+)/i);
  if (urlMatch) return urlMatch[1];
  // @username 형식
  return trimmed.replace(/^@/, '');
};

export const getTikTokChannelInfo = async (username: string): Promise<SavedChannel | null> => {
  try {
    username = extractTikTokUsername(username);
    if (!username) return null;

    try {
      const data = await fetchTikTokProfile(username);
      if (data.error) throw new Error(data.error);

      const { profile, videos } = data;

      // 최근 20개 영상 조회수 중앙값 계산
      let customAvg = 0;
      if (videos.length > 0) {
        const views = videos
          .slice(0, 20)
          .map(v => v.playCount)
          .filter(v => v > 0)
          .sort((a, b) => a - b);

        if (views.length > 0) {
          const mid = Math.floor(views.length / 2);
          customAvg = views.length % 2 !== 0
            ? views[mid]
            : Math.floor((views[mid - 1] + views[mid]) / 2);
        }
        if (customAvg < 100) customAvg = 100;
      }

      return {
        id: `tt_${profile.uniqueId || username}`,
        title: profile.nickname || profile.uniqueId,
        description: profile.signature,
        thumbnail: profile.avatar,
        customUrl: `@${profile.uniqueId}`,
        subscriberCount: formatNumber(profile.followerCount),
        videoCount: formatNumber(profile.videoCount),
        customAvgViews: customAvg,
        totalViews: formatNumber(profile.heartCount),
        lastUpdated: Date.now(),
        platform: 'tiktok',
      };
    } catch {
      // 스크래핑 실패 시 oEmbed 폴백 — 닉네임 + unavatar 프로필 이미지
      console.warn(`TikTok scraping failed for ${username}, trying oEmbed fallback`);
      let title = `@${username}`;
      try {
        const oembed = await fetch(`https://www.tiktok.com/oembed?url=https://www.tiktok.com/@${username}`);
        if (oembed.ok) {
          const data = await oembed.json();
          if (data.author_name) title = data.author_name;
        }
      } catch { /* ignore */ }
      return {
        id: `tt_${username}`,
        title,
        thumbnail: `https://unavatar.io/tiktok/${username}?fallback=https://ui-avatars.com/api/?name=${encodeURIComponent(username)}%26background=000%26color=fff%26bold=true%26size=128`,
        customUrl: `@${username}`,
        lastUpdated: Date.now(),
        platform: 'tiktok',
      };
    }
  } catch (e: any) {
    console.error('getTikTokChannelInfo failed:', e);
    return null;
  }
};

// ---------------------------------------------------------------------------
// 영상 목록 조회 — 캐시 포함
// ---------------------------------------------------------------------------

export const fetchTikTokVideos = async (
  channelIds: string[],
  savedChannels: SavedChannel[],
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<VideoData[]> => {
  if (channelIds.length === 0) return [];

  const channelMap = new Map(savedChannels.filter(c => c.platform === 'tiktok').map(c => [c.id, c]));
  const allVideos: VideoData[] = [];

  for (let i = 0; i < channelIds.length; i++) {
    const cid = channelIds[i];
    const channel = channelMap.get(cid);
    if (!channel) continue;

    const username = (channel.customUrl || channel.id).replace(/^(tt_|@)/, '');
    if (onProgress) {
      onProgress(i + 1, channelIds.length, channel.title);
    }

    // 캐시 확인
    const cacheKey = `tk_v1_cache_${cid}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Date.now() - (parsed.timestamp || 0) < CACHE_DURATION && parsed.videos?.length > 0) {
          allVideos.push(...parsed.videos);
          continue;
        }
      }
    } catch { /* 캐시 오류 무시 */ }

    // API 호출
    try {
      const data = await fetchTikTokProfile(username);
      if (data.error || !data.videos?.length) continue;

      const avgViews = channel.customAvgViews || 100;
      const videos = data.videos.map(v => transformTikTokVideo(v, channel, avgViews));

      // 캐시 저장
      safeSetLocalStorage(cacheKey, JSON.stringify({ timestamp: Date.now(), videos }));
      allVideos.push(...videos);
    } catch (e) {
      console.warn(`TikTok fetch failed for @${username}:`, e);
    }
  }

  // viralScore 내림차순 정렬
  return allVideos.sort((a, b) => parseFloat(b.viralScore) - parseFloat(a.viralScore));
};

// ---------------------------------------------------------------------------
// 데이터 변환
// ---------------------------------------------------------------------------

const transformTikTokVideo = (
  v: TikTokVideo,
  channel: SavedChannel,
  avgViews: number,
): VideoData => {
  const uploadDate = new Date(v.createTime * 1000);
  const hoursAge = Math.max(1, (Date.now() - uploadDate.getTime()) / (1000 * 60 * 60));

  // viralScore = (실제 조회수 / 기대 조회수) × 시간 보정
  const timeFactor = Math.min(hoursAge / MATURITY_HOURS, 1);
  const expectedViews = avgViews * timeFactor;
  const viralScore = expectedViews > 0 ? (v.playCount / expectedViews) : 0;

  // reachPercentage (조회수 / 팔로워)
  const followers = parseInt(channel.subscriberCount?.replace(/[^0-9]/g, '') || '0') || 1;
  const reachPct = Math.min((v.playCount / followers) * 100, 999);

  return {
    id: v.id,
    title: v.desc || '(캡션 없음)',
    channelName: channel.title,
    thumbnailUrl: v.cover,
    duration: formatDuration(v.duration),
    views: formatNumber(v.playCount),
    avgViews: formatNumber(avgViews),
    subscribers: channel.subscriberCount || '0',
    viralScore: viralScore.toFixed(1),
    uploadTime: formatUploadTime(uploadDate),
    category: 'TikTok',
    reachPercentage: Math.round(reachPct * 10) / 10,
    tags: [],
    publishedAt: uploadDate.toISOString(),
    channelId: channel.id,
    durationSec: v.duration,
    channelThumbnail: channel.thumbnail,
    commentCount: v.commentCount,
    platform: 'tiktok',
    likes: v.diggCount,
    shares: v.shareCount,
  };
};

// ---------------------------------------------------------------------------
// 유틸리티
// ---------------------------------------------------------------------------

const formatNumber = (num: number): string => {
  if (num >= 100_000_000) return `${(num / 100_000_000).toFixed(1)}억`;
  if (num >= 10_000) return `${(num / 10_000).toFixed(1)}만`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}천`;
  return num.toString();
};

const formatDuration = (seconds: number): string => {
  if (!seconds || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
};

const formatUploadTime = (date: Date): string => {
  const diffMs = Date.now() - date.getTime();
  const diffH = diffMs / (1000 * 60 * 60);

  if (diffH < 1) return `${Math.floor(diffMs / 60000)}분 전`;
  if (diffH < 24) return `${Math.floor(diffH)}시간 전`;
  if (diffH < 720) return `${Math.floor(diffH / 24)}일 전`;
  return `${Math.floor(diffH / 720)}개월 전`;
};

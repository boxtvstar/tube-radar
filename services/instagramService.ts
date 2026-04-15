
import { VideoData, SavedChannel } from "../types";
import { safeSetLocalStorage } from "./youtubeService";

const CACHE_DURATION = 6 * 60 * 60 * 1000; // 6시간 캐시
const MATURITY_HOURS = 168; // 인스타 릴스 성숙 기간 (7일)

// ---------------------------------------------------------------------------
// API 호출
// ---------------------------------------------------------------------------

interface InstagramVideo {
  id: string;
  shortcode: string;
  caption: string;
  takenAt: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  thumbnailUrl: string;
  videoUrl: string;
}

interface InstagramProfile {
  id: string;
  username: string;
  fullName: string;
  biography: string;
  profilePicUrl: string;
  followerCount: number;
  followingCount: number;
  mediaCount: number;
  isPrivate: boolean;
  isVerified: boolean;
}

interface InstagramScrapeResult {
  profile: InstagramProfile;
  videos: InstagramVideo[];
  scrapedAt: number;
  error?: string;
}

const fetchInstagramProfile = async (username: string): Promise<InstagramScrapeResult> => {
  const cleanName = username.replace(/^@/, '').trim();
  const res = await fetch(`/api/instagram/profile?username=${encodeURIComponent(cleanName)}`);
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || errData.detail || `Instagram 스크래핑 실패 (${res.status})`);
  }
  return res.json();
};

// ---------------------------------------------------------------------------
// 채널 추가 — 프로필 + 평균 조회수 계산
// ---------------------------------------------------------------------------

/** URL 또는 @username에서 username 추출 */
const extractInstagramUsername = (input: string): string => {
  const trimmed = input.trim();
  // https://www.instagram.com/username/ 형식
  const urlMatch = trimmed.match(/instagram\.com\/([^/?#\s]+)/i);
  if (urlMatch) {
    const name = urlMatch[1];
    // reel/, p/, stories/ 등 경로 제외
    if (['reel', 'reels', 'p', 'stories', 'explore', 'accounts', 'direct'].includes(name)) {
      return '';
    }
    return name;
  }
  // @username 형식
  return trimmed.replace(/^@/, '');
};

export const getInstagramChannelInfo = async (username: string): Promise<SavedChannel | null> => {
  try {
    username = extractInstagramUsername(username);
    if (!username) return null;

    const data = await fetchInstagramProfile(username);
    if (data.error) throw new Error(data.error);

    const { profile, videos } = data;

    // 릴스 조회수 중앙값 계산
    let customAvg = 0;
    if (videos.length > 0) {
      const views = videos
        .map(v => v.viewCount)
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
      id: profile.id,
      title: profile.fullName || profile.username,
      description: profile.biography,
      thumbnail: profile.profilePicUrl,
      customUrl: `@${profile.username}`,
      subscriberCount: formatNumber(profile.followerCount),
      videoCount: formatNumber(profile.mediaCount),
      customAvgViews: customAvg,
      totalViews: '',
      lastUpdated: Date.now(),
      platform: 'instagram',
    };
  } catch (e: any) {
    console.error('getInstagramChannelInfo failed:', e);
    return null;
  }
};

// ---------------------------------------------------------------------------
// 영상 목록 조회 — 캐시 포함
// ---------------------------------------------------------------------------

export const fetchInstagramVideos = async (
  channelIds: string[],
  savedChannels: SavedChannel[],
  onProgress?: (current: number, total: number, message: string) => void,
): Promise<VideoData[]> => {
  if (channelIds.length === 0) return [];

  const channelMap = new Map(savedChannels.filter(c => c.platform === 'instagram').map(c => [c.id, c]));
  const allVideos: VideoData[] = [];

  for (let i = 0; i < channelIds.length; i++) {
    const cid = channelIds[i];
    const channel = channelMap.get(cid);
    if (!channel) continue;

    const username = (channel.customUrl || channel.id).replace(/^(ig_|@)/, '');
    if (onProgress) {
      onProgress(i + 1, channelIds.length, channel.title);
    }

    // 캐시 확인
    const cacheKey = `ig_v2_cache_${cid}`;
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
      const data = await fetchInstagramProfile(username);
      if (data.error || !data.videos?.length) continue;

      const avgViews = channel.customAvgViews || 100;
      const videos = data.videos.map(v => transformInstagramVideo(v, channel, avgViews));

      // 캐시 저장
      safeSetLocalStorage(cacheKey, JSON.stringify({ timestamp: Date.now(), videos }));
      allVideos.push(...videos);
    } catch (e) {
      console.warn(`Instagram fetch failed for @${username}:`, e);
    }
  }

  // viralScore 내림차순 정렬
  return allVideos.sort((a, b) => parseFloat(b.viralScore) - parseFloat(a.viralScore));
};

// ---------------------------------------------------------------------------
// 데이터 변환
// ---------------------------------------------------------------------------

const transformInstagramVideo = (
  v: InstagramVideo,
  channel: SavedChannel,
  avgViews: number,
): VideoData => {
  const uploadDate = new Date(v.takenAt * 1000);
  const hoursAge = Math.max(1, (Date.now() - uploadDate.getTime()) / (1000 * 60 * 60));

  // viralScore = (실제 조회수 / 기대 조회수) × 시간 보정
  const timeFactor = Math.min(hoursAge / MATURITY_HOURS, 1);
  const expectedViews = avgViews * timeFactor;
  const viralScore = expectedViews > 0 ? (v.viewCount / expectedViews) : 0;

  // reachPercentage (조회수 / 팔로워)
  const followers = parseInt(channel.subscriberCount?.replace(/[^0-9]/g, '') || '0') || 1;
  const reachPct = Math.min((v.viewCount / followers) * 100, 999);

  return {
    id: v.shortcode || v.id,
    title: v.caption || '(캡션 없음)',
    channelName: channel.title,
    thumbnailUrl: v.thumbnailUrl,
    duration: '',
    views: formatNumber(v.viewCount),
    avgViews: formatNumber(avgViews),
    subscribers: channel.subscriberCount || '0',
    viralScore: viralScore.toFixed(1),
    uploadTime: formatUploadTime(uploadDate),
    category: 'Instagram',
    reachPercentage: Math.round(reachPct * 10) / 10,
    tags: [],
    publishedAt: uploadDate.toISOString(),
    channelId: channel.id,
    durationSec: 0,
    channelThumbnail: channel.thumbnail,
    commentCount: v.commentCount,
    platform: 'instagram',
    likes: v.likeCount,
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

const formatUploadTime = (date: Date): string => {
  const diffMs = Date.now() - date.getTime();
  const diffH = diffMs / (1000 * 60 * 60);

  if (diffH < 1) return `${Math.floor(diffMs / 60000)}분 전`;
  if (diffH < 24) return `${Math.floor(diffH)}시간 전`;
  if (diffH < 720) return `${Math.floor(diffH / 24)}일 전`;
  return `${Math.floor(diffH / 720)}개월 전`;
};

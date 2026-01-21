
import { VideoData, SavedChannel } from "../types";
import { trackUsage } from "./usageService";

const YOUTUBE_BASE_URL = "https://www.googleapis.com/youtube/v3";
const CACHE_DURATION = 4 * 60 * 60 * 1000; // 4시간 캐시
const MAX_RESULTS_PER_UNIT = 50; 
const MATURITY_HOURS = 720; // 영상이 평균 성과에 도달하는 성숙 기간 (30일)

const extractIdentifier = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  if (trimmed.includes('watch?v=') || trimmed.includes('youtu.be/')) {
    let videoId = '';
    if (trimmed.includes('watch?v=')) {
      videoId = trimmed.split('v=')[1]?.split('&')[0];
    } else {
      videoId = trimmed.split('youtu.be/')[1]?.split('?')[0];
    }
    if (videoId) return { type: 'video', value: videoId };
  }
  
  if (trimmed.includes('youtube.com/')) {
    try {
      const urlString = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
      const url = new URL(urlString);
      const path = url.pathname;
      if (path.includes('/@')) return { type: 'handle', value: '@' + path.split('/@')[1].split('/')[0] };
      if (path.includes('/channel/')) {
        const id = path.split('/channel/')[1].split('/')[0];
        if (id.startsWith('UC')) return { type: 'id', value: id };
      }
      const segments = path.split('/').filter(Boolean);
      if (segments.length > 0) {
        const lastSegment = segments[segments.length - 1];
        if (lastSegment.startsWith('UC')) return { type: 'id', value: lastSegment };
      }
    } catch (e) {
      console.warn("URL parsing failed");
    }
  }

  if (trimmed.startsWith('UC') && trimmed.length > 20) return { type: 'id', value: trimmed };
  if (trimmed.startsWith('@')) return { type: 'handle', value: trimmed };
  return null;
};

export const getChannelInfo = async (apiKey: string, query: string): Promise<SavedChannel | null> => {
  const identifier = extractIdentifier(query);
  if (!identifier) return null;
  
  try {
    let channelIdToLookup = '';
    if (identifier.type === 'video') {
      const vRes = await fetch(`${YOUTUBE_BASE_URL}/videos?part=snippet&id=${identifier.value}&key=${apiKey}`);
      trackUsage('list', 1);
      const vData = await vRes.json();
      if (vData.items?.length > 0) channelIdToLookup = vData.items[0].snippet.channelId;
      else return null;
    }

    let url = "";
    if (channelIdToLookup || identifier.type === 'id') {
      const id = channelIdToLookup || identifier.value;
      url = `${YOUTUBE_BASE_URL}/channels?part=snippet&id=${id}&key=${apiKey}`;
    } else if (identifier.type === 'handle') {
      url = `${YOUTUBE_BASE_URL}/channels?part=snippet&forHandle=${encodeURIComponent(identifier.value)}&key=${apiKey}`;
    } else return null;

    const res = await fetch(url);
    trackUsage('list', 1);
    const data = await res.json();
    
    if (data.error) {
      if (data.error.code === 403 && data.error.errors?.[0]?.reason === 'quotaExceeded') {
        throw new Error("QUOTA_EXCEEDED");
      }
      return null;
    }
    if (!data.items?.length) return null;
    const channel = data.items[0];
    return {
      id: channel.id,
      title: channel.snippet.title,
      thumbnail: channel.snippet.thumbnails.default.url
    };
  } catch (e) {
    return null;
  }
};

export const searchChannelsByKeyword = async (apiKey: string, query: string): Promise<SavedChannel[]> => {
  if (!query.trim()) return [];
  try {
    const res = await fetch(`${YOUTUBE_BASE_URL}/search?part=snippet&type=channel&maxResults=${MAX_RESULTS_PER_UNIT}&q=${encodeURIComponent(query)}&key=${apiKey}`);
    trackUsage('search');
    const data = await res.json();
    if (data.error || !data.items) return [];
    
    return data.items.map((item: any) => ({
      id: item.snippet.channelId,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails.default.url
    }));
  } catch (e) {
    console.error("Channel search failed", e);
    return [];
  }
};

export const fetchRealVideos = async (
  apiKey: string, 
  query: string = "", 
  regionCode: string = "KR",
  daysBack: number = 7,
  channelIds: string[] = [],
  categoryId: string = "",
  forceRefresh: boolean = false
): Promise<VideoData[]> => {
  const isMyChannelsMode = channelIds.length > 0;
  const channelHash = isMyChannelsMode ? channelIds.length : 'all';
  const cacheKey = `yt_v6_cache_${regionCode}_${query || categoryId || 'trending'}_${daysBack}_${channelHash}`;
  const cached = localStorage.getItem(cacheKey);
  
  if (!forceRefresh && cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_DURATION) return data;
  }

  try {
    let videoItems = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    if (isMyChannelsMode) {
      const allVideoPromises = channelIds.map(async (cid) => {
        try {
          const uploadsPlaylistId = cid.replace(/^UC/, 'UU');
          const res = await fetch(`${YOUTUBE_BASE_URL}/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=10&key=${apiKey}`);
          trackUsage('list', 1);
          const data = await res.json();
          if (data.error) {
            console.warn(`Channel skipped (${cid}): ${data.error.message}`);
            return [];
          }
          return data.items || [];
        } catch (e) {
          console.warn(`Channel fetch skipped (${cid})`);
          return [];
        }
      });
      const playlistResults = await Promise.all(allVideoPromises);
      const videoIds = playlistResults.flat()
        .filter((item: any) => new Date(item.snippet.publishedAt) >= cutoffDate)
        .map((item: any) => item.snippet.resourceId.videoId);
      if (videoIds.length === 0) return [];
      const detailRes = await fetch(`${YOUTUBE_BASE_URL}/videos?part=snippet,statistics,contentDetails&id=${videoIds.slice(0, MAX_RESULTS_PER_UNIT).join(',')}&key=${apiKey}`);
      trackUsage('list', 1);
      const detailData = await detailRes.json();
      videoItems = detailData.items || [];
    } else {
      let url = `${YOUTUBE_BASE_URL}/videos?part=snippet,statistics,contentDetails&chart=mostPopular&maxResults=${MAX_RESULTS_PER_UNIT}&key=${apiKey}&regionCode=${regionCode}`;
      if (categoryId) url += `&videoCategoryId=${categoryId}`;
      const res = await fetch(url);
      trackUsage('list', 1);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      videoItems = data.items || [];
    }

    if (videoItems.length === 0) return [];

    const uniqueChannelIds = Array.from(new Set(videoItems.map((v: any) => v.snippet.channelId))).join(',');
    const channelsRes = await fetch(`${YOUTUBE_BASE_URL}/channels?part=statistics&id=${uniqueChannelIds}&key=${apiKey}`);
    trackUsage('list', 1);
    const channelsData = await channelsRes.json();
    const channelMap = new Map();
    channelsData.items?.forEach((c: any) => {
      const avg = Math.floor(parseInt(c.statistics.viewCount || "0") / Math.max(parseInt(c.statistics.videoCount || "1"), 1));
      channelMap.set(c.id, { avgViews: avg, subscribers: formatNumber(parseInt(c.statistics.subscriberCount || "0")) });
    });

    const videos: VideoData[] = videoItems.map((item: any) => {
      const channelInfo = channelMap.get(item.snippet.channelId) || { avgViews: 1, subscribers: "0" };
      const currentViews = parseInt(item.statistics.viewCount || "0");
      const hoursSinceUpload = Math.max((Date.now() - new Date(item.snippet.publishedAt).getTime()) / (1000 * 60 * 60), 2);
      const timeFactor = Math.min(hoursSinceUpload / MATURITY_HOURS, 1);
      const velocity = currentViews / Math.max(channelInfo.avgViews * timeFactor, 1);

      return {
        id: item.id,
        title: item.snippet.title,
        channelName: item.snippet.channelTitle,
        thumbnailUrl: item.snippet.thumbnails.high.url,
        duration: parseISO8601Duration(item.contentDetails.duration),
        views: formatNumber(currentViews),
        avgViews: formatNumber(channelInfo.avgViews),
        subscribers: channelInfo.subscribers,
        viralScore: `${velocity.toFixed(1)}x`,
        uploadTime: getTimeAgo(item.snippet.publishedAt),
        category: "트렌드",
        reachPercentage: Math.min(Math.floor(velocity * 20), 100),
        tags: item.snippet.tags?.slice(0, 3).map((t: string) => `#${t}`) || []
      };
    });

    videos.sort((a, b) => parseFloat(b.viralScore) - parseFloat(a.viralScore));
    localStorage.setItem(cacheKey, JSON.stringify({ data: videos, timestamp: Date.now() }));
    return videos;
  } catch (error: any) {
    throw error;
  }
};

function parseISO8601Duration(duration: string) {
  const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
  const hours = (match?.[1] || "").replace('H', '');
  const mins = (match?.[2] || "").replace('M', '');
  const secs = (match?.[3] || "").replace('S', '');
  return `${hours ? hours + ':' : ''}${mins.padStart(2, '0') || '00'}:${secs.padStart(2, '0') || '00'}`;
}

function formatNumber(num: number) {
  if (num >= 100000000) return (num / 100000000).toFixed(1) + "억";
  if (num >= 10000) return (num / 10000).toFixed(1) + "만";
  return num.toLocaleString();
}

function getTimeAgo(date: string) {
  const seconds = Math.floor((new Date().getTime() - new Date(date).getTime()) / 1000);
  let interval = seconds / 31536000;
  if (interval > 1) return Math.floor(interval) + "년 전";
  interval = seconds / 2592000;
  if (interval > 1) return Math.floor(interval) + "달 전";
  interval = seconds / 86400;
  if (interval > 1) return Math.floor(interval) + "일 전";
  interval = seconds / 3600;
  if (interval > 1) return Math.floor(interval) + "시간 전";
  return "방금 전";
}

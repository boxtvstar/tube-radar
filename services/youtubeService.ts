
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

// --- Shorts Auto Detector ---

export interface AutoDetectResult extends SavedChannel {
  viralScore: number;
  stats: {
    viewCount: number;
    subscribers: number;
    videoCount: number;
    publishedAt: string;
  };
  representativeVideo: {
    id: string;
    title: string;
    views: number;
    thumbnail: string;
    publishedAt?: string;
  };
}

export const autoDetectShortsChannels = async (apiKey: string, regionCode: string = "KR"): Promise<AutoDetectResult[]> => {
  try {
    // 1. "Random Shorts Surfing" Mode
    // Mimic the Shorts Feed but restrict to last 7 days to avoid ancient videos.
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7); // Last 7 days (Weekly Trends)
    const publishedAfter = oneWeekAgo.toISOString();
    
    // Strategy: Broad query + Relevance sort + Date window
    // 1. Base URL
    let searchUrl = `${YOUTUBE_BASE_URL}/search?part=snippet&type=video&videoDuration=short&maxResults=50&publishedAfter=${publishedAfter}&q=%23shorts&key=${apiKey}`;
    
    // 2. Region & Language Logic
    // IF regionCode is provided (KR, US), apply strict targeting.
    // IF regionCode is 'GLOBAL' or empty, we force 'US' as base to avoid IP-based local bias (Korea),
    // but we DO NOT restrict language, allowing global viral content.
    
    if (regionCode && regionCode !== 'GLOBAL') {
      searchUrl += `&regionCode=${regionCode}`;
      
      // Strict Language Filtering
      if (regionCode === 'KR') {
        searchUrl += `&relevanceLanguage=ko`;
      } else if (regionCode === 'US') {
        searchUrl += `&relevanceLanguage=en`;
      }
    } 
    // GLOBAL (else): Do NOT add regionCode or relevanceLanguage. 
    // Let YouTube decide based on query and general popularity.
    
    const searchRes = await fetch(searchUrl);
    trackUsage('search', 1); 
    const searchData = await searchRes.json();
    
    if (searchData.error) {
      if (searchData.error.code === 403 && searchData.error.errors?.[0]?.reason === 'quotaExceeded') {
        throw new Error("QUOTA_EXCEEDED");
      }
      throw new Error(searchData.error.message);
    }

    if (!searchData.items || searchData.items.length === 0) return [];

    // 2. Extract Channel IDs & Video IDs
    const videoItems = searchData.items;
    const channelIds = Array.from(new Set(videoItems.map((item: any) => item.snippet.channelId))) as string[];
    
    // 3. Fetch Channel Details (Batch)
    const channelsUrl = `${YOUTUBE_BASE_URL}/channels?part=snippet,statistics&id=${channelIds.join(',')}&key=${apiKey}`;
    const channelsRes = await fetch(channelsUrl);
    trackUsage('list', 1);
    const channelsData = await channelsRes.json();

    if (!channelsData.items) return [];

    const candidates: AutoDetectResult[] = [];

    // Filter out noisy countries (India, Brazil, Russia, Vietnam, etc.)
    const BLACKLIST_COUNTRIES = ['IN', 'BR', 'RU', 'VN', 'ID', 'TH', 'PH', 'PK'];

    channelsData.items.forEach((ch: any) => {
      // 1. Country Filter
      const country = ch.snippet.country;
      if (country && BLACKLIST_COUNTRIES.includes(country)) {
          return; // Skip this channel
      }
      const videoCount = parseInt(ch.statistics.videoCount || "0");
      const subscriberCount = parseInt(ch.statistics.subscriberCount || "0");
      const publishedAt = ch.snippet.publishedAt;
      
      // No Filtering: Accept ALL channels found in the search
      const bestVideo = videoItems.find((v: any) => v.snippet.channelId === ch.id);
      
      if (bestVideo) {
         candidates.push({
           id: ch.id,
           title: ch.snippet.title,
           thumbnail: ch.snippet.thumbnails.default.url,
           groupId: 'unassigned', // placeholder
           viralScore: 0, // calc later
           stats: {
             viewCount: 0, // fill later
             subscribers: subscriberCount,
             videoCount: videoCount,
             publishedAt: publishedAt
           },
           representativeVideo: {
             id: bestVideo.id.videoId,
             title: bestVideo.snippet.title,
             views: 0, // fill later
             thumbnail: bestVideo.snippet.thumbnails.maxres?.url || 
                          bestVideo.snippet.thumbnails.standard?.url || 
                          bestVideo.snippet.thumbnails.high?.url || 
                          bestVideo.snippet.thumbnails.medium?.url || 
                          bestVideo.snippet.thumbnails.default?.url,
             publishedAt: bestVideo.snippet.publishedAt
           }
         });
      }
    });

    // 4. Fetch Exact View Counts (Fixing 0 views issue)
    // We strictly need this to show accurate views.
    if (candidates.length > 0) {
      const candidateVideoIds = candidates.map(c => c.representativeVideo.id);
      // Batch request for video stats
      const vStatsUrl = `${YOUTUBE_BASE_URL}/videos?part=statistics&id=${candidateVideoIds.join(',')}&key=${apiKey}`;
      const vStatsRes = await fetch(vStatsUrl);
      trackUsage('list', 1); 
      const vStatsData = await vStatsRes.json();
      
      if (vStatsData.items) {
        vStatsData.items.forEach((v: any) => {
          const cand = candidates.find(c => c.representativeVideo.id === v.id);
          if (cand) {
             const views = parseInt(v.statistics.viewCount || "0");
             cand.representativeVideo.views = views;
             cand.stats.viewCount = views;
          }
        });
      }
    }

    if (candidates.length === 0) return [];
    // Sort by "Newest First" to show fresh trends on top
    // Since API returns mixed dates (relevance), we sort them manually here.
    candidates.sort((a, b) => {
       const dateA = new Date(a.representativeVideo.publishedAt || 0).getTime();
       const dateB = new Date(b.representativeVideo.publishedAt || 0).getTime();
       return dateB - dateA; // Descending (Newest first)
    });

    return candidates;

  } catch (e: any) {
    console.error("Auto Detect Failed", e);
    throw e;
  }
};


import { VideoData, SavedChannel } from "../types";
import { trackUsage, checkQuotaAvailable, getRemainingQuota, markQuotaExceeded } from "./usageService";

const YOUTUBE_BASE_URL = "https://www.googleapis.com/youtube/v3";
const CACHE_DURATION = 4 * 60 * 60 * 1000; // 4시간 캐시
const MAX_RESULTS_PER_UNIT = 50;
const MATURITY_HOURS = 720; // 영상이 평균 성과에 도달하는 성숙 기간 (30일)

// Category ID to Name mapping
const CATEGORY_NAMES: Record<string, string> = {
  '1': '영화/애니', '2': '자동차', '10': '음악', '15': '동물', '17': '스포츠',
  '18': '단편영화', '19': '여행', '20': '게임', '22': '브이로그/인물', '23': '코미디',
  '24': '엔터테인먼트', '25': '뉴스/정치', '26': '노하우/스타일', '27': '교육',
  '28': '과학/기술', '29': '비영리/사회'
};

const extractIdentifier = (input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Check for Shorts URL first (youtube.com/shorts/VIDEO_ID)
  if (trimmed.includes('/shorts/')) {
    try {
      const urlString = trimmed.startsWith('http') ? trimmed : `https://${trimmed}`;
      const url = new URL(urlString);
      const path = url.pathname;
      if (path.includes('/shorts/')) {
        const videoId = path.split('/shorts/')[1]?.split('/')[0]?.split('?')[0];
        if (videoId) return { type: 'video', value: videoId };
      }
    } catch (e) {
      console.warn("Shorts URL parsing failed");
    }
  }

  // Check for regular video URLs (watch?v= or youtu.be/)
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
      trackUsage(apiKey, 'list', 1);
      const vData = await vRes.json();
      if (vData.items?.length > 0) channelIdToLookup = vData.items[0].snippet.channelId;
      else return null;
    }

    let url = "";
    if (channelIdToLookup || identifier.type === 'id') {
      const id = channelIdToLookup || identifier.value;
      url = `${YOUTUBE_BASE_URL}/channels?part=snippet,statistics&id=${id}&key=${apiKey}`;
    } else if (identifier.type === 'handle') {
      url = `${YOUTUBE_BASE_URL}/channels?part=snippet,statistics&forHandle=${encodeURIComponent(identifier.value)}&key=${apiKey}`;
    } else return null;

    const res = await fetch(url);
    trackUsage(apiKey, 'list', 1);
    const data = await res.json();
    
    if (data.error) {
      const reason = data.error.errors?.[0]?.reason;
      // Rate Limit은 무시 (자동으로 해결됨)
      if (data.error.code === 403) {
        if (reason === 'quotaExceeded') {
          markQuotaExceeded(apiKey);
          throw new Error("QUOTA_EXCEEDED");
        } else if (reason === 'rateLimitExceeded' || reason === 'userRateLimitExceeded') {
          console.warn('⚠️ Rate Limit - 잠시 대기 중...');
          await new Promise(r => setTimeout(r, 2000)); // 2초 대기 후 무시
          return null;
        }
      }
      return null;
    }
    if (!data.items?.length) return null;
    const channel = data.items[0];

    // Calculate Custom Average (Recent 20 Videos)
    let customAvg = 0;
    try {
      const uploadsId = channel.id.replace(/^UC/, 'UU');
         const plRes = await fetch(`${YOUTUBE_BASE_URL}/playlistItems?part=snippet,contentDetails&playlistId=${uploadsId}&maxResults=20&key=${apiKey}`);
         trackUsage(apiKey, 'list', 1);
         const plData = await plRes.json();
         
         let videoIds: string[] = [];

         if (plData.items && plData.items.length > 0) {
             videoIds = plData.items.map((i:any) => i.snippet.resourceId.videoId);
         } else {
             // Fallback: Use Search API if playlist fails (e.g. channel settings)
             try {
                 const sRes = await fetch(`${YOUTUBE_BASE_URL}/search?part=id&channelId=${channel.id}&order=date&type=video&maxResults=20&key=${apiKey}`);
                 trackUsage(apiKey, 'search', 1);
                 const sData = await sRes.json();
                 if (sData.items) videoIds = sData.items.map((i:any) => i.id.videoId);
             } catch(e) {
                 console.warn("Fallback search failed for channel info", e);
             }
         }
         
         if (videoIds.length > 0) {
             const vRes = await fetch(`${YOUTUBE_BASE_URL}/videos?part=statistics&id=${videoIds.join(',')}&key=${apiKey}`);
             trackUsage(apiKey, 'list', 1);
             const vData = await vRes.json();
             
             if (vData.items && vData.items.length > 0) {
                // Calculate Median View Count
                const views = vData.items.map((v: any) => parseInt(v.statistics.viewCount || "0")).sort((a: number, b: number) => a - b);
                const mid = Math.floor(views.length / 2);
                customAvg = views.length % 2 !== 0 ? views[mid] : Math.floor((views[mid - 1] + views[mid]) / 2);
             }
         }
    } catch (err) {
      console.warn("Failed to calc avg views for new channel", err);
    }

    return {
      id: channel.id,
      title: channel.snippet.title,
      thumbnail: channel.snippet.thumbnails.default.url,
      subscriberCount: formatNumber(parseInt(channel.statistics.subscriberCount || "0")),
      videoCount: formatNumber(parseInt(channel.statistics.videoCount || "0")),
      customAvgViews: customAvg,
      totalViews: formatNumber(parseInt(channel.statistics.viewCount || "0")),
      joinDate: channel.snippet.publishedAt,
      country: channel.snippet.country,
      lastUpdated: Date.now()
    };
  } catch (e: any) {
    if (e.message === "QUOTA_EXCEEDED" || (e.result && e.result.error && e.result.error.code === 403)) {
       console.warn("Quota exceeded during channel lookup, using fallback.");
       // Fallback: If we have an ID at least, return a minimal object so the UI doesn't crash
       // We try to extract ID from query if possible
       const identifier = extractIdentifier(query);
       if (identifier && identifier.type === 'id') {
           return {
               id: identifier.value,
               title: identifier.value, // Placeholder
               thumbnail: '',
               subscriberCount: '0',
               videoCount: '0',
               customAvgViews: 0,
               totalViews: '0',
               joinDate: new Date().toISOString(),
               country: '',
               lastUpdated: Date.now()
           };
       }
       throw new Error("QUOTA_EXCEEDED");
    }
    return null;
  }
};



export const searchChannelsByKeyword = async (apiKey: string, query: string): Promise<SavedChannel[]> => {
  if (!query.trim()) return [];
  try {
    const res = await fetch(`${YOUTUBE_BASE_URL}/search?part=snippet&type=channel&maxResults=${MAX_RESULTS_PER_UNIT}&q=${encodeURIComponent(query)}&key=${apiKey}`);
    trackUsage(apiKey, 'search');
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
  forceRefresh: boolean = false,
  useSearchApi: boolean = false,
  savedChannels: SavedChannel[] = []
): Promise<VideoData[]> => {
  const isMyChannelsMode = channelIds.length > 0;

  // Create unique hash for channel IDs to differentiate groups with same count
  let channelHash: string;
  if (isMyChannelsMode) {
    // Sort and create hash from channel IDs
    const sortedIds = [...channelIds].sort();
    // Use simple hash: first ID + count + last ID
    channelHash = `${sortedIds[0].slice(-4)}_${sortedIds.length}_${sortedIds[sortedIds.length - 1].slice(-4)}`;
  } else {
    channelHash = 'all';
  }

  // Cache Key: Explicitly separate Query and CategoryID to avoid collisions
  const cacheKey = `yt_v7_cache_${regionCode}_q:${query}_c:${categoryId}_d:${daysBack}_h:${channelHash}_m:${useSearchApi}`;

  const cached = localStorage.getItem(cacheKey);

  if (!forceRefresh && cached) {
    const { data, timestamp } = JSON.parse(cached);
    if (Date.now() - timestamp < CACHE_DURATION) return data;
  }

  // Quota Check: Estimate cost before making API calls
  // MyChannels Mode Cost:
  // - Playlist fetch: 1 per channel (Capped at 50 by safety limit)
  // - Video details: ceil(channels * 50 videos / 50 per request)
  // - Channel info: ceil(channels / 50)
  
  const activeCount = isMyChannelsMode ? Math.min(channelIds.length, 50) : 0;
  
  const estimatedCost = isMyChannelsMode
    ? activeCount + Math.ceil(activeCount * 50 / 50) + Math.ceil(activeCount / 50)
    : useSearchApi ? 102 : 1;

  // ⚠️ 쿼터 사전 체크 비활성화 - 거짓 경고가 너무 많이 발생함
  // 실제 API 에러만 처리하도록 변경
  /*
  if (!checkQuotaAvailable(apiKey, estimatedCost)) {
    // If quota is insufficient, try to use cached data even if forceRefresh is true
    let fallbackCache = cached;
    let fallbackCacheKey = cacheKey;

    if (!fallbackCache && isMyChannelsMode) {
      // Try to find cache for the same channel group (same channelHash)
      // but allow different region/date/query to be more flexible
      const allKeys = Object.keys(localStorage);
      const sameGroupCacheKeys = allKeys.filter(k =>
        k.startsWith('yt_v7_cache_') &&
        k.includes(`_h:${channelHash}_`)
      );

      for (const key of sameGroupCacheKeys) {
        try {
          const cacheData = localStorage.getItem(key);
          if (cacheData) {
            const parsed = JSON.parse(cacheData);
            const cacheAge = Date.now() - parsed.timestamp;
            const isValid = cacheAge < CACHE_DURATION;

            if (isValid && parsed.data && parsed.data.length > 0) {
              fallbackCache = cacheData;
              fallbackCacheKey = key;
              break;
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    }

    if (fallbackCache) {
      const { data, timestamp } = JSON.parse(fallbackCache);
      const cacheAge = Date.now() - timestamp;
      const isValid = cacheAge < CACHE_DURATION;

      if (isValid) {
        return data;
      }
    }

    const remaining = getRemainingQuota(apiKey);
    throw new Error(`QUOTA_INSUFFICIENT: 남은 할당량(${remaining})이 필요한 양(약 ${estimatedCost})보다 적습니다.`);
  }
  */

  // ===== 실제 API 호출 시작 =====
  try {
    let videoItems = [];
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    const channelCustomAvgMap = new Map<string, number>();

    if (isMyChannelsMode) {
      // 1. Optimized Fetch: Get recent videos from playlists (Fast)
      // 1. Optimized Fetch: Get recent videos from playlists (Fast)
      // FIX: Batch these requests to avoid hitting QPS (Queries Per Second) limits which trigger 403
      // Balanced batch size for speed + safety
      const BATCH_SIZE = 3;
      
      // FIX: Hard limit to prevent massive quota burn for 'Unassigned' or 'All' groups with too many channels
      let activeChannelIds = channelIds;
      if (channelIds.length > 50) {
          console.warn(`[Quota Protection] Channel count ${channelIds.length} exceeds safety limit. Processing top 50 only.`);
          activeChannelIds = channelIds.slice(0, 50);
      }
      
      // ✅ 핵심 최적화: 기간에 따라 가져올 영상 개수 동적 조정
      // 7일 × 50개 채널 = 너무 많은 영상 → API 호출 폭발!
      let maxResultsPerChannel = 10; // 기본값
      if (daysBack <= 3) maxResultsPerChannel = 10;      // 3일 이하
      else if (daysBack <= 7) maxResultsPerChannel = 15; // 7일 이하
      else if (daysBack <= 15) maxResultsPerChannel = 20; // 15일 이하
      else maxResultsPerChannel = 30; // 30일
      
      const playlistResults = [];
      
      for (let i = 0; i < activeChannelIds.length; i += BATCH_SIZE) {
        const chunk = activeChannelIds.slice(i, i + BATCH_SIZE);
        const chunkPromises = chunk.map(async (cid) => {
          try {
            const uploadsPlaylistId = cid.replace(/^UC/, 'UU');
            const res = await fetch(`${YOUTUBE_BASE_URL}/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=${maxResultsPerChannel}&key=${apiKey}`);
            trackUsage(apiKey, 'list', 1);
            const data = await res.json();
            
            // ⚠️ 모든 에러를 조용히 무시 - 일부 실패해도 나머지 계속 진행
            if (data.error) {
               const reason = data.error.errors?.[0]?.reason;
               const code = data.error.code;
               
               // 실제 quotaExceeded만 로그에 기록 (throw하지 않음)
               if (code === 403 && reason === 'quotaExceeded') {
                 console.warn(`⚠️ API Quota 초과 감지: ${cid}`);
                 markQuotaExceeded(apiKey);
                 // throw 하지 않고 빈 배열 반환
                 return [];
               }
               
               // Rate Limit, 404, 기타 모든 에러는 조용히 스킵
               return [];
            }
            return data.items || [];
          } catch (e) {
            // 네트워크 에러 등 모든 예외도 조용히 처리
            return [];
          }
        });
        
        // Wait for this batch to finish before starting next
        const chunkResults = await Promise.all(chunkPromises);
        playlistResults.push(...chunkResults);
        
        // Balanced delay between batches (300ms)
        await new Promise(r => setTimeout(r, 300));
      }
      const allSnippetItems = playlistResults.flat();

      // Filter by Date immediately
      const validVideoIds = allSnippetItems
        .filter((item: any) => new Date(item.snippet.publishedAt) >= cutoffDate)
        .map((item: any) => item.snippet.resourceId.videoId);
      
      if (validVideoIds.length === 0) return [];
      
      // Batch Fetch Stats for ALL candidate videos (Chunk by 50)
      const chunks = [];
      for (let i = 0; i < validVideoIds.length; i += 50) {
          chunks.push(validVideoIds.slice(i, i + 50));
      }

      const detailResults = [];
      for (const chunkIds of chunks) {
          try {
             // 50 IDs per request (Cost: 1)
             const res = await fetch(`${YOUTUBE_BASE_URL}/videos?part=snippet,statistics,contentDetails&id=${chunkIds.join(',')}&key=${apiKey}`);
             trackUsage(apiKey, 'list', 1);
             const data = await res.json();
                          if (data.error) {
                  const reason = data.error.errors?.[0]?.reason;
                  
                  // Quota 초과는 로그만 남기고 계속 (throw 하지 않음)
                  if (data.error.code === 403 && reason === 'quotaExceeded') {
                    console.warn('⚠️ API Quota 초과 - 일부 비디오 스킵');
                    markQuotaExceeded(apiKey);
                    // throw 하지 않고 계속
                  }
                  // 모든 에러는 조용히 무시하고 계속
              } else {
                 if (data.items) detailResults.push(...data.items);
             }
          } catch(e) {
             // 네트워크 에러도 조용히 처리
          }
          // Small delay to be safe
          await new Promise(r => setTimeout(r, 50));
      }

      videoItems = detailResults.flat();

    } else {
      if (useSearchApi) {
        // Use SEARCH endpoint for specific keyword/category filtering (Cost: 100)
        let searchUrl = `${YOUTUBE_BASE_URL}/search?part=snippet&type=video&maxResults=${MAX_RESULTS_PER_UNIT}&order=viewCount&publishedAfter=${cutoffDate.toISOString()}&key=${apiKey}`;
        
        let targetLang = '';
        if (regionCode) {
          searchUrl += `&regionCode=${regionCode}`;
          // 1. Add relevanceLanguage param
          if (regionCode === 'KR') { searchUrl += `&relevanceLanguage=ko`; targetLang = 'ko'; }
          else if (regionCode === 'US') { searchUrl += `&relevanceLanguage=en`; targetLang = 'en'; }
          else if (regionCode === 'JP') { searchUrl += `&relevanceLanguage=ja`; targetLang = 'ja'; }
        }

        if (categoryId) searchUrl += `&videoCategoryId=${categoryId}`;
        if (query) searchUrl += `&q=${encodeURIComponent(query)}`;
        
        const sRes = await fetch(searchUrl);
        trackUsage(apiKey, 'search', 1);
        const sData = await sRes.json();

        if (sData.error) {
          if (sData.error.code === 403 && sData.error.errors?.[0]?.reason === 'quotaExceeded') {
            markQuotaExceeded(apiKey);
            throw new Error("QUOTA_EXCEEDED");
          }
          throw new Error(sData.error.message);
        }
        if (!sData.items || sData.items.length === 0) return [];

        const videoIds = sData.items.map((item: any) => item.id.videoId).join(',');
        const detailRes = await fetch(`${YOUTUBE_BASE_URL}/videos?part=snippet,statistics,contentDetails&id=${videoIds}&key=${apiKey}`);
        trackUsage(apiKey, 'list', 1);
        const detailData = await detailRes.json();
        const rawItems = detailData.items || [];

        // 2. Post-fetch Soft Language Filter (Prioritize local content)
        if (targetLang) {
           const isKorean = (text: string) => /[ㄱ-ㅎ|ㅏ-ㅣ|가-힣]/.test(text);
           const isJapanese = (text: string) => /[\u3040-\u309F]|[\u30A0-\u30FF]/.test(text);
           
           rawItems.sort((a: any, b: any) => {
              const textA = (a.snippet.title + a.snippet.description).toLowerCase();
              const textB = (b.snippet.title + b.snippet.description).toLowerCase();
              
              let scoreA = 0;
              let scoreB = 0;

              if (targetLang === 'ko') {
                 if (isKorean(textA)) scoreA += 10;
                 if (isKorean(textB)) scoreB += 10;
              } else if (targetLang === 'ja') {
                 if (isJapanese(textA)) scoreA += 10;
                 if (isJapanese(textB)) scoreB += 10;
              }
              
              return scoreB - scoreA;
           });
        }
        
        videoItems = rawItems;
      } else {
        // Use VIDEOS endpoint (Most Popular) (Cost: 1)
        let url = `${YOUTUBE_BASE_URL}/videos?part=snippet,statistics,contentDetails&chart=mostPopular&maxResults=${MAX_RESULTS_PER_UNIT}&key=${apiKey}&regionCode=${regionCode}`;
        if (categoryId) url += `&videoCategoryId=${categoryId}`;
        const res = await fetch(url);
        trackUsage(apiKey, 'list', 1);
        const data = await res.json();
        
        if (data.items && data.items.length > 0) {
           videoItems = data.items;
        } else {
           // Fallback: If Most Popular returns empty (common for Edu/Travel in KR), try generic Search (Cost: 100)
           console.log("Most Popular returned empty, falling back to Search...");
           let fallbackUrl = `${YOUTUBE_BASE_URL}/search?part=snippet&type=video&maxResults=${MAX_RESULTS_PER_UNIT}&order=viewCount&publishedAfter=${cutoffDate.toISOString()}&key=${apiKey}`;
           if (regionCode) fallbackUrl += `&regionCode=${regionCode}`;
           if (categoryId) fallbackUrl += `&videoCategoryId=${categoryId}`;

           const fRes = await fetch(fallbackUrl);
           trackUsage(apiKey, 'search', 1);
           const fData = await fRes.json();
           
           if (fData.items && fData.items.length > 0) {
              const fIds = fData.items.map((item: any) => item.id.videoId).join(',');
              const fDetail = await fetch(`${YOUTUBE_BASE_URL}/videos?part=snippet,statistics,contentDetails&id=${fIds}&key=${apiKey}`);
              trackUsage(apiKey, 'list', 1);
              const fDetailData = await fDetail.json();
              videoItems = fDetailData.items || [];
           }
        }
      }
    }

    if (videoItems.length === 0) return [];


    // 1. Initialize with Saved Data (Robust Fallback)
    const channelMap = new Map();
    const dbAvgMap = new Map<string, number>();
    
    savedChannels.forEach(ch => {
       if (ch.customAvgViews) dbAvgMap.set(ch.id, ch.customAvgViews);
       
       channelMap.set(ch.id, {
          avgViews: ch.customAvgViews || 10000, 
          subscribers: ch.subscriberCount,
          totalViews: ch.totalViews || "0", 
          joinDate: ch.joinDate || new Date().toISOString(), 
          country: ch.country || "KR"
       });
    });

    const videoItemsAny = videoItems as any[];
    // Filter optimization: Only fetch channels that are NOT in savedChannels or EXPIRED cache ( > 1 hour)
    const allChannelIds = Array.from(new Set(videoItemsAny.map((v: any) => v.snippet.channelId))) as string[];
    
    const targetChannelIds = allChannelIds.filter(id => {
       const saved = savedChannels.find(c => c.id === id);
       // If we have saved data AND it's fresh (less than 1 hour old), skip fetch
       if (saved && saved.lastUpdated && Date.now() - saved.lastUpdated < 3600000) {
          // Additional check: ensure we have the critical fields
          if (saved.totalViews && saved.joinDate) return false;
       }
       return true;
    });
    
    // Chunk Channel Lookup (Max 50 per call)
    const channelChunks = [];
    for (let i = 0; i < targetChannelIds.length; i += 50) {
        channelChunks.push(targetChannelIds.slice(i, i + 50));
    }

    const channelResponses = [];
    for (const ids of channelChunks) {
        if (ids.length === 0) continue;
        try {
           const res = await fetch(`${YOUTUBE_BASE_URL}/channels?part=snippet,statistics&id=${ids.join(',')}&key=${apiKey}`);
           trackUsage(apiKey, 'list', 1);
           const data = await res.json();
           
           if (data.error) {
               const reason = data.error.errors?.[0]?.reason;
               if (data.error.code === 403) {
                 if (reason === 'quotaExceeded') {
                   markQuotaExceeded(apiKey);
                   throw new Error("QUOTA_EXCEEDED");
                 }
                 // Rate Limit은 무시하고 계속
                 console.warn('Rate Limit - 스킵');
               } else {
                 console.warn("Error fetching channel details chunk:", data.error);
               }
            } else {
               if (data.items) channelResponses.push(...data.items);
           }
        } catch (e) { 
           console.warn("Channel lookup failed", e);
        }
        await new Promise(r => setTimeout(r, 50));
    }

    const freshChannels = channelResponses.flat();

    freshChannels.forEach((c: any) => {
      // Use Custom Average if available (DB > Global)
      const globalAvg = Math.floor(parseInt(c.statistics.viewCount || "0") / Math.max(parseInt(c.statistics.videoCount || "1"), 1));
      const dbAvg = dbAvgMap.get(c.id);
      
      const finalAvg = dbAvg || globalAvg;
      
      channelMap.set(c.id, { 
        avgViews: finalAvg, 
        subscribers: formatNumber(parseInt(c.statistics.subscriberCount || "0")),
        totalViews: formatNumber(parseInt(c.statistics.viewCount || "0")),
        joinDate: c.snippet.publishedAt,
        country: c.snippet.country
      });
    });


    const videos: VideoData[] = videoItems.map((item: any) => {
      // Fallback if channel info is missing
      const channelInfo = channelMap.get(item.snippet.channelId) || { 
        avgViews: 1000, 
        subscribers: "0", 
        totalViews: "0",
        joinDate: new Date().toISOString(),
        country: ""
      };

      const currentViews = parseInt(item.statistics.viewCount || "0");
      const publishedAt = new Date(item.snippet.publishedAt);
      const now = new Date();
      // Ensure minimum 1 hour to prevent massive fluctuation for minutes-old videos
      const hoursSinceUpload = Math.max((now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60), 1);
      
      // Improved Non-linear Expected Views Model
      const maturityHours = 168; // 7 days (Time to reach "full potential")
      
      // Calculate Time Factor (Curve: fast start, slow maturation)
      // FIX: Add minimum floor of 0.3 to prevent massive score inflation for very new videos (Recency Bias)
      const timeFactor = Math.max(Math.min(Math.pow(hoursSinceUpload / maturityHours, 0.5), 1), 0.3);



      const expectedViews = Math.max(channelInfo.avgViews * timeFactor, 100); // Min expectation 100 views
      
      // Viral Score = Actual / Expected
      // A score of 1.0 means "Average performance". 2.0 means "2x better than usual".
      const viralScore = currentViews / expectedViews;

      return {
        id: item.id,
        title: item.snippet.title,
        channelName: item.snippet.channelTitle,
        thumbnailUrl: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url,
        duration: parseISO8601Duration(item.contentDetails.duration),
        views: formatNumber(currentViews),
        avgViews: formatNumber(channelInfo.avgViews),
        subscribers: channelInfo.subscribers,
        viralScore: viralScore.toFixed(1), // Use new score
        uploadTime: getTimeAgo(item.snippet.publishedAt),
        category: getCategoryName(item.snippet.categoryId),
        reachPercentage: Math.min(Math.round((currentViews / channelInfo.avgViews) * 100), 999), 
        tags: item.snippet.tags || [],
        channelTotalViews: channelInfo.totalViews,
        channelJoinDate: channelInfo.joinDate,
        channelCountry: channelInfo.country,
        publishedAt: item.snippet.publishedAt, // For sorting
        channelId: item.snippet.channelId // Critical for filtering
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
    avgViews?: number;
  };
  representativeVideo: {
    id: string;
    title: string;
    views: number;
    thumbnail: string;
    publishedAt?: string;
  };
}

// Major Categories for popular scanning
// 1: Film, 2: Autos, 10: Music, 15: Pets, 17: Sports, 19: Travel, 20: Gaming, 
// 22: People, 23: Comedy, 24: Entertainment, 25: News, 26: Style, 28: Science
const TARGET_CATEGORY_IDS = ['1', '2', '10', '15', '17', '19', '20', '22', '23', '24', '25', '26', '28'];

// Updated Auto Detect: Scan Popular Videos by Category (Cost Efficient: ~15 Quota)
export const autoDetectShortsChannels = async (apiKey: string, regionCode: string = 'KR'): Promise<AutoDetectResult[]> => {
  console.log(`Starting Auto Detect for Region: ${regionCode} using Category Scan...`);
  const cacheKey = `yt_shorts_autodetect_v2_${regionCode}_${new Date().toDateString()}`;
  const cached = localStorage.getItem(cacheKey);

  if (cached) {
    try {
      const { data } = JSON.parse(cached);
      if (data && data.length > 0) return data;
    } catch (e) { localStorage.removeItem(cacheKey); }
  }

  // 1. Fetch Popular Videos from each category (Parallel)
  // Costs: 1 unit per category * 13 categories = 13 units.
  const promises = TARGET_CATEGORY_IDS.map(async (catId) => {
    try {
      const res = await fetch(`${YOUTUBE_BASE_URL}/videos?part=snippet,contentDetails,statistics&chart=mostPopular&regionCode=${regionCode}&videoCategoryId=${catId}&maxResults=50&key=${apiKey}`);
      trackUsage(apiKey, 'list', 1);
      const data = await res.json();
      if (data.error) return [];
      return data.items || [];
    } catch (e) {
      return [];
    }
  });

  const results = await Promise.all(promises);
  const allVideos = results.flat();
  
  if (allVideos.length === 0) return [];

  // 2. Filter for Shorts (Duration <= 60s) & High Performance
  const parseDurationSec = (duration: string) => {
      const matches = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      if (!matches) return 0;
      const hours = parseInt(matches[1] || '0');
      const minutes = parseInt(matches[2] || '0');
      const seconds = parseInt(matches[3] || '0');
      return (hours * 3600) + (minutes * 60) + seconds;
  };

  const shortVideos = allVideos.filter((v: any) => {
      const sec = parseDurationSec(v.contentDetails?.duration);
      return sec > 0 && sec <= 60;
  });

  // 3. Extract Unique Channels & Calculate Trends
  const channelMap = new Map();
  const BLACKLIST_COUNTRIES = ['IN', 'BR', 'RU', 'VN', 'ID', 'TH', 'PH', 'PK']; // Basic spam filter

  shortVideos.forEach((v: any) => {
    const cid = v.snippet.channelId;
    const views = parseInt(v.statistics?.viewCount || '0');
    
    // We prioritize channels with viral videos (high views)
    if (!channelMap.has(cid)) {
      channelMap.set(cid, {
        id: cid,
        title: v.snippet.channelTitle,
        totalRecentViews: views,
        bestVideo: v, // Keep the best video found
        videoCount: 1
      });
    } else {
      const current = channelMap.get(cid);
      current.totalRecentViews += views;
      current.videoCount += 1;
      if (views > parseInt(current.bestVideo.statistics.viewCount)) {
          current.bestVideo = v; // Update best video
      }
    }
  });

  // 4. Sort by Impact (Total Views in recent Popular Chart)
  const candidates = Array.from(channelMap.values())
    .sort((a, b) => b.totalRecentViews - a.totalRecentViews)
    .slice(0, 50); // Top 50 candidates

  if (candidates.length === 0) return [];

  // 5. Fetch Real Channel Details (Subscribers, Thumbnail, Country)
  // Batch request: 50 IDs = 1 unit.
  // Total Cost: 13 (Video List) + 1 (Channels) = 14 units.
  const channelIds = candidates.map(c => c.id);
  
  const chRes = await fetch(`${YOUTUBE_BASE_URL}/channels?part=snippet,statistics&id=${channelIds.join(',')}&key=${apiKey}`);
  trackUsage(apiKey, 'list', 1);
  const chData = await chRes.json();
  
  if (!chData.items) return [];

  const finalResults: AutoDetectResult[] = chData.items
    .filter((ch: any) => {
       const subs = parseInt(ch.statistics?.subscriberCount || '0');
       // Filter: At least 100 subs (Minimal quality)
       if (subs < 100) return false;
       
       // Country Filter (Strict-ish)
       if (ch.snippet.country && BLACKLIST_COUNTRIES.includes(ch.snippet.country)) return false;
       if (regionCode !== 'GLOBAL' && ch.snippet.country && ch.snippet.country !== regionCode) {
           // If we are looking for KR/US/JP specific, prefer match. 
           // But sometimes creators don't set country. We allow if undefined.
           return false; 
       }
       return true;
    })
    .map((ch: any) => {
      const candidateFn = channelMap.get(ch.id);
      const bestVideo = candidateFn.bestVideo;
      const views = parseInt(bestVideo.statistics.viewCount || '0');
      const subs = parseInt(ch.statistics.subscriberCount || '0');
      const subFormatted = formatSubscriberCount(ch.statistics.subscriberCount);
      
      // Calculate a "Viral Score": Views / Subs
      // If 1M views on 10k subs -> 10000% -> Viral
      const viralScore = subs > 0 ? parseFloat(((views / subs) * 100).toFixed(1)) : 0;

      return {
          id: ch.id,
          title: ch.snippet.title,
          thumbnail: ch.snippet.thumbnails?.default?.url,
          groupId: 'unassigned',
          viralScore: viralScore,
          stats: {
              viewCount: parseInt(ch.statistics.viewCount),
              subscribers: subs,
              videoCount: parseInt(ch.statistics.videoCount),
              publishedAt: ch.snippet.publishedAt,
              avgViews: Math.round(candidateFn.totalRecentViews / candidateFn.videoCount) // Avg of popular ones
          },
          representativeVideo: {
              id: bestVideo.id,
              title: bestVideo.snippet.title,
              views: views,
              thumbnail: bestVideo.snippet.thumbnails.high?.url || bestVideo.snippet.thumbnails.default?.url,
              publishedAt: bestVideo.snippet.publishedAt
          }
      };
    });

  // Sort final results by Viral Score (Hotness)
  finalResults.sort((a, b) => b.viralScore - a.viralScore);
  
  // Cache result
  localStorage.setItem(cacheKey, JSON.stringify({ data: finalResults, timestamp: Date.now() }));

  return finalResults;
};

// Helper for formatting subscriber counts
function formatSubscriberCount(numStr: string | undefined) {
  if (!numStr) return "0";
  const num = parseInt(numStr);
  if (isNaN(num)) return "0";
  if (num >= 100000000) return (num / 100000000).toFixed(1) + "억";
  if (num >= 10000) return (num / 10000).toFixed(1) + "만";
  return num.toLocaleString();
}

export const fetchChannelPopularVideos = async (apiKey: string, channelId: string): Promise<any[]> => {
  try {
    // 1. Get Uploads Playlist ID (Cost: 1)
    // We need 'contentDetails' to find the uploads playlist
    const chRes = await fetch(`${YOUTUBE_BASE_URL}/channels?part=contentDetails&id=${channelId}&key=${apiKey}`);
    trackUsage(apiKey, 'list', 1);
    const chData = await chRes.json();
    
    if (!chData.items || chData.items.length === 0) return [];
    
    const uploadsPlaylistId = chData.items[0].contentDetails.relatedPlaylists.uploads;

    // 2. Get Latest 10 Videos from Uploads Playlist (Cost: 1)
    const plRes = await fetch(`${YOUTUBE_BASE_URL}/playlistItems?part=snippet&playlistId=${uploadsPlaylistId}&maxResults=10&key=${apiKey}`);
    trackUsage(apiKey, 'list', 1);
    const plData = await plRes.json();

    if (!plData.items || plData.items.length === 0) return [];

    const videoIds = plData.items.map((item: any) => item.snippet.resourceId.videoId).join(',');

    // 3. Get Video Stats (Cost: 1)
    const vRes = await fetch(`${YOUTUBE_BASE_URL}/videos?part=statistics,contentDetails,snippet&id=${videoIds}&key=${apiKey}`);
    trackUsage(apiKey, 'list', 1);
    const vData = await vRes.json();
    
    if (!vData.items) return [];
    
    const results = vData.items.map((item: any) => ({
      id: item.id,
      title: item.snippet.title,
      thumbnail: item.snippet.thumbnails.high?.url || item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
      views: formatNumber(parseInt(item.statistics.viewCount || "0")),
      duration: parseISO8601Duration(item.contentDetails.duration),
      publishedAt: item.snippet.publishedAt,
      date: item.snippet.publishedAt // For compatibility
    }));
    
    return results;

  } catch (error) {
    console.error("Fetch Channel Popular Videos Error:", error);
    return [];
  }
};


export const fetchMyChannelId = async (accessToken: string): Promise<string | null> => {
  try {
    const res = await fetch(`${YOUTUBE_BASE_URL}/channels?part=id&mine=true`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json'
      }
    });
    const data = await res.json();
    if (data.items && data.items.length > 0) {
      return data.items[0].id;
    }
    return null;
  } catch (e) {
    console.error("Failed to fetch my channel ID", e);
    return null;
  }
};

export const fetchMemberIds = async (accessToken: string): Promise<string[]> => {
  try {
    let memberIds: string[] = [];
    let nextPageToken = '';
    
    do {
      const url = `${YOUTUBE_BASE_URL}/members?part=snippet&mode=all_current&maxResults=1000${nextPageToken ? `&pageToken=${nextPageToken}` : ''}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json'
        }
      });
      
      const data = await res.json();
      
      if (data.error) {
        throw new Error(data.error.message);
      }
      
      if (data.items) {
        const ids = data.items.map((item: any) => item.snippet.memberDetails.channelId);
        memberIds = [...memberIds, ...ids];
      }
      
      nextPageToken = data.nextPageToken;
    } while (nextPageToken);
    
    return memberIds;
  } catch (e) {
    console.error("Failed to fetch member IDs", e);
    throw e;
  }
};

// --- Channel Spike Radar Helpers ---

export const getChannelUploadsPlaylistId = async (apiKey: string, channelId: string): Promise<string | null> => {
  try {
    const res = await fetch(`${YOUTUBE_BASE_URL}/channels?part=contentDetails&id=${channelId}&key=${apiKey}`);
    trackUsage(apiKey, 'list', 1);
    const data = await res.json();
    if (!data.items?.length) return null;
    return data.items[0].contentDetails.relatedPlaylists.uploads;
  } catch (e) {
    return null;
  }
};

export const getPlaylistItems = async (apiKey: string, playlistId: string, maxResults: number = 20): Promise<any[]> => {
  try {
    const res = await fetch(`${YOUTUBE_BASE_URL}/playlistItems?part=snippet,contentDetails&playlistId=${playlistId}&maxResults=${maxResults}&key=${apiKey}`);
    trackUsage(apiKey, 'list', 1);
    const data = await res.json();
    return data.items || [];
  } catch (e) {
    return [];
  }
};

export interface ChannelAnalysis {
  keywords: string[];
  mainCategoryId: string;
  avgViews: number;
  subscriberCount: number;
}

export interface ChannelAnalysis {
  keywords: string[];
  mainCategoryId: string;
  avgViews: number;
  subscriberCount: number;
  title: string;
}

export const analyzeChannelForRadar = async (apiKey: string, channelId: string): Promise<ChannelAnalysis | null> => {
  try {
    const chRes = await fetch(`${YOUTUBE_BASE_URL}/channels?part=statistics,contentDetails,snippet&id=${channelId}&key=${apiKey}`);
    trackUsage(apiKey, 'list', 1);
    const chData = await chRes.json();
    if (!chData.items?.length) return null;
    
    const channel = chData.items[0];
    const subscriberCount = parseInt(channel.statistics.subscriberCount || "0");
    const uploadsId = channel.contentDetails.relatedPlaylists.uploads;

    const videos = await getPlaylistItems(apiKey, uploadsId, 20);
    if (videos.length === 0) {
      return { keywords: [channel.snippet.title], mainCategoryId: "", avgViews: 0, subscriberCount, title: channel.snippet.title };
    }

    const categoryCounts: Record<string, number> = {};
    const textCorpus: string[] = [];
    const idList = videos.map((v: any) => v.contentDetails.videoId).join(',');
    
    const vDetailRes = await fetch(`${YOUTUBE_BASE_URL}/videos?part=snippet,statistics&id=${idList}&key=${apiKey}`);
    trackUsage(apiKey, 'list', 1);
    const vDetailData = await vDetailRes.json();
    const videoDetails = vDetailData.items || [];

    let totalViews = 0;
    videoDetails.forEach((v: any) => {
      const cat = v.snippet.categoryId;
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      textCorpus.push(v.snippet.title);
      if (v.snippet.tags) textCorpus.push(...v.snippet.tags);
      totalViews += parseInt(v.statistics.viewCount || "0");
    });

    const mainCategoryId = Object.entries(categoryCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const avgViews = totalViews / (videoDetails.length || 1);

    const stopWords = new Set(['영상', '동영상', 'youtube', 'vlog', '브이로그', 'video', 'shorts', '쇼츠', '티비', 'TV', 'tv']);
    const wordCounts: Record<string, number> = {};
    
    textCorpus.join(' ').split(/[\s,]+/).forEach(word => {
      const clean = word.replace(/[^\w가-힣]/g, '').toLowerCase();
      if (clean.length > 1 && !stopWords.has(clean)) {
        wordCounts[clean] = (wordCounts[clean] || 0) + 1;
      }
    });

    const topKeywords = Object.entries(wordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
    
    if (topKeywords.length === 0) topKeywords.push(channel.snippet.title);

    return {
      keywords: topKeywords,
      mainCategoryId,
      avgViews,
      subscriberCount,
      title: channel.snippet.title
    };

  } catch (e) {
    console.error("Analysis Failed", e);
    return null;
  }
};

export interface RadarResult {
  video: VideoData;
  spikeScore: number;
  velocity: number;
  channelAvgViews: number;
  performanceRatio: number;
}

export const performRadarScan = async (
  apiKey: string, 
  targetChannelId: string, 
  onProgress: (msg: string, progress: number) => void
): Promise<RadarResult[]> => {
  try {
    // 1. Analyze Base Channel
    onProgress("기준 채널 분석 중...", 10);
    const baseAnalysis = await analyzeChannelForRadar(apiKey, targetChannelId);
    if (!baseAnalysis) throw new Error("기준 채널 분석 실패");

    const searchKeywords = baseAnalysis.keywords.slice(0, 3).join(' '); // Use top 3 keywords
    onProgress(`핵심 키워드 도출: ${baseAnalysis.keywords.join(', ')}`, 20);

    // 2. Search Similar Channels (Max 50)
    // Cost: 100 units
    onProgress("유사 채널 대규모 탐색 중...", 30);
    const searchRes = await fetch(`${YOUTUBE_BASE_URL}/search?part=snippet&type=channel&q=${encodeURIComponent(searchKeywords)}&maxResults=50&key=${apiKey}`);
    trackUsage(apiKey, 'search', 1);
    const searchData = await searchRes.json();
    
    if (!searchData.items?.length) return [];
    
    const channelIds = searchData.items.map((item: any) => item.snippet.channelId);
    onProgress(`${channelIds.length}개 채널 발견. 정밀 스캔 시작...`, 40);

    // 3. Batch Fetch Channel Details (Uploads ID & Stats)
    // Cost: 1 unit (50 ids fit in one call)
    const chDetailRes = await fetch(`${YOUTUBE_BASE_URL}/channels?part=contentDetails,statistics,snippet&id=${channelIds.join(',')}&key=${apiKey}`);
    trackUsage(apiKey, 'list', 1);
    const chDetailData = await chDetailRes.json();
    
    const channelMap = new Map<string, { uploadsId: string; subCount: number; avgViewsEstimate: number; title: string, thumb: string }>();
    
    chDetailData.items?.forEach((ch: any) => {
      const viewCount = parseInt(ch.statistics.viewCount || "0");
      const videoCount = parseInt(ch.statistics.videoCount || "1");
      const avg = viewCount / (videoCount || 1);
      
      channelMap.set(ch.id, {
        uploadsId: ch.contentDetails.relatedPlaylists.uploads,
        subCount: parseInt(ch.statistics.subscriberCount || "0"),
        avgViewsEstimate: avg,
        title: ch.snippet.title,
        thumb: ch.snippet.thumbnails.default.url
      });
    });

    // 4. Fetch Recent Videos from All Channels (Parallel)
    // "Don't artificially limit" -> Fetch max allowed by playlist API (50) for EACH channel.
    // However, we need to be mindful of quota. 50 channels * 50 videos = 2500 videos for 'list' calls later?
    // Cost Analysis:
    // - PlaylistItems: 50 calls * 1 unit = 50 units.
    // - Videos.list: 2500 videos / 50 per call = 50 calls * 1 unit = 50 units.
    // Total Cost ~200 units. Safe.
    
    onProgress("전체 채널 영상 수집 중 (대량 데이터 처리)...", 50);
    
    const allVideoIds: string[] = [];
    const videoChannelMap = new Map<string, string>(); // VideoID -> ChannelID

    // Limit concurrency to avoid network choke? optional. Promise.all is usually fine for 50 fetches.
    const playlistPromises = Array.from(channelMap.entries()).map(async ([chId, info]) => {
      try {
        const plItems = await getPlaylistItems(apiKey, info.uploadsId, 20); // Fetch top 20 recent per channel (Balance between 50 and speed)
        return plItems.map((item: any) => {
           const vid = item.contentDetails.videoId;
           videoChannelMap.set(vid, chId);
           return vid;
        });
      } catch (e) {
        return [];
      }
    });

    const playlistsResults = await Promise.all(playlistPromises);
    playlistsResults.forEach(ids => allVideoIds.push(...ids));

    onProgress(`${allVideoIds.length}개 영상 확보. 성과 지표 계산 중...`, 70);

    // 5. Batch Fetch Video Statistics
    const radarResults: RadarResult[] = [];
    const chunkSize = 50;
    
    for (let i = 0; i < allVideoIds.length; i += chunkSize) {
      const chunk = allVideoIds.slice(i, i + chunkSize);
      const vRes = await fetch(`${YOUTUBE_BASE_URL}/videos?part=snippet,statistics,contentDetails&id=${chunk.join(',')}&key=${apiKey}`);
      trackUsage(apiKey, 'list', 1);
      const vData = await vRes.json();
      
      if (vData.items) {
        vData.items.forEach((v: any) => {
           const chId = videoChannelMap.get(v.id);
           if (!chId) return;
           const chInfo = channelMap.get(chId);
           if (!chInfo) return;

           const views = parseInt(v.statistics.viewCount || "0");
           const publishedAt = v.snippet.publishedAt;
           const now = new Date();
           const pubDate = new Date(publishedAt);
           const hoursSince = Math.max((now.getTime() - pubDate.getTime()) / (1000 * 60 * 60), 0.5); // Min 0.5h to avoid div/0
           
           // Metric 1: Velocity (Views per Hour)
           const velocity = views / hoursSince;
           
           // Metric 2: Performance Ratio (vs Channel Avg)
           // If channel avg is 0 or very low, baseline it to 100 to avoid crazy multiples
           const baseline = Math.max(chInfo.avgViewsEstimate, 100); 
           const ratio = views / baseline;

           // Metric 3: Spike Score
           // Weighted combination: Velocity is raw power, Ratio is relative surprise.
           // We want "Early Detection". So high velocity on recent video is key.
           // Score = Velocity * (Log(Ratio) + 1) * FreshnessFactor
           
           const freshnessBonus = hoursSince < 24 ? 2.0 : (hoursSince < 72 ? 1.5 : 1.0);
           const spikeScore = velocity * Math.log10(ratio + 2) * freshnessBonus;

           radarResults.push({
             video: {
               id: v.id,
               title: v.snippet.title,
               channelName: chInfo.title,
               channelId: chId, // Add channelId for accurate filtering
               thumbnailUrl: v.snippet.thumbnails.high?.url || v.snippet.thumbnails.default?.url,
               duration: parseISO8601Duration(v.contentDetails.duration),
               views: formatNumber(views),
               avgViews: formatNumber(chInfo.avgViewsEstimate),
               subscribers: formatNumber(chInfo.subCount),
               viralScore: `${(velocity/100).toFixed(1)}p`, // Display score differently
               uploadTime: getTimeAgo(publishedAt),
               category: "Radar",
               reachPercentage: Math.min(ratio * 10, 100), // Visual bar based on ratio
               tags: v.snippet.tags || [],
             },
             spikeScore,
             velocity,
             channelAvgViews: chInfo.avgViewsEstimate,
             performanceRatio: ratio
           });
        });
      }
    }

    // 6. Sort and Return Top 50, limiting to max 2 videos per channel
    radarResults.sort((a, b) => b.spikeScore - a.spikeScore);
    
    const filteredResults: RadarResult[] = [];
    const channelCounts = new Map<string, number>();

    for (const res of radarResults) {
        const cId = res.video.channelId || res.video.channelName;
        const count = channelCounts.get(cId) || 0;
        if (count < 1) {
            filteredResults.push(res);
            channelCounts.set(cId, count + 1);
        }
        if (filteredResults.length >= 50) break;
    }

    return filteredResults;

  } catch (e: any) {
    console.error("Radar Scan Failed", e);
    throw e;
  }
};

function getCategoryName(id: string): string {
  const categories: Record<string, string> = {
    '1': 'Film & Animation',
    '2': 'Autos & Vehicles',
    '10': 'Music',
    '15': 'Pets & Animals',
    '17': 'Sports',
    '18': 'Short Movies',
    '19': 'Travel & Events',
    '20': 'Gaming',
    '21': 'Videoblogging',
    '22': 'People & Blogs',
    '23': 'Comedy',
    '24': 'Entertainment',
    '25': 'News & Politics',
    '26': 'Howto & Style',
    '27': 'Education',
    '28': 'Science & Technology',
    '29': 'Nonprofits & Activism',
    '30': 'Movies',
    '31': 'Anime/Animation',
    '32': 'Action/Adventure',
    '33': 'Classics',
    '34': 'Comedy',
    '35': 'Documentary',
    '36': 'Drama',
    '37': 'Family',
    '38': 'Foreign',
    '39': 'Horror',
    '40': 'Sci-Fi/Fantasy',
    '41': 'Thriller',
    '42': 'Shorts',
    '43': 'Shows',
    '44': 'Trailers'
  };
  return categories[id] || 'General';
}

export function parseISO8601DurationToSeconds(duration: string): number {
  const matches = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!matches) return 0;
  const hours = parseInt(matches[1] || '0');
  const minutes = parseInt(matches[2] || '0');
  const seconds = parseInt(matches[3] || '0');
  return (hours * 3600) + (minutes * 60) + seconds;
}

// Helper duplication to ensure availability in this scope
function _localGetTimeAgo(date: string) {
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



export const searchVideosForMaterials = async (
  apiKey: string,
  query: string,
  daysBack: number,
  order: 'viewCount' | 'date' = 'date'
): Promise<VideoData[]> => {
  if (!query.trim()) return [];
  
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysBack);

    // 1. Search API
    const searchRes = await fetch(`${YOUTUBE_BASE_URL}/search?part=snippet&type=video&maxResults=50&q=${encodeURIComponent(query)}&publishedAfter=${cutoffDate.toISOString()}&order=${order}&key=${apiKey}`);
    trackUsage(apiKey, 'search', 1);
    const searchData = await searchRes.json();
    
    // Safety check for empty or invalid response
    if (!searchData.items || !Array.isArray(searchData.items) || searchData.items.length === 0) return [];

    const videoIds = searchData.items.map((i: any) => i.id?.videoId).filter(Boolean).join(',');
    if (!videoIds) return [];

    // 2. Video Details
    const videoRes = await fetch(`${YOUTUBE_BASE_URL}/videos?part=snippet,contentDetails,statistics&id=${videoIds}&key=${apiKey}`);
    trackUsage(apiKey, 'list', 1);
    const videoData = await videoRes.json();
    if (!videoData.items || !Array.isArray(videoData.items)) return [];

    // 3. Channel Details
    const channelIds = Array.from(new Set(videoData.items.map((v: any) => v.snippet?.channelId).filter(Boolean))).join(',');
    
    let channelMap = new Map();
    if (channelIds) {
        try {
            const channelRes = await fetch(`${YOUTUBE_BASE_URL}/channels?part=snippet,statistics&id=${channelIds}&key=${apiKey}`);
            trackUsage(apiKey, 'list', 1);
            const channelData = await channelRes.json();
            
            if (channelData.items && Array.isArray(channelData.items)) {
               channelData.items.forEach((c: any) => {
                  const viewCount = parseInt(c.statistics?.viewCount || '0');
                  const videoCount = Math.max(parseInt(c.statistics?.videoCount || '1'), 1);
                  channelMap.set(c.id, {
                     subs: formatNumber(parseInt(c.statistics?.subscriberCount || '0')),
                     totalViews: formatNumber(viewCount),
                     avgViews: Math.round(viewCount / videoCount),
                     thumbnail: c.snippet?.thumbnails?.default?.url || ''
                  });
               });
            }
        } catch (e) {
            console.warn("Channel fetch failed in materials search", e);
            // Continue without channel details
        }
    }

    return videoData.items.map((v: any) => {
       if (!v.snippet) return null;
       
       const chId = v.snippet.channelId;
       const ch = channelMap.get(chId) || { subs: '0', avgViews: 0, thumbnail: '' };
       
       const duration = v.contentDetails?.duration || 'PT0S';
       const durationSec = parseISO8601DurationToSeconds(duration);
       
       const currentViews = parseInt(v.statistics?.viewCount || '0');
       
       const publishedAt = new Date(v.snippet.publishedAt);
       const hoursSince = Math.max((new Date().getTime() - publishedAt.getTime()) / (3600 * 1000), 0.1);
       const velocity = Math.round(currentViews / hoursSince);

       const categoryId = v.snippet.categoryId || '';
       const categoryName = CATEGORY_NAMES[categoryId] || '기타';

       return {
          id: v.id,
          title: v.snippet.title || 'No Title',
          channelName: v.snippet.channelTitle || 'Unknown',
          channelId: chId,
          thumbnailUrl: v.snippet.thumbnails?.high?.url || v.snippet.thumbnails?.medium?.url || '',
          duration: parseISO8601Duration(duration),
          durationSec: durationSec,
          velocity: velocity,
          views: formatNumber(currentViews),
          avgViews: formatNumber(ch.avgViews),
          subscribers: ch.subs,
          channelThumbnail: ch.thumbnail,
          viralScore: (currentViews / Math.max(ch.avgViews, 1)).toFixed(1),
          publishedAt: v.snippet.publishedAt,
          uploadTime: getTimeAgo(v.snippet.publishedAt),
          category: categoryName,
          reachPercentage: 0,
          tags: v.snippet.tags || []
       } as VideoData;
    }).filter(Boolean) as VideoData[];

  } catch (e) {
    console.error("Material search failed", e);
    return [];
  }
};


import { SavedChannel } from "../types";

/**
 * Threads @username 또는 프로필 URL에서 username을 추출합니다.
 */
const extractThreadsUsername = (input: string): string => {
  let u = input.trim();
  // URL 패턴: threads.net/@user 또는 threads.com/@user
  const urlMatch = u.match(/threads\.(?:net|com)\/@?([\w.]+)/i);
  if (urlMatch) u = urlMatch[1];
  // @ 제거
  u = u.replace(/^@/, '');
  return u.toLowerCase();
};

interface ThreadsProfileResult {
  profile: {
    username: string;
    displayName: string;
    avatar: string;
    followerText: string;
  };
  scrapedAt: number;
}

/**
 * Threads 계정 정보를 생성합니다.
 * 서버 API로 실제 프로필 사진 + 이름을 가져옵니다.
 */
export const getThreadsChannelInfo = async (username: string): Promise<SavedChannel | null> => {
  try {
    username = extractThreadsUsername(username);
    if (!username) return null;

    // 서버 API로 실제 프로필 스크래핑 시도
    try {
      const res = await fetch(`/api/threads/profile?username=${encodeURIComponent(username)}`);
      if (res.ok) {
        const data: ThreadsProfileResult = await res.json();
        const { profile } = data;
        return {
          id: `th_${username}`,
          title: profile.displayName || `@${username}`,
          thumbnail: profile.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=000&color=fff&bold=true&size=128`,
          customUrl: `@${username}`,
          subscriberCount: profile.followerText || undefined,
          lastUpdated: Date.now(),
          platform: 'threads',
        };
      }
    } catch {
      console.warn(`Threads API scrape failed for ${username}, using fallback`);
    }

    // 폴백: 이니셜 아바타
    return {
      id: `th_${username}`,
      title: `@${username}`,
      thumbnail: `https://ui-avatars.com/api/?name=${encodeURIComponent(username)}&background=000&color=fff&bold=true&size=128`,
      customUrl: `@${username}`,
      lastUpdated: Date.now(),
      platform: 'threads',
    };
  } catch (e: any) {
    console.error('getThreadsChannelInfo failed:', e);
    return null;
  }
};

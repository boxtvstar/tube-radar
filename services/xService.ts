
import { SavedChannel } from "../types";

/**
 * X(구 Twitter) @username 또는 프로필 URL에서 username을 추출합니다.
 */
const extractXUsername = (input: string): string => {
  let u = input.trim();
  // URL 패턴: x.com/user, twitter.com/user
  const urlMatch = u.match(/(?:x\.com|twitter\.com)\/(@?[\w]+)/i);
  if (urlMatch) u = urlMatch[1];
  // @ 제거
  u = u.replace(/^@/, '');
  return u.toLowerCase();
};

/**
 * X 계정 정보를 생성합니다.
 * 공식 API가 없으므로 입력된 username을 기반으로 프로필 카드를 생성합니다.
 */
export const getXChannelInfo = async (username: string): Promise<SavedChannel | null> => {
  try {
    username = extractXUsername(username);
    if (!username) return null;

    return {
      id: `x_${username}`,
      title: `@${username}`,
      thumbnail: `https://unavatar.io/x/${username}`,
      customUrl: `@${username}`,
      lastUpdated: Date.now(),
      platform: 'x',
    };
  } catch (e: any) {
    console.error('getXChannelInfo failed:', e);
    return null;
  }
};

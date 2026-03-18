
import { ApiUsage } from "../types";
import { auth } from '../src/lib/firebase';
import { updateUsageInDb, getUsageFromDb } from './dbService';

const DAILY_QUOTA = 10000;

// Create unique storage key for each API key
const getStorageKey = (apiKey: string): string => {
  if (!apiKey || apiKey.length < 8) {
    return 'yt_api_usage_default';
  }
  // Use last 8 characters of API key to differentiate keys
  const keyHash = apiKey.slice(-8);
  return `yt_api_usage_${keyHash}`;
};

// YouTube API quota resets at Pacific Time midnight (17:00 KST)
const getQuotaResetTime = (): Date => {
  const now = new Date();
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));

  // Today's reset time is 17:00 KST
  const todayReset = new Date(kst);
  todayReset.setHours(17, 0, 0, 0);

  // If current time is before 17:00, use yesterday's 17:00 as the reset reference
  if (kst < todayReset) {
    todayReset.setDate(todayReset.getDate() - 1);
  }

  return todayReset;
};

export const getApiUsage = (apiKey: string): ApiUsage => {
  const storageKey = getStorageKey(apiKey);
  const saved = localStorage.getItem(storageKey);
  let usage: ApiUsage;

  if (saved) {
    try {
      usage = JSON.parse(saved);
      if (!usage || typeof usage !== 'object') throw new Error("Invalid usage data");
    } catch (e) {
      // JSON Parse Error or Invalid Data -> Reset
      usage = {
        total: DAILY_QUOTA,
        used: 0,
        lastReset: new Date().toISOString(),
        details: { search: 0, list: 0 },
        logs: []
      };
    }
  } else {
    usage = {
      total: DAILY_QUOTA,
      used: 0,
      lastReset: new Date().toISOString(),
      details: { search: 0, list: 0 },
      logs: []
    };
  }

  // YouTube API 쿼터는 Pacific Time 자정 (한국 시간 17:00)에 리셋됨
  const lastResetTime = new Date(usage.lastReset);
  const currentResetTime = getQuotaResetTime();

  // 마지막 리셋 이후 17:00이 지났는지 확인
  if (lastResetTime < currentResetTime) {
    usage = {
      total: DAILY_QUOTA,
      used: 0,
      lastReset: new Date().toISOString(),
      details: { search: 0, list: 0 },
      logs: [{
        timestamp: new Date().toISOString(),
        type: 'system',
        cost: 0,
        details: '일일 할당량 초기화 (매일 17:00 KST)'
      }]
    };
    localStorage.setItem(storageKey, JSON.stringify(usage));
  }

  return usage;
};

export const checkQuotaAvailable = (apiKey: string, estimatedCost: number): boolean => {
  const usage = getApiUsage(apiKey);
  return (usage.used + estimatedCost) <= usage.total;
};

export const getRemainingQuota = (apiKey: string): number => {
  const usage = getApiUsage(apiKey);
  return Math.max(0, usage.total - usage.used);
};

/**
 * DB 기반 포인트 사전 체크 (로그인 유저 전용)
 * API 호출 전에 잔여 포인트가 충분한지 확인
 * 부족하면 에러를 throw하여 API 호출 자체를 차단
 */
export const preCheckQuota = async (estimatedCost: number, userRoleOrPlan?: string): Promise<void> => {
  const user = auth.currentUser;
  if (!user) return; // 비로그인 유저는 패스 (localStorage 기반 추적만)

  try {
    const val = (userRoleOrPlan || '').toLowerCase();
    const plan =
      val === 'admin' ? 'admin' :
      val === 'platinum' ? 'platinum' :
      val === 'gold' ? 'gold' :
      val === 'silver' || val === 'trial' ? 'silver' :
      val === 'pro' ? 'gold' :
      val === 'regular' ? 'silver' :
      'pending';
    const usage = await getUsageFromDb(user.uid, plan);
    const bonusPoints = usage.bonusPoints || 0;
    const remaining = (usage.total - usage.used) + bonusPoints;

    if (remaining < estimatedCost) {
      throw new Error(`QUOTA_INSUFFICIENT: 남은 포인트(${remaining.toLocaleString()})가 필요한 포인트(${estimatedCost.toLocaleString()})보다 부족합니다.`);
    }
  } catch (e: any) {
    if (e.message?.startsWith('QUOTA_INSUFFICIENT')) throw e;
    // DB 조회 실패 시 차단하지 않음 (graceful degradation)
    console.warn('⚠️ 포인트 사전 체크 실패 (무시하고 진행):', e.message);
  }
};

export const markQuotaExceeded = (apiKey: string) => {
  console.warn('⚠️ YouTube API 실제 할당량 초과 감지');
  // 전역 이벤트 발생 → App.tsx에서 감지하여 UI 안내
  window.dispatchEvent(new CustomEvent('yt-api-quota-exceeded'));
};

export const resetQuota = (apiKey: string) => {
  const storageKey = getStorageKey(apiKey);
  const usage = {
    total: DAILY_QUOTA,
    used: 0,
    lastReset: new Date().toISOString(),
    details: { search: 0, list: 0 },
    logs: [{
      timestamp: new Date().toISOString(),
      type: 'system',
      cost: 0,
      details: '수동 할당량 리셋'
    }]
  };
  localStorage.setItem(storageKey, JSON.stringify(usage));
  window.dispatchEvent(new CustomEvent('yt-api-usage-updated', { detail: usage }));
  return usage;
};

export const trackUsage = async (apiKey: string, type: 'search' | 'list' | 'script', units: number = 1, details?: string) => {
  const cost = type === 'search' ? 100 : units;
  const currentDetails = details || (type === 'search' ? '키워드 검색' : '영상/채널 데이터 요청');

  // 1. DB Log (Logged User)
  const user = auth.currentUser;
  if (user) {
     try {
        const newUsage = await updateUsageInDb(user.uid, undefined, cost, type, currentDetails);
        window.dispatchEvent(new CustomEvent('yt-api-usage-updated', { detail: newUsage }));
        return;
     } catch (e) {
        console.error("DB Usage Update Failed", e);
     }
  }

  // 2. Local Storage (Guest / Fallback)
  const storageKey = getStorageKey(apiKey);
  const usage = getApiUsage(apiKey);

  usage.used += cost;
  if (type === 'search') usage.details.search += cost;
  else usage.details.list += cost;

  // Add Log (Grouped)
  if (!usage.logs) usage.logs = [];

  const now = new Date();
  const latestLog = usage.logs[0];
  
  // 2초 이내의 동일 타입/내용 호출은 하나로 합침
  if (latestLog &&
      latestLog.type === type &&
      latestLog.details === currentDetails &&
      (now.getTime() - new Date(latestLog.timestamp).getTime() < 2000)) {

      latestLog.cost += cost;
      latestLog.timestamp = now.toISOString(); // 시간 최신화
  } else {
      usage.logs.unshift({
        timestamp: now.toISOString(),
        type,
        cost,
        details: currentDetails
      });
  }

  localStorage.setItem(storageKey, JSON.stringify(usage));

  // 상태 업데이트를 알리기 위한 커스텀 이벤트 발생
  window.dispatchEvent(new CustomEvent('yt-api-usage-updated', { detail: usage }));
};

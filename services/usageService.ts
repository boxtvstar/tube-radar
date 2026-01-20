
import { ApiUsage } from "../types";

const STORAGE_KEY = "yt_api_usage_stats";
const DAILY_QUOTA = 10000;

export const getApiUsage = (): ApiUsage => {
  const saved = localStorage.getItem(STORAGE_KEY);
  let usage: ApiUsage;

  if (saved) {
    usage = JSON.parse(saved);
  } else {
    usage = {
      total: DAILY_QUOTA,
      used: 0,
      lastReset: new Date().toISOString(),
      details: { search: 0, list: 0 },
      logs: []
    };
  }

  // 매일 한국 시간 00:00 기준 리셋 체크
  const lastDate = new Date(usage.lastReset).toDateString();
  const currentDate = new Date().toDateString();
  
  if (lastDate !== currentDate) {
    usage = {
      total: DAILY_QUOTA,
      used: 0,
      lastReset: new Date().toISOString(),
      details: { search: 0, list: 0 },
      logs: []
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
  }

  return usage;
};

export const trackUsage = (type: 'search' | 'list', units: number = 1, details?: string) => {
  const usage = getApiUsage();
  const cost = type === 'search' ? 100 : units;
  
  usage.used += cost;
  if (type === 'search') usage.details.search += cost;
  else usage.details.list += cost;
  
  // Add Log
  if (!usage.logs) usage.logs = [];
  usage.logs.unshift({
    timestamp: new Date().toISOString(),
    type,
    cost,
    details: details || (type === 'search' ? '키워드 검색' : '영상/채널 데이터 요청')
  });

  localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
  
  // 상태 업데이트를 알리기 위한 커스텀 이벤트 발생
  window.dispatchEvent(new CustomEvent('yt-api-usage-updated', { detail: usage }));
};

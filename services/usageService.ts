
import { ApiUsage } from "../types";

const STORAGE_KEY = "yt_api_usage_stats";
const DAILY_QUOTA = 10000;

export const getApiUsage = (): ApiUsage => {
  const saved = localStorage.getItem(STORAGE_KEY);
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

  // 매일 한국 시간 00:00 기준 리셋 체크
  const lastDate = new Date(usage.lastReset).toDateString();
  const currentDate = new Date().toDateString();
  
  if (lastDate !== currentDate) {
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
  
  // Add Log (Grouped)
  if (!usage.logs) usage.logs = [];

  const now = new Date();
  const latestLog = usage.logs[0];
  const currentDetails = details || (type === 'search' ? '키워드 검색' : '영상/채널 데이터 요청');

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

  localStorage.setItem(STORAGE_KEY, JSON.stringify(usage));
  
  // 상태 업데이트를 알리기 위한 커스텀 이벤트 발생
  window.dispatchEvent(new CustomEvent('yt-api-usage-updated', { detail: usage }));
};

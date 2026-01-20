
export interface VideoData {
  id: string;
  title: string;
  channelName: string;
  thumbnailUrl: string;
  duration: string;
  views: string;
  avgViews: string;
  subscribers: string;
  viralScore: string;
  uploadTime: string;
  category: string;
  reachPercentage: number;
  tags: string[];
}

export interface AnalysisResponse {
  viralReason: string;
  engagementQuality: string;
  topicTrend: string;
}

export interface ChannelGroup {
  id: string;
  name: string;
}

export interface SavedChannel {
  id: string;
  title: string;
  thumbnail: string;
  groupId?: string; // 소속 그룹 ID (optional until saved)
}

export interface ViralStat {
  label: string;
  value: string;
  trend: string;
  trendType: 'up' | 'down';
  icon: string;
  colorClass: string;
}

export interface ApiUsageLog {
  timestamp: string;
  type: 'search' | 'list';
  cost: number;
  details?: string;
}

export interface ApiUsage {
  total: number;
  used: number;
  lastReset: string; // ISO Date
  details: {
    search: number;
    list: number;
  };
  logs: ApiUsageLog[];
}


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
  customUrl?: string;
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

export interface RecommendedPackage {
  id: string;
  title: string;
  description: string;
  category: string;
  createdAt: number;
  channels: SavedChannel[];
  channelCount: number;
  status?: 'approved' | 'pending';
  creatorName?: string;
  creatorId?: string;
  targetGroupName?: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  isRead: boolean;
  createdAt: number;
}

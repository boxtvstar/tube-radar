
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
  channelTotalViews?: string;
  channelJoinDate?: string;
  channelCountry?: string;
  publishedAt?: string;
  channelId?: string;
  durationSec?: number;
  velocity?: number;
  channelThumbnail?: string;
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

export interface VideoSnippet {
  id: string;
  title: string;
  thumbnail: string;
  views: string;
  date: string;
  duration: string;
}

export interface SavedChannel {
  id: string;
  title: string;
  description?: string; // 채널 설명 추가
  thumbnail: string;
  customUrl?: string;
  groupId?: string; // 소속 그룹 ID (optional until saved)
  subscriberCount?: string;
  videoCount?: string;
  topVideos?: VideoSnippet[];
  addedAt?: number;
  customAvgViews?: number; // Calculated average of recent 20 videos
  lastUpdated?: number; // timestamp for caching
  totalViews?: string;
  joinDate?: string; // ISO string
  country?: string;
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
  type: 'search' | 'list' | 'script' | 'system';
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
    script?: number;
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
  status?: 'approved' | 'pending' | 'rejected';
  creatorName?: string;
  creatorId?: string;
  targetGroupName?: string;
  scheduledAt?: string; // 공개 예정일 (ISO String)
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

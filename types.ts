
export type Platform = 'youtube' | 'tiktok' | 'instagram' | 'x' | 'threads';

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
  commentCount?: number;
  platform?: Platform;
  likes?: number;
  shares?: number;
}

export interface AnalysisResponse {
  viralReason: string;
  engagementQuality: string;
  topicTrend: string;
}

export interface ChannelGroup {
  id: string;
  name: string;
  sortOrder?: number;
  parentId?: string;       // 소그룹일 때 대그룹 ID
  isParentGroup?: boolean; // true = 대그룹(폴더)
  platform?: Platform;     // 소속 플랫폼 (없으면 'youtube')
}

export interface VideoSnippet {
  id: string;
  title: string;
  thumbnail: string;
  views: string;
  date: string;
  publishedAt?: string;
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
  platform?: Platform; // default: 'youtube'
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
  type: 'search' | 'list' | 'script' | 'system' | 'bonus' | 'tiktok' | 'instagram';
  cost: number;
  details?: string;
}

export interface ApiUsage {
  total: number;
  used: number;
  bonusPoints?: number; // Bonus points that persist across daily resets
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
  viewCount?: number; // 조회수
}

export interface DeepAnalysisVideo {
  id: string;
  title: string;
  thumbnail: string;
  views: number;
  likes: number;
  comments: number;
  date: string;           // ISO publishedAt
  duration: string;       // "MM:SS" format
  durationSeconds: number;
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

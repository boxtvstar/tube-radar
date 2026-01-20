
import { VideoData, ViralStat } from './types';

export const MOCK_VIDEOS: VideoData[] = [
  {
    id: '1',
    title: '아이폰 16 프로 사용기: 3개월 후의 진실',
    channelName: '디지털 리뷰어',
    thumbnailUrl: 'https://images.unsplash.com/photo-1616348436168-de43ad0db179?auto=format&fit=crop&q=80&w=800',
    duration: '15:24',
    views: '85.4만',
    avgViews: '5.2만',
    subscribers: '45.2만',
    viralScore: '16.4x',
    uploadTime: '3시간 전',
    category: '테크',
    reachPercentage: 92,
    tags: ['#애플', '#아이폰16', '#리뷰']
  },
  {
    id: '2',
    title: '나만 알고 싶은 역대급 오픈월드 신작 게임',
    channelName: '겜덕의 창고',
    thumbnailUrl: 'https://images.unsplash.com/photo-1542751371-adc38448a05e?auto=format&fit=crop&q=80&w=800',
    duration: '22:10',
    views: '42.1만',
    avgViews: '3.1만',
    subscribers: '12.8만',
    viralScore: '13.5x',
    uploadTime: '6시간 전',
    category: '게임',
    reachPercentage: 78,
    tags: ['#신작게임', '#RPG', '#추천']
  },
  {
    id: '3',
    title: '지금 당장 주식 팔아야 할까? 긴급 시장 분석',
    channelName: '머니 마스터즈',
    thumbnailUrl: 'https://images.unsplash.com/photo-1611974714024-4607a55d464a?auto=format&fit=crop&q=80&w=800',
    duration: '12:05',
    views: '28.9만',
    avgViews: '1.2만',
    subscribers: '5.4만',
    viralScore: '24.1x',
    uploadTime: '1시간 전',
    category: '금융',
    reachPercentage: 96,
    tags: ['#주식', '#경제', '#긴급분석']
  }
];

export const MOCK_STATS: ViralStat[] = [
  {
    label: '오늘의 바이럴 히트',
    value: '142건',
    trend: '어제보다 +12.4%',
    trendType: 'up',
    icon: 'trending_up',
    colorClass: 'text-primary'
  },
  {
    label: '평균 성장 부스트',
    value: '+45.8%',
    trend: '세션 평균 대비 +5.2%',
    trendType: 'up',
    icon: 'rocket_launch',
    colorClass: 'text-accent-neon'
  },
  {
    label: '탐지 정확도',
    value: '98.2%',
    trend: '실시간 데이터 기반',
    trendType: 'up',
    icon: 'verified',
    colorClass: 'text-accent-hot'
  }
];

export const NETWORK_VELOCITY_DATA = [
  { time: '00:00', today: 40, average: 30 },
  { time: '04:00', today: 65, average: 40 },
  { time: '08:00', today: 35, average: 35 },
  { time: '12:00', today: 80, average: 45 },
  { time: '16:00', today: 55, average: 40 },
  { time: '20:00', today: 70, average: 50 },
  { time: '현재', today: 95, average: 25 },
];

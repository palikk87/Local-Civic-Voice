// Web port of mobile/src/lib/news-reels.ts — News Reels and Bias Tracker Types and Data

export type BiasLean = 'Left' | 'Center' | 'Right';

export interface NewsReel {
  id: string;
  billId: string;
  videoUrl: string;
  thumbnailUrl: string;
  sourceName: string;
  biasLean: BiasLean;
  title: string;
  duration: number; // seconds
  isSponsored: boolean;
  createdAt: string;
}

export interface MediaBiasSource {
  sourceName: string;
  biasLean: BiasLean;
}

export interface UserBiasHistory {
  userId: string;
  biasLean: BiasLean;
  viewCount: number;
}

export interface AdMetric {
  id: string;
  userId: string;
  adId: string;
  clickedAt: string;
  adType: 'civic_partner' | 'sponsored_reel';
}

// Media bias directory - pre-seeded for known sources
export const mediaBiasDirectory: MediaBiasSource[] = [
  { sourceName: 'Fox News', biasLean: 'Right' },
  { sourceName: 'Newsmax', biasLean: 'Right' },
  { sourceName: 'Breitbart', biasLean: 'Right' },
  { sourceName: 'The Daily Wire', biasLean: 'Right' },
  { sourceName: 'New York Post', biasLean: 'Right' },
  { sourceName: 'MSNBC', biasLean: 'Left' },
  { sourceName: 'CNN', biasLean: 'Left' },
  { sourceName: 'HuffPost', biasLean: 'Left' },
  { sourceName: 'Vox', biasLean: 'Left' },
  { sourceName: 'The Guardian', biasLean: 'Left' },
  { sourceName: 'Associated Press', biasLean: 'Center' },
  { sourceName: 'Reuters', biasLean: 'Center' },
  { sourceName: 'BBC', biasLean: 'Center' },
  { sourceName: 'Wall Street Journal', biasLean: 'Center' },
  { sourceName: 'The Hill', biasLean: 'Center' },
  { sourceName: 'NPR', biasLean: 'Center' },
  { sourceName: 'PBS NewsHour', biasLean: 'Center' },
  { sourceName: 'C-SPAN', biasLean: 'Center' },
];

// Get bias color for UI
export function getBiasColor(bias: BiasLean): string {
  switch (bias) {
    case 'Left':
      return '#3B82F6'; // Blue
    case 'Right':
      return '#EF4444'; // Red
    case 'Center':
      return '#6B7280'; // Gray
  }
}

// Get opposite bias for balanced feed algorithm
export function getOppositeBias(bias: BiasLean): BiasLean {
  switch (bias) {
    case 'Left':
      return 'Right';
    case 'Right':
      return 'Left';
    case 'Center':
      return 'Center'; // Center stays center
  }
}

// Mock news reels data for bills
export const mockNewsReels: NewsReel[] = [
  // Social Security Fairness Act reels
  {
    id: 'reel-1',
    billId: 'hr-82',
    videoUrl: 'https://example.com/video1.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=400&h=600&fit=crop',
    sourceName: 'Fox News',
    biasLean: 'Right',
    title: 'Social Security Act: What It Means for Taxpayers',
    duration: 62,
    isSponsored: false,
    createdAt: '2024-12-20T10:00:00Z',
  },
  {
    id: 'reel-2',
    billId: 'hr-82',
    videoUrl: 'https://example.com/video2.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1495020689067-958852a7765e?w=400&h=600&fit=crop',
    sourceName: 'CNN',
    biasLean: 'Left',
    title: 'Teachers Finally Get Fair Social Security Benefits',
    duration: 45,
    isSponsored: false,
    createdAt: '2024-12-20T11:00:00Z',
  },
  {
    id: 'reel-3',
    billId: 'hr-82',
    videoUrl: 'https://example.com/video3.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1585829365295-ab7cd400c167?w=400&h=600&fit=crop',
    sourceName: 'Associated Press',
    biasLean: 'Center',
    title: 'Breaking Down the Social Security Fairness Act',
    duration: 78,
    isSponsored: false,
    createdAt: '2024-12-20T12:00:00Z',
  },
  {
    id: 'reel-4',
    billId: 'hr-82',
    videoUrl: 'https://example.com/video4.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=400&h=600&fit=crop',
    sourceName: 'AARP',
    biasLean: 'Center',
    title: 'Sponsored: How This Bill Affects Your Retirement',
    duration: 90,
    isSponsored: true,
    createdAt: '2024-12-20T13:00:00Z',
  },
  // Tax Relief Act reels
  {
    id: 'reel-5',
    billId: 'hr-7024',
    videoUrl: 'https://example.com/video5.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1554224154-26032ffc0d07?w=400&h=600&fit=crop',
    sourceName: 'MSNBC',
    biasLean: 'Left',
    title: 'Child Tax Credit Expansion: Who Benefits Most',
    duration: 55,
    isSponsored: false,
    createdAt: '2024-12-19T14:00:00Z',
  },
  {
    id: 'reel-6',
    billId: 'hr-7024',
    videoUrl: 'https://example.com/video6.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1579621970563-ebec7560ff3e?w=400&h=600&fit=crop',
    sourceName: 'Wall Street Journal',
    biasLean: 'Center',
    title: 'Tax Relief Act: Business Implications Explained',
    duration: 68,
    isSponsored: false,
    createdAt: '2024-12-19T15:00:00Z',
  },
  {
    id: 'reel-7',
    billId: 'hr-7024',
    videoUrl: 'https://example.com/video7.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1450101499163-c8848c66ca85?w=400&h=600&fit=crop',
    sourceName: 'The Daily Wire',
    biasLean: 'Right',
    title: 'Tax Bill: Fiscal Responsibility or More Spending?',
    duration: 72,
    isSponsored: false,
    createdAt: '2024-12-19T16:00:00Z',
  },
  // Border Security reels
  {
    id: 'reel-8',
    billId: 'hr-2',
    videoUrl: 'https://example.com/video8.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1578575437130-527eed3abbec?w=400&h=600&fit=crop',
    sourceName: 'Fox News',
    biasLean: 'Right',
    title: 'Border Crisis: Why HR-2 Is Needed Now',
    duration: 58,
    isSponsored: false,
    createdAt: '2024-12-18T10:00:00Z',
  },
  {
    id: 'reel-9',
    billId: 'hr-2',
    videoUrl: 'https://example.com/video9.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1532375810709-75b1da00537c?w=400&h=600&fit=crop',
    sourceName: 'Vox',
    biasLean: 'Left',
    title: 'Asylum Seekers Under New Border Bill',
    duration: 65,
    isSponsored: false,
    createdAt: '2024-12-18T11:00:00Z',
  },
  {
    id: 'reel-10',
    billId: 'hr-2',
    videoUrl: 'https://example.com/video10.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1589262804704-c5aa9e6def89?w=400&h=600&fit=crop',
    sourceName: 'Reuters',
    biasLean: 'Center',
    title: 'Secure Border Act: Facts vs Politics',
    duration: 82,
    isSponsored: false,
    createdAt: '2024-12-18T12:00:00Z',
  },
  // TikTok Ban reels
  {
    id: 'reel-11',
    billId: 'hr-7521',
    videoUrl: 'https://example.com/video11.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1611162616305-c69b3fa7fbe0?w=400&h=600&fit=crop',
    sourceName: 'CNN',
    biasLean: 'Left',
    title: 'TikTok Ban: Free Speech Concerns',
    duration: 48,
    isSponsored: false,
    createdAt: '2024-12-17T10:00:00Z',
  },
  {
    id: 'reel-12',
    billId: 'hr-7521',
    videoUrl: 'https://example.com/video12.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1611162618071-b39a2ec055fb?w=400&h=600&fit=crop',
    sourceName: 'Newsmax',
    biasLean: 'Right',
    title: 'National Security: Why TikTok Must Go',
    duration: 55,
    isSponsored: false,
    createdAt: '2024-12-17T11:00:00Z',
  },
  {
    id: 'reel-13',
    billId: 'hr-7521',
    videoUrl: 'https://example.com/video13.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=400&h=600&fit=crop',
    sourceName: 'BBC',
    biasLean: 'Center',
    title: 'TikTok Divestiture Deadline Approaches',
    duration: 70,
    isSponsored: false,
    createdAt: '2024-12-17T12:00:00Z',
  },
  // Kids Online Safety Act reels
  {
    id: 'reel-14',
    billId: 's-1409',
    videoUrl: 'https://example.com/video14.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1560298803-1d998f6b4810?w=400&h=600&fit=crop',
    sourceName: 'NPR',
    biasLean: 'Center',
    title: 'KOSA: What Parents Need to Know',
    duration: 60,
    isSponsored: false,
    createdAt: '2024-12-16T10:00:00Z',
  },
  {
    id: 'reel-15',
    billId: 's-1409',
    videoUrl: 'https://example.com/video15.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1596742578443-7682ef5251cd?w=400&h=600&fit=crop',
    sourceName: 'HuffPost',
    biasLean: 'Left',
    title: 'Critics Say KOSA Could Harm LGBTQ+ Youth',
    duration: 52,
    isSponsored: false,
    createdAt: '2024-12-16T11:00:00Z',
  },
  {
    id: 'reel-16',
    billId: 's-1409',
    videoUrl: 'https://example.com/video16.mp4',
    thumbnailUrl: 'https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=400&h=600&fit=crop',
    sourceName: 'Fox News',
    biasLean: 'Right',
    title: 'Protecting Kids Online: Bipartisan Support Grows',
    duration: 58,
    isSponsored: false,
    createdAt: '2024-12-16T12:00:00Z',
  },
];

// Get reels for a specific bill
export function getReelsForBill(billId: string): NewsReel[] {
  return mockNewsReels.filter((reel) => reel.billId === billId);
}

// Get bias source info
export function getSourceBias(sourceName: string): BiasLean {
  const source = mediaBiasDirectory.find(
    (s) => s.sourceName.toLowerCase() === sourceName.toLowerCase()
  );
  return source?.biasLean ?? 'Center';
}

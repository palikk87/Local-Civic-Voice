// NewsReel Component - Scrollable news carousel with bias indicators
import React, { useState, useRef, useCallback, useEffect, createContext, useContext, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  FlatList,
  Linking,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  FadeIn,
  FadeInRight,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Play, ExternalLink, Clock, Shield, Sparkles } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';

import { cn } from '@/lib/cn';
import type { NewsReel, BiasLean } from '@/lib/news-reels';
import { getBiasColor, getReelsForBill } from '@/lib/news-reels';
import {
  useBiasHistoryStore,
  selectIsPremium,
  getBalancedReels,
} from '@/lib/bias-history-store';
import { useResponsive } from '@/lib/useResponsive';

// Context for carousel card dimensions
interface CarouselDimensions {
  cardWidth: number;
  cardGap: number;
}

const CarouselDimensionsContext = createContext<CarouselDimensions>({
  cardWidth: 280,
  cardGap: 12,
});

const useCarouselDimensions = () => useContext(CarouselDimensionsContext);

// Civic Partner Ad Card
interface AdCardProps {
  onPress: () => void;
  index: number;
}

function CivicPartnerAd({ onPress, index }: AdCardProps) {
  const { cardWidth, cardGap } = useCarouselDimensions();
  const scale = useSharedValue(1);

  const handlePressIn = () => {
    scale.value = withSpring(0.98);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1);
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View
      entering={FadeInRight.delay(index * 100).springify()}
      style={[animatedStyle, { width: cardWidth, marginRight: cardGap }]}
    >
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        className="h-48 rounded-2xl overflow-hidden"
        style={{ borderWidth: 2, borderColor: '#F59E0B' }}
      >
        <LinearGradient
          colors={['#78350F', '#451A03', '#1C0A00']}
          style={{ flex: 1 }}
        >
          <View className="flex-1 p-4 justify-between">
            <View className="flex-row items-center">
              <View className="bg-amber-500/30 p-2 rounded-full">
                <Shield size={20} color="#F59E0B" />
              </View>
              <Text className="text-amber-400 font-semibold ml-2 text-sm">
                Civic Partner
              </Text>
            </View>

            <View>
              <Text className="text-white font-bold text-lg mb-1">
                Support Informed Democracy
              </Text>
              <Text className="text-amber-100/70 text-sm mb-3">
                Learn how you can help make civic engagement accessible to all
              </Text>
              <View className="bg-amber-500 px-4 py-2 rounded-full self-start">
                <Text className="text-amber-950 font-semibold">Learn More</Text>
              </View>
            </View>
          </View>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
}

// Sponsored Reel Card - has gold border
interface SponsoredReelCardProps {
  reel: NewsReel;
  onPress: () => void;
  onWatchTimeUpdate: (watchTime: number) => void;
  index: number;
}

function SponsoredReelCard({
  reel,
  onPress,
  onWatchTimeUpdate,
  index,
}: SponsoredReelCardProps) {
  return (
    <ReelCard
      reel={reel}
      onPress={onPress}
      onWatchTimeUpdate={onWatchTimeUpdate}
      index={index}
      isSponsored
    />
  );
}

// Regular Reel Card
interface ReelCardProps {
  reel: NewsReel;
  onPress: () => void;
  onWatchTimeUpdate: (watchTime: number) => void;
  index: number;
  isSponsored?: boolean;
}

function ReelCard({
  reel,
  onPress,
  onWatchTimeUpdate,
  index,
  isSponsored = false,
}: ReelCardProps) {
  const { cardWidth, cardGap } = useCarouselDimensions();
  const [isViewing, setIsViewing] = useState(false);
  const viewStartTime = useRef<number | null>(null);
  const biasColor = getBiasColor(reel.biasLean);
  const scale = useSharedValue(1);

  // Track view time when card is visible
  useEffect(() => {
    return () => {
      if (viewStartTime.current) {
        const watchTime = Math.floor((Date.now() - viewStartTime.current) / 1000);
        if (watchTime > 0) {
          onWatchTimeUpdate(watchTime);
        }
      }
    };
  }, []);

  const handlePressIn = () => {
    scale.value = withSpring(0.98);
    if (!viewStartTime.current) {
      viewStartTime.current = Date.now();
    }
  };

  const handlePressOut = () => {
    scale.value = withSpring(1);
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    // Record watch time if > 10 seconds
    if (viewStartTime.current) {
      const watchTime = Math.floor((Date.now() - viewStartTime.current) / 1000);
      if (watchTime >= 10) {
        onWatchTimeUpdate(watchTime);
      }
      viewStartTime.current = null;
    }

    onPress();
  };

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const borderColor = isSponsored ? '#F59E0B' : biasColor;
  const borderWidth = isSponsored ? 3 : 2;

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <Animated.View
      entering={FadeInRight.delay(index * 100).springify()}
      style={[animatedStyle, { width: cardWidth, marginRight: cardGap }]}
    >
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        className="h-48 rounded-2xl overflow-hidden"
        style={{ borderWidth, borderColor }}
      >
        {/* Thumbnail */}
        <Image
          source={{ uri: reel.thumbnailUrl }}
          className="absolute inset-0 w-full h-full"
          resizeMode="cover"
        />

        {/* Gradient Overlay */}
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.8)']}
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '70%' }}
        />

        {/* Play Button */}
        <View className="absolute inset-0 items-center justify-center">
          <View className="bg-white/20 backdrop-blur-sm p-3 rounded-full">
            <Play size={24} color="#fff" fill="#fff" />
          </View>
        </View>

        {/* Sponsored Badge */}
        {isSponsored && (
          <View className="absolute top-2 right-2 bg-amber-500/90 px-2 py-0.5 rounded-full flex-row items-center">
            <Sparkles size={10} color="#fff" />
            <Text className="text-white text-xs font-medium ml-1">Sponsored</Text>
          </View>
        )}

        {/* Bias Badge */}
        <View
          className="absolute top-2 left-2 px-2 py-0.5 rounded-full"
          style={{ backgroundColor: `${biasColor}CC` }}
        >
          <Text className="text-white text-xs font-semibold">{reel.biasLean}</Text>
        </View>

        {/* Content Info */}
        <View className="absolute bottom-0 left-0 right-0 p-3">
          <View className="flex-row items-center mb-1">
            <Text className="text-white/80 text-xs">{reel.sourceName}</Text>
            <View className="mx-1.5 w-1 h-1 rounded-full bg-white/50" />
            <Clock size={10} color="rgba(255,255,255,0.7)" />
            <Text className="text-white/70 text-xs ml-1">
              {formatDuration(reel.duration)}
            </Text>
          </View>
          <Text className="text-white font-semibold text-sm" numberOfLines={2}>
            {reel.title}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// Bias Legend
function BiasLegend() {
  const biases: { lean: BiasLean; label: string }[] = [
    { lean: 'Left', label: 'Left' },
    { lean: 'Center', label: 'Center' },
    { lean: 'Right', label: 'Right' },
  ];

  return (
    <View className="flex-row items-center justify-center mb-3 px-4">
      <Text className="text-slate-400 text-xs mr-2">Media Bias:</Text>
      {biases.map((bias, index) => (
        <View key={bias.lean} className="flex-row items-center">
          <View
            className="w-2.5 h-2.5 rounded-full mr-1"
            style={{ backgroundColor: getBiasColor(bias.lean) }}
          />
          <Text className="text-slate-300 text-xs">{bias.label}</Text>
          {index < biases.length - 1 && (
            <Text className="text-slate-500 mx-2">|</Text>
          )}
        </View>
      ))}
    </View>
  );
}

// Main NewsReel Carousel Component
interface NewsReelCarouselProps {
  billId: string;
  onReelPress?: (reel: NewsReel) => void;
}

export function NewsReelCarousel({ billId, onReelPress }: NewsReelCarouselProps) {
  // Get responsive dimensions
  const { width, isTablet, wp } = useResponsive();

  // Calculate responsive card dimensions
  const dimensions = useMemo(() => {
    // On tablets, show more cards; on phones, cards take 75% of screen width
    const cardWidth = isTablet ? Math.min(wp(45), 320) : wp(75);
    const cardGap = isTablet ? 16 : 12;
    return { cardWidth, cardGap };
  }, [isTablet, wp]);

  const isPremium = useBiasHistoryStore(selectIsPremium);
  const recordView = useBiasHistoryStore((s) => s.recordView);
  const recordAdClick = useBiasHistoryStore((s) => s.recordAdClick);
  const getDominantBias = useBiasHistoryStore((s) => s.getDominantBias);

  // Get reels for this bill
  const allReels = getReelsForBill(billId);

  // Apply balanced feed algorithm
  const dominantBias = getDominantBias();
  const balancedReels = getBalancedReels(allReels, dominantBias, 10);

  // Filter out sponsored reels if premium (they'll still show in the carousel position)
  const reels = isPremium
    ? balancedReels.filter((r) => !r.isSponsored)
    : balancedReels;

  // Build carousel items with ad injection
  const carouselItems: Array<
    | { type: 'reel'; data: NewsReel }
    | { type: 'ad'; id: string }
  > = [];

  reels.forEach((reel, index) => {
    carouselItems.push({ type: 'reel', data: reel });

    // Inject ad every 4th position (but not if premium)
    if (!isPremium && (index + 1) % 4 === 0 && index < reels.length - 1) {
      carouselItems.push({ type: 'ad', id: `ad-${index}` });
    }
  });

  const handleWatchTimeUpdate = useCallback(
    (reel: NewsReel, watchTime: number) => {
      // Only record if user watched > 10 seconds
      if (watchTime >= 10) {
        recordView(reel.biasLean, watchTime);
      }
    },
    [recordView]
  );

  const handleReelPress = useCallback(
    (reel: NewsReel) => {
      if (onReelPress) {
        onReelPress(reel);
      } else {
        // Default: try to open video URL
        Linking.openURL(reel.videoUrl).catch(() => {
          console.log('Could not open video URL');
        });
      }
    },
    [onReelPress]
  );

  const handleAdPress = useCallback(
    (adId: string) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      recordAdClick(adId, 'civic_partner');
      // In production, this would navigate to the ad destination
    },
    [recordAdClick]
  );

  const renderItem = useCallback(
    ({
      item,
      index,
    }: {
      item: { type: 'reel'; data: NewsReel } | { type: 'ad'; id: string };
      index: number;
    }) => {
      if (item.type === 'ad') {
        return (
          <CivicPartnerAd
            onPress={() => handleAdPress(item.id)}
            index={index}
          />
        );
      }

      const reel = item.data;
      const isSponsored = reel.isSponsored && !isPremium;

      if (isSponsored) {
        return (
          <SponsoredReelCard
            reel={reel}
            onPress={() => handleReelPress(reel)}
            onWatchTimeUpdate={(time) => handleWatchTimeUpdate(reel, time)}
            index={index}
          />
        );
      }

      return (
        <ReelCard
          reel={reel}
          onPress={() => handleReelPress(reel)}
          onWatchTimeUpdate={(time) => handleWatchTimeUpdate(reel, time)}
          index={index}
        />
      );
    },
    [isPremium, handleReelPress, handleWatchTimeUpdate, handleAdPress]
  );

  if (reels.length === 0) {
    return null;
  }

  return (
    <CarouselDimensionsContext.Provider value={dimensions}>
      <Animated.View entering={FadeIn.duration(500)} className="mb-4">
        <View className="flex-row items-center justify-between px-4 mb-2">
          <Text className="text-white font-semibold text-lg">News Coverage</Text>
          <View className="flex-row items-center">
            <ExternalLink size={14} color="#64748B" />
            <Text className="text-slate-400 text-sm ml-1">
              {reels.length} sources
            </Text>
          </View>
        </View>

        <BiasLegend />

        <FlatList
          data={carouselItems}
          renderItem={renderItem}
          keyExtractor={(item, index) =>
            item.type === 'ad' ? `ad-${billId}-${index}` : `reel-${item.data.id}-${index}`
          }
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16 }}
          snapToInterval={dimensions.cardWidth + dimensions.cardGap}
          decelerationRate="fast"
          style={{ flexGrow: 0 }}
        />

        {/* Balanced Feed Indicator */}
        {dominantBias && (
          <View className="flex-row items-center justify-center mt-3 px-4">
            <View className="bg-slate-800/60 px-3 py-1.5 rounded-full flex-row items-center">
              <Shield size={12} color="#22C55E" />
              <Text className="text-slate-300 text-xs ml-1.5">
                Balanced Feed: 70% preferred, 30% diverse perspectives
              </Text>
            </View>
          </View>
        )}
      </Animated.View>
    </CarouselDimensionsContext.Provider>
  );
}

export default NewsReelCarousel;

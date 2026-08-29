import React, { useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  Image,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
  FadeIn,
  FadeInDown,
  SlideInUp,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import {
  X,
  TrendingUp,
  Award,
  Users,
  ThumbsUp,
  ThumbsDown,
  Flame,
  Crown,
  Medal,
  ChevronRight,
  Landmark,
  FileText,
  Scale,
  UserPlus,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  useGlobalEngagementStore,
  type GlobalEngagementRecord,
  type EngagementLeader,
  type ReferenceType,
} from '@/lib/global-engagement-store';
import { cn } from '@/lib/cn';
import { useResponsive } from '@/lib/useResponsive';

// Format large numbers
function formatCount(num: number): string {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
}

// Get icon for reference type
function getReferenceIcon(type: ReferenceType) {
  switch (type) {
    case 'bill':
      return <Landmark size={16} color="#3B82F6" />;
    case 'executive_order':
      return <FileText size={16} color="#F59E0B" />;
    case 'scotus_case':
      return <Scale size={16} color="#8B5CF6" />;
  }
}

// Get color for reference type
function getReferenceColor(type: ReferenceType): string {
  switch (type) {
    case 'bill':
      return '#3B82F6';
    case 'executive_order':
      return '#F59E0B';
    case 'scotus_case':
      return '#8B5CF6';
  }
}

// Trending Reference Card
function TrendingCard({
  record,
  index,
  onPress,
}: {
  record: GlobalEngagementRecord;
  index: number;
  onPress?: () => void;
}) {
  const totalVotes = record.supportVotes + record.opposeVotes;
  const supportPercent = totalVotes > 0 ? Math.round((record.supportVotes / totalVotes) * 100) : 50;
  const color = getReferenceColor(record.referenceType);

  return (
    <Animated.View entering={FadeInDown.delay(index * 80).springify()}>
      <Pressable
        onPress={() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress?.();
        }}
        className="bg-slate-800/70 rounded-xl p-4 mb-3 border border-slate-700/50"
      >
        {/* Header */}
        <View className="flex-row items-start justify-between mb-3">
          <View className="flex-row items-center flex-1">
            <View
              className="w-8 h-8 rounded-lg items-center justify-center mr-3"
              style={{ backgroundColor: `${color}20` }}
            >
              {getReferenceIcon(record.referenceType)}
            </View>
            <View className="flex-1">
              <Text className="text-white font-semibold text-sm" numberOfLines={2}>
                {record.title}
              </Text>
              <Text className="text-slate-500 text-xs mt-0.5 uppercase">
                {record.referenceId}
              </Text>
            </View>
          </View>
          <View className="flex-row items-center bg-amber-500/20 px-2 py-1 rounded-full">
            <Flame size={12} color="#F59E0B" />
            <Text className="text-amber-500 text-xs font-medium ml-1">
              #{index + 1}
            </Text>
          </View>
        </View>

        {/* Vote Bar */}
        <View className="h-2 bg-slate-700 rounded-full overflow-hidden mb-2">
          <View
            className="h-full bg-emerald-500 rounded-full"
            style={{ width: `${supportPercent}%` }}
          />
        </View>

        {/* Stats Row */}
        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <ThumbsUp size={14} color="#22C55E" />
            <Text className="text-emerald-500 text-sm font-medium ml-1">
              {formatCount(record.supportVotes)}
            </Text>
            <ThumbsDown size={14} color="#EF4444" className="ml-3" />
            <Text className="text-red-500 text-sm font-medium ml-1">
              {formatCount(record.opposeVotes)}
            </Text>
          </View>
          <Text className="text-slate-500 text-xs">
            {formatCount(totalVotes)} total votes
          </Text>
        </View>

        {/* Top Contributors */}
        {record.topContributors.length > 0 && (
          <View className="flex-row items-center mt-3 pt-3 border-t border-slate-700/50">
            <Text className="text-slate-500 text-xs mr-2">Top Leaders:</Text>
            <View className="flex-row items-center flex-1">
              {record.topContributors.slice(0, 3).map((contributor, idx) => (
                <View key={contributor.userId} className="flex-row items-center mr-2">
                  <Image
                    source={{ uri: contributor.avatar }}
                    className="w-5 h-5 rounded-full"
                    style={{ marginLeft: idx > 0 ? -8 : 0, borderWidth: 1, borderColor: '#17362A' }}
                  />
                </View>
              ))}
              {record.topContributors.length > 0 && (
                <Text className="text-slate-400 text-xs">
                  @{record.topContributors[0].username}
                  {record.topContributors.length > 1 && ` +${record.topContributors.length - 1}`}
                </Text>
              )}
            </View>
            <ChevronRight size={14} color="#6E8A7C" />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// One row of the engagement leaderboard
function LeaderCard({
  leader,
  index,
  onFollow,
}: {
  leader: EngagementLeader;
  index: number;
  onFollow?: (userId: string) => void;
}) {
  const rankIcon = index === 0 ? Crown : index === 1 ? Medal : Award;
  const RankIcon = rankIcon;
  const rankColor = index === 0 ? '#F59E0B' : index === 1 ? '#8FA79A' : '#CD7F32';

  return (
    <Animated.View entering={FadeInDown.delay(index * 60).springify()}>
      <View className="flex-row items-center bg-slate-800/50 rounded-xl p-3 mb-2">
        {/* Rank */}
        <View className="w-8 items-center mr-3">
          {index < 3 ? (
            <RankIcon size={20} color={rankColor} />
          ) : (
            <Text className="text-slate-500 font-bold">{index + 1}</Text>
          )}
        </View>

        {/* Avatar */}
        <Image source={{ uri: leader.avatar }} className="w-10 h-10 rounded-full" />

        {/* Info */}
        <View className="flex-1 ml-3">
          <Text className="text-white font-semibold text-sm">{leader.displayName}</Text>
          <Text className="text-slate-500 text-xs">@{leader.username}</Text>
        </View>

        {/* Stats */}
        <View className="items-end mr-3">
          <Text className="text-amber-500 font-bold text-sm">
            {formatCount(leader.totalEngagementDriven)}
          </Text>
          <Text className="text-slate-500 text-xs">engagement</Text>
        </View>

        {/* Follow Button */}
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onFollow?.(leader.userId);
          }}
          className="bg-amber-500 px-3 py-1.5 rounded-full"
        >
          <UserPlus size={14} color="#000" />
        </Pressable>
      </View>
    </Animated.View>
  );
}

// Main Drawer Component
export default function GlobalPulseDrawer({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  // Use responsive hook for dynamic drawer height
  const { height, hp, isTablet, maxContentWidth } = useResponsive();
  const drawerHeight = hp(85); // 85% of screen height

  const translateY = useSharedValue(drawerHeight);

  // Select raw data from store (stable references)
  const engagementRecords = useGlobalEngagementStore((s) => s.engagementRecords);
  const engagementLeadersData = useGlobalEngagementStore((s) => s.engagementLeaders);

  // Compute derived data outside selector to prevent infinite loops
  const trendingReferences = useMemo(() => {
    const records = Object.values(engagementRecords);
    return records
      .sort((a, b) => b.trendingScore - a.trendingScore)
      .slice(0, 5);
  }, [engagementRecords]);

  const engagementLeaders = useMemo(() => {
    return engagementLeadersData.slice(0, 10);
  }, [engagementLeadersData]);

  // Animate drawer
  React.useEffect(() => {
    if (visible) {
      translateY.value = withSpring(0, { damping: 20, stiffness: 90 });
    } else {
      translateY.value = withSpring(drawerHeight, { damping: 20 });
    }
  }, [visible, translateY, drawerHeight]);

  const handleClose = useCallback(() => {
    translateY.value = withSpring(drawerHeight, { damping: 20 }, () => {
      runOnJS(onClose)();
    });
  }, [onClose, translateY, drawerHeight]);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationY > 0) {
        translateY.value = e.translationY;
      }
    })
    .onEnd((e) => {
      if (e.translationY > 150 || e.velocityY > 500) {
        runOnJS(handleClose)();
      } else {
        translateY.value = withSpring(0, { damping: 20 });
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  if (!visible) return null;

  // For tablets, center the drawer with max width
  const drawerWidth = isTablet ? Math.min(maxContentWidth, 500) : '100%';
  const drawerHorizontalPosition = isTablet ? { left: '50%', marginLeft: -Math.min(maxContentWidth, 500) / 2 } : { left: 0, right: 0 };

  return (
    <View className="absolute inset-0" style={{ zIndex: 1000 }}>
      {/* Backdrop */}
      <Pressable onPress={handleClose} className="absolute inset-0">
        <Animated.View
          entering={FadeIn.duration(200)}
          className="flex-1 bg-black/60"
        />
      </Pressable>

      {/* Drawer */}
      <GestureDetector gesture={panGesture}>
        <Animated.View
          style={[
            {
              position: 'absolute',
              bottom: 0,
              width: drawerWidth,
              ...(isTablet ? { left: '50%', transform: [{ translateX: -Math.min(maxContentWidth, 500) / 2 }] } : { left: 0, right: 0 }),
              height: drawerHeight,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              overflow: 'hidden',
            },
            animatedStyle,
          ]}
        >
          <LinearGradient
            colors={['#17362A', '#0C1D18']}
            style={{ flex: 1 }}
          >
            <SafeAreaView edges={['bottom']} className="flex-1">
              {/* Handle */}
              <View className="items-center pt-3 pb-2">
                <View className="w-10 h-1 bg-slate-600 rounded-full" />
              </View>

              {/* Header */}
              <View className="flex-row items-center justify-between px-5 pb-4">
                <View className="flex-row items-center">
                  <View className="w-10 h-10 rounded-full bg-amber-500/20 items-center justify-center mr-3">
                    <TrendingUp size={20} color="#F59E0B" />
                  </View>
                  <View>
                    <Text className="text-white font-bold text-xl">Global Pulse</Text>
                    <Text className="text-slate-400 text-sm">Real-time civic engagement</Text>
                  </View>
                </View>
                <Pressable
                  onPress={handleClose}
                  className="w-8 h-8 rounded-full bg-slate-800 items-center justify-center"
                >
                  <X size={18} color="#8FA79A" />
                </Pressable>
              </View>

              <ScrollView
                className="flex-1"
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
                showsVerticalScrollIndicator={false}
              >
                {/* Trending Section */}
                <View className="mb-6">
                  <View className="flex-row items-center mb-4">
                    <Flame size={18} color="#F59E0B" />
                    <Text className="text-white font-semibold text-lg ml-2">
                      Trending Now
                    </Text>
                    <View className="ml-auto bg-amber-500/20 px-2 py-0.5 rounded-full">
                      <Text className="text-amber-500 text-xs font-medium">LIVE</Text>
                    </View>
                  </View>

                  {trendingReferences.map((record, idx) => (
                    <TrendingCard key={record.referenceId} record={record} index={idx} />
                  ))}
                </View>

                {/* Most engagement driven */}
                <View>
                  <View className="flex-row items-center mb-4">
                    <Crown size={18} color="#F59E0B" />
                    <Text className="text-white font-semibold text-lg ml-2">
                      Most Engagement Driven
                    </Text>
                    <Text className="text-slate-500 text-xs ml-auto">
                      Top engagement drivers
                    </Text>
                  </View>

                  {engagementLeaders.map((leader, idx) => (
                    <LeaderCard
                      key={leader.userId}
                      leader={leader}
                      index={idx}
                      onFollow={(userId) => {
                        // Handle follow action
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                      }}
                    />
                  ))}
                </View>
              </ScrollView>
            </SafeAreaView>
          </LinearGradient>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

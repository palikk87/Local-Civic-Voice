import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  ChevronLeft,
  Crown,
  Scale,
  Eye,
  Shield,
  Award,
  Scroll,
  CheckCircle2,
  Feather,
  BookOpen,
  ChevronDown,
} from 'lucide-react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withRepeat,
  withSequence,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { BILL_OF_RIGHTS, getAmendmentEnforcement, type Article } from '@/lib/bill-of-rights';
import { cn } from '@/lib/cn';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

// Icon mapping
const ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  Crown,
  Scale,
  Eye,
  Shield,
  Award,
};

function ArticleIcon({ iconName, color }: { iconName: string; color: string }) {
  const IconComponent = ICON_MAP[iconName] || Crown;
  return <IconComponent size={24} color={color} />;
}

interface ArticleCardProps {
  article: Article;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function ArticleCard({ article, index, isExpanded, onToggle }: ArticleCardProps) {
  const scale = useSharedValue(1);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    scale.value = withSequence(
      withSpring(0.98, { damping: 15 }),
      withSpring(1, { damping: 15 })
    );
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onToggle();
  };

  // Different accent colors for each article
  const accentColors = [
    '#F59E0B', // Gold - Sovereignty
    '#3B82F6', // Blue - Algorithmic Neutrality
    '#22C55E', // Green - Transparency
    '#8B5CF6', // Purple - Privacy
    '#EF4444', // Red - Leadership
  ];

  const color = accentColors[index] ?? '#F59E0B';

  return (
    <Animated.View entering={FadeInDown.delay(index * 100 + 300).springify()}>
      <AnimatedPressable onPress={handlePress} style={animStyle}>
        <View className="mb-4 overflow-hidden rounded-2xl border border-slate-700/50">
          <LinearGradient
            colors={['#17362A', '#0C1D18']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{ padding: 16 }}
          >
            {/* Article Header */}
            <View className="flex-row items-start">
              <View
                className="w-12 h-12 rounded-full items-center justify-center mr-4"
                style={{ backgroundColor: `${color}20` }}
              >
                <ArticleIcon iconName={article.icon} color={color} />
              </View>
              <View className="flex-1">
                <Text className="text-slate-400 text-xs font-semibold tracking-widest mb-1">
                  AMENDMENT {article.number}
                </Text>
                <Text className="text-white font-bold text-lg leading-tight">
                  {article.title}
                </Text>
                <Text className="text-slate-400 text-sm italic mt-0.5">
                  {article.subtitle}
                </Text>
              </View>
            </View>

            {/* Article Content */}
            <View className="mt-4">
              <Text
                className="text-slate-300 text-base leading-6"
                numberOfLines={isExpanded ? undefined : 3}
              >
                {article.content}
              </Text>
            </View>

            {/*
              WHAT WENT. Four hand-typed bullets under "ENFORCED PRINCIPLES",
              each with a green tick. Two of the twenty were false — "Encrypted
              personal data" and "Trust Score determines influence" — and none
              of the twenty was checked by anything. A tick that cannot fail is
              decoration.

              What is left is the one badge that has to be earned: an Amendment
              may claim enforcement only if a test under backend/tests names it.
              That is Article VI, and constitution-enforced.test.ts is what
              makes it true.
            */}
            {isExpanded && (
              <Animated.View
                entering={FadeIn.duration(300)}
                className="mt-4 pt-4 border-t border-slate-700/50"
              >
                {article.enforcedInCode ? (
                  <View className="flex-row items-center">
                    <CheckCircle2 size={14} color={color} />
                    <Text className="text-sm ml-2" style={{ color }}>
                      Enforced in code
                    </Text>
                  </View>
                ) : (
                  <Text className="text-slate-400 text-sm">
                    Not yet enforced in code
                  </Text>
                )}
              </Animated.View>
            )}

            {/* Expand indicator */}
            <Pressable onPress={handlePress} className="mt-3">
              <Text className="text-center text-sm" style={{ color }}>
                {isExpanded ? 'Show less' : 'Read more'}
              </Text>
            </Pressable>
          </LinearGradient>
        </View>
      </AnimatedPressable>
    </Animated.View>
  );
}

export default function BillOfRightsScreen() {
  const router = useRouter();
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);
  const enforcement = getAmendmentEnforcement();

  const handleToggle = (articleId: string) => {
    setExpandedArticle(prev => prev === articleId ? null : articleId);
  };

  return (
    <View className="flex-1 bg-slate-900">
      {/* Parchment-style background */}
      <LinearGradient
        colors={['#1a1a2e', '#16213e', '#0f0f23']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView edges={['top']} className="flex-1">
        {/* Header */}
        <View className="px-4 py-3 border-b border-slate-800">
          <View className="flex-row items-center">
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.back();
              }}
              className="w-10 h-10 items-center justify-center rounded-full bg-slate-800/60"
            >
              <ChevronLeft size={24} color="#fff" />
            </Pressable>
            <View className="flex-1 items-center">
              <Text className="text-white font-bold text-lg">Bill of Rights</Text>
              <Text className="text-slate-400 text-xs">
                v{BILL_OF_RIGHTS.version} • Effective {new Date(BILL_OF_RIGHTS.effectiveDate).toLocaleDateString()}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/constitution');
              }}
              className="w-10 h-10 items-center justify-center rounded-full bg-slate-800/60"
            >
              <BookOpen size={20} color="#8FA79A" />
            </Pressable>
          </View>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          showsVerticalScrollIndicator={false}
        >
          {/* Decorative Header */}
          <Animated.View
            entering={FadeInUp.duration(600)}
            className="items-center mb-6"
          >
            <View className="w-16 h-16 rounded-full bg-amber-500/20 items-center justify-center mb-4">
              <Scroll size={32} color="#F59E0B" />
            </View>
            <Text className="text-amber-500 text-xs font-bold tracking-[4px] mb-2">
              THE AYE & NAY
            </Text>
            <Text className="text-white text-2xl font-bold text-center">
              Bill of Rights
            </Text>
            <Text className="text-slate-400 text-sm text-center mt-1 italic">
              Amendments I–V of the Constitution
            </Text>
          </Animated.View>

          {/* Preamble */}
          <Animated.View
            entering={FadeInDown.delay(200).springify()}
            className="mb-6"
          >
            <View className="rounded-2xl overflow-hidden border border-amber-500/30">
              <LinearGradient
                colors={['#78350f', '#451a03']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 20 }}
              >
                <View className="flex-row items-center mb-3">
                  <Feather size={18} color="#FCD34D" />
                  <Text className="text-amber-300 text-xs font-bold tracking-widest ml-2">
                    PART OF THE CONSTITUTION
                  </Text>
                </View>
                <Text className="text-amber-100 text-base leading-7 italic">
                  "{BILL_OF_RIGHTS.preamble}"
                </Text>
              </LinearGradient>
            </View>
          </Animated.View>

          {/* Divider */}
          <Animated.View
            entering={FadeIn.delay(300)}
            className="flex-row items-center justify-center mb-6"
          >
            <View className="h-px flex-1 bg-slate-700" />
            <View className="mx-4">
              <Text className="text-slate-500 text-xs font-semibold tracking-widest">
                AMENDMENTS
              </Text>
            </View>
            <View className="h-px flex-1 bg-slate-700" />
          </Animated.View>

          {/* Articles */}
          {BILL_OF_RIGHTS.articles.map((article, index) => (
            <ArticleCard
              key={article.id}
              article={article}
              index={index}
              isExpanded={expandedArticle === article.id}
              onToggle={() => handleToggle(article.id)}
            />
          ))}

          {/* Link to Constitution */}
          <Animated.View
            entering={FadeInUp.delay(800).springify()}
            className="mt-4"
          >
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/constitution');
              }}
              className="rounded-2xl overflow-hidden border border-slate-600/30"
            >
              <LinearGradient
                colors={['#2C4A3C', '#17362A']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 16 }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <BookOpen size={24} color="#8FA79A" />
                    <View className="ml-3">
                      <Text className="text-slate-100 font-semibold">
                        Constitution
                      </Text>
                      <Text className="text-slate-400 text-xs">
                        The supreme law that establishes these rights
                      </Text>
                    </View>
                  </View>
                  <ChevronDown size={20} color="#8FA79A" style={{ transform: [{ rotate: '-90deg' }] }} />
                </View>
              </LinearGradient>
            </Pressable>
          </Animated.View>

          {/* Footer Seal */}
          <Animated.View
            entering={FadeInUp.delay(800).springify()}
            className="items-center mt-6 pt-6 border-t border-slate-700/50"
          >
            <View className="w-20 h-20 rounded-full bg-slate-800/60 border-2 border-amber-500/30 items-center justify-center mb-3">
              <Shield size={36} color="#F59E0B" />
            </View>
            {/*
              This read "These rights are enshrined in code / and cannot be
              circumvented by platform operators" — a claim no reader could
              check and no test could break. It is a count now, and it is
              allowed to be a number smaller than five.
            */}
            <Text className="text-slate-400 text-sm text-center">
              {enforcement.enforced} of {enforcement.total} Amendments are enforced in code
            </Text>
            <Text className="text-slate-500 text-xs text-center mt-1">
              each one proven by a test named for it, and counted here rather than typed
            </Text>
            {enforcement.outstanding.map((item) => (
              <Text key={item.article} className="text-amber-400/80 text-xs text-center mt-1">
                Not yet enforced: Amendment {item.article} — {item.section}
              </Text>
            ))}
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

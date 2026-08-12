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
  Activity,
  Droplets,
  Eye,
  Scale,
  RotateCcw,
  BookOpen,
  CheckCircle2,
  Code,
  ChevronDown,
  ChevronUp,
  Scroll,
  Shield,
} from 'lucide-react-native';
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import {
  CONSTITUTION,
  type ConstitutionalArticle,
  type ConstitutionalSection,
  getConstitutionalCompliance,
} from '@/lib/constitution';
import { cn } from '@/lib/cn';

// Icon mapping
const ICON_MAP: Record<string, React.ComponentType<{ size: number; color: string }>> = {
  Activity,
  Droplets,
  Eye,
  Scale,
  RotateCcw,
};

function ArticleIcon({ iconName, color }: { iconName: string; color: string }) {
  const IconComponent = ICON_MAP[iconName] || Activity;
  return <IconComponent size={24} color={color} />;
}

// Article accent colors
const ARTICLE_COLORS: Record<string, string> = {
  I: '#EF4444', // Red - Supremacy of Pulse
  II: '#3B82F6', // Blue - Liquid Sovereignty
  III: '#22C55E', // Green - Transparency
  IV: '#8B5CF6', // Purple - Separation of Powers
  V: '#F59E0B', // Amber - Self-Correction
};

interface SectionCardProps {
  section: ConstitutionalSection;
  color: string;
}

function SectionCard({ section, color }: SectionCardProps) {
  return (
    <View className="mb-3 ml-4 pl-4 border-l-2" style={{ borderColor: `${color}40` }}>
      <Text className="text-white font-semibold text-sm mb-1">
        {section.title}
      </Text>
      <Text className="text-slate-300 text-sm leading-5">
        {section.content}
      </Text>
      {section.enforcedInCode && (
        <View className="flex-row items-center mt-2">
          <Code size={12} color={color} />
          <Text className="text-xs ml-1" style={{ color }}>
            Enforced in code
          </Text>
        </View>
      )}
    </View>
  );
}

interface ArticleCardProps {
  article: ConstitutionalArticle;
  index: number;
  isExpanded: boolean;
  onToggle: () => void;
}

function ArticleCard({ article, index, isExpanded, onToggle }: ArticleCardProps) {
  const color = ARTICLE_COLORS[article.number] ?? '#F59E0B';

  return (
    <Animated.View entering={FadeInDown.delay(index * 100 + 300).springify()}>
      <View className="mb-4 overflow-hidden rounded-2xl border border-slate-700/50">
        <LinearGradient
          colors={['#1E293B', '#0F172A']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={{ padding: 16 }}
        >
          {/* Article Header */}
          <Pressable
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              onToggle();
            }}
            className="flex-row items-start"
          >
            <View
              className="w-12 h-12 rounded-full items-center justify-center mr-4"
              style={{ backgroundColor: `${color}20` }}
            >
              <ArticleIcon iconName={article.icon} color={color} />
            </View>
            <View className="flex-1">
              <Text className="text-slate-400 text-xs font-semibold tracking-widest mb-1">
                ARTICLE {article.number}
              </Text>
              <Text className="text-white font-bold text-lg leading-tight">
                {article.title}
              </Text>
              <Text className="text-slate-400 text-xs mt-1">
                {article.sections.length} section{article.sections.length > 1 ? 's' : ''}
              </Text>
            </View>
            {isExpanded ? (
              <ChevronUp size={20} color="#64748B" />
            ) : (
              <ChevronDown size={20} color="#64748B" />
            )}
          </Pressable>

          {/* Sections (shown when expanded) */}
          {isExpanded && (
            <Animated.View
              entering={FadeIn.duration(300)}
              className="mt-4 pt-4 border-t border-slate-700/50"
            >
              {article.sections.map((section) => (
                <SectionCard key={section.id} section={section} color={color} />
              ))}
            </Animated.View>
          )}
        </LinearGradient>
      </View>
    </Animated.View>
  );
}

function ComplianceStatus() {
  const compliance = getConstitutionalCompliance();
  const compliantCount = compliance.filter(c => c.isCompliant).length;

  return (
    <Animated.View
      entering={FadeInDown.delay(800).springify()}
      className="mt-4 rounded-2xl overflow-hidden border border-emerald-700/30"
    >
      <LinearGradient
        colors={['#064e3b', '#022c22']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={{ padding: 16 }}
      >
        <View className="flex-row items-center mb-3">
          <CheckCircle2 size={20} color="#22C55E" />
          <Text className="text-emerald-100 font-semibold text-lg ml-2">
            Constitutional Compliance
          </Text>
        </View>
        <Text className="text-emerald-300/80 text-sm mb-3">
          {compliantCount} of {compliance.length} provisions are enforced in code
        </Text>
        <View className="h-2 bg-emerald-900/50 rounded-full overflow-hidden">
          <View
            className="h-full bg-emerald-500 rounded-full"
            style={{ width: `${(compliantCount / compliance.length) * 100}%` }}
          />
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

export default function ConstitutionScreen() {
  const router = useRouter();
  const [expandedArticle, setExpandedArticle] = useState<string | null>(null);

  const handleToggle = (articleId: string) => {
    setExpandedArticle(prev => prev === articleId ? null : articleId);
  };

  return (
    <View className="flex-1 bg-slate-900">
      {/* Official document background */}
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
              <Text className="text-white font-bold text-lg">Constitution</Text>
              <Text className="text-slate-400 text-xs">
                v{CONSTITUTION.version} • Effective {new Date(CONSTITUTION.effectiveDate).toLocaleDateString()}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/bill-of-rights');
              }}
              className="w-10 h-10 items-center justify-center rounded-full bg-amber-900/40"
            >
              <Scroll size={20} color="#FCD34D" />
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
            <View className="w-20 h-20 rounded-full bg-slate-800/60 border-2 border-slate-600 items-center justify-center mb-4">
              <BookOpen size={36} color="#94A3B8" />
            </View>
            <Text className="text-slate-400 text-xs font-bold tracking-[4px] mb-2">
              THE CIVIL VOICE
            </Text>
            <Text className="text-white text-2xl font-bold text-center">
              Constitution
            </Text>
            <Text className="text-slate-400 text-sm text-center mt-1 italic">
              The Supreme Law of the Platform
            </Text>
          </Animated.View>

          {/* Preamble */}
          <Animated.View
            entering={FadeInDown.delay(200).springify()}
            className="mb-6"
          >
            <View className="rounded-2xl overflow-hidden border border-slate-600/30">
              <LinearGradient
                colors={['#334155', '#1e293b']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 20 }}
              >
                <Text className="text-slate-300 text-xs font-bold tracking-widest mb-3">
                  PREAMBLE
                </Text>
                <Text className="text-slate-100 text-base leading-7 italic">
                  "{CONSTITUTION.preamble}"
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
                ARTICLES
              </Text>
            </View>
            <View className="h-px flex-1 bg-slate-700" />
          </Animated.View>

          {/* Articles */}
          {CONSTITUTION.articles.map((article, index) => (
            <ArticleCard
              key={article.id}
              article={article}
              index={index}
              isExpanded={expandedArticle === article.id}
              onToggle={() => handleToggle(article.id)}
            />
          ))}

          {/* Compliance Status */}
          <ComplianceStatus />

          {/* Link to Bill of Rights */}
          <Animated.View
            entering={FadeInUp.delay(900).springify()}
            className="mt-6"
          >
            <Pressable
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push('/bill-of-rights');
              }}
              className="rounded-2xl overflow-hidden border border-amber-700/30"
            >
              <LinearGradient
                colors={['#78350f', '#451a03']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{ padding: 16 }}
              >
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center">
                    <Shield size={24} color="#FCD34D" />
                    <View className="ml-3">
                      <Text className="text-amber-100 font-semibold">
                        Bill of Rights
                      </Text>
                      <Text className="text-amber-300/70 text-xs">
                        Individual protections under this Constitution
                      </Text>
                    </View>
                  </View>
                  <ChevronDown size={20} color="#FCD34D" style={{ transform: [{ rotate: '-90deg' }] }} />
                </View>
              </LinearGradient>
            </Pressable>
          </Animated.View>

          {/* Footer Seal */}
          <Animated.View
            entering={FadeInUp.delay(1000).springify()}
            className="items-center mt-8 pt-6 border-t border-slate-700/50"
          >
            <View className="w-16 h-16 rounded-full bg-slate-800/60 border-2 border-slate-600 items-center justify-center mb-3">
              <Scale size={28} color="#94A3B8" />
            </View>
            <Text className="text-slate-400 text-sm text-center">
              All code is subordinate to this Constitution
            </Text>
            <Text className="text-slate-500 text-xs text-center mt-1">
              The Will of the People is the supreme authority
            </Text>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

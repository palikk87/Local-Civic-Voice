import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  FlatList,
  Linking,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  Search,
  Landmark,
  Layers,
  FileText,
  Scale,
  ChevronRight,
  ExternalLink,
  X,
  Sparkles,
  Share2,
  Clock,
  AlertCircle,
  CheckCircle,
  FileWarning,
  RefreshCw,
} from 'lucide-react-native';
import Animated, {
  FadeInDown,
  FadeIn,
  FadeOut,
  SlideInRight,
  SlideOutRight,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { GestureDetector, Gesture } from 'react-native-gesture-handler';
import * as Haptics from 'expo-haptics';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import {
  searchGovernment,
  searchAllBranches,
  type GovernmentSearchResult,
  type SearchBranch,
} from '@/lib/government-api';
import { useLibraryBrief } from '@/lib/use-library-brief';
import { CitizensBriefCard } from '@/components/CitizensBrief';
import { useResponsive } from '@/lib/useResponsive';
import CreatePostModal from '@/components/CreatePostModal';
import type {
  GovernmentReference,
  ReferenceType,
} from '@/components/ReferenceSearchModal';

// ===========================================
// TYPES
// ===========================================

/**
 * 'all' is the default, and the reason is a bug this fixes.
 *
 * The Library opened on Congress and searched only the selected branch, so a
 * reader typing "immigration" got no executive orders and no court cases — two
 * thirds of the platform's own subject matter, excluded by a default nobody
 * chose and with nothing on screen to say so. A branch tab should NARROW a
 * search somebody asked to narrow, not quietly define it.
 *
 * Web twin: apps/web/src/lib/library.ts (LibraryBranch).
 */
type LibraryTab = 'all' | 'legislative' | 'executive' | 'judicial';

/** A search result's branch, in the vocabulary a reference uses. */
const REFERENCE_TYPE_OF: Record<SearchBranch, ReferenceType> = {
  legislative: 'bill',
  executive: 'executive_order',
  judicial: 'scotus_case',
};

// ===========================================
// TAB SELECTOR
// ===========================================

function LibraryTabSelector({
  activeTab,
  onChangeTab,
}: {
  activeTab: LibraryTab;
  onChangeTab: (tab: LibraryTab) => void;
}) {
  const tabs: { id: LibraryTab; label: string; color: string; icon: 'layers' | 'landmark' | 'file' | 'scale' }[] = [
    { id: 'all', label: 'All', color: '#F59E0B', icon: 'layers' },
    { id: 'legislative', label: 'Congress', color: '#3B82F6', icon: 'landmark' },
    { id: 'executive', label: 'Executive', color: '#F59E0B', icon: 'file' },
    { id: 'judicial', label: 'Judicial', color: '#8B5CF6', icon: 'scale' },
  ];

  return (
    <View className="flex-row px-4 mb-4">
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        const iconColor = isActive ? '#fff' : tab.color;

        return (
          <Pressable
            key={tab.id}
            onPress={() => {
              Haptics.selectionAsync();
              onChangeTab(tab.id);
            }}
            className={cn(
              'flex-1 flex-row items-center justify-center py-3 rounded-xl mx-1',
              isActive ? 'border-transparent' : 'bg-slate-800/60 border border-slate-700/50'
            )}
          >
            {isActive && (
              <LinearGradient
                colors={[tab.color, `${tab.color}AA`]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  borderRadius: 12,
                }}
              />
            )}
            {tab.icon === 'layers' && <Layers size={18} color={iconColor} />}
            {tab.icon === 'landmark' && <Landmark size={18} color={iconColor} />}
            {tab.icon === 'file' && <FileText size={18} color={iconColor} />}
            {tab.icon === 'scale' && <Scale size={18} color={iconColor} />}
            <Text
              className={cn(
                'ml-2 font-semibold text-sm',
                isActive ? 'text-white' : 'text-slate-400'
              )}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ===========================================
// SEARCH BAR
// ===========================================

function SearchBar({
  value,
  onChangeText,
  onSubmit,
  placeholder,
  isLoading,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  placeholder: string;
  isLoading: boolean;
}) {
  return (
    <View className="px-4 mb-4">
      <View className="flex-row items-center gap-2">
      <View className="flex-1 flex-row items-center bg-slate-800 rounded-xl px-4 py-3 border border-slate-700/50">
        {isLoading ? (
          <ActivityIndicator size="small" color="#F59E0B" />
        ) : (
          <Search size={18} color="#6E8A7C" />
        )}
        <TextInput
          placeholder={placeholder}
          placeholderTextColor="#6E8A7C"
          value={value}
          onChangeText={onChangeText}
          onSubmitEditing={onSubmit}
          returnKeyType="search"
          className="flex-1 text-white ml-3 text-base"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {value.length > 0 && (
          <Pressable
            onPress={() => onChangeText('')}
            className="p-1"
            hitSlop={8}
          >
            <X size={16} color="#6E8A7C" />
          </Pressable>
        )}
      </View>

      {/* The action, visible and pressable. The keyboard's search key does the
          same thing, but a control you can see beats one you have to know
          about — and until this existed there was no way to ask at all. */}
      <Pressable
        onPress={onSubmit}
        disabled={value.trim().length < 2 || isLoading}
        className={`rounded-xl px-5 py-3 ${
          value.trim().length < 2 || isLoading ? 'bg-amber-500/40' : 'bg-amber-500'
        }`}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color="#0C1D18" />
        ) : (
          <Text className="text-slate-900 font-bold text-base">Search</Text>
        )}
      </Pressable>
      </View>

      <Text className="text-slate-500 text-xs mt-2 ml-1">
        {value.trim().length === 1
          ? 'Type at least two characters.'
          : "Type what you're looking for in everyday language, then press Search."}
      </Text>
    </View>
  );
}

// ===========================================
// STATUS LABEL BADGE
// ===========================================

const statusLabelColors: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: '#22C55E20', text: '#22C55E', label: 'Active' },
  proposed: { bg: '#3B82F620', text: '#3B82F6', label: 'Proposed' },
  repealed: { bg: '#EF444420', text: '#EF4444', label: 'Repealed' },
  landmark: { bg: '#F59E0B20', text: '#F59E0B', label: 'Landmark' },
  pending: { bg: '#8B5CF620', text: '#8B5CF6', label: 'Pending' },
};

// ===========================================
// RESULT CARD
// ===========================================

function ResultCard({
  result,
  index,
  onPress,
}: {
  result: GovernmentSearchResult;
  index: number;
  onPress: () => void;
}) {
  const branchColors: Record<SearchBranch, string> = {
    legislative: '#3B82F6',
    executive: '#F59E0B',
    judicial: '#8B5CF6',
  };

  const branchColor = branchColors[result.branch];

  // Get friendly name and bill number from metadata
  const friendlyName = (result.metadata?.friendlyName as string) ?? null;
  const congressNumber = (result.metadata?.congressNumber as string) ?? null;
  const hasFriendlyName = friendlyName && friendlyName !== result.shortTitle;

  // Get status label styling
  const statusStyle = statusLabelColors[result.statusLabel] ?? statusLabelColors.proposed;

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 50).springify()}
      className="mx-4 mb-3"
    >
      <Pressable
        onPress={onPress}
        className="bg-slate-800/70 rounded-xl p-4 border border-slate-700/50 active:opacity-80"
      >
        <View className="flex-row items-start justify-between mb-2">
          <View className="flex-row items-center flex-wrap flex-1">
            <View
              className="px-2 py-0.5 rounded-full mr-2 mb-1"
              style={{ backgroundColor: `${branchColor}30` }}
            >
              <Text style={{ color: branchColor }} className="text-xs font-medium capitalize">
                {result.branch}
              </Text>
            </View>
            {/* Status Label Badge */}
            <View
              className="px-2 py-0.5 rounded-full mr-2 mb-1"
              style={{ backgroundColor: statusStyle.bg }}
            >
              <Text style={{ color: statusStyle.text }} className="text-xs font-semibold">
                {statusStyle.label}
              </Text>
            </View>
            {congressNumber && (
              <View className="bg-slate-700 px-2 py-0.5 rounded-full mr-2 mb-1">
                <Text className="text-slate-300 text-xs font-mono">
                  {congressNumber}
                </Text>
              </View>
            )}
            {result.category && (
              <View className="bg-slate-700 px-2 py-0.5 rounded-full mr-2 mb-1">
                <Text className="text-slate-300 text-xs capitalize">
                  {result.category.replace('_', ' ')}
                </Text>
              </View>
            )}
          </View>
          <View className="flex-row items-center">
            <Clock size={10} color="#6E8A7C" />
            <Text className="text-slate-500 text-xs ml-1">
              {new Date(result.date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })}
            </Text>
          </View>
        </View>

        {/* Show friendly name prominently if available */}
        {hasFriendlyName ? (
          <>
            <Text className="text-amber-400 font-bold text-base mb-1" numberOfLines={1}>
              {friendlyName}
            </Text>
            <Text className="text-slate-300 text-sm mb-2" numberOfLines={2}>
              {result.title}
            </Text>
          </>
        ) : (
          <Text className="text-white font-semibold text-base mb-1" numberOfLines={2}>
            {result.shortTitle}
          </Text>
        )}

        <Text className="text-slate-400 text-sm mb-3" numberOfLines={2}>
          {result.status}
        </Text>

        <View className="flex-row items-center justify-between">
          <View className="flex-row items-center">
            <ExternalLink size={12} color="#6E8A7C" />
            <Text className="text-slate-500 text-xs ml-1">
              Official Source
            </Text>
          </View>
          <ChevronRight size={16} color="#6E8A7C" />
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ===========================================
// SLIDE-OVER PREVIEW (Citizen's Brief)
// ===========================================

function SlideOverPreview({
  result,
  onClose,
  onShare,
}: {
  result: GovernmentSearchResult;
  onClose: () => void;
  /** Hands back the resolved reference id. The caller opens the composer. */
  onShare: (referenceId: string) => void;
}) {
  const translateX = useSharedValue(0);

  // Use responsive hook for preview width
  const { wp, isTablet, maxContentWidth } = useResponsive();
  const previewWidth = isTablet ? Math.min(maxContentWidth, 450) : wp(85);

  // The brief is written on the SERVER from the entire official text and stored
  // on the master reference — once, when a reader asks for it. This panel offers
  // the button and shows the result; when no official source has the text, it
  // says so rather than showing a guess.
  const {
    referenceId,
    brief,
    reason,
    state: briefState,
    isRequesting,
    isResolving,
    isUnidentifiable,
    request: requestBrief,
  } = useLibraryBrief(result);
  /*
   * SHARING NO LONGER WAITS FOR A BRIEF.
   *
   * This was `!!referenceId && !!brief`, so a reader who found a law in the
   * Library could not say "that one matters to me" until an AI had written
   * about it — and the caption under the greyed-out button told them so.
   * Sharing a law and paying to summarize it are different acts. The record
   * exists as soon as the document is identified, which is what a post
   * attaches to. Web twin: apps/web/src/components/library/CitizensBriefPanel.tsx.
   */
  const canShare = !!referenceId;
  // Resolving is a step the reader did not ask for and cannot act on, so the
  // button stays busy through it rather than looking ready to press before
  // there is anything to press it against.
  const briefBusy = isRequesting || isResolving;

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      if (e.translationX > 0) {
        translateX.value = e.translationX;
      }
    })
    .onEnd((e) => {
      if (e.translationX > 100) {
        onClose();
      } else {
        translateX.value = withSpring(0);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const branchColors: Record<SearchBranch, string> = {
    legislative: '#3B82F6',
    executive: '#F59E0B',
    judicial: '#8B5CF6',
  };

  const branchLabels: Record<SearchBranch, string> = {
    legislative: 'Congressional Bill',
    executive: 'Executive Order',
    judicial: 'Court Case',
  };

  return (
    <Animated.View
      entering={SlideInRight.springify()}
      exiting={SlideOutRight.springify()}
      className="absolute top-0 right-0 bottom-0 bg-slate-900 border-l border-slate-700"
      style={{ width: previewWidth }}
    >
      <GestureDetector gesture={panGesture}>
        <Animated.View style={[{ flex: 1 }, animatedStyle]}>
          <SafeAreaView edges={['top']} className="flex-1">
            {/* Header */}
            <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-800">
              <View className="flex-row items-center">
                <View
                  className="w-2 h-2 rounded-full mr-2"
                  style={{ backgroundColor: branchColors[result.branch] }}
                />
                <Text className="text-slate-400 text-sm">
                  {branchLabels[result.branch]}
                </Text>
              </View>
              <Pressable
                onPress={onClose}
                className="p-2 bg-slate-800 rounded-full"
                hitSlop={8}
              >
                <X size={16} color="#8FA79A" />
              </Pressable>
            </View>

            {/* Content */}
            <View className="flex-1 px-4 py-4">
              {/* Show friendly name if available */}
              {typeof result.metadata?.friendlyName === 'string' && result.metadata.friendlyName !== result.shortTitle && (
                <Text className="text-amber-400 font-bold text-xl mb-1">
                  {result.metadata.friendlyName}
                </Text>
              )}
              <Text className="text-white font-bold text-lg mb-2" numberOfLines={3}>
                {result.title}
              </Text>

              <View className="flex-row items-center mb-4 flex-wrap">
                {typeof result.metadata?.congressNumber === 'string' && (
                  <View className="bg-blue-500/20 px-2 py-1 rounded-full mr-2 mb-1">
                    <Text className="text-blue-400 text-xs font-mono">
                      {result.metadata.congressNumber}
                    </Text>
                  </View>
                )}
                {result.category && (
                  <View className="bg-slate-800 px-2 py-1 rounded-full mr-2 mb-1">
                    <Text className="text-slate-300 text-xs capitalize">
                      {result.category.replace('_', ' ')}
                    </Text>
                  </View>
                )}
                <Text className="text-slate-500 text-xs">
                  {new Date(result.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </Text>
              </View>

              {/* Status */}
              <View className="bg-slate-800/50 rounded-lg p-3 mb-4">
                <Text className="text-slate-400 text-xs font-medium mb-1">STATUS</Text>
                <Text className="text-white text-sm">{result.status}</Text>
              </View>

              {/* Citizen's Brief */}
              {isUnidentifiable ? (
                <View className="bg-slate-800/50 rounded-lg p-4 mb-4 border border-slate-700">
                  <View className="flex-row items-center mb-2">
                    <FileWarning size={16} color="#8FA79A" />
                    <Text className="text-slate-400 font-semibold text-sm ml-2">
                      BRIEF UNAVAILABLE
                    </Text>
                  </View>
                  <Text className="text-slate-300 text-sm leading-6">
                    This record can't be matched to an official document yet, so there's nothing
                    to read the law from.
                  </Text>
                </View>
              ) : (
                <View className="mb-4">
                  <CitizensBriefCard
                    state={briefState}
                    brief={brief}
                    reason={reason}
                    isRequesting={briefBusy}
                    onRequest={requestBrief}
                  />
                </View>
              )}

              {/* Source Link */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  Linking.openURL(result.sourceUrl);
                }}
                className="flex-row items-center justify-center bg-slate-800 rounded-lg py-3 mb-4"
              >
                <ExternalLink size={16} color="#3B82F6" />
                <Text className="text-blue-400 font-medium ml-2">View Official Source</Text>
              </Pressable>
            </View>

            {/* Share.
                IT DOES NOT POST FOR YOU ANY MORE. This used to publish
                immediately, with the AI's summary as the body of the post and
                a question appended underneath, over the reader's name — so
                somebody who pressed "Share to Feed" found words on their own
                timeline that they had not written and had not seen in a
                composer. It opens the composer with the law attached and
                waits. Web twin does the same through /timeline?share=<id>. */}
            <View className="px-4 pb-6">
              <Pressable
                onPress={() => {
                  if (referenceId) onShare(referenceId);
                }}
                disabled={!canShare}
                className={cn(
                  'flex-row items-center justify-center py-4 rounded-xl',
                  !canShare ? 'bg-amber-500/50' : 'bg-amber-500'
                )}
              >
                <Share2 size={18} color="#000" />
                <Text className="text-slate-900 font-bold text-base ml-2">
                  Share to my timeline
                </Text>
              </Pressable>
              <Text className="text-slate-500 text-xs text-center mt-2">
                {canShare
                  ? 'Opens the composer with this law attached. The words are yours.'
                  : 'Identifying this document at its official source…'}
              </Text>
            </View>
          </SafeAreaView>
        </Animated.View>
      </GestureDetector>
    </Animated.View>
  );
}

// ===========================================
// EMPTY STATE
// ===========================================

function EmptyState({ activeTab, onSuggestionPress }: { activeTab: LibraryTab; onSuggestionPress: (suggestion: string) => void }) {
  const branchInfo: Record<LibraryTab, { name: string; source: string; suggestions: string[] }> = {
    all: {
      name: 'All Three Branches',
      source: 'Congress.gov, Federal Register and CourtListener',
      // Subjects that genuinely span the branches, so the default search shows
      // what "all" means rather than returning one branch's results.
      suggestions: ['immigration', 'healthcare', 'free speech', 'climate change', 'voting rights']
    },
    legislative: {
      name: 'Congressional Bills',
      source: 'Congress.gov',
      suggestions: ['healthcare', 'gun laws', 'immigration', 'taxes', 'climate change', 'education']
    },
    executive: {
      name: 'Executive Orders',
      source: 'Federal Register',
      suggestions: ['immigration', 'trade', 'environment', 'defense', 'economy']
    },
    judicial: {
      name: 'Court Cases',
      source: 'CourtListener',
      suggestions: ['civil rights', 'free speech', 'privacy', 'voting rights']
    },
  };

  const info = branchInfo[activeTab];

  return (
    <Animated.View entering={FadeIn.duration(300)} className="flex-1 px-6 pt-8">
      <View className="items-center mb-8">
        <View className="bg-slate-800/50 rounded-full p-6 mb-4">
          <Search size={32} color="#6E8A7C" />
        </View>
        <Text className="text-white font-semibold text-lg mb-2">
          Search {info.name}
        </Text>
        <Text className="text-slate-400 text-center text-sm">
          Type what you're looking for in plain English
        </Text>
      </View>

      {/* Suggestion chips */}
      <View className="mb-6">
        <Text className="text-slate-500 text-xs font-medium mb-3 text-center">
          TRY SEARCHING FOR
        </Text>
        <View className="flex-row flex-wrap justify-center">
          {info.suggestions.map((suggestion) => (
            <Pressable
              key={suggestion}
              onPress={() => {
                Haptics.selectionAsync();
                onSuggestionPress(suggestion);
              }}
              className="bg-slate-800/70 border border-slate-700/50 px-4 py-2 rounded-full m-1 active:opacity-70"
            >
              <Text className="text-slate-300 text-sm">{suggestion}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      {/* Tips */}
      <View className="bg-slate-800/30 rounded-xl p-4 border border-slate-700/30">
        <Text className="text-amber-500 text-xs font-semibold mb-2">TIPS</Text>
        <Text className="text-slate-400 text-sm leading-5">
          • Use everyday language like "gun laws" or "healthcare"{'\n'}
          • AI will understand what you mean{'\n'}
          • Results show the most relevant bills first
        </Text>
      </View>
    </Animated.View>
  );
}

// ===========================================
// SUCCESS TOAST
// ===========================================

// ===========================================
// MAIN SCREEN
// ===========================================

export default function LibraryScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<LibraryTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [selectedResult, setSelectedResult] = useState<GovernmentSearchResult | null>(null);
  /*
   * The law a reader chose to share, waiting for them to write about it.
   *
   * Sharing used to publish immediately, with the AI's summary as the body of
   * the post, over the reader's name. The composer already accepts a
   * pre-attached reference (`shareMode`), which is exactly what this is for.
   */
  const [shareTarget, setShareTarget] = useState<GovernmentReference | null>(null);


  // NO AUTO-SEARCH. This used to run itself 500ms after you stopped typing, so
  // results appeared before you had asked for anything and changed again on
  // every pause. Typing is not a request. `submittedQuery` moves only when a
  // person presses Search or the keyboard's search key.
  //
  // Clearing the box does clear the results, because an empty box asking to
  // still show the last search is its own kind of lie.
  useEffect(() => {
    if (searchQuery.trim().length === 0 && submittedQuery !== '') {
      setSubmittedQuery('');
      setSelectedResult(null);
    }
  }, [searchQuery, submittedQuery]);

  // Runs for a SUBMITTED term only.
  const {
    data: searchResults,
    isLoading: searchLoading,
    error: searchError,
    refetch,
  } = useQuery({
    queryKey: ['government-search', activeTab, submittedQuery],
    queryFn: async () => {
      const results =
        activeTab === 'all'
          ? await searchAllBranches(submittedQuery, 20)
          : await searchGovernment(activeTab, submittedQuery, 20);
      // Deduplicate results by ID before returning
      const uniqueResults = Array.from(
        new Map(results.map(r => [r.id, r])).values()
      );
      return uniqueResults;
    },
    enabled: submittedQuery.length >= 2,
    staleTime: 0, // Always fetch fresh data - search results should be current
    gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes
    refetchOnWindowFocus: false, // Don't refetch on focus
    refetchOnMount: true, // Refetch when query key changes (new search term or tab)
  });

  const handleSearch = useCallback(() => {
    const next = searchQuery.trim();
    if (next.length < 2) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSubmittedQuery(next);
    setSelectedResult(null);
  }, [searchQuery]);

  const handleTabChange = useCallback((tab: LibraryTab) => {
    setActiveTab(tab);
    setSelectedResult(null); // Clear selected result when switching tabs
    // Keep the search query - auto-search will trigger for new tab
  }, []);

  const handleResultPress = useCallback((result: GovernmentSearchResult) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSelectedResult(result);
  }, []);

  const renderResult = useCallback(
    ({ item, index }: { item: GovernmentSearchResult; index: number }) => (
      <ResultCard
        result={item}
        index={index}
        onPress={() => handleResultPress(item)}
      />
    ),
    [handleResultPress]
  );

  const placeholders: Record<LibraryTab, string> = {
    all: 'Search all three branches (e.g., "healthcare")...',
    legislative: 'Search bills (e.g., "healthcare", "tax")...',
    executive: 'Search executive orders...',
    judicial: 'Search court cases...',
  };

  return (
    <View className="flex-1 bg-slate-900">
      <LinearGradient
        colors={['#0C1D18', '#17362A', '#0C1D18']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView edges={['top']} className="flex-1">
        {/* Header */}
        <View className="px-4 py-3">
          <View className="flex-row items-center justify-between">
            <View>
              <Text className="text-2xl font-bold text-white">Library</Text>
              <Text className="text-slate-400 text-sm">
                Live gateway to government records
              </Text>
            </View>
            <View className="flex-row items-center bg-slate-800/60 px-3 py-1.5 rounded-full">
              <View className="w-2 h-2 bg-emerald-500 rounded-full mr-2" />
              <Text className="text-emerald-400 text-xs font-medium">Live</Text>
            </View>
          </View>
        </View>

        {/* Tab Selector */}
        <LibraryTabSelector activeTab={activeTab} onChangeTab={handleTabChange} />

        {/* Search Bar */}
        <SearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmit={handleSearch}
          placeholder={placeholders[activeTab]}
          isLoading={searchLoading}
        />

        {/* Results / Empty State */}
        {submittedQuery.length === 0 ? (
          <EmptyState
            activeTab={activeTab}
            onSuggestionPress={(suggestion) => {
              // Tapping a suggestion IS the request. Filling the box and leaving
              // the reader to press Search again is a dead end dressed up as help.
              setSearchQuery(suggestion);
              setSubmittedQuery(suggestion.trim());
              setSelectedResult(null);
            }}
          />
        ) : searchError ? (
          <View className="flex-1 items-center justify-center px-8">
            <AlertCircle size={32} color="#EF4444" />
            <Text className="text-red-400 font-medium mt-3">Search Failed</Text>
            <Text className="text-slate-500 text-center text-sm mt-2">
              Unable to connect to the API. Please try again.
            </Text>
          </View>
        ) : (
          <FlatList
            data={searchResults ?? []}
            renderItem={renderResult}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ paddingBottom: 20 }}
            ListEmptyComponent={
              !searchLoading ? (
                <View className="items-center justify-center py-20">
                  <Text className="text-slate-400 text-lg">No results found</Text>
                  <Text className="text-slate-500 text-sm mt-2">
                    Try a different search term
                  </Text>
                </View>
              ) : null
            }
            showsVerticalScrollIndicator={false}
          />
        )}
      </SafeAreaView>

      {/* Slide-over Preview */}
      {selectedResult && (
        <>
          {/* Backdrop */}
          <Pressable
            onPress={() => setSelectedResult(null)}
            className="absolute inset-0 bg-black/50"
          >
            <Animated.View entering={FadeIn} exiting={FadeOut} className="flex-1" />
          </Pressable>

          <SlideOverPreview
            result={selectedResult}
            onClose={() => setSelectedResult(null)}
            onShare={(referenceId) => {
              setShareTarget({
                id: referenceId,
                type: REFERENCE_TYPE_OF[selectedResult.branch],
                title: selectedResult.title,
                status: selectedResult.status ?? 'unknown',
              });
              setSelectedResult(null);
            }}
          />
        </>
      )}

      {/* The composer, with the law already attached and nothing written. */}
      <CreatePostModal
        visible={!!shareTarget}
        onClose={() => setShareTarget(null)}
        {...(shareTarget
          ? {
              shareMode: {
                type: shareTarget.type,
                id: shareTarget.id,
                title: shareTarget.title,
              },
            }
          : {})}
      />
    </View>
  );
}

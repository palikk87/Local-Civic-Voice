import React, { useState, useCallback, useEffect } from 'react';
import { api } from '@/lib/api/api';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { X, Search, FileText, Scale, Gavel, AlertCircle, RefreshCw } from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { cn } from '@/lib/cn';

export type ReferenceType = 'bill' | 'executive_order' | 'scotus_case';

export interface GovernmentReference {
  id: string;
  type: ReferenceType;
  title: string;
  status: string;
  identifier?: string; // e.g., "H.R. 82" for bills, "EO 14147" for executive orders
}

interface ReferenceSearchModalProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (reference: GovernmentReference) => void;
}

const TABS: { type: ReferenceType; label: string; icon: React.ReactNode }[] = [
  { type: 'bill', label: 'Bills', icon: <FileText size={16} color="#F59E0B" /> },
  { type: 'executive_order', label: 'Exec Orders', icon: <Scale size={16} color="#F59E0B" /> },
  { type: 'scotus_case', label: 'SCOTUS', icon: <Gavel size={16} color="#F59E0B" /> },
];

export default function ReferenceSearchModal({
  visible,
  onClose,
  onSelect,
}: ReferenceSearchModalProps) {
  const [activeTab, setActiveTab] = useState<ReferenceType>('bill');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [references, setReferences] = useState<GovernmentReference[]>([]);
  const [hasError, setHasError] = useState(false);

  const fetchReferences = useCallback(async (type: ReferenceType, search: string) => {
    setIsLoading(true);
    setHasError(false);
    try {
      const params = new URLSearchParams({ referenceType: type, limit: '25' });
      if (search.trim()) params.set('search', search.trim());
      const data = await api.get<{
        references: Array<{
          id: string;
          masterReferenceId: string;
          referenceType: ReferenceType;
          title: string;
          shortTitle: string | null;
          status: string;
        }>;
      }>(`/api/government-references?${params.toString()}`);

      setReferences(
        (data.references ?? []).map((r) => ({
          id: r.id,
          type: r.referenceType,
          title: r.shortTitle || r.title,
          status: r.status,
          identifier: r.masterReferenceId?.toUpperCase().replace(/-/g, ' '),
        }))
      );
    } catch {
      // Never substitute placeholder references — a fabricated reference cannot
      // be linked to a real government action, so the post would count toward
      // nothing. Surface the failure and let the user retry instead.
      setReferences([]);
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch references when tab or search changes
  useEffect(() => {
    if (visible) {
      const timeoutId = setTimeout(() => {
        fetchReferences(activeTab, searchQuery);
      }, 300);
      return () => clearTimeout(timeoutId);
    }
  }, [activeTab, searchQuery, visible, fetchReferences]);

  const handleTabChange = (type: ReferenceType) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setActiveTab(type);
  };

  const handleSelectReference = (reference: GovernmentReference) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSelect(reference);
    onClose();
  };

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSearchQuery('');
    onClose();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'enacted':
      case 'signed_into_law':
      case 'active':
      case 'decided':
        return 'bg-green-500/20 text-green-400';
      case 'in_committee':
      case 'passed_house':
      case 'passed_senate':
      case 'argued':
      case 'pending':
        return 'bg-amber-500/20 text-amber-400';
      case 'vetoed':
      case 'revoked':
      case 'dismissed':
        return 'bg-red-500/20 text-red-400';
      default:
        return 'bg-slate-500/20 text-slate-400';
    }
  };

  const formatStatus = (status: string) => {
    return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  const getTypeIcon = (type: ReferenceType) => {
    switch (type) {
      case 'bill':
        return <FileText size={18} color="#F59E0B" />;
      case 'executive_order':
        return <Scale size={18} color="#F59E0B" />;
      case 'scotus_case':
        return <Gavel size={18} color="#F59E0B" />;
    }
  };

  const getTypeBadgeColor = (type: ReferenceType) => {
    switch (type) {
      case 'bill':
        return 'bg-blue-500/20 text-blue-400';
      case 'executive_order':
        return 'bg-purple-500/20 text-purple-400';
      case 'scotus_case':
        return 'bg-rose-500/20 text-rose-400';
    }
  };

  const getTypeLabel = (type: ReferenceType) => {
    switch (type) {
      case 'bill':
        return 'Bill';
      case 'executive_order':
        return 'Exec Order';
      case 'scotus_case':
        return 'SCOTUS';
    }
  };

  const renderReferenceItem = ({ item }: { item: GovernmentReference }) => (
    <Pressable
      onPress={() => handleSelectReference(item)}
      className="p-4 border-b border-slate-800 active:bg-slate-800/50"
    >
      <View className="flex-row items-start">
        <View className="w-10 h-10 rounded-full bg-slate-800 items-center justify-center mr-3">
          {getTypeIcon(item.type)}
        </View>
        <View className="flex-1">
          <Text className="text-white font-medium text-base mb-1" numberOfLines={2}>
            {item.title}
          </Text>
          <View className="flex-row items-center flex-wrap gap-2">
            <View className={cn('px-2 py-0.5 rounded-full', getTypeBadgeColor(item.type))}>
              <Text className={cn('text-xs font-medium', getTypeBadgeColor(item.type).split(' ')[1])}>
                {getTypeLabel(item.type)}
              </Text>
            </View>
            {item.identifier && (
              <Text className="text-slate-400 text-xs">{item.identifier}</Text>
            )}
            <View className={cn('px-2 py-0.5 rounded-full', getStatusColor(item.status))}>
              <Text className={cn('text-xs font-medium', getStatusColor(item.status).split(' ')[1])}>
                {formatStatus(item.status)}
              </Text>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View className="flex-1 bg-slate-900">
        <LinearGradient
          colors={['#0C1D18', '#17362A', '#0C1D18']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <SafeAreaView edges={['top']} className="flex-1">
          {/* Header */}
          <View className="flex-row items-center justify-between px-4 py-3 border-b border-slate-800">
            <Pressable
              onPress={handleClose}
              className="w-10 h-10 items-center justify-center"
            >
              <X size={24} color="#8FA79A" />
            </Pressable>

            <Text className="text-white font-semibold text-lg">
              Select Reference
            </Text>

            <View className="w-10" />
          </View>

          {/* Search Input */}
          <View className="px-4 py-3">
            <View className="flex-row items-center bg-slate-800 rounded-xl px-4 py-3">
              <Search size={20} color="#6E8A7C" />
              <TextInput
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Search bills, executive orders, cases..."
                placeholderTextColor="#6E8A7C"
                className="flex-1 ml-3 text-white text-base"
                autoCapitalize="none"
                autoCorrect={false}
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => setSearchQuery('')}>
                  <X size={18} color="#6E8A7C" />
                </Pressable>
              )}
            </View>
          </View>

          {/* Tab Selector */}
          <View className="flex-row px-4 pb-3">
            {TABS.map((tab) => (
              <Pressable
                key={tab.type}
                onPress={() => handleTabChange(tab.type)}
                className={cn(
                  'flex-1 flex-row items-center justify-center py-2.5 mx-1 rounded-lg',
                  activeTab === tab.type ? 'bg-amber-500/20' : 'bg-slate-800'
                )}
              >
                {tab.icon}
                <Text
                  className={cn(
                    'ml-1.5 text-sm font-medium',
                    activeTab === tab.type ? 'text-amber-400' : 'text-slate-400'
                  )}
                >
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* Results */}
          {isLoading ? (
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator size="large" color="#F59E0B" />
              <Text className="text-slate-400 mt-4">Searching...</Text>
            </View>
          ) : hasError ? (
            <Animated.View
              entering={FadeIn}
              className="flex-1 items-center justify-center px-8"
            >
              <View className="w-16 h-16 rounded-full bg-red-500/20 items-center justify-center mb-4">
                <AlertCircle size={32} color="#F87171" />
              </View>
              <Text className="text-white text-center text-base font-medium mb-1">
                Couldn't load references
              </Text>
              <Text className="text-slate-400 text-center text-sm mb-5">
                Check your connection and try again.
              </Text>
              <Pressable
                onPress={() => fetchReferences(activeTab, searchQuery)}
                className="flex-row items-center px-5 py-2.5 rounded-xl bg-amber-500/20 active:bg-amber-500/30"
              >
                <RefreshCw size={16} color="#FBBF24" />
                <Text className="text-amber-400 font-medium text-sm ml-2">Retry</Text>
              </Pressable>
            </Animated.View>
          ) : references.length === 0 ? (
            <Animated.View
              entering={FadeIn}
              className="flex-1 items-center justify-center px-8"
            >
              <View className="w-16 h-16 rounded-full bg-slate-800 items-center justify-center mb-4">
                <Search size={32} color="#6E8A7C" />
              </View>
              <Text className="text-slate-400 text-center text-base">
                {searchQuery
                  ? `No ${getTypeLabel(activeTab).toLowerCase()}s found matching "${searchQuery}"`
                  : `Search for ${getTypeLabel(activeTab).toLowerCase()}s to reference in your post`}
              </Text>
            </Animated.View>
          ) : (
            <Animated.View entering={FadeIn} exiting={FadeOut} className="flex-1">
              <FlatList
                data={references}
                keyExtractor={(item) => item.id}
                renderItem={renderReferenceItem}
                contentContainerStyle={{ paddingBottom: 20 }}
                showsVerticalScrollIndicator={false}
              />
            </Animated.View>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

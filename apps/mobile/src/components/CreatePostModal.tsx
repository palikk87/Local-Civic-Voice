import { useAuthStore } from '@/lib/auth-store';
import React, { useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  Image,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import {
  X,
  AtSign,
  Image as ImageIcon,
  Video,
  Camera,
  FileText,
  Scale,
  Gavel,
  ChevronRight,
  Play,
  Trash2,
  AlertCircle,
} from 'lucide-react-native';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideInUp } from 'react-native-reanimated';
import { useTimelineStore, type TaggedUser } from '@/lib/timeline-store';
import type { User } from '@/lib/types';
import { cn } from '@/lib/cn';
import { uploadMedia } from '@/lib/api/api';
import ReferenceSearchModal, {
  type GovernmentReference,
  type ReferenceType,
} from './ReferenceSearchModal';

interface CreatePostModalProps {
  visible: boolean;
  onClose: () => void;
  initialContent?: string;
  shareMode?: {
    type: 'bill' | 'post' | 'executive_order' | 'scotus_case';
    id: string;
    title: string;
  };
}

interface MediaItem {
  uri: string;
  type: 'image' | 'video';
  width?: number;
  height?: number;
  duration?: number;
}

interface UploadedMedia {
  id: string;
  uri: string;
  type: 'image' | 'video';
  thumbnailUrl?: string;
}

type CreatePostStep = 'reference' | 'compose';

export default function CreatePostModal({
  visible,
  onClose,
  initialContent = '',
  shareMode,
}: CreatePostModalProps) {
  // The real signed-in account. This modal used to show `currentUser` from
  // mock-data — a fixed fictional identity — as the author of whatever you
  // were about to post.
  const me = useAuthStore((s) => s.user);

  // Step state - if shareMode is provided, skip reference selection
  const [currentStep, setCurrentStep] = useState<CreatePostStep>(
    shareMode ? 'compose' : 'reference'
  );

  // Reference selection state
  const [showReferenceSearch, setShowReferenceSearch] = useState(false);
  const [selectedReference, setSelectedReference] = useState<GovernmentReference | null>(
    shareMode
      ? {
          id: shareMode.id,
          type: shareMode.type as ReferenceType,
          title: shareMode.title,
          status: 'unknown',
        }
      : null
  );

  // Compose state
  const [content, setContent] = useState(initialContent);
  const [showUserSuggestions, setShowUserSuggestions] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);
  const [isPosting, setIsPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  // Media state
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [uploadedMedia, setUploadedMedia] = useState<UploadedMedia[]>([]);
  const [isUploadingMedia, setIsUploadingMedia] = useState(false);

  const inputRef = useRef<TextInput>(null);

  const createPost = useTimelineStore((s) => s.createPost);
  const shareContent = useTimelineStore((s) => s.shareContent);
  const searchUsers = useTimelineStore((s) => s.searchUsers);

  const suggestedUsers = searchUsers(userQuery);

  const handleTextChange = useCallback(
    (text: string) => {
      setContent(text);

      // Check for @ mentions
      const lastAtIndex = text.lastIndexOf('@', cursorPosition);
      if (lastAtIndex !== -1) {
        const textAfterAt = text.slice(lastAtIndex + 1, cursorPosition + 1);
        const hasSpace = textAfterAt.includes(' ');

        if (!hasSpace && textAfterAt.length > 0) {
          setUserQuery(textAfterAt);
          setShowUserSuggestions(true);
        } else if (textAfterAt.length === 0) {
          setUserQuery('');
          setShowUserSuggestions(true);
        } else {
          setShowUserSuggestions(false);
        }
      } else {
        setShowUserSuggestions(false);
      }
    },
    [cursorPosition]
  );

  const handleSelectionChange = useCallback(
    (event: { nativeEvent: { selection: { start: number; end: number } } }) => {
      setCursorPosition(event.nativeEvent.selection.start);
    },
    []
  );

  const handleSelectUser = useCallback(
    (user: User) => {
      const lastAtIndex = content.lastIndexOf('@', cursorPosition);
      if (lastAtIndex !== -1) {
        const beforeAt = content.slice(0, lastAtIndex);
        const afterCursor = content.slice(cursorPosition);
        const newContent = `${beforeAt}@${user.username} ${afterCursor}`;
        setContent(newContent);
      }
      setShowUserSuggestions(false);
      inputRef.current?.focus();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    },
    [content, cursorPosition]
  );

  const handleReferenceSelect = (reference: GovernmentReference) => {
    setSelectedReference(reference);
    setCurrentStep('compose');
    setShowReferenceSearch(false);
  };

  /**
   * Send one picked file to the server and return what it stored.
   *
   * THIS USED TO BE UNABLE TO WORK AND HID IT. The fetch went to a RELATIVE
   * url, which on a phone has no origin to resolve against, so it always
   * threw — and the catch handed back a made-up id with the local `file://`
   * path as the media URL. The post then shipped with a picture only the
   * author's own handset could load, and nothing anywhere said so.
   *
   * A failed upload is now a failed upload. The caller stops and says so.
   */
  const uploadMediaToServer = async (item: MediaItem): Promise<UploadedMedia> => {
    const filename = item.uri.split('/').pop() ?? 'media';
    const match = /\.(\w+)$/.exec(filename);
    const mimeType = item.type === 'video' ? 'video/mp4' : `image/${match?.[1] ?? 'jpeg'}`;

    const stored = await uploadMedia({ uri: item.uri, name: filename, type: mimeType });

    return {
      id: stored.id,
      uri: stored.url,
      type: item.type,
      thumbnailUrl: stored.thumbnailUrl ?? undefined,
    };
  };

  const pickImage = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.8,
      selectionLimit: 4 - mediaItems.length,
    });

    if (!result.canceled && result.assets.length > 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const newItems: MediaItem[] = result.assets.map((asset) => ({
        uri: asset.uri,
        type: 'image' as const,
        width: asset.width,
        height: asset.height,
      }));
      setMediaItems((prev) => [...prev, ...newItems].slice(0, 4));
    }
  };

  const pickVideo = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: false,
      quality: 0.8,
      videoMaxDuration: 60,
    });

    if (!result.canceled && result.assets.length > 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const asset = result.assets[0];
      const newItem: MediaItem = {
        uri: asset.uri,
        type: 'video',
        width: asset.width,
        height: asset.height,
        duration: asset.duration ?? undefined,
      };
      setMediaItems((prev) => [...prev, newItem].slice(0, 4));
    }
  };

  const takePhoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });

    if (!result.canceled && result.assets.length > 0) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const asset = result.assets[0];
      const newItem: MediaItem = {
        uri: asset.uri,
        type: 'image',
        width: asset.width,
        height: asset.height,
      };
      setMediaItems((prev) => [...prev, newItem].slice(0, 4));
    }
  };

  const removeMedia = (index: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMediaItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePost = async () => {
    if (!selectedReference) return;
    // No guard on empty words: the attached law IS the post. See canPost.
    if (!selectedReference) return;

    setIsPosting(true);
    setPostError(null);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      // Upload media files
      let uploadedMediaIds: string[] = [];
      if (mediaItems.length > 0) {
        setIsUploadingMedia(true);
        // No partial success. A post that quietly loses one of four pictures
        // is worse than one that refuses to publish and says why.
        try {
          const uploaded = await Promise.all(mediaItems.map(uploadMediaToServer));
          setUploadedMedia(uploaded);
          uploadedMediaIds = uploaded.map((m) => m.id);
        } finally {
          setIsUploadingMedia(false);
        }
      }

      // Publish to the server. Both paths attach the post to the selected
      // reference so it counts toward that action's public pulse.
      if (shareMode) {
        await shareContent(
          shareMode.type as 'bill' | 'executive_order' | 'scotus_case',
          shareMode.id,
          shareMode.title,
          content,
          uploadedMediaIds
        );
      } else {
        await createPost(
          content,
          'text',
          selectedReference.type,
          selectedReference.id,
          selectedReference.title,
          uploadedMediaIds
        );
      }

      // Reset and close
      resetState();
      onClose();
    } catch (error) {
      setIsPosting(false);
      setIsUploadingMedia(false);
      setPostError(error instanceof Error ? error.message : 'Could not post. Please try again.');
    }
  };

  const resetState = () => {
    setContent('');
    setPostError(null);
    setSelectedReference(null);
    setCurrentStep(shareMode ? 'compose' : 'reference');
    setMediaItems([]);
    setUploadedMedia([]);
    setShowUserSuggestions(false);
    setIsPosting(false);
    setIsUploadingMedia(false);
  };

  const handleClose = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    resetState();
    onClose();
  };

  // A LAW ON ITS OWN IS A POST. Words and media are welcome, not required —
  // putting a law in front of people is the act. Khalid: "allow posts with out
  // adding text to it from all places."
  const canPost = Boolean(selectedReference);

  const getReferenceIcon = (type: ReferenceType) => {
    switch (type) {
      case 'bill':
        return <FileText size={18} color="#F59E0B" />;
      case 'executive_order':
        return <Scale size={18} color="#F59E0B" />;
      case 'scotus_case':
        return <Gavel size={18} color="#F59E0B" />;
    }
  };

  const getReferenceTypeBadge = (type: ReferenceType) => {
    switch (type) {
      case 'bill':
        return { bg: 'bg-blue-500/20', text: 'text-blue-400', label: 'Bill' };
      case 'executive_order':
        return { bg: 'bg-purple-500/20', text: 'text-purple-400', label: 'Executive Order' };
      case 'scotus_case':
        return { bg: 'bg-rose-500/20', text: 'text-rose-400', label: 'SCOTUS Case' };
    }
  };

  const renderReferenceStep = () => (
    <Animated.View entering={FadeIn} exiting={FadeOut} className="flex-1">
      <View className="px-4 py-6">
        <Text className="text-white text-xl font-bold mb-2">
          What are you responding to?
        </Text>
        <Text className="text-slate-400 text-base">
          Select a bill, executive order, or Supreme Court case to reference in your post.
        </Text>
      </View>

      {/* Quick select buttons */}
      <View className="px-4 space-y-3">
        <Pressable
          onPress={() => setShowReferenceSearch(true)}
          className="flex-row items-center p-4 bg-slate-800/60 rounded-xl border border-slate-700/50 active:bg-slate-700/60"
        >
          <View className="w-12 h-12 rounded-full bg-blue-500/20 items-center justify-center">
            <FileText size={24} color="#3B82F6" />
          </View>
          <View className="flex-1 ml-4">
            <Text className="text-white font-semibold text-base">Search Bills</Text>
            <Text className="text-slate-400 text-sm">
              Congressional bills and legislation
            </Text>
          </View>
          <ChevronRight size={20} color="#6E8A7C" />
        </Pressable>

        <Pressable
          onPress={() => setShowReferenceSearch(true)}
          className="flex-row items-center p-4 bg-slate-800/60 rounded-xl border border-slate-700/50 active:bg-slate-700/60"
        >
          <View className="w-12 h-12 rounded-full bg-purple-500/20 items-center justify-center">
            <Scale size={24} color="#A855F7" />
          </View>
          <View className="flex-1 ml-4">
            <Text className="text-white font-semibold text-base">Executive Orders</Text>
            <Text className="text-slate-400 text-sm">
              Presidential executive orders
            </Text>
          </View>
          <ChevronRight size={20} color="#6E8A7C" />
        </Pressable>

        <Pressable
          onPress={() => setShowReferenceSearch(true)}
          className="flex-row items-center p-4 bg-slate-800/60 rounded-xl border border-slate-700/50 active:bg-slate-700/60"
        >
          <View className="w-12 h-12 rounded-full bg-rose-500/20 items-center justify-center">
            <Gavel size={24} color="#F43F5E" />
          </View>
          <View className="flex-1 ml-4">
            <Text className="text-white font-semibold text-base">Supreme Court Cases</Text>
            <Text className="text-slate-400 text-sm">
              SCOTUS decisions and pending cases
            </Text>
          </View>
          <ChevronRight size={20} color="#6E8A7C" />
        </Pressable>
      </View>
    </Animated.View>
  );

  const renderComposeStep = () => {
    const badge = selectedReference ? getReferenceTypeBadge(selectedReference.type) : null;

    return (
      <Animated.View entering={SlideInUp} className="flex-1">
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          className="flex-1"
        >
          {/* Selected Reference Preview */}
          {selectedReference && (
            <Pressable
              onPress={() => {
                if (!shareMode) {
                  setCurrentStep('reference');
                }
              }}
              className="mx-4 mt-4 p-3 bg-slate-800/60 rounded-xl border border-slate-700/50 active:bg-slate-700/60"
            >
              <View className="flex-row items-start">
                <View className="w-10 h-10 rounded-full bg-slate-700 items-center justify-center mr-3">
                  {getReferenceIcon(selectedReference.type)}
                </View>
                <View className="flex-1">
                  <Text className="text-slate-400 text-xs mb-1">Referencing</Text>
                  <Text className="text-white font-medium" numberOfLines={2}>
                    {selectedReference.title}
                  </Text>
                  {badge && (
                    <View className="flex-row items-center mt-2">
                      <View className={cn('px-2 py-0.5 rounded-full', badge.bg)}>
                        <Text className={cn('text-xs font-medium', badge.text)}>
                          {badge.label}
                        </Text>
                      </View>
                      {!shareMode && (
                        <Text className="text-slate-500 text-xs ml-2">Tap to change</Text>
                      )}
                    </View>
                  )}
                </View>
              </View>
            </Pressable>
          )}

          {/* Author */}
          <View className="flex-row px-4 pt-4">
            <Image
              source={{ uri: me?.avatar }}
              className="w-12 h-12 rounded-full"
            />
            <View className="flex-1 ml-3">
              <Text className="text-white font-semibold">{me?.displayName ?? ""}</Text>
              <Text className="text-slate-400 text-sm">@{me?.username ?? ""}</Text>
            </View>
          </View>

          {/* Input */}
          <View className="flex-1 px-4 pt-4">
            <TextInput
              ref={inputRef}
              value={content}
              onChangeText={handleTextChange}
              onSelectionChange={handleSelectionChange}
              placeholder="Share your thoughts on this..."
              placeholderTextColor="#6E8A7C"
              multiline
              autoFocus
              textAlignVertical="top"
              className="text-white text-lg flex-1"
              style={{ minHeight: 100 }}
            />

            {/* Posting failure — the post was not saved, so say so plainly */}
            {postError ? (
              <Animated.View
                entering={FadeIn}
                className="mt-3 flex-row items-start bg-red-500/15 border border-red-500/30 rounded-xl px-3 py-2.5"
              >
                <AlertCircle size={16} color="#F87171" style={{ marginTop: 2 }} />
                <Text className="text-red-300 text-sm ml-2 flex-1">{postError}</Text>
              </Animated.View>
            ) : null}

            {/* Media Previews */}
            {mediaItems.length > 0 && (
              <Animated.View entering={FadeIn} className="mt-4">
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={{ flexGrow: 0 }}
                >
                  <View className="flex-row gap-2">
                    {mediaItems.map((item, index) => (
                      <View key={index} className="relative">
                        <Image
                          source={{ uri: item.uri }}
                          className="w-24 h-24 rounded-lg"
                          resizeMode="cover"
                        />
                        {item.type === 'video' && (
                          <View className="absolute inset-0 items-center justify-center bg-black/30 rounded-lg">
                            <View className="w-8 h-8 rounded-full bg-white/80 items-center justify-center">
                              <Play size={16} color="#0C1D18" />
                            </View>
                          </View>
                        )}
                        <Pressable
                          onPress={() => removeMedia(index)}
                          className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 items-center justify-center"
                        >
                          <X size={14} color="#FFFFFF" />
                        </Pressable>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </Animated.View>
            )}

            {/* User Suggestions */}
            {showUserSuggestions && suggestedUsers.length > 0 && (
              <Animated.View
                entering={SlideInDown.springify()}
                exiting={FadeOut}
                className="absolute top-0 left-0 right-0 bg-slate-800 rounded-xl border border-slate-700 overflow-hidden"
                style={{ maxHeight: 200 }}
              >
                <FlatList
                  data={suggestedUsers}
                  keyExtractor={(item) => item.id}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item }) => (
                    <Pressable
                      onPress={() => handleSelectUser(item)}
                      className="flex-row items-center p-3 border-b border-slate-700/50"
                    >
                      <Image
                        source={{ uri: item.avatar }}
                        className="w-10 h-10 rounded-full"
                      />
                      <View className="ml-3">
                        <Text className="text-white font-medium">
                          {item.displayName}
                        </Text>
                        <Text className="text-slate-400 text-sm">
                          @{item.username}
                        </Text>
                      </View>
                    </Pressable>
                  )}
                />
              </Animated.View>
            )}
          </View>

          {/* Bottom Actions */}
          <View className="px-4 py-3 border-t border-slate-800">
            {/* Media buttons */}
            <View className="flex-row items-center mb-3">
              <Pressable
                onPress={pickImage}
                disabled={mediaItems.length >= 4}
                className={cn(
                  'flex-row items-center p-2 rounded-lg mr-2',
                  mediaItems.length >= 4 ? 'bg-slate-800/30' : 'bg-slate-800/60'
                )}
              >
                <ImageIcon
                  size={20}
                  color={mediaItems.length >= 4 ? '#4C6659' : '#F59E0B'}
                />
                <Text
                  className={cn(
                    'text-sm ml-1 font-medium',
                    mediaItems.length >= 4 ? 'text-slate-600' : 'text-amber-500'
                  )}
                >
                  Photo
                </Text>
              </Pressable>

              <Pressable
                onPress={pickVideo}
                disabled={mediaItems.length >= 4}
                className={cn(
                  'flex-row items-center p-2 rounded-lg mr-2',
                  mediaItems.length >= 4 ? 'bg-slate-800/30' : 'bg-slate-800/60'
                )}
              >
                <Video
                  size={20}
                  color={mediaItems.length >= 4 ? '#4C6659' : '#F59E0B'}
                />
                <Text
                  className={cn(
                    'text-sm ml-1 font-medium',
                    mediaItems.length >= 4 ? 'text-slate-600' : 'text-amber-500'
                  )}
                >
                  Video
                </Text>
              </Pressable>

              <Pressable
                onPress={takePhoto}
                disabled={mediaItems.length >= 4}
                className={cn(
                  'flex-row items-center p-2 rounded-lg mr-2',
                  mediaItems.length >= 4 ? 'bg-slate-800/30' : 'bg-slate-800/60'
                )}
              >
                <Camera
                  size={20}
                  color={mediaItems.length >= 4 ? '#4C6659' : '#F59E0B'}
                />
                <Text
                  className={cn(
                    'text-sm ml-1 font-medium',
                    mediaItems.length >= 4 ? 'text-slate-600' : 'text-amber-500'
                  )}
                >
                  Camera
                </Text>
              </Pressable>
            </View>

            <View className="flex-row items-center">
              <Pressable
                onPress={() => {
                  const newContent = content + '@';
                  setContent(newContent);
                  setCursorPosition(newContent.length);
                  setShowUserSuggestions(true);
                  setUserQuery('');
                  inputRef.current?.focus();
                }}
                className="flex-row items-center p-2 rounded-lg bg-slate-800/60"
              >
                <AtSign size={20} color="#F59E0B" />
                <Text className="text-amber-500 text-sm ml-1 font-medium">
                  Mention
                </Text>
              </Pressable>

              <View className="flex-1" />

              <Text className="text-slate-500 text-sm">{content.length}/500</Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Animated.View>
    );
  };

  return (
    <>
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
                {currentStep === 'reference' ? 'New Post' : 'Compose'}
              </Text>

              <Pressable
                onPress={handlePost}
                disabled={!canPost || isPosting || isUploadingMedia}
                className={cn(
                  'px-4 py-2 rounded-full',
                  canPost && !isPosting && !isUploadingMedia
                    ? 'bg-amber-500'
                    : 'bg-slate-700'
                )}
              >
                {isPosting || isUploadingMedia ? (
                  <ActivityIndicator size="small" color="#0C1D18" />
                ) : (
                  <Text
                    className={cn(
                      'font-semibold',
                      canPost ? 'text-slate-900' : 'text-slate-500'
                    )}
                  >
                    Post
                  </Text>
                )}
              </Pressable>
            </View>

            {/* Content based on step */}
            {currentStep === 'reference' ? renderReferenceStep() : renderComposeStep()}
          </SafeAreaView>
        </View>
      </Modal>

      {/* Reference Search Modal */}
      <ReferenceSearchModal
        visible={showReferenceSearch}
        onClose={() => setShowReferenceSearch(false)}
        onSelect={handleReferenceSelect}
      />
    </>
  );
}

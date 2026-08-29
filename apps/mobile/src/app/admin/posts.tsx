import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  SafeAreaView,
  Alert,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Search,
  Flag,
  Trash2,
  X,
  FileText,
  Eye,
  MessageSquare,
  ThumbsUp,
  Calendar,
  User,
  AlertTriangle,
} from 'lucide-react-native';
import { Image } from 'expo-image';
import { useAdminStore, ManagedPost } from '@/lib/admin-store';
import * as Haptics from 'expo-haptics';

interface PostCardProps {
  post: ManagedPost;
  onFlag: () => void;
  onDelete: () => void;
  onView: () => void;
}

function PostCard({ post, onFlag, onDelete, onView }: PostCardProps) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return { color: 'bg-green-500/20 border-green-500/50', text: 'text-green-400' };
      case 'flagged':
        return { color: 'bg-orange-500/20 border-orange-500/50', text: 'text-orange-400' };
      case 'removed':
        return { color: 'bg-red-500/20 border-red-500/50', text: 'text-red-400' };
      default:
        return { color: 'bg-slate-500/20 border-slate-500/50', text: 'text-slate-400' };
    }
  };

  const statusBadge = getStatusBadge(post.status);

  return (
    <View className="bg-slate-800/50 rounded-2xl p-4 mb-3">
      {/* Header */}
      <View className="flex-row items-center mb-3">
        <View className="w-10 h-10 bg-slate-700 rounded-full items-center justify-center">
          <User size={20} color="#6E8A7C" />
        </View>
        <View className="flex-1 ml-3">
          <Text className="text-white font-semibold">{post.authorDisplayName}</Text>
          <Text className="text-slate-400 text-sm">@{post.authorUsername}</Text>
        </View>
        <View className={`px-2 py-1 rounded-full border ${statusBadge.color}`}>
          <Text className={`text-xs font-medium capitalize ${statusBadge.text}`}>{post.status}</Text>
        </View>
      </View>

      {/* Content */}
      <Text className="text-slate-300 mb-3" numberOfLines={4}>
        {post.content}
      </Text>

      {/* Stats */}
      <View className="flex-row items-center gap-4 mb-3">
        <View className="flex-row items-center">
          <ThumbsUp size={14} color="#6E8A7C" />
          <Text className="text-slate-400 text-sm ml-1">{post.likes}</Text>
        </View>
        <View className="flex-row items-center">
          <MessageSquare size={14} color="#6E8A7C" />
          <Text className="text-slate-400 text-sm ml-1">{post.comments}</Text>
        </View>
        <View className="flex-row items-center">
          <Calendar size={14} color="#6E8A7C" />
          <Text className="text-slate-400 text-sm ml-1">
            {new Date(post.createdAt).toLocaleDateString()}
          </Text>
        </View>
      </View>

      {/* Flag Info */}
      {post.status === 'flagged' && post.flagReason && (
        <View className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-3 mb-3">
          <View className="flex-row items-center mb-1">
            <AlertTriangle size={14} color="#F97316" />
            <Text className="text-orange-400 text-sm font-medium ml-2">Flagged</Text>
          </View>
          <Text className="text-slate-400 text-sm">{post.flagReason}</Text>
          {post.flaggedAt && (
            <Text className="text-slate-500 text-xs mt-1">
              Flagged on {new Date(post.flaggedAt).toLocaleDateString()}
            </Text>
          )}
        </View>
      )}

      {/* Actions */}
      <View className="flex-row gap-2">
        <TouchableOpacity
          onPress={onView}
          className="flex-1 flex-row items-center justify-center py-3 bg-slate-700/50 rounded-xl"
        >
          <Eye size={16} color="#8FA79A" />
          <Text className="text-slate-300 font-medium ml-2">View</Text>
        </TouchableOpacity>

        {post.status !== 'flagged' && (
          <TouchableOpacity
            onPress={onFlag}
            className="flex-1 flex-row items-center justify-center py-3 bg-orange-500/20 rounded-xl"
          >
            <Flag size={16} color="#F97316" />
            <Text className="text-orange-400 font-medium ml-2">Flag</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPress={onDelete}
          className="flex-1 flex-row items-center justify-center py-3 bg-red-500/20 rounded-xl"
        >
          <Trash2 size={16} color="#EF4444" />
          <Text className="text-red-400 font-medium ml-2">Delete</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function AdminPostsScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [flagModalPost, setFlagModalPost] = useState<ManagedPost | null>(null);
  const [flagReason, setFlagReason] = useState('');
  const [viewPost, setViewPost] = useState<ManagedPost | null>(null);

  const posts = useAdminStore((s) => s.posts);
  const isLoading = useAdminStore((s) => s.isLoading);
  const fetchPosts = useAdminStore((s) => s.fetchPosts);
  const deletePost = useAdminStore((s) => s.deletePost);
  const flagPost = useAdminStore((s) => s.flagPost);

  useEffect(() => {
    loadPosts();
  }, [statusFilter]);

  const loadPosts = useCallback(async () => {
    await fetchPosts({
      search: search || undefined,
      status: statusFilter || undefined,
      reported: statusFilter === 'flagged' ? true : undefined,
    });
  }, [search, statusFilter, fetchPosts]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadPosts();
    setRefreshing(false);
  };

  const handleSearch = () => {
    loadPosts();
  };

  const handleFlag = async () => {
    if (!flagModalPost || !flagReason.trim()) {
      Alert.alert('Error', 'Please provide a flag reason');
      return;
    }

    const result = await flagPost(flagModalPost.id, flagReason.trim());

    if (result.success) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setFlagModalPost(null);
      setFlagReason('');
    } else {
      Alert.alert('Error', result.error || 'Failed to flag post');
    }
  };

  const handleDelete = async (post: ManagedPost) => {
    Alert.alert(
      'Delete Post',
      'Are you sure you want to delete this post? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const result = await deletePost(post.id);
            if (result.success) {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            } else {
              Alert.alert('Error', result.error || 'Failed to delete post');
            }
          },
        },
      ]
    );
  };

  const statusFilters = [
    { key: null, label: 'All' },
    { key: 'active', label: 'Active' },
    { key: 'flagged', label: 'Flagged' },
    { key: 'removed', label: 'Removed' },
  ];

  return (
    <SafeAreaView className="flex-1 bg-slate-900">
      {/* Header */}
      <View className="flex-row items-center px-4 py-3 border-b border-slate-800">
        <TouchableOpacity onPress={() => router.back()} className="p-2 -ml-2">
          <ArrowLeft size={24} color="#8FA79A" />
        </TouchableOpacity>
        <Text className="text-white text-lg font-semibold ml-2">Content Moderation</Text>
        <View className="flex-1" />
        <View className="bg-slate-800 px-3 py-1 rounded-full">
          <Text className="text-slate-400 text-sm">{posts.length} posts</Text>
        </View>
      </View>

      {/* Search Bar */}
      <View className="px-4 py-3">
        <View className="flex-row items-center bg-slate-800 rounded-xl px-4 py-2">
          <Search size={20} color="#6E8A7C" />
          <TextInput
            className="flex-1 text-white ml-3 py-2"
            placeholder="Search posts..."
            placeholderTextColor="#6E8A7C"
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <X size={18} color="#6E8A7C" />
            </TouchableOpacity>
          )}
        </View>

        {/* Status Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="mt-3 -mx-1"
        >
          {statusFilters.map((filter) => (
            <TouchableOpacity
              key={filter.key ?? 'all'}
              onPress={() => setStatusFilter(filter.key)}
              className={`px-4 py-2 rounded-full mx-1 ${
                statusFilter === filter.key
                  ? 'bg-amber-500'
                  : 'bg-slate-800'
              }`}
            >
              <Text
                className={`font-medium ${
                  statusFilter === filter.key ? 'text-slate-900' : 'text-slate-400'
                }`}
              >
                {filter.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {/* Posts List */}
      {isLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color="#F59E0B" size="large" />
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-4"
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#F59E0B" />
          }
          showsVerticalScrollIndicator={false}
        >
          {posts.length === 0 ? (
            <View className="flex-1 items-center justify-center py-20">
              <FileText size={48} color="#4C6659" />
              <Text className="text-slate-400 text-lg mt-4">No posts found</Text>
            </View>
          ) : (
            posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                onFlag={() => setFlagModalPost(post)}
                onDelete={() => handleDelete(post)}
                onView={() => setViewPost(post)}
              />
            ))
          )}
          <View className="h-8" />
        </ScrollView>
      )}

      {/* Flag Modal */}
      <Modal
        visible={!!flagModalPost}
        transparent
        animationType="slide"
        onRequestClose={() => setFlagModalPost(null)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-slate-800 max-h-[85%] rounded-t-3xl p-6">
            <View className="w-10 h-1 bg-slate-600 rounded-full self-center mb-4" />
            <Text className="text-white text-xl font-bold mb-4">Flag Post</Text>

            <Text className="text-slate-400 mb-2">Reason for flagging *</Text>
            <TextInput
              className="bg-slate-700 text-white rounded-xl p-4 mb-4"
              placeholder="Enter reason for flagging..."
              placeholderTextColor="#6E8A7C"
              value={flagReason}
              onChangeText={setFlagReason}
              multiline
              numberOfLines={3}
            />

            <TouchableOpacity
              onPress={handleFlag}
              className="bg-orange-500 py-4 rounded-xl items-center mb-3"
            >
              <Text className="text-white font-bold">Flag Post</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setFlagModalPost(null);
                setFlagReason('');
              }}
              className="bg-slate-700 py-4 rounded-xl items-center"
            >
              <Text className="text-slate-300 font-medium">Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* View Post Modal */}
      <Modal
        visible={!!viewPost}
        transparent
        animationType="slide"
        onRequestClose={() => setViewPost(null)}
      >
        <View className="flex-1 bg-black/50 justify-end">
          <View className="bg-slate-800 rounded-t-3xl p-6 max-h-[80%]">
            <View className="w-10 h-1 bg-slate-600 rounded-full self-center mb-4" />
            <View className="flex-row items-center justify-between mb-4">
              <Text className="text-white text-xl font-bold">Post Details</Text>
              <TouchableOpacity onPress={() => setViewPost(null)}>
                <X size={24} color="#8FA79A" />
              </TouchableOpacity>
            </View>

            {viewPost && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <View className="flex-row items-center mb-4">
                  <View className="w-12 h-12 bg-slate-700 rounded-full items-center justify-center">
                    <User size={24} color="#6E8A7C" />
                  </View>
                  <View className="ml-3">
                    <Text className="text-white font-semibold">{viewPost.authorDisplayName}</Text>
                    <Text className="text-slate-400">@{viewPost.authorUsername}</Text>
                  </View>
                </View>

                <Text className="text-white text-base mb-4">{viewPost.content}</Text>

                <View className="bg-slate-700/50 rounded-xl p-4 mb-4">
                  <Text className="text-slate-400 text-sm mb-2">Post ID</Text>
                  <Text className="text-white font-mono text-xs">{viewPost.id}</Text>
                </View>

                <View className="flex-row gap-4 mb-4">
                  <View className="flex-1 bg-slate-700/50 rounded-xl p-3">
                    <Text className="text-slate-400 text-xs">Likes</Text>
                    <Text className="text-white text-lg font-bold">{viewPost.likes}</Text>
                  </View>
                  <View className="flex-1 bg-slate-700/50 rounded-xl p-3">
                    <Text className="text-slate-400 text-xs">Comments</Text>
                    <Text className="text-white text-lg font-bold">{viewPost.comments}</Text>
                  </View>
                </View>

                <View className="bg-slate-700/50 rounded-xl p-4">
                  <Text className="text-slate-400 text-sm mb-1">Created</Text>
                  <Text className="text-white">{new Date(viewPost.createdAt).toLocaleString()}</Text>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
